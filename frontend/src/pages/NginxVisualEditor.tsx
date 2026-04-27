import React, { useState, useRef, useMemo } from 'react'
import { Plus, X, Edit2, Trash2, Eye, Code, Download, Copy, Check } from 'lucide-react'
import { Globe, Server, MapPin, ArrowUpRight } from 'lucide-react'
import { generateNginxConf } from '../services/nginxConfigGenerator'
import type { NginxConfigState, SelectionPath } from '../types/nginxConfig'
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

// ─── Topology Diagram ──────────────────────────────────────────────────────────

const NginxTopologyDiagram: React.FC<{
  state: NginxConfigState
  selectedPath: SelectionPath
  onSelectNode: (path: SelectionPath) => void
}> = ({ state, selectedPath, onSelectNode }) => {
  const nodeEls = useRef<Record<string, HTMLDivElement>>({})

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

    return (
      <div
        key={node.id}
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
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 20,
        border: '1px solid rgba(255,255,255,0.08)',
        background: '#04080f',
        overflow: 'auto',
        minHeight: 500
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
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

              {/* Nodes */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: NODE_GAP, padding: `${TIER_PAD_V}px 20px`, overflowX: 'auto' }}>
                {tier.nodes.length > 0 ? (
                  tier.nodes.map((node) => renderNode(node, tier))
                ) : (
                  <div style={{ color: '#475569', fontSize: 12 }}>Nenhum {tier.label.toLowerCase()}</div>
                )}
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

  const generatedConf = generateNginxConf(state.domains)

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
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Topology matching StacksPanel pattern</p>
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

      {/* Content */}
      {tab === 'visual' ? (
        <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>
          {/* Left: Diagram */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.08)', overflow: 'auto', padding: 20 }}>
            <NginxTopologyDiagram state={state} selectedPath={selectedPath} onSelectNode={setSelectedPath} />
          </div>

          {/* Right: State + Config */}
          <div style={{ width: 400, display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>State</h3>
            </div>
            <pre
              style={{
                flex: 1,
                overflow: 'auto',
                padding: 16,
                fontSize: 10,
                fontFamily: 'ui-monospace',
                color: '#94a3b8',
                margin: 0,
                background: 'rgba(0,0,0,0.3)',
                lineHeight: 1.4
              }}
            >
              {JSON.stringify(state, null, 2)}
            </pre>
          </div>
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

            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'editor'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Eye size={14} />
            Visual Editor
          </button>
          <button
            onClick={() => setTab('config')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'config'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Code size={14} />
            nginx.conf
          </button>
        </div>
      </div>

      {/* Content */}
      {tab === 'editor' ? (
        <div className="flex-1 flex gap-0 overflow-hidden">
          {/* Left: Diagram */}
          <div className="w-80 flex flex-col border-r border-slate-800 bg-slate-900/30">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Config Tree</h2>
              <button
                onClick={() => {
                  const newDomain = {
                    id: Math.random().toString(36).substr(2, 9),
                    type: 'domain' as const,
                    name: 'new-domain.com',
                    servers: [],
                  }
                  setState({
                    ...state,
                    domains: [...state.domains, newDomain],
                  })
                }}
                className="p-1 hover:bg-blue-600/30 rounded text-blue-400"
                title="Add domain"
              >
                <Plus size={14} />
              </button>
            </div>
            <NginxDiagram
              domains={state.domains}
              selectedPath={selectedPath}
              onSelectNode={setSelectedPath}
            />
          </div>

          {/* Center: JSON State */}
          <div className="flex-1 flex flex-col border-r border-slate-800 bg-slate-950/50 p-4">
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              State JSON
            </h2>
            <pre className="flex-1 overflow-auto bg-slate-900 rounded-lg border border-slate-800 p-3 text-xs font-mono text-slate-300 text-left">
              {JSON.stringify(state, null, 2)}
            </pre>
          </div>

          {/* Right: Panel */}
          <div className="w-96 flex flex-col border-l border-slate-800 bg-slate-900/30">
            <NodeConfigPanel
              state={state}
              selectedPath={selectedPath}
              onUpdate={handleStateUpdate}
              onClose={() => setSelectedPath({})}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-100">Generated nginx.conf</h2>
            <div className="flex gap-2">
              <button
                onClick={copyToClipboard}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium transition-all"
              >
                {copied ? (
                  <>
                    <Check size={14} /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copy
                  </>
                )}
              </button>
              <button
                onClick={downloadConf}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-all"
              >
                <Download size={14} /> Download
              </button>
            </div>
          </div>

          <pre className="flex-1 overflow-auto bg-slate-900 rounded-lg border border-slate-800 p-4 text-xs font-mono text-slate-300 text-left">
            {generatedConf}
          </pre>
        </div>
      )}
    </div>
  )
}

export default NginxVisualEditor
