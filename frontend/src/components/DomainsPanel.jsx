import { useEffect, useState } from 'react'
import { Route, Plus, Trash2, ExternalLink, Settings } from 'lucide-react'
import api from '../services/api.js'

const DomainsPanel = () => {
  const [routes, setRoutes] = useState([])
  const [services, setServices] = useState([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [config, setConfig] = useState({ baseUrl: '', configured: true })
  const [loading, setLoading] = useState(true)
  const [createForm, setCreateForm] = useState({
    serviceId: '',
    pathPrefix: ''
  })
  const [configForm, setConfigForm] = useState({
    baseUrl: ''
  })

  const loadData = async () => {
    try {
      const [routesRes, servicesRes, configRes] = await Promise.all([
        api.get('/domains'),
        api.get('/docker/services'),
        api.get('/domains/config')
      ])
      setRoutes(routesRes.data.routes || [])
      setServices(servicesRes.data.services)
      setConfig(configRes.data)
    } catch (err) {
      console.error('Erro ao carregar dados:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreateRoute = async (e) => {
    e.preventDefault()
    try {
      await api.post('/domains', createForm)
      setShowCreateModal(false)
      setCreateForm({ serviceId: '', pathPrefix: '' })
      loadData()
    } catch (err) {
      alert(err.response?.data?.message || 'Erro ao criar rota')
    }
  }

  const handleRemoveRoute = async (routeId) => {
    if (!confirm('Remover esta rota?')) return
    try {
      await api.delete(`/domains/${routeId}`)
      loadData()
    } catch (err) {
      alert('Erro ao remover rota')
    }
  }

  const handleSaveConfig = async (e) => {
    e.preventDefault()
    try {
      await api.post('/domains/config', configForm)
      setShowConfigModal(false)
      setConfigForm({ baseUrl: '' })
      loadData()
    } catch (err) {
      alert(err.response?.data?.message || 'Erro ao salvar configuração')
    }
  }

  if (loading) {
    return <div className="p-6 text-slate-400">Carregando...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gestão de Rotas</h1>
          <p className="text-slate-400">Configure paths para seus serviços em {config.baseUrl}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowConfigModal(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            <Settings className="h-4 w-4" />
            Configurar
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4" />
            Nova Rota
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {routes.map((route) => (
          <div key={route.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300">
                  <Route className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-white">{route.pathPrefix}</h3>
                    <a
                      href={route.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                  <p className="text-sm text-slate-400">
                    Serviço: {route.serviceName} • Porta: {route.targetPort}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleRemoveRoute(route.id)}
                className="rounded-lg p-2 text-rose-400 hover:bg-rose-500/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        {routes.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center">
            <Route className="mx-auto h-12 w-12 text-slate-600" />
            <p className="mt-4 text-slate-400">Nenhuma rota configurada</p>
          </div>
        )}
      </div>

      {/* Modal Criar Rota */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-bold text-white">Nova Rota</h2>
            <form onSubmit={handleCreateRoute} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm text-slate-400">Serviço</label>
                <select
                  value={createForm.serviceId}
                  onChange={(e) => setCreateForm({ ...createForm, serviceId: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                  required
                >
                  <option value="">Selecione um serviço</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} (:{service.hostPort})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400">Path</label>
                <input
                  type="text"
                  value={createForm.pathPrefix}
                  onChange={(e) => setCreateForm({ ...createForm, pathPrefix: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                  placeholder="/app"
                  pattern="\/[a-z0-9-]+"
                  required
                />
                <p className="mt-1 text-xs text-slate-500">Exemplo: /app, /api, /dashboard</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 rounded-lg border border-slate-700 py-2 text-slate-400 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-emerald-500 py-2 text-slate-950 hover:bg-emerald-400"
                >
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Configuração */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-bold text-white">Configurar Domínio Base</h2>
            <form onSubmit={handleSaveConfig} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm text-slate-400">Domínio Base</label>
                <input
                  type="text"
                  value={configForm.baseUrl}
                  onChange={(e) => setConfigForm({ ...configForm, baseUrl: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                  placeholder="portal.exbonus.com.br"
                  required
                />
                <p className="mt-1 text-xs text-slate-500">Domínio onde os serviços serão acessíveis</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="flex-1 rounded-lg border border-slate-700 py-2 text-slate-400 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-emerald-500 py-2 text-slate-950 hover:bg-emerald-400"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default DomainsPanel