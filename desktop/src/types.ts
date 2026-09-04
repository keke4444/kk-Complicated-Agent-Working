export type TaskStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'

export interface AgentInput {
  name: string
  description: string
  executable: string
  arguments: string[]
  capabilities: string[]
  max_concurrency: number
  enabled: boolean
}

export interface Agent extends AgentInput {
  id: string
  available: boolean
  created_at: string
}

export interface ProjectInput {
  name: string
  description: string
  repo_path: string
  use_worktrees: boolean
}

export interface Project extends ProjectInput {
  id: string
  created_at: string
}

export interface TaskInput {
  project_id: string
  title: string
  prompt: string
  required_capabilities: string[]
  agent_id: string | null
  depends_on: string[]
}

export interface StudioTask extends TaskInput {
  id: string
  status: TaskStatus
  assigned_agent_id: string | null
  workspace_path: string | null
  branch_name: string | null
  output: string
  error: string
  exit_code: number | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface StudioEvent {
  id: number
  task_id: string | null
  level: 'info' | 'output' | 'error'
  message: string
  created_at: string
}

export interface Stats {
  agents: number
  projects: number
  tasks: number
  running: number
  completed: number
  failed: number
}

export interface DiscoveredAgent {
  name: string
  executable: string
  available: boolean
  arguments: string[]
  capabilities: string[]
}
