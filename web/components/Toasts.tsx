import { useEffect } from "react";
import { useI18n } from "../lib/i18n";
import { useStore, type Toast } from "../state/store";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./ui";

const icons: Record<Toast["level"], IconName> = { info: "info", warning: "warning", error: "error" };

export function Toasts(): React.JSX.Element {
	const { state, dispatch } = useStore();
	const { t } = useI18n();

	useEffect(() => {
		if (state.toasts.length === 0) return;
		const timers = state.toasts.map((toast) => setTimeout(() => dispatch({ type: "toast/remove", id: toast.id }), 9000));
		return () => { for (const timer of timers) clearTimeout(timer); };
	}, [dispatch, state.toasts]);

	const localize = (message: string): string => {
		if (message.startsWith("Cannot reach the web UI bridge:")) return t("cannotReachBridge", { error: message.slice("Cannot reach the web UI bridge:".length).trim() });
		if (message.startsWith("Startup failed:")) return t("startupFailed", { error: message.slice("Startup failed:".length).trim() });
		if (message === "Context compacted") return t("contextCompacted");
		return message;
	};

	return (
		<div className="pointer-events-none fixed right-4 top-[76px] z-40 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
			{state.toasts.map((toast) => (
				<div key={toast.id} role={toast.level === "error" ? "alert" : "status"} className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-surface p-3 ${toast.level === "error" ? "border-bad/40" : toast.level === "warning" ? "border-warn/40" : "border-line"}`} style={{ boxShadow: "var(--shadow-md)", animation: "toast-in 160ms ease-out" }}>
					<Icon name={icons[toast.level]} size={17} className={`mt-0.5 shrink-0 ${toast.level === "error" ? "text-bad" : toast.level === "warning" ? "text-warn" : "text-accent"}`} />
					<div className="min-w-0 flex-1 break-words pt-px text-[12px] leading-5 text-ink">{localize(toast.message)}</div>
					<IconButton icon="x" iconSize={14} label={t("dismissNotification")} className="-mr-1 -mt-1 h-6 w-6" onClick={() => dispatch({ type: "toast/remove", id: toast.id })} />
				</div>
			))}
		</div>
	);
}
