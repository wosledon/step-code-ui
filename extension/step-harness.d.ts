/**
 * Local type declarations for the extension entry point.
 *
 * The canonical types live in `@step-harness/coding-agent`, which ships with the
 * StepCode CLI but is not published to npm. These declarations cover the small
 * surface this extension uses so the repository typechecks standalone. Delete
 * this file if the real package becomes available.
 */
declare module "@step-harness/coding-agent" {
	export interface ExtensionUI {
		notify(message: string, level: "info" | "warning" | "error"): void;
		setStatus?(key: string, text: string): void;
		setWidget?(key: string, lines: string[]): void;
	}

	export interface ExtensionContext {
		cwd: string;
		mode: "tui" | "rpc" | "json" | "print";
		hasUI: boolean;
		ui: ExtensionUI;
	}

	export type ExtensionCommandContext = ExtensionContext;

	export interface AutocompleteItem {
		value: string;
		label: string;
	}

	export interface CommandOptions {
		description?: string;
		getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null;
		handler: (args: string, ctx: ExtensionCommandContext) => void | Promise<void>;
	}

	export interface ExtensionAPI {
		registerCommand(name: string, options: CommandOptions): void;
		on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>): void;
	}
}
