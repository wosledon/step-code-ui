/** Bridge HTTP helpers (token protected). */

const TOKEN_KEY = "step-ui-token";

export function readToken(): string {
	const fromUrl = new URLSearchParams(window.location.search).get("token");
	if (fromUrl) {
		window.sessionStorage.setItem(TOKEN_KEY, fromUrl);
		return fromUrl;
	}
	const stored = window.sessionStorage.getItem(TOKEN_KEY);
	if (stored) return stored;
	return (import.meta.env.VITE_STEP_UI_TOKEN as string | undefined) ?? "";
}

function withToken(path: string): string {
	const token = readToken();
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}token=${encodeURIComponent(token)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(withToken(path), init);
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
	}
	return (await response.json()) as T;
}

export interface FileReadResponse {
	path: string;
	content: string;
}

export const api = {
	info: () => request<Record<string, unknown>>("/api/info"),
	readFile: (path: string, line?: number, limit?: number) => {
		const params = new URLSearchParams({ path });
		if (line) params.set("line", String(line));
		if (limit) params.set("limit", String(limit));
		return request<FileReadResponse>(`/api/file?${params.toString()}`);
	},
	writeFile: (path: string, content: string) =>
		request<{ path: string }>("/api/file", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path, content }),
		}),
};

export function webSocketUrl(): string {
	const token = readToken();
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}
