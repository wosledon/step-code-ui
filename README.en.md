# StepCode Web UI

**A modern web workspace for the StepCode CLI.**<br>
Chat with streaming responses, inspect tool calls and code diffs, manage sessions, and choose between light/dark themes and Chinese/English interfaces.

**English** · [简体中文](./README.md) · [MIT License](./LICENSE)

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](./LICENSE)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg?style=flat-square)](https://www.typescriptlang.org/)
[![ACP](https://img.shields.io/badge/Protocol-ACP-8b82f3.svg?style=flat-square)](https://agentclientprotocol.com/)

Type `/ui` in the StepCode terminal to start a local bridge and web client. The browser communicates with a `step --mode rpc` process over the **Agent Client Protocol (ACP)**, preserving the CLI's models, tools, approvals, commands, and sessions.

## Highlights

| Area | Capabilities |
| --- | --- |
| Conversation | Streaming responses, collapsible reasoning, Markdown and syntax highlighting, code copying, smart scroll following |
| Tool calls | Compact status rows, optional arguments and output, file locations, ACP diffs and unified patches |
| Tool approvals | Allow/reject once or always, cancel a turn, and switch approval modes |
| Model controls | Searchable model picker, thinking levels, context usage, and session cost |
| Sessions | Create, search, refresh, switch, and replay history; restore the current session |
| Input | Slash-command completion, keyboard navigation, message queuing, and cancellation |
| Images | Paste, drop, or select images with thumbnails, removal, and a 4 MB per-image limit |
| Personalization | Light/dark/system themes and Simplified Chinese/English/system language, all persisted |
| Feedback | App notifications, connection state, extension status, and error messages |

## Quick start

### Prerequisites

- Node.js 20 or newer
- StepCode CLI, installed and authenticated
- npm

### Install from source

```bash
git clone https://github.com/wosledon/step-code-ui.git
cd step-code-ui
npm ci
npm run build
npm run install:extension
```

Restart StepCode, or run `/reload` in an existing CLI session, then enter:

```text
/ui
```

The CLI prints a URL such as `http://127.0.0.1:4173/?token=<random>` and opens your browser. The random token is required by both the HTTP API and WebSocket connection.

## The `/ui` command

| Command | Effect |
| --- | --- |
| `/ui` | Start the web UI on `127.0.0.1:4173` and open the browser |
| `/ui status` | Show the running URL and log location |
| `/ui open` | Reopen the browser |
| `/ui stop` | Stop the bridge and its agent process |

Available flags:

```text
--port <n>                 Set the listening port
--host <addr>              Set the host, default 127.0.0.1
--no-open                  Do not open a browser automatically
--model <pattern>          Select a model
--thinking <level>         Set the thinking level
--approval confirm|auto    Set the approval policy, default confirm
--session <id>             Open a specific session
--session-dir <dir>        Set the session directory
--bare                     Start the agent without other extensions
--node <path>              Set the Node.js executable
```

## Keyboard and interaction

| Action | Shortcut / gesture |
| --- | --- |
| Search sessions | `Ctrl+K` / `Cmd+K` |
| Focus the composer | `Ctrl+J` / `Cmd+J` |
| Send a message | `Enter` |
| Insert a newline | `Shift+Enter` |
| Navigate slash commands | `↑` / `↓` |
| Complete the selected command | `Tab` |
| Close a menu | `Esc` |
| Inspect a tool call | Click its row; diffs auto-expand once when they arrive |
| Return to the latest response | Use “Jump to latest” after scrolling upward |

## How it works

```text
┌──────────────────┐       ACP over WebSocket       ┌──────────────────┐
│  React Web UI    │ ◄────────────────────────────► │  Local Bridge    │
│  Browser client  │                                │  HTTP + WS       │
└──────────────────┘                                └────────┬─────────┘
                                                             │ JSONL over stdio
                                                    ┌────────▼─────────┐
                                                    │ step --mode rpc  │
                                                    │ Tools / sessions │
                                                    └──────────────────┘
```

- **Web client**: React 19, TypeScript, Tailwind CSS, and the ACP client.
- **Local bridge**: static assets, WebSocket transport, token authentication, ACP event mapping, and workspace file access.
- **Step agent**: model calls, tools, approvals, commands, and session operations.

## Development

Build the bridge assets before starting the development environment for the first time:

```bash
npm ci
npm run build
npm run dev
```

Default development addresses:

- Web: `http://localhost:5173`
- Bridge: `http://127.0.0.1:4173`, using the development token `dev`

Common commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite and the local bridge |
| `npm run build` | Typecheck, bundle the bridge, build the web client, and stage the extension |
| `npm run typecheck` | Run TypeScript checks without emitting files |
| `npm run smoke` | Run an end-to-end smoke test through the real Step CLI |
| `npm run install:extension` | Copy `dist/extension` into the StepCode extension directory |

After changing `extension/`, `bridge/`, or `web/`, run `npm run build && npm run install:extension`, then `/reload` in StepCode.

## Project structure

```text
extension/index.ts          Register /ui and manage the bridge process
bridge/
  server.ts                 HTTP, WebSocket, static assets, and token authentication
  acp-agent.ts              Two-way adapter between ACP and Step RPC
  event-map.ts              Tool events, output, locations, and diff mapping
  rpc-client.ts             step --mode rpc JSONL client
  sessions.ts               Sessions, models, approval modes, and turn management
  fs-safe.ts                Workspace-restricted file access
web/
  acp/                      WebSocket transport and ACP client
  components/               Chat, composer, tool diffs, theme, and language controls
  lib/i18n.tsx              Chinese/English messages, system detection, and persistence
  lib/markdown.tsx          Sanitized Markdown, syntax highlighting, and copying
  state/store.tsx           Messages, tools, sessions, permissions, and notifications
scripts/
  build.mjs                 Production build and extension staging
  dev.mjs                   Development processes
  smoke.mjs                 End-to-end verification through the real CLI
```

<details>
<summary><strong>View the main ACP protocol mappings</strong></summary>

| ACP | Step RPC / implementation |
| --- | --- |
| `initialize` | Protocol version and file-system capability negotiation |
| `session/new` | `new_session` + `get_state` |
| `session/load` | `switch_session` + `get_messages`, replayed as updates |
| `session/prompt` | `prompt`; additional messages can be sent while generating |
| `session/cancel` | `abort` |
| `session/set_mode` | Bridge-level approval policy |
| `session/set_model` | `set_model` |
| `fs/read_text_file` / `fs/write_text_file` | Workspace-restricted `/api/file` |
| `step/*` extension methods | Commands, thinking levels, compaction, stats, sessions, queues, and more |
| `tool_execution_start` | `tool_call` |
| `tool_execution_update` / `_end` | `tool_call_update` with text, locations, and diffs |
| `extension_ui_request` | Permission cards, input dialogs, notifications, and status updates |

`terminal/*` is intentionally unused because the agent executes its own commands. `session/new` accepts `mcpServers`, but the agent loads its own MCP configuration.

</details>

## Security

- The bridge listens on `127.0.0.1` by default. `--host 0.0.0.0` exposes the agent to the network; use it only on trusted networks.
- Every run generates a random token required by both HTTP and WebSocket requests.
- File access is restricted to the current session workspace and protected against path traversal.
- The bridge and agent run in separate processes and stop when the Step CLI exits.
- Extensions inherit your user permissions. Install and run only sources you trust.

## Troubleshooting

**“Web UI assets are missing”**<br>
Run `npm run build && npm run install:extension`, then reload the extension.

**The bridge fails to start or the port is busy**<br>
Check the log shown by `/ui status`. A busy default port is retried automatically; you can also set one with `--port`.

**`/ui` is not recognized**<br>
Confirm the extension is installed at `~/.stepcode/agent/extensions/web-ui`, then run `/reload` or restart StepCode. Loading it again with `step -e` may register duplicate commands.

**Model or authentication errors**<br>
The web agent inherits the CLI configuration. Check it with `step auth status` and `step --list-models`.

## Contributing

Issues and pull requests are welcome. Keep the Chinese and English documentation in sync, and run `npm run typecheck` before submitting. For bridge or end-to-end changes, also run `npm run smoke` when possible.

## License

Released under the [MIT License](./LICENSE).
