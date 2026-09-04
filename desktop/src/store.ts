import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type {
  Agent,
  AgentInput,
  Project,
  ProjectInput,
  Stats,
  StudioEvent,
  StudioTask,
  TaskInput,
  TaskStatus,
} from './types'

type Row = Record<string, unknown>

const now = () => new Date().toISOString()
const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`

export class StudioStore {
  private readonly database: Database.Database

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true })
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('foreign_keys = ON')
    this.initialize()
  }

  close(): void {
    this.database.close()
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        executable TEXT NOT NULL,
        arguments TEXT NOT NULL DEFAULT '[]',
        capabilities TEXT NOT NULL DEFAULT '[]',
        max_concurrency INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        repo_path TEXT NOT NULL,
        use_worktrees INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        required_capabilities TEXT NOT NULL DEFAULT '[]',
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        depends_on TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        workspace_path TEXT,
        branch_name TEXT,
        output TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        exit_code INTEGER,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
    const count = this.database.prepare('SELECT COUNT(*) AS count FROM agents').get() as {
      count: number
    }
    if (count.count === 0) {
      this.createAgent({
        name: 'Demo Agent',
        description: '用于验证桌面调度器的安全本地 Agent。',
        executable: process.execPath,
        arguments: [
          '-e',
          "console.log('Analyzing:', process.argv[1]); setTimeout(() => console.log('Done'), 600)",
          '{prompt}',
        ],
        capabilities: ['planning', 'coding', 'review'],
        max_concurrency: 2,
        enabled: true,
      })
    }
  }

  recoverInterruptedTasks(): void {
    this.database
      .prepare(
        `UPDATE tasks
         SET status = 'failed', error = ?, finished_at = ?
         WHERE status = 'running'`,
      )
      .run('Application closed during execution', now())
  }

  listAgents(): Agent[] {
    return (this.database.prepare('SELECT * FROM agents ORDER BY created_at').all() as Row[]).map(
      (row) => this.decodeAgent(row),
    )
  }

  getAgent(id: string): Agent | undefined {
    const row = this.database.prepare('SELECT * FROM agents WHERE id = ?').get(id) as
      | Row
      | undefined
    return row ? this.decodeAgent(row) : undefined
  }

  createAgent(input: AgentInput): Agent {
    const agent = {
      id: newId('agt'),
      ...input,
      created_at: now(),
    }
    this.database
      .prepare(
        `INSERT INTO agents (
          id, name, description, executable, arguments, capabilities,
          max_concurrency, enabled, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        agent.id,
        agent.name,
        agent.description,
        agent.executable,
        JSON.stringify(agent.arguments),
        JSON.stringify(agent.capabilities),
        agent.max_concurrency,
        Number(agent.enabled),
        agent.created_at,
      )
    return { ...agent, available: true }
  }

  deleteAgent(id: string): void {
    this.database.prepare('DELETE FROM agents WHERE id = ?').run(id)
  }

  listProjects(): Project[] {
    return (
      this.database.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Row[]
    ).map((row) => this.decodeProject(row))
  }

  getProject(id: string): Project | undefined {
    const row = this.database.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | Row
      | undefined
    return row ? this.decodeProject(row) : undefined
  }

  createProject(input: ProjectInput): Project {
    const project = { id: newId('prj'), ...input, created_at: now() }
    this.database
      .prepare(
        `INSERT INTO projects (id, name, description, repo_path, use_worktrees, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.description,
        project.repo_path,
        Number(project.use_worktrees),
        project.created_at,
      )
    return project
  }

  listTasks(projectId?: string): StudioTask[] {
    const rows = projectId
      ? (this.database
          .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC')
          .all(projectId) as Row[])
      : (this.database.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Row[])
    return rows.map((row) => this.decodeTask(row))
  }

  getTask(id: string): StudioTask | undefined {
    const row = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | Row
      | undefined
    return row ? this.decodeTask(row) : undefined
  }

  createTask(input: TaskInput): StudioTask {
    const task: StudioTask = {
      id: newId('tsk'),
      ...input,
      status: 'draft',
      assigned_agent_id: null,
      workspace_path: null,
      branch_name: null,
      output: '',
      error: '',
      exit_code: null,
      created_at: now(),
      started_at: null,
      finished_at: null,
    }
    this.database
      .prepare(
        `INSERT INTO tasks (
          id, project_id, title, prompt, required_capabilities, agent_id, depends_on,
          status, assigned_agent_id, workspace_path, branch_name, output, error,
          exit_code, created_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.project_id,
        task.title,
        task.prompt,
        JSON.stringify(task.required_capabilities),
        task.agent_id,
        JSON.stringify(task.depends_on),
        task.status,
        task.assigned_agent_id,
        task.workspace_path,
        task.branch_name,
        task.output,
        task.error,
        task.exit_code,
        task.created_at,
        task.started_at,
        task.finished_at,
      )
    return task
  }

  queueTask(id: string): StudioTask {
    const task = this.requireTask(id)
    if (!['draft', 'failed', 'blocked', 'cancelled'].includes(task.status)) {
      throw new Error('Only draft or retryable tasks can be queued')
    }
    this.updateTask(id, {
      status: 'queued',
      output: '',
      error: '',
      exit_code: null,
      started_at: null,
      finished_at: null,
    })
    return this.requireTask(id)
  }

  queueProject(projectId: string): StudioTask[] {
    this.database
      .prepare(
        `UPDATE tasks
         SET status = 'queued', output = '', error = '', exit_code = NULL,
             started_at = NULL, finished_at = NULL
         WHERE project_id = ? AND status IN ('draft', 'failed', 'blocked', 'cancelled')`,
      )
      .run(projectId)
    return this.listTasks(projectId)
  }

  claimTask(id: string, agentId: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE tasks
         SET status = 'running', assigned_agent_id = ?, started_at = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(agentId, now(), id)
    return result.changes === 1
  }

  updateTask(id: string, values: Partial<StudioTask>): void {
    const entries = Object.entries(values)
    if (entries.length === 0) return
    const jsonFields = new Set(['required_capabilities', 'depends_on'])
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ')
    const parameters = entries.map(([key, value]) =>
      jsonFields.has(key) ? JSON.stringify(value) : value,
    )
    this.database.prepare(`UPDATE tasks SET ${assignments} WHERE id = ?`).run(...parameters, id)
  }

  appendTaskOutput(id: string, field: 'output' | 'error', text: string): void {
    this.database.prepare(`UPDATE tasks SET ${field} = ${field} || ? WHERE id = ?`).run(text, id)
  }

  countAgentLoad(agentId: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks
         WHERE assigned_agent_id = ? AND status = 'running'`,
      )
      .get(agentId) as { count: number }
    return row.count
  }

  addEvent(
    taskId: string | null,
    level: StudioEvent['level'],
    message: string,
  ): StudioEvent {
    const createdAt = now()
    const result = this.database
      .prepare('INSERT INTO events (task_id, level, message, created_at) VALUES (?, ?, ?, ?)')
      .run(taskId, level, message, createdAt)
    return {
      id: Number(result.lastInsertRowid),
      task_id: taskId,
      level,
      message,
      created_at: createdAt,
    }
  }

  listEvents(limit = 100): StudioEvent[] {
    return (
      this.database.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit) as Row[]
    )
      .reverse()
      .map((row) => row as unknown as StudioEvent)
  }

  stats(): Stats {
    const row = this.database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM agents WHERE enabled = 1) AS agents,
          (SELECT COUNT(*) FROM projects) AS projects,
          COUNT(*) AS tasks,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM tasks`,
      )
      .get() as Record<keyof Stats, number | null>
    return {
      agents: row.agents ?? 0,
      projects: row.projects ?? 0,
      tasks: row.tasks ?? 0,
      running: row.running ?? 0,
      completed: row.completed ?? 0,
      failed: row.failed ?? 0,
    }
  }

  private requireTask(id: string): StudioTask {
    const task = this.getTask(id)
    if (!task) throw new Error('Task not found')
    return task
  }

  private decodeAgent(row: Row): Agent {
    return {
      ...(row as unknown as Omit<Agent, 'arguments' | 'capabilities' | 'enabled' | 'available'>),
      arguments: JSON.parse(String(row.arguments)) as string[],
      capabilities: JSON.parse(String(row.capabilities)) as string[],
      enabled: Boolean(row.enabled),
      available: true,
    }
  }

  private decodeProject(row: Row): Project {
    return {
      ...(row as unknown as Omit<Project, 'use_worktrees'>),
      use_worktrees: Boolean(row.use_worktrees),
    }
  }

  private decodeTask(row: Row): StudioTask {
    return {
      ...(row as unknown as Omit<StudioTask, 'required_capabilities' | 'depends_on'>),
      required_capabilities: JSON.parse(String(row.required_capabilities)) as string[],
      depends_on: JSON.parse(String(row.depends_on)) as string[],
      status: row.status as TaskStatus,
    }
  }
}
