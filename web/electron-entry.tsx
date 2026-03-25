import { createRoot } from 'react-dom/client'
import { AgentVisualizer } from './components/agent-visualizer'
import { ElectronBridge } from './lib/electron-bridge'
import { setActiveBridge } from './lib/bridge-runtime'
import './app/globals.css'

setActiveBridge(new ElectronBridge())

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

const root = createRoot(rootElement)
root.render(<AgentVisualizer />)

