# StepCode Web UI (`/ui`)

A web UI for the StepCode CLI. Typing `/ui` in the terminal starts a local server that
serves a React + TypeScript client and drives a `step --mode rpc` agent process over the
**Agent Client Protocol (ACP)**, so the browser gets the same capabilities as the CLI:
streaming answers, thinking, tool calls with results, tool approvals, model and thinking
level switching, sessions, compaction, slash commands, image attachments and cancellation.

```
┌─────────────────────┐         ┌──────────────────────────────────────────┐
│ Browser (React+TS)  │  ACP    │ bridge.cjs  (Node process, zero runtime  │
│  ClientSideConnection│◄──────►│  dependencies, bundled by esbuild)       │
│  over WebSocket      │ JSON-RPC│  · serves the built web client           │
└─────────────────────┘         │  · ACP agent implementation              │
                                │  · step RPC client (JSONL over stdio)    │
                                └───────────────┬──────────────────────────┘
                                                │ spawn
                                ┌───────────────▼──────────────────────────┐
                                │ step --mode rpc  (agent: tools, approvals,│
                                │ sessions, skills, MCP, auth)             │
                                └──────────────────────────────────────────┘
```

## Quick start

```bash
npm install
npm run build            # typecheck + bundle bridge + build web client
npm run install:extension # copy dist/extension → ~/.stepcode/agent/extensions/web-ui
```

Then start (or restart) `step` and run:

```
/ui
```

The command prints a URL such as `http://127.0.0.1:4570/?token=<random>` and opens it in
your default browser. The token is required for both the WebSocket and the HTTP API.

## `/ui` command reference

| Form | Effect |
|---|---|
| `/ui` | Start the web UI (port 4173, opens the browser) |
| `/ui status` | Show the running URL and log file |
| `/ui open` | Re-open the browser |
| `/ui stop` | Stop the bridge and its agent process |

Flags: `--port <n>`, `--host <addr>` (default `127.0.0.1`), `--no-open`, `--model <pattern>`,
`--thinking <level>`, `--approval confirm|auto` (default `confirm`), `--session <id>`,
`--session-dir <dir>`, `--bare` (agent without extensions), `--node <path>`.

The bridge shuts down with the CLI session; it also refuses to start inside an agent that
already runs inside the web UI (`STEP_UI_CHILD=1`), which prevents recursion.

## What the web UI covers

| CLI capability | Web UI |
|---|---|
| Streaming answers, thinking traces | message stream + collapsible thinking blocks |
| Tool calls (read/edit/write/bash/grep/…) | tool cards with kind icon, arguments, streamed output, status, file locations, diffs |
| Tool approvals | inline permission card (Allow once / Always allow / Reject once / Always reject / Cancel turn) |
| Approval modes | mode selector: ask / auto approve / auto deny |
| Models | model selector (`session/set_model`), context usage and cost in the header |
| Thinking level | thinking selector (`step/set_thinking_level`) |
| Sessions | new, list, load/replay, fork, clone, switch (`session/load`, `step/*`) |
| Compaction | Compact button (`step/compact`), auto-compaction events |
| Slash commands and skills | keyboard-accessible autocomplete from `available_commands_update` |
| Images | paste, drop or attach images with thumbnails and size validation |
| Appearance | light, dark and system themes; saved preference, no reload needed |
| Languages | Simplified Chinese and English, with a follow-system option and saved preference |
| Cancel / queue | Stop button, queued message counter |
| Notifications, status, widgets | toasts and status bar |
| Bash command execution | through the agent's `bash`/`powershell` tools as tool cards |

## Protocol mapping

ACP methods handled by the bridge:

