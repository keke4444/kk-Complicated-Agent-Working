import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { Orchestrator } from './orchestrator'
import { initializeProcessPath } from './process-path'
import { StudioStore } from './store'
import type { AgentInput, ProjectInput, TaskInput } from './types'

let mainWindow: BrowserWindow | null = null
let store: StudioStore
let orchestrator: Orchestrator

function registerIpc(): void {
  ipcMain.handle('studio:stats', () => store.stats())
  ipcMain.handle('studio:agents:list', () => orchestrator.listAgents())
  ipcMain.handle('studio:agents:discover', () => orchestrator.discoverAgents())
  ipcMain.handle('studio:agents:create', (_event, payload: AgentInput) => {
    if (!payload.name.trim() || !payload.executable.trim()) {
      throw new Error('Agent name and executable are required')
    }
    if (!Number.isInteger(payload.max_concurrency) || payload.max_concurrency < 1) {
      throw new Error('Agent concurrency must be a positive integer')
    }
    return store.createAgent(payload)
  })
  ipcMain.handle('studio:agents:delete', (_event, agentId: string) =>
    store.deleteAgent(agentId),
  )
  ipcMain.handle('studio:projects:list', () => store.listProjects())
  ipcMain.handle('studio:projects:create', (_event, payload: ProjectInput) => {
    const repoPath = path.resolve(payload.repo_path)
    if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
      throw new Error('Project path must be an existing directory')
    }
    return store.createProject({ ...payload, repo_path: repoPath })
  })
  ipcMain.handle('studio:directories:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择项目目录',
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('studio:tasks:list', (_event, projectId?: string) =>
    store.listTasks(projectId),
  )
  ipcMain.handle('studio:tasks:create', (_event, payload: TaskInput) => {
    if (!store.getProject(payload.project_id)) throw new Error('Project not found')
    if (payload.agent_id && !store.getAgent(payload.agent_id)) {
      throw new Error('Agent not found')
    }
    for (const dependencyId of payload.depends_on) {
      const dependency = store.getTask(dependencyId)
      if (!dependency || dependency.project_id !== payload.project_id) {
        throw new Error('Dependencies must belong to the same project')
      }
    }
    return store.createTask(payload)
  })
  ipcMain.handle('studio:tasks:queue', (_event, taskId: string) =>
    orchestrator.queueTask(taskId),
  )
  ipcMain.handle('studio:projects:queue', (_event, projectId: string) =>
    orchestrator.queueProject(projectId),
  )
  ipcMain.handle('studio:tasks:cancel', (_event, taskId: string) =>
    orchestrator.cancelTask(taskId),
  )
  ipcMain.handle('studio:events:list', () => store.listEvents())
  ipcMain.handle('studio:paths:open', (_event, targetPath: string) => {
    const resolvedPath = path.resolve(targetPath)
    if (!existsSync(resolvedPath)) throw new Error('Path does not exist')
    shell.showItemInFolder(resolvedPath)
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#f4f6f9',
    title: 'Multi-Agent Studio',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  const developmentUrl = process.env.VITE_DEV_SERVER_URL
  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl)
  } else {
    void mainWindow.loadFile(
      path.join(app.getAppPath(), 'frontend', 'dist', 'index.html'),
    )
  }
}

void app.whenReady().then(() => {
  initializeProcessPath(app.getPath('home'))
  store = new StudioStore(path.join(app.getPath('userData'), 'studio.db'))
  orchestrator = new Orchestrator(
    store,
    path.join(app.getPath('userData'), 'worktrees'),
  )
  orchestrator.onEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('studio:event', event)
    }
  })
  orchestrator.start()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  orchestrator?.stop()
  store?.close()
})
