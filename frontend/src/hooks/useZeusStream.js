import { useRef, useCallback } from 'react'
import api from '../services/api'

/**
 * useZeusStream — encapsula o streaming SSE do agente Zeus (/zeus/agent) e a
 * execução de ações confirmadas (/zeus/agent/confirm).
 *
 * Não guarda estado de mensagens; recebe callbacks para o consumidor atualizar
 * a sua própria lista. Assim serve tanto ao widget flutuante quanto à página.
 *
 * Eventos SSE tratados: provider, tool_call, tool_result, token, action_proposal,
 * action_running, action_result, action_error, error.
 */
export function useZeusStream() {
  const abortRef = useRef(null)

  const readStream = useCallback(async (path, body, handlers) => {
    const token = localStorage.getItem('provirpanel-token')
    const baseURL = api.defaults.baseURL || '/api'
    const controller = new AbortController()
    abortRef.current = controller

    const res = await fetch(`${baseURL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try { const j = await res.json(); msg = j.error || j.message || msg } catch { /* noop */ }
      throw new Error(msg)
    }

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
        if (payload === '[DONE]') continue
        try {
          const ev = JSON.parse(payload)
          handlers.onEvent?.(ev)
        } catch { /* linha parcial/keepalive */ }
      }
    }
  }, [])

  /**
   * Envia mensagem ao agente. `onEvent(ev)` recebe cada evento SSE.
   */
  const sendMessage = useCallback(async ({ message, history, conversationId, agent }, onEvent) => {
    return readStream('/zeus/agent', { message, history, conversationId, agent }, { onEvent })
  }, [readStream])

  /**
   * Confirma e executa uma ação previamente proposta.
   */
  const confirmAction = useCallback(async ({ action }, onEvent) => {
    return readStream('/zeus/agent/confirm', { action }, { onEvent })
  }, [readStream])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  return { sendMessage, confirmAction, stop }
}

export default useZeusStream
