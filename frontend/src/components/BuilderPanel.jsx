import { useCallback, useEffect, useRef, useState } from 'react'
import { Hammer, Send, Sparkles, Plus, CheckCircle2, Circle, Loader2, FileCode2, Rocket, ClipboardCheck, Trash2, Paperclip, X, FileText } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../services/api.js'
import { useConfirm } from './ui/ConfirmModal'
import ProjectWorkspace from './ProjectWorkspace.jsx'

// Zeus Builder — chat imersivo estilo Codex. O usuário conversa; o agente responde
// em streaming (SSE). Descoberta → (auto) arquitetura+plano → aprovação → build ao
// vivo (task a task) → provisão. Timeline de estágios no topo. Ações inline.

const STAGES = [
  { key: 'discovery', label: 'Descoberta' },
  { key: 'architecture', label: 'Arquitetura' },
  { key: 'awaiting_approval', label: 'Plano' },
  { key: 'approved', label: 'Build' },
  { key: 'done', label: 'Entrega' },
]
const ORDER = ['discovery', 'studying', 'architecture', 'planning', 'awaiting_approval', 'approved', 'building', 'done', 'provisioned']

const authFetch = (path, body, signal) => {
  const token = localStorage.getItem('provirpanel-token')
  const baseURL = api.defaults.baseURL || '/api'
  return fetch(`${baseURL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}), signal,
  })
}

// Consome um stream SSE chamando onEvent(evento) para cada linha `data:`.
async function consumeSSE(res, onEvent) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') return
      try { onEvent(JSON.parse(payload)) } catch {}
    }
  }
}

// Timeline animada de estágios.
function Timeline({ stage }) {
  const cur = ORDER.indexOf(stage)
  return (
    <div className="flex items-center gap-1.5">
      {STAGES.map((s, i) => {
        const si = ORDER.indexOf(s.key)
        const done = cur > si
        const active = cur === si || (s.key === 'approved' && stage === 'building') || (s.key === 'done' && stage === 'provisioned')
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${active ? 'bg-blue-500/20 text-blue-200 ring-1 ring-blue-400/40' : done ? 'text-emerald-300' : 'text-[var(--color-text-muted)]'}`}>
              {done ? <CheckCircle2 size={13} /> : active ? <Loader2 size={13} className="animate-spin" /> : <Circle size={13} />}
              {s.label}
            </div>
            {i < STAGES.length - 1 && <div className={`h-px w-4 ${done ? 'bg-emerald-400/40' : 'bg-[var(--color-border)]'}`} />}
          </div>
        )
      })}
    </div>
  )
}

