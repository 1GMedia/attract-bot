export function instanceMatches(instanceId: string, currentInstanceId: string): boolean {
  return Boolean(instanceId) && instanceId === currentInstanceId
}
