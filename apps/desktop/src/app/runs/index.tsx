import type { MastraRunDetail, MastraRunState, MastraRunSummary } from '@hermes/shared/mastra-runs'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { openArtifact, upsertArtifact } from '@/store/artifacts'
import { $mastraChatEnabled, setMastraChatEnabled } from '@/store/mastra-chat'
import {
  $activeMastraRuns,
  $mastraRunDetails,
  $mastraRuns,
  $mastraRunsError,
  $mastraRunsLoading,
  $mastraStatus,
  cancelMastraRun,
  loadMastraRun,
  refreshMastraRuns,
  retryMastraRun,
  startMastraRun
} from '@/store/mastra-runs'
import { resolveOperatorApproval } from '@/store/operator-approvals'
import { $activeGatewayProfile } from '@/store/profile'
import { openRouteTile } from '@/store/route-tiles'
import { $currentCwd } from '@/store/session'

import { navigateToWorkspacePage, RUNS_ROUTE } from '../routes'

const RUN_STATES: MastraRunState[] = [
  'queued',
  'preparing',
  'awaiting-approval',
  'running',
  'succeeded',
  'failed',
  'cancelled'
]

const ACTIVE_STATES = new Set<MastraRunState>(['queued', 'preparing', 'awaiting-approval', 'running'])

function formatDate(value?: string): string {
  if (!value) {return '—'}
  const date = new Date(value)

  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString()
}

function shortId(value?: string): string {
  if (!value) {return '—'}

  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

function StatePill({ label, state }: { label: string; state: MastraRunState }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-medium',
        state === 'failed' && 'border-destructive/30 bg-destructive/10 text-destructive',
        state === 'cancelled' && 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary)',
        state === 'succeeded' && 'border-primary/25 bg-primary/8 text-primary',
        ACTIVE_STATES.has(state) &&
          state !== 'awaiting-approval' &&
          'border-(--ui-stroke-secondary) bg-(--ui-control-active-background) text-(--ui-text-primary)',
        state === 'awaiting-approval' && 'border-primary/30 bg-primary/10 text-(--ui-text-primary)'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-current',
          (state === 'running' || state === 'preparing') && 'animate-pulse'
        )}
      />
      {label}
    </span>
  )
}

function RunRow({
  compact,
  onSelect,
  run,
  selected,
  stateLabel
}: {
  compact?: boolean
  onSelect: () => void
  run: MastraRunSummary
  selected: boolean
  stateLabel: string
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        'group w-full rounded-md border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-(--ui-stroke-secondary) bg-(--ui-control-active-background)'
          : 'border-transparent hover:border-(--ui-stroke-tertiary) hover:bg-(--ui-control-hover-background)'
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatePill label={stateLabel} state={run.state} />
        <span className="ml-auto shrink-0 font-mono text-[0.62rem] text-(--ui-text-quaternary)">
          {shortId(run.runId)}
        </span>
      </div>
      <div className="mt-2 line-clamp-2 text-xs leading-5 text-(--ui-text-primary)">{run.instructionsPreview}</div>
      <div className="mt-1.5 flex items-center gap-2 text-[0.65rem] text-(--ui-text-tertiary)">
        <span className="truncate">{run.profile}</span>
        {!compact && <span className="truncate">{run.workspaceId}</span>}
        <span className="ml-auto shrink-0">{formatDate(run.updatedAt)}</span>
      </div>
    </button>
  )
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="border-t border-(--ui-stroke-tertiary) pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-[0.67rem] font-semibold uppercase tracking-[0.08em] text-(--ui-text-tertiary)">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Definition({ label, value }: { label: string; value?: ReactNode }) {
  if (value == null || value === '') {return null}

  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-1 text-[0.7rem] leading-5">
      <dt className="text-(--ui-text-tertiary)">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-(--ui-text-secondary)">{value}</dd>
    </div>
  )
}

