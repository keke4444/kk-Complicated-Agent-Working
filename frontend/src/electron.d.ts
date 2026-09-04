import type {
  Agent,
  DiscoveredAgent,
  Project,
  Stats,
  StudioEvent,
  Task,
} from './types'

interface StudioApi {
  stats(): Promise<Stats>
  agents(): Promise<Agent[]>
  discoverAgents(): Promise<DiscoveredAgent[]>
  createAgent(payload: Omit<Agent, 'id' | 'available' | 'created_at'>): Promise<Agent>
  deleteAgent(agentId: string): Promise<void>
  projects(): Promise<Project[]>
  createProject(payload: Omit<Project, 'id' | 'created_at'>): Promise<Project>
  pickDirectory(): Promise<string | null>
  tasks(projectId?: string): Promise<Task[]>
  createTask(
    payload: Pick<
      Task,
      'project_id' | 'title' | 'prompt' | 'required_capabilities' | 'agent_id' | 'depends_on'
    >,
  ): Promise<Task>
  queueTask(taskId: string): Promise<Task>
  queueProject(projectId: string): Promise<Task[]>
  cancelTask(taskId: string): Promise<Task>
  events(): Promise<StudioEvent[]>
  openPath(targetPath: string): Promise<void>
  onEvent(listener: (event: StudioEvent) => void): () => void
}

declare global {
  interface Window {
    studio: StudioApi
  }
}

export {}
