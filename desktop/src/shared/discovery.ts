import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { HOOK_TIMEOUT_S, HOOK_SAFETY_MARGIN_MS, HOOK_FORWARD_TIMEOUT_MS, WORKSPACE_HASH_LENGTH } from './constants'
import { createLogger } from './logger'

const log = createLogger('Discovery')

const DISCOVERY_DIR = path.join(os.homedir(), '.claude', 'agent-flow')
const HOOK_SCRIPT_PATH = path.join(DISCOVERY_DIR, 'hook.js')
const WORKSPACES_MANIFEST_PATH = path.join(DISCOVERY_DIR, 'workspaces.json')
const DESKTOP_GLOBAL_DISCOVERY_PATH = path.join(DISCOVERY_DIR, 'desktop-global.json')

export const HOOK_COMMAND_MARKER = 'agent-flow/hook.js'

export function getHookCommand(): string { return `node "${HOOK_SCRIPT_PATH}"` }

export function hashWorkspace(workspace: string): string {
  return crypto.createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0, WORKSPACE_HASH_LENGTH)
}

export function writeDiscoveryFile(port: number, workspace: string): void {
  ensureDir()
  const hash = hashWorkspace(workspace)
  const filePath = path.join(DISCOVERY_DIR, `${hash}-${process.pid}.json`)
  fs.writeFileSync(filePath, JSON.stringify({ mode: 'workspace', port, pid: process.pid, workspace: path.resolve(workspace) }, null, 2) + '\n')
  log.info(`Wrote ${filePath}`)
}

export function removeDiscoveryFile(workspace: string): void {
  const hash = hashWorkspace(workspace)
  const filePath = path.join(DISCOVERY_DIR, `${hash}-${process.pid}.json`)
  try {
    fs.unlinkSync(filePath)
  } catch {
    /* ignore */
  }
}

export function writeGlobalDiscoveryFile(port: number): void {
  ensureDir()
  fs.writeFileSync(DESKTOP_GLOBAL_DISCOVERY_PATH, JSON.stringify({ mode: 'global', app: 'desktop', port, pid: process.pid }, null, 2) + '\n')
}

export function removeGlobalDiscoveryFile(): void {
  try {
    fs.unlinkSync(DESKTOP_GLOBAL_DISCOVERY_PATH)
  } catch {
    /* ignore */
  }
}

export function addWorkspaceToManifest(workspace: string): void {
  ensureDir()
  const resolved = path.resolve(workspace)
  const workspaces = readManifest()
  if (workspaces.includes(resolved)) return
  workspaces.push(resolved)
  fs.writeFileSync(WORKSPACES_MANIFEST_PATH, JSON.stringify(workspaces, null, 2) + '\n')
}

export function readManifest(): string[] {
  try {
    if (!fs.existsSync(WORKSPACES_MANIFEST_PATH)) return []
    const data = JSON.parse(fs.readFileSync(WORKSPACES_MANIFEST_PATH, 'utf-8'))
    return Array.isArray(data) ? data : []
  } catch (err) {
    log.debug('Failed to read workspaces manifest:', err)
    return []
  }
}

export function globalDiscoveryFileExists(): boolean {
  return fs.existsSync(DESKTOP_GLOBAL_DISCOVERY_PATH)
}

export function ensureHookScript(): void {
  ensureDir()
  const script = getHookScriptContent()
  try {
    if (fs.existsSync(HOOK_SCRIPT_PATH) && fs.readFileSync(HOOK_SCRIPT_PATH, 'utf8') === script) {
      return
    }
  } catch {
    /* ignore */
  }
  const tmpPath = HOOK_SCRIPT_PATH + `.${process.pid}.tmp`
  fs.writeFileSync(tmpPath, script, { mode: 0o755 })
  fs.renameSync(tmpPath, HOOK_SCRIPT_PATH)
  log.info(`Installed hook script → ${HOOK_SCRIPT_PATH}`)
}

function ensureDir(): void {
  if (!fs.existsSync(DISCOVERY_DIR)) {
    fs.mkdirSync(DISCOVERY_DIR, { recursive: true })
  }
}

function getHookScriptContent(): string {
  return `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const os = require('os');
setTimeout(() => process.exit(0), ${HOOK_TIMEOUT_S * 1000 - HOOK_SAFETY_MARGIN_MS});
const DIR = path.join(os.homedir(), '.claude', 'agent-flow');
const GLOBAL_DISCOVERY = path.join(DIR, 'desktop-global.json');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(input); } catch { process.exit(0); }
  const cwd = payload.cwd;
  const targets = [];
  if (cwd) {
    try {
      const hash = crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, ${WORKSPACE_HASH_LENGTH});
      const files = fs.readdirSync(DIR).filter(f => f.startsWith(hash + '-') && f.endsWith('.json'));
      for (const file of files) {
        try { targets.push(JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))); } catch {}
      }
    } catch {}
  }
  try {
    if (fs.existsSync(GLOBAL_DISCOVERY)) {
      targets.push(JSON.parse(fs.readFileSync(GLOBAL_DISCOVERY, 'utf8')));
    }
  } catch {}
  const seen = new Set();
  const deduped = targets.filter(t => {
    if (!t || typeof t.port !== 'number' || typeof t.pid !== 'number') return false;
    const key = t.pid + ':' + t.port;
    if (seen.has(key)) return false;
    seen.add(key);
    try { process.kill(t.pid, 0); } catch {
      if (t.mode === 'global') {
        try { fs.unlinkSync(GLOBAL_DISCOVERY); } catch {}
      }
      return false;
    }
    return true;
  });
  let pending = deduped.length;
  if (!pending) process.exit(0);
  const done = () => { if (--pending <= 0) process.exit(0); };
  for (const target of deduped) {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; done(); };
    const req = http.request({
      hostname: '127.0.0.1',
      port: target.port,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: ${HOOK_FORWARD_TIMEOUT_MS},
    }, res => { res.resume(); res.on('end', finish); });
    req.on('error', finish);
    req.on('timeout', () => req.destroy());
    req.write(input);
    req.end();
  }
});
`
}

