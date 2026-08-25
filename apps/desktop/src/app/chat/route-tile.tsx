/**
 * ROUTE (PAGE) TILES — a full-page view rendered as a layout-tree pane BESIDE
 * the main thread, the page analog of session tiles. Built-in pages
 * (Capabilities / Messaging / Artifacts) render their view; plugin pages render
 * their `ROUTES_AREA` contribution. Lifecycle mirrors session tiles:
 * `openRouteTile(path)` -> `watchRouteTiles` registers a pane docked beside
 * main -> tree adoption lands it on the chosen edge; closing removes it.
 */

import { lazy, type ReactNode, Suspense } from 'react'

import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { useContributions } from '@/contrib/react/use-contributions'
import { $routeTiles, closeRouteTile, type RouteTile } from '@/store/route-tiles'

import {
  ARTIFACTS_ROUTE,
  contributedRoutes,
  MESSAGING_ROUTE,
  routePathname,
  ROUTES_AREA,
  RUNS_ROUTE,
  SKILLS_ROUTE
} from '../routes'

import { paneMirror } from './pane-mirror'

const SkillsView = lazy(async () => ({ default: (await import('../skills')).SkillsView }))
const MessagingView = lazy(async () => ({ default: (await import('../messaging')).MessagingView }))
const ArtifactsView = lazy(async () => ({ default: (await import('../artifacts')).ArtifactsView }))
const RunsView = lazy(async () => ({ default: (await import('../runs')).RunsView }))

// Built-in page views + their pane titles, keyed by route.
const BUILTIN_PAGES: Record<string, { render: () => ReactNode; title: string }> = {
  [ARTIFACTS_ROUTE]: { render: () => <ArtifactsView />, title: 'Artifacts' },
  [MESSAGING_ROUTE]: { render: () => <MessagingView />, title: 'Messaging' },
  [SKILLS_ROUTE]: { render: () => <SkillsView />, title: 'Capabilities' },
  [RUNS_ROUTE]: { render: () => <RunsView compact />, title: 'Runs' }
}

/** Humanize a route path into a tab title: `/my-atlas` → `My Atlas`. */
const humanizePath = (path: string): string =>
  path
    .replace(/^\/+/, '')
    .split(/[/-]/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || path

/** Title for a route tile: the built-in name, the contribution's own `title`,
 *  else a humanized path — never the internal `${source}:${id}` key. */
function routeTitle(path: string): string {
  const pathname = routePathname(path)

  if (BUILTIN_PAGES[pathname]) {
    return BUILTIN_PAGES[pathname].title
  }

  return contributedRoutes().find(r => r.path === pathname)?.title ?? humanizePath(pathname)
}

function RouteTilePane({ path }: { path: string }) {
  const pathname = routePathname(path)
  const builtin = BUILTIN_PAGES[pathname]
  const runId = pathname === RUNS_ROUTE ? new URLSearchParams(path.split('?')[1] || '').get('run') : null

  // Subscribe so a plugin page tile appears the moment its route registers.
  useContributions(ROUTES_AREA)
  const contrib = builtin ? null : contributedRoutes().find(r => r.path === pathname)

  if (builtin) {
    return (
      <ContribBoundary id={path}>
        <Suspense fallback={null}>
          <ContribRender render={pathname === RUNS_ROUTE ? () => <RunsView compact selectedRunId={runId} /> : builtin.render} />
        </Suspense>
      </ContribBoundary>
    )
  }

  if (contrib) {
    return (
      <ContribBoundary id={path}>
        <ContribRender render={contrib.render} />
      </ContribBoundary>
    )
  }

  return (
    <div className="grid h-full place-items-center font-mono text-[11px] text-(--ui-text-quaternary)">
      no page at {path}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Route tile -> pane contribution sync (call once from the app root).
// ---------------------------------------------------------------------------

/** Keep pane contributions mirroring `$routeTiles`. Call once from the root. */
export const watchRouteTiles = paneMirror<RouteTile>({
  source: $routeTiles,
  key: t => t.path,
  prefix: 'route-tile',
  dir: t => t.dir,
  minWidth: '22rem',
  title: routeTitle,
  render: path => <RouteTilePane path={path} />,
  close: closeRouteTile
})
