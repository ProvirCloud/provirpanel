import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Loader2, Plus, Save, Server, Play, CheckCircle } from 'lucide-react'
import PageHeader from '../layout/PageHeader'
import GeneratedNginxConfig from './GeneratedNginxConfig'
import NginxConfigPanel from './NginxConfigPanel'
import NginxFlowCanvas from './NginxFlowCanvas'
import SecurityRulesPanel from './SecurityRulesPanel'
import UpstreamList from './UpstreamList'
import { generateNginxConfig } from './nginxConfigGenerator'
import { parseNginxConfigToState } from './nginxConfigParser'
import {
  addUpstream,
  createInitialNginxVisualState,
  BASIC_PROXY_HEADERS,
  BASIC_WEBSOCKET_HEADERS,
  type NginxVisualState,
  type RouteConfig,
  type SelectedNode,
} from './nginxVisualConfig'
import api from '../../services/api.js'

type AvailableConfig = {
  name: string
  content: string
}

const SYSTEM_NAMES = new Set([
  'nginx', 'nginx.conf', 'default', 'default.conf',
  'fastcgi.conf', 'fastcgi_params', 'mime.types',
  'proxy_params', 'scgi_params', 'uwsgi_params',
  'koi-utf', 'koi-win', 'win-utf',
])

