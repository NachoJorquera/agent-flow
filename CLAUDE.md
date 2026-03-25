# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Flow is a VS Code extension that provides real-time visualization of Claude Code agent orchestration. It watches agent execution, displays interactive node graphs, and enables debugging of tool call chains. Licensed under Apache 2.0.

## Repository Structure

This is a monorepo with two independent packages:

- **`extension/`** — VS Code extension backend (Node.js, TypeScript, esbuild)
- **`web/`** — Webview frontend (React 19, Next.js 16, Vite, Tailwind CSS 4)

The extension hosts a webview panel that renders the React frontend. They communicate via `postMessage` using a typed protocol defined in `extension/src/protocol.ts`.

## Build Commands

### Extension (run from `extension/`)
```bash
npm run build          # Build extension with esbuild
npm run watch          # Rebuild on file changes
npm run lint           # TypeScript type-check (tsc --noEmit)
npm run build:all      # Build webview + extension together
npm run package        # Create .vsix package for distribution
```

### Web/Webview (run from `web/`)
```bash
pnpm run dev           # Next.js dev server (port 3000)
pnpm run build:webview # Vite build → extension/dist/webview/
```

There is no test framework configured.

## Architecture

### Data Flow
```
Claude Code hooks → HTTP POST → Hook Server (extension)
                                     ↓
JSONL transcripts → Session Watcher (extension)
                         ↓
                  Transcript Parser → AgentEvent objects
                         ↓
                  WebviewPanel.postMessage()
                         ↓
                  useVSCodeBridge (React hook)
                         ↓
                  useAgentSimulation (D3-force physics)
                         ↓
                  Canvas rendering (HTML5 Canvas)
```

### Extension Key Files
- **`extension.ts`** — Entry point, registers commands and activates watchers
- **`hook-server.ts`** — HTTP server receiving real-time events from Claude Code hooks
- **`session-watcher.ts`** — Monitors `~/.claude/projects/` for JSONL transcript files
- **`transcript-parser.ts`** — Parses JSONL into typed `AgentEvent` objects (13 event types)
- **`discovery.ts`** — Service discovery via JSON files in `~/.claude/agent-flow/` to avoid port conflicts across VS Code instances
- **`protocol.ts`** — Typed message protocol between extension and webview

### Web Key Files
- **`webview-entry.tsx`** — Mount point for the webview (not `app/page.tsx`)
- **`components/agent-visualizer/index.tsx`** — Main orchestrator component
- **`components/agent-visualizer/canvas.tsx`** — HTML5 Canvas rendering wrapper
- **`components/agent-visualizer/canvas/`** — Modular rendering layers (agents, edges, tool calls, effects)
- **`hooks/use-agent-simulation.ts`** — D3-force physics simulation and event processing engine
- **`hooks/use-vscode-bridge.ts`** — Bridges VS Code postMessage API to React
- **`hooks/simulation/`** — Event processing submodules (agent, tool, message, subagent handlers)
- **`lib/agent-types.ts`** — Core type definitions (Agent, ToolCallNode, Discovery, etc.)
- **`lib/canvas-constants.ts`** — All canvas rendering constants (sizes, physics forces, colors)

### Dual Data Sources
The extension receives events from two sources simultaneously:
1. **Hook server** — Real-time HTTP events from Claude Code hooks (low latency)
2. **Session watcher** — JSONL transcript file monitoring (richer metadata, accurate names)

Both feed into the same `AgentEvent` pipeline.

## Development Workflow

For local development with hot reload:
1. In `web/`: `pnpm run dev` (starts Next.js on port 3000)
2. In VS Code settings: set `agentVisualizer.devServerPort` to `3002`
3. Press F5 to launch extension debug host
4. The webview will load from the dev server instead of built assets

The Vite config (`web/vite.config.webview.ts`) bundles the entire React app into a single IIFE (JS + CSS) for the webview — no module loading in the VS Code webview context.

## Key Conventions

- Extension uses CommonJS modules (esbuild output), web uses ESNext
- The webview has no access to Node.js APIs — all file/system operations go through the extension via postMessage
- Agent states: `idle` → `thinking` → `tool_calling` → `complete` (also `error`, `paused`, `waiting_permission`)
- Canvas rendering uses multiple draw passes: background → edges → agents → tool calls → effects → UI overlays
- D3-force simulation handles agent positioning with charge, center, collide, and link forces
- Mock scenario data in `web/lib/mock-scenario.ts` for standalone demo/testing
