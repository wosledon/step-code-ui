/** Markdown rendering with syntax highlighting and sanitisation. */
import { useEffect, useRef } from "react";
import { marked, Renderer } from "marked";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import DOMPurify from "dompurify";
import { useI18n } from "./i18n";

for (const [name, definition] of [["bash", bash], ["css", css], ["diff", diff], ["go", go], ["javascript", javascript], ["json", json], ["markdown", markdown], ["python", python], ["rust", rust], ["sql", sql], ["typescript", typescript], ["xml", xml], ["yaml", yaml]] as const) hljs.registerLanguage(name, definition);
hljs.registerAliases(["ts", "tsx", "js", "jsx", "mjs", "cjs"], { languageName: "typescript" });
hljs.registerAliases(["sh", "shell", "zsh", "powershell", "ps1"], { languageName: "bash" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["html"], { languageName: "xml" });

const renderer = new Renderer();
renderer.code = ({ text, lang }) => {
	const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
	let highlighted: string;
	try { highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value; } catch { highlighted = escapeHtml(text); }
	return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
};
marked.use({ gfm: true, breaks: true, renderer });

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderMarkdown(source: string): string {
	if (!source) return "";
	try {
		const html = marked.parse(source, { async: false }) as string;
		return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
	} catch { return `<p>${escapeHtml(source)}</p>`; }
}

export function Markdown({ source }: { source: string }): React.JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	const { t } = useI18n();
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const cleanups: Array<() => void> = [];
		for (const block of element.querySelectorAll("pre")) {
			const code = block.querySelector("code");
			if (!(code instanceof HTMLElement)) continue;
			const button = document.createElement("button");
			button.type = "button";
			button.className = "icon-btn code-copy";
			button.setAttribute("aria-label", t("copy"));
			button.dataset.tooltip = t("copy");
			button.innerHTML = '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>';
			const copy = async (): Promise<void> => {
				try {
					await navigator.clipboard.writeText(code.textContent ?? "");
					button.setAttribute("aria-label", t("copied"));
					button.dataset.tooltip = t("copied");
					button.classList.add("text-ok");
				} catch {
					button.setAttribute("aria-label", t("copyFailed"));
					button.dataset.tooltip = t("copyFailed");
				}
			};
			button.addEventListener("click", copy);
			block.append(button);
			cleanups.push(() => { button.removeEventListener("click", copy); button.remove(); });
		}
		return () => cleanups.forEach((cleanup) => cleanup());
	}, [source, t]);
	return <div className="markdown" ref={ref} dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />;
}
