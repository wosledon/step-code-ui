/** WebSocket transport adapted to the ACP `Stream` shape. */
import type { AnyMessage, Stream } from "@zed-industries/agent-client-protocol";

export function webSocketStream(ws: WebSocket): Stream {
	let controller: ReadableStreamDefaultController<AnyMessage> | null = null;
	const outbox: string[] = [];

	const flush = (): void => {
		while (outbox.length > 0 && ws.readyState === WebSocket.OPEN) {
			ws.send(outbox.shift() as string);
		}
	};

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
			// Buffer until the socket is open so early ACP requests are not lost.
			outbox.push(JSON.stringify(message));
			flush();
		},
		close() {
			ws.close();
		},
		abort() {
			ws.close();
		},
	});
	ws.addEventListener("open", flush);
	ws.addEventListener("message", (event) => {
		try {
			controller?.enqueue(JSON.parse(String(event.data)) as AnyMessage);
		} catch {
			// ignore malformed frames
		}
	});
	ws.addEventListener("close", () => {
		try {
			controller?.close();
		} catch {
			// already closed
		}
	});
	ws.addEventListener("error", () => {
		try {
			controller?.error(new Error("WebSocket error"));
		} catch {
			// already closed
		}
	});
	return { readable, writable } as Stream;
}