export default function NginxVisualFullPage() {
  const [state, setState] = useState(createInitialNginxVisualState)
  const [selected, setSelected] = useState<SelectedNode>({ kind: 'route', id: 'route-api' })
  const [availableConfigs, setAvailableConfigs] = useState<AvailableConfig[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(false)
  const [currentConfigName, setCurrentConfigName] = useState<string>('')

  const generatedConfig = useMemo(() => generateNginxConfig(state), [state])

  // Load available configs on mount
  useEffect(() => {
    setLoadingConfigs(true)
    api
      .get('/nginx/configs')
      .then((res) => {
        const raw: any[] = res.data?.configs ?? []
        const valid = raw.filter(
          (c) =>
            c.readable !== false &&
            c.type !== 'main' &&
            !SYSTEM_NAMES.has(c.name) &&
            /\bserver\s*\{/.test(c.content ?? ''),
        )
        setAvailableConfigs(valid.map((c) => ({ name: c.name, content: c.content })))
      })
      .catch(() => {})
      .finally(() => setLoadingConfigs(false))
  }, [])

  // Also support ?config=name query param (navigation from canvas or after save)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const configName = params.get('config')
    if (configName) {
      setCurrentConfigName(configName)
    }
  }, [])

  // Persist currentConfigName in URL so refresh reloads the same config
  useEffect(() => {
    if (!currentConfigName) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('config') !== currentConfigName) {
      params.set('config', currentConfigName)
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
    }
  }, [currentConfigName])

  const initialLoadDone = useRef(false)

  useEffect(() => {
    if (!currentConfigName || availableConfigs.length === 0) return
    // Only parse on initial load or when user explicitly selects a config
    if (initialLoadDone.current) return
    const found = availableConfigs.find((c) => c.name === currentConfigName)
    if (found) {
      setState(parseNginxConfigToState(found.content, found.name))
      initialLoadDone.current = true
    }
  }, [currentConfigName, availableConfigs])

  const handleLoadConfig = (name: string) => {
    if (!name) return
    const found = availableConfigs.find((c) => c.name === name)
    if (!found) return
    setCurrentConfigName(name)
    setState(parseNginxConfigToState(found.content, found.name))
    setSelected({ kind: 'domain', id: 'domain' })
  }

  const [showNewRouteModal, setShowNewRouteModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'applied' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')

  const handleAddRoute = () => {
    setShowNewRouteModal(true)
  }

  const handleCreateRoute = (route: RouteConfig) => {
    const next: NginxVisualState = { ...state, routes: [...state.routes, route] }
    setState(next)
    setSelected({ kind: 'route', id: route.id })
    setShowNewRouteModal(false)
  }

  const resolveFilename = () => {
    if (currentConfigName) return currentConfigName
    const domain = state.domain.primary.trim()
    if (!domain) return ''
    return `${domain.replace(/[^a-zA-Z0-9.-]/g, '_')}.conf`
  }

  const saveToBackend = async (filename: string, content: string, validate = false) => {
    await api.put(`/nginx/configs/${filename}`, { content, skipValidation: !validate })
    if (!currentConfigName) setCurrentConfigName(filename)
    // Update available configs list so reload works
    setAvailableConfigs((prev) => {
      const exists = prev.some((c) => c.name === filename)
      if (exists) {
        return prev.map((c) => c.name === filename ? { ...c, content } : c)
      }
      return [...prev, { name: filename, content }]
    })
  }

  const handleSaveConfig = async () => {
    const filename = resolveFilename()
    if (!filename) {
      setSaveError('Defina um domínio principal antes de salvar.')
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 4000)
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      await saveToBackend(filename, generatedConfig, false)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Erro desconhecido'
      setSaveError(`Erro ao salvar: ${msg}`)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 5000)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndApply = async () => {
    const filename = resolveFilename()
    if (!filename) {
      setSaveError('Defina um domínio principal antes de salvar.')
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 4000)
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      await saveToBackend(filename, generatedConfig, true)
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Erro desconhecido'
      setSaveError(`Erro ao salvar arquivo: ${msg}`)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 5000)
      setSaving(false)
      return
    }
    try {
      await api.post('/nginx/reload')
      setSaveStatus('applied')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Erro desconhecido'
      setSaveError(`Arquivo salvo, mas falha ao recarregar Nginx: ${msg}`)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 6000)
    } finally {
      setSaving(false)
    }
  }

  const handleAddUpstream = () => {
    const next = addUpstream(state)
    const newUp = next.upstreams[next.upstreams.length - 1]
    setState(next)
    setSelected({ kind: 'upstream', id: newUp.id })
  }

  const handleSelectRoute = (id: string) => {
    if (id) {
      setSelected({ kind: 'route', id })
    } else if (state.routes.length > 0) {
      setSelected({ kind: 'route', id: state.routes[0].id })
    } else {
      setSelected({ kind: 'domain', id: 'domain' })
    }
  }

  const activeRoutes = state.routes.filter((r) => !r.disabled).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Nginx Visual Manager"
        subtitle={`${state.domain.primary} · ${activeRoutes} rota${activeRoutes !== 1 ? 's' : ''} ativa${activeRoutes !== 1 ? 's' : ''}`}
        actions={
          <>
            {/* Config selector */}
            <div className="relative flex items-center gap-1.5 rounded-[14px] border border-white/10 bg-[rgba(10,18,34,0.7)] pl-3 pr-1 py-1">
              <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-white/45" />
              {loadingConfigs ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />
              ) : (
                <select
                  value={currentConfigName}
                  onChange={(e) => handleLoadConfig(e.target.value)}
                  className="min-w-[160px] bg-transparent text-[13px] text-white/70 outline-none cursor-pointer pr-2"
                  title="Carregar configuração existente"
                >
                  <option value="">Carregar configuração...</option>
                  {availableConfigs.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name.replace(/\.conf$/, '')}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <button
              type="button"
              onClick={handleAddUpstream}
              className="flex items-center gap-2 rounded-[14px] border border-white/10 bg-[rgba(10,18,34,0.7)] px-4 py-2 text-[13px] font-medium text-white/70 transition hover:bg-white/6 hover:text-white/90"
            >
              <Server className="h-4 w-4" />
              Novo Upstream
            </button>
            <button
              type="button"
              onClick={handleAddRoute}
              className="flex items-center gap-2 rounded-[14px] border border-[#2d4f8f]/80 bg-[linear-gradient(135deg,#1a3a72,#142d58)] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_4px_16px_rgba(30,80,200,0.22)] transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              Nova Rota
            </button>
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={saving || !state.domain.primary.trim()}
              className="flex items-center gap-2 rounded-[14px] border border-white/10 bg-[rgba(10,18,34,0.7)] px-4 py-2 text-[13px] font-medium text-white/70 transition hover:bg-white/6 hover:text-white/90 disabled:opacity-40"
              title={!state.domain.primary.trim() ? 'Defina um domínio primeiro' : 'Salvar sem recarregar o Nginx'}
            >
              <Save className="h-4 w-4" />
              Salvar
            </button>
            <button
              type="button"
              onClick={handleSaveAndApply}
              disabled={saving}
              className="flex items-center gap-2 rounded-[14px] border border-emerald-500/50 bg-[linear-gradient(135deg,#065f46,#064e3b)] px-4 py-2 text-[13px] font-semibold text-emerald-100 shadow-[0_4px_16px_rgba(16,185,129,0.2)] transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saveStatus === 'saved' || saveStatus === 'applied' ? <CheckCircle className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {saving ? 'Salvando...' : saveStatus === 'applied' ? 'Aplicado!' : saveStatus === 'saved' ? 'Salvo!' : 'Salvar e Aplicar'}
            </button>
          </>
        }
      />

      {/* Main: canvas + config panel */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_380px]">
        <NginxFlowCanvas state={state} selected={selected} onSelect={setSelected} />
        <NginxConfigPanel
          state={state}
          selected={selected}
          onChange={setState}
          onSelectRoute={handleSelectRoute}
        />
      </div>

      {/* Status bar */}
      {saveStatus === 'error' && (
        <div className="rounded-[14px] border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-[13px] text-rose-200">
          {saveError || 'Erro desconhecido.'}
        </div>
      )}
      {saveStatus === 'saved' && (
        <div className="rounded-[14px] border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[13px] text-emerald-200">
          Configuração salva com sucesso.
        </div>
      )}
      {saveStatus === 'applied' && (
        <div className="rounded-[14px] border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[13px] text-emerald-200">
          Configuração salva e Nginx recarregado com sucesso.
        </div>
      )}

      {/* Bottom row: generated config · upstreams · security */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.65fr)_minmax(300px,0.72fr)]">
        <GeneratedNginxConfig config={generatedConfig} />
        <UpstreamList
          state={state}
          selected={selected}
          onSelect={setSelected}
          onChange={setState}
        />
        <SecurityRulesPanel state={state} onChange={setState} />
      </div>

      {/* New Route Modal */}
      {showNewRouteModal && (
        <NewRouteModal
          upstreams={state.upstreams}
          onConfirm={handleCreateRoute}
          onClose={() => setShowNewRouteModal(false)}
        />
      )}
    </div>
  )
}

