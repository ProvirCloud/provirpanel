import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Send, Square, Plus, Trash2, Pencil, MessageSquare, Sparkles, Check, X, ClipboardCopy, PanelLeftClose, PanelLeft, Paperclip, Boxes, FileText, GraduationCap, ScrollText, SearchCheck, HardDrive, Globe, Wand2 } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../services/api'
import useZeusStream from '../hooks/useZeusStream'
import AiBlocks from '../components/ai-blocks/AiBlocks'

// Agentes disponíveis (11 harnesses do AgentCore) + Auto.
const AGENTS = [
  { id: 'auto', label: 'Auto (recomendado)' },
  { id: 'desenvolvedor', label: 'Desenvolvedor' },
  { id: 'arquiteto_software', label: 'Arquiteto de Software' },
  { id: 'arquiteto_nuvem', label: 'Arquiteto de Nuvem' },
  { id: 'webdesigner', label: 'Web Designer' },
  { id: 'ux_designer', label: 'UX Designer' },
  { id: 'gerente_negocios', label: 'Gerente de Negócios' },
  { id: 'comercial', label: 'Comercial' },
  { id: 'juridico', label: 'Jurídico' },
  { id: 'atendimento', label: 'Atendimento' },
  { id: 'planejador', label: 'Planejador' },
  { id: 'gerente_projeto', label: 'Gerente de Projeto' },
]

// Opções de intenção do anexo (5.1). soon=true → desabilitada ("em breve").
const UPLOAD_INTENTS = [
  { id: 'auto', label: 'Auto (detectar)', icon: Wand2 },
  { id: 'create_service', label: 'Criar serviço', icon: Boxes },
  { id: 'documentation', label: 'Documentação', icon: FileText },
  { id: 'training', label: 'Treinamento', icon: GraduationCap },
  { id: 'analyze_logs', label: 'Analisar logs', icon: ScrollText },
  { id: 'inspect', label: 'Averiguar', icon: SearchCheck },
  { id: 'store', label: 'Só guardar', icon: HardDrive },
  { id: 'publish_site', label: 'Publicar site', icon: Globe, soon: true },
]

const TOOL_LABELS = {
  list_services: 'Consultando serviços', get_service_metrics: 'Obtendo métricas do serviço',
  list_docker_containers: 'Listando containers', list_databases: 'Consultando bancos',
  list_sites: 'Listando sites', get_server_metrics: 'Obtendo métricas do servidor',
  list_nginx: 'Consultando Nginx',
}

