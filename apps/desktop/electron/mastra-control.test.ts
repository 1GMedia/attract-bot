import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { MastraControlClient, signMastraJwt } from './mastra-control'

function decode(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

describe('Mastra desktop control client', () => {
  it('signs a short-lived HS256 token without exposing the secret', () => {
    const token = signMastraJwt('desktop-secret', 100)
    const [header, payload, signature] = token.split('.')
    expect(decode(header)).toMatchObject({ alg: 'HS256', typ: 'JWT' })
    expect(decode(payload)).toMatchObject({ sub: 'hermes-desktop', iat: 100, exp: 160 })
    expect(signature).toBe(
      crypto.createHmac('sha256', 'desktop-secret').update(`${header}.${payload}`).digest('base64url')
    )
    expect(token).not.toContain('desktop-secret')
  })

  it('binds start mutations to the current instance and keeps auth inside fetch', async () => {
    const fetchImplementation = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Response(JSON.stringify({ runId: 'run-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    ) as unknown as typeof fetch

    const client = new MastraControlClient(fetchImplementation)
    client.attach({ baseUrl: 'http://127.0.0.1:4112', instanceId: 'instance-a', jwtSecret: 'jwt-secret' })

    await client.startRun({ workspaceId: 'workspace', taskId: 'task', instructions: 'Do the work.' })

    const [, init] = (fetchImplementation as any).mock.calls[0]
    expect(JSON.parse(init.body)).toMatchObject({ instanceId: 'instance-a', workspaceId: 'workspace' })
    expect(init.headers.Authorization).toMatch(/^Bearer /)
    expect(JSON.stringify(init)).not.toContain('jwt-secret')
  })

  it('routes supervisor turns through the authenticated control client', async () => {
    const fetchImplementation = vi.fn(
      async () => new Response(JSON.stringify({ turnId: 'turn-1', state: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    ) as unknown as typeof fetch
    const client = new MastraControlClient(fetchImplementation)
    client.attach({ baseUrl: 'http://127.0.0.1:4112', instanceId: 'instance-a', jwtSecret: 'jwt-secret' })

    await client.startTurn({
      clientTurnId: 'client-1',
      message: 'Check the Orgo desktop.',
      profile: 'default',
      threadId: 'chat-1',
      workspaceId: 'workspace-1'
    })

    const [url, init] = (fetchImplementation as any).mock.calls[0]
    expect(url).toBe('http://127.0.0.1:4112/korgo/turns')
    expect(JSON.parse(init.body)).toMatchObject({ instanceId: 'instance-a', threadId: 'chat-1' })
  })

  it('reports remote profiles as unavailable without attempting loopback access', async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch
    const client = new MastraControlClient(fetchImplementation)
    client.detach({ mode: 'remote', reason: 'Remote profile.' })
    await expect(client.getStatus()).resolves.toMatchObject({
      available: false,
      mode: 'remote',
      reason: 'Remote profile.'
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('reports an attached Orgo runtime through the same status contract', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      instanceId: 'orgo-instance',
      capabilities: { agents: true, workflows: true }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch
    const client = new MastraControlClient(fetchImplementation)
    client.attach({
      baseUrl: 'http://127.0.0.1:49112',
      instanceId: 'orgo-instance',
      jwtSecret: 'remote-jwt',
      mode: 'remote'
    })

    await expect(client.getStatus()).resolves.toMatchObject({
      available: true,
      instanceId: 'orgo-instance',
      mode: 'remote',
      capabilities: { agents: true, workflows: true }
    })
  })

  it('exposes only typed IPC methods to the renderer, never auth material or unrestricted HTTP', () => {
    const preload = fs.readFileSync(path.join(import.meta.dirname, 'preload.ts'), 'utf8')
    const mastraNamespace = preload.slice(preload.indexOf('mastra: {'), preload.indexOf('mastra: {') + 1_800)
    expect(mastraNamespace).toContain("ipcRenderer.invoke('hermes:mastra:status')")
    expect(mastraNamespace).toContain("ipcRenderer.invoke('hermes:mastra:turns:start'")
    expect(mastraNamespace).not.toMatch(/jwtSecret|KORGO_MASTRA_JWT_SECRET|baseUrl|\bfetch\s*\(/)
  })
})