// ─── New Route Modal ──────────────────────────────────────────────────────────

type NewRouteModalProps = {
  upstreams: NginxVisualState['upstreams']
  onConfirm: (route: RouteConfig) => void
  onClose: () => void
}

function NewRouteModal({ upstreams, onConfirm, onClose }: NewRouteModalProps) {
  const [routeType, setRouteType] = useState<RouteConfig['type']>('proxy')
  const [path, setPath] = useState('/')
  const [upstreamId, setUpstreamId] = useState(upstreams[0]?.id || '')
  const [alias, setAlias] = useState('/var/www/html/')

  const [redirectTo, setRedirectTo] = useState('')
  const [redirectCode, setRedirectCode] = useState<301 | 302>(301)

  const routeOptions: { value: RouteConfig['type']; label: string; desc: string }[] = [
    { value: 'proxy', label: 'Proxy reverso', desc: 'Encaminha para um upstream/backend' },
    { value: 'websocket', label: 'WebSocket', desc: 'Proxy com suporte a WebSocket' },
    { value: 'redirect', label: 'Redirecionamento', desc: 'Redireciona para outro path ou URL (ex: /admin → /admin/)' },
    { value: 'static-site', label: 'Site estático', desc: 'Serve arquivos de uma pasta (SPA)' },
    { value: 'static-app', label: 'App estático', desc: 'Serve app com fallback para index.html' },
    { value: 'static-assets', label: 'Assets estáticos', desc: 'Serve assets com cache longo' },
  ]

  const handleCreate = () => {
    const id = `route-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const isProxy = routeType === 'proxy' || routeType === 'websocket'
    const isRedirect = routeType === 'redirect'
    const headers = routeType === 'websocket' ? BASIC_WEBSOCKET_HEADERS : isProxy ? BASIC_PROXY_HEADERS : []

    const route: RouteConfig = {
      id,
      path: path || '/',
      title: path || '/',
      type: routeType,
      ...(isProxy ? { upstreamId, timeouts: { connect: 5, read: 60, send: 60 }, proxyBuffering: false } : {}),
      ...(isRedirect ? { redirectTo: redirectTo || (path.endsWith('/') ? path : path + '/'), redirectCode } : {}),
      ...(!isProxy && !isRedirect ? { alias, fallback: routeType === 'static-assets' ? undefined : `${path === '/' ? '' : path}/index.html`, tryFiles: routeType === 'static-assets' ? '=404' : undefined } : {}),
      headers,
    }
    onConfirm(route)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg rounded-[20px] border border-white/10 bg-[linear-gradient(160deg,rgba(8,16,32,0.99),rgba(6,13,26,0.98))] p-6 shadow-2xl">
        <h3 className="text-[15px] font-semibold text-white mb-1">Nova Rota</h3>
        <p className="text-[12px] text-white/45 mb-5">Escolha o tipo e configure o caminho da rota</p>

        {/* Route type selection */}
        <div className="grid grid-cols-1 gap-2 mb-5">
          {routeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRouteType(opt.value)}
              className={[
                'flex items-start gap-3 rounded-[12px] border p-3 text-left transition',
                routeType === opt.value
                  ? 'border-[#3d72ff]/60 bg-[#3d72ff]/10'
                  : 'border-white/8 bg-white/2 hover:border-white/15',
              ].join(' ')}
            >
              <div className={['mt-0.5 h-3.5 w-3.5 rounded-full border-2 flex-shrink-0', routeType === opt.value ? 'border-[#3d72ff] bg-[#3d72ff]' : 'border-white/25'].join(' ')} />
              <div>
                <div className="text-[13px] font-medium text-white">{opt.label}</div>
                <div className="text-[11px] text-white/40">{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Path */}
        <div className="mb-4">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 mb-1.5">Caminho (path)</label>
          <input
            className="h-9 w-full rounded-[10px] border border-white/10 bg-[rgba(8,15,30,0.9)] px-3 text-[13px] text-white placeholder-white/25 outline-none focus:border-[#4d85ff]/60"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/api/"
          />
          <p className="mt-1 text-[10px] text-white/30">Ex: /api/ para rota independente, /admin/assets/ para sub-rota</p>
        </div>

        {/* Redirect-specific: target */}
        {routeType === 'redirect' && (
          <>
            <div className="mb-4">
              <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 mb-1.5">Destino do redirecionamento</label>
              <input
                className="h-9 w-full rounded-[10px] border border-white/10 bg-[rgba(8,15,30,0.9)] px-3 text-[13px] text-white placeholder-white/25 outline-none focus:border-[#4d85ff]/60"
                value={redirectTo}
                onChange={(e) => setRedirectTo(e.target.value)}
                placeholder={path ? (path.endsWith('/') ? path : path + '/') : '/destino/'}
              />
              <p className="mt-1 text-[10px] text-white/30">Deixe vazio para redirecionar para o mesmo path com trailing slash</p>
            </div>
            <div className="mb-4">
              <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 mb-1.5">Código HTTP</label>
              <select
                className="h-9 w-full rounded-[10px] border border-white/10 bg-[rgba(8,15,30,0.9)] px-3 text-[13px] text-white outline-none focus:border-[#4d85ff]/60 cursor-pointer"
                value={redirectCode}
                onChange={(e) => setRedirectCode(Number(e.target.value) as 301 | 302)}
              >
                <option value={301}>301 - Permanente</option>
                <option value={302}>302 - Temporário</option>
              </select>
            </div>
          </>
        )}

        {/* Proxy-specific: upstream */}
        {(routeType === 'proxy' || routeType === 'websocket') && (
          <div className="mb-4">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 mb-1.5">Upstream de destino</label>
            <select
              className="h-9 w-full rounded-[10px] border border-white/10 bg-[rgba(8,15,30,0.9)] px-3 text-[13px] text-white outline-none focus:border-[#4d85ff]/60 cursor-pointer"
              value={upstreamId}
              onChange={(e) => setUpstreamId(e.target.value)}
            >
              <option value="">— Selecionar upstream —</option>
              {upstreams.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Static-specific: alias */}
        {routeType !== 'proxy' && routeType !== 'websocket' && (
          <div className="mb-4">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38 mb-1.5">Pasta no servidor (alias)</label>
            <input
              className="h-9 w-full rounded-[10px] border border-white/10 bg-[rgba(8,15,30,0.9)] px-3 text-[13px] text-white placeholder-white/25 outline-none focus:border-[#4d85ff]/60"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="/var/www/html/"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t border-white/6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-white/10 px-4 py-2 text-[13px] text-white/60 hover:text-white/80 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!path.trim()}
            className="flex items-center gap-2 rounded-[10px] border border-[#2d4f8f]/80 bg-[linear-gradient(135deg,#1a3a72,#142d58)] px-5 py-2 text-[13px] font-semibold text-white shadow-[0_4px_16px_rgba(30,80,200,0.22)] transition hover:brightness-110 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            Criar Rota
          </button>
        </div>
      </div>
    </div>
  )
}
