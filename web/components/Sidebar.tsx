import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n, type Language, type TranslationKey } from "../lib/i18n";
import { useStore, type SessionSummary } from "../state/store";
import { Icon } from "./Icon";
import { BrandMark, IconButton } from "./ui";

export interface SidebarProps {
	onNewSession: () => void;
	onLoadSession: (sessionId: string) => void;
	onRefreshSessions: () => Promise<void> | void;
	open: boolean;
	onOpen: () => void;
	onClose: () => void;
	/** Incremented by /sessions to focus the search field. */
	focusSearchSignal?: number;
}

function relativeTime(timestamp: number, language: Language): string {
	const diff = Math.max(0, Date.now() - timestamp);
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return language === "zh-CN" ? "刚刚" : "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	return new Date(timestamp).toLocaleDateString(language, { month: "short", day: "numeric" });
}

function workspaceName(cwd: string): string {
	if (!cwd) return "";
	const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	return normalized.split("/").pop() || normalized;
}

export function Sidebar({ onNewSession, onLoadSession, onRefreshSessions, open, onOpen, onClose, focusSearchSignal = 0 }: SidebarProps): React.JSX.Element {
	const { state } = useStore();
	const { language, t } = useI18n();
	const [filter, setFilter] = useState("");
	const [refreshing, setRefreshing] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);

	const sessions = useMemo(() => {
		const scoped = state.sessions.filter((session) => !session.cwd || session.cwd === state.cwd);
		const query = filter.trim().toLowerCase();
		return scoped.filter((session) => !query || `${session.title ?? ""} ${session.sessionId}`.toLowerCase().includes(query)).sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 60);
	}, [filter, state.cwd, state.sessions]);

	useEffect(() => {
		if (focusSearchSignal > 0) searchRef.current?.focus();
	}, [focusSearchSignal]);

	const groups = useMemo(() => {
		const startOfDay = new Date();
		startOfDay.setHours(0, 0, 0, 0);
		const weekAgo = startOfDay.getTime() - 6 * 24 * 60 * 60 * 1000;
		const result: Array<{ label: TranslationKey; sessions: SessionSummary[] }> = [
			{ label: "today", sessions: [] }, { label: "previous7Days", sessions: [] }, { label: "older", sessions: [] },
		];
		for (const session of sessions) {
			const group = session.modifiedAt >= startOfDay.getTime() ? 0 : session.modifiedAt >= weekAgo ? 1 : 2;
			result[group].sessions.push(session);
		}
		return result.filter((group) => group.sessions.length > 0);
	}, [sessions]);

	useEffect(() => { if (open) void onRefreshSessions(); }, [open, onRefreshSessions]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				onOpen();
				requestAnimationFrame(() => searchRef.current?.focus());
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onOpen]);

	const refresh = async (): Promise<void> => {
		if (refreshing) return;
		setRefreshing(true);
		try { await onRefreshSessions(); } finally { setRefreshing(false); }
	};
	const connectionLabel = state.connection === "open" ? t("connected") : state.connection === "connecting" ? t("connecting") : t("disconnected");

	return (
		<>
			{open && <button type="button" aria-label={t("closeSidebar")} className="fixed inset-0 z-20 cursor-default bg-black/35 backdrop-blur-[2px] lg:hidden" onClick={onClose} />}
			<aside aria-label={t("conversations")} className={`fixed inset-y-0 left-0 z-30 flex shrink-0 flex-col overflow-hidden border-r border-line bg-sidebar transition-[width,transform,opacity] duration-200 ease-out lg:static lg:z-auto ${open ? "w-[276px] min-w-[276px] translate-x-0 opacity-100" : "pointer-events-none w-[276px] min-w-[276px] -translate-x-full opacity-0 lg:w-0 lg:min-w-0 lg:border-r-0"}`}>
				<div className="flex h-full w-[276px] min-w-[276px] flex-col">
					<div className="flex h-16 items-center gap-2.5 px-4">
						<BrandMark size={31} />
						<div className="min-w-0 flex-1"><div className="text-[14px] font-semibold tracking-[-0.02em]">StepCode</div><div className="text-[10px] font-medium uppercase tracking-[0.13em] text-faint">{t("codingAgent")}</div></div>
						<IconButton icon="panel" label={t("closeSidebar")} className="lg:hidden" onClick={onClose} />
					</div>
					<div className="px-3 pb-3">
						<div className="mb-3 flex h-9 items-center gap-2 rounded-lg border border-line-soft bg-surface/45 px-2.5 text-dim"><Icon name="folder" size={15} className="shrink-0 text-faint" /><span className="truncate text-xs font-medium text-ink" title={state.cwd}>{workspaceName(state.cwd) || t("workspace")}</span><span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-ok/70" /></div>
						<button type="button" className="btn btn-primary w-full" onClick={onNewSession}><Icon name="plus" size={16} />{t("newConversation")}</button>
					</div>
					<div className="px-3 pb-3">
						<div className="flex h-9 items-center gap-2 rounded-lg border border-transparent bg-surface-2/75 px-2.5 transition-colors focus-within:border-accent/50 focus-within:bg-surface">
							<Icon name="search" size={15} className="shrink-0 text-faint" />
							<input ref={searchRef} className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-dim" placeholder={t("searchConversations")} aria-label={t("searchConversations")} value={filter} onChange={(event) => setFilter(event.target.value)} onKeyDown={(event) => {
								if (event.key === "Escape" && filter) { event.stopPropagation(); setFilter(""); }
							}} />
							{filter ? <IconButton icon="x" iconSize={13} label={t("clearSearch")} className="-mr-1 h-6 w-6" onClick={() => setFilter("")} /> : <kbd className="kbd">Ctrl K</kbd>}
						</div>
					</div>
					<div className="flex items-center justify-between px-4 pb-2"><span className="section-label px-0">{t("conversations")}</span><IconButton icon="refresh" iconSize={14} label={t("refreshConversations")} className={`h-6 w-6 ${refreshing ? "animate-spin-soft" : ""}`} onClick={() => void refresh()} disabled={refreshing} /></div>
					<div className="flex-1 overflow-y-auto px-2 pb-3">
						{groups.map((group) => <div key={group.label} className="mb-3"><div className="px-2.5 pb-1 pt-1 text-[10.5px] font-medium text-faint">{t(group.label)}</div><div className="space-y-0.5">{group.sessions.map((session) => <SessionRow key={session.sessionId} session={session} language={language} active={session.sessionId === state.sessionId} onSelect={() => { onLoadSession(session.sessionId); if (window.innerWidth < 1024) onClose(); }} />)}</div></div>)}
						{sessions.length === 0 && <div className="px-4 py-10 text-center"><Icon name={filter ? "search" : "code"} size={22} className="mx-auto text-faint" /><p className="mt-2 text-xs text-dim">{filter ? t("noConversationMatches") : t("conversationsEmpty")}</p>{filter && <button type="button" className="mt-2 text-xs font-medium text-accent hover:underline" onClick={() => setFilter("")}>{t("clearSearch")}</button>}</div>}
					</div>
					{(state.status.length > 0 || state.streaming || state.pendingMessages > 0) && <div className="mx-3 mb-2 space-y-1 rounded-lg border border-line-soft bg-surface/50 px-2.5 py-2 text-[11px] text-dim">{state.status.map((entry) => <div key={entry.key} className="truncate" title={entry.text}>{entry.text}</div>)}{state.streaming && <div className="flex items-center gap-2 text-accent"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />{t("working")}</div>}{state.pendingMessages > 0 && <div>{t("queuedMessages", { count: state.pendingMessages })}</div>}</div>}
					<div className="border-t border-line-soft px-4 py-3"><div className="flex items-center gap-2 text-[11px]"><span className={`h-1.5 w-1.5 rounded-full ${state.connection === "open" ? "bg-ok" : state.connection === "connecting" ? "bg-warn" : "bg-bad"}`} /><span className="text-dim">{connectionLabel}</span><span className="ml-auto max-w-[140px] truncate font-mono text-[10px] text-faint" title={state.currentModelId}>{state.currentModelId || t("noModel")}</span></div></div>
				</div>
			</aside>
		</>
	);
}

function SessionRow({ session, language, active, onSelect }: { session: SessionSummary; language: Language; active: boolean; onSelect: () => void }): React.JSX.Element {
	const { t } = useI18n();
	return (
		<button type="button" onClick={onSelect} aria-current={active ? "page" : undefined} className={`group relative w-full rounded-lg px-2.5 py-2 text-left transition-colors ${active ? "bg-accent-soft" : "hover:bg-surface-2/80"}`}>
			{active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
			<div className={`line-clamp-1 text-[12px] leading-5 ${active ? "font-medium text-ink" : "text-ink/85"}`}>{session.title || t("untitledConversation")}</div>
			<div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-faint"><span className="font-mono">{session.sessionId.slice(0, 8)}</span><span>·</span><span>{relativeTime(session.modifiedAt, language)}</span>{active && <Icon name="check" size={12} className="ml-auto text-accent" />}</div>
		</button>
	);
}
