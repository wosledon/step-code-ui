import { formatCost, formatNumber, truncateMiddle } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useStore } from "../state/store";
import { Icon } from "./Icon";
import { LanguageControl } from "./LanguageControl";
import { ThemeControl } from "./ThemeControl";
import { IconButton } from "./ui";

export interface TopBarProps {
	onCompact: () => void;
	onToggleSidebar: () => void;
}

export function TopBar({ onCompact, onToggleSidebar }: TopBarProps): React.JSX.Element {
	const { state } = useStore();
	const { t } = useI18n();
	const stats = (state.stats ?? {}) as Record<string, unknown>;
	const contextUsage = (stats.contextUsage ?? null) as Record<string, unknown> | null;
	const firstUser = state.messages.find((message) => message.role === "user");
	const title = state.sessionName ?? firstUser?.text ?? t("newConversation");
	const percent = typeof contextUsage?.percent === "number" ? Math.max(0, Math.min(100, contextUsage.percent)) : null;

	return (
		<header className="relative z-20 flex h-16 shrink-0 items-center gap-2 border-b border-line-soft bg-bg/85 px-3 backdrop-blur-xl sm:px-5">
			<IconButton icon="panel" label={t("toggleSidebar")} onClick={onToggleSidebar} aria-expanded={state.sidebarOpen} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<h1 className="min-w-0 truncate text-[13.5px] font-semibold tracking-[-0.01em]" title={title}>{truncateMiddle(title, 90)}</h1>
					{state.streaming && <span className="hidden items-center gap-1.5 text-[10.5px] font-medium text-accent sm:flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />{t("working").replace("…", "")}</span>}
				</div>
				<div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-faint">
					<span>{state.sessionId ? t("sessionId", { id: state.sessionId.slice(0, 8) }) : t("preparingSession")}</span>
					{state.pendingMessages > 0 && <><span>·</span><span>{t("queuedMessages", { count: state.pendingMessages })}</span></>}
				</div>
			</div>

			<div className="flex items-center gap-1 sm:gap-1.5">
				{state.compacting && <span className="chip border-warn/30 bg-warn/10 text-warn"><Icon name="refresh" size={12} className="animate-spin-soft" />{t("compacting")}</span>}
				{contextUsage && (
					<div className="hidden h-9 items-center gap-2.5 rounded-lg px-2.5 md:flex" title={t("contextUsage")}>
						<div className="text-right">
							<div className="text-[10px] leading-tight text-faint">{t("context")}</div>
							<div className="font-mono text-[10.5px] tabular-nums text-dim">{formatNumber(contextUsage.tokens)} / {formatNumber(contextUsage.contextWindow)}</div>
						</div>
						<div className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${percent !== null && percent > 85 ? "bg-warn" : "bg-accent"}`} style={{ width: `${percent ?? 0}%` }} /></div>
						{percent !== null && <span className="w-7 font-mono text-[10.5px] tabular-nums text-dim">{Math.round(percent)}%</span>}
					</div>
				)}
				{typeof stats.cost === "number" && <span className="hidden px-2 font-mono text-[11px] tabular-nums text-dim sm:inline" title={t("sessionCost")}>{formatCost(stats.cost)}</span>}
				<button type="button" className="btn btn-ghost hidden sm:inline-flex" onClick={onCompact} disabled={state.streaming || state.compacting} aria-label={t("compactContext")}><Icon name="compress" size={15} />{t("compact")}</button>
				<IconButton icon="compress" label={t("compactContext")} className="sm:hidden" onClick={onCompact} disabled={state.streaming || state.compacting} />
				<span className="mx-0.5 hidden h-5 w-px bg-line-soft sm:block" />
				<LanguageControl />
				<ThemeControl />
			</div>
		</header>
	);
}
