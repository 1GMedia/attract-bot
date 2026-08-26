import { describe, expect, it, vi } from 'vitest'
import { HermesClient, stableSessionKey } from '../src/mastra/hermes/client.ts'
import { createRuntimeConfig } from '../src/mastra/runtime-config.ts'

describe('Hermes execution bridge', () => {
  it('uses authenticated profile routing and stable non-PII session keys', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-123',
          choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
        }),
        {
          status: 200,
          headers: { 'X-Hermes-Session-Id': 'session-123' }
        }
      )
    )
    const config = createRuntimeConfig(
      {
        KORGO_HERMES_API_KEY: 'test-secret-never-logged',
        KORGO_HERMES_PROFILE: 'agency'
      },
      '/tmp/test-home'
    )

    const result = await new HermesClient(config.hermes, fetchMock).execute({
      workspaceId: 'workspace-with-private-name',
      taskId: 'task-with-private-name',
      instructions: 'Perform the approved task.'
    })

    expect(result).toMatchObject({
      completionId: 'chatcmpl-123',
      sessionId: 'session-123',
      status: 'completed',
      response: 'done'
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8642/p/agency/v1/chat/completions')
    const headers = request?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-secret-never-logged')
    expect(headers['X-Hermes-Session-Key']).toMatch(/^mastra-[a-f0-9]{40}$/)
    expect(headers['X-Hermes-Session-Key']).not.toContain('private')
  })

  it('does not relabel partial Hermes execution as complete', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-partial',
          choices: [{ message: { content: 'incomplete' }, finish_reason: 'length' }],
          hermes: { completed: false, partial: true, failed: false }
        }),
        { status: 200 }
      )
    )
    const config = createRuntimeConfig({ KORGO_HERMES_API_KEY: 'test-key' }, '/tmp/test-home')
    const result = await new HermesClient(config.hermes, fetchMock).execute({
      workspaceId: 'workspace',
      taskId: 'task',
      instructions: 'Run'
    })
    expect(result.status).toBe('partial')
  })

  it('fails closed when Hermes credentials are absent', async () => {
    const config = createRuntimeConfig({}, '/tmp/test-home')
    await expect(
      new HermesClient(config.hermes).execute({
        workspaceId: 'workspace',
        taskId: 'task',
        instructions: 'Run'
      })
    ).rejects.toThrow(/credential/)
  })

  it('derives the same session key without exposing workspace identifiers', () => {
    expect(stableSessionKey('workspace', 'task')).toBe(stableSessionKey('workspace', 'task'))
    expect(stableSessionKey('workspace', 'task')).not.toContain('workspace')
  })
})