function DetailPanel({ detail, run }: { detail?: MastraRunDetail; run: MastraRunSummary }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = detail ?? run

  const mutate = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name)
    setError(null)

    try {
      await action()
      await loadMastraRun(run.runId).catch(() => undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Run mutation failed.')
    } finally {
      setBusy(null)
    }
  }

  const openEvidence = (artifact: NonNullable<MastraRunDetail['artifacts']>[number]) => {
    const content = artifact.content || artifact.value

    if (!content) {return}

    const registered = upsertArtifact(
      detail?.sessionId || run.runId,
      { kind: 'code', language: 'markdown', title: artifact.label },
      content
    )

    if (registered) {openArtifact(registered.artifactId)}
  }

  return (
    <div className="min-h-0 overflow-y-auto px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatePill label={t.runs.states[current.state] || current.state} state={current.state} />
            <span className="font-mono text-[0.65rem] text-(--ui-text-quaternary)">{current.runId}</span>
          </div>
          <h2 className="mt-3 text-sm font-semibold text-(--ui-text-primary)">{current.instructionsPreview}</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {current.approval ? (
            <>
              <Button
                disabled={busy != null}
                onClick={() =>
                  void mutate('approve', () =>
                    resolveOperatorApproval(
                      {
                        id: `mastra:${current.approval!.runId}:${current.approval!.stepId}`,
                        request: current.approval!,
                        source: 'mastra-workflow'
                      },
                      'approve'
                    )
                  )
                }
                size="xs"
              >
                <Codicon name="check" /> {t.runs.approve}
              </Button>
              <Button
                disabled={busy != null}
                onClick={() =>
                  void mutate('decline', () =>
                    resolveOperatorApproval(
                      {
                        id: `mastra:${current.approval!.runId}:${current.approval!.stepId}`,
                        request: current.approval!,
                        source: 'mastra-workflow'
                      },
                      'decline'
                    )
                  )
                }
                size="xs"
                variant="outline"
              >
                <Codicon name="close" /> {t.runs.decline}
              </Button>
            </>
          ) : null}
          {ACTIVE_STATES.has(current.state) && !current.approval ? (
            <Button
              disabled={busy != null}
              onClick={() => void mutate('cancel', () => cancelMastraRun(run.runId))}
              size="xs"
              variant="outline"
            >
              {t.runs.cancel}
            </Button>
          ) : null}
          {current.state === 'failed' || current.state === 'cancelled' ? (
            <Button
              disabled={busy != null}
              onClick={() => void mutate('retry', () => retryMastraRun(run.runId))}
              size="xs"
              variant="outline"
            >
              <Codicon name="debug-restart" /> {t.runs.retry}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      ) : null}

      <div className="mt-5 space-y-5">
        <Section title={t.runs.detail}>
          <dl>
            <Definition label={t.runs.workspace} value={current.workspaceId} />
            <Definition label={t.runs.taskId} value={current.taskId} />
            <Definition label={t.runs.profile} value={current.profile} />
            <Definition label={t.runs.requested} value={formatDate(current.createdAt)} />
            <Definition label={t.runs.parentRun} value={current.parentRunId} />
            <Definition label="Hermes session" value={detail?.sessionId} />
            <Definition label="Completion" value={detail?.completionId} />
          </dl>
        </Section>

        {detail?.steps.length ? (
          <Section title={t.runs.steps}>
            <ol className="space-y-1">
              {detail.steps.map(step => (
                <li
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-(--ui-control-hover-background)"
                  key={step.id}
                >
                  <Codicon
                    className={cn('mt-0.5', step.state === 'failed' && 'text-destructive')}
                    name={
                      step.state === 'succeeded'
                        ? 'pass-filled'
                        : step.state === 'failed'
                          ? 'error'
                          : step.state === 'suspended'
                            ? 'debug-pause'
                            : 'circle-outline'
                    }
                  />
                  <span className="min-w-0 flex-1 font-mono text-(--ui-text-secondary)">{step.id}</span>
                  <span className="text-[0.65rem] text-(--ui-text-tertiary)">{step.state}</span>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        <Section title={t.runs.evidence}>
          <dl>
            <Definition label={t.runs.score} value={current.evidence.score?.toFixed(2)} />
            <Definition label="Status" value={current.evidence.status} />
            <Definition label="Reason" value={current.evidence.reason} />
            <Definition label={t.runs.trace} value={detail?.traceId} />
          </dl>
          {detail?.artifacts.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.artifacts.map(artifact => (
                <Button
                  disabled={!artifact.content && !artifact.value}
                  key={artifact.id}
                  onClick={() => openEvidence(artifact)}
                  size="xs"
                  variant="outline"
                >
                  <Codicon name="preview" /> {artifact.label}
                </Button>
              ))}
            </div>
          ) : null}
        </Section>

        {detail?.response ? (
          <Section title={t.runs.output}>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-(--ui-bg-secondary) p-3 font-mono text-[0.7rem] leading-5 text-(--ui-text-secondary)">
              {detail.response}
            </pre>
          </Section>
        ) : null}

        {detail?.usage ? (
          <Section title={t.runs.usage}>
            <dl>
              <Definition label="Prompt" value={detail.usage.promptTokens.toLocaleString()} />
              <Definition label="Completion" value={detail.usage.completionTokens.toLocaleString()} />
              <Definition label="Total" value={detail.usage.totalTokens.toLocaleString()} />
            </dl>
          </Section>
        ) : null}

        {detail?.error ? (
          <Section title={t.runs.error}>
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {detail.error.code ? <div className="mb-1 font-mono">{detail.error.code}</div> : null}
              {detail.error.message}
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  )
}

function CompactRuns({ selectedRunId }: { selectedRunId?: string | null }) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const runs = useStore($activeMastraRuns)
  const status = useStore($mastraStatus)

  const selectRun = (runId: string) =>
    navigateToWorkspacePage(navigate, `${RUNS_ROUTE}?run=${encodeURIComponent(runId)}`)

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--ui-bg-primary)">
      <header className="border-b border-(--ui-stroke-tertiary) px-4 py-3">
        <div className="flex items-center gap-2">
          <Codicon name="pulse" />
          <h1 className="text-sm font-semibold">{t.runs.title}</h1>
          <span className="ml-auto rounded-full bg-(--ui-control-active-background) px-2 py-0.5 text-[0.65rem] tabular-nums">
            {runs.length}
          </span>
        </div>
        <p className="mt-1 text-[0.68rem] text-(--ui-text-tertiary)">{t.runs.compactSubtitle}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!status.available ? (
          <div className="rounded-md border border-(--ui-stroke-tertiary) p-3 text-xs text-(--ui-text-tertiary)">
            {status.reason || t.runs.unavailable}
          </div>
        ) : runs.length === 0 ? (
          <div className="grid h-full place-items-center px-5 text-center text-xs text-(--ui-text-tertiary)">
            {t.runs.noActiveRuns}
          </div>
        ) : (
          <div className="space-y-1">
            {runs.map(run => (
              <RunRow
                compact
                key={run.runId}
                onSelect={() => selectRun(run.runId)}
                run={run}
                selected={selectedRunId === run.runId}
                stateLabel={t.runs.states[run.state] || run.state}
              />
            ))}
          </div>
        )}
      </div>
      <footer className="border-t border-(--ui-stroke-tertiary) p-2">
        <Button
          className="w-full"
          onClick={() => navigateToWorkspacePage(navigate, RUNS_ROUTE)}
          size="sm"
          variant="outline"
        >
          {t.runs.history}
        </Button>
      </footer>
    </div>
  )
}

