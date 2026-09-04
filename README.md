# Multi-Agent Studio

Multi-Agent Studio 是运行在 macOS、Windows 和 Linux 上的本地桌面协同开发工具。它把本机已安装的命令行 Agent 注册为能力节点，将项目工作拆成带依赖的任务，并在独立 Git Worktree 中调度执行。

## 功能

- 自动发现 Claude Code、OpenAI Codex、Gemini CLI、Aider 和 OpenCode
- 接入任意本地命令行 Agent
- 使用能力标签、指定 Agent 和并发上限进行路由
- 任务依赖、并行调度、取消、失败阻塞和重试
- 为 Git 项目创建独立 Worktree 与 `agent/<task-id>` 分支
- SQLite 本地持久化和实时任务输出
- Electron 安全 IPC；renderer 不运行 Node.js，也不依赖 Web API

## 环境要求

- Node.js 22.12.0 或更高版本
- npm 10 或更高版本
- Git
- 至少一个可选的 Agent CLI，或使用内置 Demo Agent

项目包含 `.nvmrc`。使用 nvm 时：

```bash
nvm install
nvm use
```

## 安装与开发

```bash
npm install
npm run dev
```

`npm run dev` 会启动仅监听 `127.0.0.1:5173` 的 Vite renderer，并打开 Electron 桌面窗口。应用数据保存在 Electron 的用户数据目录中。

构建并运行生产模式：

```bash
npm start
```

## Agent 参数模板

每行代表一个独立参数，支持以下占位符：

- `{prompt}`：完整任务指令
- `{workspace}`：任务工作目录
- `{task_id}`：任务 ID

例如 Claude Code：

```text
可执行命令：claude
参数：
-p
{prompt}
```

Agent 进程不会使用字符串拼接 shell 命令。Windows 的 `.cmd` shim 和 Unix shebang 由 `cross-spawn` 处理。桌面应用还会补充常见的 npm、nvm、Volta、Bun、Homebrew 和用户级 CLI 路径；也可以直接填写绝对可执行文件路径。

## 质量检查

```bash
npm run lint
npm test
npm run build
npm audit --audit-level=high
```

测试通过 Electron 内置 Node.js 运行，以保证 `better-sqlite3` 使用与桌面运行时相同的原生模块 ABI。

## 打包

```bash
npm run dist:linux
npm run dist:mac
npm run dist:win
```

产物位于 `release/`：

- macOS：DMG（`.dmg`）
- Windows：NSIS 安装程序（`.exe`，x64、arm64）
- Linux：Debian 安装包（`.deb`）

通常应在目标操作系统上构建该平台安装包。正式分发 macOS 和 Windows 安装包前，还需要配置对应平台的代码签名。

## 架构

```text
Electron Renderer (React)
          │ typed IPC
Electron Preload (contextBridge)
          │
Electron Main
  ├── Agent Registry / Capability Router
  ├── DAG Scheduler / Concurrency Control
  ├── Local Process Adapter
  ├── Git Worktree Manager
  └── SQLite Event Store
```
