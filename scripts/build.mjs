#!/usr/bin/env node
/** Build: typecheck, bundle the bridge, build the web client. */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: "inherit", cwd: root, shell: process.platform === "win32", ...options });
	if (result.status !== 0) {
		process.stderr.write(`\n${command} ${args.join(" ")} failed with code ${result.status}\n`);
		process.exit(result.status ?? 1);
	}
}

console.log("→ typecheck");
run("npx", ["tsc", "--noEmit"]);

console.log("→ bundle bridge");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
run("npx", [
	"esbuild",
	"bridge/server.ts",
	"--bundle",
	"--platform=node",
	"--format=cjs",
	"--target=node20",
	"--packages=bundle",
	"--outfile=dist/bridge.cjs",
	"--log-level=warning",
]);

console.log("→ build web client");
run("npx", ["vite", "build"]);

const webDir = join(dist, "web");
if (!existsSync(webDir)) {
	process.stderr.write("vite did not produce dist/web\n");
	process.exit(1);
}

console.log("→ stage extension");
const extensionDir = join(dist, "extension");
mkdirSync(extensionDir, { recursive: true });
cpSync(join(root, "extension", "index.ts"), join(extensionDir, "index.ts"));
cpSync(join(root, "extension", "step-harness.d.ts"), join(extensionDir, "step-harness.d.ts"));
cpSync(join(dist, "bridge.cjs"), join(extensionDir, "bridge.cjs"));
cpSync(webDir, join(extensionDir, "web"), { recursive: true });

console.log("\nBuild complete:");
console.log("  dist/bridge.cjs        bridge bundle (dependencies inlined)");
console.log("  dist/web/              web client assets");
console.log("  dist/extension/        staged extension for installation");
