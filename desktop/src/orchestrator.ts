import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import spawn from 'cross-spawn'
import type { Agent, DiscoveredAgent, StudioEvent, StudioTask } from './types'
import { StudioStore } from './store'

const DISCOVERABLE_AGENTS: Omit<DiscoveredAgent, 'available'>[] = [
  {
    name: 'Claude Code',
    executable: 'claude',
    arguments: ['-p', '{prompt}'],
    capabilities: ['planning', 'coding', 'review'],
  },
  {
    name: 'OpenAI Codex',
    executable: 'codex',
    arguments: ['exec', '{prompt}'],
    capabilities: ['coding', 'testing', 'review'],
  },
  {
    name: 'Gemini CLI',
    executable: 'gemini',
    arguments: ['-p', '{prompt}'],
    capabilities: ['research', 'coding', 'analysis'],
  },
  {
    name: 'Aider',
    executable: 'aider',
    arguments: ['--message', '{prompt}'],
    capabilities: ['coding', 'refactor'],
  },
  {
    name: 'OpenCode',
    executable: 'opencode',
    arguments: ['run', '{prompt}'],
    capabilities: ['coding', 'testing'],
  },
]

export const commandExists = (executable: string): boolean => {
  if (path.isAbsolute(executable)) return existsSync(executable)
  const command = process.platform === 'win32' ? 'where' : 'which'
  return spawn.sync(command, [executable], { stdio: 'ignore', windowsHide: true }).status === 0
}

export class Orchestrator {
  private readonly running = new Map<string, ChildProcess>()
  private timer?: NodeJS.Timeout
  private stopping = false
  private eventListener: (event: StudioEvent) => void = () => undefined

  constructor(
    private readonly store: StudioStore,
    private readonly workspaceRoot: string,
  ) {
    mkdirSync(workspaceRoot, { recursive: true })
  }

  start(): void {
    this.stopping = false
    this.store.recoverInterruptedTasks()
    this.timer = setInterval(() => void this.schedule(), 500)
  }

  stop(): void {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    for (const child of this.running.values()) {
      child.removeAllListeners()
      child.stdout?.removeAllListeners()
      child.stderr?.removeAllListeners()
      child.kill()
    }
    this.running.clear()
  }

  onEvent(listener: (event: StudioEvent) => void): void {
    this.eventListener = listener
  }

  discoverAgents(): DiscoveredAgent[] {
    return DISCOVERABLE_AGENTS.map((agent) => ({
      ...agent,
      available: commandExists(agent.executable),
    }))
  }

  listAgents(): Agent[] {
    return this.store
      .listAgents()
      .map((agent) => ({ ...agent, available: commandExists(agent.executable) }))
  }

  queueTask(taskId: string): StudioTask {
    const task = this.store.queueTask(taskId)
    this.publish(taskId, 'info', 'Task queued')
    void this.schedule()
    return task
  }

  queueProject(projectId: string): StudioTask[] {
    const tasks = this.store.queueProject(projectId)
    for (const task of tasks.filter((item) => item.status === 'queued')) {
      this.publish(task.id, 'info', 'Task queued')
    }
    void this.schedule()
    return tasks
  }

  cancelTask(taskId: string): StudioTask {
    const task = this.requireTask(taskId)
    if (!['queued', 'running'].includes(task.status)) {
      throw new Error('Only queued or running tasks can be cancelled')
    }
    const child = this.running.get(taskId)
    this.store.updateTask(taskId, {
      status: 'cancelled',
      finished_at: new Date().toISOString(),
    })
    if (child) this.running.delete(taskId)
    child?.kill()
    this.publish(taskId, 'info', 'Cancellation requested')
    return this.requireTask(taskId)
  }

