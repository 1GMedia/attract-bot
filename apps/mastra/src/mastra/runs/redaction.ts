const SECRET_ASSIGNMENT =
  /(authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password)(["'\s:=]+)(?:bearer\s+)?[a-z0-9._~+/=-]{8,}/gi
const BEARER_TOKEN = /\bbearer\s+[a-z0-9._~+/=-]{8,}/gi
const COMPOSIO_KEY = /\bck_[a-z0-9_-]{8,}/gi

export function redactRunText(value: string | undefined): string | undefined {
  if (!value) return value
  return value
    .replace(SECRET_ASSIGNMENT, (_match, name: string, separator: string) => `${name}${separator}[REDACTED]`)
    .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
    .replace(COMPOSIO_KEY, '[REDACTED]')
}
