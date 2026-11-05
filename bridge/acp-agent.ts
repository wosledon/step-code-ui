/**
 * ACP agent implementation: translates Agent Client Protocol calls into step RPC
 * commands and streams step RPC events back as ACP session updates.
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentSideConnection } from "@zed-industries/agent-client-protocol";
import type {
	Agent,
	AvailableCommand,
	ContentBlock,
	InitializeResponse,
	ModelInfo,
	PermissionOption,
	PromptRequest,
	PromptResponse,
	RequestPermissionResponse,
	SessionModelState,
	SessionModeState,
	SessionNotification,
	ToolCallUpdate,
} from "@zed-industries/agent-client-protocol";
import * as em from "./event-map.js";
import type { RpcEvent, StepRpcClient } from "./rpc-client.js";
import { resolveWithin } from "./fs-safe.js";
import { Mutex, SessionRegistry, UI_MODES, type SessionState, type UiMode } from "./sessions.js";

/** The SDK does not export aliases for these unions; derive them. */
export type SessionUpdate = NonNullable<SessionNotification["update"]>;
export type StopReason = NonNullable<PromptResponse["stopReason"]>;

export interface AcpAgentDeps {
	rpc: StepRpcClient;
	sessions: SessionRegistry;
	/** Owner of the running turn; only that instance answers agent UI dialogs. */
	turnOwner: { current: StepAcpAgent | null };
	cwd: string;
	/** Session id the agent process was started with (`/ui --session <id>`). */
	pinnedSessionId?: string;
	log: (line: string) => void;
}

interface StepModel {
	id: string;
	name?: string;
	provider?: string;
	contextWindow?: number;
	reasoning?: boolean;
	input?: string[];
}

interface StepState {
	model: StepModel | null;
	thinkingLevel: string;
	isStreaming: boolean;
	isCompacting?: boolean;
	sessionFile?: string;
	sessionId?: string;
	sessionName?: string;
	messageCount?: number;
	pendingMessageCount?: number;
}

interface StepMessage {
	role: string;
	content: unknown;
	timestamp?: number;
}

interface PendingDialog {
	resolve: (response: unknown) => void;
	timer?: NodeJS.Timeout;
}

interface TrackedToolCall {
	toolCallId: string;
	toolName: string;
	args: unknown;
}

const ACP_PROTOCOL_VERSION = 1;

function asRecord(value: unknown): Record<string, unknown> {
	return (value ?? {}) as Record<string, unknown>;
}

function asArray<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

export class StepAcpAgent implements Agent {
	private readonly turnMutex = new Mutex();
	private readonly pendingDialogs = new Map<string, PendingDialog>();
	private readonly modelIndex = new Map<string, { provider: string; id: string }>();
	private trackedTool: TrackedToolCall | null = null;
	private currentSessionId: string | null = null;
	private streaming = false;
	private turnWaiters = new Map<string, (reason: StopReason) => void>();
	private readonly onEvent: (event: RpcEvent) => void;
	private readonly onExit: () => void;

	constructor(
		private readonly conn: AgentSideConnection,
		private readonly deps: AcpAgentDeps,
	) {
		this.onEvent = (event) => this.handleEvent(event);
		this.onExit = () => this.handleAgentExit();
		this.deps.rpc.on("event", this.onEvent);
		this.deps.rpc.on("exit", this.onExit);
	}

	dispose(): void {
		this.deps.rpc.off("event", this.onEvent);
		this.deps.rpc.off("exit", this.onExit);
		for (const [, dialog] of this.pendingDialogs) {
			if (dialog.timer) clearTimeout(dialog.timer);
			dialog.resolve({ cancelled: true });
		}
		this.pendingDialogs.clear();
		this.turnWaiters.clear();
	}

	// ---------------------------------------------------------------- helpers

	private log(line: string): void {
		this.deps.log(`[acp] ${line}`);
	}

	private session(): SessionState | null {
		return this.currentSessionId ? (this.deps.sessions.get(this.currentSessionId) ?? null) : null;
	}

	private sendUpdate(sessionId: string, update: SessionUpdate): void {
		const notification: SessionNotification = { sessionId, update };
		void this.conn.sessionUpdate(notification).catch((err) => this.log(`sessionUpdate failed: ${String(err)}`));
	}

