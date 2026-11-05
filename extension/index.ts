/**
 * `/ui` command: starts the StepCode web UI.
 *
 * The command spawns the bridge (`bridge.cjs`, built from this repository) which
 * serves the React client and drives a `step --mode rpc` agent process over the
 * Agent Client Protocol (ACP).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@step-harness/coding-agent";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const logDir = join(tmpdir(), "step-code-ui");
const logFile = join(logDir, "extension.log");

interface UiProcess {
	child: ChildProcess;
	port: number;
	url: string;
	logFile: string;
}

let running: UiProcess | null = null;

function log(message: string): void {
	try {
		mkdirSync(logDir, { recursive: true });
		appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
	} catch {
		// logging must never break the command
	}
}

function notify(
	ctx: { ui: { notify: (message: string, level: "info" | "warning" | "error") => void } },
	message: string,
	level: "info" | "warning" | "error" = "info",
): void {
	ctx.ui.notify(message, level);
}

function openBrowser(url: string): void {
	const command =
		process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	try {
		const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
		child.on("error", (err) => log(`browser launch failed: ${err.message}`));
		child.unref();
	} catch (err) {
		log(`browser launch failed: ${String(err)}`);
	}
}

function randomToken(): string {
	return `${process.pid}-${Math.floor(Date.now() % 1e9).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface ParsedArgs {
	subcommand: string;
	flags: Record<string, string | true>;
}

function parseArgs(input: string): ParsedArgs {
	const tokens = input.split(/\s+/).filter((token) => token.length > 0);
	const parsed: ParsedArgs = { subcommand: "", flags: {} };
	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		if (!token.startsWith("--")) {
			if (!parsed.subcommand) parsed.subcommand = token;
			continue;
		}
		const name = token.slice(2);
		const next = tokens[i + 1];
		if (next !== undefined && !next.startsWith("--")) {
			parsed.flags[name] = next;
			i += 1;
		} else {
			parsed.flags[name] = true;
		}
	}
	return parsed;
}

/** Wait for the bridge's `ready` line on stdout. */
function waitForReady(child: ChildProcess, timeoutMs: number): Promise<{ url: string; port: number }> {
	return new Promise((resolvePromise, rejectPromise) => {
		let buffer = "";
		const timer = setTimeout(() => {
			cleanup();
			rejectPromise(new Error(`The web UI did not start within ${Math.round(timeoutMs / 1000)}s`));
		}, timeoutMs);

		const onData = (chunk: Buffer): void => {
			buffer += chunk.toString();
			let index = buffer.indexOf("\n");
			while (index >= 0) {
				const line = buffer.slice(0, index).trim();
				buffer = buffer.slice(index + 1);
				index = buffer.indexOf("\n");
				if (!line.startsWith("{")) continue;
				try {
					const message = JSON.parse(line) as { type?: string; url?: string; port?: number; message?: string };
					if (message.type === "ready" && message.url) {
						cleanup();
						resolvePromise({ url: message.url, port: message.port ?? 0 });
						return;
					}
					if (message.type === "error") {
						cleanup();
						rejectPromise(new Error(message.message ?? "bridge failed to start"));
						return;
					}
				} catch {
					// ignore non-JSON output
				}
			}
		};

		function cleanup(): void {
			clearTimeout(timer);
			child.stdout?.off("data", onData);
			child.off("exit", onExit);
		}

		function onExit(code: number | null): void {
			cleanup();
			rejectPromise(new Error(`The web UI bridge exited early (code=${code ?? "null"})`));
		}

		child.stdout?.on("data", onData);
		child.on("exit", onExit);
	});
}

function stopRunning(reason: string): void {
	if (!running) return;
	const current = running;
	running = null;
	try {
		current.child.kill("SIGTERM");
		const timer = setTimeout(() => {
			if (current.child.exitCode === null) current.child.kill("SIGKILL");
		}, 3000);
		timer.unref();
	} catch (err) {
		log(`failed to stop bridge: ${String(err)}`);
	}
	log(`bridge stopped (${reason})`);
}

