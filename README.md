# Agent Flow

Real-time visualization of Claude Code agent orchestration. Watch your agents think, branch, and coordinate as they work. Available as a **VS Code extension** and a **standalone Mac desktop app**. [Demo video here](https://www.youtube.com/watch?v=Ud6eDrFN-TA).

![Agent Flow visualization](https://res.cloudinary.com/dxlvclh9c/image/upload/v1773924941/screenshot_e7yox3.png)

## Why Agent Flow?

I built Agent Flow while developing [CraftMyGame](https://craftmygame.com), a game creation platform driven by AI agents. Debugging agent behavior was painful, so we made it visual. Now we're sharing it.

Claude Code is powerful, but its execution is a black box — you see the final result, not the journey. Agent Flow makes the invisible visible:

- **Understand agent behavior** — See how Claude breaks down problems, which tools it reaches for, and how subagents coordinate
- **Debug tool call chains** — When something goes wrong, trace the exact sequence of decisions and tool calls that led there
- **See where time is spent** — Identify slow tool calls, unnecessary branching, or redundant work at a glance
- **Learn by watching** — Build intuition for how to write better prompts by observing how Claude interprets and executes them

## Features

- **Live agent visualization** — Interactive node graph with real-time tool calls, branching, and return flows powered by D3-force physics
- **Two deployment targets** — Use as a VS Code extension or a standalone Mac desktop app — same visualization, your choice of environment
- **Auto-detect Claude Code sessions** — Automatically discovers active sessions and streams events (workspace-scoped in VS Code, all projects in desktop)
- **Dual data sources** — Lightweight HTTP hook server for zero-latency streaming plus JSONL transcript watcher for richer metadata, with automatic deduplication
- **Multi-session support** — Track multiple concurrent agent sessions with tabs
- **Interactive canvas** — Pan, zoom, click agents and tool calls to inspect details
- **Timeline & transcript panels** — Review the full execution timeline, file attention heatmap, and message transcript
- **JSONL log file support** — Point at any JSONL event log to replay or watch agent activity

## Getting Started

### VS Code Extension

1. Install **Agent Flow** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=simon-p.agent-flow)
2. Open the Command Palette (`Cmd+Shift+P`) and run **Agent Flow: Open Agent Flow**
3. Start a Claude Code session in your workspace — Agent Flow will auto-detect it

### Desktop App (macOS)

1. Download the `.dmg` from [Releases](https://github.com/patoles/agent-flow/releases), or build from source (see [Development](#development))
2. Open Agent Flow — it automatically scans all projects in `~/.claude/projects/`
3. Start a Claude Code session anywhere — Agent Flow will pick it up

### Claude Code Hooks

Agent Flow automatically configures Claude Code hooks the first time you open the panel. These forward events from Claude Code to Agent Flow for zero-latency streaming.

In VS Code, you can manually reconfigure hooks by running **Agent Flow: Configure Claude Code Hooks** from the Command Palette.

### JSONL Event Log

You can also point Agent Flow at a JSONL event log file:

- **VS Code**: Set `agentVisualizer.eventLogPath` in your settings to the path of a `.jsonl` file
- **Desktop**: Configure the path in the built-in settings panel

Agent Flow will tail the file and visualize events as they arrive.

## VS Code Extension

### Commands

| Command | Description |
|---------|-------------|
| `Agent Flow: Open Agent Flow` | Open the visualizer panel |
| `Agent Flow: Open Agent Flow to Side` | Open in a side editor column |
| `Agent Flow: Connect to Running Agent` | Manually connect to an agent session |
| `Agent Flow: Configure Claude Code Hooks` | Set up Claude Code hooks for live streaming |

### Keyboard Shortcut

| Shortcut | Action |
|----------|--------|
| `Cmd+Alt+A` (Mac) / `Ctrl+Alt+A` (Win/Linux) | Open Agent Flow |

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `agentVisualizer.devServerPort` | `0` | Development server port (0 = production mode) |
| `agentVisualizer.eventLogPath` | `""` | Path to a JSONL event log file to watch |
| `agentVisualizer.autoOpen` | `false` | Auto-open when an agent session starts |

### Requirements

- VS Code 1.85 or later
- Claude Code CLI with active sessions

## Desktop App

The standalone desktop app runs outside of VS Code and monitors all Claude Code sessions across your machine.

- **No VS Code required** — works as an independent macOS application
- **Global session discovery** — scans all projects in `~/.claude/projects/`, not limited to a single workspace
- **Persistent services** — session watchers and hook server run independently of the window lifecycle
- **Built-in settings panel** — configure preferences without editing JSON files
- **macOS native** — application menu, window bounds persistence, App Nap prevention

### Requirements

- macOS

## Project Structure

This is a monorepo with three packages that share a common React frontend:

```
agent-flow/
├── extension/       # VS Code extension backend (esbuild, npm)
├── desktop/         # Electron Mac app (esbuild, npm)
└── web/             # Shared React frontend (Vite, pnpm)
```

Both `extension/` and `desktop/` consume the same `web/` frontend through different build targets and bridge adapters.

## Development

### Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/) (for `web/`)
- npm (for `extension/` and `desktop/`)

### Desktop App (Electron)

```bash
cd web && pnpm install
cd ../desktop && npm install
npm run dev        # Starts esbuild watch + Vite dev server + Electron
```

### VS Code Extension

```bash
cd web && pnpm install
cd ../extension && npm install
npm run build:all  # Build webview + extension
# Then press F5 in VS Code to launch the extension debug host
```

For hot reload during development:
1. In `web/`: `pnpm run dev` (starts dev server on port 3000)
2. In VS Code settings: set `agentVisualizer.devServerPort` to `3002`
3. Press F5 to launch the extension debug host

### Build & Package

```bash
# VS Code extension (.vsix)
cd extension && npm run build:all && npm run package

# Desktop app (.dmg)
cd desktop && npm run build && npm run package
```

### Tests

```bash
cd web && pnpm test        # Frontend tests (Vitest)
cd desktop && npm test     # Desktop tests (Vitest)
```

## Author

Created by [Simon Patole](https://github.com/patoles), for [CraftMyGame](https://craftmygame.com).

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

The name "Agent Flow" and associated logos are trademarks of Simon Patole. See [TRADEMARK.md](TRADEMARK.md) for usage guidelines.
