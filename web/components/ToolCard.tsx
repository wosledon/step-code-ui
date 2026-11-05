import { relativePath, truncateMiddle } from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type { ToolCallState, ToolContent } from "../state/store";
import { Icon, type IconName } from "./Icon";
import { CopyButton } from "./ui";

const KIND_ICONS: Record<string, IconName> = {
	read: "file", edit: "edit", delete: "trash", move: "folder", search: "search", execute: "terminal", think: "brain", fetch: "globe", switch_mode: "command", other: "tool",
};
const KIND_LABELS: Record<string, TranslationKey> = {
	read: "toolKindRead", edit: "toolKindEdit", delete: "toolKindDelete", move: "toolKindMove", search: "toolKindSearch", execute: "toolKindExecute", think: "toolKindThink", fetch: "toolKindFetch", switch_mode: "toolKindSwitchMode", other: "toolKindOther",
};
const STATUS_LABELS: Record<ToolCallState["status"], TranslationKey> = { pending: "toolWaiting", in_progress: "toolRunning", completed: "toolDone", failed: "toolFailed" };
const STATUS_STYLES: Record<ToolCallState["status"], string> = { pending: "text-faint", in_progress: "text-accent", completed: "text-ok", failed: "text-bad" };

function prettyJson(value: unknown): string {
	try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function Diff({ path, oldText, newText }: { path: string; oldText: string | null; newText: string }): React.JSX.Element {
	const { t } = useI18n();
	const oldLines = (oldText ?? "").split("\n");
	const newLines = newText.split("\n");
	return (
		<div className="overflow-hidden rounded-lg border border-line">
			<div className="flex items-center gap-2 border-b border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-dim"><Icon name="file" size={13} /><span className="min-w-0 flex-1 truncate">{path}</span><CopyButton text={newText} label={t("copyUpdatedFile")} className="h-6 w-6" /></div>
			<pre className="max-h-80 overflow-auto bg-code py-2 font-mono text-[11.5px] leading-6">
				{oldLines.map((line, index) => <div key={`old-${index}`} className="flex px-2" style={{ background: "var(--diff-remove-bg)", color: "var(--diff-remove-ink)" }}><span className="w-5 shrink-0 select-none opacity-60">-</span><span>{line || " "}</span></div>)}
				{newLines.map((line, index) => <div key={`new-${index}`} className="flex px-2" style={{ background: "var(--diff-add-bg)", color: "var(--diff-add-ink)" }}><span className="w-5 shrink-0 select-none opacity-60">+</span><span>{line || " "}</span></div>)}
			</pre>
		</div>
	);
}

function ToolContentBlock({ content }: { content: ToolContent }): React.JSX.Element {
	const { t } = useI18n();
	if (content.type === "diff") return <Diff path={content.path} oldText={content.oldText} newText={content.newText} />;
	return (
		<div className="relative">
			<pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-code p-3 pr-10 font-mono text-[11.5px] leading-relaxed" style={{ color: "var(--code-ink)" }}>{content.text}</pre>
			<CopyButton text={content.text} label={t("copyOutput")} className="absolute right-1.5 top-1.5 h-7 w-7 bg-code/90" />
		</div>
	);
}

export function ToolCard({ tool, cwd, onToggle }: { tool: ToolCallState; cwd: string; onToggle: (id: string) => void }): React.JSX.Element {
	const { t } = useI18n();
	const icon = KIND_ICONS[tool.kind] ?? KIND_ICONS.other;
	const hasDetails = tool.content.length > 0 || tool.rawInput !== undefined;
	const border = tool.status === "failed" ? "border-bad/40" : tool.status === "in_progress" ? "border-accent/35" : "border-line-soft";
	const inputText = prettyJson(tool.rawInput);

	return (
		<section className={`ml-0 overflow-hidden rounded-xl border bg-surface/55 sm:ml-10 ${border}`} aria-label={t("toolCall", { title: tool.title })}>
			<button type="button" className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2/70" onClick={() => onToggle(tool.id)} aria-expanded={tool.expanded}>
				<span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 ${STATUS_STYLES[tool.status]}`}><Icon name={icon} size={15} /></span>
				<div className="min-w0 flex-1"><div className="truncate text-[12px] font-medium text-ink" title={tool.title}>{truncateMiddle(tool.title, 120)}</div><div className="mt-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] text-faint">{t(KIND_LABELS[tool.kind] ?? "toolKindOther")}</div></div>
				<span className={`flex items-center gap-1.5 text-[10.5px] font-medium ${STATUS_STYLES[tool.status]}`}><span className={`h-1.5 w-1.5 rounded-full bg-current ${tool.status === "in_progress" ? "animate-pulse" : ""}`} />{t(STATUS_LABELS[tool.status])}</span>
				{hasDetails && <Icon name="chevron-down" size={14} className={`shrink-0 text-faint transition-transform ${tool.expanded ? "rotate-180" : ""}`} />}
			</button>
			{tool.locations.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line-soft px-3 py-2">{tool.locations.map((location, index) => <span key={`${location.path}-${index}`} className="flex items-center gap-1 font-mono text-[10.5px] text-dim"><Icon name="file" size={11} className="text-faint" />{relativePath(location.path, cwd)}{location.line ? `:${location.line}` : ""}</span>)}</div>}
			{tool.expanded && hasDetails && (
				<div className="space-y-3 border-t border-line-soft p-3">
					{tool.rawInput !== undefined && <div><div className="section-label mb-1.5 px-0">{t("input")}</div><div className="relative"><pre className="max-h-64 overflow-auto rounded-lg border border-line bg-code p-3 pr-10 font-mono text-[11.5px] leading-relaxed" style={{ color: "var(--code-ink)" }}>{inputText}</pre><CopyButton text={inputText} label={t("copyInput")} className="absolute right-1.5 top-1.5 h-7 w-7 bg-code/90" /></div></div>}
					{tool.content.length > 0 && <div className="section-label px-0">{t("output")}</div>}
					{tool.content.map((content, index) => <ToolContentBlock key={index} content={content} />)}
				</div>
			)}
		</section>
	);
}
