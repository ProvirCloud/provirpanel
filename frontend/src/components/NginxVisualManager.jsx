import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Server, Plus, Save, Trash2, Power, PowerOff, CheckCircle, XCircle,
  Copy, Shield, Box, Activity, Globe, Settings, Eye, Play, RefreshCw,
  AlertTriangle, Clock, TrendingUp, ArrowRight, Edit2, X, ChevronDown,
  ChevronRight, Filter, Download, Zap, ExternalLink, BarChart3
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell
} from 'recharts'
import api from '../services/api.js'
import { createNginxLogsSocket } from '../services/socket.js'

// Status badge colors
const STATUS_COLORS = {
  '2xx': { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-800' },
  '3xx': { bg: 'bg-blue-500/10', text: 'text-blue-300', border: 'border-blue-800' },
  '4xx': { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-800' },
  '5xx': { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-800' }
}

const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444']

// ==================== SERVER LIST COMPONENT ====================
const ServersList = ({ servers, selectedServer, onSelect, onToggle, onDelete, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredServers = servers.filter(s =>
    s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.primary_domain?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Buscar servidor..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={onRefresh}
          className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700"
          title="Atualizar lista"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
        {filteredServers.map((server) => (
          <div
            key={server.id}
            onClick={() => onSelect(server)}
            className={`rounded-xl border p-3 cursor-pointer transition ${
              selectedServer?.id === server.id
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-white truncate">{server.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(server)
                }}
                className="flex-shrink-0"
              >
                {server.is_active ? (
                  <Power className="h-4 w-4 text-emerald-400" />
                ) : (
                  <PowerOff className="h-4 w-4 text-slate-500" />
                )}
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400 truncate">
                <Globe className="h-3 w-3 inline mr-1" />
                {server.primary_domain}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                server.is_active
                  ? 'bg-emerald-500/10 text-emerald-300'
                  : 'bg-slate-500/10 text-slate-400'
              }`}>
                {server.is_active ? 'Ativo' : 'Inativo'}
              </span>
              {server.ssl_type !== 'none' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300">
                  <Shield className="h-3 w-3 inline mr-1" />
                  SSL
                </span>
              )}
              <span className="text-xs text-slate-500 capitalize">{server.server_type}</span>
            </div>
          </div>
        ))}

        {filteredServers.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <Server className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nenhum servidor encontrado</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== SERVER FORM COMPONENT ====================
const ServerForm = ({ server, onSave, onCancel, dockerContainers }) => {
  const [form, setForm] = useState({
    name: '',
    primary_domain: '',
    additional_domains: [],
    upstream_servers: [{ ip: '127.0.0.1', port: '3000', weight: '1', backup: false }],
    server_type: 'proxy',
    listen_port: 80,
    ssl_type: 'none',
    ssl_cert_path: '',
    ssl_key_path: '',
    proxy_host: 'localhost',
    proxy_port: 3000,
    root_path: '/var/www/html',
    websocket_enabled: true,
    forward_headers: true,
    client_max_body_size: '50m',
    proxy_connect_timeout: '5s',
    proxy_read_timeout: '60s',
    proxy_send_timeout: '60s',
    is_active: true,
    notes: ''
  })
  const [preview, setPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [newDomain, setNewDomain] = useState('')

  useEffect(() => {
    if (server) {
      setForm({
        ...form,
        ...server,
        upstream_servers: server.upstream_servers || [{ ip: '127.0.0.1', port: '3000', weight: '1', backup: false }]
      })
    }
  }, [server])

  const generatePreview = async () => {
    if (!server?.id) {
      setPreview('Salve o servidor primeiro para gerar preview')
      return
    }
    try {
      const res = await api.post(`/api/nginx/servers/${server.id}/generate-preview`)
      setPreview(res.data.config)
    } catch (err) {
      setPreview(`Erro: ${err.response?.data?.error || err.message}`)
    }
  }

  const handleSave = async () => {
    if (!form.name || !form.primary_domain) {
      alert('Nome e domínio são obrigatórios')
      return
    }
    setSaving(true)
    try {
      await onSave(form)
    } finally {
      setSaving(false)
    }
  }

  const addDomain = () => {
    if (newDomain && !form.additional_domains.includes(newDomain)) {
      setForm({ ...form, additional_domains: [...form.additional_domains, newDomain] })
      setNewDomain('')
    }
  }

  const removeDomain = (domain) => {
    setForm({ ...form, additional_domains: form.additional_domains.filter(d => d !== domain) })
  }

  const addUpstream = () => {
    setForm({
      ...form,
      upstream_servers: [...form.upstream_servers, { ip: '127.0.0.1', port: '3000', weight: '1', backup: false }]
    })
  }

  const updateUpstream = (index, field, value) => {
    const newUpstreams = [...form.upstream_servers]
    newUpstreams[index] = { ...newUpstreams[index], [field]: value }
    setForm({ ...form, upstream_servers: newUpstreams })
  }

  const removeUpstream = (index) => {
    setForm({ ...form, upstream_servers: form.upstream_servers.filter((_, i) => i !== index) })
  }

  const useDockerContainer = (container) => {
    if (form.server_type === 'balancer') {
      setForm({
        ...form,
        upstream_servers: [
          ...form.upstream_servers,
          { ip: container.ip || 'localhost', port: String(container.port), weight: '1', backup: false }
        ]
      })
    } else {
      setForm({
        ...form,
        proxy_host: container.ip || 'localhost',
        proxy_port: container.port
      })
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Left: Form */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Configurações Básicas
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-slate-400">Nome do servidor</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="Minha API"
              />
            </div>

            <div className="col-span-2">
              <label className="text-xs text-slate-400">Domínio principal *</label>
              <input
                type="text"
                value={form.primary_domain}
                onChange={(e) => setForm({ ...form, primary_domain: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="api.example.com"
              />
            </div>

            <div className="col-span-2">
              <label className="text-xs text-slate-400">Domínios adicionais</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="www.api.example.com"
                  onKeyPress={(e) => e.key === 'Enter' && addDomain()}
                />
                <button
                  onClick={addDomain}
                  className="rounded-xl bg-blue-500 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-600"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {form.additional_domains.map((domain, i) => (
                  <span key={i} className="flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                    {domain}
                    <button onClick={() => removeDomain(domain)} className="text-slate-400 hover:text-rose-400">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400">Tipo de servidor</label>
              <select
                value={form.server_type}
                onChange={(e) => setForm({ ...form, server_type: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="proxy">Proxy Reverso</option>
                <option value="balancer">Load Balancer</option>
                <option value="static">Site Estático</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400">Porta (HTTP)</label>
              <input
                type="number"
                value={form.listen_port}
                onChange={(e) => setForm({ ...form, listen_port: parseInt(e.target.value) || 80 })}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
          </div>
        </div>

        {/* Proxy / Balancer / Static config */}
        {form.server_type === 'proxy' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <ArrowRight className="h-4 w-4" />
              Destino do Proxy
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">Host</label>
                <input
                  type="text"
                  value={form.proxy_host}
                  onChange={(e) => setForm({ ...form, proxy_host: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Porta</label>
                <input
                  type="number"
                  value={form.proxy_port}
                  onChange={(e) => setForm({ ...form, proxy_port: parseInt(e.target.value) || 3000 })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
          </div>
        )}

        {form.server_type === 'balancer' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Upstream Servers
              </span>
              <button
                onClick={addUpstream}
                className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-600"
              >
                <Plus className="h-3 w-3 inline mr-1" />
                Adicionar
              </button>
            </h3>
            <div className="space-y-2">
              {form.upstream_servers.map((upstream, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    value={upstream.ip}
                    onChange={(e) => updateUpstream(index, 'ip', e.target.value)}
                    className="col-span-4 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                    placeholder="IP/Host"
                  />
                  <input
                    type="text"
                    value={upstream.port}
                    onChange={(e) => updateUpstream(index, 'port', e.target.value)}
                    className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                    placeholder="Porta"
                  />
                  <input
                    type="text"
                    value={upstream.weight}
                    onChange={(e) => updateUpstream(index, 'weight', e.target.value)}
                    className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                    placeholder="Peso"
                  />
                  <label className="col-span-2 flex items-center gap-1 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={upstream.backup}
                      onChange={(e) => updateUpstream(index, 'backup', e.target.checked)}
                    />
                    Backup
                  </label>
                  <button
                    onClick={() => removeUpstream(index)}
                    className="col-span-2 rounded-lg border border-rose-800 px-2 py-1 text-xs text-rose-200 hover:bg-rose-900"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {form.server_type === 'static' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Pasta do Site
            </h3>
            <input
              type="text"
              value={form.root_path}
              onChange={(e) => setForm({ ...form, root_path: e.target.value })}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              placeholder="/var/www/html"
            />
          </div>
        )}

        {/* SSL Configuration */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="h-4 w-4" />
            SSL / HTTPS
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400">Tipo de SSL</label>
              <select
                value={form.ssl_type}
                onChange={(e) => setForm({ ...form, ssl_type: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="none">Nenhum (HTTP)</option>
                <option value="letsencrypt">Let's Encrypt</option>
                <option value="manual">Manual (certificado próprio)</option>
              </select>
            </div>

            {form.ssl_type === 'manual' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Caminho do Certificado</label>
                  <input
                    type="text"
                    value={form.ssl_cert_path}
                    onChange={(e) => setForm({ ...form, ssl_cert_path: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    placeholder="/etc/ssl/certs/cert.pem"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Caminho da Chave</label>
                  <input
                    type="text"
                    value={form.ssl_key_path}
                    onChange={(e) => setForm({ ...form, ssl_key_path: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    placeholder="/etc/ssl/private/key.pem"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Advanced Options */}
        <details className="rounded-2xl border border-slate-800 bg-slate-900/60">
          <summary className="cursor-pointer p-4 text-sm font-semibold text-white flex items-center gap-2">
            <ChevronRight className="h-4 w-4" />
            Opções Avançadas
          </summary>
          <div className="p-4 pt-0 grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={form.websocket_enabled}
                onChange={(e) => setForm({ ...form, websocket_enabled: e.target.checked })}
              />
              WebSocket / Upgrade
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={form.forward_headers}
                onChange={(e) => setForm({ ...form, forward_headers: e.target.checked })}
              />
              Forward Headers
            </label>
            <div>
              <label className="text-xs text-slate-400">Max Upload</label>
              <input
                type="text"
                value={form.client_max_body_size}
                onChange={(e) => setForm({ ...form, client_max_body_size: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Read Timeout</label>
              <input
                type="text"
                value={form.proxy_read_timeout}
                onChange={(e) => setForm({ ...form, proxy_read_timeout: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-400">Notas</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white h-20 resize-none"
                placeholder="Observações..."
              />
            </div>
          </div>
        </details>

        {/* Docker Containers */}
        {dockerContainers.length > 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Box className="h-4 w-4" />
              Containers Docker
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {dockerContainers.map((container) => (
                <div
                  key={container.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-2"
                >
                  <div>
                    <p className="text-xs font-semibold text-white">{container.name}</p>
                    <p className="text-xs text-slate-400">{container.ip}:{container.port}</p>
                  </div>
                  <button
                    onClick={() => useDockerContainer(container)}
                    className="rounded-lg bg-blue-500 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-600"
                  >
                    Usar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            onClick={generatePreview}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
          >
            <Eye className="h-4 w-4" />
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      {/* Right: Preview */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Nginx Config Preview
          </span>
          <button
            onClick={generatePreview}
            className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </h3>
        <pre className="h-[calc(100%-3rem)] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300 font-mono">
          {preview || 'Clique em "Preview" para gerar a configuração'}
        </pre>
      </div>
    </div>
  )
}

// ==================== LOGS PANEL COMPONENT ====================
const LogsPanel = ({ serverId }) => {
  const [logs, setLogs] = useState([])
  const [filters, setFilters] = useState({ statusRange: '', ip: '', path: '' })
  const [isConnected, setIsConnected] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const logsContainerRef = useRef(null)
  const socketRef = useRef(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return

    socketRef.current = createNginxLogsSocket(token)
    const socket = socketRef.current

    socket.on('connect', () => {
      setIsConnected(true)
      socket.emit('get-recent', { serverId, limit: 100 })
      if (serverId) {
        socket.emit('subscribe', serverId)
      }
    })

    socket.on('disconnect', () => setIsConnected(false))

    socket.on('recent-logs', (recentLogs) => {
      setLogs(recentLogs)
    })

    socket.on('log', (logEntry) => {
      if (!isPaused) {
        setLogs(prev => [logEntry, ...prev].slice(0, 1000))
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [serverId])

  useEffect(() => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('filter', { serverId, filters })
    }
  }, [filters, serverId, isConnected])

  const getStatusBadge = (status) => {
    let colors = STATUS_COLORS['2xx']
    if (status >= 300 && status < 400) colors = STATUS_COLORS['3xx']
    else if (status >= 400 && status < 500) colors = STATUS_COLORS['4xx']
    else if (status >= 500) colors = STATUS_COLORS['5xx']

    return (
      <span className={`px-2 py-0.5 rounded-full text-xs ${colors.bg} ${colors.text}`}>
        {status}
      </span>
    )
  }

  const clearLogs = () => setLogs([])

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={filters.statusRange}
            onChange={(e) => setFilters({ ...filters, statusRange: e.target.value })}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
          >
            <option value="">Todos status</option>
            <option value="2xx">2xx (Success)</option>
            <option value="3xx">3xx (Redirect)</option>
            <option value="4xx">4xx (Client Error)</option>
            <option value="5xx">5xx (Server Error)</option>
          </select>
        </div>
        <input
          type="text"
          placeholder="Filtrar por IP"
          value={filters.ip}
          onChange={(e) => setFilters({ ...filters, ip: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white w-32"
        />
        <input
          type="text"
          placeholder="Filtrar por path"
          value={filters.path}
          onChange={(e) => setFilters({ ...filters, path: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white flex-1"
        />
        <div className="flex gap-1">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`rounded-lg px-2 py-1 text-xs ${
              isPaused ? 'bg-amber-500 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {isPaused ? 'Continuar' : 'Pausar'}
          </button>
          <button
            onClick={clearLogs}
            className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            Limpar
          </button>
        </div>
        <div className={`flex items-center gap-1 text-xs ${isConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
          <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          {isConnected ? 'Conectado' : 'Desconectado'}
        </div>
      </div>

      {/* Logs Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-slate-800 bg-slate-950" ref={logsContainerRef}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-900">
            <tr className="text-slate-400">
              <th className="px-3 py-2 text-left w-24">Hora</th>
              <th className="px-3 py-2 text-left w-28">IP</th>
              <th className="px-3 py-2 text-left w-16">Método</th>
              <th className="px-3 py-2 text-left">Path</th>
              <th className="px-3 py-2 text-center w-16">Status</th>
              <th className="px-3 py-2 text-right w-16">Tempo</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr key={log.id || i} className="border-t border-slate-800 hover:bg-slate-900/50">
                <td className="px-3 py-2 text-slate-400">
                  {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '-'}
                </td>
                <td className="px-3 py-2 text-white font-mono">{log.client_ip}</td>
                <td className="px-3 py-2 text-blue-300 font-semibold">{log.request_method}</td>
                <td className="px-3 py-2 text-slate-300 truncate max-w-xs" title={log.request_path}>
                  {log.request_path}
                </td>
                <td className="px-3 py-2 text-center">{getStatusBadge(log.status_code)}</td>
                <td className="px-3 py-2 text-right text-slate-400">
                  {log.response_time_ms ? `${log.response_time_ms}ms` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <Activity className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>Aguardando logs...</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== METRICS PANEL COMPONENT ====================
const MetricsPanel = ({ serverId }) => {
  const [metrics, setMetrics] = useState(null)
  const [period, setPeriod] = useState('24h')
  const [loading, setLoading] = useState(true)

  const loadMetrics = async () => {
    setLoading(true)
    try {
      const endpoint = serverId ? `/api/nginx/servers/${serverId}/metrics` : '/api/nginx/metrics'
      const res = await api.get(`${endpoint}?period=${period}`)
      setMetrics(res.data)
    } catch (err) {
      console.error('Failed to load metrics:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMetrics()
    const interval = setInterval(loadMetrics, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [serverId, period])

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 text-slate-500 animate-spin" />
      </div>
    )
  }

  const summary = metrics?.summary || {}
  const timeSeries = metrics?.timeSeries || []
  const statusDist = metrics?.statusDistribution || []

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Métricas de Performance
        </h3>
        <div className="flex gap-1">
          {['1h', '24h', '7d', '30d'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-3 py-1 text-xs ${
                period === p
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={loadMetrics}
            className="rounded-lg bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">Total Requisições</p>
          <p className="text-2xl font-bold text-white">{Number(summary.total_requests || 0).toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">Tempo Médio</p>
          <p className="text-2xl font-bold text-blue-400">{summary.avg_response_time || 0}ms</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">Taxa de Erro</p>
          <p className={`text-2xl font-bold ${summary.error_rate > 5 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {summary.error_rate || 0}%
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">Dados Trafegados</p>
          <p className="text-2xl font-bold text-violet-400">
            {((summary.total_bytes || 0) / (1024 * 1024)).toFixed(1)} MB
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">Visitantes Únicos</p>
          <p className="text-2xl font-bold text-amber-400">{summary.unique_visitors || 0}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Requests over time */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h4 className="text-xs text-slate-400 mb-4">Requisições por período</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="time_bucket"
                  tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  stroke="#64748b"
                  fontSize={10}
                />
                <YAxis stroke="#64748b" fontSize={10} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelFormatter={(val) => new Date(val).toLocaleString()}
                />
                <Area
                  type="monotone"
                  dataKey="requests"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Response time over time */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h4 className="text-xs text-slate-400 mb-4">Tempo de resposta (ms)</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="time_bucket"
                  tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  stroke="#64748b"
                  fontSize={10}
                />
                <YAxis stroke="#64748b" fontSize={10} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelFormatter={(val) => new Date(val).toLocaleString()}
                />
                <Line
                  type="monotone"
                  dataKey="avg_response_time"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status distribution */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h4 className="text-xs text-slate-400 mb-4">Distribuição de Status</h4>
          <div className="h-48 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusDist}
                  dataKey="count"
                  nameKey="status_group"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  label={({ status_group, percent }) => `${status_group} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {statusDist.map((entry, index) => {
                    const colors = { '2xx': '#10b981', '3xx': '#3b82f6', '4xx': '#f59e0b', '5xx': '#ef4444' }
                    return <Cell key={entry.status_group} fill={colors[entry.status_group] || '#64748b'} />
                  })}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Errors over time */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h4 className="text-xs text-slate-400 mb-4">Erros por período</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="time_bucket"
                  tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  stroke="#64748b"
                  fontSize={10}
                />
                <YAxis stroke="#64748b" fontSize={10} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelFormatter={(val) => new Date(val).toLocaleString()}
                />
                <Area
                  type="monotone"
                  dataKey="errors"
                  stroke="#ef4444"
                  fill="#ef4444"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== SSL CERTIFICATES PANEL ====================
const SSLPanel = ({ serverId }) => {
  const [certs, setCerts] = useState([])
  const [loading, setLoading] = useState(true)

  const loadCerts = async () => {
    setLoading(true)
    try {
      const endpoint = serverId ? `/api/nginx/servers/${serverId}/certs` : '/api/nginx/certs'
      const res = await api.get(endpoint)
      setCerts(res.data.certs || [])
    } catch (err) {
      console.error('Failed to load certs:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCerts()
  }, [serverId])

  const renewCert = async (certId) => {
    try {
      await api.post(`/api/nginx/certs/${certId}/renew`)
      alert('Certificado renovado!')
      loadCerts()
    } catch (err) {
      alert(`Erro: ${err.response?.data?.error || err.message}`)
    }
  }

  const toggleAutoRenew = async (certId, currentValue) => {
    try {
      await api.patch(`/api/nginx/certs/${certId}/auto-renew`, { autoRenew: !currentValue })
      loadCerts()
    } catch (err) {
      alert(`Erro: ${err.response?.data?.error || err.message}`)
    }
  }

  const getStatusBadge = (status, daysLeft) => {
    if (status === 'expired' || daysLeft <= 0) {
      return <span className="px-2 py-0.5 rounded-full text-xs bg-rose-500/10 text-rose-300">Expirado</span>
    }
    if (status === 'expiring_soon' || daysLeft <= 30) {
      return <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-300">Expira em {daysLeft}d</span>
    }
    return <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-300">Válido ({daysLeft}d)</span>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 text-slate-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Certificados SSL
        </h3>
        <button
          onClick={loadCerts}
          className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-2">
        {certs.map((cert) => {
          const daysLeft = cert.expires_at
            ? Math.floor((new Date(cert.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
            : null

          return (
            <div
              key={cert.id}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-white">{cert.domain}</h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Emitido por: {cert.issuer || 'Desconhecido'}
                  </p>
                  {cert.expires_at && (
                    <p className="text-xs text-slate-400">
                      Expira em: {new Date(cert.expires_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(cert.status, daysLeft)}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => renewCert(cert.id)}
                  className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-600"
                >
                  <RefreshCw className="h-3 w-3 inline mr-1" />
                  Renovar
                </button>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={cert.auto_renew}
                    onChange={() => toggleAutoRenew(cert.id, cert.auto_renew)}
                  />
                  Auto-renovar
                </label>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(cert.cert_path)
                    alert('Caminho copiado!')
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          )
        })}

        {certs.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <Shield className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>Nenhum certificado encontrado</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== MAIN COMPONENT ====================
const NginxVisualManager = () => {
  const [servers, setServers] = useState([])
  const [selectedServer, setSelectedServer] = useState(null)
  const [status, setStatus] = useState(null)
  const [dockerContainers, setDockerContainers] = useState([])
  const [activeTab, setActiveTab] = useState('config') // config, logs, metrics, ssl
  const [showNewServer, setShowNewServer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState(null)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [serversRes, statusRes, dockerRes] = await Promise.all([
        api.get('/api/nginx/servers'),
        api.get('/api/nginx/status'),
        api.get('/nginx/docker-containers')
      ])
      let serverList = serversRes.data.servers || []
      if (serverList.length === 0) {
        try {
          const importRes = await api.post('/api/nginx/import-configs')
          if (importRes.data?.imported?.length) {
            const refreshed = await api.get('/api/nginx/servers')
            serverList = refreshed.data.servers || []
          }
        } catch (importErr) {
          console.warn('Failed to import nginx configs:', importErr.message)
        }
      }
      setServers(serverList)
      setStatus(statusRes.data)
      setDockerContainers(dockerRes.data.containers || [])

      // Test config
      const testRes = await api.post('/api/nginx/test')
      setTestResult(testRes.data)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleSaveServer = async (form) => {
    try {
      if (selectedServer?.id) {
        await api.put(`/api/nginx/servers/${selectedServer.id}`, form)
      } else {
        const res = await api.post('/api/nginx/servers', form)
        setSelectedServer(res.data)
      }
      setShowNewServer(false)
      loadData()
      alert('Servidor salvo!')
    } catch (err) {
      alert(`Erro: ${err.response?.data?.error || err.message}`)
    }
  }

  const handleToggleServer = async (server) => {
    try {
      await api.put(`/api/nginx/servers/${server.id}`, { is_active: !server.is_active })
      loadData()
    } catch (err) {
      alert(`Erro: ${err.response?.data?.error || err.message}`)
    }
  }

  const handleDeleteServer = async (server) => {
    if (!confirm(`Deletar ${server.name}?`)) return
    try {
      await api.delete(`/api/nginx/servers/${server.id}`)
      if (selectedServer?.id === server.id) {
        setSelectedServer(null)
      }
      loadData()
    } catch (err) {
      alert(`Erro: ${err.response?.data?.error || err.message}`)
    }
  }

  const handleApplyConfig = async () => {
    if (!selectedServer?.id) return
    try {
      await api.post(`/api/nginx/servers/${selectedServer.id}/apply-config`)
      alert('Configuração aplicada!')
      loadData()
    } catch (err) {
      alert(`Erro: ${err.response?.data?.error || err.message}`)
    }
  }

  const handleReload = async () => {
    try {
      await api.post('/api/nginx/reload')
      alert('Nginx recarregado!')
      loadData()
    } catch (err) {
      alert(`Erro: ${err.response?.data?.error || err.message}`)
    }
  }

  const handleImportConfigs = async () => {
    setImporting(true)
    try {
      const result = await api.post('/api/nginx/import-configs')
      loadData()
      const importedCount = result.data?.imported?.length || 0
      alert(`Importação concluída: ${importedCount} configuração(ões)`)
    } catch (err) {
      alert(`Erro ao importar: ${err.response?.data?.error || err.message}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="h-full w-full max-w-full flex flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white flex items-center gap-2">
            <Server className="h-6 w-6" />
            Nginx Visual Manager
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Gerenciamento visual de virtual hosts, métricas e SSL
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {status?.running ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2 text-emerald-300">
              <CheckCircle className="h-4 w-4" />
              Nginx Online
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 px-4 py-2 text-rose-300">
              <XCircle className="h-4 w-4" />
              Nginx Offline
            </div>
          )}
          <button
            onClick={handleReload}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Config Warning */}
      {testResult && !testResult.valid && (
        <div className="rounded-xl border border-rose-900 bg-rose-950/70 px-4 py-3 text-sm text-rose-200 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Configuração inválida: {testResult.error}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-900 bg-rose-950/70 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        {/* Sidebar - Server List */}
        <div className="lg:col-span-3 flex flex-col gap-3 overflow-hidden">
          <button
            onClick={() => {
              setSelectedServer(null)
              setShowNewServer(true)
            }}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
          >
            <Plus className="h-4 w-4" />
            Novo Virtual Host
          </button>
          <button
            onClick={handleImportConfigs}
            disabled={importing}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {importing ? 'Importando...' : 'Importar configs do Nginx'}
          </button>

          <ServersList
            servers={servers}
            selectedServer={selectedServer}
            onSelect={(server) => {
              setSelectedServer(server)
              setShowNewServer(false)
            }}
            onToggle={handleToggleServer}
            onDelete={handleDeleteServer}
            onRefresh={loadData}
          />
        </div>

        {/* Main Panel */}
        <div className="lg:col-span-9 flex flex-col gap-4 min-h-0 overflow-hidden">
          {/* Tabs */}
          {(selectedServer || showNewServer) && (
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <button
                onClick={() => setActiveTab('config')}
                className={`flex items-center gap-2 px-4 py-2 text-sm rounded-t-lg ${
                  activeTab === 'config'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Settings className="h-4 w-4" />
                Configuração
              </button>
              {selectedServer && (
                <>
                  <button
                    onClick={() => setActiveTab('logs')}
                    className={`flex items-center gap-2 px-4 py-2 text-sm rounded-t-lg ${
                      activeTab === 'logs'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Activity className="h-4 w-4" />
                    Logs
                  </button>
                  <button
                    onClick={() => setActiveTab('metrics')}
                    className={`flex items-center gap-2 px-4 py-2 text-sm rounded-t-lg ${
                      activeTab === 'metrics'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <TrendingUp className="h-4 w-4" />
                    Métricas
                  </button>
                  <button
                    onClick={() => setActiveTab('ssl')}
                    className={`flex items-center gap-2 px-4 py-2 text-sm rounded-t-lg ${
                      activeTab === 'ssl'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Shield className="h-4 w-4" />
                    SSL
                  </button>
                </>
              )}

              {selectedServer && (
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={handleApplyConfig}
                    className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
                  >
                    <Play className="h-4 w-4" />
                    Aplicar Config
                  </button>
                  <button
                    onClick={() => handleDeleteServer(selectedServer)}
                    className="rounded-xl border border-rose-800 bg-rose-950 px-3 py-2 text-rose-200 hover:bg-rose-900"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab Content */}
          <div className="flex-1 overflow-auto">
            {(showNewServer || (selectedServer && activeTab === 'config')) && (
              <ServerForm
                server={selectedServer}
                onSave={handleSaveServer}
                onCancel={showNewServer ? () => setShowNewServer(false) : null}
                dockerContainers={dockerContainers}
              />
            )}

            {selectedServer && activeTab === 'logs' && (
              <LogsPanel serverId={selectedServer.id} />
            )}

            {selectedServer && activeTab === 'metrics' && (
              <MetricsPanel serverId={selectedServer.id} />
            )}

            {selectedServer && activeTab === 'ssl' && (
              <SSLPanel serverId={selectedServer.id} />
            )}

            {!selectedServer && !showNewServer && (
              <div className="flex items-center justify-center h-full text-slate-500">
                <div className="text-center">
                  <Server className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">Selecione um servidor</p>
                  <p className="text-sm mt-2">ou crie um novo virtual host</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default NginxVisualManager
