import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react'
import { Terminal as TerminalIcon } from 'lucide-react'
import { Terminal as XTerm } from 'xterm'
import 'xterm/css/xterm.css'
import { createTerminalSocket } from '../services/socket.js'

// Polyfill para crypto.randomUUID
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

const formatPrompt = (cwd) => {
  const display = cwd || '~'
  return `\x1b[1;34mcloud\x1b[0m@\x1b[1;34mpainel\x1b[0m:\x1b[1;32m${display}\x1b[0m$ `
}
const HISTORY_KEY = 'cloudpainel_terminal_history'
const COMMAND_HINTS = [
  'ls',
  'll',
  'la',
  'pwd',
  'whoami',
  'cat',
  'tail',
  'head',
  'df',
  'du',
  'ps',
  'uptime',
  'free',
  'top',
  'grep',
  'find',
  'stat',
  'id',
  'docker',
  'git'
]

const loadHistory = () => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const saveHistory = (history) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-100)))
}

const formatStatus = (status) => {
  switch (status) {
    case 'connected':
      return 'Conectado'
    case 'disconnected':
      return 'Desconectado'
    case 'auth-required':
      return 'Login necessario'
    default:
      return 'Conectando'
  }
}

const measureCharSize = (container) => {
  const span = document.createElement('span')
  span.textContent = 'W'
  span.style.fontFamily = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
  span.style.fontSize = '14px'
  span.style.visibility = 'hidden'
  container.appendChild(span)
  const rect = span.getBoundingClientRect()
  span.remove()
  return { width: rect.width || 8, height: rect.height || 16 }
}

const fitTerminal = (terminal, container) => {
  if (!terminal || !container) {
    return
  }
  const { width, height } = container.getBoundingClientRect()
  const charSize = measureCharSize(container)
  const cols = Math.max(20, Math.floor(width / charSize.width))
  const rows = Math.max(8, Math.floor(height / charSize.height))
  terminal.resize(cols, rows)
}

const writePrompt = (terminal, cwd, newLine = true) => {
  if (newLine) {
    terminal.write('\r\n')
  }
  terminal.write(formatPrompt(cwd))
}

