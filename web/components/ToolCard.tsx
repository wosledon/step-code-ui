import { useState } from "react";
import { relativePath, truncateMiddle } from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type { ToolCallState, ToolContent } from "../state/store";
import { Icon, type IconName } from "./Icon";
import { CopyButton } from "./ui";

const KIND_ICONS: Record<string, IconName> = {
	read: "file", edit: "edit", delete: "trash", move: "folder", search: "search", execute: "terminal", think: "brain", fetch: "globe", switch_mode: "command", other: "tool",
};
const STATUS_LABELS: Record<ToolCallState["status"], TranslationKey> = { pending: "toolWaiting", in_progress: "toolRunning", completed: "toolDone", failed: "toolFailed" };
const STATUS_STYLES: Record<ToolCallState["status"], string> = { pending: "text-faint", in_progress: "text-accent", completed: "text-ok", failed: "text-bad" };

type DiffRow = {
	type: "context" | "add" | "remove" | "hunk";
	text: string;
	oldLine?: number;
	newLine?: number;
};

function prettyJson(value: unknown): string {
	if (value === undefined) return "";
	try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function fullFileDiff(oldText: string | null, newText: string): DiffRow[] {
	const oldLines = oldText === null ? [] : oldText.split("\n");
	const newLines = newText.split("\n");
	let prefix = 0;
	while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
	let suffix = 0;
	while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;
	const rows: DiffRow[] = [];
	if (prefix > 2) rows.push({ type: "hunk", text: "⋯" });
	for (let index = Math.max(0, prefix - 2); index < prefix; index += 1) rows.push({ type: "context", text: oldLines[index], oldLine: index + 1, newLine: index + 1 });
	for (let index = prefix; index < oldLines.length - suffix; index += 1) rows.push({ type: "remove", text: oldLines[index], oldLine: index + 1 });
	for (let index = prefix; index < newLines.length - suffix; index += 1) rows.push({ type: "add", text: newLines[index], newLine: index + 1 });
	if (suffix > 2) rows.push({ type: "hunk", text: "⋯" });
	for (let offset = 0; offset < Math.min(2, suffix); offset += 1) rows.push({ type: "context", text: oldLines[oldLines.length - suffix + offset], oldLine: oldLines.length - suffix + offset + 1, newLine: newLines.length - suffix + offset + 1 });
	return rows;
}

function patchDiff(patch: string): DiffRow[] {
	const rows: DiffRow[] = [];
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;
	for (const line of patch.split("\n")) {
		const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (hunk) {
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[2]);
			inHunk = true;
			rows.push({ type: "hunk", text: line });
			continue;
		}
		if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) continue;
		if (!inHunk && /^@@/m.test(patch)) continue;
		if (line.startsWith("+")) {
			rows.push({ type: "add", text: line.slice(1), newLine });
			newLine += 1;
		} else if (line.startsWith("-")) {
			rows.push({ type: "remove", text: line.slice(1), oldLine });
			oldLine += 1;
		} else if (line.startsWith("\\")) {
			rows.push({ type: "hunk", text: line });
		} else {
			const text = line.startsWith(" ") ? line.slice(1) : line;
			rows.push({ type: "context", text, oldLine, newLine });
			oldLine += 1;
			newLine += 1;
		}
	}
	return rows;
}

