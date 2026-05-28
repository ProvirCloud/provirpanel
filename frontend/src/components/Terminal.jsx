import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Plus, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react'
import { Terminal as TerminalIcon } from 'lucide-react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'
import { createTerminalSocket } from '../services/socket.js'

const TERMINAL_BOOTSTRAP_COMMAND = '__provir_shell__'
const TERMINAL_FONT_SIZE = 14
const TERMINAL_LINE_HEIGHT = 1.18
const TERMINAL_FONT_FAMILY = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const MAX_CAPTURED_OUTPUT = 40000

const TERMINAL_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#58a6ff',
  cursorAccent: '#0d1117',
  selectionBackground: 'rgba(56, 139, 253, 0.25)',
  selectionForeground: '#ffffff',
  black: '#484f58',
  red: '#ff7b72',
  green: '#7ee787',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc'
}

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0
    const value = char === 'x' ? random : ((random & 0x3) | 0x8)
    return value.toString(16)
  })
}

const formatStatus = (status) => {
  switch (status) {
    case 'connected':
      return 'Conectado'
    case 'connecting':
      return 'Conectando'
    case 'shell-closed':
      return 'Shell encerrada'
    case 'auth-required':
      return 'Login necessario'
    default:
      return 'Desconectado'
  }
}

const appendOutput = (current, chunk) => `${current || ''}${chunk || ''}`.slice(-MAX_CAPTURED_OUTPUT)

const summarizeCwd = (cwd) => {
  if (!cwd || cwd === '~') {
    return '~'
  }

  const normalized = cwd.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 3) {
    return normalized
  }

  return `.../${parts.slice(-3).join('/')}`
}

const createTab = (index) => ({
  id: generateUUID(),
  title: `Terminal ${index}`,
  status: 'connecting',
  cwd: '~'
})

