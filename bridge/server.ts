/**
 * Bridge entry point: serves the built web UI, speaks ACP over WebSocket and
 * drives a `step --mode rpc` child process.
 *
 * Usage (normally started by the `/ui` extension command):
 *   node bridge.mjs --port 4173 --web-dir ./web --step-bin step.exe --cwd <dir>
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { AgentSideConnection } from "@zed-industries/agent-client-protocol";
import type { AnyMessage, Stream } from "@zed-industries/agent-client-protocol";
import { StepAcpAgent } from "./acp-agent.js";
import { StepRpcClient } from "./rpc-client.js";
import { readTextWithin, resolveWithin, writeTextWithin } from "./fs-safe.js";
import { SessionRegistry } from "./sessions.js";

interface BridgeOptions {
	port: number;
	host: string;
	webDir: string;
	stepBin: string;
	cwd: string;
	token: string;
	extraArgs: string[];
	env: Record<string, string | undefined>;
	logFile?: string;
	pinnedSessionId?: string;
}

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
};

function parseArgs(argv: string[]): BridgeOptions {
	const options: BridgeOptions = {
		port: 4173,
		host: "127.0.0.1",
		webDir: "./web",
		stepBin: "step",
		cwd: process.cwd(),
		token: randomUUID(),
		extraArgs: [],
		env: {},
	};
	const extra: string[] = [];
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = (): string => {
			const value = argv[i + 1];
			if (value === undefined) throw new Error(`Missing value for ${arg}`);
			i += 1;
			return value;
		};
		switch (arg) {
			case "--port":
				options.port = Number.parseInt(next(), 10);
				break;
			case "--host":
				options.host = next();
				break;
			case "--web-dir":
				options.webDir = next();
				break;
			case "--step-bin":
				options.stepBin = next();
				break;
			case "--cwd":
				options.cwd = resolve(next());
				break;
			case "--token":
				options.token = next();
				break;
			case "--model":
				extra.push("--model", next());
				break;
			case "--thinking":
				extra.push("--thinking", next());
				break;
			case "--approval":
				extra.push("--approval-mode", next());
				break;
			case "--session":
				options.pinnedSessionId = next();
				extra.push("--session", next());
				break;
			case "--session-dir":
				extra.push("--session-dir", next());
				break;
			case "--bare":
				extra.push("--no-extensions");
				break;
			case "--env": {
				const assignment = next();
				const index = assignment.indexOf("=");
				if (index > 0) options.env[assignment.slice(0, index)] = assignment.slice(index + 1);
				break;
			}
			case "--log-file":
				options.logFile = next();
				break;
			default:
				if (arg.startsWith("--extra-")) {
					extra.push(`--${arg.slice("--extra-".length)}`, next());
				} else {
					throw new Error(`Unknown argument: ${arg}`);
				}
		}
	}
	options.extraArgs = extra;
	return options;
}

function createLogger(logFile?: string): (line: string) => void {
	return (line: string) => {
		const stamped = `${new Date().toISOString()} ${line}`;
		if (logFile) {
			try {
				mkdirSync(dirname(logFile), { recursive: true });
				appendFileSync(logFile, `${stamped}\n`);
			} catch {
				// never fail on logging
			}
		}
		if (process.env.STEP_UI_DEBUG) process.stderr.write(`${stamped}\n`);
	};
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(body),
	});
	res.end(body);
}

async function serveStatic(webDir: string, urlPath: string, res: ServerResponse): Promise<void> {
	const decoded = decodeURIComponent(urlPath.split("?")[0]);
	const relative = normalize(decoded).replace(/^([/\\])+/, "");
	const candidate = resolve(join(webDir, relative));
	if (candidate !== webDir && !candidate.startsWith(webDir + sep)) {
		sendJson(res, 403, { error: "forbidden" });
		return;
	}
	const isFile = async (path: string): Promise<boolean> => {
		try {
			return (await stat(path)).isFile();
		} catch {
			return false;
		}
	};
	const target = (await isFile(candidate)) ? candidate : join(webDir, "index.html");
	if (!(await isFile(target))) {
		sendJson(res, 404, { error: "web assets not found; run npm run build" });
		return;
	}
	const body = await readFile(target);
	res.writeHead(200, {
		"content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
		"content-length": body.length,
		"cache-control": target.endsWith("index.html") ? "no-store" : "public, max-age=300",
	});
	res.end(body);
}

/** Bridge a WebSocket into the Web Streams pair expected by the ACP SDK. */
function webSocketStream(ws: import("ws").WebSocket): Stream {
	let controller: ReadableStreamDefaultController<AnyMessage> | null = null;
	const readable = new ReadableStream<AnyMessage>({
		start(streamController) {
			controller = streamController;
		},
		cancel() {
			ws.close();
		},
	});
	const writable = new WritableStream<AnyMessage>({
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
			// ignore malformed frames
		}
	});
	ws.on("close", () => {
		try {
			controller?.close();
		} catch {
			// already closed
		}
	});
	ws.on("error", () => {
		try {
			controller?.error(new Error("WebSocket error"));
		} catch {
			// already closed
		}
	});
	return { readable, writable } as Stream;
}
async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const log = createLogger(options.logFile);
	const webDir = resolve(options.webDir);
	log(`[bridge] starting port=${options.port} host=${options.host} cwd=${options.cwd} step=${options.stepBin}`);

	const rpc = new StepRpcClient({
		stepBin: options.stepBin,
		cwd: options.cwd,
		extraArgs: options.extraArgs,
		env: { STEP_UI_CHILD: "1", ...options.env },
		logFile: options.logFile,
	});
	const sessions = new SessionRegistry();
	const turnOwner: { current: StepAcpAgent | null } = { current: null };

	const server = createServer((req, res) => {
		void handleRequest(req, res);
	});

	async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		const token = url.searchParams.get("token") ?? req.headers["x-step-ui-token"] ?? "";
		const authorized = token === options.token;

		if (url.pathname === "/health") {
			sendJson(res, 200, { ok: true, agent: rpc.alive });
			return;
		}
		if (url.pathname.startsWith("/api/")) {
			if (!authorized) {
				sendJson(res, 401, { error: "invalid token" });
				return;
			}
			await handleApi(url, req, res);
			return;
		}
		if (req.method !== "GET" && req.method !== "HEAD") {
			sendJson(res, 405, { error: "method not allowed" });
			return;
		}
		await serveStatic(webDir, url.pathname, res);
	}

	async function readBody(req: IncomingMessage): Promise<string> {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		return Buffer.concat(chunks).toString("utf8");
	}

	/** ACP `fs/*` methods are client-side, so the browser proxies them here. */
	async function handleApi(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			if (url.pathname === "/api/info") {
				sendJson(res, 200, {
					cwd: options.cwd,
					host: options.host,
					port: options.port,
					pinnedSessionId: options.pinnedSessionId ?? null,
					agent: rpc.alive,
					sessions: sessions.all().map((session) => ({
						sessionId: session.sessionId,
						sessionFile: session.sessionFile ?? null,
						mode: session.mode,
					})),
				});
				return;
			}
			if (url.pathname === "/api/file" && req.method === "GET") {
				const path = url.searchParams.get("path") ?? "";
				if (!path) throw new Error("path is required");
				const line = url.searchParams.get("line");
				const limit = url.searchParams.get("limit");
				const content = await readTextWithin(options.cwd, path, {
					line: line ? Number.parseInt(line, 10) : null,
					limit: limit ? Number.parseInt(limit, 10) : null,
				});
				sendJson(res, 200, { path: resolveWithin(options.cwd, path), content });
				return;
			}
			if (url.pathname === "/api/file" && (req.method === "PUT" || req.method === "POST")) {
				const payload = JSON.parse(await readBody(req)) as { path?: string; content?: string };
				if (!payload.path) throw new Error("path is required");
				await writeTextWithin(options.cwd, payload.path, payload.content ?? "");
				sendJson(res, 200, { path: resolveWithin(options.cwd, payload.path) });
				return;
			}
			sendJson(res, 404, { error: `unknown endpoint: ${url.pathname}` });
		} catch (err) {
			sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
		}
	}

	const wss = new WebSocketServer({ noServer: true });
	server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		if (url.pathname !== "/ws") {
			socket.destroy();
			return;
		}
		const token = url.searchParams.get("token") ?? "";
		if (token !== options.token) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit("connection", ws, req);
		});
	});

	wss.on("connection", (ws) => {
		log("[bridge] client connected");
		let agent: StepAcpAgent | null = null;
		new AgentSideConnection((conn) => {
			agent = new StepAcpAgent(conn, { rpc, sessions, turnOwner, cwd: options.cwd, pinnedSessionId: options.pinnedSessionId, log });
			return agent;
		}, webSocketStream(ws));
		const dispose = (): void => {
			agent?.dispose();
			agent = null;
		};
		ws.on("close", () => {
			log("[bridge] client disconnected");
			dispose();
		});
		ws.on("error", (err) => {
			log(`[bridge] websocket error: ${err.message}`);
			dispose();
		});
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(options.port, options.host, () => resolveListen());
	});
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : options.port;
	const displayHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
	const url = `http://${displayHost}:${port}/?token=${encodeURIComponent(options.token)}`;
	log(`[bridge] listening on ${url}`);

	// Make sure the agent answers before declaring readiness.
	try {
		await rpc.send({ type: "get_state" }, 30000);
	} catch (err) {
		log(`[bridge] agent warmup failed: ${String(err)}`);
		process.stdout.write(`${JSON.stringify({ type: "error", message: `agent warmup failed: ${String(err)}` })}\n`);
		rpc.stop();
		server.close();
		process.exitCode = 1;
		return;
	}

	process.stdout.write(`${JSON.stringify({ type: "ready", url, port, token: options.token })}\n`);

	const shutdown = (): void => {
		log("[bridge] shutting down");
		rpc.stop();
		server.close();
		wss.close();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	process.stdout.write(`${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) })}\n`);
	process.exitCode = 1;
});