function DiffView({ path, rows, copyText, cwd }: { path: string; rows: DiffRow[]; copyText: string; cwd: string }): React.JSX.Element {
	const { t } = useI18n();
	const additions = rows.filter((row) => row.type === "add").length;
	const removals = rows.filter((row) => row.type === "remove").length;
	return (
		<div className="overflow-hidden rounded-md border border-line bg-code">
			<div className="flex h-7 items-center gap-2 border-b border-line bg-surface-2 px-2 font-mono text-[10.5px] text-dim">
				<Icon name="file" size={12} className="shrink-0" />
				<span className="min-w-0 flex-1 truncate" title={path}>{relativePath(path, cwd) || t("fileChanges")}</span>
				<span className="shrink-0 text-ok">+{additions}</span>
				<span className="shrink-0 text-bad">−{removals}</span>
				<CopyButton text={copyText} label={t("copyUpdatedFile")} className="-mr-1 h-6 w-6" />
			</div>
			<div className="max-h-64 overflow-auto py-0.5 font-mono text-[11px] leading-[1.65]">
				{rows.map((row, index) => {
					if (row.type === "hunk") return <div key={index} className="bg-surface-2/70 px-2 py-0.5 text-[10px] text-faint">{row.text}</div>;
					const style = row.type === "add" ? { background: "var(--diff-add-bg)", color: "var(--diff-add-ink)" } : row.type === "remove" ? { background: "var(--diff-remove-bg)", color: "var(--diff-remove-ink)" } : { color: "var(--code-ink)" };
					return (
						<div key={index} className="grid grid-cols-[2rem_2rem_0.9rem_minmax(0,1fr)] px-1" style={style}>
							<span className="select-none pr-1.5 text-right text-faint/70">{row.oldLine ?? ""}</span>
							<span className="select-none pr-1.5 text-right text-faint/70">{row.newLine ?? ""}</span>
							<span className="select-none text-center">{row.type === "add" ? "+" : row.type === "remove" ? "−" : ""}</span>
							<span className="whitespace-pre-wrap break-words">{row.text || " "}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function ToolContentBlock({ content, cwd }: { content: ToolContent; cwd: string }): React.JSX.Element {
	const { t } = useI18n();
	if (content.type === "diff") return <DiffView path={content.path} rows={fullFileDiff(content.oldText, content.newText)} copyText={content.newText} cwd={cwd} />;
	if (content.type === "patch") return <DiffView path={content.path} rows={patchDiff(content.patch)} copyText={content.patch} cwd={cwd} />;
	return (
		<div className="relative">
			<pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-code p-2.5 pr-9 font-mono text-[11px] leading-relaxed" style={{ color: "var(--code-ink)" }}>{content.text}</pre>
			<CopyButton text={content.text} label={t("copyOutput")} className="absolute right-1 top-1 h-7 w-7 bg-code/90" />
		</div>
	);
}

export function ToolCard({ tool, cwd, onToggle }: { tool: ToolCallState; cwd: string; onToggle: (id: string) => void }): React.JSX.Element {
	const { t } = useI18n();
	const [showInput, setShowInput] = useState(false);
	const icon = KIND_ICONS[tool.kind] ?? KIND_ICONS.other;
	const hasDetails = tool.content.length > 0 || tool.rawInput !== undefined;
	const border = tool.status === "failed" ? "border-bad/35" : tool.status === "in_progress" ? "border-accent/30" : "border-line-soft";
	const inputText = prettyJson(tool.rawInput);
	const inputVisible = showInput || tool.content.length === 0;

	return (
		<section className={`-my-1 ml-0 overflow-hidden rounded-lg border bg-surface/45 sm:ml-10 ${border}`} aria-label={t("toolCall", { title: tool.title })}>
			<button type="button" className="flex min-h-8 w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-surface-2/70" onClick={() => onToggle(tool.id)} aria-expanded={tool.expanded}>
				<span className={`grid h-5 w-5 shrink-0 place-items-center rounded ${STATUS_STYLES[tool.status]}`}><Icon name={icon} size={14} /></span>
				<span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink/85" title={tool.title}>{truncateMiddle(tool.title, 120)}</span>
				<span className={`flex shrink-0 items-center gap-1 text-[10px] ${STATUS_STYLES[tool.status]}`}><span className={`h-1.5 w-1.5 rounded-full bg-current ${tool.status === "in_progress" ? "animate-pulse" : ""}`} />{t(STATUS_LABELS[tool.status])}</span>
				{hasDetails && <Icon name="chevron-down" size={12} className={`shrink-0 text-faint transition-transform ${tool.expanded ? "rotate-180" : ""}`} />}
			</button>
			{tool.expanded && hasDetails && (
				<div className="border-t border-line-soft">
					<div className="flex h-7 items-center gap-2 px-2">
						<span className="section-label px-0 text-[9px]">{tool.content.length > 0 ? t("output") : t("input")}</span>
						{tool.rawInput !== undefined && tool.content.length > 0 && <button type="button" className="ml-auto cursor-pointer text-[10px] text-faint hover:text-ink" onClick={() => setShowInput((value) => !value)}>{inputVisible ? t("hideInput") : t("viewInput")}</button>}
					</div>
					{tool.expanded && tool.locations.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2 pb-1.5">{tool.locations.map((location, index) => <span key={`${location.path}-${index}`} className="font-mono text-[10px] text-faint">{relativePath(location.path, cwd)}{location.line ? `:${location.line}` : ""}</span>)}</div>}
					<div className="space-y-2 px-2 pb-2">
						{inputVisible && tool.rawInput !== undefined && <div className="relative"><pre className="max-h-48 overflow-auto rounded-md border border-line bg-code p-2.5 pr-9 font-mono text-[11px] leading-relaxed" style={{ color: "var(--code-ink)" }}>{inputText}</pre><CopyButton text={inputText} label={t("copyInput")} className="absolute right-1 top-1 h-7 w-7 bg-code/90" /></div>}
						{tool.content.map((content, index) => <ToolContentBlock key={index} content={content} cwd={cwd} />)}
					</div>
				</div>
			)}
		</section>
	);
}
