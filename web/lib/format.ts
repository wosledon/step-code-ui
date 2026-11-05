/** Small formatting helpers. */

export function relativePath(path: string | undefined, cwd: string): string {
	if (!path) return "";
	if (!cwd) return path;
	const normalized = path.replace(/\\/g, "/");
	const base = cwd.replace(/\\/g, "/").replace(/\/$/, "");
	if (normalized.startsWith(`${base}/`)) return normalized.slice(base.length + 1);
	return normalized;
}

export function formatNumber(value: unknown): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "-";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(Math.round(value));
}

export function formatCost(value: unknown): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "-";
	if (value === 0) return "$0";
	if (value < 0.01) return `$${value.toFixed(4)}`;
	return `$${value.toFixed(2)}`;
}

export function formatTime(timestamp: number): string {
	try {
		return new Date(timestamp).toLocaleString();
	} catch {
		return "";
	}
}

export function truncateMiddle(text: string, max = 80): string {
	if (text.length <= max) return text;
	const half = Math.floor((max - 1) / 2);
	return `${text.slice(0, half)}…${text.slice(text.length - half)}`;
}