async function startWebUi(ctx: ExtensionCommandContext, flags: Record<string, string | true>): Promise<void> {
	const nodeBin = typeof flags.node === "string" ? flags.node : (process.env.STEP_UI_NODE ?? "node");
	const bridgeEntry = join(extensionDir, "bridge.cjs");
	const webDir = join(extensionDir, "web");
	if (!existsSync(bridgeEntry)) {
		notify(ctx, "Web UI assets are missing. Run `npm run install:extension` in the step-code-ui repository.", "error");
		return;
	}
	if (!existsSync(webDir)) {
		notify(ctx, "Web UI build output is missing. Run `npm run build` in the step-code-ui repository.", "error");
		return;
	}

	const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
	const port = typeof flags.port === "string" ? Number.parseInt(flags.port, 10) : 4173;
	const bridgeLog = join(logDir, `bridge-${port}.log`);
	const token = randomToken();

	const bridgeArgs = [
		bridgeEntry,
		"--port",
		String(port),
		"--host",
		host,
		"--web-dir",
		webDir,
		"--step-bin",
		process.execPath,
		"--cwd",
		ctx.cwd,
		"--token",
		token,
		"--log-file",
		bridgeLog,
	];
	if (typeof flags.model === "string") bridgeArgs.push("--model", flags.model);
	if (typeof flags.thinking === "string") bridgeArgs.push("--thinking", flags.thinking);
	bridgeArgs.push("--approval", typeof flags.approval === "string" ? flags.approval : "confirm");
	if (typeof flags.session === "string") bridgeArgs.push("--session", flags.session);
	if (typeof flags["session-dir"] === "string") bridgeArgs.push("--session-dir", flags["session-dir"]);
	if (flags.bare === true) bridgeArgs.push("--bare");

	const launch = (args: string[]): ChildProcess =>
		spawn(nodeBin, args, {
			cwd: ctx.cwd,
			// Inherit the environment verbatim: STEPCODE_CONFIG_DIR may be relative
			// (for example ".stepcode"), and the CLI joins it onto the home directory,
			// so absolutising it here corrupts paths such as <config>/marketplaces.
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

	let child = launch(bridgeArgs);
	let ready: { url: string; port: number };
	try {
		ready = await waitForReady(child, 45000);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("EADDRINUSE")) {
			log(`port ${port} in use, retrying on a random port`);
			const retryArgs = bridgeArgs.map((value, index) =>
				bridgeArgs[index - 1] === "--port" ? "0" : value,
			);
			child = launch(retryArgs);
			try {
				ready = await waitForReady(child, 45000);
			} catch (retryError) {
				notify(ctx, `Failed to start the web UI: ${retryError instanceof Error ? retryError.message : String(retryError)}`, "error");
				return;
			}
		} else {
			notify(ctx, `Failed to start the web UI: ${message}`, "error");
			return;
		}
	}

	running = { child, port: ready.port, url: ready.url, logFile: bridgeLog };
	log(`bridge started pid=${child.pid} url=${ready.url}`);
	notify(ctx, `Web UI ready: ${ready.url}`, "info");
	ctx.ui.setStatus?.("step-ui", `Web UI: ${ready.url}`);
	if (flags["no-open"] !== true && flags.open !== true) openBrowser(ready.url);
	else if (flags.open === true) openBrowser(ready.url);

	child.on("exit", (code) => {
		log(`bridge exited code=${code ?? "null"}`);
		if (running?.child === child) {
			running = null;
			ctx.ui.setStatus?.("step-ui", "");
			notify(ctx, "Web UI stopped", "info");
		}
	});
	child.on("error", (err) => {
		log(`bridge error: ${err.message}`);
		notify(ctx, `Web UI error: ${err.message}`, "error");
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("ui", {
		description: "Start the StepCode web UI (/ui [stop|status|open] [--port N] [--host H] [--no-open] [--model M] [--thinking L] [--approval confirm|auto] [--session ID] [--bare] [--node PATH])",
		getArgumentCompletions: (prefix: string) => {
			const options = [
				{ value: "stop", label: "stop — stop the running web UI" },
				{ value: "status", label: "status — show the web UI URL" },
				{ value: "open", label: "open — reopen the browser" },
				{ value: "--port ", label: "--port <number> — bridge port (default 4173)" },
				{ value: "--host ", label: "--host <address> — bind address (default 127.0.0.1)" },
				{ value: "--no-open", label: "--no-open — do not open the browser" },
				{ value: "--model ", label: "--model <pattern> — model for the web UI agent" },
				{ value: "--thinking ", label: "--thinking <level> — thinking level" },
				{ value: "--approval ", label: "--approval confirm|auto — tool approval mode" },
				{ value: "--session ", label: "--session <id> — open an existing session" },
				{ value: "--bare", label: "--bare — start the agent without extensions" },
			];
			const filtered = options.filter((option) => option.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const { subcommand, flags } = parseArgs(args);

			if (subcommand === "stop") {
				if (!running) {
					notify(ctx, "The web UI is not running", "info");
					return;
				}
				stopRunning("user request");
				notify(ctx, "Web UI stopped", "info");
				return;
			}

			if (subcommand === "status") {
				if (!running) {
					notify(ctx, "The web UI is not running", "info");
					return;
				}
				notify(ctx, `Web UI running on ${running.url} (log: ${running.logFile})`, "info");
				return;
			}

			if (subcommand === "open") {
				if (!running) {
					notify(ctx, "The web UI is not running. Start it with /ui", "warning");
					return;
				}
				openBrowser(running.url);
				notify(ctx, `Opening ${running.url}`, "info");
				return;
			}

			if (running) {
				notify(ctx, `Web UI already running: ${running.url}`, "info");
				if (flags.open === true) openBrowser(running.url);
				return;
			}

			if (process.env.STEP_UI_CHILD === "1") {
				notify(ctx, "This agent already runs inside the web UI bridge", "warning");
				return;
			}

			await startWebUi(ctx, flags);
		},
	});

	pi.on("session_shutdown", async () => {
		if (running) stopRunning("session shutdown");
	});
}
