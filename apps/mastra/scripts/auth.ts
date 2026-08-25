import { createHmac, randomUUID } from 'node:crypto'

function encoded(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function canaryJwt(secret: string, now = Math.floor(Date.now() / 1_000)): string {
  const header = encoded({ alg: 'HS256', typ: 'JWT' })
  const payload = encoded({
    aud: 'hermes-mastra-local',
    exp: now + 60,
    iat: now,
    jti: randomUUID(),
    sub: 'hermes-desktop'
  })
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`
}

export function authenticatedHeaders(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${canaryJwt(secret)}`, 'Content-Type': 'application/json' }
}
