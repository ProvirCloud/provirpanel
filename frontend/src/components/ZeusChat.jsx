import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, X, Send, Sparkles, Trash2, ClipboardCopy, Square, Check } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../services/api'

const STORAGE_KEY = 'zeus-chat-history'
const loadHistory = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] } catch { return [] } }
const saveHistory = (msgs) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-50))) } catch {} }

const ZeusChat = () => {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(loadHistory)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingPlan, setPendingPlan] = useState(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const contentRef = useRef('')
  const idxRef = useRef(-1)
  const abortRef = useRef(null)

  const scroll = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [])

  useEffect(() => { scroll() }, [messages, scroll])
  useEffect(() => { saveHistory(messages) }, [messages])
  useEffect(() => {
    if (open) {
      setTimeout(() => { scroll(); inputRef.current?.focus() }, 100)
    }
  }, [open, scroll])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setLoading(true)

    const history = messages.filter(m => !m.error).slice(-10).map(m => ({ role: m.role, content: m.content }))
    const idx = messages.length + 1
    idxRef.current = idx
    contentRef.current = ''
    setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const token = localStorage.getItem('provirpanel-token')
      const baseURL = api.defaults.baseURL || '/api'
      const res = await fetch(`${baseURL}/zeus/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: text, history }),
        signal: controller.signal
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      const toolLabels = {
        list_services: 'Consultando serviços Docker',
        get_service_metrics: 'Obtendo métricas do serviço',
        list_docker_containers: 'Listando containers Docker',
        list_databases: 'Consultando bancos de dados',
        list_sites: 'Listando sites',
        get_server_metrics: 'Obtendo métricas do servidor',
        list_nginx: 'Consultando Nginx'
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'tool_call') {
              const label = toolLabels[ev.name] || `Executando ${ev.name}`
              contentRef.current += `\n🔧 _${label}..._\n`
              const c = contentRef.current
              setMessages(prev => { const u = [...prev]; if (u[idx]) u[idx] = { ...u[idx], content: c }; return u })
            } else if (ev.type === 'tool_result') {
              if (ev.error) {
                contentRef.current += `\n⚠️ _Falha em ${ev.name}: ${ev.result?.error || 'erro'}_\n`
                const c = contentRef.current
                setMessages(prev => { const u = [...prev]; if (u[idx]) u[idx] = { ...u[idx], content: c }; return u })
              }
            } else if (ev.type === 'token') {
              // Resposta final do agente (texto completo)
              contentRef.current = ev.content
              const c = contentRef.current
              setMessages(prev => { const u = [...prev]; if (u[idx]) u[idx] = { ...u[idx], content: c }; return u })
            } else if (ev.type === 'error') {
              setMessages(prev => { const u = [...prev]; if (u[idx]) u[idx] = { role: 'assistant', content: ev.error, error: true }; return u })
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => { const u = [...prev]; if (u[idxRef.current]) u[idxRef.current] = { role: 'assistant', content: err.message, error: true }; return u })
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()
  const clearChat = () => { setMessages([]); localStorage.removeItem(STORAGE_KEY); setPendingPlan(null) }

  const confirmPlan = async () => {
    if (!pendingPlan || loading) return
    const plan = pendingPlan
    setPendingPlan(null)
    setLoading(true)

    const idx = messages.length
    idxRef.current = idx
    contentRef.current = '⚡ Executando plano...\n\n'
    setMessages(prev => [...prev, { role: 'assistant', content: contentRef.current }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const token = localStorage.getItem('provirpanel-token')
      const baseURL = api.defaults.baseURL || '/api'
      const res = await fetch(`${baseURL}/zeus/chat/smart/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ plan }),
        signal: controller.signal
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'token') {
              // Output completo virá no task_complete — não acumula tokens (evita duplicação).
            } else if (ev.type === 'task_start') {
              contentRef.current += `\n---\n🔄 **Task ${ev.taskId}:** ${ev.descricao}\n\n`
            } else if (ev.type === 'task_complete') {
              const out = (ev.resultado || '').trim()
              contentRef.current += out ? `${out}\n\n✅ **Task ${ev.taskId} concluída**\n` : `✅ **Task ${ev.taskId} concluída**\n`
            } else if (ev.type === 'all_complete') {
              contentRef.current += `\n\n---\n🎉 **Todas as tarefas concluídas!**`
            }
            const c = contentRef.current
            setMessages(prev => { const u = [...prev]; if (u[idx]) u[idx] = { ...u[idx], content: c }; return u })
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => { const u = [...prev]; if (u[idxRef.current]) u[idxRef.current] = { role: 'assistant', content: err.message, error: true }; return u })
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const rejectPlan = () => { setPendingPlan(null) }
  const [copiedIdx, setCopiedIdx] = useState(null)
  const copy = (text, idx) => {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2 rounded-[16px] px-4 py-3 text-sm font-medium text-white shadow-lg transition-all hover:scale-105 sm:bottom-6 sm:right-6 sm:px-5"
        style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))', boxShadow: '0 4px 24px rgba(56,162,255,0.3)' }}>
        <Sparkles size={16} />
        <span className="hidden sm:inline">Zeus AI</span>
      </button>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm sm:hidden" onClick={() => setOpen(false)} />
      <div className="zeus-panel-elevated fixed inset-0 z-[9999] flex flex-col sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[620px] sm:w-[420px] sm:rounded-[20px] md:bottom-6 md:right-6 md:w-[440px]"
        style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px var(--color-border)' }}>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-4 py-3 sm:px-5 sm:py-4"
          style={{ background: 'linear-gradient(135deg, rgba(56,162,255,0.15), rgba(56,162,255,0.05))', borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{ background: 'linear-gradient(145deg, rgba(56,162,255,0.25), rgba(56,162,255,0.10))', border: '1px solid rgba(99,185,255,0.36)' }}>
              <Bot size={16} style={{ color: 'var(--color-brand)' }} />
            </div>
            <div>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Zeus AI</span>
              <span className="ml-2 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}>AGENTE</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={clearChat} className="flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors hover:opacity-80"
              style={{ color: 'var(--color-text-muted)' }} title="Limpar"><Trash2 size={13} /></button>
            <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors hover:opacity-80"
              style={{ color: 'var(--color-text-muted)' }}><X size={15} /></button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-4 sm:px-4" style={{ background: 'var(--color-surface-sunken)' }}>
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[16px]"
                style={{ background: 'linear-gradient(145deg, rgba(56,162,255,0.20), rgba(56,162,255,0.08))', border: '1px solid rgba(99,185,255,0.30)' }}>
                <Sparkles size={24} style={{ color: 'var(--color-brand)' }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Zeus AI Assistant</p>
              <p className="mt-2 text-xs leading-5" style={{ color: 'var(--color-text-muted)' }}>
                Pergunte sobre sites, containers, infraestrutura, código ou documentação.
              </p>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role === 'user') return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-[14px] rounded-br-sm px-3.5 py-2.5 text-[13px] text-white whitespace-pre-wrap"
                  style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }}>
                  {msg.content}
                </div>
              </div>
            )
            return (
              <div key={i} className="flex gap-2.5">
                <div className="shrink-0 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full"
                  style={{ background: 'rgba(56,162,255,0.1)' }}>
                  <Bot size={12} style={{ color: 'var(--color-brand)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  {msg.error ? (
                    <p className="text-[13px] px-3 py-2 rounded-[14px]" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)' }}>{msg.content}</p>
                  ) : (
                    <div className="rounded-[14px] px-3.5 py-2.5" style={{ background: 'var(--card-bg-elevated)', border: '1px solid var(--color-border)' }}>
                      <div className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed
                        prose-p:my-1.5 prose-headings:my-2 prose-headings:text-sm prose-headings:font-semibold
                        prose-li:my-0.5 prose-ul:my-1.5
                        prose-code:text-[12px] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-normal
                        prose-pre:my-2 prose-pre:rounded-lg prose-pre:text-[12px]
                        prose-a:no-underline hover:prose-a:underline
                        prose-blockquote:text-[13px] prose-blockquote:my-2"
                        style={{ '--tw-prose-body': 'var(--color-text)', '--tw-prose-headings': 'var(--color-text)', '--tw-prose-code': 'var(--color-brand)', '--tw-prose-pre-bg': 'var(--color-surface-sunken)', '--tw-prose-pre-code': 'var(--color-text-muted)', '--tw-prose-links': 'var(--color-brand)', '--tw-prose-quotes': 'var(--color-text-muted)', '--tw-prose-quote-borders': 'var(--color-brand)' }}>
                        <Markdown remarkPlugins={[remarkGfm]}>{msg.content || (loading && i === idxRef.current ? '▊' : '')}</Markdown>
                      </div>
                      {msg.content && !loading && (
                        <div className="flex items-center gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                          <button onClick={() => copy(msg.content, i)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors hover:opacity-80"
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
            <div className="flex gap-2.5">
              <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full" style={{ background: 'rgba(56,162,255,0.1)' }}>
                <Bot size={12} style={{ color: 'var(--color-brand)' }} />
              </div>
              <div className="flex items-center gap-1.5 py-2">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--color-brand)' }} />
                <span className="w-1.5 h-1.5 rounded-full animate-pulse [animation-delay:150ms]" style={{ background: 'var(--color-brand)' }} />
                <span className="w-1.5 h-1.5 rounded-full animate-pulse [animation-delay:300ms]" style={{ background: 'var(--color-brand)' }} />
              </div>
            </div>
          )}
        </div>

        {/* Plan confirmation bar */}
        {pendingPlan && !loading && (
          <div className="shrink-0 px-3 py-2 sm:px-4 flex items-center gap-2"
            style={{ background: 'rgba(56,162,255,0.08)', borderTop: '1px solid var(--color-border)' }}>
            <Sparkles size={14} style={{ color: 'var(--color-brand)' }} />
            <span className="text-xs flex-1" style={{ color: 'var(--color-text-muted)' }}>Executar este plano?</span>
            <button onClick={rejectPlan}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
              Cancelar
            </button>
            <button onClick={confirmPlan}
              className="px-3 py-1.5 text-xs rounded-lg text-white font-medium transition-all"
              style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))', boxShadow: '0 2px 8px rgba(56,162,255,0.3)' }}>
              ✓ Confirmar e Executar
            </button>
          </div>
        )}

        {/* Input */}
        <div className="shrink-0 px-3 py-3 sm:px-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder="Pergunte algo..."
              rows={1}
              className="flex-1 resize-none rounded-[12px] px-3.5 py-2.5 text-sm outline-none transition-colors"
              style={{ background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', color: 'var(--color-text)', maxHeight: '100px' }}
              onFocus={e => e.target.style.borderColor = 'var(--color-brand)'}
              onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
            />
            {loading ? (
              <button onClick={stop}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] transition-all sm:h-9 sm:w-9"
                style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)' }}>
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button onClick={sendMessage} disabled={!input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed sm:h-9 sm:w-9"
                style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))', boxShadow: input.trim() ? '0 2px 12px rgba(56,162,255,0.3)' : 'none' }}>
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default ZeusChat
