/** Theme preference handling shared by the theme control and the /theme command. */
import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEME_KEY = "step-ui-theme";
const listeners = new Set<(theme: ResolvedTheme) => void>();

function media(): MediaQueryList | null {
	return typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");
}

export function readThemePreference(): ThemePreference {
	try {
		const stored = window.localStorage.getItem(THEME_KEY);
		return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
	} catch {
		return "system";
	}
}

export function writeThemePreference(preference: ThemePreference): void {
	try {
		window.localStorage.setItem(THEME_KEY, preference);
	} catch {
		// storage may be unavailable; the theme still applies for this session
	}
	applyTheme(resolveTheme(preference));
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
	if (preference !== "system") return preference;
	return media()?.matches ? "dark" : "light";
}

export function currentResolvedTheme(): ResolvedTheme {
	const attribute = document.documentElement.dataset.theme;
	return attribute === "light" ? "light" : "dark";
}

export function applyTheme(theme: ResolvedTheme): void {
	document.documentElement.dataset.theme = theme;
	document.documentElement.style.colorScheme = theme;
	document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111214" : "#f7f7f5");
	for (const listener of listeners) listener(theme);
}

/** Flip between light and dark, persisting an explicit preference. */
export function toggleTheme(): ResolvedTheme {
	const next: ResolvedTheme = currentResolvedTheme() === "dark" ? "light" : "dark";
	writeThemePreference(next);
	return next;
}

export function subscribeTheme(listener: (theme: ResolvedTheme) => void): () => void {
	listeners.add(listener);
	const query = media();
	const onChange = (): void => {
		if (readThemePreference() === "system") applyTheme(resolveTheme("system"));
	};
	query?.addEventListener("change", onChange);
	return () => {
		listeners.delete(listener);
		query?.removeEventListener("change", onChange);
	};
}

export function useResolvedTheme(): ResolvedTheme {
	return useSyncExternalStore(
		(listener) => subscribeTheme(() => listener()),
		() => currentResolvedTheme(),
		() => "dark" as ResolvedTheme,
	);
}
