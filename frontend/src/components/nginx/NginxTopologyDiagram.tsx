import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Database,
  Edit2,
  Globe,
  GitBranch,
  HardDrive,
  Lock,
  Plus,
  Power,
  PowerOff,
  Server,
  Trash2,
} from 'lucide-react'
import type { NginxLocation, NginxSite } from '../../types/nginx'
import { useTheme } from '../../app/providers/theme-provider'

// ─── Tier definitions ─────────────────────────────────────────────────────────

const NGINX_TIERS = [
  { key: 'internet',  label: 'Internet',       hint: 'Origem do tráfego',                     color: '#06b6d4' },
  { key: 'listener',  label: 'Listeners',      hint: 'Portas abertas no Nginx',               color: '#3b82f6' },
  { key: 'vhost',     label: 'Virtual Hosts',  hint: 'Domínios e server blocks',              color: '#8b5cf6' },
  { key: 'location',  label: 'Rotas',          hint: 'Location rules e paths',                color: '#f59e0b' },
  { key: 'backend',   label: 'Backends',       hint: 'Destinos finais — proxy, upstream, fs', color: '#10b981' },
] as const

type TierKey = (typeof NGINX_TIERS)[number]['key']

// ─── Graph types ──────────────────────────────────────────────────────────────

type NginxNode = {
  id: string
  tier: TierKey
  label: string
  sublabel?: string
  site?: NginxSite
  location?: NginxLocation
  disabled?: boolean
  ssl?: boolean
  backendType?: 'proxy' | 'static' | 'upstream'
}

type NginxEdge = { id: string; fromId: string; toId: string }

type EdgePath = { id: string; path: string; fromTier: TierKey }

// ─── Graph builder ────────────────────────────────────────────────────────────

function buildGraph(sites: NginxSite[]): { nodes: NginxNode[]; edges: NginxEdge[] } {
  const nodes: NginxNode[] = []
  const edges: NginxEdge[] = []
  const addedIds = new Set<string>()

  const addNode = (n: NginxNode) => {
    if (!addedIds.has(n.id)) {
      addedIds.add(n.id)
      nodes.push(n)
    }
  }

  const addEdge = (from: string, to: string) => {
    const id = `${from}->${to}`
    if (!edges.find((e) => e.id === id)) edges.push({ id, fromId: from, toId: to })
  }

  // ── Internet ──────────────────────────────────────────────────────────────
  addNode({ id: '__internet__', tier: 'internet', label: 'Internet', sublabel: 'tráfego externo' })

  // ── Listeners — collected from all sites ──────────────────────────────────
  const listenerPorts = new Set<string>()
  if (sites.length === 0) {
    listenerPorts.add('80')
    listenerPorts.add('443')
  }
  sites.forEach((site) => {
    listenerPorts.add(site.listenPort || '80')
    if (site.sslEnabled) listenerPorts.add('443')
  })

  const sortedPorts = [...listenerPorts].sort((a, b) => Number(a) - Number(b))
  sortedPorts.forEach((port) => {
    const id = `__listener__:${port}`
    const ssl = port === '443' || port === '8443'
    addNode({ id, tier: 'listener', label: `:${port}`, sublabel: ssl ? 'HTTPS/SSL' : 'HTTP', ssl })
    addEdge('__internet__', id)
  })

  // ── VHosts, Locations, Backends ───────────────────────────────────────────
  sites.forEach((site) => {
    const vhostId = `vhost:${site.name}`
    const domain = site.serverNames[0] || site.displayName
    const typeLabel =
      site.type === 'load-balancer' ? 'LB' : site.type === 'static' ? 'static' : 'proxy'

    addNode({
      id: vhostId,
      tier: 'vhost',
      label: domain,
      sublabel: typeLabel + (site.serverNames.length > 1 ? ` +${site.serverNames.length - 1}` : ''),
      site,
      disabled: !site.enabled,
      ssl: site.sslEnabled,
    })

    // Listener → VHost
    addEdge(`__listener__:${site.listenPort || '80'}`, vhostId)
    if (site.sslEnabled) addEdge('__listener__:443', vhostId)

    // Locations
    const locs = site.locations.filter(
      (l) => l.proxyHost || l.root || l.tryFiles || l.returnDirective,
    )

    if (locs.length > 0) {
      locs.forEach((loc) => {
        const locId = `loc:${site.name}:${loc.path}`
        addNode({
          id: locId,
          tier: 'location',
          label: loc.path,
          sublabel: loc.proxyHost
            ? `${loc.proxyHost}:${loc.proxyPort || '80'}`
            : loc.root
              ? 'static'
              : undefined,
          location: loc,
        })
        addEdge(vhostId, locId)

        if (loc.proxyHost) {
          const bId = `backend:${loc.proxyHost}:${loc.proxyPort || '80'}`
          addNode({
            id: bId,
            tier: 'backend',
            label: loc.proxyHost,
            sublabel: `:${loc.proxyPort || '80'}`,
            backendType: 'proxy',
          })
          addEdge(locId, bId)
        } else if (loc.root) {
          const bId = `static:${loc.root}`
          addNode({ id: bId, tier: 'backend', label: loc.root, sublabel: 'arquivos', backendType: 'static' })
          addEdge(locId, bId)
        }
      })
    } else if (site.type === 'load-balancer') {
      // LB with upstream targets connected directly from vhost
      site.targets.forEach((target) => {
        const bId = `backend:${target.host}:${target.port}`
        addNode({
          id: bId,
          tier: 'backend',
          label: target.host,
          sublabel: `:${target.port}${target.backup ? ' backup' : target.weight !== '1' ? ` ×${target.weight}` : ''}`,
          backendType: 'upstream',
        })
        addEdge(vhostId, bId)
      })
    } else if (site.rootPath) {
      const bId = `static:${site.rootPath}`
      addNode({ id: bId, tier: 'backend', label: site.rootPath, sublabel: 'arquivos', backendType: 'static' })
      addEdge(vhostId, bId)
    }
  })

  return { nodes, edges }
}