| ACP | step RPC |
|---|---|
| `initialize` | — (capability negotiation) |
| `authenticate` | — (credentials come from the CLI's own auth store) |
| `session/new` | `new_session` + `get_state` |
| `session/load` | `switch_session` + `get_messages` (history replayed as updates) |
| `session/prompt` | `prompt` (`steer` while streaming) |
| `session/cancel` | `abort` |
| `session/set_mode` | bridge-level approval policy |
| `session/set_model` | `set_model` |
| `fs/read_text_file`, `fs/write_text_file` | `/api/file` (restricted to the session cwd) |
| `extMethod step/*` | `get_state`, `get_messages`, `get_commands`, `set_thinking_level`, `get_thinking_levels`, `compact`, `get_session_stats`, `list_sessions`, `switch_session`, `fork`, `clone`, `export_html`, `steer`, `follow_up`, `abort`, `set_queue_modes` |

step events mapped to ACP updates:

| step event | ACP update |
|---|---|
| `message_update` `text_delta` | `agent_message_chunk` |
| `message_update` `thinking_delta` | `agent_thought_chunk` |
| `message_end` (user) | `user_message_chunk` |
| `tool_execution_start` | `tool_call` |
| `tool_execution_update` / `_end` | `tool_call_update` |
| `extension_ui_request` `confirm` / `select` | `session/request_permission` |
| `extension_ui_request` `input` / `editor` | `extMethod step/ui_prompt` |
| `extension_ui_request` `notify` / `setStatus` / `setWidget` | `extNotification step/notify` / `step/status` / `step/widget` |
| `agent_start` / `agent_settled`, `queue_update`, `compaction_*` | `extNotification step/turn` / `step/queue` / `step/compaction` |
| `get_commands` | `available_commands_update` |

ACP features that are intentionally not used: `terminal/*` (the agent runs commands itself)
and MCP server negotiation (`session/new` accepts `mcpServers` but the agent loads its own
configured servers).

## Repository layout

```
extension/index.ts      CLI extension: registers /ui, spawns the bridge, opens the browser
bridge/
  server.ts             HTTP + WebSocket server, static assets, token auth, ready line
  acp-agent.ts          ACP agent implementation (method + event mapping)
  event-map.ts          step events → ACP updates, tool name → ToolKind
  rpc-client.ts         `step --mode rpc` JSONL client (LF-only framing)
  sessions.ts           session/mode/thinking state, turn mutex
  fs-safe.ts            cwd-restricted file access for the ACP fs methods
web/
  acp/                  WebSocket → ACP Stream, ClientSideConnection, bridge HTTP API
  state/store.tsx       React reducer store (messages, tools, permissions, toasts…)
  components/           Header, Transcript, MessageBubble, ToolCard, PermissionCard,
                        Composer, Toasts, StatusBar, SessionPicker, PromptDialog
  lib/                  markdown + syntax highlighting, formatters
scripts/
  build.mjs             typecheck, esbuild bundle, vite build, stage extension
  dev.mjs               bridge (token `dev`) + vite dev server
  install-extension.mjs copy dist/extension into the CLI extension directory
  smoke.mjs             end-to-end test through the real CLI
```

## Development

```bash
npm run dev        # vite on :5173 (proxies /api and /ws to the bridge on :4173, token "dev")
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run smoke      # end-to-end test (starts step, /ui, and an ACP client)
```

`npm run dev` needs `dist/bridge.mjs`-style assets once, so run `npm run build` before the
first dev session. After changing `extension/`, `bridge/` or `web/`, run `npm run build &&
npm run install:extension`, then `/reload` inside a running `step` session.

## Security

- The bridge binds to `127.0.0.1` by default. `--host 0.0.0.0` exposes the agent to the
  network and should only be used on trusted networks.
- Every run generates a random token that is required by the WebSocket and the HTTP API;
  it is only present in the URL printed by `/ui`.
- `fs/read_text_file` and `fs/write_text_file` are restricted to the session working
  directory (no path traversal).
- The bridge and its agent run as separate processes: a bridge crash does not take the
  terminal session down, and quitting `step` stops both.
- Extensions run with your full permissions. Only install this extension from a copy you
  control.

## Troubleshooting

- **“Web UI assets are missing”** — run `npm run build` and `npm run install:extension`.
- **“The web UI bridge exited early”** — check the log file printed by `/ui status`
  (`%TEMP%\step-code-ui\bridge-<port>.log`); a busy port is retried automatically.
- **`/ui` is not recognised** — the extension lives in `~/.stepcode/agent/extensions/web-ui`;
  run `/reload` or restart `step`. If you also load it with `step -e …`, the CLI registers
  the command twice (`/ui:1`, `/ui:2`); use `--no-extensions` for explicit `-e` runs.
- **Model or auth errors in the web UI** — the agent child inherits the CLI configuration,
  so `step auth status` and `step --list-models` describe what the web UI can use.
