import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { useStore } from "../state/store";
import { Icon } from "./Icon";
import { IconButton } from "./ui";

export function PromptDialog(): React.JSX.Element | null {
	const { state } = useStore();
	const { t } = useI18n();
	const prompt = state.prompts[0];
	const [value, setValue] = useState("");
	const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
	const titleId = useId();

	useEffect(() => {
		setValue(prompt?.prefill ?? "");
		if (!prompt) return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const frame = requestAnimationFrame(() => ref.current?.focus());
		return () => {
			cancelAnimationFrame(frame);
			previous?.focus();
		};
	}, [prompt?.id]);

	if (!prompt) return null;
	const submit = (): void => prompt.resolve(value.trim().length > 0 ? value : null);
	const inputProps = {
		className: "field w-full bg-bg/60 font-sans text-[13px] leading-6",
		value,
		placeholder: prompt.placeholder,
		onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(event.target.value),
		onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			if (event.key === "Enter" && ((!event.shiftKey && !prompt.multiline) || ((event.ctrlKey || event.metaKey) && prompt.multiline))) {
				event.preventDefault();
				submit();
			}
		},
	};

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget) prompt.resolve(null); }} onKeyDown={(event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				prompt.resolve(null);
			}
		}}>
			<div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5" style={{ boxShadow: "var(--shadow-md)", animation: "menu-in 150ms ease-out" }}>
				<div className="flex items-start gap-3">
					<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Icon name="terminal" size={18} /></span>
					<div className="min-w-0 flex-1 pt-1"><h2 id={titleId} className="text-[14px] font-semibold tracking-[-0.01em]">{prompt.title}</h2><p className="mt-0.5 text-[11px] text-dim">{t("inputNeeded")}</p></div>
					<IconButton icon="x" label={t("cancel")} onClick={() => prompt.resolve(null)} />
				</div>
				<div className="mt-4">{prompt.multiline ? <textarea ref={(element) => { ref.current = element; }} {...inputProps} rows={7} className={`${inputProps.className} resize-y`} /> : <input ref={(element) => { ref.current = element; }} {...inputProps} type="text" />}</div>
				<div className="mt-4 flex items-center justify-between gap-3">
					<span className="hidden text-[10.5px] text-faint sm:block">{prompt.multiline ? t("ctrlEnterSubmit") : t("enterSubmit")}</span>
					<div className="ml-auto flex gap-2"><button type="button" className="btn btn-ghost" onClick={() => prompt.resolve(null)}>{t("cancel")}</button><button type="button" className="btn btn-primary min-w-20" onClick={submit}>{t("continue")}</button></div>
				</div>
			</div>
		</div>
	);
}