const createTerminalInstance = (container) => {
  const terminal = new XTerm({
    fontSize: TERMINAL_FONT_SIZE,
    lineHeight: TERMINAL_LINE_HEIGHT,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: TERMINAL_FONT_FAMILY,
    allowTransparency: true,
    scrollback: 5000,
    theme: TERMINAL_THEME
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(container)

  return { terminal, fitAddon }
}

const Terminal = ({ showPageIntro = true }) => {
  const initialTab = useMemo(() => createTab(1), [])
  const [tabs, setTabs] = useState(() => [initialTab])
  const [activeId, setActiveId] = useState(initialTab.id)
  const tabsRef = useRef([initialTab])
  const terminalsRef = useRef(new Map())
  const fitAddonsRef = useRef(new Map())
  const socketsRef = useRef(new Map())
  const containersRef = useRef(new Map())
  const observersRef = useRef(new Map())
  const pasteHandlersRef = useRef(new Map())
  const lastOutputRef = useRef(new Map())

  useEffect(() => {
    tabsRef.current = tabs
    if (tabs.length > 0 && !tabs.some((tab) => tab.id === activeId)) {
      setActiveId(tabs[0].id)
    }
  }, [activeId, tabs])

  const updateTab = useCallback((id, updates) => {
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === id ? { ...tab, ...updates } : tab
    )))
  }, [])

  const fitTerminal = useCallback((id) => {
    const terminal = terminalsRef.current.get(id)
    const fitAddon = fitAddonsRef.current.get(id)
    const socket = socketsRef.current.get(id)
    if (!terminal || !fitAddon) {
      return
    }

    fitAddon.fit()
    terminal.scrollToBottom()

    if (socket?.connected) {
      socket.emit('resize', { cols: terminal.cols, rows: terminal.rows })
    }
  }, [])

  const focusTerminal = useCallback((id) => {
    requestAnimationFrame(() => {
      fitTerminal(id)
      terminalsRef.current.get(id)?.focus()
    })
  }, [fitTerminal])

  const writeInfo = useCallback((id, text, color = '90') => {
    const terminal = terminalsRef.current.get(id)
    if (!terminal) {
      return
    }

    terminal.write(`\r\n\x1b[${color}m${text}\x1b[0m\r\n`)
    terminal.scrollToBottom()
  }, [])

  const startShell = useCallback((id, announce = false) => {
    const socket = socketsRef.current.get(id)
    if (!socket?.connected) {
      return
    }

    if (announce) {
      writeInfo(id, '[reiniciando shell interativa...]')
    }

    lastOutputRef.current.set(id, '')
    updateTab(id, { status: 'connected' })
    socket.emit('command', { command: TERMINAL_BOOTSTRAP_COMMAND })
  }, [updateTab, writeInfo])

  const destroySocket = useCallback((id) => {
    const socket = socketsRef.current.get(id)
    if (!socket) {
      return
    }

    socket.removeAllListeners()
    socket.disconnect()
    socketsRef.current.delete(id)
  }, [])

  const cleanupTerminal = useCallback((id) => {
    const observer = observersRef.current.get(id)
    if (observer) {
      observer.disconnect()
      observersRef.current.delete(id)
    }

    const container = containersRef.current.get(id)
    const pasteHandler = pasteHandlersRef.current.get(id)
    if (container && pasteHandler) {
      container.removeEventListener('paste', pasteHandler)
    }

    pasteHandlersRef.current.delete(id)
    containersRef.current.delete(id)

    const terminal = terminalsRef.current.get(id)
    if (terminal) {
      terminal.dispose()
      terminalsRef.current.delete(id)
    }

    fitAddonsRef.current.delete(id)
    lastOutputRef.current.delete(id)
  }, [])

  const connectSocket = useCallback((id) => {
    if (socketsRef.current.has(id)) {
      return
    }

    const socket = createTerminalSocket()
    if (!socket) {
      updateTab(id, { status: 'disconnected' })
      return
    }

    socketsRef.current.set(id, socket)
    updateTab(id, { status: 'connecting' })

    socket.on('connect', () => {
      updateTab(id, { status: 'connected' })
      writeInfo(id, '[sessao conectada]')
      focusTerminal(id)
      startShell(id)
    })

    socket.on('connect_error', (error) => {
      const unauthorized = /unauthorized/i.test(error?.message || '')
      updateTab(id, { status: unauthorized ? 'auth-required' : 'disconnected' })
      writeInfo(id, unauthorized ? '[sessao expirada. faca login novamente.]' : '[falha ao conectar a shell.]', '31')
    })

    socket.on('disconnect', (reason) => {
      updateTab(id, { status: 'disconnected' })
      if (reason !== 'io client disconnect') {
        writeInfo(id, '[conexao encerrada]')
      }
    })

    socket.on('output', (payload) => {
      const terminal = terminalsRef.current.get(id)
      const data = payload?.data || ''
      if (terminal && data) {
        terminal.write(data)
        terminal.scrollToBottom()
      }

      lastOutputRef.current.set(id, appendOutput(lastOutputRef.current.get(id), data))
    })

    socket.on('done', (payload) => {
      updateTab(id, { status: 'shell-closed' })
      writeInfo(id, `[shell encerrada - code ${payload?.code ?? 0}. use Resetar conexao para abrir outra sessao.]`)
    })

    socket.on('error', (payload) => {
      updateTab(id, { status: 'shell-closed' })
      writeInfo(id, payload?.message || 'Falha ao executar comando.', '31')
    })

    socket.on('cwd', (payload) => {
      updateTab(id, { cwd: payload?.cwd || '~' })
    })
  }, [focusTerminal, startShell, updateTab, writeInfo])

  const ensureTerminal = useCallback((id, container) => {
    if (!container || terminalsRef.current.has(id)) {
      return
    }

    const { terminal, fitAddon } = createTerminalInstance(container)
    terminalsRef.current.set(id, terminal)
    fitAddonsRef.current.set(id, fitAddon)

    terminal.onData((data) => {
      const socket = socketsRef.current.get(id)
      if (socket?.connected) {
        socket.emit('input', { data })
      }
    })

    terminal.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase()
      const usingModifier = event.ctrlKey || event.metaKey

      if (usingModifier && key === 'c') {
        const selection = terminal.getSelection()
        if (selection) {
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(selection).catch(() => {})
          }
          return false
        }
        return true
      }

      if (usingModifier && key === 'v') {
        if (!navigator.clipboard?.readText) {
          return false
        }

        navigator.clipboard.readText().then((text) => {
          if (!text) {
            return
          }

          const socket = socketsRef.current.get(id)
          if (socket?.connected) {
            socket.emit('input', { data: text })
          }
        }).catch(() => {})
        return false
      }

      return true
    })

    const handlePaste = (event) => {
      const text = event.clipboardData?.getData('text')
      if (!text) {
        return
      }

      const socket = socketsRef.current.get(id)
      if (socket?.connected) {
        socket.emit('input', { data: text })
      }
      event.preventDefault()
    }

    container.addEventListener('paste', handlePaste)
    pasteHandlersRef.current.set(id, handlePaste)

    const observer = new ResizeObserver(() => fitTerminal(id))
    observer.observe(container)
    observersRef.current.set(id, observer)

    requestAnimationFrame(() => {
      fitTerminal(id)
      connectSocket(id)
      focusTerminal(id)
    })
  }, [connectSocket, fitTerminal, focusTerminal])

  useEffect(() => () => {
    Array.from(socketsRef.current.keys()).forEach((id) => destroySocket(id))
    Array.from(terminalsRef.current.keys()).forEach((id) => cleanupTerminal(id))
  }, [cleanupTerminal, destroySocket])

  useEffect(() => {
    if (activeId) {
      focusTerminal(activeId)
    }
  }, [activeId, focusTerminal])

  const addTab = () => {
    const nextTab = createTab(tabsRef.current.length + 1)
    setTabs((currentTabs) => [...currentTabs, nextTab])
    setActiveId(nextTab.id)
  }

  const closeTab = (id) => {
    if (tabsRef.current.length === 1) {
      return
    }

    destroySocket(id)
    cleanupTerminal(id)

    setTabs((currentTabs) => {
      const nextTabs = currentTabs.filter((tab) => tab.id !== id)
      if (activeId === id && nextTabs.length > 0) {
        setActiveId(nextTabs[0].id)
      }
      return nextTabs
    })
  }

  const resetConnection = () => {
    const activeTab = tabs.find((tab) => tab.id === activeId)
    if (!activeTab) {
      return
    }

    const socket = socketsRef.current.get(activeId)
    if (socket?.connected && activeTab.status === 'shell-closed') {
      startShell(activeId, true)
      focusTerminal(activeId)
      return
    }

    destroySocket(activeId)
    updateTab(activeId, { status: 'connecting' })
    connectSocket(activeId)
    focusTerminal(activeId)
  }

  const clearTerminal = () => {
    const terminal = terminalsRef.current.get(activeId)
    const socket = socketsRef.current.get(activeId)
    const activeTab = tabs.find((tab) => tab.id === activeId)
    if (!terminal) {
      return
    }

    if (socket?.connected && activeTab?.status === 'connected') {
      socket.emit('input', { data: '\f' })
      return
    }

    terminal.clear()
    terminal.scrollToBottom()
    lastOutputRef.current.set(activeId, '')
  }

  const copyLastOutput = async () => {
    const terminal = terminalsRef.current.get(activeId)
    const selection = terminal?.getSelection()
    const output = selection || lastOutputRef.current.get(activeId) || ''
    if (!output) {
      return
    }

    try {
      await navigator.clipboard.writeText(output.trim())
    } catch {
      // Ignore clipboard errors.
    }
  }

  const setContainerRef = useCallback((id) => (element) => {
    if (!element) {
      return
    }

    containersRef.current.set(id, element)
    ensureTerminal(id, element)
  }, [ensureTerminal])

  const activeTab = tabs.find((tab) => tab.id === activeId)

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col gap-4">
      <div className={`flex flex-wrap gap-3 ${showPageIntro ? 'items-center justify-between' : 'items-center justify-end'}`}>
        {showPageIntro ? (
          <div>
            <p className="zeus-kicker text-xs font-semibold uppercase">Terminal</p>
            <h2 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Sessao interativa completa</h2>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = 'var(--accent)'
              event.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = 'var(--border-default)'
              event.currentTarget.style.color = 'var(--text-secondary)'
            }}
            onClick={copyLastOutput}
          >
            <Copy className="h-4 w-4" />
            Copiar saida
          </button>
          <button
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = 'var(--accent)'
              event.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = 'var(--border-default)'
              event.currentTarget.style.color = 'var(--text-secondary)'
            }}
            onClick={clearTerminal}
          >
            <Trash2 className="h-4 w-4" />
            Limpar
          </button>
          <button
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = 'var(--accent)'
              event.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = 'var(--border-default)'
              event.currentTarget.style.color = 'var(--text-secondary)'
            }}
            onClick={resetConnection}
          >
            <RefreshCw className="h-4 w-4" />
            Resetar conexao
          </button>
          <button
            className="flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,_#16366f,_#2563eb)] px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
            onClick={addTab}
          >
            <Plus className="h-4 w-4" />
            Nova aba
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const isActive = activeId === tab.id

          return (
            <button
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              className="flex items-center gap-2 rounded-full border px-4 py-2 text-xs transition"
              style={isActive
                ? { background: 'var(--accent-dim)', borderColor: 'rgba(77,126,247,0.35)', color: 'var(--accent)' }
                : { background: 'var(--bg-elevated)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }
              }
            >
              <TerminalIcon className="h-3.5 w-3.5" />
              <span>{tab.title}</span>
              <span className="hidden max-w-40 truncate text-[10px] text-inherit opacity-70 md:inline">{summarizeCwd(tab.cwd)}</span>
              <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
                {formatStatus(tab.status)}
              </span>
              {tabs.length > 1 ? (
                <span
                  className="ml-1 hover:text-rose-400"
                  style={{ color: 'var(--text-muted)' }}
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(tab.id)
                  }}
                >
                  ×
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="flex min-h-[0] flex-1 flex-col rounded-[1.5rem] border border-[#30363d] bg-[linear-gradient(180deg,#010409_0%,#050a11_100%)] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#8b949e]">
          <span className="flex items-center gap-2">
            {activeTab?.status === 'connected' ? <Wifi className="h-4 w-4 text-[#58a6ff]" /> : <WifiOff className="h-4 w-4 text-[#ff7b72]" />}
            {formatStatus(activeTab?.status)}
          </span>
          <span className="max-w-full truncate text-right text-[#6e7681]">{activeTab?.cwd || '~'}</span>
        </div>

        <div className="relative min-h-[560px] flex-1 overflow-hidden rounded-[22px] border border-[#30363d] bg-[#0d1117] shadow-[0_16px_48px_rgba(0,0,0,0.4)]">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`absolute inset-0 ${activeId === tab.id ? 'visible' : 'invisible pointer-events-none'}`}
            >
              <div
                ref={setContainerRef(tab.id)}
                className="provir-terminal-shell h-full w-full"
              />
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6e7681]">
          <span>Ctrl/Cmd+C copia selecao ou envia interrupcao para o shell</span>
          <span>Ctrl/Cmd+V cola diretamente na sessao ativa</span>
        </div>
      </div>
    </div>
  )
}

export default Terminal