  private async schedule(): Promise<void> {
    if (this.stopping) return
    const tasks = this.store.listTasks()
    const tasksById = new Map(tasks.map((task) => [task.id, task]))
    for (const task of tasks.filter((item) => item.status === 'queued')) {
      const dependencies = task.depends_on.map((id) => tasksById.get(id))
      const failedDependency = dependencies.some(
        (dependency) =>
          !dependency || ['failed', 'blocked', 'cancelled'].includes(dependency.status),
      )
      if (failedDependency) {
        this.store.updateTask(task.id, {
          status: 'blocked',
          error: 'A dependency did not complete successfully.',
          finished_at: new Date().toISOString(),
        })
        this.publish(task.id, 'error', 'Task blocked by dependency')
        continue
      }
      if (!dependencies.every((dependency) => dependency?.status === 'completed')) continue
      const agent = this.selectAgent(task)
      if (agent && this.store.claimTask(task.id, agent.id)) {
        void this.runTask(task, agent)
      }
    }
  }

  private selectAgent(task: StudioTask): Agent | undefined {
    const required = new Set(task.required_capabilities)
    const candidates = this.listAgents().filter(
      (agent) =>
        agent.enabled &&
        agent.available &&
        (!task.agent_id || task.agent_id === agent.id) &&
        [...required].every((capability) => agent.capabilities.includes(capability)) &&
        this.store.countAgentLoad(agent.id) < agent.max_concurrency,
    )
    return candidates.sort(
      (left, right) =>
        this.store.countAgentLoad(left.id) - this.store.countAgentLoad(right.id),
    )[0]
  }

  private async runTask(task: StudioTask, agent: Agent): Promise<void> {
    this.publish(task.id, 'info', `Assigned to ${agent.name}`)
    try {
      const project = this.store.getProject(task.project_id)
      if (!project) throw new Error('Project not found')
      const { workspace, branch } = await this.prepareWorkspace(task, project.repo_path, project.use_worktrees)
      if (this.store.getTask(task.id)?.status !== 'running') return
      this.store.updateTask(task.id, { workspace_path: workspace, branch_name: branch })
      const prompt = [
        task.prompt,
        '',
        `Project: ${project.name}`,
        `Workspace: ${workspace}`,
        'Work only inside this workspace. Return a concise completion summary.',
      ].join('\n')
      const args = agent.arguments.map((argument) =>
        argument
          .replaceAll('{prompt}', prompt)
          .replaceAll('{workspace}', workspace)
          .replaceAll('{task_id}', task.id),
      )
      const child = spawn(agent.executable, args, {
        cwd: workspace,
        env: {
          ...process.env,
          MULTI_AGENT_TASK_ID: task.id,
          MULTI_AGENT_WORKSPACE: workspace,
          MULTI_AGENT_PROJECT_ID: project.id,
        },
        windowsHide: true,
      })
      if (!child.stdout || !child.stderr) {
        child.kill()
        throw new Error('Agent process did not provide output streams')
      }
      this.running.set(task.id, child)
      const isCurrentRun = () => this.running.get(task.id) === child
      this.consume(task.id, child.stdout, 'output', isCurrentRun)
      this.consume(task.id, child.stderr, 'error', isCurrentRun)
      let settled = false
      child.once('error', (error) => {
        if (settled || this.stopping || !isCurrentRun()) return
        settled = true
        this.fail(task.id, error.message, null, child)
      })
      child.once('close', (exitCode) => {
        if (settled || this.stopping || !isCurrentRun()) return
        settled = true
        if (exitCode === 0) {
          void this.completeTask(task.id, project.use_worktrees, child)
        } else {
          this.fail(task.id, `Agent exited with code ${exitCode ?? 'unknown'}`, exitCode)
        }
      })
    } catch (error) {
      this.fail(task.id, error instanceof Error ? error.message : String(error))
    }
  }

  private consume(
    taskId: string,
    stream: NodeJS.ReadableStream,
    level: 'output' | 'error',
    isCurrentRun: () => boolean,
  ): void {
    const lines = readline.createInterface({ input: stream })
    lines.on('line', (message) => {
      if (this.stopping || !isCurrentRun()) return
      this.store.appendTaskOutput(taskId, level, `${message}\n`)
      this.publish(taskId, level, message)
    })
  }

