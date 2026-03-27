# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Flow provides real-time visualization of Claude Code agent orchestration. It displays interactive node graphs of agent sessions, tool call chains, and subagent hierarchies. Licensed under Apache 2.0.

The project is a **standalone Mac desktop app** (Electron) with a shared React frontend.

## Repository Structure

This is a monorepo with two packages:

- **`desktop/`** — Electron Mac app (TypeScript, esbuild for main process)
- **`web/`** — Shared React frontend (React 19, Vite, Tailwind CSS 4, D3-force)

```
agent-flow/
├── desktop/             # Electron app
│   └── src/
│       ├── main/        # Electron main process
│       ├── preload/     # contextBridge IPC layer
│       └── shared/      # Backend logic (session watcher, hook server, parser)
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

### Web/Frontend (run from `web/`)
```bash
pnpm run dev            # Next.js dev server (port 3000)
pnpm run build:electron # Vite build → desktop/dist/renderer/
```

Tests use Vitest. Run `npm test` from `desktop/` or `pnpm test` from `web/`.

## Architecture

### Data Flow
```
Claude Code hooks → HTTP POST → Hook Server
                                     ↓
JSONL transcripts → Session Watcher ──┘
                         ↓
                  Transcript Parser → AgentEvent objects
                         ↓
                    Electron IPC
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
- **`shared/event-emitter.ts`** — `TypedEventEmitter<T>` and `Disposable` interface
- **`shared/event-dedup.ts`** — Hook/watcher dedup logic
- **`shared/session-watcher.ts`** — Scans ALL projects globally in `~/.claude/projects/`

### Web Key Files (`web/`)
- **`electron-entry.tsx`** — Mount point for Electron renderer
- **`lib/bridge-runtime.ts`** — Bridge adapter interface (`BridgeAdapter`) and factory: returns `ElectronBridge` when hosted, `StandaloneBridge` as fallback
- **`lib/electron-bridge.ts`** — Electron IPC bridge implementation
- **`lib/standalone-bridge.ts`** — Noop bridge for standalone web dev/demo
- **`hooks/use-bridge.ts`** — React hook consuming the active bridge (multi-session buffering, event delivery)
- **`components/agent-visualizer/index.tsx`** — Main orchestrator component
- **`hooks/use-agent-simulation.ts`** — D3-force physics simulation and event processing engine
- **`hooks/simulation/`** — Event processing submodules (agent, tool, message, subagent handlers)
- **`lib/agent-types.ts`** — Core type definitions (Agent, ToolCallNode, Discovery, etc.)
- **`lib/canvas-constants.ts`** — All canvas rendering constants (sizes, physics forces, colors)

### Bridge Abstraction

The frontend uses a `BridgeAdapter` interface (`web/lib/bridge-runtime.ts`) that abstracts the communication layer:
- **`ElectronBridge`** — Uses `window.electronAPI` (exposed by preload via `contextBridge`)
- **`StandaloneBridge`** — Noop bridge for standalone web dev/demo mode

Entry point: `electron-entry.tsx` creates `ElectronBridge` and calls `setActiveBridge()`.

The hook `useBridge()` calls `getActiveBridge()` and manages multi-session state.

### Electron IPC Handshake

The desktop app uses a two-phase handshake to avoid event loss:
1. Renderer calls `getInitialState()` (via `ipcMain.handle`) — receives snapshot of sessions, connection status, config
2. Renderer processes snapshot, registers listeners, then calls `ready()` — main begins emitting live events

### Dual Data Sources

Events come from two sources simultaneously:
1. **Hook server** — Real-time HTTP events from Claude Code hooks (low latency)
2. **Session watcher** — JSONL transcript file monitoring (richer metadata, accurate subagent names)

Dedup logic (in `desktop/src/shared/event-dedup.ts`):
- If session watcher owns a session: block subagent lifecycle events from hooks (watcher has better names), pass through tool/message events
- `filterOrchestratorCompletion`: converts orchestrator `agent_complete` → `agent_idle` (prevents premature "completed" state) unless `sessionEnd: true`

### Shared Backend (`desktop/src/shared/`)

Core backend modules:
- **`event-emitter.ts`** — `TypedEventEmitter<T>` (typed event emitter with `.event`, `.fire()`, `.dispose()`) and `Disposable` interface
- **`session-watcher.ts`** — Scans all of `~/.claude/projects/` for active sessions
- **`hook-server.ts`**, **`event-source.ts`** — HTTP hook server and JSONL event source
- **`transcript-parser.ts`** — Parses JSONL into typed `AgentEvent` objects (13 event types)
- **`subagent-watcher.ts`** — Watches subagent transcript files
- **`permission-detection.ts`** — Detects pending permission requests
- **`discovery.ts`** — Service discovery via JSON files in `~/.claude/agent-flow/`
- **`protocol.ts`** — Typed event protocol definitions
- **`constants.ts`** — All shared constants (timing, truncation, strings)

## Development Workflow

### Desktop (Electron)
```bash
cd desktop && npm run dev
```
This starts three concurrent processes: esbuild watch for main process, Vite dev server for renderer (port 5173), and Electron loading from the dev server. Main process detects `ELECTRON_RENDERER_URL` env var to load from dev server instead of built files.

### Build Output
- Electron renderer: `web/vite.config.electron.ts` → standard Vite build at `desktop/dist/renderer/`
- Desktop main process: `desktop/esbuild.main.mjs` → `desktop/dist/main/main.js`

## Key Conventions

- Desktop main uses CommonJS (esbuild), web uses ESNext
- The renderer has no access to Node.js APIs — all system operations go through IPC (Electron)
- Agent states: `idle` → `thinking` → `tool_calling` → `complete` (also `error`, `paused`, `waiting_permission`)
- Canvas rendering uses multiple draw passes: background → edges → agents → tool calls → effects → UI overlays
- D3-force simulation handles agent positioning with charge, center, collide, and link forces
- Services (SessionWatcher, HookServer) live at app level in Electron, not tied to window lifecycle
- Mock scenario data in `web/lib/mock-scenario.ts` for standalone demo/testing
- Session detection: scans `~/.claude/projects/` for `.jsonl` files modified within 10 minutes
- macOS App Nap prevention: `powerSaveBlocker` used when sessions are active
