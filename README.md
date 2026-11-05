# StepCode Web UI

**为 StepCode CLI 打造的现代 Web 工作台。**<br>
在浏览器中进行流式对话、查看工具调用与代码差异、管理会话，并享受明暗主题和中英文界面。

[English](./README.en.md) · **简体中文** · [MIT License](./LICENSE)

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](./LICENSE)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg?style=flat-square)](https://www.typescriptlang.org/)
[![ACP](https://img.shields.io/badge/Protocol-ACP-8b82f3.svg?style=flat-square)](https://agentclientprotocol.com/)

在 StepCode 终端中输入 `/ui`，即可启动本地桥接服务和 Web 界面。浏览器通过 **Agent Client Protocol（ACP）** 与 `step --mode rpc` 进程通信，保留 CLI 的模型、工具、审批、命令和会话能力。

## 功能亮点

| 分类 | 能力 |
| --- | --- |
| 对话体验 | 流式回复、推理过程折叠、Markdown 与代码高亮、代码复制、智能跟随滚动 |
| 工具调用 | 紧凑状态行、参数与输出查看、文件定位、ACP Diff 和 unified patch 展示 |
| 工具审批 | 单次/始终允许、单次/始终拒绝、取消本轮，以及可切换的审批模式 |
| 模型控制 | 模型搜索与切换、推理强度设置、上下文用量和会话费用展示 |
| 会话管理 | 新建、搜索、刷新、切换和历史回放；自动记住当前会话 |
| 输入方式 | 斜杠命令补全、键盘导航、消息排队、停止生成 |
| 图片附件 | 粘贴、拖拽或选择图片，支持缩略图、移除和单张 4 MB 大小校验 |
| 个性化 | 浅色/深色/跟随系统主题，简体中文/English/跟随系统语言，均自动保存 |
| 通知反馈 | 应用通知、连接状态、扩展状态和错误提示 |

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- 已安装并完成认证的 StepCode CLI
- npm

### 从源码安装

```bash
git clone https://github.com/wosledon/step-code-ui.git
cd step-code-ui
npm ci
npm run build
npm run install:extension
```

重新启动 StepCode，或在已运行的 CLI 中执行 `/reload`，然后输入：

```text
/ui
```

CLI 会输出类似 `http://127.0.0.1:4173/?token=<random>` 的地址并打开浏览器。URL 中的随机令牌同时用于 HTTP API 和 WebSocket 验证。

## `/ui` 命令

| 命令 | 作用 |
| --- | --- |
| `/ui` | 启动 Web UI，默认监听 `127.0.0.1:4173` 并打开浏览器 |
| `/ui status` | 查看运行地址和日志位置 |
| `/ui open` | 重新打开浏览器 |
| `/ui stop` | 停止桥接服务及其 agent 进程 |

可用参数：

```text
--port <n>                 指定端口
--host <addr>              指定监听地址，默认 127.0.0.1
--no-open                  不自动打开浏览器
--model <pattern>          指定模型
--thinking <level>         指定推理强度
--approval confirm|auto    设置审批策略，默认 confirm
--session <id>             打开指定会话
--session-dir <dir>        指定会话目录
--bare                     不加载其他扩展
--node <path>              指定 Node.js 可执行文件
```

## 键盘与交互

| 操作 | 快捷键/方式 |
| --- | --- |
| 搜索会话 | `Ctrl+K` / `Cmd+K` |
| 聚焦消息输入框 | `Ctrl+J` / `Cmd+J` |
| 发送消息 | `Enter` |
| 输入换行 | `Shift+Enter` |
| 浏览斜杠命令 | `↑` / `↓` |
| 补全选中的命令 | `Tab` |
| 关闭菜单 | `Esc` |
| 展开工具详情 | 点击工具调用行；包含 Diff 时会自动展开一次 |
| 回到最新回复 | 向上阅读后点击“回到最新消息” |

## 工作方式

```text
┌──────────────────┐       ACP over WebSocket       ┌──────────────────┐
│  React Web UI    │ ◄────────────────────────────► │  Local Bridge    │
│  浏览器界面       │                                │  HTTP + WS       │
└──────────────────┘                                └────────┬─────────┘
                                                             │ JSONL over stdio
                                                    ┌────────▼─────────┐
                                                    │ step --mode rpc  │
                                                    │ 工具 / 会话 / 模型 │
                                                    └──────────────────┘
```

- **Web 客户端**：React 19、TypeScript、Tailwind CSS 和 ACP Client。
- **本地桥接**：提供静态页面、WebSocket、令牌验证、ACP 事件映射和工作区文件访问。
- **Step agent**：执行模型调用、工具、审批、命令和会话操作。

## 本地开发

首次启动开发环境前，需要先生成桥接产物：

```bash
npm ci
npm run build
npm run dev
```

开发服务默认位于：

- Web：`http://localhost:5173`
- Bridge：`http://127.0.0.1:4173`，开发令牌为 `dev`

常用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 同时启动 Vite 开发服务器和本地桥接 |
| `npm run build` | 类型检查、打包桥接、构建 Web 并暂存扩展 |
| `npm run typecheck` | 运行 TypeScript 类型检查，不生成文件 |
| `npm run smoke` | 通过真实 Step CLI 执行端到端 smoke 验证 |
| `npm run install:extension` | 将 `dist/extension` 安装到 StepCode 扩展目录 |

修改 `extension/`、`bridge/` 或 `web/` 后，重新执行 `npm run build && npm run install:extension`，再在 StepCode 中执行 `/reload`。

## 项目结构

```text
extension/index.ts          注册 /ui 命令并管理桥接进程
bridge/
  server.ts                 HTTP、WebSocket、静态资源和令牌验证
  acp-agent.ts              ACP 方法与 Step RPC 的双向适配
  event-map.ts              工具事件、输出、位置与 Diff 映射
  rpc-client.ts             step --mode rpc JSONL 客户端
  sessions.ts               会话、模型、审批模式与轮次管理
  fs-safe.ts                限制在工作区内的文件读写
web/
  acp/                      WebSocket 传输与 ACP 客户端
  components/               对话、输入区、工具 Diff、主题和语言组件
  lib/i18n.tsx              中英文案、系统语言检测与持久化
  lib/markdown.tsx          安全 Markdown、代码高亮与复制
  state/store.tsx           消息、工具、会话、权限和通知状态
scripts/
  build.mjs                 完整构建与扩展暂存
  dev.mjs                   本地开发进程
  smoke.mjs                 真实 CLI 端到端验证
```

<details>
<summary><strong>查看主要 ACP 协议映射</strong></summary>

| ACP | Step RPC / 实现 |
| --- | --- |
| `initialize` | 协议版本与文件系统能力协商 |
| `session/new` | `new_session` + `get_state` |
| `session/load` | `switch_session` + `get_messages`，历史作为更新回放 |
| `session/prompt` | `prompt`；生成中可继续发送 |
| `session/cancel` | `abort` |
| `session/set_mode` | 桥接层审批策略 |
| `session/set_model` | `set_model` |
| `fs/read_text_file` / `fs/write_text_file` | 工作区受限的 `/api/file` |
| `step/*` 扩展方法 | 命令、推理强度、压缩、统计、会话和队列等操作 |
| `tool_execution_start` | `tool_call` |
| `tool_execution_update` / `_end` | `tool_call_update`，包含文本输出、位置与 Diff |
| `extension_ui_request` | 权限卡片、输入对话框、通知和状态更新 |

未使用 `terminal/*`：工具命令由 agent 自身执行。`session/new` 接受 `mcpServers`，但 MCP 配置由 agent 自行加载。

</details>

## 安全说明

- 默认仅监听 `127.0.0.1`。使用 `--host 0.0.0.0` 会向网络暴露 agent，请仅在可信网络中使用。
- 每次启动都会生成随机令牌，HTTP API 和 WebSocket 均需验证。
- 文件读写被限制在当前会话工作区内，并防止路径穿越。
- 桥接与 agent 使用独立进程；退出 Step CLI 会同时停止相关进程。
- 扩展继承当前用户权限，请只安装和运行你信任的来源。

## 常见问题

**提示 Web UI assets are missing**<br>
执行 `npm run build && npm run install:extension`，然后重新加载扩展。

**桥接启动失败或端口被占用**<br>
通过 `/ui status` 查看日志。默认端口被占用时会自动尝试其他端口，也可以用 `--port` 手动指定。

**找不到 `/ui` 命令**<br>
确认扩展已安装到 `~/.stepcode/agent/extensions/web-ui`，并执行 `/reload` 或重启 StepCode。若同时使用 `step -e`，注意可能重复注册命令。

**模型或认证错误**<br>
Web UI 的 agent 继承 CLI 配置，可使用 `step auth status` 和 `step --list-models` 检查。

## 贡献

欢迎提交 Issue 和 Pull Request。请保持中英文文档同步，并在提交前运行 `npm run typecheck`；涉及桥接或端到端行为时，建议同时运行 `npm run smoke`。

## License

本项目基于 [MIT License](./LICENSE) 开源。