  private async prepareWorkspace(
    task: StudioTask,
    repoPath: string,
    useWorktrees: boolean,
  ): Promise<{ workspace: string; branch: string | null }> {
    if (!existsSync(repoPath)) throw new Error(`Project path does not exist: ${repoPath}`)
    if (!useWorktrees || !existsSync(path.join(repoPath, '.git'))) {
      return { workspace: repoPath, branch: null }
    }
    const workspace = path.join(this.workspaceRoot, task.id)
    const branch = `agent/${task.id}`
    if (existsSync(workspace)) return { workspace, branch }
    const dependencyBranches = task.depends_on.map((dependencyId) => {
      const dependency = this.store.getTask(dependencyId)
      if (!dependency?.branch_name) {
        throw new Error(`Dependency branch is unavailable: ${dependencyId}`)
      }
      return dependency.branch_name
    })
    const branchExists = await this.commandSucceeds('git', [
      '-C',
      repoPath,
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ])
    const args = branchExists
      ? ['-C', repoPath, 'worktree', 'add', workspace, branch]
      : [
          '-C',
          repoPath,
          'worktree',
          'add',
          '-b',
          branch,
          workspace,
          dependencyBranches[0] ?? 'HEAD',
        ]
    await this.runCommand('git', args)
    for (const dependencyBranch of dependencyBranches.slice(1)) {
      await this.runCommand('git', [
        '-C',
        workspace,
        '-c',
        'user.name=Multi-Agent Studio',
        '-c',
        'user.email=multi-agent-studio@localhost',
        'merge',
        '--no-edit',
        dependencyBranch,
      ])
    }
    return { workspace, branch }
  }

  private commandSucceeds(executable: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true })
      child.once('error', () => resolve(false))
      child.once('close', (exitCode) => resolve(exitCode === 0))
    })
  }

  private runCommand(executable: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { windowsHide: true })
      let output = ''
      let errorOutput = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString()
      })
      child.once('error', reject)
      child.once('close', (exitCode) => {
        if (exitCode === 0) resolve(output)
        else reject(new Error(errorOutput.trim() || `${executable} exited with ${exitCode}`))
      })
    })
  }

  private async completeTask(
    taskId: string,
    useWorktrees: boolean,
    child: ChildProcess,
  ): Promise<void> {
    if (this.stopping || this.running.get(taskId) !== child) return
    const current = this.store.getTask(taskId)
    if (!current || current.status !== 'running') return
    try {
      if (useWorktrees && current.workspace_path && current.branch_name) {
        const changes = await this.runCommand('git', [
          '-C',
          current.workspace_path,
          'status',
          '--porcelain',
        ])
        if (changes.trim()) {
          await this.runCommand('git', ['-C', current.workspace_path, 'add', '-A'])
          await this.runCommand('git', [
            '-C',
            current.workspace_path,
            '-c',
            'user.name=Multi-Agent Studio',
            '-c',
            'user.email=multi-agent-studio@localhost',
            'commit',
            '-m',
            `Complete task ${taskId}`,
          ])
        }
      }
      if (this.running.get(taskId) !== child) return
      const latest = this.store.getTask(taskId)
      if (!latest || latest.status !== 'running') return
      this.running.delete(taskId)
      this.store.updateTask(taskId, {
        status: 'completed',
        exit_code: 0,
        finished_at: new Date().toISOString(),
      })
      this.publish(taskId, 'info', 'Task completed')
      void this.schedule()
    } catch (error) {
      this.fail(
        taskId,
        error instanceof Error ? error.message : String(error),
        null,
        child,
      )
    }
  }

  private fail(
    taskId: string,
    message: string,
    exitCode: number | null = null,
    child?: ChildProcess,
  ): void {
    if (this.stopping) return
    if (child && this.running.get(taskId) !== child) return
    const current = this.store.getTask(taskId)
    if (!current || current.status === 'cancelled') return
    this.running.delete(taskId)
    this.store.updateTask(taskId, {
      status: 'failed',
      error: current.error ? `${current.error}${message}\n` : message,
      exit_code: exitCode,
      finished_at: new Date().toISOString(),
    })
    this.publish(taskId, 'error', message)
    void this.schedule()
  }

  private publish(
    taskId: string | null,
    level: StudioEvent['level'],
    message: string,
  ): void {
    this.eventListener(this.store.addEvent(taskId, level, message))
  }

  private requireTask(id: string): StudioTask {
    const task = this.store.getTask(id)
    if (!task) throw new Error('Task not found')
    return task
  }
}
