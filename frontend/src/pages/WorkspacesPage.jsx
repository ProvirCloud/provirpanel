import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, Link, Unlink, Copy, Check, X } from 'lucide-react'
import api from '../services/api.js'

const slug = (v) => v.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

// ─── API helpers ──────────────────────────────────────────────────────────────
const wsApi = {
  list: () => api.get('/workspaces').then(r => r.data.workspaces),
  create: (d) => api.post('/workspaces', d).then(r => r.data.workspace),
  del: (id) => api.delete(`/workspaces/${id}`),
  createCompany: (wId, d) => api.post(`/workspaces/${wId}/companies`, d).then(r => r.data.company),
  delCompany: (wId, id) => api.delete(`/workspaces/${wId}/companies/${id}`),
  createProject: (cId, d) => api.post(`/companies/${cId}/projects`, d).then(r => r.data.project),
  delProject: (cId, id) => api.delete(`/companies/${cId}/projects/${id}`),
  invite: (wId, cId) => api.post(`/workspaces/${wId}/companies/${cId}/invite`).then(r => r.data),
  revokeChild: (id) => api.delete(`/children/${id}/revoke`),
  connect: (d) => api.post('/child/connect-remote', d).then(r => r.data),
  syncConnections: () => api.post('/workspaces/sync-connections').then(r => r.data).catch(() => null),
  disconnect: () => api.post('/child/disconnect', { workspaceData: localStorage.getItem('provir-workspace') || '{}' }).then(r => r.data),
}

const collectionName = (ws, co, pr) =>
  `${ws}_${co}_${pr}`.toLowerCase().replace(/[^a-z0-9_]/g, '_')

// ─── Small components ─────────────────────────────────────────────────────────
const Btn = ({ onClick, disabled, children, variant = 'default', className = '' }) => {
  const base = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition disabled:opacity-40'
  const variants = {
    default: 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
    primary: 'border border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25',
    danger: 'border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20',
    ghost: 'text-slate-400 hover:text-slate-200',
  }
  return <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>{children}</button>
}

const CopyBtn = ({ value }) => {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const ta = document.createElement('textarea')
    ta.value = value; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} className="ml-1 text-slate-500 hover:text-slate-300 transition">
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

