import { useState, useRef, useEffect, useCallback } from 'react'
import { Terminal as TerminalIcon, Minus, Maximize2, Minimize2, X, GripVertical, EyeOff } from 'lucide-react'
import Terminal from './Terminal.jsx'

const STORAGE_KEY_VISIBLE = 'floating-terminal-visible'
const STORAGE_KEY_STATE = 'floating-terminal-state'
const STORAGE_KEY_POSITION = 'floating-terminal-position'
const STORAGE_KEY_SIZE = 'floating-terminal-size'
const STORAGE_KEY_HIDDEN = 'floating-terminal-btn-hidden'

const loadPref = (key, fallback) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback } }
const savePref = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }

const FloatingTerminal = () => {
  // States: 'hidden' (no button), 'minimized' (button only), 'floating' (draggable window), 'maximized' (full screen overlay)
  const [state, setState] = useState(() => loadPref(STORAGE_KEY_STATE, 'minimized'))
  const [btnHidden, setBtnHidden] = useState(() => loadPref(STORAGE_KEY_HIDDEN, false))
  const [position, setPosition] = useState(() => loadPref(STORAGE_KEY_POSITION, { x: 60, y: null }))
  const [size, setSize] = useState(() => loadPref(STORAGE_KEY_SIZE, { w: 720, h: 420 }))
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragRef = useRef(null)
  const panelRef = useRef(null)
  const dragOffset = useRef({ x: 0, y: 0 })

  // Persist preferences
  useEffect(() => { savePref(STORAGE_KEY_STATE, state) }, [state])
  useEffect(() => { savePref(STORAGE_KEY_HIDDEN, btnHidden) }, [btnHidden])
  useEffect(() => { savePref(STORAGE_KEY_POSITION, position) }, [position])
  useEffect(() => { savePref(STORAGE_KEY_SIZE, size) }, [size])

  // Keyboard shortcut: Ctrl+` to toggle terminal
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        setState(prev => {
          if (prev === 'minimized' || prev === 'hidden') return 'floating'
          return 'minimized'
        })
        if (btnHidden) setBtnHidden(false)
      }
      // Escape to minimize when floating
      if (e.key === 'Escape' && state === 'floating') {
        setState('minimized')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [state, btnHidden])

  // Dragging logic
  const onDragStart = useCallback((e) => {
    if (state !== 'floating') return
    e.preventDefault()
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setIsDragging(true)
  }, [state])

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e) => {
      const x = Math.max(0, Math.min(window.innerWidth - 200, e.clientX - dragOffset.current.x))
      const y = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffset.current.y))
      setPosition({ x, y })
    }
    const onUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [isDragging])

  // Resizing logic
  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    dragOffset.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }, [size])

  useEffect(() => {
    if (!isResizing) return
    const onMove = (e) => {
      const dw = e.clientX - dragOffset.current.x
      const dh = e.clientY - dragOffset.current.y
      setSize({
        w: Math.max(400, Math.min(window.innerWidth - 100, dragOffset.current.w + dw)),
        h: Math.max(250, Math.min(window.innerHeight - 100, dragOffset.current.h + dh))
      })
    }
    const onUp = () => setIsResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [isResizing])

  // Hide button completely
  const hideButton = () => {
    setBtnHidden(true)
    setState('hidden')
  }

  // If button is hidden, only shortcut can bring it back
  if (btnHidden && state === 'hidden') {
    return null
  }

  // Always render terminal (hidden via CSS when minimized to preserve session)
  const isVisible = state === 'floating' || state === 'maximized'

  return (
    <>
      {/* Minimized button */}
      {state === 'minimized' && (
        <div className="fixed bottom-4 left-4 z-[9990] group flex items-center gap-1">
          <button
            onClick={() => setState('floating')}
            className="flex items-center gap-2 rounded-[14px] px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all hover:scale-105 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #1a1f2e, #0d1117)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(88,166,255,0.2)',
            }}
            title="Abrir Terminal (Ctrl+`)"
          >
            <TerminalIcon size={15} className="text-green-400" />
            <span className="hidden sm:inline text-gray-300">Terminal</span>
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </button>
          <button
            onClick={hideButton}
            className="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-full transition-all hover:bg-white/10"
            style={{ color: 'var(--color-text-muted)' }}
            title="Ocultar botão (Ctrl+` para reabrir)"
          >
            <EyeOff size={10} />
          </button>
        </div>
      )}

      {/* Terminal window - always mounted, hidden via CSS when minimized */}
      <div
        ref={panelRef}
        className={`fixed z-[9990] flex flex-col overflow-hidden transition-opacity duration-200 ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{
          ...(state === 'maximized'
            ? { inset: 0, borderRadius: 0 }
            : {
                ...(position.y !== null ? { left: position.x, top: position.y } : { left: position.x, bottom: 60 }),
                width: size.w,
                height: size.h,
                borderRadius: 16,
              }),
          background: '#0d1117',
          boxShadow: isVisible ? '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(88,166,255,0.15)' : 'none',
          userSelect: isDragging || isResizing ? 'none' : 'auto'
        }}
      >
        {/* Header */}
        <div
          onMouseDown={state === 'floating' ? onDragStart : undefined}
          className={`flex shrink-0 items-center justify-between px-3 py-2 select-none ${state === 'floating' ? 'cursor-move' : ''}`}
          style={{
            background: 'linear-gradient(135deg, rgba(88,166,255,0.08), rgba(88,166,255,0.02))',
            borderBottom: '1px solid rgba(88,166,255,0.1)'
          }}
        >
          <div className="flex items-center gap-2">
            {state === 'floating' && <GripVertical size={12} className="text-gray-500" />}
            <TerminalIcon size={13} className="text-green-400" />
            <span className="text-xs font-medium text-gray-300">Terminal</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 font-medium">LIVE</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setState('minimized')}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-white/10"
              title="Minimizar"
            >
              <Minus size={12} className="text-gray-400" />
            </button>
            {state === 'floating' ? (
              <button
                onClick={() => setState('maximized')}
                className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-white/10"
                title="Maximizar"
              >
                <Maximize2 size={11} className="text-gray-400" />
              </button>
            ) : (
              <button
                onClick={() => setState('floating')}
                className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-white/10"
                title="Modo flutuante"
              >
                <Minimize2 size={11} className="text-gray-400" />
              </button>
            )}
            <button
              onClick={() => setState('minimized')}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-red-500/20"
              title="Fechar (Ctrl+`)"
            >
              <X size={12} className="text-gray-400 hover:text-red-400" />
            </button>
          </div>
        </div>

        {/* Terminal content - always mounted */}
        <div className="flex-1 overflow-hidden">
          <Terminal showPageIntro={false} />
        </div>

        {/* Resize handle (floating mode only) */}
        {state === 'floating' && (
          <div
            onMouseDown={onResizeStart}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(88,166,255,0.3) 50%)' }}
          />
        )}
      </div>
    </>
  )
}

export default FloatingTerminal
