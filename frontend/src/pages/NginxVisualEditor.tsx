import React, { useState, useRef, useMemo, useEffect } from 'react'
import { Plus, X, Edit2, Trash2, Eye, Code, Download, Copy, Check, ArrowRight } from 'lucide-react'
import { Globe, Server, MapPin, ArrowUpRight } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { generateNginxConf } from '../services/nginxConfigGenerator'
import type { NginxConfigState, SelectionPath, DomainNode, ServerNode, LocationNode, UpstreamNode } from '../types/nginxConfig'
import { createDefaultState } from '../services/nginxConfigSchema'

// ─── Tier configuration ────────────────────────────────────────────────────────

const TIER_CONFIGS = {
  domain: {
    key: 'domain',
    label: 'Domínios',
    icon: Globe,
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.12)',
    border: 'rgba(59,130,246,0.35)',
    hint: 'Domínios gerenciados'
  },
  server: {
    key: 'server',
    label: 'Nginx Servers',
    icon: Server,
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.12)',
    border: 'rgba(139,92,246,0.35)',
    hint: 'Listeners e portas SSL'
  },
  location: {
    key: 'location',
    label: 'Locations',
    icon: MapPin,
    color: '#10b981',
    bg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.35)',
    hint: 'Paths e rotas'
  },
  upstream: {
    key: 'upstream',
    label: 'Upstreams',
    icon: ArrowUpRight,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.35)',
    hint: 'Backends e load balancing'
  }
}

const NODE_W = 200
const NODE_H = 100
const NODE_GAP = 14
const TIER_PAD_V = 22
const PORT_R = 6

// ─── Node Detail Panel ────────────────────────────────────────────────────────