function FullRuns() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const runs = useStore($mastraRuns)
  const details = useStore($mastraRunDetails)
  const status = useStore($mastraStatus)
  const mastraChatEnabled = useStore($mastraChatEnabled)
  const loading = useStore($mastraRunsLoading)
  const storeError = useStore($mastraRunsError)
  const cwd = useStore($currentCwd)
  const activeProfile = useStore($activeGatewayProfile)
  const [stateFilter, setStateFilter] = useState<MastraRunState | 'all'>('all')
  const [workspaceFilter, setWorkspaceFilter] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [workspaceId, setWorkspaceId] = useState(cwd)
  const [profile, setProfile] = useState(activeProfile)
  const [taskId, setTaskId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const selectedId = searchParams.get('run')

  const filteredRuns = useMemo(
    () =>
      runs.filter(
        run =>
          (stateFilter === 'all' || run.state === stateFilter) &&
          (!workspaceFilter || run.workspaceId === workspaceFilter)
      ),
    [runs, stateFilter, workspaceFilter]
  )

  const selected = runs.find(run => run.runId === selectedId) ?? filteredRuns[0]
  const workspaces = [...new Set(runs.map(run => run.workspaceId))]

  useEffect(() => {
    if (selected && !details[selected.runId]) {void loadMastraRun(selected.runId).catch(() => undefined)}
  }, [details, selected])

  const chooseRun = (runId: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('run', runId)
    setSearchParams(next)
  }

  const submit = async () => {
    if (!workspaceId.trim() || !instructions.trim()) {return}
    setSubmitting(true)
    setActionError(null)

    try {
      const run = await startMastraRun({
        instructions: instructions.trim(),
        profile: profile.trim() || 'default',
        taskId: taskId.trim() || crypto.randomUUID(),
        workspaceId: workspaceId.trim()
      })

      setInstructions('')
      setTaskId('')
      setShowNew(false)
      chooseRun(run.runId)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not start run.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--ui-bg-primary)">
      <header className="shrink-0 border-b border-(--ui-stroke-tertiary) px-5 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Codicon name="pulse" size="1.05rem" />
              <h1 className="text-base font-semibold text-(--ui-text-primary)">{t.runs.title}</h1>
              <span className={cn('size-2 rounded-full', status.available ? 'bg-primary' : 'bg-destructive')} />
            </div>
            <p className="mt-1 text-xs text-(--ui-text-tertiary)">{t.runs.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <label className="flex items-center gap-2 rounded-md border border-(--ui-stroke-secondary) px-2 text-[0.68rem] text-(--ui-text-secondary)">
              <Switch
                aria-label="Use Mastra for Bot conversations"
                checked={mastraChatEnabled}
                disabled={!status.available && !mastraChatEnabled}
                onCheckedChange={setMastraChatEnabled}
                size="xs"
              />
              {mastraChatEnabled ? 'Mastra conversations' : 'Direct Hermes compatibility'}
            </label>
            <Button onClick={() => openRouteTile(`${RUNS_ROUTE}?mode=rail`, 'right')} size="sm" variant="outline">
              <Codicon name="layout-sidebar-right" /> {t.runs.openInSplit}
            </Button>
            <Button
              aria-label={t.runs.refresh}
              disabled={loading}
              onClick={() => void refreshMastraRuns()}
              size="icon-xs"
              variant="outline"
            >
              <Codicon name="refresh" spinning={loading} />
            </Button>
            <Button disabled={!status.available} onClick={() => setShowNew(value => !value)} size="sm">
              <Codicon name="add" /> {t.runs.newRun}
            </Button>
          </div>
        </div>

        {!status.available ? (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {status.reason || t.runs.unavailable}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.65rem] text-(--ui-text-tertiary)">
          <span>{t.runs.capabilities}:</span>
          {Object.entries(status.capabilities).map(([name, enabled]) => (
            <span
              className={cn(
                'rounded px-1.5 py-0.5',
                enabled ? 'bg-primary/8 text-(--ui-text-secondary)' : 'bg-(--ui-bg-secondary) opacity-50'
              )}
              key={name}
            >
              {name}
            </span>
          ))}
        </div>

        {showNew ? (
          <div className="mt-4 grid gap-3 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 lg:grid-cols-2">
            <label className="space-y-1 text-[0.68rem] text-(--ui-text-tertiary)">
              <span>{t.runs.workspace}</span>
              <Input onChange={event => setWorkspaceId(event.target.value)} value={workspaceId} />
            </label>
            <label className="space-y-1 text-[0.68rem] text-(--ui-text-tertiary)">
              <span>{t.runs.profile}</span>
              <Input onChange={event => setProfile(event.target.value)} value={profile} />
            </label>
            <label className="space-y-1 text-[0.68rem] text-(--ui-text-tertiary)">
              <span>{t.runs.taskId}</span>
              <Input onChange={event => setTaskId(event.target.value)} placeholder="Automatic UUID" value={taskId} />
            </label>
            <label className="space-y-1 text-[0.68rem] text-(--ui-text-tertiary) lg:col-span-2">
              <span>{t.runs.instructions}</span>
              <Textarea onChange={event => setInstructions(event.target.value)} value={instructions} />
            </label>
            <div className="flex items-center gap-2 lg:col-span-2">
              <Button
                disabled={submitting || !workspaceId.trim() || !instructions.trim()}
                onClick={() => void submit()}
                size="sm"
              >
                {submitting ? t.runs.starting : t.runs.start}
              </Button>
              <Button onClick={() => setShowNew(false)} size="sm" variant="text">
                {t.common.cancel}
              </Button>
            </div>
          </div>
        ) : null}
        {actionError ? <div className="mt-2 text-xs text-destructive">{actionError}</div> : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,0.72fr)_minmax(22rem,1.28fr)]">
        <aside className="flex min-h-0 flex-col border-r border-(--ui-stroke-tertiary)">
          <div className="flex shrink-0 gap-2 border-b border-(--ui-stroke-tertiary) p-3">
            <Select onValueChange={value => setStateFilter(value as MastraRunState | 'all')} value={stateFilter}>
              <SelectTrigger className="min-w-36" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.runs.allStates}</SelectItem>
                {RUN_STATES.map(state => (
                  <SelectItem key={state} value={state}>
                    {t.runs.states[state] || state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={value => setWorkspaceFilter(value === 'all' ? '' : value)}
              value={workspaceFilter || 'all'}
            >
              <SelectTrigger className="min-w-0 flex-1" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t.runs.workspace}: {t.runs.allStates}
                </SelectItem>
                {workspaces.map(workspace => (
                  <SelectItem key={workspace} value={workspace}>
                    {workspace}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {storeError && status.available ? <div className="p-3 text-xs text-destructive">{storeError}</div> : null}
            {filteredRuns.length === 0 ? (
              <div className="grid h-full place-items-center px-5 text-center text-xs text-(--ui-text-tertiary)">
                {t.runs.noRuns}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredRuns.map(run => (
                  <RunRow
                    key={run.runId}
                    onSelect={() => chooseRun(run.runId)}
                    run={run}
                    selected={selected?.runId === run.runId}
                    stateLabel={t.runs.states[run.state] || run.state}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>
        <main className="min-h-0">
          {selected ? (
            <DetailPanel detail={details[selected.runId]} run={selected} />
          ) : (
            <div className="grid h-full place-items-center px-8 text-center text-xs text-(--ui-text-tertiary)">
              {t.runs.selectRun}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export function RunsView({ compact = false, selectedRunId }: { compact?: boolean; selectedRunId?: string | null }) {
  return compact ? <CompactRuns selectedRunId={selectedRunId} /> : <FullRuns />
}
