import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ClientSideConnection, ContentBlock } from "@zed-industries/agent-client-protocol";
import { createBridge } from "./acp/client";
import { Composer, type ComposerHandle } from "./components/Composer";
import { PromptDialog } from "./components/PromptDialog";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { Transcript } from "./components/Transcript";
import { buildCommands } from "./lib/commands";
import { useI18n } from "./lib/i18n";
import { toggleTheme } from "./lib/theme";
import { StoreProvider, useStore, type CommandInfo, type ModelInfo, type SessionSummary } from "./state/store";

const ACP_PROTOCOL_VERSION = 1;
const SESSION_KEY = "step-ui-session";

interface StepStateInfo {
	sessionId: string | null;
	cwd: string;
	sessionFile: string | null;
	sessionName: string | null;
	streaming: boolean;
	compacting: boolean;
	messageCount: number;
	pendingMessageCount: number;
	currentModelId: string;
	thinkingLevel: string;
	thinkingLevels: string[];
	mode: string;
	availableModels: ModelInfo[];
	commands: CommandInfo[];
	stats: Record<string, unknown> | null;
	pinnedSessionId: string | null;
}

function Workspace(): React.JSX.Element {
	const { state, dispatch } = useStore();
	const { t } = useI18n();
	const connection = useRef<ClientSideConnection | null>(null);
	const composer = useRef<ComposerHandle>(null);
	const applyState = useCallback(
		(info: StepStateInfo) => {
			dispatch({
				type: "session/set",
				patch: {
					cwd: info.cwd,
					sessionId: info.sessionId,
					sessionName: info.sessionName,
					streaming: info.streaming,
					compacting: info.compacting,
					pendingMessages: info.pendingMessageCount,
					currentModelId: info.currentModelId,
					thinkingLevel: info.thinkingLevel,
					thinkingLevels: info.thinkingLevels,
					mode: info.mode,
					models: info.availableModels ?? [],
					commands: info.commands ?? [],
					stats: info.stats ?? null,
				},
			});
		},
		[dispatch],
	);

	const refreshSessions = useCallback(async () => {
		const conn = connection.current;
		if (!conn) return;
		try {
			const result = (await conn.extMethod("step/list_sessions", {})) as { sessions?: SessionSummary[] };
			dispatch({ type: "sessions/list", sessions: result.sessions ?? [] });
		} catch {
			dispatch({ type: "sessions/list", sessions: [] });
		}
	}, [dispatch]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			let bridge;
			try {
				bridge = await createBridge(dispatch);
			} catch (err) {
				dispatch({ type: "toast/add", toast: { level: "error", message: `Cannot reach the web UI bridge: ${String(err)}` } });
				return;
			}
			if (cancelled) return;
			connection.current = bridge.conn;
			try {
				await bridge.conn.initialize({
					protocolVersion: ACP_PROTOCOL_VERSION,
					clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
				});
				const info = (await bridge.conn.extMethod("step/get_state", {})) as unknown as StepStateInfo;
				if (cancelled) return;
				dispatch({ type: "session/set", patch: { cwd: info.cwd } });

				const remembered = window.sessionStorage.getItem(SESSION_KEY);
				let loaded = false;
				if (info.pinnedSessionId) {
					await bridge.conn.loadSession({ sessionId: info.pinnedSessionId, cwd: info.cwd, mcpServers: [] });
					loaded = true;
				} else if (remembered) {
					try {
						await bridge.conn.loadSession({ sessionId: remembered, cwd: info.cwd, mcpServers: [] });
						loaded = true;
					} catch {
						loaded = false;
					}
				}
				if (!loaded) {
					await bridge.conn.newSession({ cwd: info.cwd, mcpServers: [] });
				}
				if (cancelled) return;

				const after = (await bridge.conn.extMethod("step/get_state", {})) as unknown as StepStateInfo;
				applyState(after);
				if (after.sessionId) window.sessionStorage.setItem(SESSION_KEY, after.sessionId);
				await bridge.conn.extMethod("step/get_commands", {});
				await refreshSessions();
			} catch (err) {
				dispatch({ type: "toast/add", toast: { level: "error", message: `Startup failed: ${String(err)}` } });
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [applyState, dispatch, refreshSessions]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
				event.preventDefault();
				composer.current?.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		const media = window.matchMedia("(max-width: 1023px)");
		const onChange = (event: MediaQueryListEvent): void => {
			if (event.matches) dispatch({ type: "sidebar/toggle", open: false });
		};
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [dispatch]);

	const send = useCallback(
		(prompt: ContentBlock[]) => {
			const conn = connection.current;
			if (!conn || !state.sessionId) return;
			void (async () => {
				try {
					await conn.prompt({ sessionId: state.sessionId as string, prompt });
					await refreshSessions();
				} catch (err) {
					dispatch({ type: "message/fail", error: String(err) });
					dispatch({ type: "toast/add", toast: { level: "error", message: String(err) } });
				}
			})();
		},
		[dispatch, refreshSessions, state.sessionId],
	);

	const abort = useCallback(() => {
		const conn = connection.current;
		if (!conn || !state.sessionId) return;
		void conn.cancel({ sessionId: state.sessionId }).catch(() => undefined);
	}, [state.sessionId]);

	const selectModel = useCallback(
		(modelId: string) => {
			const conn = connection.current;
			if (!conn || !state.sessionId) return;
			void (async () => {
				try {
					await conn.setSessionModel({ sessionId: state.sessionId as string, modelId });
					dispatch({ type: "session/set", patch: { currentModelId: modelId } });
				} catch (err) {
					dispatch({ type: "toast/add", toast: { level: "error", message: String(err) } });
				}
			})();
		},
		[dispatch, state.sessionId],
	);

	const selectThinking = useCallback(
		(level: string) => {
			const conn = connection.current;
			if (!conn) return;
			void (async () => {
				try {
					await conn.extMethod("step/set_thinking_level", { level, sessionId: state.sessionId });
					dispatch({ type: "session/set", patch: { thinkingLevel: level } });
				} catch (err) {
					dispatch({ type: "toast/add", toast: { level: "error", message: String(err) } });
				}
			})();
		},
		[dispatch, state.sessionId],
	);

	const selectMode = useCallback(
		(modeId: string) => {
			const conn = connection.current;
			if (!conn || !state.sessionId) return;
			void (async () => {
				try {
					await conn.setSessionMode({ sessionId: state.sessionId as string, modeId });
					dispatch({ type: "session/set", patch: { mode: modeId } });
				} catch (err) {
					dispatch({ type: "toast/add", toast: { level: "error", message: String(err) } });
				}
			})();
		},
		[dispatch, state.sessionId],
	);

	const newSession = useCallback(() => {
		const conn = connection.current;
		if (!conn) return;
		void (async () => {
			try {
				dispatch({ type: "session/set", patch: { messages: [], tools: [], items: [], sessionName: null } });
				const result = await conn.newSession({ cwd: state.cwd, mcpServers: [] });
				window.sessionStorage.setItem(SESSION_KEY, result.sessionId);
				const info = (await conn.extMethod("step/get_state", {})) as unknown as StepStateInfo;
				applyState(info);
				await conn.extMethod("step/get_commands", {});
				await refreshSessions();
				composer.current?.focus();
			} catch (err) {
				dispatch({ type: "toast/add", toast: { level: "error", message: String(err) } });
			}
		})();
	}, [applyState, dispatch, refreshSessions, state.cwd]);

	const loadSession = useCallback(
		(sessionId: string) => {
			const conn = connection.current;
			if (!conn || sessionId === state.sessionId) return;
			void (async () => {
				try {
					dispatch({ type: "session/set", patch: { messages: [], tools: [], items: [], sessionName: null } });
					await conn.loadSession({ sessionId, cwd: state.cwd, mcpServers: [] });
					window.sessionStorage.setItem(SESSION_KEY, sessionId);
					const info = (await conn.extMethod("step/get_state", {})) as unknown as StepStateInfo;
					applyState(info);
					await refreshSessions();
				} catch (err) {
					dispatch({ type: "toast/add", toast: { level: "error", message: String(err) } });
				}
			})();
		},
		[applyState, dispatch, refreshSessions, state.cwd, state.sessionId],
	);

	const compact = useCallback(() => {
		const conn = connection.current;
		if (!conn) return;
		void (async () => {
			try {
				await conn.extMethod("step/compact", { sessionId: state.sessionId });
				dispatch({ type: "toast/add", toast: { level: "info", message: "Context compacted" } });
			} catch (err) {
				dispatch({ type: "toast/add", toast: { level: "error", message: String(err) } });
			}
		})();
	}, [dispatch, state.sessionId]);

	const toggleSidebar = useCallback(() => dispatch({ type: "sidebar/toggle" }), [dispatch]);
	const openSidebar = useCallback(() => dispatch({ type: "sidebar/toggle", open: true }), [dispatch]);
	const closeSidebar = useCallback(() => dispatch({ type: "sidebar/toggle", open: false }), [dispatch]);

	const exportSession = useCallback(() => {
		const conn = connection.current;
		const sessionId = state.sessionId;
		if (!conn || !sessionId) return;
		void (async () => {
			try {
				const path = `${state.cwd.replace(/[/\\]$/, "")}/step-session-${sessionId.slice(0, 8)}.html`;
				await conn.extMethod("step/export_html", { sessionId, path });
				dispatch({ type: "toast/add", toast: { level: "info", message: t("commandExported", { path }) } });
			} catch (err) {
				dispatch({ type: "toast/add", toast: { level: "error", message: String(err) } });
			}
		})();
	}, [dispatch, state.cwd, state.sessionId, t]);

	const uiCommands = useMemo(
		() =>
			buildCommands(
				state.commands,
				{
					newSession,
					compact,
					openModel: () => composer.current?.openSelect("model"),
					openThinking: () => composer.current?.openSelect("thinking"),
					toggleTheme: () => {
						const next = toggleTheme();
						dispatch({ type: "toast/add", toast: { level: "info", message: t("themeSwitched", { theme: t(next === "dark" ? "themeDarkName" : "themeLightName") }) } });
					},
					openSessions: () => dispatch({ type: "sessions/focusSearch" }),
					exportSession,
					help: () => dispatch({ type: "toast/add", toast: { level: "info", message: t("commandHelp") } }),
				},
				t,
			),
		[compact, dispatch, exportSession, newSession, state.commands, t],
	);

	return (
		<div className="flex h-full overflow-hidden bg-bg">
			<Sidebar
				open={state.sidebarOpen}
				onOpen={openSidebar}
				onClose={closeSidebar}
				onNewSession={newSession}
				onLoadSession={loadSession}
				onRefreshSessions={refreshSessions}
				focusSearchSignal={state.sessionSearchFocus}
			/>
			<main className="relative flex min-w-0 flex-1 flex-col">
				<TopBar onCompact={compact} onToggleSidebar={toggleSidebar} />
				<Transcript onSuggestion={(text) => composer.current?.setDraft(text)} />
				<Composer
					ref={composer}
					streaming={state.streaming}
					disabled={!state.sessionId}
					commands={uiCommands}
					models={state.models}
					currentModelId={state.currentModelId}
					thinkingLevel={state.thinkingLevel}
					thinkingLevels={state.thinkingLevels}
					mode={state.mode}
					modes={state.modes}
					onSelectModel={selectModel}
					onSelectThinking={selectThinking}
					onSelectMode={selectMode}
					onSend={send}
					onAbort={abort}
				/>
			</main>
			<Toasts />
			<PromptDialog />
		</div>
	);
}

export default function App(): React.JSX.Element {
	return (
		<StoreProvider>
			<Workspace />
		</StoreProvider>
	);
}
