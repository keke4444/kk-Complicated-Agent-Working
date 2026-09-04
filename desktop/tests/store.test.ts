import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { StudioStore } from '../src/store'

test('stores projects and dependent tasks', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-studio-'))
  const store = new StudioStore(path.join(directory, 'test.db'))
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
    assert.equal(store.listProjects().length, 1)
    assert.deepEqual(store.getTask(second.id)?.depends_on, [first.id])
    assert.equal(store.stats().tasks, 2)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('claims a queued task only once', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-studio-'))
  const store = new StudioStore(path.join(directory, 'test.db'))
  try {
    const project = store.createProject({
      name: 'Example',
      description: '',
      repo_path: directory,
      use_worktrees: false,
    })
    const agent = store.listAgents()[0]
    const task = store.createTask({
      project_id: project.id,
      title: 'Task',
      prompt: 'Do work',
      required_capabilities: [],
      agent_id: agent.id,
      depends_on: [],
    })
    store.queueTask(task.id)
    assert.equal(store.claimTask(task.id, agent.id), true)
    assert.equal(store.claimTask(task.id, agent.id), false)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
