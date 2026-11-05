#!/usr/bin/env node
/**
 * End-to-end smoke test: drives the real CLI through `/ui` and talks ACP to the
 * bridge from Node, exactly like the browser client does.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { ClientSideConnection } from "@zed-industries/agent-client-protocol";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stepBin = process.env.STEP_UI_STEP_BIN ?? "step";
const port = 4300 + Math.floor(Math.random() * 300);
const timeoutMs = Number(process.env.STEP_UI_SMOKE_TIMEOUT ?? 240000);

const results = [];
function check(name, condition, detail = "") {
	results.push({ name, ok: Boolean(condition), detail });
	const mark = condition ? "PASS" : "FAIL";
	process.stdout.write(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}\n`);
}

function sleep(ms) {
	return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** JSONL driver for `step --mode rpc`. */
function createAgentProcess(extensionPath, cwd) {
	const child = spawn(stepBin, ["--mode", "rpc", "--no-session", "--no-extensions", "-e", extensionPath], {
		cwd,
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	const events = [];
	const waiters = [];
		let buffer = "";
	child.stdout.on("data", (chunk) => {
		buffer += chunk.toString();
		let index = buffer.indexOf("\n");
		while (index >= 0) {
			const line = buffer.slice(0, index).trim();
			buffer = buffer.slice(index + 1);
			index = buffer.indexOf("\n");
			if (!line) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			events.push(message);
			if (message.type === "extension_ui_request" && message.method === "notify") {
				process.stdout.write(`[agent notify:${message.notifyType}] ${String(message.message).slice(0, 200)}\n`);
			}
			for (let i = waiters.length - 1; i >= 0; i -= 1) {
				if (waiters[i].predicate(message)) {
					waiters[i].resolve(message);
					waiters.splice(i, 1);
				}
			}
		}
	});
	child.stderr.on("data", (chunk) => process.stderr.write(`[agent stderr] ${chunk}`));

	return {
		child,
		events,
		send(command) {
			child.stdin.write(`${JSON.stringify(command)}\n`);
		},
		waitFor(predicate, timeout = timeoutMs) {
			const existing = events.find(predicate);
			if (existing) return Promise.resolve(existing);
			return new Promise((resolveWait, rejectWait) => {
				const timer = setTimeout(() => rejectWait(new Error("timed out waiting for agent event")), timeout);
				waiters.push({
					predicate,
					resolve: (message) => {
						clearTimeout(timer);
						resolveWait(message);
					},
				});
			});
		},
	};
}

function webSocketStream(ws) {
	let controller = null;
	const readable = new ReadableStream({
		start(streamController) {
			controller = streamController;
		},
		cancel() {
			ws.close();
		},
	});
	const writable = new WritableStream({
		write(message) {
			ws.send(JSON.stringify(message));
		},
		close() {
			ws.close();
		},
		abort() {
			ws.close();
		},
	});
	ws.on("message", (data) => {
		try {
			controller?.enqueue(JSON.parse(data.toString()));
		} catch {
			// ignore
		}
	});
	ws.on("close", () => {
		try {
			controller?.close();
		} catch {
			// ignore
		}
	});
	ws.on("error", () => {
		try {
			controller?.error(new Error("websocket error"));
		} catch {
			// ignore
		}
	});
	return { readable, writable };
}

class RecordingClient {
	constructor() {
		this.updates = [];
		this.toolCalls = [];
		this.permissions = [];
		this.text = "";
		this.thinking = "";
		this.modes = [];
		this.commands = [];
	}

	async sessionUpdate(notification) {
		const update = notification.update;
		this.updates.push(update.sessionUpdate);
		switch (update.sessionUpdate) {
			case "agent_message_chunk":
				this.text += update.content?.text ?? "";
				return;
			case "agent_thought_chunk":
				this.thinking += update.content?.text ?? "";
				return;
			case "tool_call":
				this.toolCalls.push({ id: update.toolCallId, title: update.title, kind: update.kind, status: update.status });
				return;
			case "tool_call_update":
				return;
			case "current_mode_update":
				this.modes.push(update.currentModeId);
				return;
			case "available_commands_update":
				this.commands = update.availableCommands ?? [];
				return;
			default:
				return;
		}
	}

	async requestPermission(params) {
		this.permissions.push({
			toolCallId: params.toolCall.toolCallId,
			title: params.toolCall.title,
			options: params.options.map((option) => option.optionId),
		});
		const allowOnce = params.options.find((option) => option.kind === "allow_once");
		return { outcome: { outcome: "selected", optionId: allowOnce ? allowOnce.optionId : params.options[0].optionId } };
	}

	async extNotification() {}

	async extMethod(method) {
		if (method === "step/ui_prompt") return { value: "smoke" };
		throw new Error(`unsupported ext method ${method}`);
	}

	async readTextFile() {
		return { content: "" };
	}

	async writeTextFile() {
		return {};
	}
}

async function main() {
	const staged = join(root, "dist", "extension");
	if (!existsSync(staged)) {
		process.stderr.write("dist/extension is missing. Run `npm run build` first.\n");
		process.exit(1);
	}

	const workdir = mkdtempSync(join(tmpdir(), "step-ui-smoke-"));
	const extensionDir = join(workdir, "extension");
	cpSync(staged, extensionDir, { recursive: true });
	process.stdout.write(`workspace: ${workdir}\n`);

	const agent = createAgentProcess(join(extensionDir, "index.ts"), workdir);
	let bridgeUrl = null;

	try {
		// Wait until the agent runtime (and its extensions) are up before sending /ui.
		agent.send({ type: "get_state" });
		await agent.waitFor((message) => message.type === "response" && message.command === "get_state", 60000);
		agent.send({ type: "prompt", message: `/ui --port ${port} --no-open --approval confirm` });
		const ready = await agent.waitFor(
			(message) =>
				message.type === "extension_ui_request" &&
				message.method === "notify" &&
				String(message.message ?? "").includes("Web UI ready"),
			90000,
		);
		const match = /https?:\/\/\S+/.exec(String(ready.message));
		bridgeUrl = match ? match[0] : null;
		check("/ui starts the bridge and reports a URL", Boolean(bridgeUrl), bridgeUrl ?? "");

		const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
		check("bridge health endpoint responds", health?.ok === true, JSON.stringify(health));

		const ws = new WebSocket(bridgeUrl.replace(/^http/, "ws").replace("/?token=", "/ws?token="));
		await new Promise((resolveWs, rejectWs) => {
			ws.once("open", resolveWs);
			ws.once("error", rejectWs);
		});
		const client = new RecordingClient();
		const conn = new ClientSideConnection(() => client, webSocketStream(ws));

		const init = await conn.initialize({
			protocolVersion: 1,
			clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
		});
		check("ACP initialize negotiates a protocol version", typeof init.protocolVersion === "number", `v${init.protocolVersion}`);

		const before = await conn.extMethod("step/get_state", {});
		check("step/get_state works before a session exists", before.cwd === workdir, String(before.cwd));

		const session = await conn.newSession({ cwd: workdir, mcpServers: [] });
		check("session/new returns a session id", typeof session.sessionId === "string" && session.sessionId.length > 0, session.sessionId);
		check("session/new advertises modes", Array.isArray(session.modes?.availableModes) && session.modes.availableModes.length > 0);
		check("session/new advertises models", Array.isArray(session.models?.availableModels) && session.models.availableModels.length > 0);

		const promptResponse = await conn.prompt({
			sessionId: session.sessionId,
			prompt: [
				{
					type: "text",
					text: "Create a file named smoke.txt in the current directory containing exactly the text hello. Then reply with the single word DONE.",
				},
			],
		});
		check("session/prompt returns end_turn", promptResponse.stopReason === "end_turn", promptResponse.stopReason);
		check("agent produced assistant text", client.text.includes("DONE"), client.text.slice(0, 80));
		check("a tool call was reported", client.toolCalls.length > 0, client.toolCalls.map((tool) => tool.title).join(", "));
		check("tool approval was requested", client.permissions.length > 0, JSON.stringify(client.permissions[0] ?? null));

		const smokeFile = join(workdir, "smoke.txt");
		check("the agent created smoke.txt", existsSync(smokeFile));
		if (existsSync(smokeFile)) {
			check("smoke.txt contains hello", readFileSync(smokeFile, "utf8").includes("hello"), readFileSync(smokeFile, "utf8").trim());
		}

		const commands = await conn.extMethod("step/get_commands", { sessionId: session.sessionId });
		check("step/get_commands lists commands", Array.isArray(commands.commands) && commands.commands.length > 0, `${commands.commands?.length ?? 0} commands`);

		const state = await conn.extMethod("step/get_state", { sessionId: session.sessionId });
		check("step/get_state reports session stats", Boolean(state.stats), JSON.stringify(state.stats?.contextUsage ?? {}));

		const listed = await conn.extMethod("step/list_sessions", {});
		check("step/list_sessions finds the session", (listed.sessions ?? []).some((entry) => entry.sessionId === session.sessionId));

		const beforeLoad = client.updates.length;
		await conn.loadSession({ sessionId: session.sessionId, cwd: workdir, mcpServers: [] });
		check("session/load replays history", client.updates.length > beforeLoad, `${client.updates.length - beforeLoad} updates`);

		const cancelClient = new RecordingClient();
		const cancelSocket = new WebSocket(bridgeUrl.replace(/^http/, "ws").replace("/?token=", "/ws?token="));
		await new Promise((resolveCancelSocket, rejectCancelSocket) => {
			cancelSocket.once("open", resolveCancelSocket);
			cancelSocket.once("error", rejectCancelSocket);
		});
		const cancelConnection = new ClientSideConnection(() => cancelClient, webSocketStream(cancelSocket));
		const cancelSession = await cancelConnection.newSession({ cwd: workdir, mcpServers: [] });
		const cancelPromise = cancelConnection.prompt({
			sessionId: cancelSession.sessionId,
			prompt: [{ type: "text", text: "Count from 1 to 40 slowly, one number per line." }],
		});
		await sleep(1500);
		await cancelConnection.cancel({ sessionId: cancelSession.sessionId });
		const cancelResponse = await cancelPromise;
		check("session/cancel returns cancelled", cancelResponse.stopReason === "cancelled", cancelResponse.stopReason);

		cancelSocket.close();
		ws.close();
	} finally {
		agent.send({ type: "abort" });
		agent.child.kill();
		await sleep(500);
		try {
			rmSync(workdir, { recursive: true, force: true });
		} catch {
			// best effort
		}
	}

	const failed = results.filter((result) => !result.ok);
	process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
	if (failed.length > 0) {
		process.stdout.write(`failed: ${failed.map((result) => result.name).join(", ")}\n`);
		process.exitCode = 1;
	}
}

main().catch((err) => {
	process.stderr.write(`smoke test error: ${err instanceof Error ? err.stack : String(err)}\n`);
	process.exitCode = 1;
});