	private async notify(method: string, params: Record<string, unknown>): Promise<void> {
		try {
			await this.conn.extNotification(method, params);
		} catch (err) {
			this.log(`extNotification ${method} failed: ${String(err)}`);
		}
	}

	private async callClient(method: string, params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
		try {
			return (await this.conn.extMethod(method, params)) as Record<string, unknown>;
		} catch (err) {
			this.log(`extMethod ${method} failed: ${String(err)}`);
			return null;
		}
	}

	private modeState(session: SessionState): SessionModeState {
		return {
			currentModeId: session.mode,
			availableModes: UI_MODES,
		};
	}

	private modelState(session: SessionState): SessionModelState {
		return {
			currentModelId: session.currentModelId,
			availableModels: session.availableModels,
		};
	}

	private async fetchModels(): Promise<{ models: ModelInfo[]; index: Map<string, { provider: string; id: string }> }> {
		const data = (await this.deps.rpc.send({ type: "get_available_models" })) as { models?: StepModel[] };
		const models = asArray<StepModel>(data?.models);
		const index = new Map<string, { provider: string; id: string }>();
		const infos: ModelInfo[] = models.map((model) => {
			const provider = model.provider ?? "step";
			index.set(model.id, { provider, id: model.id });
			const info: ModelInfo = {
				modelId: model.id,
				name: model.name ?? model.id,
				description: provider,
				_meta: { provider, contextWindow: model.contextWindow ?? null, reasoning: model.reasoning ?? false },
			};
			return info;
		});
		return { models: infos, index };
	}

	private async fetchThinkingLevels(): Promise<string[]> {
		try {
			const data = (await this.deps.rpc.send({ type: "get_available_thinking_levels" })) as { levels?: string[] };
			return asArray<string>(data?.levels);
		} catch {
			return ["off", "minimal", "low", "medium", "high"];
		}
	}

	private async fetchCommands(): Promise<AvailableCommand[]> {
		const data = (await this.deps.rpc.send({ type: "get_commands" })) as { commands?: Array<Record<string, unknown>> };
		return asArray<Record<string, unknown>>(data?.commands).map((command) => ({
			name: String(command.name ?? ""),
			description: typeof command.description === "string" ? command.description : "",
			_meta: { source: command.source ?? null, path: command.path ?? null },
		}));
	}

	/** Build session state from the agent's current state. */
	private async adoptSession(): Promise<SessionState> {
		const state = (await this.deps.rpc.send({ type: "get_state" })) as StepState;
		const [{ models, index }, thinkingLevels, commands] = await Promise.all([
			this.fetchModels(),
			this.fetchThinkingLevels(),
			this.fetchCommands(),
		]);
		for (const [key, value] of index) this.modelIndex.set(key, value);
		const sessionId = state.sessionId ?? `ephemeral-${randomUUID()}`;
		const existing = this.deps.sessions.get(sessionId);
		const session: SessionState =
			existing ??
			this.deps.sessions.create({
				sessionId,
				cwd: this.deps.cwd,
				sessionFile: state.sessionFile,
				currentModelId: state.model?.id ?? "",
				availableModels: models,
				thinkingLevel: state.thinkingLevel ?? "off",
				thinkingLevels,
				commands,
				streaming: state.isStreaming === true,
			});
		if (existing) {
			existing.sessionFile = state.sessionFile ?? existing.sessionFile;
			existing.currentModelId = state.model?.id ?? existing.currentModelId;
			existing.availableModels = models;
			existing.thinkingLevel = state.thinkingLevel ?? existing.thinkingLevel;
			existing.thinkingLevels = thinkingLevels;
			existing.commands = commands;
		}
		this.currentSessionId = session.sessionId;
		return session;
	}

	private async refreshSessionState(session: SessionState): Promise<void> {
		try {
			const state = (await this.deps.rpc.send({ type: "get_state" })) as StepState;
			session.sessionFile = state.sessionFile ?? session.sessionFile;
			session.streaming = state.isStreaming === true;
			if (state.model?.id) session.currentModelId = state.model.id;
			if (state.thinkingLevel) session.thinkingLevel = state.thinkingLevel;
		} catch (err) {
			this.log(`get_state failed: ${String(err)}`);
		}
	}

