import { Edit2, Code2, Globe, Lock, Play, Power, PowerOff, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { useState, useMemo, useRef, useEffect } from 'react'
import type { NginxSite } from '../../types/nginx'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import { useTheme } from '../../app/providers/theme-provider'

type NginxFilesViewProps = {
  sites: NginxSite[]
  nginxRunning: boolean
  onEditSite: (site: NginxSite) => void
  onToggleSite: (site: NginxSite) => void
  onDeleteSite: (site: NginxSite) => void
  onViewRawConfig: (site: NginxSite) => void
  busyToggle: string | null
}

type SiteFlowNode = {
  label: string
  type: 'source' | 'listener' | 'vhost' | 'location' | 'backend'
  color: string
  sublabel?: string
}

type SiteFlow = {
  nodes: SiteFlowNode[]
  edges: Array<{ from: number; to: number }>
}

const buildSiteFlow = (site: NginxSite): SiteFlow => {
  const nodes: SiteFlowNode[] = []
  const edges: Array<{ from: number; to: number }> = []

  // Source
  nodes.push({ label: 'Internet', type: 'source', color: '#06b6d4' })

  // Listener
  const listenerIdx = nodes.length
  nodes.push({
    label: `:${site.listenPort}`,
    type: 'listener',
    color: '#3b82f6',
    sublabel: site.sslEnabled ? 'HTTPS' : 'HTTP',
  })
  edges.push({ from: 0, to: listenerIdx })

  // VHost
  const vhostIdx = nodes.length
  const domain = site.serverNames[0] || site.displayName
  nodes.push({
    label: domain,
    type: 'vhost',
    color: '#8b5cf6',
    sublabel: site.serverNames.length > 1 ? `+${site.serverNames.length - 1}` : undefined,
  })
  edges.push({ from: listenerIdx, to: vhostIdx })

  // Locations/Backends
  if (site.type === 'load-balancer') {
    site.targets.forEach((target) => {
      const backendIdx = nodes.length
      nodes.push({
        label: target.host,
        type: 'backend',
        color: '#10b981',
        sublabel: `:${target.port}${target.backup ? ' (backup)' : ''}`,
      })
      edges.push({ from: vhostIdx, to: backendIdx })
    })
  } else if (site.locations.length > 0) {
    site.locations.forEach((loc) => {
      const locIdx = nodes.length
      nodes.push({
        label: loc.path,
        type: 'location',
        color: '#f59e0b',
      })
      edges.push({ from: vhostIdx, to: locIdx })

      if (loc.proxyHost) {
        const backendIdx = nodes.length
        nodes.push({
          label: loc.proxyHost,
          type: 'backend',
          color: '#10b981',
          sublabel: `:${loc.proxyPort || '80'}`,
        })
        edges.push({ from: locIdx, to: backendIdx })
      } else if (loc.root) {
        const backendIdx = nodes.length
        nodes.push({
          label: loc.root,
          type: 'backend',
          color: '#10b981',
          sublabel: 'static',
        })
        edges.push({ from: locIdx, to: backendIdx })
      }
    })
  } else if (site.rootPath) {
    const backendIdx = nodes.length
    nodes.push({
      label: site.rootPath,
      type: 'backend',
      color: '#10b981',
      sublabel: 'static',
    })
    edges.push({ from: vhostIdx, to: backendIdx })
  }

  return { nodes, edges }
}

const SiteFlowDiagram = ({ site, isLight }: { site: NginxSite; isLight: boolean }) => {
  const flow = useMemo(() => buildSiteFlow(site), [site])
  const wrapRef = useRef<HTMLDivElement>(null)
  const nodeEls = useRef<Record<number, HTMLDivElement | null>>({})
  const [paths, setPaths] = useState<string[]>([])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const wR = wrap.getBoundingClientRect()
    const newPaths: string[] = []

    for (const edge of flow.edges) {
      const fromEl = nodeEls.current[edge.from]
      const toEl = nodeEls.current[edge.to]
      if (!fromEl || !toEl) continue

      const fR = fromEl.getBoundingClientRect()
      const tR = toEl.getBoundingClientRect()
      const fx = fR.left + fR.width / 2 - wR.left
      const fy = fR.bottom - wR.top
      const tx = tR.left + tR.width / 2 - wR.left
      const ty = tR.top - wR.top
      const cy = fy + (ty - fy) * 0.5

      newPaths.push(`M ${fx} ${fy} C ${fx} ${cy}, ${tx} ${cy}, ${tx} ${ty}`)
    }

    setPaths(newPaths)
  })

  const nodeColors: Record<SiteFlowNode['type'], string> = {
    source: '#06b6d4',
    listener: '#3b82f6',
    vhost: '#8b5cf6',
    location: '#f59e0b',
    backend: '#10b981',
  }

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        borderRadius: 12,
        border: isLight
          ? '1px solid var(--color-border-subtle)'
          : '1px solid rgba(255,255,255,0.05)',
        background: isLight ? 'var(--color-canvas-subtle)' : 'rgba(255,255,255,0.02)',
        overflow: 'hidden',
        minHeight: 140,
      }}
    >
      {/* SVG edges */}
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
        {paths.map((path, i) => (
          <path
            key={i}
            d={path}
            fill="none"
            stroke={isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)'}
            strokeWidth="1.5"
            opacity="0.6"
          />
        ))}
      </svg>

      {/* Nodes in horizontal layout */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          overflow: 'auto',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {flow.nodes.map((node, i) => (
          <div key={i}>
            <div
              ref={(el) => {
                if (el) nodeEls.current[i] = el
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '8px 12px',
                borderRadius: 10,
                border: `1px solid ${node.color}40`,
                background: `${node.color}12`,
                whiteSpace: 'nowrap',
                minWidth: 'max-content',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: node.color,
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                  maxWidth: 120,
                }}
              >
                {node.label}
              </span>
              {node.sublabel && (
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {node.sublabel}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const NginxFilesView = ({
  sites,
  nginxRunning,
  onEditSite,
  onToggleSite,
  onDeleteSite,
  onViewRawConfig,
  busyToggle,
}: NginxFilesViewProps) => {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set(sites.slice(0, 3).map((s) => s.name)))

  const toggleExpanded = (name: string) => {
    setExpandedSites((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  return (
    <div className="space-y-3">
      {sites.map((site) => {
        const isExpanded = expandedSites.has(site.name)
        return (
          <div
            key={site.name}
            style={{
              borderRadius: 16,
              border: isLight ? '1px solid var(--color-border)' : '1px solid rgba(255,255,255,0.08)',
              background: isLight ? 'var(--color-surface)' : 'rgba(255,255,255,0.02)',
              overflow: 'hidden',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: isExpanded
                  ? isLight
                    ? '1px solid var(--color-border-subtle)'
                    : '1px solid rgba(255,255,255,0.04)'
                  : 'none',
                cursor: 'pointer',
                background: isExpanded
                  ? isLight
                    ? 'var(--color-canvas-subtle)'
                    : 'rgba(255,255,255,0.03)'
                  : 'transparent',
                transition: 'background 0.2s',
              }}
              onClick={() => toggleExpanded(site.name)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    transition: 'color 0.2s',
                  }}
                >
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--color-text)',
                      margin: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {site.displayName}
                  </h3>
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-muted)',
                      margin: '2px 0 0 0',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {site.serverNames.join(', ')}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <Badge variant={site.type === 'proxy' ? 'info' : site.type === 'load-balancer' ? 'warning' : 'neutral'}>
                  {site.type === 'proxy' ? 'Proxy' : site.type === 'load-balancer' ? 'LB' : 'Static'}
                </Badge>
                {site.sslEnabled && (
                  <Badge variant="success">
                    <Lock size={10} />
                    SSL
                  </Badge>
                )}
                <Badge variant={site.enabled ? 'success' : 'neutral'}>
                  {site.enabled ? 'Ativo' : 'Inativo'}
                </Badge>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: site.enabled ? '#4ade80' : '#94a3b8',
                    boxShadow: site.enabled ? '0 0 6px rgba(74,222,128,0.7)' : 'none',
                  }}
                />
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div style={{ padding: '16px 20px', borderTop: isLight ? '1px solid var(--color-border-subtle)' : '1px solid rgba(255,255,255,0.04)' }}>
                {/* Flow diagram */}
                <SiteFlowDiagram site={site} isLight={isLight} />

                {/* Actions */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={<Edit2 size={12} />}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditSite(site)
                    }}
                  >
                    Editar
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={<Code2 size={12} />}
                    onClick={(e) => {
                      e.stopPropagation()
                      onViewRawConfig(site)
                    }}
                  >
                    .conf
                  </Button>

                  {site.toggleable && (
                    <Button
                      variant={site.enabled ? 'danger' : 'secondary'}
                      size="sm"
                      leadingIcon={site.enabled ? <PowerOff size={12} /> : <Play size={12} />}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleSite(site)
                      }}
                      disabled={busyToggle === site.name}
                    >
                      {site.enabled ? 'Desativar' : 'Ativar'}
                    </Button>
                  )}

                  {site.deletable && (
                    <Button
                      variant="danger"
                      size="sm"
                      leadingIcon={<Trash2 size={12} />}
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteSite(site)
                      }}
                    >
                      Remover
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default NginxFilesView
