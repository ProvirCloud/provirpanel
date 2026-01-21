import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, Send, Database, Globe, Server, ShieldCheck } from 'lucide-react'
import api from '../services/api.js'

const defaultRoute = {
  name: '',
  method: 'GET',
  path: '/meu-endpoint',
  type: 'service',
  targetHost: '',
  targetPort: 3000,
  targetPath: '',
  targetUrl: '',
  dbHost: '',
  dbPort: 5432,
  dbName: '',
  dbUser: '',
  dbPassword: '',
  dbSsl: false,
  sqlQuery: 'select now() as server_time',
  tlsEnabled: false,
  tlsCert: '',
  tlsKey: '',
  tlsCa: '',
  tlsRejectUnauthorized: true
}

const ProvirGateway = () => {
  const [routes, setRoutes] = useState([])
  const [dockerServices, setDockerServices] = useState([])
  const [modal, setModal] = useState(null)
  const [testModal, setTestModal] = useState(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const loadRoutes = async () => {
    const response = await api.get('/gateway/routes')
    setRoutes(response.data.routes || [])
  }

  const loadDockerServices = async () => {
    const response = await api.get('/docker/services')
    setDockerServices(response.data.services || [])
  }

  useEffect(() => {
    loadRoutes()
    loadDockerServices()
  }, [])

  const postgresServices = useMemo(() => {
    return dockerServices.filter((svc) => svc.templateId === 'postgres-db')
  }, [dockerServices])

  const handleSave = async (payload) => {
    if (payload.id) {
      await api.put(`/gateway/routes/${payload.id}`, payload)
    } else {
      await api.post('/gateway/routes', payload)
    }
    setModal(null)
    loadRoutes()
  }

  const handleDelete = async (id) => {
    await api.delete(`/gateway/routes/${id}`)
    loadRoutes()
  }

  const handleTest = async (payload) => {
    setSending(true)
    setMessage('')
    try {
      const response = await api.post('/gateway/test', payload)
      setMessage(JSON.stringify(response.data.data, null, 2))
    } catch (err) {
      const status = err.response?.status
      const data = err.response?.data
      const detail = {
        status: status || 'erro',
        message: data?.message || err.message,
        response: data || null
      }
      setMessage(JSON.stringify(detail, null, 2))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Gateway</p>
          <h2 className="text-2xl font-semibold text-white">Provir Gateway</h2>
        </div>
        <button
          className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-slate-950"
          onClick={() => setModal({ ...defaultRoute })}
        >
          <Plus className="h-4 w-4 inline mr-1" /> Novo endpoint
        </button>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="space-y-2">
          {routes.length === 0 && (
            <p className="text-xs text-slate-400">Nenhum endpoint criado.</p>
          )}
          {routes.map((route) => (
            <div key={route.id} className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm text-white">
                  <span className="rounded-lg bg-slate-800 px-2 py-0.5 text-xs text-emerald-200">{route.method}</span>
                  <span className="ml-2">{route.path}</span>
                </p>
                <p className="text-xs text-slate-400">
                  {route.type === 'service' && `Service ${route.targetHost}:${route.targetPort}`}
                  {route.type === 'external' && `External ${route.targetUrl}`}
                  {route.type === 'postgres' && `Postgres ${route.dbHost}:${route.dbPort}`}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                  onClick={() => setTestModal(route)}
                >
                  <Send className="h-3 w-3 inline mr-1" /> Testar
                </button>
                <button
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                  onClick={() => setModal({ ...route })}
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  className="rounded-lg border border-rose-800 px-2 py-1 text-xs text-rose-200 hover:bg-rose-900"
                  onClick={() => handleDelete(route.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {modal && (
        <GatewayModal
          data={modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
          postgresServices={postgresServices}
        />
      )}

      {testModal && (
        <TestModal
          data={testModal}
          onClose={() => setTestModal(null)}
          onSend={handleTest}
          sending={sending}
        />
      )}

      {message && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-200 whitespace-pre-wrap">
          {message}
        </div>
      )}
    </div>
  )
}

const GatewayModal = ({ data, onClose, onSave, postgresServices }) => {
  const [form, setForm] = useState(data)

  useEffect(() => {
    setForm(data)
  }, [data])

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))
  const loadPemFile = (file, targetField) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => updateField(targetField, reader.result || '')
    reader.readAsText(file)
  }

  const fillFromService = (serviceId) => {
    const svc = postgresServices.find((item) => String(item.id) === String(serviceId))
    if (!svc) return
    const envMap = new Map((svc.envVars || []).map((env) => [env.key, env.value]))
    updateField('dbHost', svc.host || '127.0.0.1')
    updateField('dbPort', Number(svc.hostPort || 5432))
    updateField('dbName', envMap.get('POSTGRES_DB') || '')
    updateField('dbUser', envMap.get('POSTGRES_USER') || '')
    updateField('dbPassword', envMap.get('POSTGRES_PASSWORD') || '')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-slate-100">
        <h3 className="text-lg font-semibold">Endpoint</h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-slate-400">Nome</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={form.name || ''}
              onChange={(e) => updateField('name', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Metodo</label>
            <select
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={form.method || 'GET'}
              onChange={(e) => updateField('method', e.target.value)}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                <option key={method} value={method}>{method}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Path</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              value={form.path || ''}
              onChange={(e) => updateField('path', e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400">Tipo</label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={`rounded-xl px-3 py-2 text-xs ${form.type === 'service' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}
                onClick={() => updateField('type', 'service')}
              >
                <Server className="h-3 w-3 inline mr-1" /> Servico
              </button>
              <button
                className={`rounded-xl px-3 py-2 text-xs ${form.type === 'external' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}
                onClick={() => updateField('type', 'external')}
              >
                <Globe className="h-3 w-3 inline mr-1" /> Externo
              </button>
              <button
                className={`rounded-xl px-3 py-2 text-xs ${form.type === 'postgres' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}
                onClick={() => updateField('type', 'postgres')}
              >
                <Database className="h-3 w-3 inline mr-1" /> Postgres
              </button>
            </div>
          </div>

          {form.type === 'service' && (
            <>
              <div>
                <label className="text-xs text-slate-400">Host</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.targetHost || ''}
                  onChange={(e) => updateField('targetHost', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Porta</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.targetPort || 3000}
                  onChange={(e) => updateField('targetPort', parseInt(e.target.value, 10) || 3000)}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">Path destino (opcional)</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.targetPath || ''}
                  onChange={(e) => updateField('targetPath', e.target.value)}
                  placeholder="/api"
                />
              </div>
            </>
          )}

          {form.type === 'external' && (
            <>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">URL destino</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.targetUrl || ''}
                  onChange={(e) => updateField('targetUrl', e.target.value)}
                  placeholder="https://api.exemplo.com/v1/health"
                />
              </div>
            </>
          )}

          {form.type === 'postgres' && (
            <>
              {postgresServices.length > 0 && (
                <div className="col-span-2">
                  <label className="text-xs text-slate-400">Servico Postgres (Docker)</label>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                    onChange={(e) => fillFromService(e.target.value)}
                  >
                    <option value="">Selecionar</option>
                    {postgresServices.map((svc) => (
                      <option key={svc.id} value={svc.id}>
                        {svc.name} ({svc.hostPort})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-slate-400">Host</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.dbHost || ''}
                  onChange={(e) => updateField('dbHost', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Porta</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.dbPort || 5432}
                  onChange={(e) => updateField('dbPort', parseInt(e.target.value, 10) || 5432)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Database</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.dbName || ''}
                  onChange={(e) => updateField('dbName', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Usuario</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.dbUser || ''}
                  onChange={(e) => updateField('dbUser', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Senha</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  value={form.dbPassword || ''}
                  onChange={(e) => updateField('dbPassword', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">SQL (somente SELECT)</label>
                <textarea
                  className="mt-1 h-28 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
                  value={form.sqlQuery || ''}
                  onChange={(e) => updateField('sqlQuery', e.target.value)}
                />
              </div>
            </>
          )}

          <div className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!form.tlsEnabled}
              onChange={(e) => updateField('tlsEnabled', e.target.checked)}
            />
            <span className="text-xs text-slate-300">Abrir metodo com certificado (client cert)</span>
            {form.tlsEnabled && <ShieldCheck className="h-3 w-3 text-emerald-300" />}
          </div>
          {form.tlsEnabled && (
            <>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">Certificado PEM</label>
                <textarea
                  className="mt-1 h-24 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
                  value={form.tlsCert || ''}
                  onChange={(e) => updateField('tlsCert', e.target.value)}
                />
                <input
                  type="file"
                  accept=".crt,.pem"
                  className="mt-2 text-xs text-slate-300"
                  onChange={(e) => loadPemFile(e.target.files?.[0], 'tlsCert')}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">Key PEM</label>
                <textarea
                  className="mt-1 h-24 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
                  value={form.tlsKey || ''}
                  onChange={(e) => updateField('tlsKey', e.target.value)}
                />
                <input
                  type="file"
                  accept=".key,.pem"
                  className="mt-2 text-xs text-slate-300"
                  onChange={(e) => loadPemFile(e.target.files?.[0], 'tlsKey')}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">CA (opcional)</label>
                <textarea
                  className="mt-1 h-20 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
                  value={form.tlsCa || ''}
                  onChange={(e) => updateField('tlsCa', e.target.value)}
                />
                <input
                  type="file"
                  accept=".crt,.pem"
                  className="mt-2 text-xs text-slate-300"
                  onChange={(e) => loadPemFile(e.target.files?.[0], 'tlsCa')}
                />
              </div>
            </>
          )}
        </div>

        <div className="mt-5 flex gap-2 justify-end">
          <button
            onClick={() => onSave(form)}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950"
          >
            Salvar
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

const TestModal = ({ data, onClose, onSend, sending }) => {
  const [body, setBody] = useState('{}')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-slate-100">
        <h3 className="text-lg font-semibold">Testar endpoint</h3>
        <p className="mt-2 text-xs text-slate-400">
          {data.method} {data.path}
        </p>
        <textarea
          className="mt-4 h-40 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="mt-5 flex gap-2 justify-end">
          <button
            onClick={() => {
              let parsed = {}
              try {
                parsed = JSON.parse(body || '{}')
              } catch (err) {
                onSend({ id: data.id, body: {} })
                return
              }
              onSend({ id: data.id, body: parsed })
            }}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950"
            disabled={sending}
          >
            {sending ? 'Executando...' : 'Executar'}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProvirGateway
