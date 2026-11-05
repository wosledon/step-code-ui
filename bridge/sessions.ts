/** Per-session UI state shared by the ACP agent implementation. */
import type { AvailableCommand, ModelInfo, SessionMode } from "@zed-industries/agent-client-protocol";

export type UiMode = "default" | "auto" | "deny";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const UI_MODES: SessionMode[] = [
	{
		id: "default",
		name: "Ask for approval",
		description: "Tool calls wait for your confirmation in the web UI",
	},
	{
		id: "auto",
		name: "Auto approve",
		description: "The bridge approves tool calls automatically",
	},
	{
		id: "deny",
		name: "Auto deny",
		description: "The bridge rejects tool calls automatically",
	},
];

export interface SessionState {
	/** ACP session id (matches the step session id). */
	sessionId: string;
	cwd: string;
	sessionFile?: string;
	mode: UiMode;
	currentModelId: string;
	availableModels: ModelInfo[];
	thinkingLevel: string;
	thinkingLevels: string[];
	commands: AvailableCommand[];
	streaming: boolean;
	/** Number of tool calls auto-approved because mode is "auto". */
	autoApproved: number;
	createdAt: number;
}

export class SessionRegistry {
	private readonly sessions = new Map<string, SessionState>();

	create(state: Omit<SessionState, "mode" | "autoApproved" | "createdAt" | "commands"> & Partial<SessionState>): SessionState {
		const session: SessionState = {
			commands: [],
			mode: "default",
			autoApproved: 0,
			createdAt: Date.now(),
			...state,
		};
		this.sessions.set(session.sessionId, session);
		return session;
	}

	get(sessionId: string): SessionState | undefined {
		return this.sessions.get(sessionId);
	}

	require(sessionId: string): SessionState {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`Unknown session: ${sessionId}`);
		return session;
	}

	all(): SessionState[] {
		return [...this.sessions.values()];
	}

	delete(sessionId: string): void {
		this.sessions.delete(sessionId);
	}
}

/** Serializes async work so only one prompt turn runs at a time. */
export class Mutex {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.tail.then(task, task);
		this.tail = result.catch(() => undefined);
		return result;
	}
}

export function isThinkingLevel(value: string): value is ThinkingLevel {
	return (THINKING_LEVELS as readonly string[]).includes(value);
}

export function modeFromId(id: string): UiMode | undefined {
	return id === "default" || id === "auto" || id === "deny" ? id : undefined;
}
