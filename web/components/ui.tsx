import { useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent } from "react";
import { useI18n } from "../lib/i18n";
import { Icon, type IconName } from "./Icon";

export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }): React.JSX.Element {
	return <span className={`brand-mark ${className}`} style={{ width: size, height: size }} aria-hidden="true"><Icon name="terminal" size={Math.round(size * 0.62)} /></span>;
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	icon: IconName;
	label: string;
	iconSize?: number;
}

export function IconButton({ icon, label, iconSize = 17, className = "", type = "button", ...props }: IconButtonProps): React.JSX.Element {
	return <button type={type} className={`icon-btn ${className}`} aria-label={label} data-tooltip={label} {...props}><Icon name={icon} size={iconSize} /></button>;
}

export function CopyButton({ text, label, className = "" }: { text: string; label?: string; className?: string }): React.JSX.Element {
	const { t } = useI18n();
	const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
	const copy = async (): Promise<void> => {
		try { await navigator.clipboard.writeText(text); setStatus("copied"); } catch { setStatus("failed"); }
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setStatus("idle"), 1800);
	};
	const currentLabel = status === "copied" ? t("copied") : status === "failed" ? t("copyFailed") : label ?? t("copy");
	return <IconButton className={`copy-btn ${status === "copied" ? "is-copied" : ""} ${className}`} icon={status === "copied" ? "check" : "copy"} iconSize={15} label={currentLabel} onClick={() => void copy()} />;
}

export interface SelectOption {
	value: string;
	label: string;
	description?: string;
	icon?: IconName;
	keywords?: string;
}

interface SelectMenuProps {
	value: string;
	options: SelectOption[];
	onChange: (value: string) => void;
	label: string;
	icon?: IconName;
	className?: string;
	triggerClassName?: string;
	menuClassName?: string;
	direction?: "up" | "down";
	align?: "left" | "right";
	searchable?: boolean;
	showValue?: boolean;
	disabled?: boolean;
	/** Increment to open the menu programmatically (used by slash commands). */
	openSignal?: number;
}

export function SelectMenu({ value, options, onChange, label, icon, className = "", triggerClassName = "", menuClassName = "", direction = "down", align = "left", searchable = false, showValue = true, disabled = false, openSignal = 0 }: SelectMenuProps): React.JSX.Element {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeValue, setActiveValue] = useState(value);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const id = useId();
	const selected = options.find((option) => option.value === value);
	const visibleOptions = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return options;
		return options.filter((option) => `${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`.toLowerCase().includes(normalized));
	}, [options, query]);
	const activeIndex = Math.max(0, visibleOptions.findIndex((option) => option.value === activeValue));
	const close = (focusTrigger = false): void => {
		setOpen(false);
		setQuery("");
		if (focusTrigger) requestAnimationFrame(() => triggerRef.current?.focus());
	};
	const choose = (nextValue: string): void => { onChange(nextValue); close(true); };

	useEffect(() => {
		if (!open) return;
		setActiveValue(value);
		const frame = requestAnimationFrame(() => { if (searchable) searchRef.current?.focus(); else menuRef.current?.focus(); });
		const onPointerDown = (event: PointerEvent): void => { if (!rootRef.current?.contains(event.target as Node)) close(); };
		document.addEventListener("pointerdown", onPointerDown);
		return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", onPointerDown); };
	}, [open, searchable, value]);
	useEffect(() => {
		if (openSignal > 0) setOpen(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [openSignal]);
	useEffect(() => {
		if (!open || visibleOptions.length === 0) return;
		if (!visibleOptions.some((option) => option.value === activeValue)) setActiveValue(visibleOptions[0].value);
	}, [activeValue, open, visibleOptions]);
	useEffect(() => { if (open) menuRef.current?.querySelector(`[data-value="${CSS.escape(activeValue)}"]`)?.scrollIntoView({ block: "nearest" }); }, [activeValue, open]);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
		if (event.key === "Tab") { if (open) close(); return; }
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (!open) { setOpen(true); return; }
			if (visibleOptions.length === 0) return;
			const delta = event.key === "ArrowDown" ? 1 : -1;
			setActiveValue(visibleOptions[(activeIndex + delta + visibleOptions.length) % visibleOptions.length].value);
			return;
		}
		if ((event.key === "Home" || event.key === "End") && open && visibleOptions.length > 0) { event.preventDefault(); setActiveValue(visibleOptions[event.key === "Home" ? 0 : visibleOptions.length - 1].value); return; }
		if (event.key === "Enter" && open) { event.preventDefault(); const active = visibleOptions[activeIndex]; if (active) choose(active.value); }
	};

	return (
		<div className={`select-root ${className}`} ref={rootRef} onKeyDown={onKeyDown}>
			<button ref={triggerRef} type="button" className={`select-trigger ${open ? "is-open" : ""} ${triggerClassName}`} aria-label={selected ? `${label}: ${selected.label}` : label} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="listbox" disabled={disabled} onClick={() => { if (open) close(); else setOpen(true); }}>
				{(icon || selected?.icon) && <Icon name={icon ?? selected?.icon ?? "chevron-down"} size={16} className="select-leading" />}
				{showValue && <span className="select-value">{selected?.label ?? value ?? label}</span>}
				<Icon name="chevron-down" size={14} className={`select-chevron ${open ? "rotate-180" : ""}`} />
			</button>
			{open && <div id={id} ref={menuRef} role="listbox" aria-label={label} aria-activedescendant={visibleOptions[activeIndex] ? `${id}-${activeIndex}` : undefined} tabIndex={-1} className={`select-menu select-menu-${direction} select-menu-${align} ${menuClassName}`}>
				{searchable && <div className="select-search"><Icon name="search" size={15} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} aria-label={t("searchOptions", { label })} />{query && <IconButton icon="x" iconSize={13} label={t("clearSearch")} onClick={() => setQuery("")} />}</div>}
				<div className="select-options">
					{visibleOptions.map((option, index) => <button id={`${id}-${index}`} key={option.value} type="button" role="option" aria-selected={option.value === value} data-value={option.value} tabIndex={-1} className={`select-option ${index === activeIndex ? "is-active" : ""}`} onMouseEnter={() => setActiveValue(option.value)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option.value)}>{option.icon && <Icon name={option.icon} size={16} className="select-option-icon" />}<span className="min-w-0 flex-1"><span className="select-option-label">{option.label}</span>{option.description && <span className="select-option-description">{option.description}</span>}</span>{option.value === value && <Icon name="check" size={15} className="select-check" />}</button>)}
					{visibleOptions.length === 0 && <div className="select-empty">{t("noMatchingOptions")}</div>}
				</div>
			</div>}
		</div>
	);
}
