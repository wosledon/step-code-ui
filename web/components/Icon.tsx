import type { ReactNode } from "react";

export type IconName =
	| "arrow-down"
	| "arrow-up"
	| "brain"
	| "bug"
	| "check"
	| "check-circle"
	| "chevron-down"
	| "chevron-right"
	| "clock"
	| "code"
	| "command"
	| "compress"
	| "copy"
	| "cpu"
	| "edit"
	| "error"
	| "file"
	| "folder"
	| "globe"
	| "info"
	| "lightbulb"
	| "moon"
	| "panel"
	| "paperclip"
	| "plus"
	| "refresh"
	| "rocket"
	| "search"
	| "shield"
	| "sparkles"
	| "stop"
	| "sun"
	| "terminal"
	| "tool"
	| "trash"
	| "warning"
	| "x";

const paths: Record<IconName, ReactNode> = {
	"arrow-down": <><path d="M12 5v14" /><path d="m18 13-6 6-6-6" /></>,
	"arrow-up": <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>,
	brain: <><path d="M9.5 4.5A3 3 0 0 0 4.8 7 3.2 3.2 0 0 0 3 12.5a3.2 3.2 0 0 0 2 5.7 3 3 0 0 0 5.5 1.3V6a3 3 0 0 0-1-1.5Z" /><path d="M14.5 4.5A3 3 0 0 1 19.2 7a3.2 3.2 0 0 1 1.8 5.5 3.2 3.2 0 0 1-2 5.7 3 3 0 0 1-5.5 1.3V6a3 3 0 0 1 1-1.5Z" /><path d="M4.8 7H8m-5 5.5h4m-2 5.7h3.5M19.2 7H16m5 5.5h-4m2 5.7h-3.5" /></>,
	bug: <><path d="m8 2 1.5 2M16 2l-1.5 2M3 13h3m12 0h3M5 6l2 2m12-2-2 2M5 20l2-2m12 2-2-2" /><rect x="6" y="4" width="12" height="16" rx="6" /><path d="M12 8v8" /></>,
	check: <path d="m5 12 4 4L19 6" />,
	"check-circle": <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
	"chevron-down": <path d="m7 10 5 5 5-5" />,
	"chevron-right": <path d="m9 6 6 6-6 6" />,
	clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
	code: <><path d="m8 9-3 3 3 3m8-6 3 3-3 3M14 5l-4 14" /></>,
	command: <><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" /></>,
	compress: <><path d="M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5" /><path d="m8 8 4 4 4-4m-4 4-4 4m4-4 4 4" /></>,
	copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
	cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" /></>,
	edit: <><path d="M12 20h9" /><path d="m16.5 3.5 4 4L8 20l-5 1 1-5L16.5 3.5Z" /></>,
	error: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></>,
	file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8m-8 4h5" /></>,
	folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
	globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" /></>,
	info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
	lightbulb: <><path d="M9 18h6m-5 3h4" /><path d="M8.5 15.5a6 6 0 1 1 7 0c-.9.7-1.5 1.4-1.5 2.5h-4c0-1.1-.6-1.8-1.5-2.5Z" /></>,
	moon: <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />,
	panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
	paperclip: <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9" />,
	plus: <path d="M12 5v14M5 12h14" />,
	refresh: <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2 5" /></>,
	rocket: <><path d="M14 5c3-3 6-2 6-2s1 3-2 6l-5 5-4-4 5-5Z" /><path d="m9 10-4 1-2 3 6 1m4-1-1 4-3 2-1-6M5 19c-1 1-1 2-1 2s1 0 2-1" /><circle cx="15.5" cy="7.5" r="1" /></>,
	search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
	shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
	sparkles: <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15ZM5 2l.8 2.2L8 5l-2.2.8L5 8l-.8-2.2L2 5l2.2-.8L5 2Z" /></>,
	stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
	sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
	terminal: <><path d="m7 8 4 4-4 4m6 0h5" /></>,
	tool: <><path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5L4 17a2.1 2.1 0 0 0 3 3l8.3-8.3a4 4 0 0 0 5-5L18 9l-2.4-2.4 2.3-2.3a4 4 0 0 0-3.2 2Z" /></>,
	trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6m5 4v7m4-7v7" /></>,
	warning: <><path d="m10.3 3.7-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.3l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 4h.01" /></>,
	x: <path d="m6 6 12 12M18 6 6 18" />,
};

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }): React.JSX.Element {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			height={size}
			viewBox="0 0 24 24"
			width={size}
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
		>
			{paths[name]}
		</svg>
	);
}
