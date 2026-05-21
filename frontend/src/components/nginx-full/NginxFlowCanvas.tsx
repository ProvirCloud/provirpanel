import {
  ArrowRightLeft,
  CornerDownRight,
  Expand,
  FolderKanban,
  Globe,
  HardDrive,
  Lock,
  Minus,
  Plus,
  Radio,
  RefreshCcw,
  Server,
  Shield,
  Waypoints,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import NginxFlowNode from './NginxFlowNode'
import type { NginxVisualState, RouteConfig, SelectedNode, UpstreamConfig } from './nginxVisualConfig'
import { findUpstreamById } from './nginxVisualConfig'

type Props = {
  state: NginxVisualState
  selected: SelectedNode
  onSelect: (s: SelectedNode) => void
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const COL_W = 180
const COL_GAP = 20

// ─── Wire colours ─────────────────────────────────────────────────────────────

const WIRE     = 'rgba(78,120,210,0.58)'
const WIRE_DIM = 'rgba(52,88,164,0.15)'
const WIRE_SIB = 'rgba(78,120,210,0.28)' // sibling (same-group) connector

// ─── Route metadata ───────────────────────────────────────────────────────────

const ROUTE_ICONS: Record<RouteConfig['type'], React.ElementType> = {
  proxy:          ArrowRightLeft,
  websocket:      Radio,
  redirect:       CornerDownRight,
  'static-app':   FolderKanban,
  'static-assets': HardDrive,
  'static-site':  FolderKanban,
}

const ROUTE_TONES: Record<RouteConfig['type'], 'proxy' | 'websocket' | 'static' | 'redirect'> = {
  proxy:          'proxy',
  websocket:      'websocket',
  redirect:       'redirect',
  'static-app':   'static',
  'static-assets':'static',
  'static-site':  'static',
}

const ROUTE_LABELS: Record<RouteConfig['type'], string> = {
  proxy:          'Proxy Pass',
  websocket:      'WebSocket',
  redirect:       'Redirect',
  'static-app':   'App estático',
  'static-assets':'Assets',
  'static-site':  'Site estático',
}

// ─── Grouping logic ───────────────────────────────────────────────────────────

type RouteGroup = {
  key: string
  routes: RouteConfig[]
  upstreamId?: string   // set for proxy groups
  aliasBase?: string    // set for static groups
}

/** /var/www/panel/assets/ → /var/www/panel  (first 3 dir components) */
const getAliasBase = (alias: string): string => {
  const parts = alias.replace(/\/$/, '').split('/').filter(Boolean)
  return parts.length >= 3 ? '/' + parts.slice(0, 3).join('/') : alias.replace(/\/$/, '')
}

const isProxy = (r: RouteConfig) => r.type === 'proxy' || r.type === 'websocket'

function groupRoutes(routes: RouteConfig[]): RouteGroup[] {
  const groups: RouteGroup[] = []
  const done = new Set<string>()

  for (const route of routes) {
    if (done.has(route.id)) continue

    if (isProxy(route) && route.upstreamId) {
      // Group: all proxy/ws routes sharing the same upstream
      const peers = routes.filter(
        r => !done.has(r.id) && isProxy(r) && r.upstreamId === route.upstreamId,
      )
      peers.forEach(r => done.add(r.id))
      groups.push({ key: route.upstreamId, routes: peers, upstreamId: route.upstreamId })

    } else if (!isProxy(route) && route.alias) {
      // Group: static routes sharing the same alias base directory
      const base = getAliasBase(route.alias)
      const peers = routes.filter(
        r => !done.has(r.id) && !isProxy(r) && r.alias && getAliasBase(r.alias) === base,
      )
      peers.forEach(r => done.add(r.id))
      groups.push({ key: base || route.id, routes: peers, aliasBase: base })

    } else {
      done.add(route.id)
      groups.push({ key: route.id, routes: [route] })
    }
  }

  return groups
}

// ─── Small visual components ──────────────────────────────────────────────────

/** Main flow connector: gradient line + arrowhead */
const Connector = ({ h = 14 }: { h?: number }) => (
  <div className="mx-auto flex flex-col items-center" style={{ width: 10 }}>
    <div
      style={{
        width: 1.5,
        height: Math.max(h - 5, 2),
        borderRadius: 2,
        background: `linear-gradient(180deg, ${WIRE_DIM} 0%, ${WIRE} 100%)`,
      }}
    />
    <svg width="7" height="4" viewBox="0 0 7 4" style={{ display: 'block', flexShrink: 0 }}>
      <polygon points="3.5,4 0,0 7,0" fill={WIRE} />
    </svg>
  </div>
)

/** Sibling connector: dashed, no arrowhead — shows "same group" without implying hierarchy */
const SiblingConnector = () => (
  <div className="mx-auto" style={{ width: 10, padding: '3px 0', display: 'flex', justifyContent: 'center' }}>
    <div
      style={{
        width: 1.5,
        height: 12,
        borderRadius: 2,
        background: `repeating-linear-gradient(
          to bottom,
          ${WIRE_SIB} 0px, ${WIRE_SIB} 3px,
          transparent 3px, transparent 6px
        )`,
      }}
    />
  </div>
)

const ServerChip = ({ host, port, tone = 'blue' }: { host: string; port: number; tone?: 'blue' | 'violet' }) => (
  <div className="flex items-center gap-2 border-t border-white/5 px-2.5 py-2 text-[11px] first:border-t-0">
    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: tone === 'violet' ? '#a78bfa' : '#4ade80' }} />
    <span className="font-mono" style={{ color: tone === 'violet' ? '#d8b4fe' : '#86efac' }}>
      {host}:{port}
    </span>
  </div>
)

