import { useI18n, type TranslationKey } from "../lib/i18n";
import type { PermissionState } from "../state/store";
import { Icon } from "./Icon";

const KIND_LABELS: Record<string, TranslationKey> = {
	allow_once: "allowOnce",
	allow_always: "allowAlways",
	reject_once: "rejectOnce",
	reject_always: "rejectAlways",
};

export function PermissionCard({ permission }: { permission: PermissionState }): React.JSX.Element {
	const { t } = useI18n();
	return (
		<section className="overflow-hidden rounded-xl border border-warn/35 bg-warn/[0.055] sm:ml-10" aria-label={t("approvalRequired")}>
			<div className="flex items-start gap-3 p-4">
				<span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-warn/25 bg-warn/10 text-warn"><Icon name="shield" size={17} /></span>
				<div className="min-w-0 flex-1">
					<div className="text-[9.5px] font-semibold uppercase tracking-[0.13em] text-warn">{t("approvalRequired")}</div>
					<div className="mt-1 text-[13px] font-semibold text-ink">{permission.title}</div>
					{permission.note && <div className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-dim">{permission.note}</div>}
				</div>
			</div>
			<div className="flex flex-wrap gap-2 border-t border-warn/20 px-4 py-3">
				{permission.options.map((option, index) => {
					const allow = option.kind === "allow_once" || option.kind === "allow_always";
					const labelKey = KIND_LABELS[option.kind];
					return (
						<button key={option.optionId} type="button" className={`btn ${allow && index === 0 ? "btn-primary" : allow ? "text-ok hover:border-ok/40 hover:bg-ok/10" : "btn-danger"}`} onClick={() => permission.resolve(option.optionId)}>
							{allow && <Icon name="check" size={14} />}{labelKey ? t(labelKey) : option.name}
						</button>
					);
				})}
				<button type="button" className="btn btn-ghost ml-auto" onClick={() => permission.resolve(null)}>{t("cancelTurn")}</button>
			</div>
		</section>
	);
}