	private sessionRoot(): string {
		const envDir = process.env.STEP_CODING_AGENT_SESSION_DIR;
		if (envDir) return envDir;
		const current = this.session()?.sessionFile;
		if (current) return dirname(dirname(current));
		return join(homedir(), ".stepcode", "agent", "sessions");
	}

	private async listSessionFiles(): Promise<
		Array<{ sessionId: string; path: string; modifiedAt: number; cwd?: string; title?: string }>
	> {
		const root = this.sessionRoot();
		const results: Array<{ sessionId: string; path: string; modifiedAt: number; cwd?: string; title?: string }> = [];
		const walk = async (dir: string, depth: number): Promise<void> => {
			if (depth > 3) return;
			let entries;
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(full, depth + 1);
					continue;
				}
				if (!entry.name.endsWith(".jsonl")) continue;
				try {
					const info = await stat(full);
					const raw = await readFile(full, "utf8");
					const lines = raw.split("\n");
					const header = JSON.parse(lines[0] ?? "{}") as { id?: string; cwd?: string };
					results.push({
						sessionId: header.id ?? entry.name.replace(/\.jsonl$/, ""),
						path: full,
						modifiedAt: info.mtimeMs,
						cwd: header.cwd,
						title: firstUserMessage(lines.slice(1)),
					});
				} catch {
					// ignore unreadable session files
				}
			}
		};
		await walk(root, 0);
		results.sort((a, b) => b.modifiedAt - a.modifiedAt);
		return results;
	}

	private async resolveSessionPath(sessionId: string): Promise<string> {
		const known = this.deps.sessions.get(sessionId);
		if (known?.sessionFile) return known.sessionFile;
		const files = await this.listSessionFiles();
		const match = files.find((file) => file.sessionId === sessionId);
		if (match) return match.path;
		throw new Error(`Unknown session: ${sessionId}`);
	}

	// ---------------------------------------------------------------- events

	private handleEvent(event: RpcEvent): void {
		const session = this.session();
		const sessionId = session?.sessionId;
		try {
			switch (event.type) {
				case "message_update": {
					if (!sessionId) return;
					const update = em.mapMessageUpdate(event);
					if (update) this.sendUpdate(sessionId, update);
					return;
				}
				case "message_start":
					return;
				case "message_end": {
					if (!sessionId) return;
					const update = em.mapUserMessage(event);
					if (update) this.sendUpdate(sessionId, update);
					return;
				}
				case "tool_execution_start": {
					if (!sessionId) return;
					this.trackedTool = {
						toolCallId: String(event.toolCallId ?? ""),
						toolName: String(event.toolName ?? "tool"),
						args: event.args ?? {},
					};
					this.sendUpdate(sessionId, em.mapToolExecutionStart(event));
					return;
				}
				case "tool_execution_update": {
					if (!sessionId) return;
					const update = em.mapToolExecutionUpdate(event);
					if (update) this.sendUpdate(sessionId, update);
					return;
				}
				case "tool_execution_end": {
					if (!sessionId) return;
					this.sendUpdate(sessionId, em.mapToolExecutionEnd(event));
					return;
				}
				case "agent_start": {
					this.streaming = true;
					if (session) session.streaming = true;
					void this.notify("step/turn", { phase: "start", sessionId });
					return;
				}
				case "agent_end": {
					void this.notify("step/turn", { phase: "end", sessionId });
					return;
				}
				case "agent_settled": {
					this.streaming = false;
					if (session) session.streaming = false;
					void this.notify("step/turn", { phase: "settled", sessionId });
					this.settleTurn("end_turn");
					return;
				}
				case "extension_ui_request": {
					void this.handleUiRequest(event).catch((err) => this.log(`ui request failed: ${String(err)}`));
					return;
				}
				case "queue_update": {
					void this.notify("step/queue", { sessionId, ...asRecord(event) });
					return;
				}
				case "compaction_start":
				case "compaction_end": {
					void this.notify("step/compaction", { sessionId, phase: event.type, ...asRecord(event) });
					return;
				}
				case "extension_error": {
					void this.notify("step/notify", {
						sessionId,
						level: "error",
						message: String(event.error ?? event.message ?? "Extension error"),
					});
					return;
				}
				case "model_select":
				case "thinking_level_select": {
					if (session) void this.refreshSessionState(session).catch(() => undefined);
					return;
				}
				default:
					return;
			}
		} catch (err) {
			this.log(`event handling failed for ${event.type}: ${String(err)}`);
		}
	}

	private settleTurn(reason: StopReason): void {
		for (const [sessionId, resolve] of this.turnWaiters) {
			this.turnWaiters.delete(sessionId);
			resolve(reason);
		}
	}

	private handleAgentExit(): void {
		this.streaming = false;
		this.settleTurn("cancelled");
		void this.notify("step/notify", { level: "error", message: "The agent process exited." });
	}

	// ------------------------------------------------------------ UI dialogs

	private async handleUiRequest(event: RpcEvent): Promise<void> {
		const id = String(event.id ?? "");
		const method = String(event.method ?? "");
		const timeout = typeof event.timeout === "number" ? event.timeout : 0;

		switch (method) {
			case "notify":
				await this.notify("step/notify", {
					level: typeof event.notifyType === "string" ? event.notifyType : "info",
					message: String(event.message ?? ""),
				});
				return;
			case "setStatus":
				await this.notify("step/status", {
					key: String(event.statusKey ?? ""),
					text: typeof event.statusText === "string" ? event.statusText : null,
				});
				return;
			case "setWidget":
				await this.notify("step/widget", {
					key: String(event.widgetKey ?? ""),
					lines: asArray<string>(event.widgetLines),
				});
				return;
			case "setTitle":
			case "set_editor_text":
				return;
			case "select":
			case "confirm":
			case "input":
			case "editor":
				break;
			default:
				this.log(`unhandled extension_ui_request method: ${method}`);
				return;
		}

		// Dialog requests need a response; only the turn owner answers them.
		if (this.deps.turnOwner.current !== this) {
			this.log(`ignoring ${method} dialog from a non-owning connection`);
			return;
		}

		if (method === "input" || method === "editor") {
			const response = await this.callClient("step/ui_prompt", {
				title: String(event.title ?? "Input"),
				placeholder: typeof event.placeholder === "string" ? event.placeholder : "",
				prefill: typeof event.prefill === "string" ? event.prefill : "",
				multiline: method === "editor",
			});
			if (response?.cancelled === true || response === null) {
				this.deps.rpc.post({ type: "extension_ui_response", id, cancelled: true });
			} else {
				this.deps.rpc.post({ type: "extension_ui_response", id, value: String(response.value ?? "") });
			}
			return;
		}

		const answer = await this.requestPermission(event, method, id, timeout);
		if (answer === null) {
			this.deps.rpc.post({ type: "extension_ui_response", id, cancelled: true });
			return;
		}
		if (method === "confirm") {
			this.deps.rpc.post({ type: "extension_ui_response", id, confirmed: answer.confirmed });
		} else {
			this.deps.rpc.post({ type: "extension_ui_response", id, value: answer.value });
		}
		if (answer.always === "allow") this.applyMode("auto");
		if (answer.always === "reject") this.applyMode("deny");
	}

	private applyMode(mode: UiMode): void {
		const session = this.session();
		if (!session || session.mode === mode) return;
		session.mode = mode;
		this.sendUpdate(session.sessionId, { sessionUpdate: "current_mode_update", currentModeId: mode });
		void this.notify("step/notify", {
			level: "info",
			message: mode === "auto" ? "Auto-approve enabled" : mode === "deny" ? "Auto-deny enabled" : "Approval prompts enabled",
		});
	}

	/** Map a step confirm/select dialog onto an ACP permission request. */
	private async requestPermission(
		event: RpcEvent,
		method: string,
		dialogId: string,
		timeout: number,
	): Promise<{ confirmed?: boolean; value?: string; always?: "allow" | "reject" } | null> {
		const session = this.session();
		if (!session) return null;
		if (session.mode === "auto") {
			session.autoApproved += 1;
			return method === "confirm" ? { confirmed: true } : { value: String(asArray<string>(event.options)[0] ?? "") };
		}
		if (session.mode === "deny") {
			return method === "confirm" ? { confirmed: false } : { value: "", always: "reject" };
		}

		const title = String(event.title ?? "Permission required");
		const message = typeof event.message === "string" ? event.message : "";
		const tracked = this.trackedTool;
		const toolCall: ToolCallUpdate = {
			toolCallId: tracked?.toolCallId || `dialog-${dialogId}`,
			title: tracked ? em.toolTitleFor(tracked.toolName, tracked.args) : title,
			kind: tracked ? em.toolKindFor(tracked.toolName) : "other",
			status: "pending",
		};
		if (tracked) {
			toolCall.rawInput = asRecord(tracked.args);
			toolCall.locations = em.locationsFor(tracked.args);
		}

		const options: PermissionOption[] =
			method === "confirm"
				? [
						{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
						{ optionId: "allow-always", name: "Always allow", kind: "allow_always" },
						{ optionId: "reject-once", name: "Reject once", kind: "reject_once" },
						{ optionId: "reject-always", name: "Always reject", kind: "reject_always" },
					]
				: asArray<string>(event.options).map((option, index) => ({
						optionId: `option-${index}`,
						name: option,
						kind: "allow_once" as const,
					}));

		const response = await new Promise<RequestPermissionResponse | null>((resolve) => {
			const entry: PendingDialog = { resolve: resolve as (value: unknown) => void };
			if (timeout > 0) {
				entry.timer = setTimeout(() => {
					this.pendingDialogs.delete(dialogId);
					resolve(null);
				}, timeout);
			}
			this.pendingDialogs.set(dialogId, entry);
			void this.conn
				.requestPermission({
					sessionId: session.sessionId,
					toolCall,
					options,
					_meta: { title, message, method },
				})
				.then((result) => {
					this.clearDialog(dialogId, entry);
					resolve(result);
				})
				.catch((err) => {
					this.log(`requestPermission failed: ${String(err)}`);
					this.clearDialog(dialogId, entry);
					resolve(null);
				});
		});

		if (response === null) return null;
		const outcome = response.outcome;
		if (outcome.outcome === "cancelled") return null;
		const selected = options.find((option) => option.optionId === outcome.optionId);
		if (!selected) return null;
		if (method === "confirm") {
			return {
				confirmed: selected.kind === "allow_once" || selected.kind === "allow_always",
				always: selected.kind === "allow_always" ? "allow" : selected.kind === "reject_always" ? "reject" : undefined,
			};
		}
		return { value: selected.name, always: undefined };
	}

	private clearDialog(dialogId: string, entry: PendingDialog): void {
		if (this.pendingDialogs.get(dialogId) === entry) this.pendingDialogs.delete(dialogId);
		if (entry.timer) clearTimeout(entry.timer);
	}

	// ----------------------------------------------------------- ACP methods

	async initialize(params: { protocolVersion: number }): Promise<InitializeResponse> {
		const version = typeof params?.protocolVersion === "number" ? params.protocolVersion : ACP_PROTOCOL_VERSION;
		return {
			protocolVersion: version,
			agentCapabilities: {
				loadSession: true,
				promptCapabilities: { image: true, embeddedContext: true, audio: false },
				mcpCapabilities: { http: false, sse: false },
			},
			authMethods: [],
		};
	}

	async authenticate(): Promise<Record<string, never>> {
		// Credentials come from the CLI's own auth store.
		return {};
	}

	async newSession(params: { cwd?: string; mcpServers?: unknown[] }): Promise<{
		sessionId: string;
		modes: SessionModeState;
		models: SessionModelState;
	}> {
		const cwd = params?.cwd ? resolveWithin(this.deps.cwd, params.cwd) : this.deps.cwd;
		if (cwd !== this.deps.cwd) {
			throw new Error(`Session cwd must stay inside ${this.deps.cwd}`);
		}
		if (this.deps.pinnedSessionId && !this.currentSessionId) {
			const session = await this.adoptSession();
			return { sessionId: session.sessionId, modes: this.modeState(session), models: this.modelState(session) };
		}
		await this.deps.rpc.send({ type: "new_session" });
		const session = await this.adoptSession();
		return { sessionId: session.sessionId, modes: this.modeState(session), models: this.modelState(session) };
	}

	async loadSession(params: { sessionId: string; cwd?: string }): Promise<{
		modes: SessionModeState;
		models: SessionModelState;
	}> {
		const path = await this.resolveSessionPath(params.sessionId);
		const result = (await this.deps.rpc.send({ type: "switch_session", sessionPath: path })) as { cancelled?: boolean };
		if (result?.cancelled) throw new Error("Session switch was cancelled by an extension");
		const session = await this.adoptSession();
		if (session.sessionId !== params.sessionId) {
			this.deps.sessions.delete(session.sessionId);
			session.sessionId = params.sessionId;
			this.deps.sessions.create(session);
		}
		this.currentSessionId = params.sessionId;
		await this.replayHistory(session);
		return { modes: this.modeState(session), models: this.modelState(session) };
	}

	/** Re-emit the loaded conversation as session updates. */
	private async replayHistory(session: SessionState): Promise<void> {
		let messages: StepMessage[] = [];
		try {
			const data = (await this.deps.rpc.send({ type: "get_messages" })) as { messages?: StepMessage[] };
			messages = asArray<StepMessage>(data?.messages);
		} catch (err) {
			this.log(`get_messages failed: ${String(err)}`);
			return;
		}
		for (const message of messages) {
			if (message.role === "user") {
				const text = em.userText(message);
				if (text) this.sendUpdate(session.sessionId, { sessionUpdate: "user_message_chunk", content: { type: "text", text } });
				continue;
			}
			if (message.role === "assistant") {
				const thinking = em.thinkingOf(message);
				if (thinking) {
					this.sendUpdate(session.sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: thinking } });
				}
				const text = em.assistantText(message);
				if (text) {
					this.sendUpdate(session.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
				}
				for (const call of em.toolCallsOf(message)) {
					this.sendUpdate(session.sessionId, {
						sessionUpdate: "tool_call",
						toolCallId: call.id,
						title: em.toolTitleFor(call.name, call.args),
						kind: em.toolKindFor(call.name),
						status: "completed",
						rawInput: asRecord(call.args),
						locations: em.locationsFor(call.args),
					});
				}
				continue;
			}
			if (message.role !== "toolResult") continue;
			const record = asRecord(message);
			const toolCallId = String(record.toolCallId ?? "");
			if (!toolCallId) continue;
			this.sendUpdate(session.sessionId, {
				sessionUpdate: "tool_call_update",
				toolCallId,
				status: record.isError === true ? "failed" : "completed",
				content: em.toolResultContent({ content: record.content, details: record.details }, record.isError === true),
			});
		}
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const session = this.deps.sessions.require(params.sessionId);
		const { text, images } = splitPrompt(params.prompt);
		if (text.trim().length === 0 && images.length === 0) {
			throw new Error("Prompt is empty");
		}
		const previousOwner = this.deps.turnOwner.current;
		this.deps.turnOwner.current = this;
		try {
			return await this.turnMutex.run(async () => {
				const reason = await new Promise<StopReason>((resolve) => {
					this.turnWaiters.set(session.sessionId, resolve);
					const command: Record<string, unknown> = { type: "prompt", message: text };
					if (images.length > 0) command.images = images;
					if (this.streaming) command.streamingBehavior = "steer";
					this.deps.rpc
						.send(command)
						.then(() => undefined)
						.catch((err) => {
							this.log(`prompt rejected: ${String(err)}`);
							void this.notify("step/notify", { level: "error", message: String(err) });
							this.settleTurn("end_turn");
						});
				});
				return { stopReason: reason };
			});
		} finally {
			this.deps.turnOwner.current = previousOwner;
			this.turnWaiters.delete(session.sessionId);
			session.streaming = false;
			await this.refreshSessionState(session);
		}
	}

	async cancel(params: { sessionId: string }): Promise<void> {
		const session = this.deps.sessions.get(params.sessionId);
		if (!session) return;
		this.deps.rpc.post({ type: "abort" });
		for (const [id, dialog] of this.pendingDialogs) {
			if (dialog.timer) clearTimeout(dialog.timer);
			dialog.resolve({ outcome: { outcome: "cancelled" } });
			this.pendingDialogs.delete(id);
		}
		this.settleTurn("cancelled");
	}

	async setSessionMode(params: { sessionId: string; modeId: string }): Promise<Record<string, never>> {
		const session = this.deps.sessions.require(params.sessionId);
		const mode = params.modeId;
		if (mode !== "default" && mode !== "auto" && mode !== "deny") {
			throw new Error(`Unknown mode: ${params.modeId}`);
		}
		session.mode = mode;
		this.sendUpdate(session.sessionId, { sessionUpdate: "current_mode_update", currentModeId: mode });
		return {};
	}

	async setSessionModel(params: { sessionId: string; modelId: string }): Promise<Record<string, never>> {
		const session = this.deps.sessions.require(params.sessionId);
		const target = this.modelIndex.get(params.modelId);
		if (!target) throw new Error(`Unknown model: ${params.modelId}`);
		await this.deps.rpc.send({ type: "set_model", provider: target.provider, modelId: target.id });
		session.currentModelId = params.modelId;
		await this.notify("step/model", { currentModelId: params.modelId, availableModels: session.availableModels });
		return {};
	}

	async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
		const sessionId = typeof params.sessionId === "string" ? params.sessionId : this.currentSessionId;
		const session = sessionId ? this.deps.sessions.require(sessionId) : null;
		switch (method) {
			case "step/get_state": {
				const state = (await this.deps.rpc.send({ type: "get_state" })) as StepState;
				const stats = (await this.deps.rpc.send({ type: "get_session_stats" }).catch(() => null)) as Record<
					string,
					unknown
				> | null;
				return {
					sessionId: session?.sessionId ?? state.sessionId ?? null,
					cwd: this.deps.cwd,
					sessionFile: state.sessionFile ?? session?.sessionFile ?? null,
					sessionName: state.sessionName ?? null,
					streaming: state.isStreaming === true,
					compacting: state.isCompacting === true,
					messageCount: state.messageCount ?? 0,
					pendingMessageCount: state.pendingMessageCount ?? 0,
					currentModelId: session?.currentModelId ?? state.model?.id ?? "",
					thinkingLevel: session?.thinkingLevel ?? state.thinkingLevel ?? "off",
					thinkingLevels: session?.thinkingLevels ?? [],
					mode: session?.mode ?? "default",
					availableModels: session?.availableModels ?? [],
					commands: session?.commands ?? [],
					stats,
					pinnedSessionId: this.deps.pinnedSessionId ?? null,
				};
			}
			case "step/get_messages": {
				const data = (await this.deps.rpc.send({ type: "get_messages" })) as { messages?: unknown[] };
				return { messages: asArray(data?.messages) };
			}
			case "step/get_commands": {
				if (!session) throw new Error("No active session");
				session.commands = await this.fetchCommands();
				this.sendUpdate(session.sessionId, {
					sessionUpdate: "available_commands_update",
					availableCommands: session.commands,
				});
				return { commands: session.commands };
			}
			case "step/set_thinking_level": {
				if (!session) throw new Error("No active session");
				const level = String(params.level ?? "");
				await this.deps.rpc.send({ type: "set_thinking_level", level });
				session.thinkingLevel = level;
				return { thinkingLevel: level };
			}
			case "step/get_thinking_levels": {
				if (!session) throw new Error("No active session");
				session.thinkingLevels = await this.fetchThinkingLevels();
				return { levels: session.thinkingLevels };
			}
			case "step/compact": {
				if (!session) throw new Error("No active session");
				const command: Record<string, unknown> = { type: "compact" };
				if (typeof params.instructions === "string" && params.instructions.length > 0) {
					command.customInstructions = params.instructions;
				}
				const data = await this.deps.rpc.send(command);
				return asRecord(data);
			}
			case "step/get_session_stats": {
				const data = await this.deps.rpc.send({ type: "get_session_stats" });
				return asRecord(data);
			}
			case "step/list_sessions": {
				const files = await this.listSessionFiles();
				return {
					sessions: files.map((file) => ({
						sessionId: file.sessionId,
						path: file.path,
						cwd: file.cwd ?? null,
						title: file.title ?? null,
						modifiedAt: file.modifiedAt,
					})),
				};
			}
			case "step/switch_session": {
				const target = String(params.sessionId ?? "");
				const path = await this.resolveSessionPath(target);
				const result = (await this.deps.rpc.send({ type: "switch_session", sessionPath: path })) as {
					cancelled?: boolean;
				};
				if (result?.cancelled) throw new Error("Session switch was cancelled by an extension");
				const adopted = await this.adoptSession();
				if (session) await this.replayHistory(adopted);
				return { sessionId: adopted.sessionId };
			}
			case "step/fork": {
				const command: Record<string, unknown> = { type: "fork" };
				if (typeof params.entryId === "string") command.entryId = params.entryId;
				const data = await this.deps.rpc.send(command);
				const adopted = await this.adoptSession();
				return { ...asRecord(data), sessionId: adopted.sessionId };
			}
			case "step/clone": {
				const data = await this.deps.rpc.send({ type: "clone" });
				const adopted = await this.adoptSession();
				return { ...asRecord(data), sessionId: adopted.sessionId };
			}
			case "step/export_html": {
				const file = typeof params.path === "string" ? params.path : join(this.deps.cwd, "step-session.html");
				const data = await this.deps.rpc.send({ type: "export_html", path: file });
				return { ...asRecord(data), path: file };
			}
			case "step/steer":
			case "step/follow_up": {
				const message = String(params.message ?? "");
				if (!message) throw new Error("message is required");
				await this.deps.rpc.send({ type: method === "step/steer" ? "steer" : "follow_up", message });
				return { ok: true };
			}
			case "step/abort": {
				this.deps.rpc.post({ type: "abort" });
				return { ok: true };
			}
			case "step/set_queue_modes": {
				const commands: Array<Record<string, unknown>> = [];
				if (typeof params.steeringMode === "string") commands.push({ type: "set_steering_mode", mode: params.steeringMode });
				if (typeof params.followUpMode === "string") commands.push({ type: "set_follow_up_mode", mode: params.followUpMode });
				for (const command of commands) await this.deps.rpc.send(command);
				return { ok: true };
			}
			default:
				throw new Error(`Unsupported extension method: ${method}`);
		}
	}

	async extNotification(method: string, params: Record<string, unknown>): Promise<void> {
		if (method === "step/ui_prompt_response") {
			const id = String(params.dialogId ?? "");
			const dialog = this.pendingDialogs.get(id);
			if (!dialog) return;
			this.pendingDialogs.delete(id);
			if (dialog.timer) clearTimeout(dialog.timer);
			dialog.resolve(params);
			return;
		}
		this.log(`unhandled extNotification: ${method}`);
	}
}

