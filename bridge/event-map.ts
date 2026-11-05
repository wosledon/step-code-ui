/** Translation layer: step RPC events -> ACP session updates. */
import type {
	ContentBlock,
	SessionNotification,
	ToolCallContent,
	ToolCallLocation,
	ToolKind,
} from "@zed-industries/agent-client-protocol";
import type { RpcEvent } from "./rpc-client.js";

/** The SDK does not export an alias for the update union; derive it. */
export type SessionUpdate = NonNullable<SessionNotification["update"]>;

const TOOL_KINDS: Record<string, ToolKind> = {
	read: "read",
	read_file: "read",
	grep: "search",
	find: "search",
	glob: "search",
	ls: "read",
	list: "read",
	edit: "edit",
	write: "edit",
	write_file: "edit",
	apply_patch: "edit",
	multi_edit: "edit",
	bash: "execute",
	powershell: "execute",
	shell: "execute",
	spawn: "execute",
	todo: "other",
	ask_question: "other",
	web_search: "fetch",
	webfetch: "fetch",
	fetch: "fetch",
};

export function toolKindFor(toolName: string): ToolKind {
	return TOOL_KINDS[toolName] ?? "other";
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
	return (value ?? {}) as Record<string, unknown>;
}

function truncate(text: string, max = 120): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Human readable one-line title, e.g. `read src/index.ts`. */
export function toolTitleFor(toolName: string, args: unknown): string {
	const record = (args ?? {}) as Record<string, unknown>;
	const target =
		firstString(record.path, record.file, record.filePath, record.file_path, record.filename, record.pattern, record.query, record.command) ??
		"";
	const label = target ? ` ${truncate(target, 100)}` : "";
	return `${toolName}${label}`;
}

export function locationsFor(args: unknown): ToolCallLocation[] {
	const record = (args ?? {}) as Record<string, unknown>;
	const path = firstString(record.path, record.file, record.filePath, record.file_path, record.filename);
	if (!path) return [];
	const line = typeof record.line === "number" ? record.line : typeof record.offset === "number" ? record.offset : undefined;
	const location: ToolCallLocation = { path };
	if (typeof line === "number") location.line = line;
	return [location];
}

function textOf(block: unknown): string | undefined {
	if (typeof block === "string") return block;
	const record = block as Record<string, unknown> | null;
	if (record && typeof record.text === "string") return record.text;
	return undefined;
}

/** Convert a tool result payload into ACP tool call content. */
export function toolResultContent(result: unknown, isError: boolean): ToolCallContent[] {
	const record = (result ?? {}) as Record<string, unknown>;
	const blocks = Array.isArray(record.content) ? record.content : [];
	const content: ToolCallContent[] = [];
	let text = "";
	for (const block of blocks) {
		const value = textOf(block);
		if (value !== undefined) text += value;
	}
	if (text.length === 0 && typeof record.text === "string") text = record.text;
	if (text.length > 0) {
		content.push({ type: "content", content: { type: "text", text: truncate(text, 20000) } });
	}
	const details = (record.details ?? {}) as Record<string, unknown>;
	const diff = diffFromDetails(details, record);
	if (diff) content.push(diff);
	if (content.length === 0) {
		const fallback = JSON.stringify(result ?? {});
		content.push({ type: "content", content: { type: "text", text: truncate(fallback, 4000) } });
	}
	if (isError && content.length > 0) {
		// Keep errors visible even when the agent produced no text payload.
		const first = content[0];
		if (first.type === "content" && first.content.type === "text" && !first.content.text.toLowerCase().startsWith("error")) {
			content.unshift({ type: "content", content: { type: "text", text: "Tool call failed" } });
		}
	}
	return content;
}

/** Extract a diff payload when the tool result carries one. */
function diffFromDetails(details: Record<string, unknown>, result: Record<string, unknown>): ToolCallContent | null {
	const path = firstString(details.path, result.path);
	if (!path) return null;
	const newText = firstString(details.newText, details.newString, details.new_string, details.content);
	if (newText === undefined) return null;
	const oldText = firstString(details.oldText, details.oldString, details.old_string) ?? null;
	return { type: "diff", path, newText, oldText };
}

