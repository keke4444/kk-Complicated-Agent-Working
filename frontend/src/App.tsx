import {
  Activity,
  Bot,
  Boxes,
  Braces,
  ChevronDown,
  CircleStop,
  Clock3,
  Code2,
  FolderGit2,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Network,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Sparkles,
  Terminal,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { Agent, DiscoveredAgent, Project, Stats, StudioEvent, Task, TaskStatus } from './types'

type Modal = 'project' | 'task' | 'agent' | null

const EMPTY_STATS: Stats = {
  agents: 0,
  projects: 0,
  tasks: 0,
  running: 0,
  completed: 0,
  failed: 0,
}

const COLUMNS: { status: TaskStatus; label: string; hint: string }[] = [
  { status: 'draft', label: '待规划', hint: '等待进入执行队列' },
  { status: 'queued', label: '已排队', hint: '等待依赖与 Agent' },
  { status: 'running', label: '执行中', hint: 'Agent 正在工作' },
  { status: 'completed', label: '已完成', hint: '等待合并或验收' },
]

const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: '待规划',
  queued: '已排队',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  blocked: '已阻塞',
  cancelled: '已取消',
}

function App() {
  const [stats, setStats] = useState(EMPTY_STATS)
  const [agents, setAgents] = useState<Agent[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [events, setEvents] = useState<StudioEvent[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [nextStats, nextAgents, nextProjects, nextTasks, nextEvents] = await Promise.all([
        api.stats(),
        api.agents(),
        api.projects(),
        api.tasks(),
        api.events(),
      ])
      setStats(nextStats)
      setAgents(nextAgents)
      setProjects(nextProjects)
      setTasks(nextTasks)
      setEvents(nextEvents)
      setSelectedTask((current) =>
        current ? nextTasks.find((task) => task.id === current.id) ?? null : null,
      )
      setSelectedProjectId((current) => current || nextProjects[0]?.id || '')
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法连接服务')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshExecution = useCallback(async () => {
    try {
      const [nextStats, nextTasks] = await Promise.all([api.stats(), api.tasks()])
      setStats(nextStats)
      setTasks(nextTasks)
      setSelectedTask((current) =>
        current ? nextTasks.find((task) => task.id === current.id) ?? null : null,
      )
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法同步任务状态')
    }
  }, [])

  useEffect(() => {
    void load()
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = api.onEvent((nextEvent) => {
      setEvents((current) => [...current.slice(-99), nextEvent])
      if (!refreshTimer) {
        refreshTimer = setTimeout(() => {
          refreshTimer = undefined
          void refreshExecution()
        }, 200)
      }
    })
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [load, refreshExecution])

  const currentProject = projects.find((project) => project.id === selectedProjectId)
  const projectTasks = tasks.filter((task) => task.project_id === selectedProjectId)
  const visibleColumns = useMemo(
    () =>
      COLUMNS.map((column) => ({
        ...column,
        tasks: projectTasks.filter((task) => task.status === column.status),
      })),
    [projectTasks],
  )
  const exceptionTasks = projectTasks.filter((task) =>
    ['failed', 'blocked', 'cancelled'].includes(task.status),
  )

  async function runProject() {
    if (!selectedProjectId) return
    try {
      await api.queueProject(selectedProjectId)
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '启动失败')
    }
  }

  async function queueTask(taskId: string) {
    try {
      await api.queueTask(taskId)
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '排队失败')
    }
  }

  async function cancelTask(taskId: string) {
    try {
      await api.cancelTask(taskId)
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '取消失败')
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Network size={21} /></div>
          <div>
            <strong>Agent Studio</strong>
            <span>协同开发工作台</span>
          </div>
        </div>
        <nav>
          <button className="nav-item active"><LayoutDashboard size={18} />总览</button>
          <button className="nav-item"><ListChecks size={18} />任务编排</button>
          <button className="nav-item"><Users size={18} />Agent 团队</button>
          <button className="nav-item"><FolderGit2 size={18} />项目空间</button>
        </nav>
        <div className="sidebar-label">当前项目</div>
        <div className="project-switcher">
          <div className="project-avatar">{currentProject?.name.slice(0, 1) || '—'}</div>
          <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
            {projects.length === 0 && <option value="">尚未创建项目</option>}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <ChevronDown size={16} />
        </div>
        <button className="add-project" onClick={() => setModal('project')}>
          <Plus size={16} />添加项目
        </button>
        <div className="sidebar-footer">
          <div className="system-status"><span />本地控制器在线</div>
          <span>v0.1.0 · Local First</span>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <p className="eyebrow">ORCHESTRATION OVERVIEW</p>
            <h1>{currentProject?.name || '创建你的第一个协同项目'}</h1>
            <p>{currentProject?.description || '连接本机 Agent，拆解任务并行推进项目。'}</p>
          </div>
          <div className="header-actions">
            <button className="button secondary" onClick={() => void load()}>
              <RefreshCw size={16} />刷新
            </button>
            <button className="button secondary" onClick={() => setModal('agent')}>
              <Bot size={16} />接入 Agent
            </button>
            <button className="button primary" onClick={() => setModal('task')} disabled={!currentProject}>
              <Plus size={16} />新建任务
            </button>
          </div>
        </header>

        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}

        <section className="stats-grid">
          <StatCard icon={<Bot />} label="可用 Agent" value={stats.agents} detail={`${agents.filter((agent) => agent.available).length} 个已就绪`} tone="purple" />
          <StatCard icon={<ListChecks />} label="项目任务" value={projectTasks.length} detail={`${projectTasks.filter((task) => task.status === 'queued').length} 个等待调度`} tone="blue" />
          <StatCard icon={<Activity />} label="正在执行" value={projectTasks.filter((task) => task.status === 'running').length} detail="实时同步输出" tone="orange" />
          <StatCard icon={<Zap />} label="本次完成" value={projectTasks.filter((task) => task.status === 'completed').length} detail={stats.failed ? `${stats.failed} 个任务失败` : '运行状态良好'} tone="green" />
        </section>

        <section className="team-strip">
          <div className="section-heading">
            <div>
              <span className="section-kicker">ACTIVE TEAM</span>
              <h2>Agent 团队</h2>
            </div>
            <button className="text-button" onClick={() => setModal('agent')}>管理团队 <Plus size={15} /></button>
          </div>
          <div className="agent-row">
            {agents.slice(0, 5).map((agent) => (
              <div className="agent-chip" key={agent.id}>
                <div className={`agent-icon ${agent.available ? 'online' : ''}`}><Bot size={19} /></div>
                <div>
                  <strong>{agent.name}</strong>
                  <span>{agent.capabilities.slice(0, 2).join(' · ') || '通用'}</span>
                </div>
                <i className={agent.available ? 'online' : ''} />
              </div>
            ))}
            {agents.length === 0 && <div className="empty-inline">暂无 Agent，先接入一个本地 CLI。</div>}
          </div>
        </section>

        <div className="workspace-grid">
          <section className="board-panel">
            <div className="section-heading board-heading">
              <div>
                <span className="section-kicker">TASK PIPELINE</span>
                <h2>协同任务流</h2>
              </div>
              <button className="button run" disabled={!projectTasks.length} onClick={() => void runProject()}>
                <Play size={16} fill="currentColor" />运行全部
              </button>
            </div>
            {loading ? (
              <div className="loading"><LoaderCircle className="spin" />正在连接控制器</div>
            ) : !currentProject ? (
              <EmptyState icon={<FolderGit2 />} title="还没有项目" detail="添加一个本地代码目录，开始组织 Agent 协作。" action={() => setModal('project')} actionLabel="添加项目" />
            ) : projectTasks.length === 0 ? (
              <EmptyState icon={<Boxes />} title="任务流是空的" detail="创建多个任务并设置依赖，系统会自动并行调度。" action={() => setModal('task')} actionLabel="创建第一个任务" />
            ) : (
              <>
                <div className="kanban">
                  {visibleColumns.map((column) => (
                    <div className="kanban-column" key={column.status}>
                      <div className="column-header">
                        <span className={`status-dot ${column.status}`} />
                        <strong>{column.label}</strong>
                        <b>{column.tasks.length}</b>
                      </div>
                      <p>{column.hint}</p>
                      <div className="column-content">
                        {column.tasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            agents={agents}
                            onOpen={() => setSelectedTask(task)}
                            onQueue={() => void queueTask(task.id)}
                            onCancel={() => void cancelTask(task.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {exceptionTasks.length > 0 && (
                  <div className="exception-list">
                    <strong>需要关注</strong>
                    {exceptionTasks.map((task) => (
                      <button key={task.id} onClick={() => setSelectedTask(task)}>
                        <span className={`status-dot ${task.status}`} />
                        {task.title}
                        <small>{STATUS_LABEL[task.status]}</small>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          <aside className="activity-panel">
            <div className="section-heading">
              <div>
                <span className="section-kicker">LIVE ACTIVITY</span>
                <h2>实时动态</h2>
              </div>
              <Radio size={17} className="pulse" />
            </div>
            <div className="activity-stream">
              {events.length === 0 && <div className="activity-empty"><Terminal size={24} /><span>等待任务输出</span></div>}
              {[...events].reverse().slice(0, 16).map((event) => {
                const task = tasks.find((item) => item.id === event.task_id)
                return (
                  <div className={`activity-item ${event.level}`} key={event.id}>
                    <div className="activity-line" />
                    <div className="activity-dot" />
                    <div>
                      <span>{task?.title || '系统'}</span>
                      <p>{event.message}</p>
                      <time>{formatTime(event.created_at)}</time>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>
        </div>
      </main>

      {modal === 'project' && <ProjectModal onClose={() => setModal(null)} onCreated={async () => { setModal(null); await load() }} />}
      {modal === 'agent' && <AgentModal onClose={() => setModal(null)} onCreated={async () => { setModal(null); await load() }} />}
      {modal === 'task' && currentProject && (
        <TaskModal
          project={currentProject}
          agents={agents}
          tasks={projectTasks}
          onClose={() => setModal(null)}
          onCreated={async () => { setModal(null); await load() }}
        />
      )}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          agents={agents}
          onClose={() => setSelectedTask(null)}
          onQueue={() => void queueTask(selectedTask.id)}
          onCancel={() => void cancelTask(selectedTask.id)}
        />
      )}
    </div>
  )
}

function StatCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: number; detail: string; tone: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  )
}

function TaskCard({ task, agents, onOpen, onQueue, onCancel }: { task: Task; agents: Agent[]; onOpen: () => void; onQueue: () => void; onCancel: () => void }) {
  const agent = agents.find((item) => item.id === (task.assigned_agent_id || task.agent_id))
  return (
    <article className={`task-card ${task.status}`} onClick={onOpen}>
      <div className="task-top">
        <span className="task-id">{task.id.slice(-5).toUpperCase()}</span>
        {task.depends_on.length > 0 && <span className="dependency"><Network size={12} />{task.depends_on.length}</span>}
      </div>
      <h3>{task.title}</h3>
      <p>{task.prompt}</p>
      <div className="tags">
        {task.required_capabilities.slice(0, 3).map((capability) => <span key={capability}>{capability}</span>)}
      </div>
      <div className="task-footer">
        <span className="assigned"><Bot size={14} />{agent?.name || '自动路由'}</span>
        {task.status === 'draft' && <button title="加入队列" onClick={(event) => { event.stopPropagation(); onQueue() }}><Play size={14} /></button>}
        {['queued', 'running'].includes(task.status) && <button title="取消任务" onClick={(event) => { event.stopPropagation(); onCancel() }}><CircleStop size={14} /></button>}
        {task.status === 'running' && <LoaderCircle size={15} className="spin" />}
        {task.status === 'completed' && <span className="done-mark">完成</span>}
      </div>
    </article>
  )
}

function EmptyState({ icon, title, detail, action, actionLabel }: { icon: React.ReactNode; title: string; detail: string; action: () => void; actionLabel: string }) {
  return (
    <div className="empty-state">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{detail}</p>
      <button className="button primary" onClick={action}><Plus size={16} />{actionLabel}</button>
    </div>
  )
}

function ModalFrame({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><h2>{title}</h2><p>{subtitle}</p></div>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', description: '', repo_path: '', use_worktrees: true })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await api.createProject(form)
      await onCreated()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }
  async function pickDirectory() {
    const directory = await api.pickDirectory()
    if (directory) setForm({ ...form, repo_path: directory })
  }
  return (
    <ModalFrame title="添加项目空间" subtitle="连接一个本地代码目录，Agent 将在隔离工作区中执行。" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <label>项目名称<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：电商后台" /></label>
        <label>本地仓库路径<div className="path-picker"><input required value={form.repo_path} onChange={(event) => setForm({ ...form, repo_path: event.target.value })} placeholder="选择本机项目目录" /><button type="button" onClick={() => void pickDirectory()}>浏览</button></div></label>
        <label>项目说明<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="描述目标、技术栈与协作约束" /></label>
        <label className="checkbox"><input type="checkbox" checked={form.use_worktrees} onChange={(event) => setForm({ ...form, use_worktrees: event.target.checked })} /><span><strong>启用 Git Worktree 隔离</strong><small>每个任务创建独立分支与工作目录</small></span></label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving}>{saving ? '创建中…' : '创建项目'}</button></div>
      </form>
    </ModalFrame>
  )
}

function AgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [discovered, setDiscovered] = useState<DiscoveredAgent[]>([])
  const [selected, setSelected] = useState<DiscoveredAgent | null>(null)
  const [name, setName] = useState('')
  const [executable, setExecutable] = useState('')
  const [argumentsText, setArgumentsText] = useState('{prompt}')
  const [capabilities, setCapabilities] = useState('coding, testing')
  const [maxConcurrency, setMaxConcurrency] = useState(1)
  const [error, setError] = useState('')
  useEffect(() => { void api.discoverAgents().then(setDiscovered) }, [])
  function choose(agent: DiscoveredAgent) {
    setSelected(agent)
    setName(agent.name)
    setExecutable(agent.executable)
    setArgumentsText(agent.arguments.join('\n'))
    setCapabilities(agent.capabilities.join(', '))
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await api.createAgent({
        name,
        description: selected ? `${selected.name} 本地 CLI 适配器` : '自定义本地 Agent',
        executable,
        arguments: argumentsText.split('\n').map((item) => item.trim()).filter(Boolean),
        capabilities: capabilities.split(',').map((item) => item.trim()).filter(Boolean),
        max_concurrency: maxConcurrency,
        enabled: true,
      })
      await onCreated()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '接入失败')
    }
  }
  return (
    <ModalFrame title="接入本地 Agent" subtitle="自动发现已安装 CLI，或配置任意命令行 Agent。" onClose={onClose}>
      <div className="discovery-grid">
        {discovered.map((agent) => (
          <button type="button" className={selected?.executable === agent.executable ? 'selected' : ''} key={agent.executable} onClick={() => choose(agent)}>
            <div><Code2 size={18} /><strong>{agent.name}</strong></div>
            <span className={agent.available ? 'available' : ''}>{agent.available ? '已安装' : '未发现'}</span>
          </button>
        ))}
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <div className="field-row">
          <label>名称<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="My Agent" /></label>
          <label>可执行命令<input required value={executable} onChange={(event) => setExecutable(event.target.value)} placeholder="claude" /></label>
        </div>
        <label>参数模板<textarea required value={argumentsText} onChange={(event) => setArgumentsText(event.target.value)} placeholder={'-p\n{prompt}'} /><small>每行一个参数；支持 {'{prompt}'}、{'{workspace}'}、{'{task_id}'}</small></label>
        <label>能力标签<input value={capabilities} onChange={(event) => setCapabilities(event.target.value)} placeholder="coding, testing, review" /></label>
        <label>最大并发数<input type="number" min="1" max="16" value={maxConcurrency} onChange={(event) => setMaxConcurrency(Number(event.target.value))} /></label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary"><Bot size={16} />接入 Agent</button></div>
      </form>
    </ModalFrame>
  )
}

function TaskModal({ project, agents, tasks, onClose, onCreated }: { project: Project; agents: Agent[]; tasks: Task[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [agentId, setAgentId] = useState('')
  const [capabilities, setCapabilities] = useState('coding')
  const [dependencies, setDependencies] = useState<string[]>([])
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await api.createTask({
        project_id: project.id,
        title,
        prompt,
        agent_id: agentId || null,
        required_capabilities: capabilities.split(',').map((item) => item.trim()).filter(Boolean),
        depends_on: dependencies,
      })
      await onCreated()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建失败')
    }
  }
  return (
    <ModalFrame title="创建协同任务" subtitle="定义能力与依赖，调度器会选择最合适的 Agent。" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <label>任务名称<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="实现用户认证模块" /></label>
        <label>任务指令<textarea required className="large" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="说明目标、验收标准、允许修改的范围…" /></label>
        <div className="field-row">
          <label>指定 Agent<select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">自动能力路由</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.available ? '' : '（离线）'}</option>)}</select></label>
          <label>所需能力<input value={capabilities} onChange={(event) => setCapabilities(event.target.value)} placeholder="coding, backend" /></label>
        </div>
        {tasks.length > 0 && (
          <fieldset>
            <legend>前置依赖（可多选）</legend>
            <div className="dependency-options">
              {tasks.map((task) => (
                <label className="dependency-option" key={task.id}>
                  <input type="checkbox" checked={dependencies.includes(task.id)} onChange={(event) => setDependencies((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} />
                  <span>{task.title}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary"><Sparkles size={16} />创建任务</button></div>
      </form>
    </ModalFrame>
  )
}

function TaskDrawer({ task, agents, onClose, onQueue, onCancel }: { task: Task; agents: Agent[]; onClose: () => void; onQueue: () => void; onCancel: () => void }) {
  const agent = agents.find((item) => item.id === (task.assigned_agent_id || task.agent_id))
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-header"><span className={`status-pill ${task.status}`}>{STATUS_LABEL[task.status]}</span><button onClick={onClose}><X size={20} /></button></div>
        <span className="task-id">{task.id}</span>
        <h2>{task.title}</h2>
        <p className="task-prompt">{task.prompt}</p>
        <div className="drawer-grid">
          <div><Bot size={16} /><span>执行 Agent</span><strong>{agent?.name || '自动路由'}</strong></div>
          <div><Clock3 size={16} /><span>创建时间</span><strong>{formatTime(task.created_at)}</strong></div>
          <div><GitBranch size={16} /><span>工作分支</span><strong>{task.branch_name || '—'}</strong></div>
          <div><Braces size={16} /><span>退出码</span><strong>{task.exit_code ?? '—'}</strong></div>
        </div>
        <div className="drawer-section"><h3>能力要求</h3><div className="tags">{task.required_capabilities.map((item) => <span key={item}>{item}</span>)}</div></div>
        <div className="drawer-section"><h3>Agent 输出</h3><pre>{task.output || task.error || '暂无输出'}</pre></div>
        {task.workspace_path && <button className="workspace-path" onClick={() => void api.openPath(task.workspace_path!)}><FolderGit2 size={15} /><code>{task.workspace_path}</code></button>}
        {['draft', 'failed', 'blocked', 'cancelled'].includes(task.status) && <button className="button primary" onClick={onQueue}><Play size={16} />{task.status === 'draft' ? '加入队列' : '重新排队'}</button>}
        {['queued', 'running'].includes(task.status) && <button className="button secondary" onClick={onCancel}><CircleStop size={16} />取消任务</button>}
      </aside>
    </div>
  )
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' }).format(new Date(value))
}

export default App
