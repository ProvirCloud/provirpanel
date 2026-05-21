import React from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import type {
  DomainNode,
  ServerNode,
  LocationNode,
  UpstreamNode,
  RuleNode,
  SelectionPath,
  NginxConfigState,
} from '../types/nginxConfig'

type NodeConfigPanelProps = {
  state: NginxConfigState
  selectedPath: SelectionPath
  onUpdate: (state: NginxConfigState) => void
  onClose: () => void
}

type EditableNode = DomainNode | ServerNode | LocationNode | UpstreamNode | RuleNode | null

const findNodeByPath = (state: NginxConfigState, path: SelectionPath): EditableNode => {
  if (path.domainId) {
    const domain = state.domains.find((d) => d.id === path.domainId)
    if (!domain) return null

    if (path.serverId) {
      const server = domain.servers.find((s) => s.id === path.serverId)
      if (!server) return null

      if (path.locationId) {
        const location = server.locations.find((l) => l.id === path.locationId)
        return location ?? null
      }

      if (path.upstreamId) {
        const upstream = server.upstreams.find((u) => u.id === path.upstreamId)
        return upstream ?? null
      }

      return server
    }

    return domain
  }

  return null
}

const updateNodeInState = (
  state: NginxConfigState,
  path: SelectionPath,
  updater: (node: EditableNode) => void,
): NginxConfigState => {
  const newState = JSON.parse(JSON.stringify(state))

  if (path.domainId) {
    const domain = newState.domains.find((d: any) => d.id === path.domainId)
    if (!domain) return state

    if (path.serverId) {
      const server = domain.servers.find((s: any) => s.id === path.serverId)
      if (!server) return state

      if (path.locationId) {
        const location = server.locations.find((l: any) => l.id === path.locationId)
        if (location) updater(location)
      } else if (path.upstreamId) {
        const upstream = server.upstreams.find((u: any) => u.id === path.upstreamId)
        if (upstream) updater(upstream)
      } else {
        updater(server)
      }
    } else {
      updater(domain)
    }
  }

  return newState
}

