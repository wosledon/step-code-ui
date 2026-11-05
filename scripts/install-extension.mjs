#!/usr/bin/env node
/** Install the extension into ~/.stepcode/agent/extensions/web-ui. */
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "dist", "extension");

const override = process.env.STEP_CODE_UI_EXTENSION_DIR;
const agentDir = process.env.STEP_CODING_AGENT_DIR ?? join(homedir(), ".stepcode", "agent");
const target = override ? resolve(override) : join(agentDir, "extensions", "web-ui");

if (!existsSync(source)) {
	process.stderr.write("dist/extension is missing. Run `npm run build` first.\n");
	process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
if (existsSync(target)) {
	const isDirectory = statSync(target).isDirectory();
	rmSync(target, { recursive: isDirectory, force: true });
}
cpSync(source, target, { recursive: true });

console.log(`Installed web-ui extension → ${target}`);
console.log("Restart step (or run /reload) and type /ui to start the web UI.");