const AliasChip = ({ path }: { path: string }) => (
  <div className="truncate border-t border-white/5 px-2.5 py-2 text-[11px] font-mono text-[#fcd4a0] first:border-t-0">
    {path}
  </div>
)

// ─── Group column ─────────────────────────────────────────────────────────────

function GroupColumn({
  group,
  upstream,
  selected,
  onSelect,
}: {
  group: RouteGroup
  upstream: UpstreamConfig | null
  selected: SelectedNode
  onSelect: (s: SelectedNode) => void
}) {
  const allDisabled = group.routes.every(r => r.disabled)
  const firstRoute = group.routes[0]
  const proxyGroup = !!group.upstreamId

  // Target node props
  const isRedirectGroup = firstRoute.type === 'redirect'
  const targetTitle  = proxyGroup
    ? (upstream ? `LB: ${upstream.name}` : 'Sem upstream')
    : isRedirectGroup
      ? (firstRoute.redirectTo || firstRoute.path + '/')
      : (group.aliasBase || firstRoute.alias || '—')
  const targetSub    = proxyGroup ? (upstream?.method || '—') : isRedirectGroup ? `${firstRoute.redirectCode || 301} redirect` : 'alias'
  const targetTone   = proxyGroup ? (firstRoute.type === 'websocket' ? 'websocket' as const : 'upstream' as const) : isRedirectGroup ? 'redirect' as const : 'target' as const
  const TargetIcon   = proxyGroup ? (firstRoute.type === 'websocket' ? Waypoints : Server) : isRedirectGroup ? CornerDownRight : HardDrive
  const targetSelected = proxyGroup && upstream
    ? selected.kind === 'upstream' && selected.id === upstream.id
    : group.routes.some(r => selected.kind === 'static-target' && selected.id === `target-${r.id}`)

  return (
    <div style={{ width: COL_W, flexShrink: 0 }} className={allDisabled ? 'opacity-40' : ''}>
      {/* Drop from branch */}
      <Connector h={14} />

      {/* Route nodes — stacked, individually clickable */}
      {group.routes.map((route, i) => (
        <div key={route.id} className={route.disabled && !allDisabled ? 'opacity-40' : ''}>
          {i > 0 && <SiblingConnector />}
          <NginxFlowNode
            title={route.modifier ? `${route.modifier} ${route.path}` : route.path}
            subtitle={ROUTE_LABELS[route.type]}
            tone={ROUTE_TONES[route.type]}
            icon={ROUTE_ICONS[route.type]}
            selected={selected.kind === 'route' && selected.id === route.id}
            onClick={() => onSelect({ kind: 'route', id: route.id })}
          />
        </div>
      ))}

      {/* Connector to shared target */}
      <Connector />

      {/* Shared target node */}
      <NginxFlowNode
        title={targetTitle}
        subtitle={targetSub}
        tone={targetTone}
        icon={TargetIcon}
        selected={targetSelected}
        onClick={() =>
          proxyGroup && upstream
            ? onSelect({ kind: 'upstream', id: upstream.id })
            : onSelect({ kind: 'static-target', id: `target-${firstRoute.id}` })
        }
      >
        {proxyGroup && upstream ? (
          <div className="mt-2 overflow-hidden rounded-[8px] border border-white/8 bg-black/20">
            {upstream.servers.slice(0, 3).map(s => (
              <ServerChip key={s.id} host={s.host} port={s.port} tone={firstRoute.type === 'websocket' ? 'violet' : 'blue'} />
            ))}
            {upstream.servers.length > 3 && (
              <div className="border-t border-white/5 px-2.5 py-1.5 text-[10px] text-white/32">
                +{upstream.servers.length - 3} servidores
              </div>
            )}
          </div>
        ) : firstRoute.alias ? (
          <div className="mt-2 overflow-hidden rounded-[8px] border border-white/8 bg-black/20">
            {group.routes
              .map(r => r.alias)
              .filter((a): a is string => Boolean(a))
              .slice(0, 4)
              .map(a => <AliasChip key={a} path={a} />)
            }
            {group.routes.length > 4 && (
              <div className="border-t border-white/5 px-2.5 py-1.5 text-[10px] text-white/32">
                +{group.routes.length - 4} mais
              </div>
            )}
          </div>
        ) : null}
      </NginxFlowNode>
    </div>
  )
}

