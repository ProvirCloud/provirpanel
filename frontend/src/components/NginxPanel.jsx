import { useEffect, useState } from 'react'
import { Server, Globe, Shield, Activity, Plus, Settings, RefreshCw, Trash2, Power, CheckCircle, XCircle } from 'lucide-react'
import api from '../services/api.js'

const NginxPanel = () => {
  const [status, setStatus] = useState(null)
  const [hosts, setHosts] = useState([])
  const [certs, setCerts] = useState([])
  const [logs, setLogs] = useState([])
  const [activeTab, setActiveTab] = useState('hosts')
  const [showModal, setShowModal] = useState(null)
  const [formData, setFormData] = useState({})
  const [loading, setLoading] = useState(false)

  const loadStatus = async () => {
    try {
      const res = await api.get('/nginx/status')
      setStatus(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  const loadHosts = async () => {
    try {
      const res = await api.get('/nginx/hosts')
      setHosts(res.data.hosts || [])
    } catch (err) {
      console.error(err)
    }
  }

  const loadCerts = async () => {
    try {
      const res = await api.get('/nginx/ssl/certs')
      setCerts(res.data.certs || [])
    } catch (err) {
      console.error(err)
    }
  }

  const loadLogs = async (type = 'access') => {
    try {
      const res = await api.get(`/nginx/logs?type=${type}&lines=50`)
      setLogs(res.data.logs || [])
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadStatus()
    loadHosts()
    loadCerts()
  }, [])

  const createHost = async () => {
    setLoading(true)
    try {
      await api.post('/nginx/hosts', formData)
      await loadHosts()
      setShowModal(null)
      setFormData({})
    } catch (err) {
      alert('Erro ao criar host')
    } finally {
      setLoading(false)
    }
  }

  const toggleHost = async (filename, enabled) => {
    try {
      if (enabled) {
        await api.post(`/nginx/hosts/${filename}/disable`)
      } else {
        await api.post(`/nginx/hosts/${filename}/enable`)
      }
      await loadHosts()
    } catch (err) {
      alert('Erro ao alterar host')
    }
  }

  const deleteHost = async (filename) => {
    if (!confirm('Deletar este host?')) return
    try {
      await api.delete(`/nginx/hosts/${filename}`)
      await loadHosts()
    } catch (err) {
      alert('Erro ao deletar host')
    }
  }

  const installSSL = async () => {
    setLoading(true)
    try {
      await api.post('/nginx/ssl/install', {
        domain: formData.domain,
        email: formData.email
      })
      await loadCerts()
      setShowModal(null)
      setFormData({})
    } catch (err) {
      alert('Erro ao instalar SSL')
    } finally {
      setLoading(false)
    }
  }

  const renewSSL = async () => {
    try {
      await api.post('/nginx/ssl/renew')
      alert('Certificados renovados')
      await loadCerts()
    } catch (err) {
      alert('Erro ao renovar')
    }
  }

  const setupAutoRenew = async () => {
    try {
      await api.post('/nginx/ssl/auto-renew')
      alert('Auto-renovação configurada')
    } catch (err) {
      alert('Erro ao configurar')
    }
  }

  const reloadNginx = async () => {
    try {
      await api.post('/nginx/reload')
      alert('Nginx recarregado')
      await loadStatus()
    } catch (err) {
      alert('Erro ao recarregar')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Nginx Manager</p>
          <h2 className="text-2xl font-semibold text-white">Gerenciador Visual de Hosts</h2>
        </div>
        <div className="flex gap-2">
          {status?.running ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2 text-emerald-300">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm">Online</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 px-4 py-2 text-rose-300">
              <XCircle className="h-4 w-4" />
              <span className="text-sm">Offline</span>
            </div>
          )}
          <button
            onClick={reloadNginx}
            className="flex items-center gap-2 rounded-xl border border-blue-800 bg-blue-950 px-4 py-2 text-sm text-blue-200 hover:bg-blue-900"
          >
            <RefreshCw className="h-4 w-4" />
            Reload
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { id: 'hosts', label: 'Hosts', icon: Server },
          { id: 'ssl', label: 'SSL/TLS', icon: Shield },
          { id: 'logs', label: 'Logs', icon: Activity }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id)
              if (tab.id === 'logs') loadLogs()
            }}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs transition ${
              activeTab === tab.id
                ? 'border-blue-500/60 bg-blue-500/10 text-blue-200'
                : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-blue-500/40'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Hosts Tab */}
      {activeTab === 'hosts' && (
        <div className="space-y-4">
          <div className="flex justify-between">
            <h3 className="text-lg font-semibold text-white">Hosts Configurados</h3>
            <button
              onClick={() => setShowModal('create-host')}
              className="flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
            >
              <Plus className="h-4 w-4" />
              Novo Host
            </button>
          </div>

          <div className="grid gap-4">
            {hosts.map((host) => (
              <div key={host.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <Globe className="h-5 w-5 text-blue-400" />
                      <h4 className="text-lg font-semibold text-white">{host.serverName.join(', ')}</h4>
                      <span className={`rounded-full px-3 py-1 text-xs ${
                        host.type === 'reverse-proxy' ? 'bg-purple-500/10 text-purple-300' :
                        host.type === 'load-balancer' ? 'bg-orange-500/10 text-orange-300' :
                        host.type === 'static' ? 'bg-green-500/10 text-green-300' :
                        'bg-slate-500/10 text-slate-300'
                      }`}>
                        {host.type}
                      </span>
                      {host.ssl && (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                          <Shield className="h-3 w-3" />
                          SSL
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-slate-400">
                      <p>Porta: {host.port}</p>
                      {host.upstream && <p>Upstream: {host.upstream}</p>}
                      {host.root && <p>Root: {host.root}</p>}
                      {host.locations.length > 0 && <p>Locations: {host.locations.join(', ')}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleHost(host.configFile, host.enabled)}
                      className={`rounded-xl border px-3 py-2 text-xs transition ${
                        host.enabled
                          ? 'border-emerald-800 bg-emerald-950 text-emerald-200 hover:bg-emerald-900'
                          : 'border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900'
                      }`}
                    >
                      <Power className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => deleteHost(host.configFile)}
                      className="rounded-xl border border-rose-800 bg-rose-950 px-3 py-2 text-xs text-rose-200 hover:bg-rose-900"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {hosts.length === 0 && (
              <p className="text-center text-slate-400 py-8">Nenhum host configurado</p>
            )}
          </div>
        </div>
      )}

      {/* SSL Tab */}
      {activeTab === 'ssl' && (
        <div className="space-y-4">
          <div className="flex justify-between">
            <h3 className="text-lg font-semibold text-white">Certificados SSL</h3>
            <div className="flex gap-2">
              <button
                onClick={setupAutoRenew}
                className="flex items-center gap-2 rounded-xl border border-blue-800 bg-blue-950 px-4 py-2 text-sm text-blue-200 hover:bg-blue-900"
              >
                <Settings className="h-4 w-4" />
                Auto-Renovação
              </button>
              <button
                onClick={renewSSL}
                className="flex items-center gap-2 rounded-xl border border-emerald-800 bg-emerald-950 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-900"
              >
                <RefreshCw className="h-4 w-4" />
                Renovar Todos
              </button>
              <button
                onClick={() => setShowModal('install-ssl')}
                className="flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
              >
                <Plus className="h-4 w-4" />
                Instalar SSL
              </button>
            </div>
          </div>

          <div className="grid gap-4">
            {certs.map((cert) => (
              <div key={cert.domain} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-emerald-400" />
                      <h4 className="text-lg font-semibold text-white">{cert.domain}</h4>
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-slate-400">
                      <p>Criado: {new Date(cert.createdAt).toLocaleDateString()}</p>
                      <p>Expira: {cert.expiresAt ? new Date(cert.expiresAt).toLocaleDateString() : 'N/A'}</p>
                      <p className="text-xs text-slate-500">{cert.certPath}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {certs.length === 0 && (
              <p className="text-center text-slate-400 py-8">Nenhum certificado instalado</p>
            )}
          </div>
        </div>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          <div className="flex justify-between">
            <h3 className="text-lg font-semibold text-white">Logs do Nginx</h3>
            <div className="flex gap-2">
              <button
                onClick={() => loadLogs('access')}
                className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
              >
                Access
              </button>
              <button
                onClick={() => loadLogs('error')}
                className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
              >
                Error
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <pre className="h-96 overflow-y-auto text-xs text-slate-300 whitespace-pre-wrap">
              {logs.join('\n') || 'Nenhum log disponível'}
            </pre>
          </div>
        </div>
      )}

      {/* Modal: Create Host */}
      {showModal === 'create-host' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold text-white mb-4">Criar Novo Host</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-2">Domínios (separados por espaço)</label>
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  placeholder="example.com www.example.com"
                  onChange={(e) => setFormData({...formData, serverName: e.target.value.split(' ')})}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-2">Tipo</label>
                <select
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  onChange={(e) => setFormData({...formData, type: e.target.value})}
                >
                  <option value="reverse-proxy">Reverse Proxy</option>
                  <option value="load-balancer">Load Balancer</option>
                  <option value="static">Site Estático</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-2">Porta</label>
                <input
                  type="number"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  placeholder="80"
                  defaultValue="80"
                  onChange={(e) => setFormData({...formData, port: parseInt(e.target.value)})}
                />
              </div>

              {formData.type === 'reverse-proxy' && (
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Upstream (host:porta)</label>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                    placeholder="localhost:3000"
                    onChange={(e) => setFormData({...formData, upstream: e.target.value})}
                  />
                </div>
              )}

              {formData.type === 'static' && (
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Diretório Root</label>
                  <input
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                    placeholder="/var/www/html"
                    onChange={(e) => setFormData({...formData, root: e.target.value})}
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ssl"
                  onChange={(e) => setFormData({...formData, ssl: e.target.checked})}
                />
                <label htmlFor="ssl" className="text-sm text-slate-300">Habilitar SSL</label>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={createHost}
                disabled={loading}
                className="flex-1 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? 'Criando...' : 'Criar Host'}
              </button>
              <button
                onClick={() => {
                  setShowModal(null)
                  setFormData({})
                }}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Install SSL */}
      {showModal === 'install-ssl' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-semibold text-white mb-4">Instalar Certificado SSL</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-2">Domínio</label>
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  placeholder="example.com"
                  onChange={(e) => setFormData({...formData, domain: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-2">Email</label>
                <input
                  type="email"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  placeholder="admin@example.com"
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                />
              </div>

              <p className="text-xs text-slate-400">
                Será usado Let's Encrypt para gerar certificado gratuito
              </p>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={installSSL}
                disabled={loading}
                className="flex-1 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? 'Instalando...' : 'Instalar'}
              </button>
              <button
                onClick={() => {
                  setShowModal(null)
                  setFormData({})
                }}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default NginxPanel
