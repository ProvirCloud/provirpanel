import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Wifi, WifiOff, X } from 'lucide-react'
import { Terminal as TerminalIcon } from 'lucide-react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'
import { createTerminalSocket } from '../services/socket.js'

const TERMINAL_BOOTSTRAP_COMMAND = '__provir_shell__'
const TERMINAL_FONT_SIZE = 14
const TERMINAL_LINE_HEIGHT = 1.2
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
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16)
  })
}

const appendOutput = (current, chunk) => `${current || ''}${chunk || ''}`.slice(-MAX_CAPTURED_OUTPUT)

const summarizeCwd = (cwd) => {
  if (!cwd || cwd === '~') return '~'
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length <= 3 ? cwd : `…/${parts.slice(-2).join('/')}`
}

const createTab = (index) => ({
  id: generateUUID(),
  title: `Shell ${index}`,
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
  const lastOutputRef = useRef(new Map())

  useEffect(() => { tabsRef.current = tabs }, [tabs])

  const updateTab = useCallback((id, updates) => {
    setTabs((cur) => cur.map((t) => t.id === id ? { ...t, ...updates } : t))
  }, [])

  const fitTerminal = useCallback((id) => {
    const terminal = terminalsRef.current.get(id)
    const fitAddon = fitAddonsRef.current.get(id)
    const socket = socketsRef.current.get(id)
    if (!terminal || !fitAddon) return
    fitAddon.fit()
    terminal.scrollToBottom()
    if (socket?.connected) socket.emit('resize', { cols: terminal.cols, rows: terminal.rows })
  }, [])

  const focusTerminal = useCallback((id) => {
    requestAnimationFrame(() => {
      fitTerminal(id)
      terminalsRef.current.get(id)?.focus()
    })
  }, [fitTerminal])

  const writeInfo = useCallback((id, text, color = '90') => {
    const terminal = terminalsRef.current.get(id)
    if (!terminal) return
    terminal.write(`\r\n\x1b[${color}m${text}\x1b[0m\r\n`)
    terminal.scrollToBottom()
  }, [])

  const startShell = useCallback((id, announce = false) => {
    const socket = socketsRef.current.get(id)
    if (!socket?.connected) return
    if (announce) writeInfo(id, '[reiniciando shell...]')
    lastOutputRef.current.set(id, '')
    updateTab(id, { status: 'connected' })
    socket.emit('command', { command: TERMINAL_BOOTSTRAP_COMMAND })
  }, [updateTab, writeInfo])

  const destroySocket = useCallback((id) => {
    const socket = socketsRef.current.get(id)
    if (!socket) return
    socket.removeAllListeners()
    socket.disconnect()
    socketsRef.current.delete(id)
  }, [])

  const cleanupTerminal = useCallback((id) => {
    observersRef.current.get(id)?.disconnect()
    observersRef.current.delete(id)
    containersRef.current.delete(id)
    terminalsRef.current.get(id)?.dispose()
    terminalsRef.current.delete(id)
    fitAddonsRef.current.delete(id)
    lastOutputRef.current.delete(id)
  }, [])

  const connectSocket = useCallback((id) => {
    if (socketsRef.current.has(id)) return
    const socket = createTerminalSocket()
    if (!socket) { updateTab(id, { status: 'disconnected' }); return }

    socketsRef.current.set(id, socket)
    updateTab(id, { status: 'connecting' })

    socket.on('connect', () => {
      updateTab(id, { status: 'connected' })
      writeInfo(id, '[conectado]')
      focusTerminal(id)
      startShell(id)
    })

    socket.on('connect_error', (error) => {
      const unauth = /unauthorized/i.test(error?.message || '')
      updateTab(id, { status: unauth ? 'auth-required' : 'disconnected' })
      writeInfo(id, unauth ? '[sessão expirada]' : '[falha na conexão]', '31')
    })

    socket.on('disconnect', (reason) => {
      updateTab(id, { status: 'disconnected' })
      if (reason !== 'io client disconnect') writeInfo(id, '[desconectado]')
    })

    socket.on('output', (payload) => {
      const terminal = terminalsRef.current.get(id)
      const data = payload?.data || ''
      if (terminal && data) { terminal.write(data); terminal.scrollToBottom() }
      lastOutputRef.current.set(id, appendOutput(lastOutputRef.current.get(id), data))
    })

    socket.on('done', (payload) => {
      updateTab(id, { status: 'shell-closed' })
      writeInfo(id, `[shell encerrada (code ${payload?.code ?? 0})]`)
    })

    socket.on('error', (payload) => {
      updateTab(id, { status: 'shell-closed' })
      writeInfo(id, payload?.message || 'Erro na execução.', '31')
    })

    socket.on('cwd', (payload) => {
      updateTab(id, { cwd: payload?.cwd || '~' })
    })
  }, [focusTerminal, startShell, updateTab, writeInfo])

  const ensureTerminal = useCallback((id, container) => {
    if (!container || terminalsRef.current.has(id)) return

    const { terminal, fitAddon } = createTerminalInstance(container)
    terminalsRef.current.set(id, terminal)
    fitAddonsRef.current.set(id, fitAddon)

    terminal.onData((data) => {
      const socket = socketsRef.current.get(id)
      if (socket?.connected) socket.emit('input', { data })
    })

    terminal.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      if (mod && key === 'c') {
        const sel = terminal.getSelection()
        if (sel) { navigator.clipboard?.writeText(sel).catch(() => {}); return false }
        return true
      }
      if (mod && key === 'v') return false
      return true
    })

    let pasteHandled = false
    container.addEventListener('paste', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (pasteHandled) return
      pasteHandled = true
      const text = e.clipboardData?.getData('text')
      if (text) terminal.paste(text)
      setTimeout(() => { pasteHandled = false }, 100)
    }, true)

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
    Array.from(socketsRef.current.keys()).forEach(destroySocket)
    Array.from(terminalsRef.current.keys()).forEach(cleanupTerminal)
  }, [cleanupTerminal, destroySocket])

  useEffect(() => { if (activeId) focusTerminal(activeId) }, [activeId, focusTerminal])

  const addTab = () => {
    const nextTab = createTab(tabsRef.current.length + 1)
    setTabs((cur) => [...cur, nextTab])
    setActiveId(nextTab.id)
  }

  const closeTab = (id) => {
    if (tabsRef.current.length === 1) return
    destroySocket(id)
    cleanupTerminal(id)
    setTabs((cur) => {
      const next = cur.filter((t) => t.id !== id)
      if (activeId === id && next.length > 0) setActiveId(next[0].id)
      return next
    })
  }

  const setContainerRef = useCallback((id) => (el) => {
    if (!el) return
    containersRef.current.set(id, el)
    ensureTerminal(id, el)
  }, [ensureTerminal])

  const activeTab = tabs.find((t) => t.id === activeId)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: '#0d1117' }}>
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-0 overflow-x-auto px-1 pt-1" style={{ background: '#010409' }}>
        {tabs.map((tab) => {
          const isActive = activeId === tab.id
          const isConnected = tab.status === 'connected'
          return (
            <button
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-all rounded-t-lg ${
                isActive
                  ? 'bg-[#0d1117] text-gray-200 z-10'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-[#0d1117]/50'
              }`}
            >
              {/* Connection dot */}
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-gray-600'}`} />
              <span>{tab.title}</span>
              <span className="hidden sm:inline text-[9px] text-gray-600 max-w-[80px] truncate">{summarizeCwd(tab.cwd)}</span>
              {tabs.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                  className="ml-1 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-opacity"
                >
                  <X size={10} />
                </span>
              )}
              {/* Active indicator */}
              {isActive && <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-blue-500" />}
            </button>
          )
        })}

        {/* New tab button */}
        <button
          onClick={addTab}
          className="flex items-center gap-1 px-2.5 py-1.5 ml-0.5 text-[11px] text-gray-500 hover:text-gray-200 rounded-t-lg transition-colors hover:bg-[#0d1117]/50"
          title="Nova aba"
        >
          <Plus size={12} />
        </button>

        {/* Right side: status */}
        <div className="ml-auto flex items-center gap-1.5 px-2 text-[10px] text-gray-600">
          {activeTab?.status === 'connected'
            ? <><Wifi size={10} className="text-green-400" /><span className="text-green-400/70">conectado</span></>
            : <><WifiOff size={10} className="text-red-400/60" /><span className="text-red-400/60">{activeTab?.status === 'connecting' ? 'conectando' : 'desconectado'}</span></>
          }
        </div>
      </div>

      {/* Terminal area */}
      <div className="relative flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 ${activeId === tab.id ? 'visible' : 'invisible pointer-events-none'}`}
          >
            <div
              ref={setContainerRef(tab.id)}
              className="provir-terminal-shell h-full w-full p-1"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default Terminal
