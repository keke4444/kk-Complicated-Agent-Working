import { contextBridge, ipcRenderer } from 'electron'
import type { AgentInput, ProjectInput, StudioEvent, TaskInput } from './types'

contextBridge.exposeInMainWorld('studio', {
  stats: () => ipcRenderer.invoke('studio:stats'),
  agents: () => ipcRenderer.invoke('studio:agents:list'),
  discoverAgents: () => ipcRenderer.invoke('studio:agents:discover'),
  createAgent: (payload: AgentInput) => ipcRenderer.invoke('studio:agents:create', payload),
  deleteAgent: (agentId: string) => ipcRenderer.invoke('studio:agents:delete', agentId),
  projects: () => ipcRenderer.invoke('studio:projects:list'),
  createProject: (payload: ProjectInput) =>
    ipcRenderer.invoke('studio:projects:create', payload),
  pickDirectory: () => ipcRenderer.invoke('studio:directories:pick'),
  tasks: (projectId?: string) => ipcRenderer.invoke('studio:tasks:list', projectId),
  createTask: (payload: TaskInput) => ipcRenderer.invoke('studio:tasks:create', payload),
  queueTask: (taskId: string) => ipcRenderer.invoke('studio:tasks:queue', taskId),
  queueProject: (projectId: string) =>
    ipcRenderer.invoke('studio:projects:queue', projectId),
  cancelTask: (taskId: string) => ipcRenderer.invoke('studio:tasks:cancel', taskId),
  events: () => ipcRenderer.invoke('studio:events:list'),
  openPath: (targetPath: string) => ipcRenderer.invoke('studio:paths:open', targetPath),
  onEvent: (listener: (event: StudioEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: StudioEvent) => listener(event)
    ipcRenderer.on('studio:event', handler)
    return () => ipcRenderer.removeListener('studio:event', handler)
  },
})