/** First user message of a session file, used as the sidebar list title. */
function firstUserMessage(lines: string[]): string | undefined {
	for (const line of lines) {
		if (!line) continue;
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (entry.type !== "message") continue;
		const message = asRecord(entry.message);
		if (message.role !== "user") continue;
		let text = "";
		for (const block of asArray<unknown>(message.content)) {
			const value = textOfBlock(block);
			if (value !== undefined) text += value;
		}
		text = text.replace(/\s+/g, " ").trim();
		if (text.length > 0) return text.length > 90 ? `${text.slice(0, 89)}…` : text;
	}
	return undefined;
}

function textOfBlock(block: unknown): string | undefined {
	const record = block as Record<string, unknown> | null;
	if (record && typeof record.text === "string") return record.text;
	return undefined;
}

/** Split ACP prompt content blocks into step RPC text + images. */
export function splitPrompt(prompt: ContentBlock[]): { text: string; images: Array<{ type: "image"; data: string; mimeType: string }> } {
	let text = "";
	const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
	for (const block of asArray<ContentBlock>(prompt)) {
		const record = asRecord(block);
		if (record.type === "text" && typeof record.text === "string") {
			text += record.text;
			continue;
		}
		if (record.type === "image") {
			const data = typeof record.data === "string" ? record.data : undefined;
			const mimeType = typeof record.mimeType === "string" ? record.mimeType : "image/png";
			if (data) {
				images.push({ type: "image", data, mimeType });
				continue;
			}
			const uri = typeof record.uri === "string" ? record.uri : "";
			if (uri.startsWith("data:")) {
				const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
				if (match) {
					images.push({ type: "image", data: match[3] ?? "", mimeType: match[1] ?? mimeType });
					continue;
				}
			}
			text += `\n[image: ${uri}]`;
			continue;
		}
		if (record.type === "resource_link") {
			const uri = typeof record.uri === "string" ? record.uri : "";
			const name = typeof record.name === "string" ? record.name : uri;
			text += `\n[reference: ${name} ${uri}]`;
			continue;
		}
		if (record.type === "resource") {
			const resource = asRecord(record.resource);
			const inner = asRecord(resource.resource);
			if (typeof inner.text === "string") text += `\n${inner.text}`;
		}
	}
	return { text, images };
}
