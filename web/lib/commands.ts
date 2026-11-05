/** Slash command catalogue: local web-UI commands plus everything the agent exposes. */
import type { TranslationKey } from "./i18n";

export type CommandGroup = "local" | "extension" | "prompt" | "skill";

export interface UiCommand {
	/** Command name without the leading slash. */
	name: string;
	description: string;
	group: CommandGroup;
	/** Local commands run in the browser; agent commands are sent to the CLI. */
	run?: () => void;
}

export interface AgentCommand {
	name: string;
	description: string;
	source?: string;
}

export interface LocalCommandHandlers {
	newSession: () => void;
	compact: () => void;
	openModel: () => void;
	openThinking: () => void;
	toggleTheme: () => void;
	openSessions: () => void;
	exportSession: () => void;
	help: () => void;
}

export const GROUP_ORDER: CommandGroup[] = ["local", "extension", "prompt", "skill"];

export function groupLabelKey(group: CommandGroup): TranslationKey {
	switch (group) {
		case "local":
			return "commandGroupLocal";
		case "extension":
			return "commandGroupExtension";
		case "prompt":
			return "commandGroupPrompt";
		default:
			return "commandGroupSkill";
	}
}

/**
 * Local commands mirror the built-in CLI commands that make sense in a browser.
 * They run entirely in the web UI, so they work even while the agent is busy.
 */
export function localCommands(handlers: LocalCommandHandlers, t: (key: TranslationKey) => string): UiCommand[] {
	return [
		{ name: "new", description: t("localCommandNew"), group: "local", run: handlers.newSession },
		{ name: "compact", description: t("localCommandCompact"), group: "local", run: handlers.compact },
		{ name: "model", description: t("localCommandModel"), group: "local", run: handlers.openModel },
		{ name: "thinking", description: t("localCommandThinking"), group: "local", run: handlers.openThinking },
		{ name: "theme", description: t("localCommandTheme"), group: "local", run: handlers.toggleTheme },
		{ name: "sessions", description: t("localCommandSessions"), group: "local", run: handlers.openSessions },
		{ name: "export", description: t("localCommandExport"), group: "local", run: handlers.exportSession },
		{ name: "help", description: t("localCommandHelp"), group: "local", run: handlers.help },
	];
}

function agentGroup(source: string | undefined): CommandGroup {
	if (source === "skill") return "skill";
	if (source === "prompt") return "prompt";
	return "extension";
}

/** Merge local and agent commands, ordered the way the CLI groups them. */
export function buildCommands(agentCommands: AgentCommand[], handlers: LocalCommandHandlers, t: (key: TranslationKey) => string): UiCommand[] {
	const local = localCommands(handlers, t);
	const agents = agentCommands
		.filter((command) => command.name.length > 0)
		.map((command) => ({ name: command.name, description: command.description, group: agentGroup(command.source) }));
	const merged = [...local, ...agents];
	return GROUP_ORDER.flatMap((group) => merged.filter((command) => command.group === group));
}

/** Prefix filter used by the composer menu; matches the name and the description. */
export function filterCommands(commands: UiCommand[], query: string): UiCommand[] {
	const needle = query.trim().toLowerCase().replace(/^\//, "");
	if (!needle) return commands;
	return commands.filter((command) => `${command.name} ${command.description}`.toLowerCase().includes(needle));
}