const NodeDetailPanel: React.FC<{
  selectedPath: SelectionPath
  state: NginxConfigState
  onUpdate: (newState: NginxConfigState) => void
  onClose: () => void
}> = ({ selectedPath, state, onUpdate, onClose }) => {
  if (!selectedPath.domainId && !selectedPath.serverId && !selectedPath.locationId && !selectedPath.upstreamId) {
    return null
  }

  // Find selected node
  let nodeType = ''
  let node: any = null
  const domain = state.domains.find((d) => d.id === selectedPath.domainId)

  if (selectedPath.domainId && domain) {
    nodeType = 'domain'
    node = domain
  } else if (selectedPath.serverId && domain) {
    nodeType = 'server'
    node = domain.servers.find((s) => s.id === selectedPath.serverId)
  } else if (selectedPath.locationId && domain) {
    nodeType = 'location'
    node = domain.servers.flatMap((s) => s.locations).find((l) => l.id === selectedPath.locationId)
  } else if (selectedPath.upstreamId && domain) {
    nodeType = 'upstream'
    node = domain.servers.flatMap((s) => s.upstreams).find((u) => u.id === selectedPath.upstreamId)
  }

  if (!node) return null

  const titleMap = { domain: 'Domain', server: 'Server', location: 'Location', upstream: 'Upstream' }
  const cfg = TIER_CONFIGS[nodeType as keyof typeof TIER_CONFIGS] || TIER_CONFIGS.domain

  return (
    <div style={{ position: 'relative', width: 350, height: '100%', background: 'linear-gradient(160deg, #0a1020 0%, #070d1a 100%)', display: 'flex', flexDirection: 'column', zIndex: 1, borderLeft: `1px solid ${cfg.color}40` }}>
      {/* Header */}
      <div style={{ padding: '16px', borderBottom: `1px solid ${cfg.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', margin: 0, textTransform: 'uppercase' }}>
            {titleMap[nodeType as keyof typeof titleMap]}
          </h3>
          <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0', fontWeight: 500 }}>{node.name || node.displayLabel || 'Unnamed'}</p>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Domain: name */}
        {nodeType === 'domain' && (
          <>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Domain Name
              </label>
              <input
                type="text"
                value={node.name}
                onChange={(e) => {
                  const newDomains = state.domains.map((d) => (d.id === node.id ? { ...d, name: e.target.value } : d))
                  onUpdate({ ...state, domains: newDomains })
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#f1f5f9',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: '#475569', background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: 8 }}>
              📊 <strong>{node.servers.length}</strong> server{node.servers.length !== 1 ? 's' : ''}
            </div>
          </>
        )}

        {/* Server: listenPort, sslEnabled, serverName */}
        {nodeType === 'server' && (
          <>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Listen Port
              </label>
              <input
                type="number"
                value={node.listenPort}
                onChange={(e) => {
                  const newDomains = state.domains.map((d) =>
                    d.id === selectedPath.domainId
                      ? {
                          ...d,
                          servers: d.servers.map((s) => (s.id === node.id ? { ...s, listenPort: Number(e.target.value) } : s))
                        }
                      : d
                  )
                  onUpdate({ ...state, domains: newDomains })
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#f1f5f9',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={node.sslEnabled}
                onChange={(e) => {
                  const newDomains = state.domains.map((d) =>
                    d.id === selectedPath.domainId
                      ? {
                          ...d,
                          servers: d.servers.map((s) => (s.id === node.id ? { ...s, sslEnabled: e.target.checked } : s))
                        }
                      : d
                  )
                  onUpdate({ ...state, domains: newDomains })
                }}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: 12, color: '#cbd5e1' }}>Enable SSL</span>
            </label>
            <div style={{ fontSize: 11, color: '#475569', background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: 8 }}>
              📍 <strong>{node.locations.length}</strong> location{node.locations.length !== 1 ? 's' : ''} · <strong>{node.upstreams.length}</strong> upstream{node.upstreams.length !== 1 ? 's' : ''}
            </div>
          </>
        )}

        {/* Location: path, proxyPass */}
        {nodeType === 'location' && (
          <>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Path
              </label>
              <input
                type="text"
                value={node.path}
                onChange={(e) => {
                  const newDomains = state.domains.map((d) =>
                    d.id === selectedPath.domainId
                      ? {
                          ...d,
                          servers: d.servers.map((s) =>
                            s.id === selectedPath.serverId
                              ? {
                                  ...s,
                                  locations: s.locations.map((l) => (l.id === node.id ? { ...l, path: e.target.value } : l))
                                }
                              : s
                          )
                        }
                      : d
                  )
                  onUpdate({ ...state, domains: newDomains })
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#f1f5f9',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                placeholder="/"
              />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Proxy Pass (optional)
              </label>
              <input
                type="text"
                value={node.proxyPass || ''}
                onChange={(e) => {
                  const newDomains = state.domains.map((d) =>
                    d.id === selectedPath.domainId
                      ? {
                          ...d,
                          servers: d.servers.map((s) =>
                            s.id === selectedPath.serverId
                              ? {
                                  ...s,
                                  locations: s.locations.map((l) => (l.id === node.id ? { ...l, proxyPass: e.target.value } : l))
                                }
                              : s
                          )
                        }
                      : d
                  )
                  onUpdate({ ...state, domains: newDomains })
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#f1f5f9',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                placeholder="http://localhost:3000"
              />
            </div>
          </>
        )}

        {/* Upstream: name, servers count */}
        {nodeType === 'upstream' && (
          <>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Upstream Name
              </label>
              <input
                type="text"
                value={node.name}
                onChange={(e) => {
                  const newDomains = state.domains.map((d) =>
                    d.id === selectedPath.domainId
                      ? {
                          ...d,
                          servers: d.servers.map((s) =>
                            s.id === selectedPath.serverId
                              ? {
                                  ...s,
                                  upstreams: s.upstreams.map((u) => (u.id === node.id ? { ...u, name: e.target.value } : u))
                                }
                              : s
                          )
                        }
                      : d
                  )
                  onUpdate({ ...state, domains: newDomains })
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#f1f5f9',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                placeholder="backend"
              />
            </div>
            <div style={{ fontSize: 11, color: '#475569', background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: 8 }}>
              🖥️ <strong>{node.servers?.length || 0}</strong> backend server{(node.servers?.length || 0) !== 1 ? 's' : ''}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px', borderTop: `1px solid ${cfg.color}20`, display: 'flex', gap: 8 }}>
        <button
          onClick={() => {
            // Delete node logic here
            onClose()
          }}
          style={{
            flex: 1,
            padding: '8px',
            borderRadius: 8,
            border: '1px solid rgba(248,113,113,0.3)',
            background: 'rgba(248,113,113,0.1)',
            color: '#f87171',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            transition: 'all 0.2s'
          }}
        >
          <Trash2 size={12} style={{ display: 'inline', marginRight: 4 }} />
          Delete
        </button>
      </div>
    </div>
  )
}


// ─── Flow Canvas Component ────────────────────────────────────────────────────

const NginxFlowCanvas: React.FC<{
  domain: DomainNode
  selectedPath: SelectionPath
  onSelectNode: (path: SelectionPath) => void
  onUpdateDomain: (domain: DomainNode) => void
}> = ({ domain, selectedPath, onSelectNode, onUpdateDomain }) => {
  const flowY = 60

  const renderFlowBox = (
    title: string,
    subtitle: string,
    icon: React.ReactNode,
    color: string,
    x: number,
    y: number,
    width: number,
    height: number,
    isSelected: boolean,
    onClick: () => void
  ) => (
    <g key={`${title}-${x}-${y}`} onClick={onClick} onPointerDown={(e) => { e.stopPropagation(); onClick() }} style={{ cursor: 'pointer', pointerEvents: 'auto' }}>
      <defs>
        <linearGradient id={`grad-${title}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: `${color}20`, stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#060d1a', stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={12}
        fill={`url(#grad-${title})`}
        stroke={isSelected ? color : `${color}40`}
        strokeWidth={isSelected ? 2 : 1}
        style={{ transition: 'stroke 0.15s', pointerEvents: 'auto' }}
      />
      {isSelected && (
        <rect
          x={x - 6}
          y={y - 6}
          width={width + 12}
          height={height + 12}
          rx={14}
          fill="none"
          stroke={color}
          strokeWidth="1"
          opacity="0.3"
          style={{ pointerEvents: 'none' }}
        />
      )}
      <text x={x + 12} y={y + 18} fontSize="12" fontWeight="600" fill="#f1f5f9" style={{ pointerEvents: 'none' }}>
        {title}
      </text>
      <text x={x + 12} y={y + 35} fontSize="10" fill="#64748b" style={{ pointerEvents: 'none' }}>
        {subtitle}
      </text>
    </g>
  )

  const renderArrow = (x1: number, y1: number, x2: number, y2: number, color: string) => (
    <g key={`arrow-${x1}-${y1}-${x2}-${y2}`}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={`${color}60`} strokeWidth="2" markerEnd={`url(#arrowhead-${color})`} />
      <defs>
        <marker id={`arrowhead-${color}`} markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
          <polygon points="0 0, 10 3, 0 6" fill={`${color}60`} />
        </marker>
      </defs>
    </g>
  )

  return (
    <svg style={{ width: '100%', height: '100%', background: 'transparent', pointerEvents: 'auto' }} viewBox="0 0 1200 800">
      {/* Domain Box */}
      {renderFlowBox(
        domain.name,
        'Domain',
        <Globe size={14} />,
        '#3b82f6',
        50,
        flowY,
        160,
        56,
        selectedPath.domainId === domain.id,
        () => onSelectNode({ domainId: domain.id })
      )}

      {/* Servers (HTTP/HTTPS) */}
      {domain.servers.length > 0 && (
        <>
          {renderArrow(210, flowY + 28, 250, flowY + 28, '#3b82f6')}

          {domain.servers.map((server, idx) => {
            const serverX = 250 + idx * 160
            const isHttp = server.listenPort === 80
            const portLabel = isHttp ? 'HTTP' : 'HTTPS'
            const portColor = isHttp ? '#ef4444' : '#22c55e'

            return (
              <g key={`server-${idx}`}>
                {renderFlowBox(
                  `${portLabel}:${server.listenPort}`,
                  server.sslEnabled ? 'SSL Ativo' : 'HTTP/2 Ativo',
                  <Server size={14} />,
                  portColor,
                  serverX,
                  flowY,
                  160,
                  56,
                  selectedPath.serverId === server.id,
                  () => onSelectNode({ domainId: domain.id, serverId: server.id })
                )}

                {/* Locations */}
                {server.locations.length > 0 && (
                  <>
                    {renderArrow(serverX + 80, flowY + 56, serverX + 80, flowY + 100, portColor)}

                    <g>
                      <rect x={serverX - 20} y={flowY + 100} width={200} height={server.locations.length * 50 + 20} rx={8} fill="none" stroke={`${portColor}20`} strokeWidth="1" strokeDasharray="5,5" />

                      {server.locations.map((location, locIdx) => (
                        <g key={`location-${locIdx}`}>
                          {renderFlowBox(
                            location.path,
                            location.proxyPass ? 'Proxy Pass' : 'Static',
                            <MapPin size={14} />,
                            '#10b981',
                            serverX - 10,
                            flowY + 110 + locIdx * 50,
                            180,
                            40,
                            selectedPath.locationId === location.id,
                            () => onSelectNode({ domainId: domain.id, serverId: server.id, locationId: location.id })
                          )}
                        </g>
                      ))}
                    </g>
                  </>
                )}

                {/* Upstreams */}
                {server.upstreams.length > 0 && (
                  <>
                    {renderArrow(serverX + 160 + 20, flowY + 28, serverX + 380, flowY + 28, portColor)}

                    {server.upstreams.map((upstream, upIdx) => (
                      <g key={`upstream-${upIdx}`}>
                        {renderFlowBox(
                          upstream.name,
                          `${upstream.servers?.length || 0} backend${(upstream.servers?.length || 0) !== 1 ? 's' : ''}`,
                          <ArrowUpRight size={14} />,
                          '#f59e0b',
                          serverX + 400 + upIdx * 160,
                          flowY,
                          160,
                          56,
                          selectedPath.upstreamId === upstream.id,
                          () => onSelectNode({ domainId: domain.id, serverId: server.id, upstreamId: upstream.id })
                        )}
                      </g>
                    ))}
                  </>
                )}
              </g>
            )
          })}
        </>
      )}

      {/* Legend */}
      <g>
        <text x="50" y="750" fontSize="12" fontWeight="600" fill="#cbd5e1">
          Legenda:
        </text>
        <rect x="50" y="760" width="120" height="20" rx="4" fill="#3b82f610" stroke="#3b82f6" strokeWidth="1" />
        <text x="70" y="775" fontSize="11" fill="#94a3b8">
          Domain
        </text>
        <rect x="200" y="760" width="120" height="20" rx="4" fill="#10b98110" stroke="#10b981" strokeWidth="1" />
        <text x="220" y="775" fontSize="11" fill="#94a3b8">
          Location
        </text>
        <rect x="350" y="760" width="120" height="20" rx="4" fill="#f59e0b10" stroke="#f59e0b" strokeWidth="1" />
        <text x="370" y="775" fontSize="11" fill="#94a3b8">
          Upstream
        </text>
      </g>
    </svg>
  )
}

const NginxTopologyDiagram: React.FC<{
  state: NginxConfigState
  selectedPath: SelectionPath
  onSelectNode: (path: SelectionPath) => void
  onAddNode: (tierType: string) => void
  onDeleteNode: (id: string) => void
}> = ({ state, selectedPath, onSelectNode, onAddNode, onDeleteNode }) => {
  const nodeEls = useRef<Record<string, HTMLDivElement>>({})
  const [wireStart, setWireStart] = useState<{ x: number; y: number } | null>(null)
  const [wireMouse, setWireMouse] = useState<{ x: number; y: number } | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!connecting) return

    const onMove = (e: MouseEvent) => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (rect) {
        setWireMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      }
    }

    const onUp = () => {
      setConnecting(null)
      setWireStart(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [connecting])

  const tiers = useMemo(
    () => [
      {
        type: 'domain' as const,
        label: TIER_CONFIGS.domain.label,
        cfg: TIER_CONFIGS.domain,
        nodes: state.domains.map((d) => ({
          ...d,
          displayLabel: d.name,
          id: d.id,
          tier: 'domain' as const
        }))
      },
      {
        type: 'server' as const,
        label: TIER_CONFIGS.server.label,
        cfg: TIER_CONFIGS.server,
        nodes: state.domains.flatMap((d) =>
          d.servers.map((s) => ({
            ...s,
            displayLabel: `Port ${s.listenPort}${s.sslEnabled ? ' SSL' : ''}`,
            id: s.id,
            tier: 'server' as const,
            parentDomainId: d.id
          }))
        )
      },
      {
        type: 'location' as const,
        label: TIER_CONFIGS.location.label,
        cfg: TIER_CONFIGS.location,
        nodes: state.domains.flatMap((d) =>
          d.servers.flatMap((s) =>
            s.locations.map((l) => ({
              ...l,
              displayLabel: l.path,
              id: l.id,
              tier: 'location' as const,
              parentServerId: s.id,
              parentDomainId: d.id
            }))
          )
        )
      },
      {
        type: 'upstream' as const,
        label: TIER_CONFIGS.upstream.label,
        cfg: TIER_CONFIGS.upstream,
        nodes: state.domains.flatMap((d) =>
          d.servers.flatMap((s) =>
            s.upstreams.map((u) => ({
              ...u,
              displayLabel: u.name,
              id: u.id,
              tier: 'upstream' as const,
              parentServerId: s.id,
              parentDomainId: d.id
            }))
          )
        )
      }
    ],
    [state]
  )

  const isNodeSelected = (id: string) => {
    return (
      selectedPath.domainId === id ||
      selectedPath.serverId === id ||
      selectedPath.locationId === id ||
      selectedPath.upstreamId === id
    )
  }

  const renderNode = (node: any, tier: any) => {
    const isSelected = isNodeSelected(node.id)
    const cfg = tier.cfg
    const TierIcon = cfg.icon

    const handleClick = () => {
      const path: SelectionPath = {}
      if (node.parentDomainId) path.domainId = node.parentDomainId
      if (node.parentServerId) path.serverId = node.parentServerId
      if (tier.type === 'domain') path.domainId = node.id
      else if (tier.type === 'server') path.serverId = node.id
      else if (tier.type === 'location') path.locationId = node.id
      else if (tier.type === 'upstream') path.upstreamId = node.id
      onSelectNode(path)
    }

    const startWire = (e: React.MouseEvent) => {
      e.stopPropagation()
      const rect = nodeEls.current[node.id]?.getBoundingClientRect()
      const wrapRect = wrapRef.current?.getBoundingClientRect()
      if (rect && wrapRect) {
        setWireStart({
          x: rect.left - wrapRect.left + rect.width / 2,
          y: rect.bottom - wrapRect.top
        })
        setConnecting(node.id)
      }
    }

    return (
      <div
        key={node.id}
        style={{ position: 'relative', width: NODE_W, height: NODE_H, flexShrink: 0 }}
        onMouseEnter={() => {
          if (connecting && connecting !== node.id) {
            // Show target port
          }
        }}
      >
        {/* Port handle (top) - input */}
        <div
          style={{
            position: 'absolute',
            top: -PORT_R,
            left: '50%',
            transform: 'translateX(-50%)',
            width: PORT_R * 2,
            height: PORT_R * 2,
            borderRadius: '50%',
            background: connecting === node.id ? cfg.color : '#060d1a',
            border: `2px solid ${connecting === node.id ? cfg.color : 'rgba(255,255,255,0.15)'}`,
            opacity: (connecting || isSelected) ? 1 : 0,
            cursor: 'crosshair',
            transition: 'all 0.12s',
            boxShadow: connecting === node.id ? `0 0 12px ${cfg.color}` : 'none',
            zIndex: 5
          }}
        />

        {/* Main card */}
        <div
          ref={(el) => {
            if (el) nodeEls.current[node.id] = el
          }}
          onClick={handleClick}
          style={{
            width: NODE_W,
            height: NODE_H,
            flexShrink: 0,
            borderRadius: 14,
            cursor: 'pointer',
            background: isSelected
              ? `linear-gradient(135deg, ${cfg.color}16 0%, rgba(6,12,26,0.98) 100%)`
              : 'linear-gradient(135deg, rgba(10,20,42,0.98) 0%, rgba(5,10,22,0.99) 100%)',
            border: `1px solid ${isSelected ? cfg.color : 'rgba(255,255,255,0.09)'}`,
            borderLeft: `3px solid ${cfg.color}`,
            boxShadow: isSelected
              ? `0 0 0 1px ${cfg.color}50, 0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)`
              : '0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.02)',
            transition: 'box-shadow 0.15s, border-color 0.15s',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            padding: '10px 12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                flexShrink: 0,
                background: `${cfg.color}18`,
                border: `1px solid ${cfg.color}35`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <TierIcon size={16} style={{ color: cfg.color }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.displayLabel}
              </p>
              <p style={{ color: '#475569', fontSize: 10, margin: '2px 0 0', fontFamily: 'ui-monospace' }}>
                {tier.type === 'server' && `${node.serverName}`}
                {tier.type === 'location' && `${node.proxyPass || 'static'}`}
                {tier.type === 'upstream' && `${node.servers?.length || 0} servers`}
              </p>
            </div>
          </div>
        </div>

        {/* Port handle (bottom) - output */}
        <div
          onMouseDown={startWire}
          style={{
            position: 'absolute',
            bottom: -PORT_R,
            left: '50%',
            transform: 'translateX(-50%)',
            width: PORT_R * 2,
            height: PORT_R * 2,
            borderRadius: '50%',
            background: cfg.color,
            border: `2px solid ${cfg.color}`,
            opacity: isSelected ? 1 : 0,
            cursor: 'crosshair',
            boxShadow: `0 0 8px ${cfg.color}90`,
            transition: 'opacity 0.12s',
            zIndex: 5
          }}
          title="Drag to connect"
        />
      </div>
    )
  }

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        borderRadius: 20,
        border: '1px solid rgba(255,255,255,0.08)',
        background: '#04080f',
        overflow: 'auto',
        minHeight: 500
      }}
    >
      {/* Wire SVG overlay */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
        {wireStart && wireMouse && (
          <>
            <path
              d={`M ${wireStart.x} ${wireStart.y} Q ${wireStart.x} ${(wireStart.y + wireMouse.y) / 2}, ${wireMouse.x} ${wireMouse.y}`}
              stroke="#3b82f6"
              strokeWidth="1.5"
              fill="none"
              strokeDasharray="7 4"
              opacity="0.9"
            />
            <circle cx={wireMouse.x} cy={wireMouse.y} r="4" fill="#3b82f6" opacity="0.75" />
          </>
        )}
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 2 }}>
        {tiers.map((tier, tierIdx) => {
          const isLast = tierIdx === tiers.length - 1
          return (
            <div
              key={tier.type}
              style={{
                display: 'flex',
                borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)',
                minHeight: NODE_H + TIER_PAD_V * 2
              }}
            >
              {/* Label */}
              <div
                style={{
                  width: 172,
                  minWidth: 172,
                  background: `linear-gradient(90deg, ${tier.cfg.color}0c, transparent)`,
                  borderRight: `1px solid ${tier.cfg.color}20`,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  padding: '0 16px',
                  gap: 6
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 3, height: 28, borderRadius: 2, background: tier.cfg.color, flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <tier.cfg.icon size={11} style={{ color: tier.cfg.color }} />
                      <span style={{ color: '#cbd5e1', fontSize: 11, fontWeight: 700 }}>{tier.label}</span>
                    </div>
                    <span style={{ color: '#334155', fontSize: 9 }}>{tier.cfg.hint}</span>
                  </div>
                </div>
                <div style={{ marginLeft: 11 }}>
                  <span style={{ fontSize: 9, color: tier.cfg.color, background: `${tier.cfg.color}15`, border: `1px solid ${tier.cfg.color}30`, borderRadius: 4, padding: '1px 6px' }}>
                    {tier.nodes.length} nó{tier.nodes.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Nodes + Add button */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: NODE_GAP, padding: `${TIER_PAD_V}px 20px`, overflowX: 'auto' }}>
                {tier.nodes.length > 0 ? (
                  tier.nodes.map((node) => renderNode(node, tier))
                ) : (
                  <div style={{ color: '#475569', fontSize: 12 }}>Nenhum {tier.label.toLowerCase()}</div>
                )}

                {/* Add button */}
                <button
                  onClick={() => onAddNode(tier.type)}
                  style={{
                    width: 44,
                    height: NODE_H,
                    flexShrink: 0,
                    borderRadius: 14,
                    border: `1.5px dashed ${tier.cfg.color}45`,
                    background: `${tier.cfg.color}06`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: `${tier.cfg.color}70`,
                    fontSize: 20,
                    transition: 'all 0.15s',
                    fontWeight: 700
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = tier.cfg.color
                    e.currentTarget.style.background = `${tier.cfg.color}14`
                    e.currentTarget.style.color = tier.cfg.color
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = `${tier.cfg.color}45`
                    e.currentTarget.style.background = `${tier.cfg.color}06`
                    e.currentTarget.style.color = `${tier.cfg.color}70`
                  }}
                >
                  +
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main editor ──────────────────────────────────────────────────────────────

const NginxVisualEditor: React.FC = () => {
  const [state, setState] = useState<NginxConfigState>(createDefaultState())
  const [selectedPath, setSelectedPath] = useState<SelectionPath>({})
  const [tab, setTab] = useState<'visual' | 'config'>('visual')
  const [copied, setCopied] = useState(false)
  const [selectedDomainIdx, setSelectedDomainIdx] = useState(0)

  const generatedConf = generateNginxConf(state.domains)
  const currentDomain = state.domains[selectedDomainIdx]

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedConf)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadConf = () => {
    const element = document.createElement('a')
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(generatedConf))
    element.setAttribute('download', 'nginx.conf')
    element.style.display = 'none'
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0a0e1a' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '16px 24px', background: 'rgba(255,255,255,0.03)' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9', margin: 0 }}>Nginx Visual Editor</h1>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Fluxo visual de configuração</p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setTab('visual')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: tab === 'visual' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
              color: tab === 'visual' ? 'white' : '#cbd5e1',
              transition: 'all 0.2s'
            }}
          >
            <Eye size={14} /> Visual
          </button>
          <button
            onClick={() => setTab('config')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: tab === 'config' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
              color: tab === 'config' ? 'white' : '#cbd5e1',
              transition: 'all 0.2s'
            }}
          >
            <Code size={14} /> nginx.conf
          </button>
        </div>
      </div>

      {/* Main Content */}
      {tab === 'visual' ? (
        <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>
          {/* Left Sidebar - Domains */}
          <div style={{ width: 240, borderRight: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <h3 style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Configuração Atual</h3>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
              {state.domains.map((domain, idx) => (
                <button
                  key={domain.id}
                  onClick={() => {
                    setSelectedDomainIdx(idx)
                    setSelectedPath({ domainId: domain.id })
                  }}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    border: 'none',
                    background: idx === selectedDomainIdx ? 'rgba(59,130,246,0.15)' : 'transparent',
                    borderLeft: idx === selectedDomainIdx ? '3px solid #3b82f6' : '3px solid transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Globe size={13} style={{ color: '#3b82f6' }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{domain.name}</p>
                      <p style={{ color: '#475569', fontSize: 10, margin: '2px 0 0' }}>{domain.servers.length} servidor{domain.servers.length !== 1 ? 'es' : ''}</p>
                    </div>
                  </div>
                </button>
              ))}
              <button
                onClick={() => {
                  const newDomain = {
                    id: uuidv4(),
                    type: 'domain' as const,
                    name: 'example-' + Math.random().toString(36).substr(2, 5) + '.com',
                    servers: [
                      {
                        id: uuidv4(),
                        type: 'server' as const,
                        listenPort: 80,
                        sslEnabled: false,
                        serverName: '',
                        locations: [{ id: uuidv4(), type: 'location' as const, path: '/', proxyPass: 'http://localhost:3000', websocket: false, cache: false, timeout: 0, headers: {} }],
                        upstreams: []
                      }
                    ]
                  }
                  setState({ ...state, domains: [...state.domains, newDomain] })
                }}
                style={{
                  padding: '12px 16px',
                  border: '1px dashed rgba(59,130,246,0.5)',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#3b82f6',
                  fontSize: 12,
                  fontWeight: 600,
                  margin: 'auto 12px 12px',
                  borderRadius: 8,
                  transition: 'all 0.15s'
                }}
              >
                + Novo Domain
              </button>
            </div>
          </div>

          {/* Center - Visual Flow */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '24px', background: 'linear-gradient(135deg, #0a0e1a 0%, #0f1420 100%)' }}>
            {currentDomain ? (
              <NginxFlowCanvas 
                domain={currentDomain}
                selectedPath={selectedPath}
                onSelectNode={setSelectedPath}
                onUpdateDomain={(updated) => {
                  const newDomains = state.domains.map((d, idx) => idx === selectedDomainIdx ? updated : d)
                  setState({ ...state, domains: newDomains })
                }}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#475569' }}>
                <p>Selecione ou crie um domínio</p>
              </div>
            )}
          </div>

          {/* Right Panel - Edit */}
          <NodeDetailPanel
            selectedPath={selectedPath}
            state={state}
            onUpdate={setState}
            onClose={() => setSelectedPath({})}
          />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', margin: 0 }}>Generated nginx.conf</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={copyToClipboard}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={downloadConf}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  background: '#3b82f6',
                  color: 'white',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <Download size={14} />
                Download
              </button>
            </div>
          </div>
          <pre
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 16,
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(0,0,0,0.4)',
              fontSize: 11,
              fontFamily: 'ui-monospace',
              color: '#94a3b8',
              margin: 0,
              lineHeight: 1.5
            }}
          >
            {generatedConf}
          </pre>
        </div>
      )}
    </div>
  )
}

export default NginxVisualEditor
