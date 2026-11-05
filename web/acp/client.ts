/** ACP client used by the web UI. */
import { ClientSideConnection } from "@zed-industries/agent-client-protocol";
import type {
	Client,
	ContentBlock,
	ReadTextFileRequest,
	ReadTextFileResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionNotification,
	WriteTextFileRequest,
	WriteTextFileResponse,
} from "@zed-industries/agent-client-protocol";
import type { Dispatch } from "react";
import { api, webSocketUrl } from "./api";
import { webSocketStream } from "./stream";
import type { Action, PermissionState, PromptState, ToolCallState, ToolContent } from "../state/store";

function textOf(block: ContentBlock | undefined): string {
	const record = block as unknown as Record<string, unknown> | undefined;
	if (record?.type === "text" && typeof record.text === "string") return record.text;
	return "";
}

function patchPath(patch: string, fallback: string): string {
	if (fallback) return fallback;
	const added = /^\+\+\+\s+(?:b\/)?([^\t\n]+)/m.exec(patch)?.[1]?.trim();
	const removed = /^---\s+(?:a\/)?([^\t\n]+)/m.exec(patch)?.[1]?.trim();
	return (added && added !== "/dev/null" ? added : removed && removed !== "/dev/null" ? removed : "");
}

function isUnifiedDiff(text: string): boolean {
	return /^@@ -\d+/m.test(text) && (/^diff --git /m.test(text) || (/^--- /m.test(text) && /^\+\+\+ /m.test(text)));
}

function toToolContent(blocks: unknown): ToolContent[] {
	const list = Array.isArray(blocks) ? (blocks as Array<Record<string, unknown>>) : [];
	const content: ToolContent[] = [];
	for (const block of list) {
		if (block?.type === "diff") {
			content.push({
				type: "diff",
				path: String(block.path ?? ""),
				oldText: typeof block.oldText === "string" ? block.oldText : null,
				newText: String(block.newText ?? ""),
			});
			continue;
		}
		if (block?.type === "terminal") {
			content.push({ type: "text", text: `[terminal ${String(block.terminalId ?? "")}]` });
			continue;
		}
		const inner = block?.content as Record<string, unknown> | undefined;
		if (inner?.type === "text" && typeof inner.text === "string") {
			const metadata = (inner._meta ?? {}) as Record<string, unknown>;
			if (metadata.stepDiff === true || isUnifiedDiff(inner.text)) {
				content.push({ type: "patch", path: patchPath(inner.text, String(metadata.path ?? "")), patch: inner.text });
			} else {
				content.push({ type: "text", text: inner.text });
			}
		} else if (inner?.type === "image") {
			content.push({ type: "text", text: "[image]" });
		}
	}
	return content;
}

export class WebUiClient implements Client {
	constructor(private readonly dispatch: Dispatch<Action>) {}

	async sessionUpdate(notification: SessionNotification): Promise<void> {
		const update = notification.update;
		switch (update.sessionUpdate) {
			case "user_message_chunk":
				this.dispatch({ type: "message/user", text: textOf(update.content) });
				return;
			case "agent_message_chunk":
				this.dispatch({ type: "message/assistant-delta", delta: textOf(update.content) });
				return;
			case "agent_thought_chunk":
				this.dispatch({ type: "message/thinking-delta", delta: textOf(update.content) });
				return;
			case "tool_call":
				this.dispatch({
					type: "tool/upsert",
					tool: {
						id: update.toolCallId,
						title: update.title,
						kind: update.kind ?? "other",
						status: update.status ?? "pending",
						rawInput: update.rawInput,
						locations: update.locations ?? [],
						content: toToolContent(update.content),
					},
				});
				return;
			case "tool_call_update": {
				const patch: Partial<
					Pick<ToolCallState, "title" | "kind" | "status" | "content" | "rawOutput" | "locations">
				> = {};
				if (update.title !== undefined && update.title !== null) patch.title = update.title;
				if (update.status !== undefined && update.status !== null) patch.status = update.status;
				if (update.content !== undefined) patch.content = toToolContent(update.content);
				if (update.rawOutput !== undefined) patch.rawOutput = update.rawOutput;
				if (update.locations !== undefined && update.locations !== null) patch.locations = update.locations;
				if (update.kind !== undefined && update.kind !== null) patch.kind = update.kind;
				this.dispatch({ type: "tool/upsert", tool: { id: update.toolCallId, ...patch } });
				return;
			}
			case "available_commands_update":
				this.dispatch({
					type: "session/set",
					patch: {
						commands: (update.availableCommands ?? []).map((command) => ({
							name: command.name,
							description: command.description ?? "",
							source: typeof command._meta?.source === "string" ? command._meta.source : undefined,
						})),
					},
				});
				return;
			case "current_mode_update":
				this.dispatch({ type: "session/set", patch: { mode: update.currentModeId } });
				return;
			default:
				return;
		}
	}

