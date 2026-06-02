import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, GitBranch, Loader2, Package, Search, Server, Trash2 } from 'lucide-react'
import { githubDeliveryApi } from '../services/serviceDetailsApi.js'

const fieldClass = 'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500/60'
const smallButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-blue-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50'

const splitRepoFullName = (fullName = '') => {
  const [owner, repo] = String(fullName || '').split('/')
  return { owner, repo }
}

const normalizeServiceName = (value = '') =>
  String(value || 'github-service')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

const InfoPill = ({ label, value }) => (
  <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 truncate text-sm text-slate-200" title={String(value || '-')}>{value || '-'}</p>
  </div>
)

const GitHubServiceWizardPage = () => {
  const navigate = useNavigate()
  const [connectionState, setConnectionState] = useState({ connections: [], defaultConnectionId: null })
  const [token, setToken] = useState('')
  const [repos, setRepos] = useState([])
  const [branches, setBranches] = useState([])
  const [selectedRepo, setSelectedRepo] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('main')
  const [analysis, setAnalysis] = useState(null)
  const [selectedBlueprintId, setSelectedBlueprintId] = useState('')
  const [serviceName, setServiceName] = useState('')
  const [hostPort, setHostPort] = useState('')
  const [deployMode, setDeployMode] = useState('manual')
  const [loadingAction, setLoadingAction] = useState('')
  const [message, setMessage] = useState('')
  const [editingToken, setEditingToken] = useState(false)

  const connectionId = connectionState.defaultConnectionId
  const activeConnection = connectionState.connections?.[0] || null
  const selectedBlueprint = useMemo(() => {
    const blueprints = analysis?.blueprints || []
    return blueprints.find((blueprint) => blueprint.id === selectedBlueprintId) || blueprints[0] || null
  }, [analysis, selectedBlueprintId])

  const loadRepos = useCallback(async (id = connectionId) => {
    if (!id) return
    const items = await githubDeliveryApi.listRepositories(id)
    setRepos(items)
    if (!selectedRepo && items[0]) {
      setSelectedRepo(items[0].fullName)
      setSelectedBranch(items[0].defaultBranch || 'main')
    }
  }, [connectionId, selectedRepo])

  useEffect(() => {
    let active = true
    githubDeliveryApi.status()
      .then((status) => {
        if (!active) return null
        setConnectionState(status)
        if (!status.defaultConnectionId) return null
        return githubDeliveryApi.listRepositories(status.defaultConnectionId)
      })
      .then((items) => {
        if (!active || !Array.isArray(items)) return
        setRepos(items)
        if (items[0]) {
          setSelectedRepo((current) => current || items[0].fullName)
          setSelectedBranch((current) => current || items[0].defaultBranch || 'main')
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedRepo || !connectionId) return
    let active = true
    const { owner, repo } = splitRepoFullName(selectedRepo)
    githubDeliveryApi.listBranches({ connectionId, owner, repo })
      .then((items) => {
        if (!active) return
        setBranches(items)
        if (items[0] && !items.some((branch) => branch.name === selectedBranch)) {
          setSelectedBranch(items[0].name)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [connectionId, selectedBranch, selectedRepo])

  useEffect(() => {
    if (!selectedBlueprint) return
    setServiceName((current) => current || normalizeServiceName(selectedBlueprint.serviceName))
  }, [selectedBlueprint])

  const connectGithub = async () => {
    setLoadingAction('connect')
    setMessage('')
    try {
      const status = await githubDeliveryApi.connect({ token })
      setConnectionState(status)
      setToken('')
      setEditingToken(false)
      await loadRepos(status.defaultConnectionId)
      setMessage(activeConnection ? 'Token GitHub atualizado.' : 'GitHub conectado.')
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao conectar GitHub')
    } finally {
      setLoadingAction('')
    }
  }

  const removeGithubConnection = async () => {
    if (!connectionId) return
    if (!window.confirm('Remover a conexão GitHub salva neste painel?')) return
    setLoadingAction('remove-connection')
    setMessage('')
    try {
      const status = await githubDeliveryApi.removeConnection(connectionId)
      setConnectionState(status)
      setRepos([])
      setBranches([])
      setSelectedRepo('')
      setSelectedBranch('main')
      setAnalysis(null)
      setSelectedBlueprintId('')
      setToken('')
      setEditingToken(false)
      setMessage('Conexão GitHub removida.')
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao remover conexão GitHub')
    } finally {
      setLoadingAction('')
    }
  }

  const analyzeRepo = async () => {
    setLoadingAction('analyze')
    setMessage('')
    try {
      const { owner, repo } = splitRepoFullName(selectedRepo)
      const result = await githubDeliveryApi.analyze({ connectionId, owner, repo, branch: selectedBranch })
      setAnalysis(result)
      const firstBlueprint = result.blueprints?.[0] || null
      setSelectedBlueprintId(firstBlueprint?.id || '')
      setServiceName(normalizeServiceName(firstBlueprint?.serviceName || repo))
      setMessage(`${result.blueprints?.length || 0} blueprint(s) detectado(s).`)
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao analisar repositório')
    } finally {
      setLoadingAction('')
    }
  }

  const createService = async () => {
    if (!selectedBlueprint) {
      setMessage('Selecione um blueprint.')
      return
    }
    setLoadingAction('create')
    setMessage('')
    try {
      const response = await githubDeliveryApi.createServiceFromBlueprint({
        connectionId,
        repository: selectedRepo,
        branch: selectedBranch,
        blueprint: selectedBlueprint,
        serviceName,
        hostPort,
        networkName: 'provirpanel',
        bindLocalOnly: true,
        deployMode
      })
      navigate(`/cloud/services/${response.service.id}?tab=delivery`)
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao criar serviço')
    } finally {
      setLoadingAction('')
    }
  }

  return (
    <div className="space-y-4">
      <button className={smallButtonClass} type="button" onClick={() => navigate('/docker')}>
        <ArrowLeft className="h-4 w-4" />
        Container Service
      </button>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-blue-200/70">GitHub Delivery</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">New from GitHub</h1>
          </div>
          {activeConnection ? (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
              {activeConnection.accountLogin}
            </span>
          ) : null}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <h2 className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-white">
            <GitBranch className="h-4 w-4 text-blue-300" />
            GitHub
          </h2>
          <div className="space-y-3">
            {activeConnection ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>Conectado como {activeConnection.accountLogin}.</span>
                  <div className="flex flex-wrap gap-2">
                    <button className={smallButtonClass} type="button" onClick={() => setEditingToken((value) => !value)}>
                      {editingToken ? 'Cancelar alteração' : 'Alterar token'}
                    </button>
                    <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={removeGithubConnection} disabled={loadingAction === 'remove-connection'}>
                      {loadingAction === 'remove-connection' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Remover
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {!activeConnection || editingToken ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">
                  {activeConnection ? 'Cole o novo token para substituir a conexão atual.' : <>
                    Use um <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300">fine-grained token</a> com acesso aos repositórios. Para salvar workflow, inclua permissão de conteúdo escrita.
                  </>}
                </p>
                <input className={`${fieldClass} w-full`} type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_..." />
                <button className={primaryButtonClass} type="button" onClick={connectGithub} disabled={!token || loadingAction === 'connect'}>
                  {loadingAction === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
                  {activeConnection ? 'Atualizar token' : 'Conectar'}
                </button>
              </div>
            ) : null}
            <label className="block">
              <span className="mb-2 block text-xs text-slate-500">Repositório</span>
              <select className={`${fieldClass} w-full`} value={selectedRepo} onChange={(event) => setSelectedRepo(event.target.value)} disabled={!repos.length}>
                <option value="">Selecione</option>
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.fullName}>{repo.fullName}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs text-slate-500">Branch</span>
              <select className={`${fieldClass} w-full`} value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>
                {branches.length ? branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>{branch.name}</option>
                )) : <option value={selectedBranch}>{selectedBranch}</option>}
              </select>
            </label>
            <button className={smallButtonClass} type="button" onClick={analyzeRepo} disabled={!selectedRepo || loadingAction === 'analyze'}>
              {loadingAction === 'analyze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Analisar projeto
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <h2 className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-white">
            <Package className="h-4 w-4 text-blue-300" />
            Blueprint
          </h2>
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-2">
              {(analysis?.blueprints || []).map((blueprint) => (
                <button
                  key={blueprint.id}
                  type="button"
                  className={`rounded-xl border p-3 text-left transition ${
                    selectedBlueprint?.id === blueprint.id
                      ? 'border-blue-500/50 bg-blue-500/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
                  }`}
                  onClick={() => {
                    setSelectedBlueprintId(blueprint.id)
                    setServiceName(normalizeServiceName(blueprint.serviceName))
                  }}
                >
                  <p className="font-semibold text-white">{blueprint.label}</p>
                  <p className="mt-2 text-sm text-slate-400">{blueprint.projectPath || '.'}</p>
                  <p className="mt-1 text-xs text-slate-500">{blueprint.buildType} / {blueprint.imageName}</p>
                </button>
              ))}
            </div>

            {selectedBlueprint ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <InfoPill label="Build" value={selectedBlueprint.buildCommand || selectedBlueprint.buildType} />
                  <InfoPill label="Artefato" value={selectedBlueprint.artifactPath || '.'} />
                  <InfoPill label="Porta" value={selectedBlueprint.containerPort} />
                  <InfoPill label="Health" value={selectedBlueprint.healthcheck?.target || '-'} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-xs text-slate-500">Nome do serviço</span>
                    <input className={`${fieldClass} w-full`} value={serviceName} onChange={(event) => setServiceName(event.target.value)} />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs text-slate-500">Porta host</span>
                    <input className={`${fieldClass} w-full`} value={hostPort} onChange={(event) => setHostPort(event.target.value)} placeholder="auto" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs text-slate-500">Deploy</span>
                    <select className={`${fieldClass} w-full`} value={deployMode} onChange={(event) => setDeployMode(event.target.value)}>
                      <option value="manual">Manual</option>
                      <option value="push">Automático por push</option>
                      <option value="tag">Automático por tag v*</option>
                    </select>
                  </label>
                </div>
                <button className={primaryButtonClass} type="button" onClick={createService} disabled={!serviceName || loadingAction === 'create'}>
                  {loadingAction === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
                  Criar serviço draft
                </button>
              </>
            ) : (
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">
                Selecione um repositório e execute a análise para o painel sugerir o serviço.
              </div>
            )}
          </div>
        </section>
      </div>

      {message ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">{message}</div>
      ) : null}
    </div>
  )
}

export default GitHubServiceWizardPage
