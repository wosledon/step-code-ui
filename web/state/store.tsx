import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	thinking: string;
	streaming: boolean;
	failed?: boolean;
}

export type ToolContent =
	| { type: "text"; text: string }
	| { type: "diff"; path: string; oldText: string | null; newText: string }
	| { type: "patch"; path: string; patch: string };

export interface ToolCallState {
	id: string;
	title: string;
	kind: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	rawInput?: unknown;
	rawOutput?: unknown;
	content: ToolContent[];
	locations: Array<{ path: string; line?: number | null }>;
	expanded: boolean;
}

export interface PermissionState {
	id: string;
	sessionId: string;
	toolCallId: string;
	title: string;
	kind: string;
	note?: string;
	options: Array<{ optionId: string; name: string; kind: string }>;
	resolve: (optionId: string | null) => void;
}

export interface PromptState {
	id: string;
	title: string;
	placeholder: string;
	prefill: string;
	multiline: boolean;
	resolve: (value: string | null) => void;
}

export interface Toast {
	id: string;
	level: "info" | "warning" | "error";
	message: string;
}

export interface ModeInfo {
	id: string;
	name: string;
	description?: string | null;
}

export interface ModelInfo {
	modelId: string;
	name: string;
	description?: string | null;
}

export interface CommandInfo {
	name: string;
	description: string;
	source?: string;
}

export interface SessionSummary {
	sessionId: string;
	path: string;
	cwd?: string | null;
	title?: string | null;
	modifiedAt: number;
}

export interface BridgeState {
	connection: "connecting" | "open" | "closed" | "error";
	error: string | null;
	cwd: string;
	sessionId: string | null;
	sessionName: string | null;
	mode: string;
	modes: ModeInfo[];
	models: ModelInfo[];
	currentModelId: string;
	thinkingLevel: string;
	thinkingLevels: string[];
	commands: CommandInfo[];
	streaming: boolean;
	pendingMessages: number;
	compacting: boolean;
	messages: ChatMessage[];
	tools: ToolCallState[];
	/** Chronological transcript order (messages and tool calls interleaved). */
	items: Array<{ kind: "message" | "tool"; id: string }>;
	permissions: PermissionState[];
	prompts: PromptState[];
	toasts: Toast[];
	status: Array<{ key: string; text: string }>;
	widgets: Array<{ key: string; lines: string[] }>;
	stats: Record<string, unknown> | null;
	sessions: SessionSummary[];
	showSessions: boolean;
	sidebarOpen: boolean;
	/** Incremented to focus the sidebar session search (used by /sessions). */
	sessionSearchFocus: number;
}

export const initialState: BridgeState = {
	connection: "connecting",
	error: null,
	cwd: "",
	sessionId: null,
	sessionName: null,
	mode: "default",
	modes: [],
	models: [],
	currentModelId: "",
	thinkingLevel: "off",
	thinkingLevels: [],
	commands: [],
	streaming: false,
	pendingMessages: 0,
	compacting: false,
	messages: [],
	tools: [],
	items: [],
	permissions: [],
	prompts: [],
	toasts: [],
	status: [],
	widgets: [],
	stats: null,
	sessions: [],
	showSessions: false,
	sidebarOpen: typeof window === "undefined" || window.innerWidth >= 1024,
	sessionSearchFocus: 0,
};

export type Action =
	| { type: "connection/status"; status: BridgeState["connection"]; error?: string }
	| { type: "session/set"; patch: Partial<BridgeState> }
	| { type: "message/user"; text: string }
	| { type: "message/assistant-start" }
	| { type: "message/assistant-delta"; delta: string }
	| { type: "message/thinking-delta"; delta: string }
	| { type: "message/assistant-end" }
	| { type: "message/fail"; error: string }
	| { type: "tool/upsert"; tool: Partial<ToolCallState> & { id: string } }
	| { type: "tool/toggle"; id: string }
	| { type: "permission/add"; permission: PermissionState }
	| { type: "permission/remove"; id: string }
	| { type: "prompt/add"; prompt: PromptState }
	| { type: "prompt/remove"; id: string }
	| { type: "toast/add"; toast: Omit<Toast, "id"> }
	| { type: "toast/remove"; id: string }
	| { type: "status/set"; key: string; text: string | null }
	| { type: "widget/set"; key: string; lines: string[] }
	| { type: "streaming/set"; streaming: boolean }
	| { type: "sessions/list"; sessions: SessionSummary[] }
	| { type: "sessions/toggle"; open?: boolean }
	| { type: "sidebar/toggle"; open?: boolean }
	| { type: "sessions/focusSearch" };

let sequence = 0;
function nextId(prefix: string): string {
	sequence += 1;
	return `${prefix}-${sequence}`;
}

function lastAssistant(state: BridgeState): ChatMessage | undefined {
	for (let i = state.messages.length - 1; i >= 0; i -= 1) {
		if (state.messages[i].role === "assistant") return state.messages[i];
	}
	return undefined;
}

function patchAssistant(state: BridgeState, patch: (message: ChatMessage) => ChatMessage): ChatMessage[] {
	const index = [...state.messages].reverse().findIndex((message) => message.role === "assistant");
	if (index < 0) return state.messages;
	const realIndex = state.messages.length - 1 - index;
	const messages = [...state.messages];
	messages[realIndex] = patch(messages[realIndex]);
	return messages;
}