// ─── Action button (inside node card) ────────────────────────────────────────

const ActionBtn = ({
  icon,
  label,
  color,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  color: string
  onClick: () => void
  disabled?: boolean
}) => (
  <button
    disabled={disabled}
    onClick={onClick}
    title={label}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 9px',
      borderRadius: 8,
      border: `1px solid ${color}35`,
      background: `${color}14`,
      color: disabled ? 'var(--color-text-muted)' : color,
      fontSize: 10,
      fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'background 0.15s, color 0.15s',
      whiteSpace: 'nowrap',
    }}
  >
    {icon}
    {label}
  </button>
)

// ─── NodeCard ─────────────────────────────────────────────────────────────────

type NodeCardProps = {
  node: NginxNode
  tierColor: string
  isLight: boolean
  hovered: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onEdit?: () => void
  onToggle?: () => void
  onDelete?: () => void
  busy: boolean
  nodeRef: (el: HTMLDivElement | null) => void
}

const NodeCard = ({
  node,
  tierColor,
  isLight,
  hovered,
  onMouseEnter,
  onMouseLeave,
  onEdit,
  onToggle,
  onDelete,
  busy,
  nodeRef,
}: NodeCardProps) => {
  const isVHost = node.tier === 'vhost'
  const isDecorative = node.tier === 'internet' || node.tier === 'listener'

  const Icon =
    node.tier === 'internet'
      ? Globe
      : node.tier === 'listener'
        ? Server
        : node.tier === 'vhost'
          ? node.ssl
            ? Lock
            : Globe
          : node.tier === 'location'
            ? GitBranch
            : node.backendType === 'static'
              ? HardDrive
              : Database

  const showActions = isVHost && hovered && (onEdit || onToggle || onDelete)

  return (
    <div
      ref={nodeRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={isVHost && onEdit ? onEdit : undefined}
      style={{
        position: 'relative',
        minWidth: 152,
        maxWidth: 226,
        padding: '10px 14px',
        borderRadius: 14,
        border: `1px solid ${
          hovered
            ? tierColor
            : node.disabled
              ? isLight
                ? 'rgba(0,0,0,0.08)'
                : 'rgba(255,255,255,0.06)'
              : isLight
                ? 'var(--color-border)'
                : 'rgba(255,255,255,0.1)'
        }`,
        background: isDecorative
          ? isLight
            ? `${tierColor}10`
            : `${tierColor}0d`
          : node.disabled
            ? isLight
              ? 'rgba(0,0,0,0.02)'
              : 'rgba(255,255,255,0.02)'
            : isLight
              ? 'var(--color-surface)'
              : 'rgba(255,255,255,0.04)',
        cursor: isVHost && onEdit ? 'pointer' : 'default',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow:
          hovered && isVHost
            ? `0 0 0 3px ${tierColor}22, 0 4px 16px ${tierColor}18`
            : 'none',
        opacity: node.disabled ? 0.62 : 1,
      }}
    >
      {/* Status dot — VHost only */}
      {isVHost && node.site && (
        <span
          style={{
            position: 'absolute',
            top: 10,
            right: 11,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: node.site.enabled ? '#4ade80' : '#64748b',
            boxShadow: node.site.enabled ? '0 0 6px rgba(74,222,128,0.7)' : 'none',
          }}
        />
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon
          size={13}
          style={{
            color: tierColor,
            flexShrink: 0,
            opacity: node.disabled ? 0.5 : 1,
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: node.disabled ? 'var(--color-text-muted)' : 'var(--color-text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 164,
          }}
        >
          {node.label}
        </span>
      </div>

      {/* Sublabel */}
      {node.sublabel && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--color-text-muted)',
            marginTop: 3,
            marginLeft: 20,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {node.sublabel}
        </div>
      )}

      {/* VHost action bar — revealed on hover */}
      {showActions && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
            marginTop: 10,
            paddingTop: 8,
            borderTop: isLight
              ? '1px solid var(--color-border-subtle)'
              : '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {onEdit && (
            <ActionBtn icon={<Edit2 size={10} />} label="Editar" color={tierColor} onClick={onEdit} />
          )}
          {onToggle && (
            <ActionBtn
              icon={node.site?.enabled ? <PowerOff size={10} /> : <Power size={10} />}
              label={node.site?.enabled ? 'Desativar' : 'Ativar'}
              color={node.site?.enabled ? '#f59e0b' : '#10b981'}
              onClick={onToggle}
              disabled={busy}
            />
          )}
          {onDelete && (
            <ActionBtn
              icon={<Trash2 size={10} />}
              label="Remover"
              color="#f87171"
              onClick={onDelete}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export type NginxTopologyDiagramProps = {
  sites: NginxSite[]
  nginxRunning: boolean
  onEditSite: (site: NginxSite) => void
  onToggleSite: (site: NginxSite) => void
  onDeleteSite: (site: NginxSite) => void
  onCreateSite: () => void
  busyToggle: string | null
}

const NginxTopologyDiagram = ({
  sites,
  nginxRunning,
  onEditSite,
  onToggleSite,
  onDeleteSite,
  onCreateSite,
  busyToggle,
}: NginxTopologyDiagramProps) => {
  const { theme } = useTheme()
  const isLight = theme === 'light'

  const { nodes, edges } = useMemo(() => buildGraph(sites), [sites])

  const wrapRef = useRef<HTMLDivElement>(null)
  const nodeEls = useRef<Record<string, HTMLDivElement | null>>({})
  const [edgePaths, setEdgePaths] = useState<EdgePath[]>([])
  const edgePathsKey = useRef('')
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  const tierColorMap = useMemo(() => {
    const m: Record<string, string> = {}
    NGINX_TIERS.forEach((t) => { m[t.key] = t.color })
    return m
  }, [])

  const nodeById = useMemo(() => {
    const m: Record<string, NginxNode> = {}
    nodes.forEach((n) => { m[n.id] = n })
    return m
  }, [nodes])

  const nodesByTier = useMemo(() => {
    const m: Record<string, NginxNode[]> = {}
    NGINX_TIERS.forEach((t) => { m[t.key] = [] })
    nodes.forEach((n) => { m[n.tier]?.push(n) })
    return m
  }, [nodes])

  // Edges connected to hovered node → highlighted
  const highlightedEdgeIds = useMemo(() => {
    if (!hoveredNode) return new Set<string>()
    return new Set(
      edges.filter((e) => e.fromId === hoveredNode || e.toId === hoveredNode).map((e) => e.id),
    )
  }, [hoveredNode, edges])

  // Measure DOM positions after every render to keep SVG paths in sync
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const wR = wrap.getBoundingClientRect()
    const paths: EdgePath[] = []

    for (const edge of edges) {
      const fromEl = nodeEls.current[edge.fromId]
      const toEl = nodeEls.current[edge.toId]
      if (!fromEl || !toEl) continue

      const fR = fromEl.getBoundingClientRect()
      const tR = toEl.getBoundingClientRect()
      const fx = fR.left + fR.width / 2 - wR.left
      const fy = fR.bottom - wR.top
      const tx = tR.left + tR.width / 2 - wR.left
      const ty = tR.top - wR.top
      const cy = fy + (ty - fy) * 0.5

      const fromTier = (nodeById[edge.fromId]?.tier ?? 'internet') as TierKey
      paths.push({
        id: edge.id,
        path: `M ${fx} ${fy} C ${fx} ${cy}, ${tx} ${cy}, ${tx} ${ty}`,
        fromTier,
      })
    }

    const key = paths.map((p) => `${p.id}:${p.path}`).join('|')
    if (key !== edgePathsKey.current) {
      edgePathsKey.current = key
      setEdgePaths(paths)
    }
  }) // intentionally no deps — must run every render

  const activeTiers = NGINX_TIERS.filter((t) => (nodesByTier[t.key]?.length ?? 0) > 0)

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        borderRadius: 20,
        border: isLight ? '1px solid var(--color-border)' : '1px solid rgba(255,255,255,0.07)',
        background: isLight ? 'var(--color-canvas)' : '#04080f',
        overflow: 'hidden',
        minHeight: 380,
      }}
    >
      {/* ── SVG edge overlay ──────────────────────────────────────────────── */}
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      >
        <defs>
          {NGINX_TIERS.map((t) => (
            <marker
              key={t.key}
              id={`arrow-${t.key}`}
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L6,3 z" fill={t.color} opacity="0.6" />
            </marker>
          ))}
        </defs>

        {edgePaths.map((ep) => {
          const dimmed = hoveredNode !== null && !highlightedEdgeIds.has(ep.id)
          const color = tierColorMap[ep.fromTier] ?? '#94a3b8'
          return (
            <path
              key={ep.id}
              d={ep.path}
              fill="none"
              stroke={dimmed ? (isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)') : color}
              strokeWidth={dimmed ? 1 : 1.5}
              strokeDasharray={dimmed ? '4 4' : undefined}
              opacity={dimmed ? 0.25 : 0.65}
              markerEnd={dimmed ? undefined : `url(#arrow-${ep.fromTier})`}
              style={{ transition: 'stroke 0.18s, opacity 0.18s' }}
            />
          )
        })}
      </svg>

      {/* ── Nginx status badge ────────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 20,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 500,
          color: nginxRunning ? '#4ade80' : '#94a3b8',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: nginxRunning ? '#4ade80' : '#94a3b8',
            boxShadow: nginxRunning ? '0 0 8px rgba(74,222,128,0.8)' : 'none',
          }}
        />
        Nginx {nginxRunning ? 'online' : 'offline'}
      </div>

      {/* ── Tier rows ─────────────────────────────────────────────────────── */}
      <div style={{ paddingTop: 12, paddingBottom: 8 }}>
        {activeTiers.map((tier, idx) => {
          const tierNodes = nodesByTier[tier.key] ?? []
          return (
            <div
              key={tier.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 20,
                padding: '18px 24px',
                borderTop:
                  idx > 0
                    ? isLight
                      ? '1px solid var(--color-border-subtle)'
                      : '1px solid rgba(255,255,255,0.04)'
                    : undefined,
                position: 'relative',
                zIndex: 10,
              }}
            >
              {/* Tier label column */}
              <div style={{ width: 148, flexShrink: 0, paddingTop: 6 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: tier.color,
                    marginBottom: 3,
                  }}
                >
                  {tier.label}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--color-text-muted)',
                    lineHeight: 1.35,
                  }}
                >
                  {tier.hint}
                </div>
              </div>

              {/* Nodes row */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  flex: 1,
                  alignItems: 'flex-start',
                }}
              >
                {tierNodes.map((node) => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    tierColor={tier.color}
                    isLight={isLight}
                    hovered={hoveredNode === node.id}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    onEdit={node.site?.editable ? () => onEditSite(node.site!) : undefined}
                    onToggle={node.site?.toggleable ? () => onToggleSite(node.site!) : undefined}
                    onDelete={node.site?.deletable ? () => onDeleteSite(node.site!) : undefined}
                    busy={busyToggle === node.site?.name}
                    nodeRef={(el) => {
                      nodeEls.current[node.id] = el
                    }}
                  />
                ))}

                {/* "Novo site" add button — only in vhost tier */}
                {tier.key === 'vhost' && (
                  <AddSiteButton
                    isLight={isLight}
                    tierColor={tier.color}
                    onClick={onCreateSite}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Empty state when no sites */}
      {sites.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            zIndex: 15,
            pointerEvents: 'none',
          }}
        >
          <Server size={36} style={{ color: 'var(--color-text-muted)', opacity: 0.3 }} />
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            Nenhum site configurado. Crie o primeiro virtual host.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Add Site button ──────────────────────────────────────────────────────────

const AddSiteButton = ({
  isLight,
  tierColor,
  onClick,
}: {
  isLight: boolean
  tierColor: string
  onClick: () => void
}) => {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '10px 16px',
        borderRadius: 14,
        border: `1.5px dashed ${
          hovered ? tierColor : isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.13)'
        }`,
        background: hovered ? `${tierColor}0e` : 'transparent',
        color: hovered ? tierColor : 'var(--color-text-muted)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <Plus size={13} />
      Novo site
    </button>
  )
}

export default NginxTopologyDiagram
