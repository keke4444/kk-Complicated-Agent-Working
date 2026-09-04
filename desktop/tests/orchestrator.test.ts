import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Orchestrator } from '../src/orchestrator'
import { StudioStore } from '../src/store'
import type { StudioTask, TaskStatus } from '../src/types'

const initializeRepository = (repoPath: string): void => {
  mkdirSync(repoPath)
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath, stdio: 'ignore' })
  writeFileSync(path.join(repoPath, 'README.md'), '# Fixture\n')
  execFileSync('git', ['add', 'README.md'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Multi-Agent Studio',
      '-c',
      'user.email=multi-agent-studio@localhost',
      'commit',
      '-m',
      'Initialize fixture',
    ],
    { cwd: repoPath, stdio: 'ignore' },
  )
}

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

const waitForOutput = async (
  store: StudioStore,
  taskId: string,
  output: string,
): Promise<void> => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (store.getTask(taskId)?.output.includes(output)) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Task ${taskId} did not output ${output}`)
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

test('ignores stale process events after cancellation and requeue', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-studio-'))
  const store = new StudioStore(path.join(directory, 'test.db'))
  const orchestrator = new Orchestrator(store, path.join(directory, 'worktrees'))
  try {
    const agent = store.createAgent({
      name: 'Retry Agent',
      description: '',
      executable: process.execPath,
      arguments: [
        '-e',
        [
          "const fs = require('node:fs')",
          "const marker = require('node:path').join(process.argv[1], '.retry-marker')",
          'if (!fs.existsSync(marker)) {',
          "  fs.writeFileSync(marker, 'started')",
          "  console.log('FIRST_START')",
          '  process.on(\'SIGTERM\', () => setTimeout(() => process.exit(1), 500))',
          '  setTimeout(() => process.exit(0), 5000)',
          '} else {',
          "  console.log('RETRY_START')",
          "  setTimeout(() => console.log('RETRY_DONE'), 50)",
          '}',
        ].join(';'),
        '{workspace}',
      ],
      capabilities: ['retry'],
      max_concurrency: 1,
      enabled: true,
    })
    const project = store.createProject({
      name: 'Retry Project',
      description: '',
      repo_path: directory,
      use_worktrees: false,
    })
    const task = store.createTask({
      project_id: project.id,
      title: 'Retry',
      prompt: 'Test retry',
      required_capabilities: ['retry'],
      agent_id: agent.id,
      depends_on: [],
    })

    orchestrator.start()
    orchestrator.queueTask(task.id)
    await waitForStatus(store, task.id, 'running')
    await waitForOutput(store, task.id, 'FIRST_START')
    orchestrator.cancelTask(task.id)
    orchestrator.queueTask(task.id)

    const completed = await waitForStatus(store, task.id, 'completed')
    assert.match(completed.output, /RETRY_DONE/)
    await new Promise((resolve) => setTimeout(resolve, 700))
    assert.equal(store.getTask(task.id)?.status, 'completed')
    assert.doesNotMatch(store.getTask(task.id)?.error ?? '', /unknown/)
  } finally {
    orchestrator.stop()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('propagates committed changes from multiple dependencies', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-studio-'))
  const repoPath = path.join(directory, 'repo')
  initializeRepository(repoPath)
  const store = new StudioStore(path.join(directory, 'test.db'))
  const orchestrator = new Orchestrator(store, path.join(directory, 'worktrees'))
  try {
    const agent = store.createAgent({
      name: 'Workspace Agent',
      description: '',
      executable: process.execPath,
      arguments: [
        '-e',
        [
          "const fs = require('node:fs')",
          "const path = require('node:path')",
          'const prompt = process.argv[1]',
          'const workspace = process.argv[2]',
          "if (prompt.includes('WRITE_ALPHA')) fs.writeFileSync(path.join(workspace, 'alpha.txt'), 'alpha')",
          "if (prompt.includes('WRITE_BETA')) fs.writeFileSync(path.join(workspace, 'beta.txt'), 'beta')",
          "if (prompt.includes('COMBINE')) {",
          "  const alpha = fs.readFileSync(path.join(workspace, 'alpha.txt'), 'utf8')",
          "  const beta = fs.readFileSync(path.join(workspace, 'beta.txt'), 'utf8')",
          "  fs.writeFileSync(path.join(workspace, 'combined.txt'), `${alpha}+${beta}`)",
          '}',
        ].join(';'),
        '{prompt}',
        '{workspace}',
      ],
      capabilities: ['workspace'],
      max_concurrency: 2,
      enabled: true,
    })
    const project = store.createProject({
      name: 'Workspace Project',
      description: '',
      repo_path: repoPath,
      use_worktrees: true,
    })
    const alpha = store.createTask({
      project_id: project.id,
      title: 'Alpha',
      prompt: 'WRITE_ALPHA',
      required_capabilities: ['workspace'],
      agent_id: agent.id,
      depends_on: [],
    })
    const beta = store.createTask({
      project_id: project.id,
      title: 'Beta',
      prompt: 'WRITE_BETA',
      required_capabilities: ['workspace'],
      agent_id: agent.id,
      depends_on: [],
    })
    const combined = store.createTask({
      project_id: project.id,
      title: 'Combined',
      prompt: 'COMBINE',
      required_capabilities: ['workspace'],
      agent_id: agent.id,
      depends_on: [alpha.id, beta.id],
    })

    orchestrator.start()
    orchestrator.queueProject(project.id)

    await waitForStatus(store, alpha.id, 'completed')
    await waitForStatus(store, beta.id, 'completed')
    const result = await waitForStatus(store, combined.id, 'completed')
    assert.equal(
      readFileSync(path.join(result.workspace_path!, 'combined.txt'), 'utf8'),
      'alpha+beta',
    )
  } finally {
    orchestrator.stop()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('does not launch an agent cancelled during workspace preparation', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-studio-'))
  const repoPath = path.join(directory, 'repo')
  const launchedPath = path.join(directory, 'launched')
  initializeRepository(repoPath)
  const store = new StudioStore(path.join(directory, 'test.db'))
  const orchestrator = new Orchestrator(store, path.join(directory, 'worktrees'))
  try {
    const agent = store.createAgent({
      name: 'Launch Agent',
      description: '',
      executable: process.execPath,
      arguments: [
        '-e',
        "require('node:fs').writeFileSync(process.argv[1], 'launched')",
        launchedPath,
      ],
      capabilities: ['launch'],
      max_concurrency: 1,
      enabled: true,
    })
    const project = store.createProject({
      name: 'Cancellation Project',
      description: '',
      repo_path: repoPath,
      use_worktrees: true,
    })
    const task = store.createTask({
      project_id: project.id,
      title: 'Cancel',
      prompt: 'Cancel during preparation',
      required_capabilities: ['launch'],
      agent_id: agent.id,
      depends_on: [],
    })

    orchestrator.start()
    orchestrator.queueTask(task.id)
    orchestrator.cancelTask(task.id)
    await new Promise((resolve) => setTimeout(resolve, 700))

    assert.equal(store.getTask(task.id)?.status, 'cancelled')
    assert.equal(existsSync(launchedPath), false)
  } finally {
    orchestrator.stop()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('preserves stderr when an agent fails', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-studio-'))
  const store = new StudioStore(path.join(directory, 'test.db'))
  const orchestrator = new Orchestrator(store, path.join(directory, 'worktrees'))
  try {
    const agent = store.createAgent({
      name: 'Failure Agent',
      description: '',
      executable: process.execPath,
      arguments: ['-e', "console.error('ACTIONABLE_DETAIL'); process.exit(2)"],
      capabilities: ['failure'],
      max_concurrency: 1,
      enabled: true,
    })
    const project = store.createProject({
      name: 'Failure Project',
      description: '',
      repo_path: directory,
      use_worktrees: false,
    })
    const task = store.createTask({
      project_id: project.id,
      title: 'Fail',
      prompt: 'Fail with diagnostics',
      required_capabilities: ['failure'],
      agent_id: agent.id,
      depends_on: [],
    })

    orchestrator.start()
    orchestrator.queueTask(task.id)
    const failed = await waitForStatus(store, task.id, 'failed')
    assert.match(failed.error, /ACTIONABLE_DETAIL/)
    assert.match(failed.error, /Agent exited with code 2/)
  } finally {
    orchestrator.stop()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