export function reducer(state: BridgeState, action: Action): BridgeState {
	switch (action.type) {
		case "connection/status":
			return { ...state, connection: action.status, error: action.error ?? null };
		case "session/set":
			return { ...state, ...action.patch };
		case "message/user": {
			const id = nextId("user");
			return {
				...state,
				messages: [
					...state.messages.map((message) => (message.streaming ? { ...message, streaming: false } : message)),
					{ id, role: "user", text: action.text, thinking: "", streaming: false },
				],
				items: [...state.items, { kind: "message", id }],
			};
		}
		case "message/assistant-start": {
			const existing = lastAssistant(state);
			if (existing?.streaming) return state;
			const id = nextId("assistant");
			return {
				...state,
				messages: [
					...state.messages.map((message) => ({ ...message, streaming: false })),
					{ id, role: "assistant", text: "", thinking: "", streaming: true },
				],
				items: [...state.items, { kind: "message", id }],
			};
		}
		case "message/assistant-delta": {
			if (!lastAssistant(state)?.streaming) {
				state = reducer(state, { type: "message/assistant-start" });
			}
			return {
				...state,
				messages: patchAssistant(state, (message) => ({ ...message, text: message.text + action.delta })),
			};
		}
		case "message/thinking-delta": {
			if (!lastAssistant(state)?.streaming) {
				state = reducer(state, { type: "message/assistant-start" });
			}
			return {
				...state,
				messages: patchAssistant(state, (message) => ({
					...message,
					thinking: message.thinking + action.delta,
				})),
			};
		}
		case "message/assistant-end":
			return { ...state, messages: state.messages.map((message) => ({ ...message, streaming: false })) };
		case "message/fail":
			return {
				...state,
				messages: patchAssistant(state, (message) => ({ ...message, failed: true, streaming: false })),
			};
		case "tool/upsert": {
			const index = state.tools.findIndex((tool) => tool.id === action.tool.id);
			const hasDiff = action.tool.content?.some((content) => content.type === "diff" || content.type === "patch") ?? false;
			if (index < 0) {
				const tool: ToolCallState = {
					title: action.tool.title ?? "Tool call",
					kind: action.tool.kind ?? "other",
					status: action.tool.status ?? "pending",
					content: [],
					locations: [],
					...action.tool,
					expanded: action.tool.expanded ?? hasDiff,
				};
				return { ...state, tools: [...state.tools, tool], items: [...state.items, { kind: "tool", id: tool.id }] };
			}
			const tools = [...state.tools];
			const hadDiff = tools[index].content.some((content) => content.type === "diff" || content.type === "patch");
			tools[index] = { ...tools[index], ...action.tool, expanded: action.tool.expanded ?? (tools[index].expanded || (hasDiff && !hadDiff)) };
			return { ...state, tools };
		}
		case "tool/toggle":
			return {
				...state,
				tools: state.tools.map((tool) => (tool.id === action.id ? { ...tool, expanded: !tool.expanded } : tool)),
			};
		case "permission/add":
			return { ...state, permissions: [...state.permissions, action.permission] };
		case "permission/remove":
			return { ...state, permissions: state.permissions.filter((permission) => permission.id !== action.id) };
		case "prompt/add":
			return { ...state, prompts: [...state.prompts, action.prompt] };
		case "prompt/remove":
			return { ...state, prompts: state.prompts.filter((prompt) => prompt.id !== action.id) };
		case "toast/add":
			return { ...state, toasts: [...state.toasts, { ...action.toast, id: nextId("toast") }] };
		case "toast/remove":
			return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };
		case "status/set": {
			if (action.text === null) {
				return { ...state, status: state.status.filter((entry) => entry.key !== action.key) };
			}
			const existing = state.status.some((entry) => entry.key === action.key);
			return {
				...state,
				status: existing
					? state.status.map((entry) => (entry.key === action.key ? { ...entry, text: action.text as string } : entry))
					: [...state.status, { key: action.key, text: action.text as string }],
			};
		}
		case "widget/set":
			return {
				...state,
				widgets: [
					...state.widgets.filter((widget) => widget.key !== action.key),
					...(action.lines.length > 0 ? [{ key: action.key, lines: action.lines }] : []),
				],
			};
		case "streaming/set":
			return { ...state, streaming: action.streaming };
		case "sessions/list":
			return { ...state, sessions: action.sessions };
		case "sessions/toggle":
			return { ...state, showSessions: action.open ?? !state.showSessions };
		case "sidebar/toggle":
			return { ...state, sidebarOpen: action.open ?? !state.sidebarOpen };
		case "sessions/focusSearch":
			return { ...state, sidebarOpen: true, sessionSearchFocus: state.sessionSearchFocus + 1 };
		default:
			return state;
	}
}

interface Store {
	state: BridgeState;
	dispatch: Dispatch<Action>;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
	const [state, dispatch] = useReducer(reducer, initialState);
	return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
	const store = useContext(StoreContext);
	if (!store) throw new Error("useStore must be used inside StoreProvider");
	return store;
}
