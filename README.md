# Agent Flow

> Fork of [Agent Flow](https://github.com/patoles/agent-flow) by [Simon Patole](https://github.com/patoles). Original project licensed under Apache 2.0.

Real-time visualization of Claude Code agent orchestration. Watch your agents think, branch, and coordinate as they work. Standalone Mac desktop app (Electron).

## Features

- **Live agent visualization** — Interactive node graph with real-time tool calls, branching, and return flows powered by D3-force physics
- **Auto-detect Claude Code sessions** — Automatically discovers active sessions across all projects and streams events
- **Dual data sources** — Lightweight HTTP hook server for zero-latency streaming plus JSONL transcript watcher for richer metadata, with automatic deduplication
- **Multi-session support** — Track multiple concurrent agent sessions with tabs
- **Interactive canvas** — Pan, zoom, click agents and tool calls to inspect details
- **Timeline & transcript panels** — Review the full execution timeline, file attention heatmap, and message transcript
- **JSONL log file support** — Point at any JSONL event log to replay or watch agent activity

## Getting Started

1. Build from source (see [Development](#development))
2. Open Agent Flow — it automatically scans all projects in `~/.claude/projects/`
3. Start a Claude Code session anywhere — Agent Flow will pick it up

### Claude Code Hooks

Agent Flow automatically configures Claude Code hooks the first time you open the app. These forward events from Claude Code to Agent Flow for zero-latency streaming.

## Desktop App

The standalone desktop app monitors all Claude Code sessions across your machine.

- **Global session discovery** — scans all projects in `~/.claude/projects/`, not limited to a single workspace
- **Persistent services** — session watchers and hook server run independently of the window lifecycle
- **Built-in settings panel** — configure preferences without editing JSON files
- **macOS native** — application menu, window bounds persistence, App Nap prevention

### Requirements

- macOS

## Project Structure

This is a monorepo with two packages that share a common React frontend:

```
agent-flow/
├── desktop/         # Electron Mac app (esbuild, npm)
└── web/             # Shared React frontend (Vite, pnpm)
```

`desktop/` consumes the `web/` frontend through a Vite build and the Electron bridge adapter.

## Development

### Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/) (for `web/`)
- npm (for `desktop/`)

### Desktop App (Electron)

```bash
cd web && pnpm install
cd ../desktop && npm install
npm run dev        # Starts esbuild watch + Vite dev server + Electron
```

### Build & Package

```bash
# Desktop app (.dmg)
cd desktop && npm run build && npm run package
```

### Tests

```bash
cd web && pnpm test        # Frontend tests (Vitest)
cd desktop && npm test     # Desktop tests (Vitest)
```

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

The name "Agent Flow" and associated logos are trademarks of Simon Patole. See [TRADEMARK.md](TRADEMARK.md) for usage guidelines.
