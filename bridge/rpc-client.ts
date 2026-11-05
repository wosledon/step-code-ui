/**
 * step RPC client: drives `step --mode rpc` over strict JSONL (LF only).
 *
 * The protocol is documented in docs/rpc.md of the coding-agent package:
 * commands go to stdin, one JSON object per line; responses and events come
 * back on stdout. Records are delimited by LF only, so we must not use a line
 * reader that also splits on U+2028/U+2029.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";

export interface RpcEvent {
	type: string;
	[key: string]: unknown;
}

export interface RpcResponse {
	type: "response";
	command: string;
	success: boolean;
	id?: string;
	data?: unknown;
	error?: string;
}

export interface RpcClientOptions {
	stepBin: string;
	cwd: string;
	/** Extra CLI arguments forwarded to the agent (model, thinking, approval, ...). */
	extraArgs?: string[];
	/** Environment overrides for the agent process. */
	env?: Record<string, string | undefined>;
	/** File that receives agent stderr plus bridge-side lifecycle notes. */
	logFile?: string;
}

interface Pending {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	command: string;
	timer?: NodeJS.Timeout;
}

let counter = 0;

function nextId(): string {
	counter += 1;
	return `ui-${process.pid}-${counter}`;
}

export class StepRpcClient extends EventEmitter {
	readonly child: ChildProcess;
	private readonly pending = new Map<string, Pending>();
	private readonly decoder = new StringDecoder("utf8");
	private buffer = "";
	private stopped = false;

	constructor(private readonly options: RpcClientOptions) {
		super();
		this.child = spawn(options.stepBin, ["--mode", "rpc", "--cwd", options.cwd, ...(options.extraArgs ?? [])], {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});

		this.child.stdout?.on("data", (chunk: Buffer) => this.consume(chunk));
		this.child.stderr?.on("data", (chunk: Buffer) => this.log(`[agent stderr] ${chunk.toString()}`));
		this.child.on("error", (err) => {
			this.log(`[agent spawn error] ${err.message}`);
			this.failAll(new Error(`Failed to start agent: ${err.message}`));
			this.emit("exit", null);
		});
		this.child.on("exit", (code, signal) => {
			this.log(`[agent exit] code=${code} signal=${signal ?? ""}`);
			this.failAll(new Error(`Agent exited (code=${code ?? "null"}${signal ? `, signal=${signal}` : ""})`));
			this.emit("exit", code);
		});
	}

	private log(line: string): void {
		if (!this.options.logFile) return;
		try {
			mkdirSync(dirname(this.options.logFile), { recursive: true });
			appendFileSync(this.options.logFile, `${line.replace(/\r?\n$/, "")}\n`);
		} catch {
			// logging must never break the bridge
		}
	}

	/** Split on LF only; tolerate CRLF by trimming a trailing CR. */
	private consume(chunk: Buffer): void {
		this.buffer += this.decoder.write(chunk);
		let index = this.buffer.indexOf("\n");
		while (index >= 0) {
			const line = this.buffer.slice(0, index);
			this.buffer = this.buffer.slice(index + 1);
			this.handleLine(line.endsWith("\r") ? line.slice(0, -1) : line);
			index = this.buffer.indexOf("\n");
		}
	}

	private handleLine(line: string): void {
		if (line.length === 0) return;
		let message: RpcEvent;
		try {
			message = JSON.parse(line) as RpcEvent;
		} catch {
			this.log(`[agent non-json stdout] ${line.slice(0, 500)}`);
			return;
		}
		if (message.type === "response") {
			const response = message as unknown as RpcResponse;
			const key = response.id ?? "";
			const pending = this.pending.get(key);
			if (pending) {
				this.pending.delete(key);
				if (pending.timer) clearTimeout(pending.timer);
				if (response.success) pending.resolve(response.data);
				else pending.reject(new Error(response.error ?? `${response.command} failed`));
			}
			return;
		}
		this.emit("event", message);
		this.emit(message.type, message);
	}

	/** Send a command and resolve with its `data` payload. */
	send<T = unknown>(command: Record<string, unknown>, timeoutMs = 0): Promise<T> {
		if (this.stopped) return Promise.reject(new Error("RPC client is stopped"));
		const id = typeof command.id === "string" ? command.id : nextId();
		const payload = { ...command, id };
		return new Promise<T>((resolve, reject) => {
			const entry: Pending = {
				resolve: resolve as (value: unknown) => void,
				reject,
				command: String(command.type),
			};
			if (timeoutMs > 0) {
				entry.timer = setTimeout(() => {
					this.pending.delete(id);
					reject(new Error(`Command ${String(command.type)} timed out after ${timeoutMs}ms`));
				}, timeoutMs);
			}
			this.pending.set(id, entry);
			try {
				this.child.stdin?.write(`${JSON.stringify(payload)}\n`);
			} catch (err) {
				this.pending.delete(id);
				if (entry.timer) clearTimeout(entry.timer);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	/** Fire-and-forget command (no response awaited). */
	post(command: Record<string, unknown>): void {
		if (this.stopped) return;
		// Commands that already carry an id (for example extension_ui_response)
		// must keep it: it correlates the response with the agent's request.
		const payload = typeof command.id === "string" ? command : { ...command, id: nextId() };
		try {
			this.child.stdin?.write(`${JSON.stringify(payload)}\n`);
		} catch (err) {
			this.log(`[post failed] ${String(err)}`);
		}
	}

	private failAll(error: Error): void {
		for (const [, entry] of this.pending) {
			if (entry.timer) clearTimeout(entry.timer);
			entry.reject(error);
		}
		this.pending.clear();
	}

	get alive(): boolean {
		return !this.stopped && this.child.exitCode === null && this.child.signalCode === null;
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.failAll(new Error("RPC client stopped"));
		try {
			this.child.stdin?.end();
		} catch {
			// ignore
		}
		this.child.kill("SIGTERM");
		const timer = setTimeout(() => {
			if (this.child.exitCode === null) this.child.kill("SIGKILL");
		}, 3000);
		timer.unref();
	}
}