function textChunk(text: string): ContentBlock {
	return { type: "text", text };
}

interface AssistantDelta {
	type?: string;
	delta?: string;
	contentIndex?: number;
	id?: string;
	toolName?: string;
	content?: string;
	toolCall?: unknown;
}

/** `message_update` -> streaming chunk updates. */
export function mapMessageUpdate(event: RpcEvent): SessionUpdate | null {
	const delta = (event.assistantMessageEvent ?? {}) as AssistantDelta;
	switch (delta.type) {
		case "text_delta":
			return { sessionUpdate: "agent_message_chunk", content: textChunk(delta.delta ?? "") };
		case "thinking_delta":
			return { sessionUpdate: "agent_thought_chunk", content: textChunk(delta.delta ?? "") };
		default:
			return null;
	}
}

/** `message_start` / `message_end` for the user role -> user message echo. */
export function mapUserMessage(event: RpcEvent): SessionUpdate | null {
	const message = (event.message ?? {}) as Record<string, unknown>;
	if (message.role !== "user") return null;
	const blocks = Array.isArray(message.content) ? message.content : [];
	let text = "";
	for (const block of blocks) {
		const value = textOf(block);
		if (value !== undefined) text += value;
	}
	if (text.length === 0) return null;
	return { sessionUpdate: "user_message_chunk", content: textChunk(text) };
}

export function mapToolExecutionStart(event: RpcEvent): SessionUpdate {
	const toolName = String(event.toolName ?? "tool");
	const args = event.args ?? {};
	return {
		sessionUpdate: "tool_call",
		toolCallId: String(event.toolCallId ?? ""),
		title: toolTitleFor(toolName, args),
		kind: toolKindFor(toolName),
		status: "pending",
		rawInput: asRecord(args),
		locations: locationsFor(args),
	};
}

export function mapToolExecutionUpdate(event: RpcEvent): SessionUpdate | null {
	const partial = event.partialResult as Record<string, unknown> | undefined;
	if (!partial) return null;
	const content = toolResultContent(partial, false);
	return {
		sessionUpdate: "tool_call_update",
		toolCallId: String(event.toolCallId ?? ""),
		status: "in_progress",
		content,
	};
}

export function mapToolExecutionEnd(event: RpcEvent): SessionUpdate {
	const isError = event.isError === true;
	return {
		sessionUpdate: "tool_call_update",
		toolCallId: String(event.toolCallId ?? ""),
		status: isError ? "failed" : "completed",
		content: toolResultContent(event.result, isError),
		rawOutput: asRecord(event.result),
	};
}

/** Full text of an assistant message, used when replaying a loaded session. */
export function assistantText(message: unknown): string {
	const record = (message ?? {}) as Record<string, unknown>;
	const blocks = Array.isArray(record.content) ? record.content : [];
	let text = "";
	for (const block of blocks) {
		const value = textOf(block);
		if (value !== undefined) text += value;
	}
	return text;
}

export function userText(message: unknown): string {
	return assistantText(message);
}

export function toolCallsOf(message: unknown): Array<{ id: string; name: string; args: unknown }> {
	const record = (message ?? {}) as Record<string, unknown>;
	const blocks = Array.isArray(record.content) ? record.content : [];
	const calls: Array<{ id: string; name: string; args: unknown }> = [];
	for (const block of blocks) {
		const item = block as Record<string, unknown>;
		if (item?.type === "toolCall" && typeof item.id === "string") {
			calls.push({ id: item.id, name: String(item.name ?? "tool"), args: item.arguments ?? {} });
		}
	}
	return calls;
}

export function thinkingOf(message: unknown): string {
	const record = (message ?? {}) as Record<string, unknown>;
	const blocks = Array.isArray(record.content) ? record.content : [];
	let text = "";
	for (const block of blocks) {
		const item = block as Record<string, unknown>;
		if (item?.type === "thinking" && typeof item.thinking === "string") text += item.thinking;
	}
	return text;
}