const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({ state, selectedPath, onUpdate, onClose }) => {
  const node = findNodeByPath(state, selectedPath)

  if (!node) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <p>Selecione um node para editar</p>
      </div>
    )
  }

  const handleChange = (updater: (node: any) => void) => {
    onUpdate(updateNodeInState(state, selectedPath, updater))
  }

  return (
    <div className="h-full flex flex-col bg-slate-900 border-l border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-3">
        <div>
          <p className="text-xs uppercase text-slate-500 tracking-wider">
            {node.type === 'domain'
              ? 'Domain'
              : node.type === 'server'
              ? 'Server'
              : node.type === 'location'
              ? 'Location'
              : node.type === 'upstream'
              ? 'Upstream'
              : 'Rule'}
          </p>
          <p className="text-sm font-medium text-slate-100 mt-1">
            {node.type === 'domain' ? node.name : node.type === 'server' ? `Port ${node.listenPort}` : node.type === 'location' ? node.path : node.type === 'upstream' ? node.name : `${node.condition}`}
          </p>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded">
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Domain config */}
        {node.type === 'domain' && (
          <>
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Domain Name</label>
              <input
                type="text"
                value={node.name}
                onChange={(e) => handleChange((n: any) => (n.name = e.target.value))}
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </>
        )}

        {/* Server config */}
        {node.type === 'server' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Listen Port</label>
                <input
                  type="number"
                  value={node.listenPort}
                  onChange={(e) => handleChange((n: any) => (n.listenPort = parseInt(e.target.value)))}
                  className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">SSL</label>
                <label className="mt-2 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={node.sslEnabled}
                    onChange={(e) => handleChange((n: any) => (n.sslEnabled = e.target.checked))}
                    className="rounded"
                  />
                  <span className="text-sm">Enabled</span>
                </label>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Server Name</label>
              <input
                type="text"
                value={node.serverName}
                onChange={(e) => handleChange((n: any) => (n.serverName = e.target.value))}
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            {node.sslEnabled && (
              <>
                <div>
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">SSL Cert Path</label>
                  <input
                    type="text"
                    value={node.sslCert || ''}
                    onChange={(e) => handleChange((n: any) => (n.sslCert = e.target.value))}
                    placeholder="/etc/nginx/certs/cert.pem"
                    className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">SSL Key Path</label>
                  <input
                    type="text"
                    value={node.sslKey || ''}
                    onChange={(e) => handleChange((n: any) => (n.sslKey = e.target.value))}
                    placeholder="/etc/nginx/certs/key.pem"
                    className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* Location config */}
        {node.type === 'location' && (
          <>
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Path</label>
              <input
                type="text"
                value={node.path}
                onChange={(e) => handleChange((n: any) => (n.path = e.target.value))}
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Proxy Pass</label>
              <input
                type="text"
                value={node.proxyPass || ''}
                onChange={(e) => handleChange((n: any) => (n.proxyPass = e.target.value))}
                placeholder="http://localhost:3000"
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={node.websocket}
                  onChange={(e) => handleChange((n: any) => (n.websocket = e.target.checked))}
                  className="rounded"
                />
                <span className="text-sm">WebSocket</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={node.cache}
                  onChange={(e) => handleChange((n: any) => (n.cache = e.target.checked))}
                  className="rounded"
                />
                <span className="text-sm">Cache</span>
              </label>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Timeout (seconds)</label>
              <input
                type="number"
                value={node.timeout || 30}
                onChange={(e) => handleChange((n: any) => (n.timeout = parseInt(e.target.value)))}
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </>
        )}

        {/* Upstream config */}
        {node.type === 'upstream' && (
          <>
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Upstream Name</label>
              <input
                type="text"
                value={node.name}
                onChange={(e) => handleChange((n: any) => (n.name = e.target.value))}
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Load Balancing Method</label>
              <select
                value={node.method || 'round_robin'}
                onChange={(e) => handleChange((n: any) => (n.method = e.target.value as any))}
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              >
                <option value="round_robin">Round Robin (default)</option>
                <option value="least_conn">Least Connections</option>
                <option value="ip_hash">IP Hash</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Servers</label>
                <button
                  onClick={() =>
                    handleChange((n: any) => {
                      const newServer = { host: 'localhost', port: 3000, weight: 1 }
                      n.servers.push(newServer)
                    })
                  }
                  className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 flex items-center gap-1"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {node.servers.map((srv, idx) => (
                  <div key={idx} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <input
                        type="text"
                        value={srv.host}
                        onChange={(e) =>
                          handleChange((n: any) => {
                            n.servers[idx].host = e.target.value
                          })
                        }
                        placeholder="Host"
                        className="w-full rounded-lg bg-slate-800 border border-slate-700 px-2 py-1 text-xs text-slate-100"
                      />
                    </div>
                    <div className="w-16">
                      <input
                        type="number"
                        value={srv.port}
                        onChange={(e) =>
                          handleChange((n: any) => {
                            n.servers[idx].port = parseInt(e.target.value)
                          })
                        }
                        placeholder="Port"
                        className="w-full rounded-lg bg-slate-800 border border-slate-700 px-2 py-1 text-xs text-slate-100"
                      />
                    </div>
                    <button
                      onClick={() =>
                        handleChange((n: any) => {
                          n.servers.splice(idx, 1)
                        })
                      }
                      className="p-1 hover:bg-red-900/30 rounded"
                    >
                      <Trash2 size={14} className="text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Rule config */}
        {node.type === 'rule' && (
          <>
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Condition</label>
              <input
                type="text"
                value={node.condition}
                onChange={(e) => handleChange((n: any) => (n.condition = e.target.value))}
                placeholder="e.g., if ($request_uri ~ ^/api)"
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Action</label>
              <input
                type="text"
                value={node.action}
                onChange={(e) => handleChange((n: any) => (n.action = e.target.value))}
                placeholder="e.g., proxy_pass http://api-upstream"
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default NodeConfigPanel
