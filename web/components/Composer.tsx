import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ContentBlock } from "@zed-industries/agent-client-protocol";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { GROUP_ORDER, filterCommands, groupLabelKey, type UiCommand } from "../lib/commands";
import { Icon } from "./Icon";
import { IconButton, SelectMenu } from "./ui";

export interface ComposerProps {
	streaming: boolean;
	disabled?: boolean;
	commands: UiCommand[];
	models: Array<{ modelId: string; name: string; description?: string | null }>;
	currentModelId: string;
	thinkingLevel: string;
	thinkingLevels: string[];
	mode: string;
	modes: Array<{ id: string; name: string; description?: string | null }>;
	onSelectModel: (modelId: string) => void;
	onSelectThinking: (level: string) => void;
	onSelectMode: (modeId: string) => void;
	onSend: (prompt: ContentBlock[]) => void;
	onAbort: () => void;
}

export interface ComposerHandle {
	focus: () => void;
	setDraft: (text: string) => void;
	openSelect: (which: "model" | "thinking" | "mode") => void;
}

interface AttachedImage {
	id: string;
	name: string;
	preview: string;
	block: ContentBlock;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const LEVEL_LABELS: Record<string, TranslationKey> = { off: "off", low: "low", medium: "medium", high: "high", max: "max" };
const MODE_LABELS: Record<string, TranslationKey> = { default: "askForApproval", ask: "askForApproval", confirm: "askForApproval", auto: "autoApprove", approve: "autoApprove", deny: "autoDeny" };

async function fileToImage(file: File): Promise<ContentBlock> {
	const data = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? "");
			resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
		};
		reader.onerror = () => reject(reader.error ?? new Error("read failed"));
		reader.readAsDataURL(file);
	});
	return { type: "image", data, mimeType: file.type || "image/png" } as ContentBlock;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ streaming, disabled = false, commands, models, currentModelId, thinkingLevel, thinkingLevels, mode, modes, onSelectModel, onSelectThinking, onSelectMode, onSend, onAbort }, ref): React.JSX.Element {
	const { t } = useI18n();
	const [text, setText] = useState("");
	const [attachments, setAttachments] = useState<AttachedImage[]>([]);
	const [rejectedAttachments, setRejectedAttachments] = useState(0);
	const [commandIndex, setCommandIndex] = useState(0);
	const [commandDismissed, setCommandDismissed] = useState(false);
	const [dragging, setDragging] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const commandMenuRef = useRef<HTMLDivElement>(null);
	const composerRootRef = useRef<HTMLDivElement>(null);
	const dragDepth = useRef(0);
	const [selectSignal, setSelectSignal] = useState({ which: "" as "" | "model" | "thinking" | "mode", nonce: 0 });

	const trimmed = text.trim();
	const showCommands = trimmed.startsWith("/") && !trimmed.includes(" ") && !commandDismissed && !disabled;
	const matches = showCommands ? filterCommands(commands, trimmed.slice(1)) : [];
	const modelOptions = useMemo(() => models.map((model) => ({ value: model.modelId, label: model.name, description: model.description ?? undefined, keywords: model.modelId })), [models]);
	const levelOptions = (thinkingLevels.length > 0 ? thinkingLevels : [thinkingLevel]).filter(Boolean).map((level) => {
		const key = LEVEL_LABELS[level];
		return { value: level, label: key ? t(key) : level };
	});
	const modeOptions = (modes.length > 0 ? modes : [{ id: "default", name: t("askForApproval") }, { id: "auto", name: t("autoApprove") }]).map((entry) => {
		const key = MODE_LABELS[entry.id];
		return { value: entry.id, label: key ? t(key) : entry.name, description: entry.description ?? undefined };
	});

	useImperativeHandle(ref, () => ({
		focus: () => textareaRef.current?.focus(),
		setDraft: (draft: string) => {
			setText(draft);
			requestAnimationFrame(() => {
				textareaRef.current?.focus();
				textareaRef.current?.setSelectionRange(draft.length, draft.length);
			});
		},
		openSelect: (which: "model" | "thinking" | "mode") => {
			setSelectSignal((current) => ({ which, nonce: current.nonce + 1 }));
			requestAnimationFrame(() => textareaRef.current?.focus());
		},
	}), []);

	useEffect(() => { setCommandIndex(0); setCommandDismissed(false); }, [trimmed]);
	useEffect(() => {
		const element = textareaRef.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
	}, [text]);
	useEffect(() => { commandMenuRef.current?.querySelector(`[data-command-index="${commandIndex}"]`)?.scrollIntoView({ block: "nearest" }); }, [commandIndex]);

	const attach = (files: File[]): void => {
		if (files.length === 0 || disabled) return;
		void (async () => {
			setRejectedAttachments(0);
			const next: AttachedImage[] = [];
			let rejected = 0;
			for (const file of files) {
				if (file.size > MAX_IMAGE_BYTES || !file.type.startsWith("image/")) { rejected += 1; continue; }
				try {
					const block = await fileToImage(file);
					const image = block as unknown as { data: string; mimeType: string };
					next.push({ id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, preview: `data:${image.mimeType};base64,${image.data}`, block });
				} catch { rejected += 1; }
			}
			if (next.length > 0) setAttachments((current) => [...current, ...next]);
			if (rejected > 0) setRejectedAttachments(rejected);
		})();
	};

	const submit = (): void => {
		if (disabled || (trimmed.length === 0 && attachments.length === 0)) return;
		const prompt: ContentBlock[] = [];
		if (trimmed.length > 0) prompt.push({ type: "text", text: trimmed } as ContentBlock);
		prompt.push(...attachments.map((attachment) => attachment.block));
		onSend(prompt);
		setText("");
		setAttachments([]);
		setRejectedAttachments(0);
		setCommandDismissed(true);
		textareaRef.current?.focus();
	};
	const chooseCommand = (name: string): void => {
		setText(`/${name} `);
		setCommandDismissed(true);
		requestAnimationFrame(() => textareaRef.current?.focus());
	};
	const runCommand = (command: UiCommand): void => {
		if (!command.run) {
			chooseCommand(command.name);
			return;
		}
		command.run();
		setText("");
		setCommandDismissed(true);
		// Keep focus where the command moved it (for example the session search).
		requestAnimationFrame(() => {
			const active = document.activeElement;
			const stayedInComposer = active === document.body || (active instanceof Node && composerRootRef.current?.contains(active));
			if (stayedInComposer) textareaRef.current?.focus();
		});
	};

	return (
		<div className="relative z-10 shrink-0 bg-gradient-to-t from-bg via-bg to-transparent px-3 pb-3 pt-3 sm:px-5 sm:pb-4">
			<div className="relative mx-auto max-w-[820px]" ref={composerRootRef}>
				{matches.length > 0 && (
					<div ref={commandMenuRef} className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface p-1.5" style={{ boxShadow: "var(--shadow-md)" }}>
						<div className="sticky top-0 z-10 -mx-1.5 -mt-1.5 flex items-center gap-2 rounded-t-xl border-b border-line-soft bg-surface px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
							<Icon name="command" size={13} />
							{t("commands")}
							<span className="ml-auto font-normal normal-case tracking-normal">{t("commandCount", { count: matches.length })}</span>
						</div>
						{GROUP_ORDER.map((group) => {
							const items = matches.filter((command) => command.group === group);
							if (items.length === 0) return null;
							return (
								<div key={group} className="pt-1">
									<div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint/80">{t(groupLabelKey(group))}</div>
									{items.map((command) => {
										const index = matches.indexOf(command);
										return (
											<button key={`${group}-${command.name}`} type="button" data-command-index={index} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${index === commandIndex ? "bg-accent-soft" : "hover:bg-surface-2"}`} onMouseEnter={() => setCommandIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand(command)}>
												<span className="shrink-0 font-mono text-xs font-medium text-accent">/{command.name}</span>
												<span className="truncate text-[11.5px] text-dim">{command.description}</span>
												{command.run ? <span className="ml-auto shrink-0 text-[10px] text-faint">{t("commandGroupLocal")}</span> : index === commandIndex ? <kbd className="kbd ml-auto">Tab</kbd> : null}
											</button>
										);
									})}
								</div>
							);
						})}
					</div>
				)}

				<div className={`relative rounded-2xl border bg-surface transition-[border-color,box-shadow] focus-within:border-accent/60 ${dragging ? "border-accent" : "border-line"}`} style={{ boxShadow: "var(--shadow-composer)" }} onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); }} onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); attach([...event.dataTransfer.files]); }}>
					{dragging && <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl bg-surface/95 backdrop-blur-sm"><div className="flex items-center gap-2 text-sm font-medium text-accent"><Icon name="paperclip" size={18} />{t("dropImages")}</div></div>}
					{attachments.length > 0 && <div className="flex flex-wrap gap-2 px-3 pt-3">{attachments.map((attachment, index) => <div key={attachment.id} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-line bg-surface-2"><img src={attachment.preview} alt={attachment.name} className="h-full w-full object-cover" /><button type="button" aria-label={t("removeImage", { name: attachment.name })} className="absolute right-1 top-1 grid h-5 w-5 cursor-pointer place-items-center rounded-full bg-black/65 text-white opacity-0 transition-opacity hover:bg-black/85 focus:opacity-100 group-hover:opacity-100" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Icon name="x" size={12} /></button></div>)}</div>}
					<textarea ref={textareaRef} className="max-h-[220px] min-h-[64px] w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[14px] leading-6 text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed" value={text} rows={1} disabled={disabled} aria-label={t("messageStepCode")} placeholder={disabled ? t("preparingWorkspace") : t("askAnything")} onChange={(event) => setText(event.target.value)} onPaste={(event) => attach([...event.clipboardData.files])} onKeyDown={(event) => {
						if (matches.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); const delta = event.key === "ArrowDown" ? 1 : -1; setCommandIndex((current) => (current + delta + matches.length) % matches.length); return; }
						if (event.key === "Escape" && matches.length > 0) { event.preventDefault(); setCommandDismissed(true); return; }
						if (matches.length > 0 && event.key === "Tab") { event.preventDefault(); const selected = matches[commandIndex]; if (selected?.run) runCommand(selected); else if (selected) chooseCommand(selected.name); return; }
						if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); const selected = matches[commandIndex]; if (selected?.run) { runCommand(selected); return; } if (selected && trimmed.toLowerCase() !== `/${selected.name}`.toLowerCase()) chooseCommand(selected.name); else submit(); }
					}} />

					<div className="flex flex-wrap items-center gap-1 px-2 pb-2">
						<div className="flex min-w-[220px] flex-1 items-center gap-0.5">
							<SelectMenu value={currentModelId} options={modelOptions.length > 0 ? modelOptions : [{ value: currentModelId, label: currentModelId || t("model") }]} onChange={onSelectModel} label={t("model")} icon="sparkles" direction="up" searchable disabled={disabled} className="min-w-0 flex-1 sm:max-w-[190px]" menuClassName="w-72" openSignal={selectSignal.which === "model" ? selectSignal.nonce : 0} />
							<SelectMenu value={thinkingLevel} options={levelOptions.length > 0 ? levelOptions : [{ value: "off", label: t("off") }]} onChange={onSelectThinking} label={t("thinkingLevel")} icon="brain" direction="up" disabled={disabled} className="w-[76px] shrink-0 sm:w-[96px]" openSignal={selectSignal.which === "thinking" ? selectSignal.nonce : 0} />
							<SelectMenu value={mode} options={modeOptions} onChange={onSelectMode} label={t("toolApprovalMode")} icon="shield" direction="up" disabled={disabled} className="w-[82px] shrink-0 sm:w-[142px]" menuClassName="w-64" openSignal={selectSignal.which === "mode" ? selectSignal.nonce : 0} />
						</div>
						<div className="ml-auto flex items-center gap-1 pl-1">
							<input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { attach([...(event.target.files ?? [])]); event.target.value = ""; }} />
							<IconButton icon="paperclip" label={t("attachImages")} onClick={() => fileRef.current?.click()} disabled={disabled} />
							{streaming && <IconButton icon="stop" label={t("stopGenerating")} className="bg-bad/10 text-bad hover:bg-bad/15 hover:text-bad" onClick={onAbort} />}
							<button type="button" className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg bg-accent text-on-accent transition-all hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-faint" onClick={submit} disabled={disabled || (trimmed.length === 0 && attachments.length === 0)} aria-label={streaming ? t("queueMessage") : t("sendMessage")} data-tooltip={streaming ? t("queueMessage") : t("sendMessage")}><Icon name="arrow-up" size={17} /></button>
						</div>
					</div>
				</div>
				{rejectedAttachments > 0 && <div role="alert" className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-bad"><Icon name="error" size={13} />{t("attachmentSkipped", { count: rejectedAttachments })}</div>}
				<div className="mt-2 flex items-center justify-between gap-3 px-1 text-[10.5px] text-faint"><span className="flex items-center gap-1.5"><Icon name="command" size={12} />{t("commandsHint")}</span><span className="hidden items-center gap-1 sm:flex"><kbd className="kbd">Enter</kbd>{streaming ? t("toQueue") : t("toSend")}<span className="mx-0.5">·</span><kbd className="kbd">Shift ↵</kbd>{t("newLine")}</span></div>
			</div>
		</div>
	);
});
