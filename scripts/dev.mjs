#!/usr/bin/env node
/** Dev mode: bridge (fixed token) + vite dev server. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logDir = join(tmpdir(), "step-code-ui");
mkdirSync(logDir, { recursive: true });

const bridgeBundle = join(root, "dist", "bridge.cjs");
if (!existsSync(bridgeBundle)) {
	process.stderr.write("dist/bridge.cjs is missing. Run `npm run build` once before `npm run dev`.\n");
	process.exit(1);
}

const port = process.env.STEP_UI_PORT ?? "4173";
const stepBin = process.env.STEP_UI_STEP_BIN ?? "step";

const bridge = spawn(
	process.execPath,
	[
		bridgeBundle,
		"--port",
		port,
		"--web-dir",
		join(root, "dist", "web"),
		"--step-bin",
		stepBin,
		"--cwd",
		process.cwd(),
		"--token",
		"dev",
		"--log-file",
		join(logDir, "bridge-dev.log"),
	],
	{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);

bridge.stdout.on("data", (chunk) => process.stdout.write(`[bridge] ${chunk}`));
bridge.stderr.on("data", (chunk) => process.stderr.write(`[bridge] ${chunk}`));

const vite = spawn("npx", ["vite"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });

const shutdown = () => {
	bridge.kill();
	vite.kill();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

vite.on("exit", (code) => {
	bridge.kill();
	process.exit(code ?? 0);
});

process.stdout.write(`\nDev mode:\n  web UI   http://127.0.0.1:5173\n  bridge   http://127.0.0.1:${port} (token: dev)\n\n`);
