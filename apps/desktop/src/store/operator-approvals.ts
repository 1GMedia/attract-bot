import type { MastraRunApproval } from '@hermes/shared/mastra-runs'
import { computed } from 'nanostores'

import type { HermesGateway } from '@/hermes'

import { $mastraApprovalRuns, resolveMastraApproval } from './mastra-runs'
import { $approvalRequests, type ApprovalRequest, clearApprovalRequest } from './prompts'

export interface HermesOperatorApproval {
  id: string
  request: ApprovalRequest
  source: 'hermes-tool'
}

export interface MastraOperatorApproval {
  id: string
  request: MastraRunApproval
  source: 'mastra-workflow'
}

export type OperatorApproval = HermesOperatorApproval | MastraOperatorApproval

export const $operatorApprovals = computed(
  [$approvalRequests, $mastraApprovalRuns],
  (hermes, mastra): OperatorApproval[] => [
    ...Object.values(hermes).map(request => ({
      id: `hermes:${request.sessionId}`,
      request,
      source: 'hermes-tool' as const
    })),
    ...mastra.flatMap(run =>
      run.approval
        ? [
            {
              id: `mastra:${run.runId}:${run.approval.stepId}`,
              request: run.approval,
              source: 'mastra-workflow' as const
            }
          ]
        : []
    )
  ]
)

export type OperatorApprovalDecision = 'always' | 'approve' | 'decline' | 'session'

export async function resolveOperatorApproval(
  approval: OperatorApproval,
  decision: OperatorApprovalDecision,
  gateway?: Pick<HermesGateway, 'request'> | null
): Promise<void> {
  if (approval.source === 'mastra-workflow') {
    if (decision === 'always' || decision === 'session') {
      throw new Error('Workflow approvals can only be approved once or declined.')
    }

    await resolveMastraApproval(approval.request.runId, decision)

    return
  }

  if (!gateway) {throw new Error('Hermes gateway is disconnected.')}
  const choice = decision === 'approve' ? 'once' : decision === 'decline' ? 'deny' : decision
  await gateway.request('approval.respond', {
    choice,
    session_id: approval.request.sessionId ?? undefined
  })
  clearApprovalRequest(approval.request.sessionId)
}
