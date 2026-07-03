import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, X, Send, Loader2, Sparkles, Trash2 } from 'lucide-react'
import api from '../services/api'

const STORAGE_KEY = 'zeus-chat-history'

const loadHistory = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch { return [] }
}

const saveHistory = (messages) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)))
  } catch {}
}

const ZeusChat = () => {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(loadHistory)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])
  useEffect(() => { saveHistory(messages) }, [messages])

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    setMessages(prev => [...prev, { role: 'user', content: text, ts: Date.now() }])
    setInput('')
    setLoading(true)

    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const res = await api.post('/zeus/chat', { message: text, history })
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.data.answer,
        sources: res.data.sources,
        model: res.data.model,
        ts: Date.now()
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Erro: ${err.response?.data?.error || err.message}`,
        error: true,
        ts: Date.now()
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearChat = () => {
    setMessages([])
    localStorage.removeItem(STORAGE_KEY)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2 rounded-[16px] px-4 py-3 text-sm font-medium text-white shadow-lg transition-all hover:scale-105 sm:bottom-6 sm:right-6 sm:px-5"
        style={{
          background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))',
          boxShadow: '0 4px 24px rgba(56,162,255,0.3), inset 0 1px 0 rgba(255,255,255,0.15)'
        }}
      >
        <Sparkles size={16} />
        <span className="hidden sm:inline">Zeus AI</span>
      </button>
    )
  }

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm sm:hidden"
        onClick={() => setOpen(false)}
      />

      <div
        className="zeus-panel-elevated fixed inset-0 z-[9999] flex flex-col sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[620px] sm:w-[420px] sm:rounded-[20px] md:bottom-6 md:right-6 md:w-[440px]"
        style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px var(--color-border)' }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between px-4 py-3 sm:px-5 sm:py-4"
          style={{
            background: 'linear-gradient(135deg, rgba(56,162,255,0.15), rgba(56,162,255,0.05))',
            borderBottom: '1px solid var(--color-border)'
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{
                background: 'linear-gradient(145deg, rgba(56,162,255,0.25), rgba(56,162,255,0.10))',
                border: '1px solid rgba(99,185,255,0.36)',
                boxShadow: '0 0 12px rgba(56,162,255,0.2)'
              }}
            >
              <Bot size={16} style={{ color: 'var(--color-brand)' }} />
            </div>
            <div>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Zeus AI</span>
              <span
                className="ml-2 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}
              >
                RAG
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={clearChat}
              className="flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors hover:opacity-80"
              style={{ color: 'var(--color-text-muted)' }}
              title="Limpar histórico"
            >
              <Trash2 size={13} />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors hover:opacity-80"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 sm:px-4" style={{ background: 'var(--color-surface-sunken)' }}>
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <div
                className="mb-4 flex h-14 w-14 items-center justify-center rounded-[16px]"
                style={{
                  background: 'linear-gradient(145deg, rgba(56,162,255,0.20), rgba(56,162,255,0.08))',
                  border: '1px solid rgba(99,185,255,0.30)'
                }}
              >
                <Sparkles size={24} style={{ color: 'var(--color-brand)' }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Zeus AI Assistant</p>
              <p className="mt-2 text-xs leading-5" style={{ color: 'var(--color-text-muted)' }}>
                Pergunte sobre sites, containers, infraestrutura, código ou documentação.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[90%] rounded-[14px] px-3.5 py-2.5 text-[13px] leading-relaxed sm:max-w-[85%] ${
                  msg.role === 'user' ? 'text-white' : ''
                }`}
                style={
                  msg.role === 'user'
                    ? { background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }
                    : msg.error
                      ? { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--color-danger)' }
                      : { background: 'var(--card-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
                }
              >
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-muted)' }}>Fontes</p>
                    {msg.sources.filter(s => s.score > 0.3).slice(0, 3).map((s, j) => (
                      <p key={j} className="text-[10px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                        📄 {s.source} ({Math.round(s.score * 100)}%)
                      </p>
                    ))}
                  </div>
                )}
                {msg.model && (
                  <p className="mt-1.5 text-[10px]" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
                    {msg.model}
                  </p>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div
                className="flex items-center gap-2 rounded-[14px] px-3.5 py-2.5"
                style={{ background: 'var(--card-bg-elevated)', border: '1px solid var(--color-border)' }}
              >
                <Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-brand)' }} />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Pensando...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-3 py-3 sm:px-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte algo..."
              rows={1}
              className="flex-1 resize-none rounded-[12px] px-3.5 py-2.5 text-sm outline-none transition-colors"
              style={{
                background: 'var(--color-surface-sunken)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                maxHeight: '100px'
              }}
              onFocus={e => e.target.style.borderColor = 'var(--color-brand)'}
              onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed sm:h-9 sm:w-9"
              style={{
                background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))',
                boxShadow: input.trim() && !loading ? '0 2px 12px rgba(56,162,255,0.3)' : 'none'
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export default ZeusChat
