import * as os from 'os'
import * as path from 'path'

export function getClaudeProjectsPath(): string {
  return path.join(os.homedir(), '.claude', 'projects')
}

export function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

export function getAgentFlowDiscoveryPath(): string {
  return path.join(os.homedir(), '.claude', 'agent-flow')
}

