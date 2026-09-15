import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import {
  ChevronRight, ChevronDown, File, FileCode2, FileJson, FileText, Folder, FolderOpen,
  Save, Play, Settings2, X, RefreshCw, Loader2, Files, Terminal, Circle, CheckCircle2,
  Sparkles, Send, Hammer, MessageSquarePlus, ExternalLink,
} from 'lucide-react'
import api from '../services/api.js'

// Painel do projeto estilo VS Code: explorer (árvore colapsável) + abas + Monaco
// + config + rodar novamente. Consome os endpoints /build/sessions/:id/{files,file,config,rerun}.

const authFetch = (path, body, signal) => {
  const token = localStorage.getItem('provirpanel-token')
  const baseURL = api.defaults.baseURL || '/api'
  return fetch(`${baseURL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}), signal,
  })
}
async function consumeSSE(res, onEvent) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const p = line.slice(6); if (p === '[DONE]') return
      try { onEvent(JSON.parse(p)) } catch {}
    }
  }
}

// Mapeia extensão -> linguagem Monaco.
const LANG = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss', html: 'html', xml: 'xml',
  yml: 'yaml', yaml: 'yaml', sql: 'sql', sh: 'shell', py: 'python', go: 'go', rs: 'rust',
  env: 'ini', ini: 'ini', dockerfile: 'dockerfile', prisma: 'graphql',
}
const langOf = (name) => {
  const n = name.toLowerCase()
  if (n === 'dockerfile') return 'dockerfile'
  if (n.startsWith('.env')) return 'ini'
  const ext = n.split('.').pop()
  return LANG[ext] || 'plaintext'
}
// Ícone por tipo de arquivo.
function FileIcon({ name, size = 15 }) {
  const n = name.toLowerCase()
  if (/\.(ts|tsx|js|jsx|mjs)$/.test(n)) return <FileCode2 size={size} className="text-blue-400" />
  if (/\.json$/.test(n)) return <FileJson size={size} className="text-amber-400" />
  if (/\.(md|txt|env|ini|conf|ya?ml)$/.test(n) || n.startsWith('.env')) return <FileText size={size} className="text-[var(--color-text-muted)]" />
  return <File size={size} className="text-[var(--color-text-muted)]" />
}

// Nó da árvore (recursivo, colapsável).
function TreeNode({ node, depth, activePath, onOpen, expanded, toggle }) {
  const pad = { paddingLeft: `${depth * 12 + 8}px` }
  if (node.type === 'dir') {
    const isOpen = expanded.has(node.path)
    return (
      <div>
        <button type="button" onClick={() => toggle(node.path)}
          className="flex w-full items-center gap-1 py-[3px] text-left text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface)]" style={pad}>
          {isOpen ? <ChevronDown size={13} className="shrink-0 text-[var(--color-text-muted)]" /> : <ChevronRight size={13} className="shrink-0 text-[var(--color-text-muted)]" />}
          {isOpen ? <FolderOpen size={15} className="shrink-0 text-blue-300" /> : <Folder size={15} className="shrink-0 text-blue-300" />}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && node.children?.map((c) => (
          <TreeNode key={c.path} node={c} depth={depth + 1} activePath={activePath} onOpen={onOpen} expanded={expanded} toggle={toggle} />
        ))}
      </div>
    )
  }
  return (
    <button type="button" onClick={() => onOpen(node.path)}
      className={`flex w-full items-center gap-1.5 py-[3px] text-left text-[13px] hover:bg-[var(--color-surface)] ${activePath === node.path ? 'bg-[var(--color-surface)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}>
      <FileIcon name={node.name} />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

export default function ProjectWorkspace({ sessionId, onClose }) {
  const [tree, setTree] = useState([])
  const [treeExists, setTreeExists] = useState(true)
  const [expanded, setExpanded] = useState(new Set())
  const [tabs, setTabs] = useState([]) // [{ path, content, dirty, binary?, tooLarge? }]
  const [active, setActive] = useState(null) // path
  const [view, setView] = useState('files') // files | config
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rerunEvents, setRerunEvents] = useState(null) // tasks do rerun ao vivo
  const [busyRun, setBusyRun] = useState(false)
  // Play (run rápido) + chat de ajuste incremental
  const [busyPlay, setBusyPlay] = useState(false)
  const [runLink, setRunLink] = useState(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMsgs, setChatMsgs] = useState([]) // { role, content }
  const [chatInput, setChatInput] = useState('')
  const [busyEdit, setBusyEdit] = useState(false)
  const chatScrollRef = useRef(null)

  const loadTree = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/build/sessions/${sessionId}/files`)
      setTree(data.tree || []); setTreeExists(data.exists !== false)
      // expande a raiz e o primeiro nível por padrão (comportamento VS Code)
      const first = new Set()
      ;(data.tree || []).forEach((n) => { if (n.type === 'dir') first.add(n.path) })
      setExpanded(first)
    } finally { setLoading(false) }
  }, [sessionId])

  const loadConfig = useCallback(async () => {
    try { const { data } = await api.get(`/build/sessions/${sessionId}/config`); setConfig(data) } catch {}
  }, [sessionId])

  useEffect(() => { loadTree(); loadConfig() }, [loadTree, loadConfig])

  const toggle = (p) => setExpanded((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n })

  const openFile = async (path) => {
    setView('files')
    const existing = tabs.find((t) => t.path === path)
    if (existing) { setActive(path); return }
    try {
      const { data } = await api.get(`/build/sessions/${sessionId}/file`, { params: { path } })
      setTabs((prev) => [...prev, { path, content: data.content || '', dirty: false, binary: data.binary, tooLarge: data.tooLarge, size: data.size }])
      setActive(path)
    } catch (e) {
      setTabs((prev) => [...prev, { path, content: `// erro ao abrir: ${e.response?.data?.message || e.message}`, dirty: false, error: true }])
      setActive(path)
    }
  }

  const closeTab = (path, e) => {
    e?.stopPropagation()
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path)
      const next = prev.filter((t) => t.path !== path)
      if (active === path) setActive(next[Math.max(0, idx - 1)]?.path || null)
      return next
    })
  }

  const onEdit = (path, value) => setTabs((prev) => prev.map((t) => t.path === path ? { ...t, content: value ?? '', dirty: true } : t))

  const saveActive = async () => {
    const tab = tabs.find((t) => t.path === active); if (!tab || !tab.dirty) return
    setSaving(true)
    try {
      await api.put(`/build/sessions/${sessionId}/file`, { path: tab.path, content: tab.content })
      setTabs((prev) => prev.map((t) => t.path === tab.path ? { ...t, dirty: false } : t))
    } finally { setSaving(false) }
  }

  const saveConfig = async () => {
    setSaving(true)
    try { await api.put(`/build/sessions/${sessionId}/config`, { env: config.env, port: config.port, domain: config.domain }); await loadConfig() }
    finally { setSaving(false) }
  }

  // Ctrl/Cmd+S salva o arquivo ativo.
  useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (view === 'files') saveActive(); else if (view === 'config') saveConfig() } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  })

  const doRerun = async () => {
    setBusyRun(true); setRerunEvents([])
    try {
      const res = await authFetch(`/build/sessions/${sessionId}/rerun`, {})
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      await consumeSSE(res, (ev) => {
        if (ev.type === 'decomposed') setRerunEvents(ev.tasks.map((t) => ({ ...t, status: 'pending' })))
        else if (ev.type === 'task_start') setRerunEvents((ts) => (ts || []).map((t) => t.seq === ev.seq ? { ...t, status: 'running' } : t))
        else if (ev.type === 'task_done') setRerunEvents((ts) => (ts || []).map((t) => t.seq === ev.seq ? { ...t, status: 'done' } : t))
      })
      await loadTree()
    } catch (e) {
      setRerunEvents((ts) => [...(ts || []), { seq: -1, descricao: `Erro: ${e.message}`, status: 'error' }])
    } finally { setBusyRun(false) }
  }

  // PLAY — coloca/recoloca o app no ar (provisiona 1ª vez, reinicia depois). SEM LLM.
  const doRun = async () => {
    setBusyPlay(true)
    try {
      const { data } = await api.post(`/build/sessions/${sessionId}/run`, {})
      if (data.link) setRunLink(data.link)
      const verb = data.action === 'restarted' ? 'reiniciado' : 'no ar'
      setChatMsgs((m) => [...m, { role: 'assistant', content: `▶️ Serviço ${verb}.${data.link ? ` Link: ${data.link}` : ''}` }])
      if (data.action !== 'restarted') setChatOpen(true)
    } catch (e) {
      setChatOpen(true)
      setChatMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${e.response?.data?.message || e.message}` }])
    } finally { setBusyPlay(false) }
  }

  // AJUSTE incremental — chat que edita SÓ os arquivos afetados (SSE). Sem rebuild.
  const doEdit = async (text) => {
    const instrucao = (text ?? chatInput).trim()
    if (!instrucao || busyEdit) return
    setChatInput(''); setChatOpen(true)
    setChatMsgs((m) => [...m, { role: 'user', content: instrucao }, { role: 'assistant', content: '⏳ aplicando ajuste…' }])
    setBusyEdit(true)
    const applied = []
    try {
      const res = await authFetch(`/build/sessions/${sessionId}/edit`, { instrucao })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      await consumeSSE(res, (ev) => {
        if (ev.type === 'applied') applied.push(`${ev.acao === 'remover' ? '🗑️' : '✏️'} ${ev.path}`)
        else if (ev.type === 'edit_done') {
          const list = applied.length ? `\n\n${applied.join('\n')}` : ''
          const obs = ev.observacoes ? `\n\n_${ev.observacoes}_` : ''
          setChatMsgs((m) => { const u = [...m]; u[u.length - 1] = { role: 'assistant', content: `✅ ${ev.resumo || 'Ajuste aplicado.'}${list}${obs}\n\nCusto: US$ ${Number(ev.costUsd || 0).toFixed(4)}. Clique **Play** para ver no ar.` }; return u })
        } else if (ev.type === 'error') {
          setChatMsgs((m) => { const u = [...m]; u[u.length - 1] = { role: 'assistant', content: `⚠️ ${ev.error}` }; return u })
        }
      })
      await loadTree()
      // Recarrega abas abertas cujo conteúdo pode ter mudado.
      for (const p of applied.map((s) => s.replace(/^.. /, ''))) {
        if (tabs.find((t) => t.path === p)) {
          try { const { data } = await api.get(`/build/sessions/${sessionId}/file`, { params: { path: p } }); setTabs((prev) => prev.map((t) => t.path === p ? { ...t, content: data.content || '', dirty: false } : t)) } catch {}
        }
      }
    } catch (e) {
      setChatMsgs((m) => { const u = [...m]; u[u.length - 1] = { role: 'assistant', content: `⚠️ ${e.message}` }; return u })
    } finally { setBusyEdit(false) }
  }

  useEffect(() => { chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' }) }, [chatMsgs])

  const activeTab = tabs.find((t) => t.path === active)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#1e1e1e]">
      {/* Barra de título */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text)]">
          <Files size={14} /> Código do projeto
        </div>
        <div className="flex items-center gap-1.5">
          {runLink && (
            <a href={runLink} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-blue-300 hover:bg-[var(--color-border)]">
              <ExternalLink size={12} /> abrir
            </a>
          )}
          <button type="button" onClick={doRun} disabled={busyPlay} title="Rodar/reiniciar o app (rápido, sem IA)"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40">
            {busyPlay ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Play
          </button>
          <button type="button" onClick={() => setChatOpen((v) => !v)} title="Pedir um ajuste no código (chat)"
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${chatOpen ? 'bg-violet-600 text-white' : 'border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)]'}`}>
            <MessageSquarePlus size={13} /> Ajustar
          </button>
          <button type="button" onClick={doRerun} disabled={busyRun} title="Reconstruir TUDO com IA (lento — refaz o código inteiro)"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-40">
            {busyRun ? <Loader2 size={13} className="animate-spin" /> : <Hammer size={13} />} Reconstruir tudo
          </button>
          <button type="button" onClick={loadTree} title="Recarregar" className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"><RefreshCw size={14} /></button>
          {onClose && <button type="button" onClick={onClose} title="Fechar" className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"><X size={15} /></button>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Activity bar */}
        <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-[var(--color-border)] bg-[var(--color-surface)] py-2">
          <button type="button" onClick={() => setView('files')} title="Explorer"
            className={`rounded-md p-1.5 ${view === 'files' ? 'bg-[var(--color-border)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}><Files size={18} /></button>
          <button type="button" onClick={() => setView('config')} title="Configuração"
            className={`rounded-md p-1.5 ${view === 'config' ? 'bg-[var(--color-border)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}><Settings2 size={18} /></button>
        </div>

        {/* Sidebar: explorer OU config */}
        <div className="flex w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[#252526]">
          {view === 'files' ? (
            <>
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Explorer</div>
              <div className="min-h-0 flex-1 overflow-auto pb-2">
                {loading ? <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--color-text-muted)]"><Loader2 size={13} className="animate-spin" /> carregando…</div>
                  : !treeExists ? <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">Nenhum arquivo gerado ainda.</div>
                  : tree.map((n) => <TreeNode key={n.path} node={n} depth={0} activePath={active} onOpen={openFile} expanded={expanded} toggle={toggle} />)}
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Configuração</div>
              {config ? (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--color-text-muted)]">Porta</label>
                    <input value={config.port ?? ''} onChange={(e) => setConfig({ ...config, port: e.target.value.replace(/\D/g, '') })}
                      className="w-full rounded-md border border-[var(--color-border)] bg-[#1e1e1e] px-2 py-1 text-xs text-[var(--color-text)]" />
                    {config.portSource && <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">detectada: {config.portSource}</div>}
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--color-text-muted)]">Domínio</label>
                    <input value={config.domain ?? ''} onChange={(e) => setConfig({ ...config, domain: e.target.value })} placeholder="app.seudominio.com"
                      className="w-full rounded-md border border-[var(--color-border)] bg-[#1e1e1e] px-2 py-1 text-xs text-[var(--color-text)]" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--color-text-muted)]">.env</label>
                    <textarea value={config.env ?? ''} onChange={(e) => setConfig({ ...config, env: e.target.value })} rows={10}
                      className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[#1e1e1e] px-2 py-1 font-mono text-[11px] text-[var(--color-text)]" placeholder="CHAVE=valor" />
                  </div>
                  <button type="button" onClick={saveConfig} disabled={saving}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar config
                  </button>
                  {config.url && <a href={config.url} target="_blank" rel="noreferrer" className="block truncate text-[11px] text-blue-300 hover:underline">{config.url}</a>}
                </div>
              ) : <div className="text-xs text-[var(--color-text-muted)]">carregando…</div>}
            </div>
          )}
        </div>

        {/* Área principal: abas + editor */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#1e1e1e]">
          {/* Abas */}
          {tabs.length > 0 && (
            <div className="flex items-center overflow-x-auto border-b border-[var(--color-border)] bg-[#252526]">
              {tabs.map((t) => (
                <button key={t.path} type="button" onClick={() => { setActive(t.path); setView('files') }}
                  className={`flex shrink-0 items-center gap-1.5 border-r border-[var(--color-border)] px-3 py-1.5 text-xs ${active === t.path && view === 'files' ? 'bg-[#1e1e1e] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:bg-[#2d2d2d]'}`}>
                  <FileIcon name={t.path.split('/').pop()} size={13} />
                  <span className="max-w-[140px] truncate">{t.path.split('/').pop()}</span>
                  {t.dirty && <Circle size={7} className="fill-current text-[var(--color-text)]" />}
                  <X size={12} onClick={(e) => closeTab(t.path, e)} className="ml-1 rounded hover:bg-[var(--color-border)]" />
                </button>
              ))}
            </div>
          )}

          {/* Editor / config / vazio */}
          <div className="min-h-0 flex-1">
            {view === 'files' && activeTab ? (
              activeTab.binary ? <div className="p-6 text-sm text-[var(--color-text-muted)]">Arquivo binário — não editável no editor.</div>
              : activeTab.tooLarge ? <div className="p-6 text-sm text-[var(--color-text-muted)]">Arquivo muito grande para abrir ({Math.round((activeTab.size || 0) / 1024)} KB).</div>
              : (
                <Editor
                  height="100%" theme="vs-dark"
                  path={activeTab.path}
                  language={langOf(activeTab.path.split('/').pop())}
                  value={activeTab.content}
                  onChange={(v) => onEdit(activeTab.path, v)}
                  options={{ fontSize: 13, minimap: { enabled: true }, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, renderWhitespace: 'selection' }}
                />
              )
            ) : view === 'files' ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-text-muted)]">
                <FileCode2 size={40} className="opacity-40" />
                <p className="text-sm">Selecione um arquivo no explorer para ver o código.</p>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-text-muted)]">
                <Settings2 size={40} className="opacity-40" />
                <p className="text-sm">Edite a configuração na barra lateral.</p>
              </div>
            )}
          </div>

          {/* Painel inferior: progresso do rerun */}
          {rerunEvents && (
            <div className="max-h-40 overflow-auto border-t border-[var(--color-border)] bg-[#181818] p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-muted)]"><Terminal size={12} /> Rodar novamente</div>
              {rerunEvents.map((t, i) => (
                <div key={i} className="flex items-center gap-2 py-0.5 text-[11px]">
                  {t.status === 'done' ? <CheckCircle2 size={12} className="text-emerald-400" />
                    : t.status === 'running' ? <Loader2 size={12} className="animate-spin text-blue-400" />
                    : t.status === 'error' ? <X size={12} className="text-red-400" />
                    : <Circle size={12} className="text-[var(--color-text-muted)]" />}
                  <span className={t.status === 'error' ? 'text-red-300' : 'text-[var(--color-text)]'}>{t.descricao}</span>
                </div>
              ))}
            </div>
          )}

          {/* Status bar */}
          <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[#007acc] px-3 py-0.5 text-[11px] text-white">
            <span>{activeTab ? activeTab.path : 'Zeus Builder'}</span>
            <span className="flex items-center gap-3">
              {activeTab && <span>{langOf(activeTab.path.split('/').pop())}</span>}
              {saving ? <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> salvando</span>
                : activeTab?.dirty ? <span>● não salvo (Ctrl+S)</span> : <span>salvo</span>}
            </span>
          </div>
        </div>

        {/* Painel de chat de ajuste incremental (edita só os arquivos afetados) */}
        {chatOpen && (
          <div className="flex w-80 shrink-0 flex-col border-l border-[var(--color-border)] bg-[#252526]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text)]">
              <span className="flex items-center gap-1.5"><Sparkles size={13} className="text-violet-300" /> Ajustar código</span>
              <button type="button" onClick={() => setChatOpen(false)} className="rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"><X size={14} /></button>
            </div>
            <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
              {chatMsgs.length === 0 && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[#1e1e1e] p-3 text-[11px] text-[var(--color-text-muted)]">
                  Peça uma mudança em linguagem natural. Ex.: <em>"mude a cor do cabeçalho para azul"</em> ou <em>"troque a porta para 8080"</em>.
                  <br /><br />Só os arquivos afetados são alterados — sem refazer o projeto. Depois clique <strong>Play</strong>.
                </div>
              )}
              {chatMsgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[12px] ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-[#1e1e1e] text-[var(--color-text)]'}`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {busyEdit && <div className="flex items-center gap-2 px-1 text-[11px] text-[var(--color-text-muted)]"><Loader2 size={12} className="animate-spin" /> aplicando ajuste…</div>}
            </div>
            <div className="border-t border-[var(--color-border)] p-2">
              <div className="flex items-end gap-1.5 rounded-lg border border-[var(--color-border)] bg-[#1e1e1e] px-2 py-1.5">
                <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} rows={1} disabled={busyEdit}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doEdit() } }}
                  placeholder="Descreva o ajuste…"
                  className="max-h-28 flex-1 resize-none bg-transparent text-[12px] text-[var(--color-text)] outline-none" />
                <button type="button" onClick={() => doEdit()} disabled={busyEdit || !chatInput.trim()}
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40">
                  {busyEdit ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
