import { useEffect, useState } from 'react'
import { Server, Plus, Save, Trash2, Power, PowerOff, CheckCircle, XCircle, Copy, Zap, Shield, Box } from 'lucide-react'
import api from '../services/api.js'

const NginxPanel = () => {
  const [status, setStatus] = useState(null)
  const [configs, setConfigs] = useState([])
  const [templates, setTemplates] = useState({})
  const [dockerContainers, setDockerContainers] = useState([])
  const [certs, setCerts] = useState([])
  const [selectedConfig, setSelectedConfig] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [showSSL, setShowSSL] = useState(false)
  const [sslForm, setSSLForm] = useState({ domain: '', email: '' })
  const [error, setError] = useState('')
  const [dockerError, setDockerError] = useState('')

  const loadAll = async () => {
    try {
      const [statusRes, configsRes, templatesRes, dockerRes, certsRes] = await Promise.all([
        api.get('/nginx/status'),
        api.get('/nginx/configs'),
        api.get('/nginx/templates'),
        api.get('/nginx/docker-containers'),
        api.get('/nginx/ssl/certs')
      ])
      
      setStatus(statusRes.data)
      setConfigs(configsRes.data.configs || [])
      setTemplates(templatesRes.data.templates || {})
      setDockerContainers(dockerRes.data.containers || [])
      setDockerError(dockerRes.data.error || '')
      setCerts(certsRes.data.certs || [])
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const saveConfig = async () => {
    if (!selectedConfig || !selectedConfig.editable || !selectedConfig.readable) return
    try {
      await api.put(`/nginx/configs/${selectedConfig.name}`, { content: editContent })
      await api.post('/nginx/test')
      await api.post('/nginx/reload')
      alert('✅ Configuração salva e Nginx recarregado!')
      loadAll()
    } catch (err) {
      alert('❌ Erro: ' + (err.response?.data?.error || err.message))
    }
  }

  const createFromTemplate = async (templateName) => {
    const filename = prompt('Nome do arquivo (ex: meusite.conf):')
    if (!filename) return
    
    try {
      await api.post('/nginx/configs', {
        filename,
        content: templates[templateName]
      })
      alert('✅ Configuração criada!')
      setShowTemplates(false)
      loadAll()
    } catch (err) {
      alert('❌ Erro: ' + err.message)
    }
  }

  const toggleConfig = async (config) => {
    try {
      if (config.enabled) {
        await api.post(`/nginx/configs/${config.name}/disable`)
      } else {
        await api.post(`/nginx/configs/${config.name}/enable`)
      }
      loadAll()
    } catch (err) {
      alert('❌ Erro ao alterar status')
    }
  }

  const deleteConfig = async (config) => {
    if (!confirm(`Deletar ${config.name}?`)) return
    try {
      await api.delete(`/nginx/configs/${config.name}`)
      loadAll()
      setSelectedConfig(null)
    } catch (err) {
      alert('❌ Erro ao deletar')
    }
  }

  const installSSL = async () => {
    try {
      await api.post('/nginx/ssl/install', sslForm)
      alert('✅ SSL instalado! Atualize sua configuração para usar HTTPS.')
      setShowSSL(false)
      loadAll()
    } catch (err) {
      alert('❌ Erro: ' + err.message)
    }
  }

  const insertDockerProxy = (container) => {
    const proxyConfig = `
    location / {
        proxy_pass http://${container.ip}:${container.port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }`
    
    setEditContent(prev => prev + proxyConfig)
  }

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white flex items-center gap-2">
              <Server className="h-6 w-6" />
              Nginx Manager
            </h2>
            <p className="text-sm text-slate-400 mt-1">Editor visual de configurações com templates prontos</p>
          </div>
        <div className="flex gap-2">
          {status?.running ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2 text-emerald-300">
              <CheckCircle className="h-4 w-4" />
              Online
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 px-4 py-2 text-rose-300">
              <XCircle className="h-4 w-4" />
              Offline
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-900 bg-rose-950/70 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">
        {/* Sidebar - Lista de Configs */}
        <div className="col-span-3 flex flex-col gap-3 overflow-y-auto">
          <div className="flex gap-2">
            <button
              onClick={() => setShowTemplates(true)}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-600"
            >
              <Plus className="h-4 w-4" />
              Novo
            </button>
            <button
              onClick={() => setShowSSL(true)}
              className="flex items-center gap-2 rounded-xl border border-emerald-800 bg-emerald-950 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-900"
            >
              <Shield className="h-4 w-4" />
              SSL
            </button>
          </div>

          {configs.map((config) => (
            <div
              key={config.name}
              onClick={() => {
                setSelectedConfig(config)
                setEditContent(config.content)
              }}
              className={`rounded-xl border p-3 cursor-pointer transition ${
                selectedConfig?.name === config.name
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white truncate">{config.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleConfig(config)
                  }}
                  className={`flex-shrink-0 ${config.toggleable ? '' : 'opacity-40 cursor-not-allowed'}`}
                  disabled={!config.toggleable}
                >
                  {config.enabled ? (
                    <Power className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <PowerOff className="h-4 w-4 text-slate-500" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  config.enabled 
                    ? 'bg-emerald-500/10 text-emerald-300' 
                    : 'bg-slate-500/10 text-slate-400'
                }`}>
                  {config.enabled ? 'Ativo' : 'Inativo'}
                </span>
                <span className="text-xs text-slate-500">{config.type}</span>
                {!config.readable && (
                  <span className="text-xs text-rose-300">sem acesso</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Editor */}
        <div className="col-span-6 flex flex-col gap-3 min-h-0">
          {selectedConfig ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">{selectedConfig.name}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={saveConfig}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                      selectedConfig.editable && selectedConfig.readable
                        ? 'bg-emerald-500 hover:bg-emerald-600'
                        : 'bg-slate-700 cursor-not-allowed'
                    }`}
                    disabled={!selectedConfig.editable || !selectedConfig.readable}
                  >
                    <Save className="h-4 w-4" />
                    Salvar & Reload
                  </button>
                  <button
                    onClick={() => deleteConfig(selectedConfig)}
                    className={`flex items-center gap-2 rounded-xl border border-rose-800 px-4 py-2 text-sm ${
                      selectedConfig.deletable
                        ? 'bg-rose-950 text-rose-200 hover:bg-rose-900'
                        : 'bg-slate-800 text-slate-400 cursor-not-allowed'
                    }`}
                    disabled={!selectedConfig.deletable}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="flex-1 rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-white font-mono resize-none focus:border-blue-500 focus:outline-none"
                spellCheck={false}
                readOnly={!selectedConfig.readable}
              />
              
              {selectedConfig.error && (
                <div className="text-xs text-rose-200 bg-rose-950/70 rounded-xl p-3">
                  {selectedConfig.error}
                </div>
              )}

              <div className="text-xs text-slate-400 bg-slate-900/60 rounded-xl p-3">
                💡 <strong>Dica:</strong> Use os containers Docker à direita para inserir proxy automaticamente
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <Server className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Selecione uma configuração para editar</p>
                <p className="text-sm mt-2">ou crie uma nova usando templates</p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Direita - Docker & SSL */}
        <div className="col-span-3 flex flex-col gap-3 overflow-y-auto">
          {/* Docker Containers */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Box className="h-4 w-4" />
              Containers Docker
            </h4>
            {dockerError && (
              <div className="mb-3 rounded-lg border border-rose-900 bg-rose-950/70 px-3 py-2 text-xs text-rose-200">
                {dockerError}
              </div>
            )}
            <div className="space-y-2">
              {dockerContainers.map((container) => (
                <div
                  key={container.id}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-3"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{container.name}</p>
                      <p className="text-xs text-slate-400 truncate">{container.image}</p>
                    </div>
                    <button
                      onClick={() => insertDockerProxy(container)}
                      className="flex-shrink-0 ml-2 rounded-lg border border-blue-800 bg-blue-950 px-2 py-1 text-xs text-blue-200 hover:bg-blue-900"
                      title="Inserir proxy no editor"
                    >
                      <Zap className="h-3 w-3" />
                    </button>
                  </div>
                  {container.port && (
                    <p className="text-xs text-emerald-400">
                      {container.ip}:{container.port}
                    </p>
                  )}
                </div>
              ))}
              {dockerContainers.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">
                  Nenhum container rodando
                </p>
              )}
            </div>
          </div>

          {/* SSL Certificates */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Certificados SSL
            </h4>
            <div className="space-y-2">
              {certs.map((cert) => (
                <div
                  key={cert.domain}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-3"
                >
                  <p className="text-sm font-semibold text-white">{cert.domain}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Expira em {cert.daysLeft} dias
                  </p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(cert.certPath)
                      alert('Caminho copiado!')
                    }}
                    className="mt-2 text-xs text-blue-300 hover:underline flex items-center gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    Copiar caminho
                  </button>
                </div>
              ))}
              {certs.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">
                  Nenhum certificado
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Templates */}
      {showTemplates && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold text-white mb-4">Escolha um Template</h3>
            
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(templates).map(([name, content]) => (
                <div
                  key={name}
                  className="rounded-xl border border-slate-800 bg-slate-950 p-4 hover:border-blue-500 transition cursor-pointer"
                  onClick={() => createFromTemplate(name)}
                >
                  <h4 className="text-lg font-semibold text-white mb-2 capitalize">
                    {name.replace(/-/g, ' ')}
                  </h4>
                  <pre className="text-xs text-slate-400 overflow-hidden max-h-32">
                    {content.slice(0, 200)}...
                  </pre>
                  <button className="mt-3 w-full rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-600">
                    Usar Template
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowTemplates(false)}
              className="mt-6 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Modal: SSL */}
      {showSSL && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-semibold text-white mb-4">Instalar Certificado SSL</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-2">Domínio</label>
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  placeholder="example.com"
                  value={sslForm.domain}
                  onChange={(e) => setSSLForm({...sslForm, domain: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-2">Email</label>
                <input
                  type="email"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  placeholder="admin@example.com"
                  value={sslForm.email}
                  onChange={(e) => setSSLForm({...sslForm, email: e.target.value})}
                />
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <p className="text-xs text-blue-300">
                  ✨ Será usado Let's Encrypt (gratuito). Certifique-se que o domínio aponta para este servidor.
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={installSSL}
                className="flex-1 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
              >
                Instalar SSL
              </button>
              <button
                onClick={() => setShowSSL(false)}
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
