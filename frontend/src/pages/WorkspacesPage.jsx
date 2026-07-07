import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Database, FileCode, Globe, HardDrive, Link, Unlink, FolderOpen, Copy, Check, X } from 'lucide-react'
import api from '../services/api.js'

// ─── API helpers ──────────────────────────────────────────────────────────────
const zeusApi = {
  panelInfo: () => api.get('/zeus/panel-info').then(r => r.data),
  workspaces: () => api.get('/zeus/hierarchy/workspaces').then(r => r.data.workspaces || []),
  projects: (wsId) => api.get(`/zeus/hierarchy/workspaces/${wsId}/projects`).then(r => r.data.projects || []),
  contextFiles: (wsId, projId, type) => api.get(`/zeus/hierarchy/contexts/${wsId}/${projId}/${type}`).then(r => r.data.files || []),
}

const CONTEXT_ICONS = {
  repos: FileCode,
  database: Database,
  sites: Globe,
  infra: HardDrive,
  docs: FolderOpen,
  apis: Globe,
  backend: FileCode,
  integrations: Link,
  files: FolderOpen,
}

// ─── Small components ─────────────────────────────────────────────────────────
const Badge = ({ children, color = 'slate' }) => {
  const colors = {
    slate: 'border-slate-700 bg-slate-800 text-slate-400',
    green: 'border-green-700/50 bg-green-900/30 text-green-300',
    blue: 'border-blue-700/50 bg-blue-900/30 text-blue-300',
    amber: 'border-amber-700/50 bg-amber-900/30 text-amber-300',
  }
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${colors[color]}`}>{children}</span>
}

const CopyBtn = ({ value }) => {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} className="ml-1 text-slate-500 hover:text-slate-300 transition">
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

// ─── Context Type Row ─────────────────────────────────────────────────────────
const ContextTypeRow = ({ wsId, projId, type, files }) => {
  const Icon = CONTEXT_ICONS[type] || FolderOpen
  if (!files || files.length === 0) return null

  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-900/40 px-3 py-1.5">
      <Icon className="h-3.5 w-3.5 text-slate-500" />
      <span className="text-[11px] text-slate-300 font-medium">{type}</span>
      <Badge color="blue">{files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}</Badge>
      <div className="ml-2 flex flex-wrap gap-1">
        {files.slice(0, 5).map(f => (
          <span key={f.name} className="text-[10px] text-slate-500 font-mono">{f.name}</span>
        ))}
        {files.length > 5 && <span className="text-[10px] text-slate-600">+{files.length - 5}</span>}
      </div>
    </div>
  )
}

// ─── Project Card ─────────────────────────────────────────────────────────────
const ProjectCard = ({ project, wsId }) => {
  const [open, setOpen] = useState(false)
  const [contexts, setContexts] = useState(null)
  const [loading, setLoading] = useState(false)

  const loadContexts = async () => {
    if (contexts) { setOpen(o => !o); return }
    setLoading(true)
    setOpen(true)
    const types = project.contextTypes || ['backend', 'repos', 'docs', 'database', 'infra', 'sites', 'apis', 'integrations', 'files']
    const results = {}
    await Promise.all(types.map(async (type) => {
      try {
        const files = await zeusApi.contextFiles(wsId, project.id, type)
        if (files.length > 0) results[type] = files
      } catch {}
    }))
    setContexts(results)
    setLoading(false)
  }

  const contextCount = contexts ? Object.values(contexts).reduce((sum, f) => sum + f.length, 0) : 0

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/30">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={loadContexts}>
        <button className="text-slate-500 hover:text-slate-300">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="text-xs font-medium text-slate-200">{project.name}</span>
        {project.panelId && <Badge color="green">painel vinculado</Badge>}
        {contexts && contextCount > 0 && <Badge color="amber">{contextCount} contextos</Badge>}
        {contexts && contextCount === 0 && <Badge>vazio</Badge>}
        {loading && <span className="text-[10px] text-slate-500 animate-pulse">carregando...</span>}
      </div>
      {open && contexts && (
        <div className="px-4 pb-3 space-y-1">
          {Object.keys(contexts).length === 0 ? (
            <p className="text-[11px] text-slate-600 pl-1">Nenhum contexto indexado neste projeto</p>
          ) : (
            Object.entries(contexts).map(([type, files]) => (
              <ContextTypeRow key={type} wsId={wsId} projId={project.id} type={type} files={files} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Workspace Card ───────────────────────────────────────────────────────────
const WorkspaceCard = ({ workspace }) => {
  const [open, setOpen] = useState(true)
  const [projects, setProjects] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    zeusApi.projects(workspace.id)
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [workspace.id])

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50">
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => setOpen(o => !o)} className="text-slate-400 hover:text-slate-200">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="text-sm font-semibold text-slate-100">{workspace.name}</span>
        {workspace.description && <span className="text-[11px] text-slate-500">{workspace.description}</span>}
        {projects && <Badge>{projects.length} {projects.length === 1 ? 'projeto' : 'projetos'}</Badge>}
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {loading && <p className="text-[11px] text-slate-500 animate-pulse">Carregando projetos...</p>}
          {projects && projects.map(p => (
            <ProjectCard key={p.id} project={p} wsId={workspace.id} />
          ))}
          {projects && projects.length === 0 && (
            <p className="text-[11px] text-slate-600">Nenhum projeto</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [panelInfo, setPanelInfo] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const init = async () => {
      try {
        const [info, wsList] = await Promise.all([
          zeusApi.panelInfo().catch(() => null),
          zeusApi.workspaces().catch(() => []),
        ])
        setPanelInfo(info)
        setWorkspaces(wsList)
      } catch (e) { setError(e.message) }
      setLoading(false)
    }
    init()
  }, [])

  if (loading) return <div className="p-8 text-slate-400 text-sm">Carregando...</div>

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Workspaces & Contextos</h1>
          <p className="text-xs text-slate-500 mt-0.5">Hierarquia de projetos e contextos indexados para a Zeus AI</p>
        </div>
        {panelInfo && (
          <div className="flex items-center gap-2">
            <Badge color={panelInfo.role === 'central' ? 'blue' : panelInfo.role === 'workspace' ? 'green' : 'amber'}>
              {panelInfo.role} · {panelInfo.panelName}
            </Badge>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="space-y-3">
        {workspaces.map(ws => (
          <WorkspaceCard key={ws.id} workspace={ws} />
        ))}
        {workspaces.length === 0 && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 px-6 py-10 text-center">
            <p className="text-sm text-slate-400">Nenhum workspace na hierarquia</p>
            <p className="text-xs text-slate-600 mt-1">Os workspaces são gerenciados pelo painel central</p>
          </div>
        )}
      </div>
    </div>
  )
}
