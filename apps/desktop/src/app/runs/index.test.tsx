// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $mastraRunDetails, $mastraRuns, $mastraStatus } from '@/store/mastra-runs'

import { RunsView } from './index'

const resolveApproval = vi.fn()

const run = {
  runId: 'run-1',
  workflowId: 'hermes-task-lifecycle' as const,
  workspaceId: '/workspace',
  taskId: 'task-1',
  profile: 'agency',
  instructionsPreview: 'Read the connected account and return evidence.',
  state: 'awaiting-approval' as const,
  createdAt: '2026-08-25T12:00:00.000Z',
  updatedAt: '2026-08-25T12:01:00.000Z',
  evidence: { status: 'missing' as const },
  approval: {
    runId: 'run-1',
    stepId: 'await-execution-approval',
    instanceId: 'instance-1',
    requestedAt: '2026-08-25T12:01:00.000Z',
    workspaceId: '/workspace',
    taskId: 'task-1',
    profile: 'agency',
    instructionsPreview: 'Read the connected account and return evidence.'
  }
}

beforeEach(() => {
  resolveApproval.mockResolvedValue({ ...run, state: 'running', approval: undefined })
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      mastra: {
        cancelRun: vi.fn(),
        getRun: vi.fn().mockResolvedValue({ ...run, artifacts: [], steps: [] }),
        getStatus: vi.fn(),
        listRuns: vi.fn(),
        onEvent: vi.fn(() => () => {}),
        resolveApproval,
        retryRun: vi.fn(),
        startRun: vi.fn()
      }
    }
  })
  $mastraStatus.set({
    available: true,
    instanceId: 'instance-1',
    mode: 'local',
    service: 'hermes-mastra-local',
    capabilities: {
      agents: false,
      evals: true,
      mcpServer: true,
      memory: true,
      observability: true,
      rag: false,
      storage: true,
      studio: false,
      workflows: true
    }
  })
  $mastraRuns.set([run])
  $mastraRunDetails.set({
    'run-1': {
      ...run,
      artifacts: [{ id: 'evidence-1', kind: 'text', label: 'Evidence', content: 'Verified evidence.' }],
      steps: [{ id: 'await-execution-approval', state: 'suspended' }],
      traceId: 'trace-1'
    }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  $mastraRuns.set([])
  $mastraRunDetails.set({})
})

describe('RunsView', () => {
  it('renders a deep-linked durable approval with evidence and binds the instance nonce', async () => {
    render(
      <MemoryRouter initialEntries={['/runs?run=run-1']}>
        <RunsView />
      </MemoryRouter>
    )

    expect(screen.getAllByText('Read the connected account and return evidence.').length).toBeGreaterThan(0)
    expect(screen.getByText('trace-1')).toBeTruthy()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Approve/i })))
    await waitFor(() =>
      expect(resolveApproval).toHaveBeenCalledWith({
        decision: 'approve',
        instanceId: 'instance-1',
        runId: 'run-1',
        stepId: 'await-execution-approval'
      })
    )
  })

  it('renders the compact rail without creating a second approval surface', () => {
    render(
      <MemoryRouter>
        <RunsView compact />
      </MemoryRouter>
    )
    expect(screen.getByText('Active and approval-blocked workflows')).toBeTruthy()
    expect(screen.getByText('Awaiting approval')).toBeTruthy()
  })
})
