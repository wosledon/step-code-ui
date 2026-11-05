import { useEffect, useRef, useState, type ReactNode } from "react";
import { MessageBubble } from "./MessageBubble";
import { PermissionCard } from "./PermissionCard";
import { ToolCard } from "./ToolCard";
import { useStore } from "../state/store";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { Icon, type IconName } from "./Icon";
import { BrandMark } from "./ui";

const suggestions: Array<{ icon: IconName; title: TranslationKey; description: TranslationKey; prompt: TranslationKey }> = [
	{ icon: "lightbulb", title: "understandProject", description: "understandProjectDescription", prompt: "understandProjectPrompt" },
	{ icon: "bug", title: "trackBug", description: "trackBugDescription", prompt: "trackBugPrompt" },
	{ icon: "rocket", title: "buildNew", description: "buildNewDescription", prompt: "buildNewPrompt" },
];

export function Transcript({ onSuggestion }: { onSuggestion: (text: string) => void }): React.JSX.Element {
	const { state, dispatch } = useStore();
	const { t } = useI18n();
	const endRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const [showJump, setShowJump] = useState(false);

	const scrollToBottom = (smooth = false): void => {
		stickToBottom.current = true;
		setShowJump(false);
		endRef.current?.scrollIntoView({ block: "end", behavior: smooth ? "smooth" : "auto" });
	};

	useEffect(() => {
		if (!stickToBottom.current) return;
		const frame = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
		return () => cancelAnimationFrame(frame);
	}, [state.items, state.messages, state.tools, state.permissions.length]);

	const messagesById = new Map(state.messages.map((message) => [message.id, message]));
	const toolsById = new Map(state.tools.map((tool) => [tool.id, tool]));
	const renderItem = (item: { kind: "message" | "tool"; id: string }): ReactNode => {
		if (item.kind === "message") {
			const message = messagesById.get(item.id);
			return message ? <MessageBubble key={item.id} message={message} /> : null;
		}
		const tool = toolsById.get(item.id);
		if (!tool) return null;
		return <ToolCard key={item.id} tool={tool} cwd={state.cwd} onToggle={(id) => dispatch({ type: "tool/toggle", id })} />;
	};

	return (
		<div className="relative min-h-0 flex-1">
			<div className="h-full overflow-y-auto overscroll-contain px-4 py-6 sm:px-6" onScroll={(event) => {
				const element = event.currentTarget;
				const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
				stickToBottom.current = distance < 120;
				setShowJump(distance > 260);
			}}>
				{state.items.length === 0 ? (
					<div className="mx-auto flex min-h-full max-w-[820px] items-center justify-center py-8">
						<div className="w-full max-w-2xl text-center">
							<div className="relative mx-auto mb-5 w-fit"><div className="absolute inset-0 scale-150 rounded-full bg-accent/15 blur-2xl" /><BrandMark size={48} className="relative rounded-[14px]" /></div>
							<div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">{t("yourCodingPartner")}</div>
							<h2 className="mt-2 text-[26px] font-semibold tracking-[-0.035em] text-ink sm:text-[30px]">{t("whatBuild")}</h2>
							<p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-dim">{t("emptySubtitle")}</p>
							<div className="mt-7 grid gap-2 text-left sm:grid-cols-3">
								{suggestions.map((suggestion) => (
									<button key={suggestion.title} type="button" className="group rounded-xl border border-line bg-surface p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md" onClick={() => onSuggestion(t(suggestion.prompt))}>
										<Icon name={suggestion.icon} size={18} className="text-dim transition-colors group-hover:text-accent" />
										<div className="mt-3 text-xs font-semibold text-ink">{t(suggestion.title)}</div>
										<div className="mt-1 text-[11px] leading-[1.5] text-dim">{t(suggestion.description)}</div>
									</button>
								))}
							</div>
							<div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-faint"><Icon name="folder" size={13} /><span className="max-w-[420px] truncate" title={state.cwd}>{state.cwd || t("connectingWorkspace")}</span></div>
						</div>
					</div>
				) : (
					<div className="mx-auto flex max-w-[820px] flex-col gap-5 pb-2">
						{state.items.map(renderItem)}
						{state.permissions.map((permission) => <PermissionCard key={permission.id} permission={permission} />)}
						<div ref={endRef} className="h-px" />
					</div>
				)}
			</div>
			{showJump && <button type="button" className="absolute bottom-3 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-dim shadow-lg transition-colors hover:text-ink" onClick={() => scrollToBottom(true)}><Icon name="arrow-down" size={14} />{t("jumpLatest")}</button>}
		</div>
	);
}