const InlineForm = ({ placeholder, slugPlaceholder, onSubmit, onCancel }) => {
  const [name, setName] = useState('')
  const [sl, setSl] = useState('')
  return (
    <form className="flex items-center gap-2 mt-1" onSubmit={e => { e.preventDefault(); onSubmit({ name, slug: sl || slug(name) }) }}>
      <input autoFocus value={name} onChange={e => { setName(e.target.value); setSl(slug(e.target.value)) }} placeholder={placeholder} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 placeholder-slate-500 w-36" />
      <input value={sl} onChange={e => setSl(slug(e.target.value))} placeholder={slugPlaceholder || 'slug'} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-400 font-mono w-28" />
      <Btn variant="primary" disabled={!name}>Salvar</Btn>
      <Btn type="button" onClick={onCancel}>Cancelar</Btn>
    </form>
  )
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────
const InviteModal = ({ token, expiresAt, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
    <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-200">Token de Convite</p>
        <button onClick={onClose}><X className="h-4 w-4 text-slate-400 hover:text-slate-200" /></button>
      </div>
      <p className="text-[11px] text-slate-400">Válido por 24h · expira em {new Date(expiresAt).toLocaleString('pt-BR')}</p>
      <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
        <code className="flex-1 text-[11px] text-green-300 break-all font-mono">{token}</code>
        <CopyBtn value={token} />
      </div>
      <p className="text-[11px] text-slate-500">Envie este token para o admin do painel filho. Ele deve ir em Configurações → Vincular ao Grupo.</p>
      <Btn onClick={onClose} className="w-full justify-center">Fechar</Btn>
    </div>
  </div>
)

// ─── Connect Modal (filho) ────────────────────────────────────────────────────
const ConnectModal = ({ onClose, onSuccess }) => {
  const [form, setForm] = useState({ token: '', panelName: '', panelUrl: '' })
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const connect = async () => {
    setLoading(true); setError('')
    try {
      const data = await wsApi.connect(form)
      setResult(data)
      localStorage.setItem('provir-workspace', JSON.stringify(data))
      if (onSuccess) onSuccess()
    } catch (e) { setError(e.response?.data?.message || e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">Vincular ao Grupo</p>
          <button onClick={onClose}><X className="h-4 w-4 text-slate-400 hover:text-slate-200" /></button>
        </div>
        {result ? (
          <div className="space-y-2">
            <p className="text-xs text-green-400 font-medium">✅ Painel vinculado com sucesso!</p>
            {[['Workspace', result.workspaceName || result.workspaceSlug], ['Projeto', result.projectId || result.companySlug], ['Painel ID', result.panelId], ['API Key', result.apiKey || result.gatewayUrl]].filter(([,v]) => v).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded bg-slate-800 px-3 py-1.5">
                <span className="text-[11px] text-slate-400">{k}</span>
                <span className="text-[11px] text-slate-200 font-mono">{v || '—'}<CopyBtn value={v || ''} /></span>
              </div>
            ))}
            <Btn onClick={onClose} className="w-full justify-center mt-2">Fechar</Btn>
          </div>
        ) : (
          <>
            {[['Token de convite', 'token', 'eyJ...'], ['Nome deste painel', 'panelName', 'Meu Painel'], ['URL deste painel', 'panelUrl', 'https://meupainel.com']].map(([label, key, ph]) => (
              <div key={key} className="space-y-1">
                <label className="text-[11px] text-slate-400">{label}</label>
                <input value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder={ph} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500" />
              </div>
            ))}
            {error && <p className="text-[11px] text-red-400">{error}</p>}
            <Btn variant="primary" onClick={connect} disabled={loading || !form.token || !form.panelName || !form.panelUrl} className="w-full justify-center">
              {loading ? 'Conectando...' : 'Conectar'}
            </Btn>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Project row ──────────────────────────────────────────────────────────────
const ProjectRow = ({ project, wsSlug, coSlug, onDelete }) => (
  <div className="flex items-center justify-between rounded-lg bg-slate-900/50 px-3 py-1.5 group">
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-300">• {project.name}</span>
      <code className="text-[10px] text-slate-500 font-mono">{collectionName(wsSlug, coSlug, project.slug)}</code>
    </div>
    <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 transition text-slate-600 hover:text-red-400">
      <Trash2 className="h-3 w-3" />
    </button>
  </div>
)

// ─── Company row ──────────────────────────────────────────────────────────────
const CompanyRow = ({ company, wsSlug, workspaceId, onUpdate, onDelete }) => {
  const [open, setOpen] = useState(true)
  const [addingProject, setAddingProject] = useState(false)
  const [inviteData, setInviteData] = useState(null)
  const [loading, setLoading] = useState('')

  const addProject = async (data) => {
    const p = await wsApi.createProject(company.id, data)
    onUpdate(prev => prev.map(ws => ws.id === workspaceId ? {
      ...ws, companies: ws.companies.map(c => c.id === company.id ? { ...c, projects: [...c.projects, p] } : c)
    } : ws))
    setAddingProject(false)
  }

  const delProject = async (pId) => {
    await wsApi.delProject(company.id, pId)
    onUpdate(prev => prev.map(ws => ws.id === workspaceId ? {
      ...ws, companies: ws.companies.map(c => c.id === company.id ? { ...c, projects: c.projects.filter(p => p.id !== pId) } : c)
    } : ws))
  }

  const genInvite = async () => {
    setLoading('invite')
    try { setInviteData(await wsApi.invite(workspaceId, company.id)) }
    finally { setLoading('') }
  }

  const revokeChild = async () => {
    if (!company.childPanel) return
    setLoading('revoke')
    try {
      await wsApi.revokeChild(company.childPanel.id)
      onUpdate(prev => prev.map(ws => ws.id === workspaceId ? {
        ...ws, companies: ws.companies.map(c => c.id === company.id ? { ...c, childPanel: { ...c.childPanel, revokedAt: new Date().toISOString() } } : c)
      } : ws))
    } finally { setLoading('') }
  }

  const child = company.childPanel
  const childActive = child && !child.revokedAt

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/30">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(o => !o)} className="text-slate-500 hover:text-slate-300">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="text-xs font-medium text-slate-200">{company.name}</span>
        <code className="text-[10px] text-slate-500 font-mono">{company.slug}</code>
        <div className="ml-auto flex items-center gap-1.5">
          {childActive
            ? <span className="flex items-center gap-1 text-[10px] text-green-400"><Link className="h-3 w-3" />{child.url}</span>
            : <span className="text-[10px] text-slate-500">⚠ Sem painel filho</span>
          }
          {childActive && <Btn variant="danger" onClick={revokeChild} disabled={loading === 'revoke'}><Unlink className="h-3 w-3" />Revogar</Btn>}
          <Btn onClick={genInvite} disabled={loading === 'invite'}><Link className="h-3 w-3" />Gerar Convite</Btn>
          <Btn onClick={() => setAddingProject(true)} variant="primary"><Plus className="h-3 w-3" />Projeto</Btn>
          <Btn variant="danger" onClick={onDelete}><Trash2 className="h-3 w-3" /></Btn>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-3 space-y-1">
          {company.projects.map(p => (
            <ProjectRow key={p.id} project={p} wsSlug={wsSlug} coSlug={company.slug} onDelete={() => delProject(p.id)} />
          ))}
          {addingProject && (
            <InlineForm placeholder="Nome do projeto" slugPlaceholder="slug_projeto" onSubmit={addProject} onCancel={() => setAddingProject(false)} />
          )}
          {company.projects.length === 0 && !addingProject && (
            <p className="text-[11px] text-slate-600 pl-1">Nenhum projeto</p>
          )}
        </div>
      )}
      {inviteData && <InviteModal token={inviteData.token} expiresAt={inviteData.expiresAt} onClose={() => setInviteData(null)} />}
    </div>
  )
}

// ─── Workspace row ────────────────────────────────────────────────────────────
const WorkspaceRow = ({ workspace, onUpdate, onDelete }) => {
  const [open, setOpen] = useState(true)
  const [addingCompany, setAddingCompany] = useState(false)

  const addCompany = async (data) => {
    const c = await wsApi.createCompany(workspace.id, data)
    onUpdate(prev => prev.map(ws => ws.id === workspace.id ? { ...ws, companies: [...ws.companies, c] } : ws))
    setAddingCompany(false)
  }

  const delCompany = async (cId) => {
    await wsApi.delCompany(workspace.id, cId)
    onUpdate(prev => prev.map(ws => ws.id === workspace.id ? { ...ws, companies: ws.companies.filter(c => c.id !== cId) } : ws))
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50">
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => setOpen(o => !o)} className="text-slate-400 hover:text-slate-200">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="text-sm font-semibold text-slate-100">{workspace.name}</span>
        <code className="text-[11px] text-slate-500 font-mono">slug: {workspace.slug}</code>
        <div className="ml-auto flex items-center gap-2">
          <Btn onClick={() => setAddingCompany(true)} variant="primary"><Plus className="h-3 w-3" />Empresa</Btn>
          <Btn variant="danger" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Btn>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {workspace.companies.map(c => (
            <CompanyRow key={c.id} company={c} wsSlug={workspace.slug} workspaceId={workspace.id} onUpdate={onUpdate} onDelete={() => delCompany(c.id)} />
          ))}
          {addingCompany && (
            <InlineForm placeholder="Nome da empresa" slugPlaceholder="slug_empresa" onSubmit={addCompany} onCancel={() => setAddingCompany(false)} />
          )}
          {workspace.companies.length === 0 && !addingCompany && (
            <p className="text-[11px] text-slate-600">Nenhuma empresa</p>
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
  const [addingWs, setAddingWs] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [error, setError] = useState('')
  const [panelRole, setPanelRole] = useState(null)
  const [linked, setLinked] = useState(() => {
    try { return JSON.parse(localStorage.getItem('provir-workspace') || 'null') } catch { return null }
  })

  useEffect(() => {
    const init = async () => {
      try {
        const token = localStorage.getItem('provirpanel-token')
        const infoRes = await fetch('/api/zeus/panel-info', { headers: { Authorization: `Bearer ${token}` } })
        if (infoRes.ok) {
          const info = await infoRes.json()
          setPanelRole(info.role)
        }
      } catch {}
      await wsApi.syncConnections()
      try { setWorkspaces(await wsApi.list()) } catch (e) { setError(e.message) }
      setLoading(false)
    }
    init()
  }, [])

  const isReadOnly = panelRole === 'project'

  const addWorkspace = async (data) => {
    const ws = await wsApi.create(data)
    setWorkspaces(prev => [...prev, { ...ws, companies: [] }])
    setAddingWs(false)
  }

  const delWorkspace = async (id) => {
    await wsApi.del(id)
    setWorkspaces(prev => prev.filter(ws => ws.id !== id))
  }

  const handleDisconnect = async () => {
    try {
      await wsApi.disconnect()
      localStorage.removeItem('provir-workspace')
      setLinked(null)
      wsApi.list().then(setWorkspaces)
    } catch (e) { setError(e.message) }
  }

  if (loading) return <div className="p-8 text-slate-400 text-sm">Carregando...</div>

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Workspaces</h1>
          <p className="text-xs text-slate-500 mt-0.5">{isReadOnly ? 'Visualização do vínculo com o grupo' : 'Grupos → Empresas → Projetos com painéis filhos vinculados'}</p>
        </div>
        {!isReadOnly && (
          <div className="flex gap-2">
            <Btn onClick={() => setShowConnect(true)}><Link className="h-3.5 w-3.5" />Vincular ao Grupo</Btn>
            <Btn variant="primary" onClick={() => setAddingWs(true)}><Plus className="h-3.5 w-3.5" />Novo Workspace</Btn>
          </div>
        )}
        {isReadOnly && !linked && (
          <Btn onClick={() => setShowConnect(true)}><Link className="h-3.5 w-3.5" />Vincular ao Grupo</Btn>
        )}
      </div>

      {linked && (
        <div className="flex items-center justify-between rounded-xl border border-green-800/50 bg-green-900/20 px-4 py-3">
          <div>
            <p className="text-xs font-medium text-green-400">✅ Vinculado ao workspace: {linked.workspaceName || 'N/A'}</p>
            <p className="text-[10px] text-green-600 mt-0.5">Painel ID: {linked.panelId || '—'}</p>
          </div>
          <Btn variant="danger" onClick={handleDisconnect}><Unlink className="h-3 w-3" />Desvincular</Btn>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {isReadOnly ? (
        <div className="space-y-3">
          {workspaces.map(ws => (
            <div key={ws.id} className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-100">{ws.name}</p>
              <div className="mt-2 space-y-1.5">
                {(ws.companies || []).map(c => (
                  <div key={c.id} className="rounded-lg bg-slate-900/50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-300">{c.name}</span>
                      <code className="text-[10px] text-slate-500 font-mono">{c.slug}</code>
                      {c.childPanel && !c.childPanel.revokedAt && (
                        <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400"><Link className="h-3 w-3" />{c.childPanel.url}</span>
                      )}
                    </div>
                    {c.projects && c.projects.length > 0 && (
                      <div className="mt-1.5 pl-2 space-y-0.5">
                        {c.projects.map(p => (
                          <p key={p.id} className="text-[11px] text-slate-400">• {p.name}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {workspaces.length === 0 && !linked && (
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 px-6 py-10 text-center">
              <p className="text-sm text-slate-400">Nenhum vínculo ativo</p>
              <p className="text-xs text-slate-600 mt-1">Clique em "Vincular ao Grupo" para conectar a um workspace</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {workspaces.map(ws => (
            <WorkspaceRow key={ws.id} workspace={ws} onUpdate={setWorkspaces} onDelete={() => delWorkspace(ws.id)} />
          ))}
          {addingWs && (
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3">
              <InlineForm placeholder="Nome do workspace" slugPlaceholder="slug" onSubmit={addWorkspace} onCancel={() => setAddingWs(false)} />
            </div>
          )}
          {workspaces.length === 0 && !addingWs && (
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 px-6 py-10 text-center">
              <p className="text-sm text-slate-400">Nenhum workspace criado</p>
              <p className="text-xs text-slate-600 mt-1">Clique em "Novo Workspace" para começar</p>
            </div>
          )}
        </div>
      )}

      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} onSuccess={() => { wsApi.list().then(setWorkspaces); setLinked(JSON.parse(localStorage.getItem('provir-workspace') || 'null')) }} />}
    </div>
  )
}