const Terminal = () => {
  const [tabs, setTabs] = useState(() => [
    { id: generateUUID(), title: 'Terminal 1', status: 'disconnected' }
  ])
  const [activeId, setActiveId] = useState(() => tabs[0].id)
  const historyRef = useRef(loadHistory())
  const terminalsRef = useRef(new Map())
  const socketsRef = useRef(new Map())
  const buffersRef = useRef(new Map())
  const historyIndexRef = useRef(new Map())
  const containersRef = useRef(new Map())
  const observersRef = useRef(new Map())
  const tabsRef = useRef([])
  const outputRef = useRef(new Map())
  const lastOutputRef = useRef(new Map())
  const cwdRef = useRef(new Map())
  const runningRef = useRef(new Map())

  const [authToken, setAuthToken] = useState(() => localStorage.getItem('token'))

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  const updateTab = useCallback((id, updates) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === id ? { ...tab, ...updates } : tab))
    )
  }, [])

  const ensureTerminal = useCallback(
    (id, container) => {
      if (!container || terminalsRef.current.has(id)) {
        return
      }

      const term = new XTerm({
        fontSize: 14,
        cursorBlink: true,
        fontFamily:
          '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        theme: {
          background: '#0b1120',
          foreground: '#e2e8f0',
          cursor: '#3B82F6',
          selection: 'rgba(59, 130, 246, 0.3)'
        }
      })

      terminalsRef.current.set(id, term)
      buffersRef.current.set(id, '')
      historyIndexRef.current.set(id, historyRef.current.length)

      term.open(container)
      term.writeln('\x1b[1;36mCloudPainel Terminal\x1b[0m')
      writePrompt(term, cwdRef.current.get(id), false)

      term.attachCustomKeyEventHandler((event) => {
        const running = runningRef.current.get(id)
        const key = event.key.toLowerCase()

        if ((event.ctrlKey || event.metaKey) && key === 'c') {
          const selection = term.getSelection()
          if (selection) {
            navigator.clipboard.writeText(selection)
            return false
          }
          if (running) {
            const socket = socketsRef.current.get(id)
            socket?.emit('input', { data: '\u0003' })
          }
          return false
        }

        if ((event.ctrlKey || event.metaKey) && key === 'v') {
          navigator.clipboard.readText().then((text) => {
            if (!text) {
              return
            }
            if (running) {
              const socket = socketsRef.current.get(id)
              socket?.emit('input', { data: text })
              return
            }
            const current = buffersRef.current.get(id) || ''
            buffersRef.current.set(id, current + text)
            term.write(text)
          })
          return false
        }

        return true
      })

      term.onData((data) => {
        const running = runningRef.current.get(id)
        if (running) {
          const socket = socketsRef.current.get(id)
          const payload = data === '\r' ? '\n' : data
          if (socket && socket.connected) {
            socket.emit('input', { data: payload })
          }
          // Locally echo to provide visual feedback for interactive shells (basic line mode).
          if (data === '\u0003') {
            return
          }
          if (data === '\r') {
            term.write('\r\n')
            return
          }
          if (data === '\u007f') {
            term.write('\b \b')
            return
          }
          term.write(data)
          return
        }

        const buffer = buffersRef.current.get(id) || ''
        if (data === '\r') {
          const command = buffer.trim()
          term.write('\r\n')
          buffersRef.current.set(id, '')
          historyIndexRef.current.set(id, historyRef.current.length)

          if (command) {
            historyRef.current = [...historyRef.current, command].slice(-100)
            saveHistory(historyRef.current)
          }

          const socket = socketsRef.current.get(id)
          if (socket && socket.connected) {
            outputRef.current.set(id, '')
            socket.emit('command', { command })
            runningRef.current.set(id, true)
          } else {
            term.writeln('\x1b[31m[offline]\x1b[0m')
            writePrompt(term, cwdRef.current.get(id))
          }
          return
        }

        if (data === '\t') {
          const socket = socketsRef.current.get(id)
          const tokens = buffer.split(/\s+/)
          const currentToken = tokens[tokens.length - 1] || ''
          const applyCandidates = (candidates) => {
            if (candidates.length === 1) {
              const completion = candidates[0]
              const newBuffer = buffer.slice(0, buffer.length - currentToken.length) + completion
              buffersRef.current.set(id, newBuffer)
          term.write(`\r\x1b[2K${formatPrompt(cwdRef.current.get(id))}${newBuffer}`)
              return
            }
            if (candidates.length > 1) {
              term.write('\r\n')
              term.write(candidates.join('  '))
              term.write('\r\n')
          term.write(formatPrompt(cwdRef.current.get(id)) + buffer)
            }
          }

          if (socket && socket.connected) {
            socket.emit('autocomplete', { input: buffer }, (response) => {
              const candidates = response?.candidates || []
              if (candidates.length === 0) {
                const local = Array.from(
                  new Set([...COMMAND_HINTS, ...historyRef.current])
                ).filter((item) => item.startsWith(currentToken))
                applyCandidates(local)
                return
              }
              applyCandidates(candidates)
            })
          } else {
            const local = Array.from(
              new Set([...COMMAND_HINTS, ...historyRef.current])
            ).filter((item) => item.startsWith(currentToken))
            applyCandidates(local)
          }
          return
        }

        if (data === '\u007f') {
          if (buffer.length > 0) {
            buffersRef.current.set(id, buffer.slice(0, -1))
            term.write('\b \b')
          }
          return
        }

        if (data === '\x1b[A' || data === '\x1b[B') {
          const history = historyRef.current
          let index = historyIndexRef.current.get(id) ?? history.length
          if (data === '\x1b[A') {
            index = Math.max(0, index - 1)
          } else {
            index = Math.min(history.length, index + 1)
          }
          historyIndexRef.current.set(id, index)
          const nextValue = history[index] || ''
          buffersRef.current.set(id, nextValue)
          term.write(`\r\x1b[2K${formatPrompt(cwdRef.current.get(id))}${nextValue}`)
          return
        }

        if (data >= ' ') {
          buffersRef.current.set(id, buffer + data)
          term.write(data)
        }
      })

      container.addEventListener('paste', (event) => {
        const text = event.clipboardData?.getData('text')
        if (!text) {
          return
        }
        const running = runningRef.current.get(id)
        if (running) {
          const socket = socketsRef.current.get(id)
          socket?.emit('input', { data: text })
        } else {
          const current = buffersRef.current.get(id) || ''
          buffersRef.current.set(id, current + text)
          term.write(text)
        }
        event.preventDefault()
      })

      fitTerminal(term, container)
      const observer = new ResizeObserver(() => fitTerminal(term, container))
      observer.observe(container)
      observersRef.current.set(id, observer)
    },
    [updateTab]
  )

  const connectSocket = useCallback(
    (id, tokenValue) => {
      const term = terminalsRef.current.get(id)
      if (!tokenValue) {
        updateTab(id, { status: 'auth-required' })
        if (term) {
          term.writeln('\x1b[33m[login necessario]\x1b[0m')
          writePrompt(term, cwdRef.current.get(id))
        }
        return
      }
      const socket = createTerminalSocket(tokenValue)
      if (!socket) {
        updateTab(id, { status: 'disconnected' })
        return
      }
      socketsRef.current.set(id, socket)
      updateTab(id, { status: 'connecting' })

      socket.on('connect', () => {
        runningRef.current.set(id, false)
        updateTab(id, { status: 'connected' })
      })
      socket.on('disconnect', () => {
        runningRef.current.set(id, false)
        updateTab(id, { status: 'disconnected' })
      })

      socket.on('output', (payload) => {
        const current = terminalsRef.current.get(id)
        if (current) {
          const normalized = payload.data.replace(/\r?\n/g, '\r\n')
          current.write(normalized)
        }
        const prev = outputRef.current.get(id) || ''
        outputRef.current.set(id, prev + payload.data)
      })

      socket.on('done', (payload) => {
        const current = terminalsRef.current.get(id)
        if (current) {
          current.write(`\r\n\x1b[90m[exit ${payload.code}]\x1b[0m`)
          writePrompt(current, cwdRef.current.get(id))
        }
        const finalOutput = outputRef.current.get(id) || ''
        lastOutputRef.current.set(id, finalOutput)
        runningRef.current.set(id, false)
      })

      socket.on('error', (payload) => {
        const current = terminalsRef.current.get(id)
        if (current) {
          current.write(`\r\n\x1b[31m${payload.message}\x1b[0m`)
          writePrompt(current, cwdRef.current.get(id))
        }
        const finalOutput = outputRef.current.get(id) || ''
        lastOutputRef.current.set(id, finalOutput)
        runningRef.current.set(id, false)
      })

      socket.on('cwd', (payload) => {
        cwdRef.current.set(id, payload?.cwd || '~')
      })
    },
    [updateTab]
  )

  useEffect(() => {
    tabs.forEach((tab) => {
      if (!socketsRef.current.has(tab.id)) {
        connectSocket(tab.id, authToken)
      }
    })
  }, [tabs, connectSocket, authToken])

  useEffect(() => {
    const handleAuthChange = () => {
      setAuthToken(localStorage.getItem('token'))
    }
    window.addEventListener('cloudpainel-auth', handleAuthChange)
    window.addEventListener('storage', handleAuthChange)
    return () => {
      window.removeEventListener('cloudpainel-auth', handleAuthChange)
      window.removeEventListener('storage', handleAuthChange)
    }
  }, [])

  useEffect(() => {
    if (!authToken) {
      return
    }
    socketsRef.current.forEach((socket) => socket.disconnect())
    socketsRef.current.clear()
    tabsRef.current.forEach((tab) => connectSocket(tab.id, authToken))
  }, [authToken, connectSocket])

  useEffect(() => {
    return () => {
      socketsRef.current.forEach((socket) => socket.disconnect())
      observersRef.current.forEach((observer) => observer.disconnect())
    }
  }, [])

  const addTab = () => {
    const id = generateUUID()
    setTabs((prev) => [
      ...prev,
      { id, title: `Terminal ${prev.length + 1}`, status: 'disconnected' }
    ])
    setActiveId(id)
  }

  const closeTab = (id) => {
    if (tabs.length === 1) {
      return
    }
    const socket = socketsRef.current.get(id)
    if (socket) {
      socket.disconnect()
      socketsRef.current.delete(id)
    }
    const term = terminalsRef.current.get(id)
    if (term) {
      term.dispose()
      terminalsRef.current.delete(id)
    }
    runningRef.current.delete(id)
    const observer = observersRef.current.get(id)
    if (observer) {
      observer.disconnect()
      observersRef.current.delete(id)
    }
    setTabs((prev) => {
      const nextTabs = prev.filter((tab) => tab.id !== id)
      if (activeId === id && nextTabs.length > 0) {
        setActiveId(nextTabs[0].id)
      }
      return nextTabs
    })
  }

  const clearTerminal = () => {
    const term = terminalsRef.current.get(activeId)
    if (term) {
      term.clear()
      writePrompt(term, cwdRef.current.get(activeId), false)
    }
    outputRef.current.set(activeId, '')
    lastOutputRef.current.set(activeId, '')
  }

  const resetConnection = () => {
    const socket = socketsRef.current.get(activeId)
    if (socket) {
      socket.disconnect()
      socketsRef.current.delete(activeId)
    }
    runningRef.current.set(activeId, false)
    connectSocket(activeId, authToken)
  }

  const copyLastOutput = async () => {
    const output = lastOutputRef.current.get(activeId) || ''
    if (!output) {
      return
    }
    try {
      await navigator.clipboard.writeText(output.trim())
    } catch {
      // Ignore clipboard errors.
    }
  }

  const setContainerRef = useCallback(
    (id) => (element) => {
      if (element) {
        containersRef.current.set(id, element)
        ensureTerminal(id, element)
      }
    },
    [ensureTerminal]
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Terminal</p>
          <h2 className="text-2xl font-semibold text-white">Sessao interativa</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={copyLastOutput}
          >
            <Copy className="h-4 w-4" />
            Copiar resultado
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={clearTerminal}
          >
            <Trash2 className="h-4 w-4" />
            Limpar
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-blue-500/60"
            onClick={resetConnection}
          >
            <RefreshCw className="h-4 w-4" />
            Resetar conexao
          </button>
          <button
            className="flex items-center gap-2 rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-blue-400"
            onClick={addTab}
          >
            <Plus className="h-4 w-4" />
            Nova aba
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveId(tab.id)}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs transition ${
              activeId === tab.id
                ? 'border-blue-500/60 bg-blue-500/10 text-blue-200'
                : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-blue-500/40'
            }`}
          >
            <TerminalIcon className="h-3.5 w-3.5" />
            {tab.title}
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
              {formatStatus(tab.status)}
            </span>
            {tabs.length > 1 && (
              <span
                className="ml-1 text-slate-500 hover:text-rose-300"
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-blue-300" />
            {formatStatus(tabs.find((tab) => tab.id === activeId)?.status)}
          </span>
          <span className="text-blue-200">Resize verticalmente</span>
        </div>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group relative ${activeId === tab.id ? 'block' : 'hidden'}`}
          >
            <div
              ref={setContainerRef(tab.id)}
              className="h-80 min-h-[16rem] w-full resize-y overflow-auto rounded-xl border border-slate-800 bg-[#0b1120]"
            />
            <button
              className="absolute right-3 top-3 hidden items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/90 px-3 py-1 text-[11px] text-slate-200 shadow-lg transition group-hover:flex"
              onClick={copyLastOutput}
            >
              <Copy className="h-3 w-3" />
              Copiar resultado
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Terminal
