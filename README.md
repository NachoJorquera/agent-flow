# Agent Flow

> Fork of [Agent Flow](https://github.com/patoles/agent-flow) by [Simon Patole](https://github.com/patoles). Original project licensed under Apache 2.0.

Real-time visualization of Claude Code and Codex sessions. Watch your agents think, branch, and coordinate as they work. Standalone Mac desktop app (Electron).

## Features

- **Live agent visualization** — Interactive node graph with real-time tool calls, branching, and return flows powered by D3-force physics
- **Auto-detect Claude Code and Codex sessions** — Automatically discovers recent local sessions across all projects and streams events, with provider labels in the session tabs
- **Dual data sources** — Lightweight HTTP hook server for zero-latency streaming plus JSONL transcript watcher for richer metadata, with automatic deduplication
- **Multi-session support** — See all sessions and their agents on one canvas by default, or choose one tab per session in Settings → Session view. Only the selected view runs.
- **Interactive canvas** — Pan, zoom, click agents and tool calls to inspect details
- **Timeline & transcript panels** — Review the full execution timeline, file attention heatmap, and message transcript
- **JSONL log file support** — Point at any JSONL event log to replay or watch agent activity

## Getting Started

1. Build from source (see [Development](#development))
2. Open Agent Flow — it automatically scans `~/.claude/projects/` and `~/.codex/sessions/`
3. Start a Claude Code or Codex session anywhere — Agent Flow will pick it up

### Codex Sessions

Codex sessions are detected from local rollout transcripts, including sessions started in the CLI, IDE integrations, and T3 Code when they write to the same Codex home. Agent Flow watches new records and polls as a fallback. It shows messages, tool calls, model, token usage, and turn activity alongside Claude sessions. The latest 1,000 parsed events per Codex session are retained for reopening the window.

Sessions started in T3 Code use their actual T3 titles when available, read from its local database in read-only mode. Title changes are reflected without starting another turn. Provisional Codex titles omit image attachment references and metadata.

Existing conversation history remains available in Chat/Review without appearing as a stack of new canvas bubbles when a session is detected, reopened or selected. New live messages still show their normal transient bubbles.

Delegated provider transcripts are linked to their parent's reviewer node using explicit session identifiers, so their messages, tool calls and token usage appear on that node. Completed Codex sessions retire after the inactivity timeout and can reappear if work resumes.

If you use a custom `CODEX_HOME`, launch Agent Flow with that environment variable set; it scans `$CODEX_HOME/sessions`. Only local sessions with transcript activity in the last 10 minutes are discovered. Older sessions are picked up when their transcript changes again. Cloud-only sessions and sessions without persisted local transcripts are not discovered.

Session names come from saved T3 or Codex metadata when available and update after a rename. On startup and window reopening, messages are restored in the chat without replaying the history as new canvas bubbles.

### Mixed-provider agents

Each agent and subagent uses its own Claude or OpenAI logo. Provider identity comes from the model and invocation metadata: native Claude `Agent`/`Task` calls, Codex `spawn_agent`, T3 `delegate_task`, and direct `codex exec` or `claude --print` commands. This supports workflows such as sol-loop, Dredd, and council in either direction.

CLI reviewers using `--ephemeral` appear as child nodes from their launching command even without a separate session transcript. T3 delegation results can update the child's provider/model, and asynchronous dispatch stays active until a completion result, linked transcript completion or matching task notification arrives. Persisted child transcripts are integrated into the delegated node when explicit identifiers link them to their parent; unlinked transcripts remain separate sessions.

### Claude Code Hooks

Agent Flow automatically configures Claude Code hooks the first time you open the app. These forward events from Claude Code to Agent Flow for zero-latency streaming.

## Desktop App

The standalone desktop app monitors local Claude Code and Codex sessions across your machine.

- **Global session discovery** — scans Claude projects and Codex session transcripts, not limited to a single workspace
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
