# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Flow provides real-time visualization of Claude Code agent orchestration. It displays interactive node graphs of agent sessions, tool call chains, and subagent hierarchies. Licensed under Apache 2.0.

The project has two deployment targets:
- **VS Code extension** — Webview panel inside VS Code (`extension/`)
- **Standalone Mac app** — Electron desktop app (`desktop/`)

Both share the same React frontend (`web/`).

## Repository Structure

This is a monorepo with three packages:

- **`extension/`** — VS Code extension backend (Node.js, TypeScript, esbuild)
- **`desktop/`** — Electron Mac app (TypeScript, esbuild for main process)
- **`web/`** — Shared React frontend (React 19, Vite, Tailwind CSS 4, D3-force)

```
agent-flow/
├── extension/           # VS Code extension
│   └── src/             # Extension source (vscode API dependent)
├── desktop/             # Electron app
│   └── src/
│       ├── main/        # Electron main process
│       ├── preload/     # contextBridge IPC layer
│       └── shared/      # Backend logic adapted from extension/src/
└── web/                 # Shared React frontend
    ├── components/      # UI components (agent-visualizer, canvas, panels)
    ├── hooks/           # React hooks (simulation, bridge, camera, interaction)
    └── lib/             # Types, bridges, constants, utilities
```

## Build Commands

### Desktop / Electron (run from `desktop/`)
```bash
npm run build           # Build main + preload + renderer
npm run build:main      # Build main process with esbuild
npm run build:renderer  # Build renderer (Vite build from web/)
npm run dev             # Dev mode with hot reload (main + Vite dev server + Electron)
npm start               # Run built app
npm run package         # Create .dmg for Mac distribution
```

### Extension (run from `extension/`)
```bash
npm run build           # Build extension with esbuild
npm run watch           # Rebuild on file changes
npm run lint            # TypeScript type-check (tsc --noEmit)
npm run build:all       # Build webview + extension together
npm run package         # Create .vsix package for distribution
```

### Web/Frontend (run from `web/`)
```bash
pnpm run dev            # Next.js dev server (port 3000)
pnpm run build:webview  # Vite IIFE build → extension/dist/webview/
pnpm run build:electron # Vite build → desktop/dist/renderer/
```

Tests use Vitest. Run `npm test` from `desktop/` or `pnpm test` from `web/`.

## Architecture

### Data Flow (both targets)
```
Claude Code hooks → HTTP POST → Hook Server
                                     ↓
JSONL transcripts → Session Watcher ──┘
                         ↓
                  Transcript Parser → AgentEvent objects
                         ↓
              ┌──────────┴──────────┐
              │                     │
    VS Code: postMessage    Electron: IPC
              │                     │
              └──────────┬──────────┘
                         ↓
                  Bridge Adapter (React)
                         ↓
                  useAgentSimulation (D3-force physics)
                         ↓
                  Canvas rendering (HTML5 Canvas)
```

### Desktop Key Files (`desktop/src/`)
- **`main/main.ts`** — Electron entry: single-instance lock, app lifecycle, wiring
- **`main/service-manager.ts`** — App-level service lifecycle (watchers, hook server, event broadcasting). Services live independent of window — closing the window does NOT stop watchers
- **`main/window-manager.ts`** — BrowserWindow creation, bounds persistence, dev/prod URL loading
- **`main/ipc.ts`** — All IPC channel handlers (renderer ↔ main)
- **`main/open-file.ts`** — Configurable file opening (auto → VS Code → Cursor → system fallback)
- **`main/settings-store.ts`** — Persistent settings via `electron-store`
- **`main/menu.ts`** — macOS application menu (Edit for copy/paste, View for DevTools)
- **`main/power-save.ts`** — Prevents macOS App Nap from freezing timers during background operation
- **`preload/preload.ts`** — `contextBridge` exposing `window.electronAPI` (secure IPC)
- **`shared/vscode-shim.ts`** — Drop-in replacement for `vscode.EventEmitter` and `vscode.Disposable`
- **`shared/event-dedup.ts`** — Hook/watcher dedup logic extracted from `extension.ts`
- **`shared/session-watcher.ts`** — Adapted: uses `TypedEventEmitter`, scans ALL projects globally (no workspace scoping)

### Extension Key Files (`extension/src/`)
- **`extension.ts`** — Entry point, registers commands and activates watchers
- **`webview-provider.ts`** — VS Code webview panel management (CSP, HTML generation, postMessage)
- **`hook-server.ts`** — HTTP server receiving real-time events from Claude Code hooks
- **`session-watcher.ts`** — Monitors `~/.claude/projects/` scoped to the active workspace
- **`transcript-parser.ts`** — Parses JSONL into typed `AgentEvent` objects (13 event types)
- **`discovery.ts`** — Service discovery via JSON files in `~/.claude/agent-flow/`
- **`protocol.ts`** — Typed message protocol between extension and webview

