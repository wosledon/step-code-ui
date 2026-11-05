import { Markdown } from "../lib/markdown";
import { useI18n } from "../lib/i18n";
import { ThinkingBlock } from "./ThinkingBlock";
import type { ChatMessage } from "../state/store";
import { Icon } from "./Icon";
import { BrandMark, CopyButton } from "./ui";

export function MessageBubble({ message }: { message: ChatMessage }): React.JSX.Element {
	const { t } = useI18n();
	const isUser = message.role === "user";

	if (isUser) {
		return (
			<article className="group flex flex-col items-end pl-10 sm:pl-20" aria-label={t("yourMessage")}>
				<div className="max-w-[85%] rounded-2xl rounded-br-md border border-accent/15 bg-accent-soft px-4 py-2.5 text-ink"><Markdown source={message.text} /></div>
				<div className="mt-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"><CopyButton text={message.text} label={t("copyMessage")} className="h-6 w-6" /></div>
			</article>
		);
	}

	return (
		<article className="group flex gap-3 pr-2" aria-label={t("stepCodeResponse")}>
			<BrandMark size={27} className="mt-0.5 rounded-lg" />
			<div className="min-w-0 flex-1">
				<div className="mb-1.5 flex h-6 items-center gap-2">
					<span className="text-xs font-semibold tracking-[-0.01em]">StepCode</span>
					{message.streaming && <span className="text-[10.5px] font-medium text-accent">{t("responding")}</span>}
					{message.text && <CopyButton text={message.text} label={t("copyResponse")} className="ml-auto h-6 w-6 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100" />}
				</div>
				{message.thinking.length > 0 && <ThinkingBlock text={message.thinking} streaming={message.streaming} />}
				{message.text.length > 0 && <Markdown source={message.text} />}
				{message.streaming && message.text.length === 0 && message.thinking.length === 0 && (
					<div className="flex h-6 items-center gap-1" aria-label={t("stepCodeThinking")}>{[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" style={{ animationDelay: `${dot * 160}ms` }} />)}</div>
				)}
				{message.failed && <div role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-bad"><Icon name="error" size={14} />{t("turnFailed")}</div>}
			</div>
		</article>
	);
}
