import { useEffect, useState } from "react";
import { Markdown } from "../lib/markdown";
import { truncateMiddle } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { Icon } from "./Icon";

export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }): React.JSX.Element {
	const { t } = useI18n();
	const [expanded, setExpanded] = useState(streaming);
	const lines = text.split("\n").filter((line) => line.trim().length > 0);

	useEffect(() => {
		if (streaming) setExpanded(true);
	}, [streaming]);

	return (
		<div className="mb-3 overflow-hidden rounded-lg border border-line-soft bg-think/[0.035]">
			<button type="button" className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
				<Icon name="brain" size={15} className="text-think" />
				<span className="text-[11.5px] font-medium text-think">{streaming ? t("thinking") : t("reasoning")}</span>
				<span className="text-[10.5px] text-faint">{lines.length > 0 ? t("reasoningLines", { count: lines.length }) : t("inProgress")}</span>
				<Icon name="chevron-down" size={13} className={`ml-auto text-faint transition-transform ${expanded ? "rotate-180" : ""}`} />
			</button>
			{expanded && <div className="border-t border-line-soft px-3 py-2 text-[12px] text-dim"><Markdown source={truncateMiddle(text, 8000)} /></div>}
		</div>
	);
}