// Card de progresso de tasks do build ao vivo.
function BuildProgress({ tasks }) {
  if (!tasks || !tasks.length) return null
  const doneCount = tasks.filter((t) => t.status === 'done').length
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/50 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-[var(--color-text)]"><FileCode2 size={14} /> Gerando código</span>
        <span className="text-[var(--color-text-muted)]">{doneCount}/{tasks.length}</span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-500" style={{ width: `${(doneCount / tasks.length) * 100}%` }} />
      </div>
      <div className="space-y-1">
        {tasks.map((t) => (
          <div key={t.seq} className="flex items-center gap-2 text-xs">
            {t.status === 'done' ? <CheckCircle2 size={13} className="text-emerald-400" />
              : t.status === 'running' ? <Loader2 size={13} className="animate-spin text-blue-400" />
              : <Circle size={13} className="text-[var(--color-text-muted)]" />}
            <span className={t.status === 'done' ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'}>{t.descricao}</span>
            {t.arquivos?.length > 0 && <span className="ml-auto text-[10px] text-emerald-400/70">{t.arquivos.length} arq.</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

const Bubble = ({ role, children }) => (
  <div className={`flex gap-3 ${role === 'user' ? 'flex-row-reverse' : ''}`}>
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${role === 'user' ? 'bg-blue-600' : 'bg-gradient-to-br from-violet-500 to-blue-500'}`}>
      {role === 'user' ? <span className="text-xs font-bold text-white">Eu</span> : <Sparkles size={15} className="text-white" />}
    </div>
    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${role === 'user' ? 'bg-blue-600 text-white' : 'bg-[var(--color-surface)] text-[var(--color-text)]'}`}>
      {children}
    </div>
  </div>
)

// Form interativo para as perguntas do arquiteto. Cada pergunta vira um campo;
// ao enviar, compõe as respostas numa única mensagem. O usuário TAMBÉM pode
// responder livre no chat (este form é opcional/atalho).
function QuestionForm({ questions, onSubmit, disabled }) {
  const [answers, setAnswers] = useState({})
  const set = (i, v) => setAnswers((a) => ({ ...a, [i]: v }))
  const submit = () => {
    const filled = questions.map((q, i) => ({ q, a: (answers[i] || '').trim() })).filter((x) => x.a)
    if (!filled.length) return
    const composed = filled.map(({ q, a }) => `${q}\n→ ${a}`).join('\n\n')
    onSubmit(composed)
  }
  const anyFilled = Object.values(answers).some((v) => (v || '').trim())
  return (
    <div className="ml-11 rounded-xl border border-blue-500/30 bg-blue-500/5 p-3">
      <div className="mb-2 text-xs font-medium text-blue-200">Responda o que souber (o resto pode deixar em branco):</div>
      <div className="space-y-2">
        {questions.map((q, i) => (
          <div key={i}>
            <label className="mb-1 block text-xs text-[var(--color-text)]">{q}</label>
            <input value={answers[i] || ''} onChange={(e) => set(i, e.target.value)} disabled={disabled}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]"
              placeholder="Sua resposta…" />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-[var(--color-text-muted)]">ou responda direto no chat abaixo</span>
        <button type="button" onClick={submit} disabled={disabled || !anyFilled}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">
          <Send size={13} /> Enviar respostas
        </button>
      </div>
    </div>
  )
}

// Barra de ações SEMPRE derivada do estágio atual (persistente após refresh).
// Barra de ações SEMPRE derivada do estágio atual (persistente após refresh).
// `hasPlan` = existe plano ativo; `canReview` = há build para revisar. Esses
// sinais vêm do estado reidratado (banco), então as ações reaparecem ao voltar
// à tela — não dependem de mensagens efêmeras (cta_*) que não são persistidas.
function StageActions({ stage, hasPlan, canReview, onPlan, onWireframe, onApprove, onBuild, onProvision, onReview, onViewCode }) {
  const ActBtn = ({ onClick, icon: Icon, children, variant = 'primary' }) => (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${variant === 'primary' ? 'bg-blue-600 text-white hover:bg-blue-500' : variant === 'ok' ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface)]'}`}>
      <Icon size={15} /> {children}
    </button>
  )
  let actions = null
  if (stage === 'discovery') {
    // Na descoberta, o usuário pode conversar OU avançar direto para o plano a
    // qualquer momento (o backend valida se há contexto suficiente).
    actions = <ActBtn onClick={onPlan} icon={Sparkles} variant="ghost">Gerar arquitetura + plano</ActBtn>
  } else if (stage === 'studying' || stage === 'architecture' || stage === 'planning') {
    actions = <ActBtn onClick={onPlan} icon={Sparkles}>Gerar arquitetura + plano</ActBtn>
  } else if (stage === 'awaiting_approval') {
    actions = <>
      <ActBtn onClick={onApprove} icon={CheckCircle2} variant="ok">Aprovar e construir</ActBtn>
      <ActBtn onClick={onWireframe} icon={ClipboardCheck} variant="ghost">Ver wireframe</ActBtn>
    </>
  } else if (stage === 'approved' || stage === 'building') {
    actions = <ActBtn onClick={onBuild} icon={FileCode2}>Executar build</ActBtn>
  } else if (stage === 'done' || stage === 'provisioned' || canReview) {
    actions = <>
      <ActBtn onClick={onViewCode} icon={FileCode2}>Ver código do projeto</ActBtn>
      <ActBtn onClick={onProvision} icon={Rocket}>Publicar com domínio</ActBtn>
      <ActBtn onClick={onReview} icon={ClipboardCheck} variant="ghost">Revisar código</ActBtn>
    </>
  } else if (hasPlan) {
    // Fallback: há um plano ativo mas o estágio não bateu com nenhum caso acima
    // (estado inconsistente). Não deixe o usuário preso — ofereça aprovar.
    actions = <ActBtn onClick={onApprove} icon={CheckCircle2} variant="ok">Aprovar e construir</ActBtn>
  }
  if (!actions) return null
  return <div className="mb-2 flex flex-wrap gap-2">{actions}</div>
}

// Modal de publicação: escolha de domínio + modo (subdomínio | proxy). Mostra o
// que o backend detectou (zonas gerenciadas, IP do servidor, auth).
function PublishModal({ opts, onCancel, onPublish, busy }) {
  const zones = opts?.managedZones || []
  const [mode, setMode] = useState('subdomain')
  const [domain, setDomain] = useState(zones.length ? `${opts.suggestedSubdomain}.${zones[0].name}` : '')
  const [pathPrefix, setPathPrefix] = useState(`/${opts?.suggestedSubdomain || 'app'}`)
  const [port, setPort] = useState(opts?.targetPort || '')
  const [showPortEdit, setShowPortEdit] = useState(false)
  const managed = zones.some((z) => domain === z.name || domain.endsWith('.' + z.name))
  const canSubmit = domain.trim() && port // porta agora sempre vem detectada
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <Rocket size={18} /> Publicar com domínio
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Como publicar?</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('subdomain')}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm ${mode === 'subdomain' ? 'border-blue-500 bg-blue-500/10 text-blue-200' : 'border-[var(--color-border)] text-[var(--color-text)]'}`}>
              Subdomínio<div className="text-[10px] text-[var(--color-text-muted)]">app.seudominio.com</div>
            </button>
            <button type="button" onClick={() => setMode('proxy')}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm ${mode === 'proxy' ? 'border-blue-500 bg-blue-500/10 text-blue-200' : 'border-[var(--color-border)] text-[var(--color-text)]'}`}>
              Proxy por path<div className="text-[10px] text-[var(--color-text-muted)]">seudominio.com/app</div>
            </button>
          </div>
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Domínio</label>
          <input value={domain} onChange={(e) => setDomain(e.target.value)}
            placeholder={mode === 'subdomain' ? 'sorteios.seudominio.com.br' : 'seudominio.com.br'}
            className="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-text)]" />
          {zones.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {zones.map((z) => (
                <button key={z.name} type="button" onClick={() => setDomain(`${opts.suggestedSubdomain}.${z.name}`)}
                  className="rounded bg-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text)]">{z.name}</button>
              ))}
            </div>
          )}
          <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
            {managed ? '✅ Domínio gerenciado — DNS configurado automaticamente.'
              : `ℹ️ Domínio externo — mostraremos as instruções de DNS (aponte para ${opts?.serverIp || 'o IP do servidor'}).`}
          </div>
        </div>
        {mode === 'proxy' && (
          <div className="mb-3">
            <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Caminho (path)</label>
            <input value={pathPrefix} onChange={(e) => setPathPrefix(e.target.value)} placeholder="/app"
              className="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-text)]" />
          </div>
        )}

        {/* Porta do HOST já VALIDADA (livre). Se houve conflito, avisamos. */}
        <div className="mb-3 rounded-lg border border-[var(--color-border)] px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-text-muted)]">Porta do host (validada)</span>
            <span className="font-mono font-semibold text-[var(--color-text)]">{port || '—'}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
            {opts?.portChanged
              ? `⚠️ A porta ${opts.declaredPort} (${opts.portSource}) estava em uso — realocado para ${opts.targetPort}, que está livre.`
              : `Livre. Detectada de: ${opts?.portSource || 'código gerado'}.`}
            {' '}{!showPortEdit && (
              <button type="button" onClick={() => setShowPortEdit(true)} className="text-blue-300 underline">ajustar</button>
            )}
          </div>
          {showPortEdit && (
            <input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} placeholder="8000"
              className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--color-text)]" />
          )}
        </div>
        {opts?.hasAuth && (
          <div className="mb-3 rounded-lg bg-blue-500/10 px-3 py-2 text-[11px] text-blue-200">🔑 O app tem autenticação — mostraremos o acesso após publicar.</div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)]">Cancelar</button>
          <button type="button" disabled={busy || !canSubmit}
            onClick={() => onPublish({ mode, domain: domain.trim(), port: Number(port) || undefined, pathPrefix })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            <Rocket size={15} /> Publicar
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BuilderPanel() {
  const [projects, setProjects] = useState([])
  const [session, setSession] = useState(null)
  const [activePlan, setActivePlan] = useState(null)
  const [messages, setMessages] = useState([]) // { role, content, kind?, data? }
  const [buildTasks, setBuildTasks] = useState(null)
  const [svg, setSvg] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [newName, setNewName] = useState('')
  const [pendingQuestions, setPendingQuestions] = useState(null) // string[] | null
  const [attachment, setAttachment] = useState(null) // { name, mimeType, data?, text?, kind }
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishOpts, setPublishOpts] = useState(null) // opções vindas do backend
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const scrollRef = useRef(null)
  const streamIdxRef = useRef(-1)
  const fileRef = useRef(null)
  const confirm = useConfirm()

  const stage = session?.stage
  const scroll = () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  useEffect(() => { scroll() }, [messages, buildTasks])

  const loadProjects = useCallback(async () => {
    try { const { data } = await api.get('/build/projects'); setProjects(data.projects || []) } catch {}
  }, [])
  useEffect(() => { loadProjects() }, [loadProjects])

  // Restaura a sessão aberta após um refresh (guarda o projeto ativo no localStorage).
  useEffect(() => {
    const saved = localStorage.getItem('zeus-builder-project')
    if (saved) openSession(saved).catch(() => localStorage.removeItem('zeus-builder-project'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addMsg = (m) => setMessages((prev) => [...prev, m])
  const patchLast = (patch) => setMessages((prev) => { const u = [...prev]; const i = streamIdxRef.current; if (u[i]) u[i] = { ...u[i], ...patch }; return u })

  const openSession = async (projectId) => {
    const { data } = await api.get(`/build/projects/${projectId}/session`)
    localStorage.setItem('zeus-builder-project', projectId)
    setSession(data.session); setActivePlan(data.activePlan || null)
    setSvg(data.wireframeSvg || null)
    // Reconstrói o card de build (progresso/arquivos) se houver um run.
    setBuildTasks(data.lastRun?.tasks?.length ? data.lastRun.tasks : null)
    // Reconstrói a conversa a partir dos eventos persistidos.
    const msgs = (data.events || [])
      .filter((e) => e.content && (e.role === 'user' || e.role === 'assistant'))
      .map((e) => ({ role: e.role === 'user' ? 'user' : 'assistant', content: e.content }))
    // Se há plano, mostra-o como mensagem no fim do histórico.
    if (data.activePlan) msgs.push({ role: 'assistant', kind: 'plan', data: data.activePlan, content: '' })
    // Fase do build (task X de N): dá visibilidade do que está acontecendo ao voltar.
    const phase = data.buildPhase
    if (phase) {
      if (phase.status === 'failed') {
        msgs.push({ role: 'assistant', content: `⚠️ **Build interrompido.** ${phase.label} Você pode executar o build novamente pelo botão abaixo.` })
      } else if (phase.status === 'running') {
        msgs.push({ role: 'assistant', content: `⏳ ${phase.label} (${phase.done}/${phase.total} concluídas)` })
      }
    }
    if (data.lastRun?.devStackUrl) msgs.push({ role: 'assistant', content: `🚀 **Stack dev:** ${data.lastRun.devStackUrl}` })
    setMessages(msgs.length ? msgs : [{ role: 'assistant', content: `Vamos construir **${data.session.project?.name}**. Me conte o que você quer criar — eu cuido do resto.` }])
  }

  const createProject = async () => {
    if (!newName.trim()) return
    setBusy(true); setBusyLabel('Criando projeto…')
    try {
      const { data } = await api.post('/build/projects', { name: newName.trim(), kind: 'new' })
      setNewName(''); await loadProjects(); await openSession(data.project.id)
    } finally { setBusy(false); setBusyLabel('') }
  }

  const removeProject = async (e, p) => {
    e.stopPropagation()
    const ok = await confirm({
      title: 'Remover projeto',
      message: `Remover "${p.name}"? Isso apaga a conversa, o plano e os arquivos gerados. Não dá para desfazer.`,
      confirmText: 'Remover',
      cancelText: 'Cancelar',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/build/projects/${p.id}`)
      if (session?.projectId === p.id) { localStorage.removeItem('zeus-builder-project'); setSession(null); setMessages([]); setActivePlan(null); setBuildTasks(null); setSvg(null) }
      await loadProjects()
    } catch (err) {
      if (session) addMsg({ role: 'assistant', content: `⚠️ Falha ao remover o projeto: ${err.response?.data?.message || err.message}` })
    }
  }

  // Envia mensagem de descoberta em streaming. `explicitText` vem do form de perguntas.
  const send = async (explicitText) => {
    const text = (typeof explicitText === 'string' ? explicitText : input).trim()
    if ((!text && !attachment) || busy || !session) return
    const att = attachment
    // Para anexo de TEXTO, injeta o conteúdo na própria mensagem (contexto inline).
    let outMsg = text
    let payloadAtt = null
    if (att) {
      if (att.kind === 'text') {
        outMsg = `${text}\n\n--- Conteúdo do arquivo "${att.name}" ---\n${att.text.slice(0, 30000)}`
      } else {
        payloadAtt = { name: att.name, mimeType: att.mimeType, data: att.data }
      }
    }
    setInput(''); setAttachment(null); setPendingQuestions(null)
    // Adiciona a mensagem do usuário + o placeholder do assistente num ÚNICO
    // update funcional, e captura o índice REAL do placeholder (o `messages` do
    // closure está stale — usá-lo faz o patchLast escrever na mensagem errada,
    // o que causava a "resposta em loop"/sobrescrita).
    setMessages((prev) => {
      const next = [
        ...prev,
        { role: 'user', content: (text || '') + (att ? `\n📎 ${att.name}` : '') },
        { role: 'assistant', content: '' },
      ]
      streamIdxRef.current = next.length - 1 // índice do placeholder do assistente
      return next
    })
    setBusy(true); setBusyLabel('pensando…')
    try {
      const res = await authFetch(`/build/sessions/${session.id}/chat`, { message: outMsg, attachment: payloadAtt })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      let acc = ''
      await consumeSSE(res, (ev) => {
        if (ev.type === 'token') { acc += ev.content || ''; patchLast({ content: acc }) }
        else if (ev.type === 'questions') { setPendingQuestions(ev.questions || null) }
        else if (ev.type === 'stage') { setSession((s) => s ? { ...s, stage: ev.stage } : s); setPendingQuestions(null) }
        else if (ev.type === 'done') {
          if (ev.text) patchLast({ content: ev.text })
          if (ev.ready) {
            setPendingQuestions(null)
            addMsg({ role: 'assistant', content: 'Tenho o suficiente para desenhar a arquitetura e o plano. Use o botão **Gerar arquitetura + plano** abaixo.' })
          }
        } else if (ev.type === 'error') { patchLast({ content: `⚠️ ${ev.error}` }) }
      })
    } catch (e) { patchLast({ content: `⚠️ ${e.message}` }) }
    finally { setBusy(false); setBusyLabel(''); await refreshMeta() }
  }

  // Lê o arquivo escolhido. Imagem/PDF → base64 (multimodal). Texto/md/sem ext → texto.
  const handleFile = async (file) => {
    if (!file) return
    const MAX = 8 * 1024 * 1024 // 8MB
    if (file.size > MAX) { addMsg({ role: 'assistant', content: `⚠️ Arquivo muito grande (máx 8MB): ${file.name}` }); return }
    const mime = file.type || ''
    const isImg = mime.startsWith('image/')
    const isPdf = mime === 'application/pdf'
    const looksText = mime.startsWith('text/') || /\.(txt|md|log|csv|json|ya?ml|xml|env|ini|conf)$/i.test(file.name) || (!mime && !/\.(png|jpe?g|gif|webp|pdf)$/i.test(file.name))
    try {
      if (isImg || isPdf) {
        const buf = await file.arrayBuffer()
        let bin = ''; const bytes = new Uint8Array(buf)
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        const data = btoa(bin)
        setAttachment({ name: file.name, mimeType: mime || (isPdf ? 'application/pdf' : 'image/png'), data, kind: isImg ? 'image' : 'pdf' })
      } else if (looksText) {
        const t = await file.text()
        setAttachment({ name: file.name, mimeType: 'text/plain', text: t, kind: 'text' })
      } else {
        addMsg({ role: 'assistant', content: `⚠️ Tipo de arquivo não suportado: ${file.name}. Aceito imagem, PDF, txt, md e arquivos de texto.` })
      }
    } catch (e) { addMsg({ role: 'assistant', content: `⚠️ Falha ao ler o arquivo: ${e.message}` }) }
  }

  const refreshMeta = async () => {
    if (!session) return
    try { const { data } = await api.get(`/build/sessions/${session.id}`); setSession(data.session); setActivePlan(data.activePlan || null) } catch {}
  }

  const genPlan = async () => {
    setBusy(true); setBusyLabel('desenhando a arquitetura + plano…')
    addMsg({ role: 'assistant', content: '🏗️ Desenhando a arquitetura e quebrando em tarefas…' })
    try {
      const { data } = await api.post(`/build/sessions/${session.id}/plan`, {})
      setActivePlan(data.plan); await refreshMeta()
      addMsg({ role: 'assistant', kind: 'plan', data: data.plan, content: '' })
      addMsg({ role: 'assistant', content: 'Revise o plano acima. Se estiver bom, use **Aprovar e construir** abaixo.' })
    } catch (e) { addMsg({ role: 'assistant', content: `⚠️ ${e.response?.data?.message || e.message}` }) }
    finally { setBusy(false); setBusyLabel('') }
  }

  const genWireframe = async () => {
    setBusy(true); setBusyLabel('gerando wireframe…')
    try {
      const { data } = await api.post(`/build/sessions/${session.id}/wireframe`, {})
      setSvg(data.svg); addMsg({ role: 'assistant', kind: 'wireframe', svg: data.svg, content: '' })
    } catch (e) { addMsg({ role: 'assistant', content: `⚠️ ${e.response?.data?.message || e.message}` }) }
    finally { setBusy(false); setBusyLabel('') }
  }

  const approve = async () => {
    setBusy(true); setBusyLabel('aprovando…')
    try {
      await api.post(`/build/sessions/${session.id}/approve`, {})
      await refreshMeta()
    } catch (e) {
      addMsg({ role: 'assistant', content: `⚠️ ${e.response?.data?.message || e.message}` })
      setBusy(false); setBusyLabel(''); return
    }
    // Encadeia direto para o build (o CTA é "Aprovar e construir").
    await build()
  }

  // Build com progresso ao vivo (SSE).
  const build = async () => {
    setBusy(true); setBusyLabel('construindo…'); setBuildTasks([])
    addMsg({ role: 'assistant', content: '⚡ Iniciando o build. Acompanhe o progresso abaixo:' })
    try {
      const res = await authFetch(`/build/sessions/${session.id}/build-stream`, {})
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      await consumeSSE(res, (ev) => {
        if (ev.type === 'decomposed') {
          setBuildTasks(ev.tasks.map((t) => ({ ...t, status: 'pending' })))
        } else if (ev.type === 'task_start') {
          setBuildTasks((ts) => (ts || []).map((t) => t.seq === ev.seq ? { ...t, status: 'running' } : t))
        } else if (ev.type === 'task_done') {
          setBuildTasks((ts) => (ts || []).map((t) => t.seq === ev.seq ? { ...t, status: 'done', arquivos: ev.arquivos } : t))
        } else if (ev.type === 'build_done') {
          addMsg({ role: 'assistant', content: `✅ **Build concluído!** ${ev.arquivos.length} arquivo(s) gerados · custo estimado US$ ${Number(ev.costUsd).toFixed(4)}.` })
          addMsg({ role: 'assistant', content: 'Quer testar? Use **Publicar stack dev** abaixo para gerar um link.' })
        } else if (ev.type === 'error') {
          addMsg({ role: 'assistant', content: `⚠️ ${ev.error}` })
        }
      })
      await refreshMeta()
    } catch (e) { addMsg({ role: 'assistant', content: `⚠️ ${e.message}` }) }
    finally { setBusy(false); setBusyLabel('') }
  }

  // Abre o modal de publicação e carrega as opções (zonas, IP, porta, auth).
  const provision = async () => {
    setBusy(true); setBusyLabel('carregando opções de publicação…')
    try {
      const { data } = await api.get(`/build/sessions/${session.id}/publish-options`)
      setPublishOpts(data); setPublishOpen(true)
    } catch (e) { addMsg({ role: 'assistant', content: `⚠️ ${e.response?.data?.message || e.message}` }) }
    finally { setBusy(false); setBusyLabel('') }
  }

  // Publica de fato (modo subdomain|proxy). Renderiza domínio final, instruções
  // de DNS (se domínio novo) e credenciais de acesso (se o app tiver auth).
  const doPublish = async ({ mode, domain, port, pathPrefix }) => {
    setPublishOpen(false)
    setBusy(true); setBusyLabel('publicando…')
    try {
      const { data } = await api.post(`/build/sessions/${session.id}/publish`, { mode, domain, port, pathPrefix })
      const parts = []
      parts.push(`🌐 **Domínio:** ${data.url}`)
      if (data.portNote) parts.push(`🔌 ${data.portNote}`)
      if (data.mode === 'subdomain') {
        parts.push(data.nginxApplied ? '✅ Nginx configurado e recarregado.' : (data.nginxError ? `⚠️ Nginx: ${data.nginxError}` : ''))
        if (data.dnsApplied) parts.push('✅ DNS criado no Cloudflare (proxied).')
        if (data.sslNote) parts.push(`🔒 ${data.sslNote}`)
      } else {
        parts.push(`↪️ **Proxy por path:** ${data.pathPrefix} → 127.0.0.1:${data.port}`)
        if (data.note) parts.push(data.note)
      }
      if (data.dnsInstructions) {
        const r = data.dnsInstructions
        parts.push(`📋 **Configure o DNS** (domínio novo):\n\`\`\`\n${r.exemplo || ''}\n\`\`\`\n${r.note || ''}`)
      }
      if (data.auth?.hasAuth) {
        if (data.auth.credenciais?.login || data.auth.credenciais?.senha) {
          parts.push(`🔑 **Acesso:**\n- Login: \`${data.auth.credenciais.login || '(ver seed)'}\`\n- Senha: \`${data.auth.credenciais.senha || '(ver seed)'}\`${data.auth.credenciais.origem ? `\n(origem: ${data.auth.credenciais.origem})` : ''}`)
        } else {
          parts.push(`🔑 **Autenticação:** ${data.auth.nota || 'o app tem login; credenciais definidas no seed/runtime.'}`)
        }
      }
      addMsg({ role: 'assistant', content: parts.filter(Boolean).join('\n\n') })
      await refreshMeta()
    } catch (e) { addMsg({ role: 'assistant', content: `⚠️ ${e.response?.data?.message || e.message}` }) }
    finally { setBusy(false); setBusyLabel('') }
  }

  // Revisa o código do último build (revisor no gateway). Endpoint já existente:
  // POST /build/sessions/:id/review → { review: { aprovado, nota, problemas[], resumo } }
  const doReview = async () => {
    setBusy(true); setBusyLabel('revisando o código…')
    try {
      const { data } = await api.post(`/build/sessions/${session.id}/review`, {})
      const r = data.review || {}
      const veredito = r.aprovado ? '✅ **Aprovado**' : '⚠️ **Reprovado**'
      const problemas = (r.problemas || []).length
        ? '\n\n' + r.problemas.map((p) => `- **${p.severidade || '—'}** (${p.arquivo || '?'}): ${p.descricao}${p.sugestao ? ` — _${p.sugestao}_` : ''}`).join('\n')
        : ''
      addMsg({ role: 'assistant', content: `${veredito} · nota **${r.nota ?? '—'}/10**\n\n${r.resumo || ''}${problemas}` })
    } catch (e) { addMsg({ role: 'assistant', content: `⚠️ ${e.response?.data?.message || e.message}` }) }
    finally { setBusy(false); setBusyLabel('') }
  }

  // Renderiza uma mensagem (com kinds especiais: plan, wireframe, CTAs).
  const renderMsg = (m, i) => {
    if (m.kind === 'plan' && m.data) {
      const tasks = m.data.content?.plan?.tasks || []
      return (
        <div key={i} className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500"><Sparkles size={15} className="text-white" /></div>
          <div className="w-full max-w-[80%] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="mb-1 text-sm font-semibold text-[var(--color-text)]">{m.data.title}</div>
            {m.data.summary && <p className="mb-2 text-xs text-[var(--color-text-muted)]">{m.data.summary}</p>}
            {tasks.length > 0 && (
              <ol className="list-decimal space-y-1 pl-5 text-xs text-[var(--color-text-muted)]">
                {tasks.slice(0, 15).map((t, k) => <li key={k}>{t.descricao}</li>)}
              </ol>
            )}
          </div>
        </div>
      )
    }
    if (m.kind === 'wireframe' && m.svg) {
      return (
        <div key={i} className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500"><Sparkles size={15} className="text-white" /></div>
          <div className="max-w-[80%] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">Wireframe</div>
            <div className="overflow-auto rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: m.svg }} />
          </div>
        </div>
      )
    }
    const cta = m.kind === 'cta_plan' ? { label: 'Gerar arquitetura + plano', icon: Sparkles, fn: genPlan }
      : m.kind === 'cta_approve' ? { label: 'Aprovar e construir', icon: CheckCircle2, fn: approve }
      : m.kind === 'cta_provision' ? { label: 'Publicar stack dev', icon: Rocket, fn: provision } : null
    return (
      <div key={i}>
        <Bubble role={m.role}>
          {m.content ? <Markdown remarkPlugins={[remarkGfm]} className="prose-builder">{m.content}</Markdown>
            : busy && i === streamIdxRef.current ? <Loader2 size={14} className="animate-spin" /> : null}
        </Bubble>
        {cta && (
          <div className="ml-11 mt-2 flex gap-2">
            <button type="button" onClick={cta.fn} disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">
              <cta.icon size={15} /> {cta.label}
            </button>
            {m.kind === 'cta_approve' && (
              <button type="button" onClick={genWireframe} disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] transition hover:bg-[var(--color-surface)] disabled:opacity-40">
                <ClipboardCheck size={15} /> Ver wireframe
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-140px)] gap-4">
      {publishOpen && publishOpts && (
        <PublishModal opts={publishOpts} busy={busy} onCancel={() => setPublishOpen(false)} onPublish={doPublish} />
      )}
      {workspaceOpen && session && (
        <div className="fixed inset-0 z-40 bg-black/60 p-3 sm:p-6">
          <div className="mx-auto h-full max-w-[1400px]">
            <ProjectWorkspace sessionId={session.id} onClose={() => setWorkspaceOpen(false)} />
          </div>
        </div>
      )}
      {/* Sidebar de projetos */}
      <aside className="hidden w-60 shrink-0 flex-col gap-3 lg:flex">
        <div className="zeus-panel rounded-xl p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]"><Hammer size={16} /> Zeus Builder</div>
          <div className="flex gap-1">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Novo projeto"
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]" />
            <button type="button" onClick={createProject} disabled={busy || !newName.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white disabled:opacity-40"><Plus size={15} /></button>
          </div>
        </div>
        <div className="zeus-panel flex-1 overflow-auto rounded-xl p-2">
          {projects.map((p) => (
            <div key={p.id} className={`group mb-1 flex items-center gap-1 rounded-lg pr-1 transition hover:bg-[var(--color-surface)] ${session?.projectId === p.id ? 'bg-[var(--color-surface)] ring-1 ring-blue-500/40' : ''}`}>
              <button type="button" onClick={() => openSession(p.id)}
                className="flex min-w-0 flex-1 flex-col px-3 py-2 text-left">
                <span className="truncate text-sm text-[var(--color-text)]">{p.name}</span>
                <span className="text-[10px] text-[var(--color-text-muted)]">{p.status}</span>
              </button>
              <button type="button" title="Remover projeto" onClick={(e) => removeProject(e, p)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] opacity-0 transition hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!projects.length && <p className="p-3 text-xs text-[var(--color-text-muted)]">Crie seu primeiro projeto.</p>}
        </div>
      </aside>

      {/* Chat */}
      <div className="zeus-panel flex flex-1 flex-col overflow-hidden rounded-2xl">
        {session ? (
          <>
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <span className="truncate text-sm font-semibold text-[var(--color-text)]">{session.project?.name}</span>
              <Timeline stage={stage} />
            </div>
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto px-4 py-5">
              {messages.map(renderMsg)}
              {pendingQuestions && !busy && (
                <QuestionForm questions={pendingQuestions} disabled={busy} onSubmit={(text) => send(text)} />
              )}
              {buildTasks && <div className="ml-11"><BuildProgress tasks={buildTasks} /></div>}
              {busy && busyLabel && (
                <div className="ml-11 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <Loader2 size={13} className="animate-spin" /> {busyLabel}
                </div>
              )}
            </div>
            <div className="border-t border-[var(--color-border)] p-3">
              {/* Ações persistentes por estágio (sempre corretas após refresh). */}
              {!busy && (
                <StageActions stage={stage} hasPlan={!!activePlan} canReview={!!buildTasks?.length}
                  onPlan={genPlan} onWireframe={genWireframe}
                  onApprove={approve} onBuild={build} onProvision={provision} onReview={doReview}
                  onViewCode={() => setWorkspaceOpen(true)} />
              )}
              {attachment && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text)]">
                  {attachment.kind === 'image' ? <Paperclip size={13} /> : <FileText size={13} />}
                  <span className="truncate">{attachment.name}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {attachment.kind === 'image' ? 'imagem' : attachment.kind === 'pdf' ? 'PDF' : 'texto'}
                  </span>
                  <button type="button" onClick={() => setAttachment(null)} className="ml-auto text-[var(--color-text-muted)] hover:text-red-400"><X size={13} /></button>
                </div>
              )}
              <div className="flex items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2">
                <input ref={fileRef} type="file" className="hidden"
                  accept="image/*,application/pdf,text/*,.txt,.md,.log,.csv,.json,.yml,.yaml,.xml,.env,.ini,.conf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
                <button type="button" title="Anexar arquivo (imagem, PDF, txt, md…)" disabled={busy}
                  onClick={() => fileRef.current?.click()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-40">
                  <Paperclip size={17} />
                </button>
                <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} disabled={busy}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder={stage === 'discovery' ? 'Descreva o que você quer construir… (ou anexe uma tela, log, PDF)' : 'Converse com o arquiteto…'}
                  className="max-h-32 flex-1 resize-none bg-transparent text-sm text-[var(--color-text)] outline-none" />
                <button type="button" onClick={() => send()} disabled={busy || (!input.trim() && !attachment)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-500 disabled:opacity-40">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500"><Hammer size={30} className="text-white" /></div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--color-text)]">Zeus Builder</h2>
              <p className="mt-1 max-w-md text-sm text-[var(--color-text-muted)]">Descreva o que você quer construir e acompanhe, ao vivo, o agente entender, planejar, desenhar e gerar o software.</p>
            </div>
            <div className="flex gap-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome do projeto"
                onKeyDown={(e) => e.key === 'Enter' && createProject()}
                className="w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]" />
              <button type="button" onClick={createProject} disabled={busy || !newName.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                <Plus size={16} /> Começar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
