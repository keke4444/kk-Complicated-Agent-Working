import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Orchestrator } from '../src/orchestrator'
import { StudioStore } from '../src/store'
import type { StudioTask, TaskStatus } from '../src/types'

const waitForStatus = async (
  store: StudioStore,
  taskId: string,
  status: TaskStatus,
): Promise<StudioTask> => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const task = store.getTask(taskId)
    if (task?.status === status) return task
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Task ${taskId} did not reach ${status}`)
}

test('routes and executes dependent tasks in order', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-studio-'))
  const store = new StudioStore(path.join(directory, 'test.db'))
  const orchestrator = new Orchestrator(store, path.join(directory, 'worktrees'))
  try {
    const project = store.createProject({
      name: 'Example',
      description: '',
      repo_path: directory,
      use_worktrees: false,
    })
    const first = store.createTask({
      project_id: project.id,
      title: 'Plan',
      prompt: 'Create a plan',
      required_capabilities: ['planning'],
      agent_id: null,
      depends_on: [],
    })
    const second = store.createTask({
      project_id: project.id,
      title: 'Build',
      prompt: 'Implement the plan',
      required_capabilities: ['coding'],
      agent_id: null,
      depends_on: [first.id],
    })

    orchestrator.start()
    orchestrator.queueProject(project.id)

    const firstResult = await waitForStatus(store, first.id, 'completed')
    const secondResult = await waitForStatus(store, second.id, 'completed')
    assert.match(firstResult.output, /Done/)
    assert.match(secondResult.output, /Done/)
    assert.ok(secondResult.started_at! >= firstResult.finished_at!)
  } finally {
    orchestrator.stop()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