// ─── Main canvas ──────────────────────────────────────────────────────────────

export default function NginxFlowCanvas({ state, selected, onSelect }: Props) {
  const [zoom, setZoom]       = useState(1)
  const [expanded, setExpanded] = useState(false)
  const [locked, setLocked]   = useState(false)

  const sel = (s: SelectedNode) => { if (!locked) onSelect(s) }

  useEffect(() => {
    if (!expanded) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [expanded])

  const groups  = groupRoutes(state.routes)
  const nGroups = groups.length
  const totalW  = nGroups * COL_W + Math.max(0, nGroups - 1) * COL_GAP

  const leftPct  = nGroups > 1 ? ((COL_W / 2) / totalW) * 100 : 50
  const rightPct = leftPct

  const toolbar = [
    { key: 'zoom-in',  icon: Plus,              active: false,    title: 'Aumentar zoom',        onClick: () => setZoom(z => Math.min(1.35, +(z + 0.1).toFixed(2))) },
    { key: 'zoom-out', icon: Minus,             active: false,    title: 'Reduzir zoom',         onClick: () => setZoom(z => Math.max(0.6,  +(z - 0.1).toFixed(2))) },
    { key: 'expand',   icon: expanded ? X : Expand, active: expanded, title: expanded ? 'Fechar' : 'Expandir', onClick: () => setExpanded(e => !e) },
    { key: 'lock',     icon: Shield,            active: locked,   title: locked ? 'Desbloquear' : 'Bloquear seleção', onClick: () => setLocked(l => !l) },
  ]

  return (
    <section
      className={[
        'flex flex-col rounded-[20px] border border-white/8',
        'bg-[linear-gradient(160deg,rgba(8,16,32,0.98),rgba(6,13,26,0.96))]',
        'shadow-[0_24px_80px_rgba(1,5,16,0.5)]',
        expanded ? 'fixed inset-3 z-50 overflow-hidden' : 'overflow-hidden',
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/6 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
            Mapa de tráfego
          </span>
          <span className="text-[11px] text-white/28">
            {Math.round(zoom * 100)}%{locked ? ' · bloqueado' : ''}
          </span>
        </div>
        <div className="flex items-center divide-x divide-white/6 overflow-hidden rounded-[12px] border border-white/8 bg-[rgba(12,22,42,0.8)]">
          {toolbar.map(({ key, icon: Icon, active, title, onClick }) => (
            <button
              key={key}
              type="button"
              title={title}
              onClick={onClick}
              className={[
                'flex h-9 w-9 items-center justify-center transition',
                active ? 'bg-[#1a3060] text-[#7ab0ff]' : 'text-white/45 hover:bg-white/4 hover:text-white/80',
              ].join(' ')}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className={['flex-1 overflow-auto', expanded ? 'p-8' : 'px-5 py-6'].join(' ')}>
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
            minWidth: Math.max(totalW + 40, 460),
          }}
        >
          {/* Spine: Domain → HTTP → HTTPS */}
          <div className="mx-auto" style={{ width: 200 }}>
            <NginxFlowNode
              title={state.domain.primary}
              subtitle={state.domain.additional[0]}
              tone="domain" icon={Globe}
              selected={selected.kind === 'domain'}
              onClick={() => sel({ kind: 'domain', id: 'domain' })}
            />
            <Connector />
            <NginxFlowNode
              title={`HTTP :${state.http.port}`}
              subtitle={state.http.redirectToHttps ? '→ HTTPS' : 'Sem redirect'}
              tone="http" icon={RefreshCcw}
              selected={selected.kind === 'http'}
              onClick={() => sel({ kind: 'http', id: 'http' })}
            />
            <Connector />
            <NginxFlowNode
              title={`HTTPS :${state.https.port}`}
              subtitle={[state.https.sslEnabled && 'SSL', state.https.http2Enabled && 'HTTP/2'].filter(Boolean).join(' · ') || 'Sem SSL'}
              tone="https" icon={Lock}
              selected={selected.kind === 'https'}
              onClick={() => sel({ kind: 'https', id: 'https' })}
            />
          </div>

          {/* Branch HTTPS → groups */}
          {nGroups > 0 && (
            <div className="relative mx-auto" style={{ height: 28, width: totalW }}>
              <div
                className="absolute"
                style={{
                  left: '50%', transform: 'translateX(-0.75px)', top: 0,
                  width: 1.5, height: 14, borderRadius: 2,
                  background: `linear-gradient(180deg, ${WIRE_DIM} 0%, ${WIRE} 100%)`,
                }}
              />
              {nGroups > 1 && (
                <div
                  className="absolute"
                  style={{
                    top: 13.25, left: `${leftPct}%`, right: `${rightPct}%`,
                    height: 1.5, borderRadius: 1,
                    background: `linear-gradient(90deg, ${WIRE_DIM} 0%, ${WIRE} 18%, ${WIRE} 82%, ${WIRE_DIM} 100%)`,
                  }}
                />
              )}
            </div>
          )}

          {/* Group columns */}
          {nGroups > 0 ? (
            <div className="mx-auto flex" style={{ width: totalW, gap: COL_GAP }}>
              {groups.map(group => (
                <GroupColumn
                  key={group.key}
                  group={group}
                  upstream={group.upstreamId ? findUpstreamById(state, group.upstreamId) : null}
                  selected={selected}
                  onSelect={sel}
                />
              ))}
            </div>
          ) : (
            <div className="mx-auto mt-8 max-w-[280px] rounded-[14px] border border-dashed border-white/10 py-10 text-center text-[13px] text-white/28">
              Nenhuma rota configurada
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