const AssistantPage = () => {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [agent, setAgent] = useState('auto')
  const [pendingAction, setPendingAction] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [copiedIdx, setCopiedIdx] = useState(null)
  const [storages, setStorages] = useState([])
  const [uploading, setUploading] = useState(false)
  const [intentMenuOpen, setIntentMenuOpen] = useState(false)
  const pendingIntentRef = useRef('auto')
  const fileRef = useRef(null)

  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const contentRef = useRef('')
  const idxRef = useRef(-1)
  const { sendMessage, confirmAction, stop } = useZeusStream()

  const scroll = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [])
  useEffect(() => { scroll() }, [messages, scroll])

  // ── Carrega lista de conversas ──
  const loadConversations = useCallback(async () => {
    try {
      const { data } = await api.get('/ai/conversations')
      setConversations(data.conversations || [])
      return data.conversations || []
    } catch { return [] }
  }, [])

  // ── Abre uma conversa (carrega mensagens) ──
  const openConversation = useCallback(async (id) => {
    setActiveId(id)
    setPendingAction(null)
    try {
      const { data } = await api.get(`/ai/conversations/${id}`)
      setAgent(data.conversation?.agent || 'auto')
      setMessages((data.messages || []).map((m) => ({
        role: m.role, content: m.content || '', blocks: m.blocks || null, resolved: true,
      })))
    } catch {
      setMessages([])
    }
  }, [])

  // ── Bootstrap: ao entrar (ou voltar) na página, abre a última conversa ativa
  // (a mais recente — a lista vem ordenada por updated_at DESC). Roda só uma vez.
  const bootstrappedRef = useRef(false)
  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true
    ;(async () => {
      const list = await loadConversations()
      if (list.length && !activeId) {
        openConversation(list[0].id)
      }
    })()
  }, [loadConversations, openConversation, activeId])

  // ── Nova conversa ──
  const newConversation = useCallback(async () => {
    try {
      const { data } = await api.post('/ai/conversations', { agent })
      await loadConversations()
      setActiveId(data.conversation.id)
      setMessages([])
      setPendingAction(null)
      setTimeout(() => inputRef.current?.focus(), 50)
    } catch { /* noop */ }
  }, [agent, loadConversations])

  const ensureConversation = useCallback(async () => {
    if (activeId) return activeId
    const { data } = await api.post('/ai/conversations', { agent })
    setActiveId(data.conversation.id)
    loadConversations()
    return data.conversation.id
  }, [activeId, agent, loadConversations])

  // ── Envio de mensagem ──
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setLoading(true)
    const convId = await ensureConversation()

    const history = messages.filter((m) => !m.error).slice(-10).map((m) => ({ role: m.role, content: m.content }))
    const baseIdx = messages.length + 1
    idxRef.current = baseIdx
    contentRef.current = ''
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }])

    const patch = (updater) => setMessages((prev) => {
      const u = [...prev]
      if (u[baseIdx]) u[baseIdx] = updater(u[baseIdx])
      return u
    })

    try {
      await sendMessage({ message: text, history, conversationId: convId, agent }, (ev) => {
        if (ev.type === 'tool_call') {
          contentRef.current += `\n🔧 _${TOOL_LABELS[ev.name] || `Executando ${ev.name}`}..._\n`
          patch((m) => ({ ...m, content: contentRef.current }))
        } else if (ev.type === 'tool_result' && ev.error) {
          contentRef.current += `\n⚠️ _Falha em ${ev.name}_\n`
          patch((m) => ({ ...m, content: contentRef.current }))
        } else if (ev.type === 'token') {
          contentRef.current = ev.content
          patch((m) => ({ ...m, content: contentRef.current }))
        } else if (ev.type === 'block') {
          patch((m) => ({ ...m, blocks: [...(m.blocks || []), ev.block] }))
        } else if (ev.type === 'action_proposal') {
          setPendingAction(ev.action)
          patch((m) => ({ ...m, blocks: [{ kind: 'action_proposal', action: ev.action, meta: ev.meta }] }))
        } else if (ev.type === 'error') {
          patch(() => ({ role: 'assistant', content: ev.error, error: true }))
        }
      })
      // Atualiza título/ordenação da lista após o turno
      loadConversations()
    } catch (err) {
      if (err.name !== 'AbortError') patch(() => ({ role: 'assistant', content: err.message, error: true }))
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, agent, ensureConversation, sendMessage, loadConversations])

  // ── Confirmar ação proposta ──
  const handleConfirmAction = useCallback(async (action) => {
    if (loading) return
    setPendingAction(null)
    setLoading(true)
    const idx = messages.length
    contentRef.current = `⚡ Executando \`${action.tool}\`...\n\n`
    setMessages((prev) => [...prev, { role: 'assistant', content: contentRef.current }])
    const patch = (updater) => setMessages((prev) => { const u = [...prev]; if (u[idx]) u[idx] = updater(u[idx]); return u })
    try {
      await confirmAction({ action }, (ev) => {
        if (ev.type === 'action_result') {
          contentRef.current += `✅ **Ação executada.**\n\n\`\`\`json\n${JSON.stringify(ev.result, null, 2)}\n\`\`\`${ev.rollback ? `\n\n↩️ _Rollback: ${ev.rollback.type || ''}_` : ''}`
        } else if (ev.type === 'action_error') {
          contentRef.current += `❌ **Falha:** ${ev.error}`
        } else if (ev.type === 'action_running') {
          contentRef.current += `⏳ Executando...\n\n`
        } else if (ev.type === 'error') {
          contentRef.current += `❌ ${ev.error}`
        }
        patch((m) => ({ ...m, content: contentRef.current }))
      })
    } catch (err) {
      if (err.name !== 'AbortError') patch(() => ({ role: 'assistant', content: err.message, error: true }))
    } finally {
      setLoading(false)
    }
  }, [loading, messages, confirmAction])

  // ── Ações da lista de conversas ──
  const renameConversation = async (id) => {
    const title = editTitle.trim()
    setEditingId(null)
    if (!title) return
    try { await api.patch(`/ai/conversations/${id}`, { title }); loadConversations() } catch { /* noop */ }
  }
  const deleteConversation = async (id) => {
    try {
      await api.delete(`/ai/conversations/${id}`)
      if (id === activeId) { setActiveId(null); setMessages([]) }
      loadConversations()
    } catch { /* noop */ }
  }

  const copy = (text, idx) => {
    navigator.clipboard.writeText(text); setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1500)
  }

  // Troca o agente; se houver conversa ativa, persiste a escolha nela.
  const handleAgentChange = useCallback(async (next) => {
    setAgent(next)
    if (activeId) {
      try { await api.patch(`/ai/conversations/${activeId}`, { agent: next }); loadConversations() } catch { /* noop */ }
    }
  }, [activeId, loadConversations])

  // Carrega storages disponíveis (para o bloco de upload oferecer destinos).
  useEffect(() => {
    api.get('/ai/storages').then(({ data }) => setStorages(data.storages || [])).catch(() => {})
  }, [])

  // ── Upload de arquivo: cria a conversa se preciso, envia, e faz poll da análise ──
  const handleFile = useCallback(async (file) => {
    if (!file || uploading) return
    const intent = pendingIntentRef.current || 'auto'
    pendingIntentRef.current = 'auto'
    setUploading(true)
    const convId = await ensureConversation()
    const intentLabel = (UPLOAD_INTENTS.find((x) => x.id === intent) || {}).label || ''
    // mensagem do usuário representando o anexo
    setMessages((prev) => [...prev, { role: 'user', content: `📎 ${file.name}${intent !== 'auto' ? ` — ${intentLabel}` : ''}` }])
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('conversationId', convId)
      form.append('intent', intent)
      const token = localStorage.getItem('provirpanel-token')
      const res = await fetch(`${api.defaults.baseURL || '/api'}/ai/uploads`, {
        method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: form,
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`) }
      const { uploadId, kind, filename } = await res.json()

      // placeholder de "analisando"
      const analyzingMsg = { role: 'assistant', content: '', blocks: [{ kind: 'upload_analysis', uploadId, uploadKind: kind, filename, intent, status: 'analyzing', analysis: { summary: 'Analisando o arquivo...' } }] }
      setMessages((prev) => [...prev, analyzingMsg])

      // poll da análise
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1200))
        const { data } = await api.get(`/ai/uploads/${uploadId}`)
        const u = data.upload
        if (['done', 'awaiting_user', 'error'].includes(u.status)) {
          setMessages((prev) => {
            const copy = [...prev]
            const target = copy.findIndex((m) => m.blocks?.some((b) => b.uploadId === uploadId))
            if (target >= 0) {
              copy[target] = { ...copy[target], blocks: [{ kind: 'upload_analysis', uploadId, uploadKind: u.kind, intent: u.intent, filename: u.filename, status: u.status === 'error' ? 'error' : (u.analysis?.suggestion?.action === 'ask_destination' ? 'awaiting_user' : u.status), analysis: u.error ? { summary: `Erro: ${u.error}`, suggestion: {} } : u.analysis }] }
            }
            return copy
          })
          break
        }
      }
      loadConversations()
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: err.message, error: true }])
    } finally {
      setUploading(false)
    }
  }, [uploading, ensureConversation, loadConversations])

  // ── Decisão sobre o upload (publicar / salvar / descartar) ──
  const handleUploadDecision = useCallback(async (uploadId, action, target) => {
    // Publicar sistema → inicia o WIZARD guiado no chat (5.3).
    if (action === 'publish_system') {
      try {
        const { data } = await api.post('/ai/publish/start', { uploadId })
        // marca o upload como resolvido e adiciona um bloco de wizard
        setMessages((prev) => {
          const copy = prev.map((m) => ({ ...m, blocks: m.blocks?.map((b) => b.uploadId === uploadId ? { ...b, status: 'done', resultNote: 'Iniciando publicação guiada…' } : b) }))
          return [...copy, { role: 'assistant', content: '', blocks: [{ kind: 'publish_wizard', wizard: { step: data.step, index: data.index, total: data.total, wizardId: data.wizardId } }] }]
        })
      } catch (err) {
        const msg = err.response?.data?.error || err.message
        setMessages((prev) => [...prev, { role: 'assistant', content: msg, error: true }])
      }
      return
    }
    try {
      const { data } = await api.post(`/ai/uploads/${uploadId}/decision`, { action, target })
      let note = 'Concluído.'
      if (action === 'save_local' && data.savedTo) note = `Salvo em ${data.savedTo}`
      else if (action === 'index_kb') note = data.note || 'Preparado para indexação no conhecimento.'
      else if (action === 'describe') note = 'Inspeção concluída.'
      else if (action === 'discard') note = 'Arquivo descartado.'
      setMessages((prev) => prev.map((m) => ({
        ...m,
        blocks: m.blocks?.map((b) => b.uploadId === uploadId ? { ...b, status: 'done', resultNote: note } : b),
      })))
    } catch (err) {
      const msg = err.response?.data?.error || err.message
      setMessages((prev) => [...prev, { role: 'assistant', content: msg, error: true }])
    }
  }, [])

  // ── Conduz o wizard de publicação (answer/generate/confirm) ──
  const handleWizard = useCallback(async (block, action, extra = {}) => {
    const wz = block.wizard || {}
    const wizardId = wz.wizardId
    const updateBlock = (patch) => setMessages((prev) => prev.map((m) => ({
      ...m, blocks: m.blocks?.map((b) => (b.kind === 'publish_wizard' && b.wizard?.wizardId === wizardId) ? { ...b, wizard: { ...b.wizard, ...patch } } : b),
    })))
    try {
      if (action === 'generate') {
        const { data } = await api.post('/ai/publish/generate-secret', {})
        if (extra.setVal) extra.setVal(data.value)
        return
      }
      if (action === 'answer') {
        const { data } = await api.post('/ai/publish/answer', { wizardId, value: extra.value })
        if (data.cancelled) { updateBlock({ step: null, warning: null, done: true, result: 'Publicação cancelada.' }); return }
        if (data.warning) { updateBlock({ warning: data.warning, suggestion: data.suggestion }); return }
        updateBlock({ step: data.step || null, index: data.index, total: data.total, summary: data.summary, warning: null, done: !!data.done })
        return
      }
      if (action === 'confirm') {
        updateBlock({ step: { kind: 'review', title: 'Publicando…', prompt: 'Criando o serviço, enviando o código e configurando o domínio. Isso pode levar alguns minutos.' } })
        const { data } = await api.post('/ai/publish/confirm', { wizardId })
        const stepLabel = { create_service: 'Serviço criado', deploy_code: 'Código publicado', nginx_vhost: 'Domínio configurado' }
        const lines = (data.steps || []).map((s) => `${s.ok ? '✅' : '⚠️'} ${stepLabel[s.step] || s.step}${s.error ? `: ${s.error}` : ''}`)
        const result = `Serviço "${data.summary?.name}".\n${lines.join('\n')}${data.ok ? '\n\nTudo pronto! Verifique na página de serviços.' : '\n\nConcluído com avisos — veja acima.'}`
        updateBlock({ step: null, done: true, result })
        return
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message
      updateBlock({ warning: msg })
    }
  }, [])

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[520px] overflow-hidden rounded-[18px]"
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface-sunken)' }}>

      {/* Sidebar de conversas */}
      {sidebarOpen && (
        <div className="flex w-[260px] shrink-0 flex-col border-r" style={{ borderColor: 'var(--color-border)', background: 'var(--card-bg-elevated)' }}>
          <div className="p-3">
            <button onClick={newConversation}
              className="flex w-full items-center justify-center gap-2 rounded-[12px] px-3 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }}>
              <Plus size={16} /> Nova conversa
            </button>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            {conversations.length === 0 && (
              <p className="px-3 py-6 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>Nenhuma conversa ainda.</p>
            )}
            {conversations.map((c) => (
              <div key={c.id}
                className={`group flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-sm transition-colors cursor-pointer ${c.id === activeId ? '' : 'hover:opacity-80'}`}
                style={{ background: c.id === activeId ? 'var(--color-brand-soft)' : 'transparent', color: 'var(--color-text)' }}
                onClick={() => openConversation(c.id)}>
                <MessageSquare size={14} style={{ color: 'var(--color-text-muted)' }} className="shrink-0" />
                {editingId === c.id ? (
                  <input autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => renameConversation(c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') renameConversation(c.id); if (e.key === 'Escape') setEditingId(null) }}
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 flex-1 rounded bg-transparent px-1 text-sm outline-none"
                    style={{ border: '1px solid var(--color-brand)', color: 'var(--color-text)' }} />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                )}
                <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditTitle(c.title) }}
                    className="rounded p-1 hover:opacity-70" style={{ color: 'var(--color-text-muted)' }} title="Renomear"><Pencil size={12} /></button>
                  <button onClick={(e) => { e.stopPropagation(); deleteConversation(c.id) }}
                    className="rounded p-1 hover:opacity-70" style={{ color: 'var(--color-danger)' }} title="Excluir"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Área principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header com seletor de agente */}
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--card-bg-elevated)' }}>
          <button onClick={() => setSidebarOpen((v) => !v)} className="rounded-lg p-1.5 hover:opacity-70" style={{ color: 'var(--color-text-muted)' }} title="Alternar painel">
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px]"
            style={{ background: 'linear-gradient(145deg, rgba(56,162,255,0.25), rgba(56,162,255,0.10))', border: '1px solid rgba(99,185,255,0.36)' }}>
            <Bot size={16} style={{ color: 'var(--color-brand)' }} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Zeus AI</div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Assistente do Provir Cloud Panel</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Modelo</label>
            <select value={agent} onChange={(e) => handleAgentChange(e.target.value)} className="zeus-select text-xs" style={{ maxWidth: 200 }}>
              {AGENTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
        </div>

        {/* Mensagens */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5"
          onDragOver={(e) => { e.preventDefault() }}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) }}>
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[18px]"
                style={{ background: 'linear-gradient(145deg, rgba(56,162,255,0.20), rgba(56,162,255,0.08))', border: '1px solid rgba(99,185,255,0.30)' }}>
                <Sparkles size={28} style={{ color: 'var(--color-brand)' }} />
              </div>
              <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Como posso ajudar?</p>
              <p className="mt-2 max-w-md text-sm leading-6" style={{ color: 'var(--color-text-muted)' }}>
                Pergunte sobre serviços, containers, sites, métricas, código ou infraestrutura.
                Posso consultar o sistema e propor ações (com confirmação).
              </p>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role === 'user') return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-[14px] rounded-br-sm px-4 py-2.5 text-[13px] text-white"
                  style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }}>{msg.content}</div>
              </div>
            )
            const isActive = pendingAction && msg.blocks?.some((b) => b.kind === 'action_proposal') && !msg.resolved
            return (
              <div key={i} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(56,162,255,0.1)' }}>
                  <Bot size={13} style={{ color: 'var(--color-brand)' }} />
                </div>
                <div className="min-w-0 flex-1">
                  {msg.error ? (
                    <p className="rounded-[14px] px-3 py-2 text-[13px]" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)' }}>{msg.content}</p>
                  ) : (
                    <div className="rounded-[14px] px-4 py-3" style={{ background: 'var(--card-bg-elevated)', border: '1px solid var(--color-border)' }}>
                      <div className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed prose-pre:my-2 prose-pre:rounded-lg prose-pre:text-[12px] prose-p:my-1.5"
                        style={{ '--tw-prose-body': 'var(--color-text)', '--tw-prose-headings': 'var(--color-text)', '--tw-prose-code': 'var(--color-brand)', '--tw-prose-pre-bg': 'var(--color-surface-sunken)', '--tw-prose-links': 'var(--color-brand)' }}>
                        <Markdown remarkPlugins={[remarkGfm]}>{msg.content || (loading && i === idxRef.current ? '▊' : '')}</Markdown>
                      </div>
                      <AiBlocks blocks={msg.blocks}
                        onConfirmAction={isActive ? handleConfirmAction : null}
                        onRejectAction={isActive ? () => setPendingAction(null) : null}
                        onUploadDecision={handleUploadDecision}
                        onWizard={handleWizard}
                        storages={storages}
                        disabled={loading} />
                      {msg.content && !loading && (
                        <div className="mt-2 flex items-center gap-2 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
                          <button onClick={() => copy(msg.content, i)} className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] hover:opacity-80"
                            style={{ color: copiedIdx === i ? 'var(--color-brand)' : 'var(--color-text-muted)' }}>
                            {copiedIdx === i ? <><Check size={10} /> Copiado!</> : <><ClipboardCopy size={10} /> Copiar</>}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {loading && !contentRef.current && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'rgba(56,162,255,0.1)' }}><Bot size={13} style={{ color: 'var(--color-brand)' }} /></div>
              <div className="flex items-center gap-1.5 py-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--color-brand)' }} />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:150ms]" style={{ background: 'var(--color-brand)' }} />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:300ms]" style={{ background: 'var(--color-brand)' }} />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t px-4 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--card-bg-elevated)' }}>
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
            <div className="relative shrink-0">
              {intentMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setIntentMenuOpen(false)} />
                  <div className="absolute bottom-12 left-0 z-[61] w-56 overflow-hidden rounded-[12px] py-1 shadow-lg"
                    style={{ background: 'var(--card-bg-elevated)', border: '1px solid var(--color-border)' }}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>O que fazer com o arquivo?</div>
                    {UPLOAD_INTENTS.map((it) => {
                      const Icon = it.icon
                      return (
                        <button key={it.id} disabled={it.soon}
                          onClick={() => { if (it.soon) return; pendingIntentRef.current = it.id; setIntentMenuOpen(false); fileRef.current?.click() }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                          style={{ color: 'var(--color-text)' }}>
                          <Icon size={14} style={{ color: 'var(--color-brand)' }} />
                          <span className="flex-1">{it.label}</span>
                          {it.soon ? <span className="rounded-full px-1.5 py-0.5 text-[9px] uppercase" style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text-muted)' }}>em breve</span> : null}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
              <button onClick={() => setIntentMenuOpen((v) => !v)} disabled={uploading || loading}
                title="Anexar arquivo com intenção"
                className="flex h-11 w-11 items-center justify-center rounded-[12px] transition-colors disabled:opacity-40"
                style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                <Paperclip size={16} />
              </button>
            </div>
            <textarea ref={inputRef} value={input} rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Escreva sua mensagem..."
              className="max-h-[140px] flex-1 resize-none rounded-[12px] px-4 py-3 text-sm outline-none"
              style={{ background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--color-brand)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--color-border)')} />
            {loading ? (
              <button onClick={stop} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)' }}>
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button onClick={handleSend} disabled={!input.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-white transition-all disabled:cursor-not-allowed disabled:opacity-30"
                style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }}>
                <Send size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AssistantPage