### Web Key Files (`web/`)
- **`electron-entry.tsx`** — Mount point for Electron renderer
- **`webview-entry.tsx`** — Mount point for VS Code webview (uses `acquireVsCodeApi`)
- **`lib/bridge-runtime.ts`** — Bridge adapter interface (`BridgeAdapter`) and factory: selects `ElectronBridge` or `VSCodeBridge` based on environment
- **`lib/electron-bridge.ts`** — Electron IPC bridge implementation
- **`lib/vscode-bridge.ts`** — VS Code postMessage bridge implementation
- **`hooks/use-vscode-bridge.ts`** — React hook consuming the active bridge (multi-session buffering, event delivery)
- **`components/agent-visualizer/index.tsx`** — Main orchestrator component
- **`hooks/use-agent-simulation.ts`** — D3-force physics simulation and event processing engine
- **`hooks/simulation/`** — Event processing submodules (agent, tool, message, subagent handlers)
- **`lib/agent-types.ts`** — Core type definitions (Agent, ToolCallNode, Discovery, etc.)
- **`lib/canvas-constants.ts`** — All canvas rendering constants (sizes, physics forces, colors)

### Bridge Abstraction

The frontend uses a `BridgeAdapter` interface (`web/lib/bridge-runtime.ts`) that abstracts the communication layer:
- **`ElectronBridge`** — Uses `window.electronAPI` (exposed by preload via `contextBridge`)
- **`VSCodeBridge`** — Uses `window.postMessage` (dev) or `acquireVsCodeApi` (production webview)

Entry points select the appropriate bridge:
- `electron-entry.tsx` → creates `ElectronBridge`, calls `setActiveBridge()`
- `webview-entry.tsx` → creates `VSCodeBridge` via `configureWebviewApi()`

The hook `useVSCodeBridge()` calls `getActiveBridge()` and works identically for both.

### Electron IPC Handshake

The desktop app uses a two-phase handshake to avoid event loss:
1. Renderer calls `getInitialState()` (via `ipcMain.handle`) — receives snapshot of sessions, connection status, config
2. Renderer processes snapshot, registers listeners, then calls `ready()` — main begins emitting live events

### Dual Data Sources

Events come from two sources simultaneously:
1. **Hook server** — Real-time HTTP events from Claude Code hooks (low latency)
2. **Session watcher** — JSONL transcript file monitoring (richer metadata, accurate subagent names)

Dedup logic (in `desktop/src/shared/event-dedup.ts` and `extension/src/extension.ts`):
- If session watcher owns a session: block subagent lifecycle events from hooks (watcher has better names), pass through tool/message events
- `filterOrchestratorCompletion`: converts orchestrator `agent_complete` → `agent_idle` (prevents premature "completed" state) unless `sessionEnd: true`

### Shared Backend (`desktop/src/shared/`)

Files adapted from `extension/src/` with minimal changes:
- **`vscode-shim.ts`** — `TypedEventEmitter<T>` (matches `vscode.EventEmitter` API: `.event`, `.fire()`, `.dispose()`) and `Disposable` interface
- **`session-watcher.ts`** — Swapped `vscode.EventEmitter` → `TypedEventEmitter`, removed workspace scoping (always scans all of `~/.claude/projects/`)
- **`hook-server.ts`**, **`event-source.ts`** — Swapped EventEmitter only

Files copied unchanged: `transcript-parser.ts`, `subagent-watcher.ts`, `permission-detection.ts`, `fs-utils.ts`, `tool-summarizer.ts`, `token-estimator.ts`, `protocol.ts`, `logger.ts`, `constants.ts`, `discovery.ts`

## Development Workflow

### Desktop (Electron)
```bash
cd desktop && npm run dev
```
This starts three concurrent processes: esbuild watch for main process, Vite dev server for renderer (port 5173), and Electron loading from the dev server. Main process detects `ELECTRON_RENDERER_URL` env var to load from dev server instead of built files.

### VS Code Extension
1. In `web/`: `pnpm run dev` (starts Next.js on port 3000)
2. In VS Code settings: set `agentVisualizer.devServerPort` to `3002`
3. Press F5 to launch extension debug host

### Build Output
- Extension webview: `web/vite.config.webview.ts` → IIFE bundle at `extension/dist/webview/`
- Electron renderer: `web/vite.config.electron.ts` → standard Vite build at `desktop/dist/renderer/`
- Desktop main process: `desktop/esbuild.main.mjs` → `desktop/dist/main/main.js`

## Key Conventions

- Extension uses CommonJS (esbuild), desktop main uses CommonJS (esbuild), web uses ESNext
- The renderer has no access to Node.js APIs — all system operations go through IPC (Electron) or postMessage (VS Code)
- Agent states: `idle` → `thinking` → `tool_calling` → `complete` (also `error`, `paused`, `waiting_permission`)
- Canvas rendering uses multiple draw passes: background → edges → agents → tool calls → effects → UI overlays
- D3-force simulation handles agent positioning with charge, center, collide, and link forces
- Services (SessionWatcher, HookServer) live at app level in Electron, not tied to window lifecycle
- Mock scenario data in `web/lib/mock-scenario.ts` for standalone demo/testing
- Session detection: scans `~/.claude/projects/` for `.jsonl` files modified within 10 minutes
- macOS App Nap prevention: `powerSaveBlocker` used when sessions are active
