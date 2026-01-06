import { useEffect, useMemo, useState } from 'react'
import {
  Play,
  Square,
  RefreshCw,
  Trash2,
  Plus,
  TerminalSquare,
  Layers
} from 'lucide-react'
import api from '../services/api.js'
import { createDockerLogsSocket, createDockerProgressSocket } from '../services/socket.js'

const presetImages = [
  { name: 'PostgreSQL', image: 'postgres', tag: '16', description: 'Banco relacional' },
  { name: 'MySQL', image: 'mysql', tag: '8', description: 'Banco relacional' },
  { name: 'Redis', image: 'redis', tag: '7', description: 'Cache em memoria' },
  { name: 'Nginx', image: 'nginx', tag: 'latest', description: 'Proxy reverso' },
  { name: 'Node.js', image: 'node', tag: '20', description: 'Runtime JS' }
]

const Toast = ({ message, type, onClose }) => (
  <div
    className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
      type === 'error'
        ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    }`}
  >
    <span>{message}</span>
    <button className="text-xs text-slate-300 hover:text-white" onClick={onClose}>
      fechar
    </button>
  </div>
)

const DockerPanel = () => {
  const [activeTab, setActiveTab] = useState('services')
  const [containers, setContainers] = useState([])
  const [stats, setStats] = useState({})
  const [selectedContainer, setSelectedContainer] = useState(null)
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(false)
  const [wizard, setWizard] = useState(null)
  const [configText, setConfigText] = useState('{\n  "name": "app-01",\n  "HostConfig": {}\n}')
  const [templates, setTemplates] = useState([])
  const [services, setServices] = useState([])
  const [networks, setNetworks] = useState([])
  const [toasts, setToasts] = useState([])
  const [serviceForm, setServiceForm] = useState(null)
  const [serviceProgress, setServiceProgress] = useState([])
  const [serviceWorking, setServiceWorking] = useState(false)
  const [portAvailability, setPortAvailability] = useState(null)
  const [baseDir, setBaseDir] = useState('')
  const [editDialog, setEditDialog] = useState(null)
  const [removeDialog, setRemoveDialog] = useState(null)
  const [postgresDatabases, setPostgresDatabases] = useState([])
  const token = localStorage.getItem('token')
  const socket = useMemo(() => createDockerLogsSocket(token), [token])
  const progressSocket = useMemo(() => createDockerProgressSocket(token), [token])

  const validateServiceName = (name) => {
    if (!name || typeof name !== 'string') {
      return 'Nome do serviço é obrigatório';
    }
    if (name.length < 2 || name.length > 50) {
      return 'Nome deve ter entre 2 e 50 caracteres';
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return 'Nome pode conter apenas letras, números, _ e -';
    }
    if (services.some(s => s.name === name)) {
      return 'Já existe um serviço com este nome';
    }
    return null;
  };

  const addToast = (message, type = 'success') => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 4000)
  }

  const loadContainers = async () => {
    setLoading(true)
    try {
      const response = await api.get('/docker/containers')
      setContainers(response.data.containers || [])
    } catch (err) {
      addToast('Erro ao carregar containers', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadTemplates = async () => {
    try {
      const response = await api.get('/docker/templates')
      setTemplates(response.data.templates || [])
      setBaseDir(response.data.baseDir || '')
    } catch (err) {
      addToast('Erro ao carregar templates', 'error')
    }
  }

  const loadNetworks = async () => {
    try {
      const response = await api.get('/docker/networks')
      setNetworks(response.data.networks || [])
    } catch (err) {
      addToast('Erro ao carregar redes', 'error')
    }
  }

  const loadServices = async () => {
    try {
      const response = await api.get('/docker/services')
      console.log('Services loaded:', response.data.services) // Debug
      setServices(response.data.services || [])
    } catch (err) {
      console.error('Error loading services:', err) // Debug
      addToast('Erro ao carregar servicos', 'error')
    }
  }

  const loadPostgresDatabases = async () => {
    try {
      const response = await api.get('/docker/postgres-databases')
      setPostgresDatabases(response.data.databases || [])
    } catch (err) {
      console.error('Error loading postgres databases:', err)
    }
  }

  const loadStats = async (containerId) => {
    try {
      const response = await api.get(`/docker/containers/${containerId}/stats`)
      setStats((prev) => ({ ...prev, [containerId]: response.data.stats }))
    } catch (err) {
      addToast('Erro ao carregar stats', 'error')
    }
  }

  useEffect(() => {
    loadContainers()
    loadTemplates()
    loadServices()
    loadNetworks()
    loadPostgresDatabases()
  }, [])

  useEffect(() => {
    if (!wizard) {
      setServiceForm(null)
      setServiceProgress([])
      setServiceWorking(false)
      setPortAvailability(null)
      return
    }

    const template = templates.find((t) => t.id === wizard.id || t.id === wizard.templateId)
    const tpl = template || wizard

    setServiceForm({
      name: tpl?.label ? tpl.label.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() : 'service-1',
      hostPort: '', // Iniciar com porta vazia
      volumes:
        tpl?.volumes?.map((v) => ({
          hostPath: v.hostPath || (baseDir ? `${baseDir}/${tpl?.label ? tpl.label.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() : 'service'}` : ''),
          containerPath: v.containerPath
        })) || [],
      envs: tpl?.env?.map((e) => ({ key: e.key, value: e.value })) || [],
      createProject: false,
      createManager: false,
      configureDb: null,
      networkName: 'bridge'
    })
    
    // Scroll para o wizard quando aberto
    if (wizard) {
      setTimeout(() => {
        const wizardElement = document.querySelector('.wizard-container')
        if (wizardElement) {
          wizardElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100)
    }
  }, [wizard, templates, baseDir])

  useEffect(() => {
    if (!serviceForm?.hostPort || serviceForm.hostPort === '') {
      setPortAvailability(null)
      return
    }
    const port = Number(serviceForm.hostPort)
    if (!port) return
    
    // Verificar se a porta está disponível
    Promise.all([
      api.get('/docker/containers').then(res => {
        const containers = res.data.containers || []
        const usedPorts = []
        containers.forEach(container => {
          (container.Ports || []).forEach(portInfo => {
            if (portInfo.PublicPort) {
              usedPorts.push(portInfo.PublicPort)
            }
          })
        })
        return !usedPorts.includes(port)
      }),
      fetch(`http://localhost:${port}`).then(() => false).catch(() => true)
    ]).then(([dockerFree, systemFree]) => {
      setPortAvailability(dockerFree && systemFree)
    }).catch(() => setPortAvailability(null))
  }, [serviceForm?.hostPort])

  useEffect(() => {
    if (!progressSocket) {
      return undefined
    }

    const handleProgress = (payload) => {
      if (payload.message) {
        setServiceProgress((prev) => [...prev, payload.message])
      }
    }

    progressSocket.on('progress', handleProgress)

    return () => {
      progressSocket.off('progress', handleProgress)
      progressSocket.disconnect()
    }
  }, [progressSocket])

  useEffect(() => {
    if (!socket) {
      return undefined
    }

    const handleLog = (payload) => {
      setLogs((prev) => `${prev}${payload.data}`)
    }

    socket.on('log', handleLog)
    socket.on('error', (payload) => addToast(payload.message, 'error'))
    socket.on('end', () => addToast('Log finalizado'))

    return () => {
      socket.off('log', handleLog)
      socket.disconnect()
    }
  }, [socket])

  const handleAction = async (action, id) => {
    try {
      if (action === 'start') {
        await api.post(`/docker/containers/${id}/restart`)
      }
      if (action === 'stop') {
        await api.post(`/docker/containers/${id}/stop`)
      }
      if (action === 'restart') {
        await api.post(`/docker/containers/${id}/restart`)
      }
      if (action === 'delete') {
        await api.delete(`/docker/containers/${id}`)
      }
      addToast('Operacao concluida')
      loadContainers()
    } catch (err) {
      addToast('Erro na operacao', 'error')
    }
  }

  const openLogs = async (container) => {
    setSelectedContainer(container)
    setLogs('')
    if (socket) {
      socket.emit('subscribe', { containerId: container.Id, tail: 200 })
    }
    await loadStats(container.Id)
  }

  const pullImage = async (imageName) => {
    try {
      await api.post('/docker/images/pull', { imageName })
      addToast('Imagem baixada')
    } catch (err) {
      addToast('Erro ao baixar imagem', 'error')
    }
  }

  const updateService = async (serviceId, config) => {
    try {
      await api.put(`/docker/services/${serviceId}`, config)
      addToast('Serviço atualizado')
      loadServices()
      loadContainers()
    } catch (err) {
      addToast('Erro ao atualizar serviço', 'error')
    }
  }

  const removeService = async (serviceId, removeFolder = false) => {
    try {
      await api.delete(`/docker/services/${serviceId}`, {
        data: { removeFolder }
      })
      addToast('Serviço removido')
      loadServices()
      loadContainers()
    } catch (err) {
      addToast('Erro ao remover serviço', 'error')
    }
  }

  const createService = async (template, form) => {
    // Validate service name before sending to backend
    const nameError = validateServiceName(form.name);
    if (nameError) {
      addToast(nameError, 'error');
      return;
    }

    // Prevent multiple submissions
    if (serviceWorking) {
      return;
    }

    setServiceWorking(true)
    setServiceProgress([`Iniciando criação do serviço ${form.name}...`])
    
    const timeoutId = setTimeout(() => {
      setServiceProgress(prev => [...prev, '⚠️ Operação demorou mais que o esperado. Verifique os logs do Docker.']);
    }, 30000); // 30 second warning
    
    try {
      const response = await api.post('/docker/services', {
        templateId: template.id,
        name: form.name,
        hostPort: form.hostPort,
        volumeMappings: form.volumes,
        envVars: form.envs,
        createProject: form.createProject,
        createManager: form.createManager,
        configureDb: form.configureDb,
        networkName: form.networkName
      }, {
        timeout: 120000 // 2 minute timeout
      })
      
      clearTimeout(timeoutId);
      
      const progress = response.data.progress || []
      if (progress.length) {
        setServiceProgress(progress)
      }
      setServiceProgress((prev) => [...prev, '✅ Serviço criado com sucesso.'])
      addToast(`Serviço criado: ${response.data.service?.name}`)
      loadContainers()
      loadServices()
      
      // Close wizard on success
      setTimeout(() => {
        setWizard(null)
      }, 2000)
    } catch (err) {
      clearTimeout(timeoutId);
      
      const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
      const apiMessage = isTimeout 
        ? 'Timeout: Operação demorou muito. Verifique se o Docker está funcionando.'
        : err.response?.data?.message || err.message || 'Erro ao criar serviço';
      
      const apiProgress = err.response?.data?.progress || [];
      setServiceProgress((prev) => [...prev, `❌ ${apiMessage}`, ...apiProgress]);
      addToast(apiMessage, 'error');
    } finally {
      setServiceWorking(false)
    }
  }

  const renderServiceWizard = () => {
    if (!wizard || !serviceForm) return null

    const template = templates.find((t) => t.id === wizard.id || t.id === wizard.templateId)
    const tpl = template || wizard

    console.log('ServiceForm:', serviceForm) // Debug
    console.log('Template:', tpl) // Debug

    return (
      <div className="wizard-container rounded-2xl border border-blue-500/30 bg-blue-500/10 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-blue-200">Wizard</p>
            <p className="text-lg font-semibold text-white">Criar serviço: {tpl?.label}</p>
            <p className="text-xs text-slate-300">Imagem: {tpl?.image}:{tpl?.tag}</p>
          </div>
          <button className="text-xs text-slate-200" onClick={() => setWizard(null)}>
            fechar
          </button>
        </div>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-2">
            <label className="text-xs text-slate-300">Nome do serviço</label>
            <input
              className={`rounded-xl border px-3 py-2 text-sm text-white ${
                validateServiceName(serviceForm.name) 
                  ? 'border-rose-500 bg-rose-500/10' 
                  : 'border-slate-800 bg-slate-950'
              }`}
              value={serviceForm.name}
              onChange={(e) => {
                const newName = e.target.value;
                setServiceForm((p) => ({
                  ...p, 
                  name: newName,
                  volumes: p.volumes.map((v) => ({
                    ...v,
                    hostPath: v.hostPath && baseDir ? `${baseDir}/${newName}` : v.hostPath
                  }))
                }));
              }}
            />
            <p className="text-xs text-slate-400">
              Apenas letras, números, _ e - são permitidos. Sem acentos, espaços ou pontuação.
            </p>
            {validateServiceName(serviceForm.name) && (
              <p className="text-xs text-rose-300">
                {validateServiceName(serviceForm.name)}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <label className="text-xs text-slate-300">Porta externa → interna</label>
            <div className="flex items-center gap-2">
              <input
                className="w-28 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="Auto"
                value={serviceForm.hostPort}
                onChange={(e) => setServiceForm((p) => ({ ...p, hostPort: e.target.value }))}
              />
              <span className="text-slate-300 text-sm">→ {tpl?.containerPort || 80}</span>
              {serviceForm.hostPort && portAvailability != null && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                    portAvailability
                      ? 'bg-emerald-500/10 text-emerald-200'
                      : 'bg-rose-500/10 text-rose-200'
                  }`}
                >
                  {portAvailability ? 'Porta livre' : 'Porta em uso'}
                </span>
              )}
              <button
                className="rounded-xl border border-blue-800 bg-blue-950 px-3 py-2 text-xs text-blue-200 hover:bg-blue-900"
                onClick={async () => {
                  try {
                    const response = await api.get('/docker/available-port', { 
                      params: { start: tpl?.defaultPort || 3000 } 
                    })
                    const available = response.data?.available
                    if (available) {
                      setServiceForm((p) => ({ ...p, hostPort: String(available) }))
                    }
                  } catch (err) {
                    addToast('Erro ao buscar porta', 'error')
                  }
                }}
              >
                Sugerir
              </button>
            </div>
            <p className="text-xs text-slate-400">
              {serviceForm.hostPort 
                ? `URL de teste: http://localhost:${serviceForm.hostPort}`
                : 'Deixe vazio para seleção automática de porta'
              }
            </p>
          </div>

          <div className="grid gap-2">
            <label className="text-xs text-slate-300">Rede Docker</label>
            <select
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
              value={serviceForm.networkName}
              onChange={(e) => setServiceForm((p) => ({ ...p, networkName: e.target.value }))}
            >
              <option value="bridge">bridge (padrão - containers isolados)</option>
              <option value="host">host (compartilha rede do host)</option>
              {networks.filter(n => !['bridge', 'host', 'none'].includes(n.name)).map(network => (
                <option key={network.id} value={network.name}>
                  {network.name} (rede customizada)
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400">
              📌 Serviços na mesma rede podem se comunicar diretamente pelo nome do container
            </p>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-300">Volumes (opcional)</label>
              <button
                className="text-xs text-blue-300 underline"
                onClick={() => setServiceForm((p) => ({
                  ...p,
                  volumes: [...p.volumes, { hostPath: '', containerPath: '' }]
                }))}
              >
                + Adicionar volume
              </button>
            </div>
            {serviceForm.volumes.length === 0 && (
              <p className="text-xs text-slate-400">Nenhum volume configurado. Container usará apenas armazenamento efêmero.</p>
            )}
            {(serviceForm.volumes || []).map((vol, idx) => (
              <div key={idx} className="flex flex-wrap gap-2">
                <input
                  className="flex-1 min-w-[240px] rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="/Users/seunome/projeto (macOS)"
                  value={vol.hostPath}
                  onChange={(e) => {
                    const next = [...serviceForm.volumes]
                    next[idx].hostPath = e.target.value
                    setServiceForm((p) => ({ ...p, volumes: next }))
                  }}
                />
                <input
                  className="flex-1 min-w-[220px] rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="/caminho/container"
                  value={vol.containerPath}
                  onChange={(e) => {
                    const next = [...serviceForm.volumes]
                    next[idx].containerPath = e.target.value
                    setServiceForm((p) => ({ ...p, volumes: next }))
                  }}
                />
                <button
                  className="rounded-xl border border-rose-800 bg-rose-950 px-3 py-2 text-xs text-rose-200 hover:bg-rose-900"
                  onClick={() => {
                    const next = serviceForm.volumes.filter((_, i) => i !== idx)
                    setServiceForm((p) => ({ ...p, volumes: next }))
                  }}
                >
                  Remover
                </button>
              </div>
            ))}
            {serviceForm.volumes.length > 0 && (
              <p className="text-[11px] text-amber-300">⚠️ macOS: Use caminhos dentro de /Users. Configure em Docker → Preferences → Resources → File Sharing</p>
            )}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-300">Variáveis de ambiente</label>
              <button
                className="text-xs text-blue-300 underline"
                onClick={() => setServiceForm((p) => ({
                  ...p,
                  envs: [...p.envs, { key: '', value: '' }]
                }))}
              >
                + Adicionar variável
              </button>
            </div>
            {(serviceForm.envs || []).map((env, idx) => (
              <div key={idx} className="flex flex-wrap gap-2">
                <input
                  className="w-40 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="KEY"
                  value={env.key}
                  onChange={(e) => {
                    const next = [...serviceForm.envs]
                    next[idx].key = e.target.value
                    setServiceForm((p) => ({ ...p, envs: next }))
                  }}
                />
                <input
                  className="flex-1 min-w-[200px] rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
                  placeholder="value"
                  value={env.value}
                  onChange={(e) => {
                    const next = [...serviceForm.envs]
                    next[idx].value = e.target.value
                    setServiceForm((p) => ({ ...p, envs: next }))
                  }}
                />
                <button
                  className="rounded-xl border border-rose-800 bg-rose-950 px-3 py-2 text-xs text-rose-200 hover:bg-rose-900"
                  onClick={() => {
                    const next = serviceForm.envs.filter((_, i) => i !== idx)
                    setServiceForm((p) => ({ ...p, envs: next }))
                  }}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <label className="text-sm font-semibold text-blue-200">
                  {tpl?.hasProjectOption !== false ? '🚀 Criar projeto exemplo' : '🔧 Opções adicionais'}
                </label>
                <p className="text-xs text-blue-300/80 mt-1">
                  {tpl?.hasProjectOption !== false 
                    ? 'Inclui código inicial pronto para usar'
                    : tpl?.managerLabel || 'Opções especiais para este serviço'
                  }
                </p>
              </div>
              {tpl?.hasProjectOption !== false && (
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={serviceForm.createProject || false}
                    onChange={(e) => setServiceForm((p) => ({ ...p, createProject: e.target.checked }))}
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                </label>
              )}
            </div>
            
            {tpl?.hasProjectOption !== false && (
              <div className={`text-xs transition-colors mb-3 ${
                serviceForm.createProject 
                  ? 'text-emerald-300'
                  : 'text-slate-400'
              }`}>
                {serviceForm.createProject 
                  ? '✅ Será criado um projeto exemplo com código inicial, dependências e documentação'
                  : '📦 Apenas o container será criado, sem arquivos de exemplo'
                }
              </div>
            )}
            
            {tpl?.hasManagerOption && (
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-semibold text-emerald-200">
                    {tpl.managerLabel || 'Instalar gerenciador'}
                  </label>
                  <p className="text-xs text-emerald-300/80 mt-1">
                    Interface web para gerenciar o banco de dados
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={serviceForm.createManager || false}
                    onChange={(e) => setServiceForm((p) => ({ ...p, createManager: e.target.checked }))}
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
            )}
            
            {tpl?.hasDbConfigOption && postgresDatabases.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <label className="text-sm font-semibold text-purple-200">
                      {tpl.dbConfigLabel || 'Configurar para banco existente'}
                    </label>
                    <p className="text-xs text-purple-300/80 mt-1">
                      Conectar automaticamente a um banco PostgreSQL
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={!!serviceForm.configureDb}
                      onChange={(e) => setServiceForm((p) => ({ 
                        ...p, 
                        configureDb: e.target.checked ? (postgresDatabases[0]?.id || null) : null 
                      }))}
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                  </label>
                </div>
                
                {serviceForm.configureDb && (
                  <div className="space-y-2">
                    <select
                      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      value={serviceForm.configureDb || ''}
                      onChange={(e) => setServiceForm((p) => ({ ...p, configureDb: e.target.value }))}
                    >
                      {postgresDatabases.map(db => (
                        <option key={db.id} value={db.id}>
                          {db.name} (porta {db.hostPort})
                        </option>
                      ))}
                    </select>
                    <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-500/10">
                      <p className="text-xs text-purple-300 flex items-center gap-2">
                        <span>✅</span>
                        pgAdmin será configurado automaticamente para este banco
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {tpl?.hasDbConfigOption && postgresDatabases.length === 0 && (
              <div className="mb-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
                <p className="text-xs text-amber-300 flex items-center gap-2">
                  <span>⚠️</span>
                  Nenhum banco PostgreSQL encontrado. Crie um primeiro.
                </p>
              </div>
            )}
            
            {tpl?.hasManagerOption && (
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-semibold text-emerald-200">
                    {tpl.managerLabel || 'Instalar gerenciador'}
                  </label>
                  <p className="text-xs text-emerald-300/80 mt-1">
                    Interface web para gerenciar o banco de dados
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={serviceForm.createManager || false}
                    onChange={(e) => setServiceForm((p) => ({ ...p, createManager: e.target.checked }))}
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
            )}
            
            {serviceForm.createManager && tpl?.hasManagerOption && (
              <div className="mt-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                <p className="text-xs text-emerald-300 flex items-center gap-2">
                  <span>✅</span>
                  Será criado pgAdmin na porta 8080 (ou próxima disponível)
                </p>
                <p className="text-xs text-emerald-400 mt-1">
                  Login: admin@admin.com | Senha: admin
                </p>
              </div>
            )}
            
            {serviceForm.createProject && serviceForm.volumes.length === 0 && tpl?.hasProjectOption !== false && (
              <div className="mt-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
                <p className="text-xs text-amber-300 flex items-center gap-2">
                  <span>⚠️</span>
                  Para criar projeto exemplo, adicione pelo menos um volume
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                serviceWorking || validateServiceName(serviceForm.name)
                  ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-500 text-slate-950 hover:bg-blue-400'
              }`}
              onClick={() => tpl && !serviceWorking && !validateServiceName(serviceForm.name) && createService(tpl, serviceForm)}
              disabled={serviceWorking || validateServiceName(serviceForm.name)}
            >
              {serviceWorking ? 'Criando...' : 'Criar serviço'}
            </button>
            <button
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200"
              onClick={() => setWizard(null)}
            >
              Cancelar
            </button>
          </div>

          {serviceProgress.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-200">
              <div className="flex items-center justify-between pb-2">
                <span className="font-semibold text-slate-100">Progresso / Logs ({serviceProgress.length} linhas)</span>
                <button
                  className="text-[11px] text-blue-300 underline"
                  onClick={() => navigator.clipboard.writeText(serviceProgress.join('\n'))}
                >
                  Copiar tudo
                </button>
              </div>
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5">{serviceProgress.slice(-50).join('\n')}</pre>
              {serviceProgress.length > 50 && (
                <p className="pt-2 text-[10px] text-slate-400">Mostrando últimas 50 linhas de {serviceProgress.length}</p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Docker</p>
          <h2 className="text-2xl font-semibold text-white">Gerenciamento de containers</h2>
        </div>
        {activeTab === 'containers' && (
          <button
            className="flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-blue-400"
            onClick={() => setWizard({ image: 'nginx', tag: 'latest' })}
          >
            <Plus className="h-4 w-4" />
            New Container
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {[
          { id: 'services', label: 'Serviços', icon: TerminalSquare },
          { id: 'containers', label: 'Containers', icon: TerminalSquare },
          { id: 'images', label: 'Imagens', icon: Layers }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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

      {activeTab === 'services' && (
        <div className="grid gap-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Serviços</p>
              <h3 className="text-xl font-semibold text-white">Plug & Play</h3>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 md:grid-cols-2">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-semibold text-white">{tpl.label}</p>
                    <p className="text-xs text-slate-400">{tpl.description}</p>
                  </div>
                  <span className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-blue-200">
                    {tpl.image}:{tpl.tag}
                  </span>
                </div>
                <div className="mt-3 text-xs text-slate-300 space-y-1">
                  <p>Porta sugerida: {tpl.defaultPort} → {tpl.containerPort}</p>
                  {tpl.volumes?.map((v) => (
                    <p key={v.containerPath}>Volume: {v.hostPath} → {v.containerPath}</p>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-blue-400"
                    onClick={() => setWizard(tpl)}
                  >
                    Configurar & Rodar
                  </button>
                  <button
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                    onClick={() => pullImage(tpl.image)}
                  >
                    Baixar imagem
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Serviços criados</p>
            <div className="mt-3 grid gap-3">
              {services.length === 0 && (
                <p className="text-sm text-slate-400">Nenhum serviço criado ainda.</p>
              )}
              {services.map((svc) => {
                const managerService = services.find(s => s.parentService === svc.id);
                return (
                  <div
                    key={svc.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-lg font-semibold text-white">{svc.name}</p>
                        <p className="text-xs text-slate-400">
                          {svc.image} • Porta {svc.hostPort} → {svc.containerPort} • Rede: {svc.networkName || 'bridge'}
                          {svc.hasProject && ' • 📁 Com projeto exemplo'}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          <a
                            className="text-xs text-blue-300 underline"
                            href={svc.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            localhost:{svc.hostPort}
                          </a>
                          {svc.serverIP && svc.serverIP !== 'localhost' && (
                            <a
                              className="text-xs text-emerald-300 underline"
                              href={svc.externalUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {svc.serverIP}:{svc.hostPort}
                            </a>
                          )}
                        </div>
                        {managerService && (
                          <div className="mt-2 p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                            <p className="text-xs text-emerald-300 font-semibold">🔧 pgAdmin disponível:</p>
                            <div className="flex flex-wrap gap-2 mt-1">
                              <a
                                className="text-xs text-emerald-300 underline"
                                href={managerService.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                localhost:{managerService.hostPort}
                              </a>
                              {managerService.serverIP && managerService.serverIP !== 'localhost' && (
                                <a
                                  className="text-xs text-emerald-400 underline"
                                  href={managerService.externalUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {managerService.serverIP}:{managerService.hostPort}
                                </a>
                              )}
                            </div>
                            <p className="text-xs text-emerald-400 mt-1">
                              Login: {managerService.credentials?.email} | Senha: {managerService.credentials?.password}
                            </p>
                            {managerService.dbConnection && (
                              <p className="text-xs text-slate-300 mt-1">
                                Host: {managerService.dbConnection.host}:{managerService.dbConnection.port} | DB: {managerService.dbConnection.database}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-slate-300">
                        <p>Container: {svc.containerId?.slice(0, 12)}</p>
                        <p>Volumes: {svc.volumes?.length || 0}</p>
                        {managerService && (
                          <p className="text-emerald-300">+ pgAdmin</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="rounded-xl border border-blue-800 bg-blue-950 px-3 py-2 text-xs text-blue-200 hover:bg-blue-900"
                          onClick={() => setEditDialog({ ...svc, newEnvVars: [] })}
                        >
                          Editar
                        </button>
                        <button
                          className="rounded-xl border border-rose-800 bg-rose-950 px-3 py-2 text-xs text-rose-200 hover:bg-rose-900"
                          onClick={() => setRemoveDialog(svc)}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'containers' && (
        <div className="grid gap-4">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
            <table className="w-full text-left text-sm text-slate-200">
              <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">CPU</th>
                  <th className="px-4 py-3">RAM</th>
                  <th className="px-4 py-3">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((container) => {
                  const name = container.Names?.[0]?.replace('/', '') || container.Id.slice(0, 8)
                  const running = container.State === 'running'
                  const containerStats = stats[container.Id]
                  return (
                    <tr
                      key={container.Id}
                      className="cursor-pointer border-t border-slate-800 hover:bg-slate-900/40"
                      onClick={() => openLogs(container)}
                    >
                      <td className="px-4 py-3">{name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${
                            running
                              ? 'bg-emerald-500/10 text-emerald-300'
                              : 'bg-rose-500/10 text-rose-300'
                          }`}
                        >
                          {container.State}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-blue-200">
                        {containerStats?.cpuPercent ?? '—'}%
                      </td>
                      <td className="px-4 py-3 text-blue-200">
                        {containerStats?.memoryUsage
                          ? `${Math.round(containerStats.memoryUsage / 1024 / 1024)} MB`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-200 transition hover:text-emerald-300"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleAction('start', container.Id)
                            }}
                          >
                            <Play className="h-4 w-4" />
                          </button>
                          <button
                            className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-200 transition hover:text-amber-300"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleAction('stop', container.Id)
                            }}
                          >
                            <Square className="h-4 w-4" />
                          </button>
                          <button
                            className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-200 transition hover:text-sky-300"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleAction('restart', container.Id)
                            }}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </button>
                          <button
                            className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-200 transition hover:text-rose-300"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleAction('delete', container.Id)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {containers.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={5}>
                      {loading ? 'Carregando...' : 'Nenhum container encontrado'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedContainer && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Logs</p>
                  <p className="text-lg font-semibold text-white">
                    {selectedContainer.Names?.[0]?.replace('/', '') || selectedContainer.Id}
                  </p>
                </div>
                <button
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-200"
                  onClick={() => setLogs('')}
                >
                  Limpar
                </button>
              </div>
              <div className="h-64 overflow-y-auto rounded-xl bg-black/80 p-4 text-xs text-emerald-200">
                <pre className="mono whitespace-pre-wrap">{logs || 'Aguardando logs...'}</pre>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'images' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {presetImages.map((image) => (
            <div
              key={image.name}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-white">{image.name}</p>
                  <p className="text-xs text-slate-400">{image.description}</p>
                </div>
                <span className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-blue-200">
                  {image.image}:{image.tag}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
                  onClick={() => pullImage(image.image)}
                >
                  Pull Image
                </button>
                <button
                  className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-blue-400"
                  onClick={() => setWizard(image)}
                >
                  Rodar container
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {renderServiceWizard()}

      {editDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">⚙️ Editar Serviço</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-2">Porta Externa</label>
                <input
                  type="number"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  defaultValue={editDialog.hostPort}
                  onChange={(e) => setEditDialog(prev => ({ ...prev, newHostPort: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2">Rede Docker</label>
                <select
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  defaultValue={editDialog.networkName || 'bridge'}
                  onChange={(e) => setEditDialog(prev => ({ ...prev, newNetworkName: e.target.value }))}
                >
                  <option value="bridge">bridge (padrão - isolado)</option>
                  <option value="host">host (compartilha rede do host)</option>
                  {networks.filter(n => !['bridge', 'host', 'none'].includes(n.name)).map(network => (
                    <option key={network.id} value={network.name}>
                      {network.name} (customizada)
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  📌 Serviços na mesma rede podem se comunicar pelo nome
                </p>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2">Variáveis de Ambiente</label>
                <div className="space-y-2">
                  {(editDialog.newEnvVars || []).map((env, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                        placeholder="CHAVE"
                        value={env.key}
                        onChange={(e) => {
                          const newEnvs = [...(editDialog.newEnvVars || [])];
                          newEnvs[idx].key = e.target.value;
                          setEditDialog(prev => ({ ...prev, newEnvVars: newEnvs }));
                        }}
                      />
                      <input
                        className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                        placeholder="valor"
                        value={env.value}
                        onChange={(e) => {
                          const newEnvs = [...(editDialog.newEnvVars || [])];
                          newEnvs[idx].value = e.target.value;
                          setEditDialog(prev => ({ ...prev, newEnvVars: newEnvs }));
                        }}
                      />
                      <button
                        className="rounded-xl border border-rose-700 bg-rose-800 px-3 py-2 text-xs text-rose-200"
                        onClick={() => {
                          const newEnvs = (editDialog.newEnvVars || []).filter((_, i) => i !== idx);
                          setEditDialog(prev => ({ ...prev, newEnvVars: newEnvs }));
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    className="text-xs text-blue-300 underline"
                    onClick={() => {
                      const newEnvs = [...(editDialog.newEnvVars || []), { key: '', value: '' }];
                      setEditDialog(prev => ({ ...prev, newEnvVars: newEnvs }));
                    }}
                  >
                    + Adicionar variável
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                className="flex-1 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
                onClick={() => {
                  updateService(editDialog.id, {
                    hostPort: editDialog.newHostPort || editDialog.hostPort,
                    envVars: editDialog.newEnvVars || [],
                    networkName: editDialog.newNetworkName || editDialog.networkName
                  });
                  setEditDialog(null);
                }}
              >
                Salvar Alterações
              </button>
              <button
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
                onClick={() => setEditDialog(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {removeDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">🗑️ Remover Serviço</h3>
            <p className="text-sm text-slate-300 mb-4">
              Digite o nome do serviço <span className="font-mono text-blue-300">{removeDialog.name}</span> para confirmar a remoção:
            </p>
            <input
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white mb-4"
              placeholder="Nome do serviço"
              onChange={(e) => setRemoveDialog(prev => ({ ...prev, confirmName: e.target.value }))}
            />
            <div className="mb-4">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="rounded border-slate-600 bg-slate-700 text-rose-500"
                  onChange={(e) => setRemoveDialog(prev => ({ ...prev, removeFolder: e.target.checked }))}
                />
                Remover pasta do projeto ({removeDialog.volumes?.[0]?.hostPath || 'N/A'})
              </label>
              <p className="text-xs text-slate-400 mt-1">
                ⚠️ Esta ação não pode ser desfeita
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  removeDialog.confirmName === removeDialog.name
                    ? 'bg-rose-500 text-white hover:bg-rose-600'
                    : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                }`}
                disabled={removeDialog.confirmName !== removeDialog.name}
                onClick={() => {
                  removeService(removeDialog.id, removeDialog.removeFolder)
                  setRemoveDialog(null)
                }}
              >
                Remover Definitivamente
              </button>
              <button
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
                onClick={() => setRemoveDialog(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed right-6 top-24 space-y-2">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
          />
        ))}
      </div>
    </div>
  )
}

export default DockerPanel