	async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
		return new Promise<RequestPermissionResponse>((resolve) => {
			const permission: PermissionState = {
				id: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				sessionId: params.sessionId,
				toolCallId: params.toolCall.toolCallId,
				title: params.toolCall.title ?? "Permission required",
				kind: params.toolCall.kind ?? "other",
				note: typeof params._meta?.message === "string" ? params._meta.message : undefined,
				options: params.options.map((option) => ({
					optionId: option.optionId,
					name: option.name,
					kind: option.kind,
				})),
				resolve: (optionId) => {
					this.dispatch({ type: "permission/remove", id: permission.id });
					resolve(
						optionId === null
							? { outcome: { outcome: "cancelled" } }
							: { outcome: { outcome: "selected", optionId } },
					);
				},
			};
			this.dispatch({ type: "permission/add", permission });
		});
	}

	async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
		const result = await api.readFile(params.path, params.line ?? undefined, params.limit ?? undefined);
		return { content: result.content };
	}

	async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
		await api.writeFile(params.path, params.content);
		return {};
	}

	async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (method === "step/ui_prompt") {
			return new Promise<Record<string, unknown>>((resolve) => {
				const prompt: PromptState = {
					id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					title: String(params.title ?? "Input"),
					placeholder: String(params.placeholder ?? ""),
					prefill: String(params.prefill ?? ""),
					multiline: params.multiline === true,
					resolve: (value) => {
						this.dispatch({ type: "prompt/remove", id: prompt.id });
						resolve(value === null ? { cancelled: true } : { value });
					},
				};
				this.dispatch({ type: "prompt/add", prompt });
			});
		}
		throw new Error(`Unsupported extension method: ${method}`);
	}

	async extNotification(method: string, params: Record<string, unknown>): Promise<void> {
		switch (method) {
			case "step/notify":
				this.dispatch({
					type: "toast/add",
					toast: {
						level: (params.level as "info" | "warning" | "error") ?? "info",
						message: String(params.message ?? ""),
					},
				});
				return;
			case "step/status":
				this.dispatch({
					type: "status/set",
					key: String(params.key ?? ""),
					text: typeof params.text === "string" ? params.text : null,
				});
				return;
			case "step/widget":
				this.dispatch({
					type: "widget/set",
					key: String(params.key ?? ""),
					lines: Array.isArray(params.lines) ? (params.lines as string[]) : [],
				});
				return;
			case "step/turn": {
				const phase = String(params.phase ?? "");
				if (phase === "start") {
					this.dispatch({ type: "streaming/set", streaming: true });
					this.dispatch({ type: "message/assistant-start" });
				} else if (phase === "settled" || phase === "end") {
					this.dispatch({ type: "streaming/set", streaming: false });
					this.dispatch({ type: "message/assistant-end" });
				}
				return;
			}
			case "step/compaction":
				this.dispatch({ type: "session/set", patch: { compacting: params.phase === "compaction_start" } });
				return;
			case "step/queue":
				this.dispatch({
					type: "session/set",
					patch: { pendingMessages: typeof params.pendingCount === "number" ? params.pendingCount : 0 },
				});
				return;
			case "step/model":
				this.dispatch({
					type: "session/set",
					patch: {
						currentModelId: String(params.currentModelId ?? ""),
						models: Array.isArray(params.availableModels) ? (params.availableModels as never) : [],
					},
				});
				return;
			default:
				return;
		}
	}
}

export interface Bridge {
	conn: ClientSideConnection;
}

export async function createBridge(dispatch: Dispatch<Action>): Promise<Bridge> {
	const ws = new WebSocket(webSocketUrl());
	await new Promise<void>((resolveOpen, rejectOpen) => {
		const onOpen = (): void => {
			ws.removeEventListener("error", onError);
			dispatch({ type: "connection/status", status: "open" });
			resolveOpen();
		};
		const onError = (): void => {
			ws.removeEventListener("open", onOpen);
			dispatch({ type: "connection/status", status: "error", error: "WebSocket connection failed" });
			rejectOpen(new Error("WebSocket connection failed"));
		};
		ws.addEventListener("open", onOpen, { once: true });
		ws.addEventListener("error", onError, { once: true });
	});
	ws.addEventListener("close", () => dispatch({ type: "connection/status", status: "closed" }));
	const client = new WebUiClient(dispatch);
	const conn = new ClientSideConnection(() => client, webSocketStream(ws));
	return { conn };
}
