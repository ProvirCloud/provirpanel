import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { Terminal as TerminalIcon, Maximize2, Minimize2, Minus, X, GripVertical } from 'lucide-react'
import Terminal from './Terminal.jsx'
import { TERMINAL_PAGE_CONTAINER_ID } from './TerminalPage.jsx'

const STORAGE_KEY_STATE = 'floating-terminal-state'
const STORAGE_KEY_POSITION = 'floating-terminal-position'
const STORAGE_KEY_SIZE = 'floating-terminal-size'

const loadPref = (key, fallback) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback } }
const savePref = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }
const isMobile = () => window.innerWidth < 768

const FloatingTerminal = () => {
  const location = useLocation()
  const isTerminalPage = location.pathname === '/terminal'

  // States: 'minimized' (botão flutuante), 'closed' (oculto, sessão viva), 'pip', 'floating', 'maximized'
  const [pipState, setPipState] = useState(() => loadPref(STORAGE_KEY_STATE, 'minimized'))
  const [position, setPosition] = useState(() => loadPref(STORAGE_KEY_POSITION, { x: null, y: null }))
  const [size, setSize] = useState(() => loadPref(STORAGE_KEY_SIZE, { w: 560, h: 360 }))
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [hasBeenOpened, setHasBeenOpened] = useState(false)
  const [pageRect, setPageRect] = useState(null)
  const panelRef = useRef(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const prevPathRef = useRef(location.pathname)

  // Track page container position (for docking into page)
  useEffect(() => {
    if (!isTerminalPage) { setPageRect(null); return }
    setHasBeenOpened(true)

    const updateRect = () => {
      const el = document.getElementById(TERMINAL_PAGE_CONTAINER_ID)
      if (el) {
        const rect = el.getBoundingClientRect()
        setPageRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
      }
    }

    // Initial + observe
    const timer = setTimeout(updateRect, 60)
    const interval = setInterval(updateRect, 500)
    window.addEventListener('resize', updateRect)

    return () => { clearTimeout(timer); clearInterval(interval); window.removeEventListener('resize', updateRect) }
  }, [isTerminalPage])

  // Auto PiP when leaving /terminal
  useEffect(() => {
    const prev = prevPathRef.current
    prevPathRef.current = location.pathname
    if (prev === '/terminal' && !isTerminalPage) setPipState('pip')
  }, [location.pathname, isTerminalPage])

  // Persist
  useEffect(() => { savePref(STORAGE_KEY_STATE, pipState) }, [pipState])
  useEffect(() => { if (!isMobile()) savePref(STORAGE_KEY_POSITION, position) }, [position])
  useEffect(() => { if (!isMobile()) savePref(STORAGE_KEY_SIZE, size) }, [size])

  // Window resize
  useEffect(() => {
    const h = () => {
      if (pipState === 'pip' || pipState === 'floating') {
        setPosition(p => ({ x: p.x !== null ? Math.min(p.x, window.innerWidth - 200) : null, y: p.y !== null ? Math.min(p.y, window.innerHeight - 100) : null }))
        setSize(s => ({ w: Math.min(s.w, window.innerWidth - 32), h: Math.min(s.h, window.innerHeight - 60) }))
      }
    }
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [pipState])

  // Keyboard: Ctrl+`
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        if (isTerminalPage) return
        setPipState(prev => {
          if (prev === 'minimized' || prev === 'closed') { setHasBeenOpened(true); return isMobile() ? 'maximized' : 'pip' }
          return 'minimized'
        })
      }
      if (e.key === 'Escape' && !isTerminalPage && pipState !== 'minimized' && pipState !== 'closed') setPipState('minimized')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pipState, isTerminalPage])

  // Drag
  const onDragStart = useCallback((e) => {
    if (isMobile()) return
    e.preventDefault()
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setIsDragging(true)
  }, [])

  const onTouchDragStart = useCallback((e) => {
    if (isMobile()) return
    const t = e.touches[0], rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragOffset.current = { x: t.clientX - rect.left, y: t.clientY - rect.top }
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return
    const mm = (e) => setPosition({ x: Math.max(0, Math.min(window.innerWidth - 150, e.clientX - dragOffset.current.x)), y: Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffset.current.y)) })
    const tm = (e) => { const t = e.touches[0]; setPosition({ x: Math.max(0, Math.min(window.innerWidth - 150, t.clientX - dragOffset.current.x)), y: Math.max(0, Math.min(window.innerHeight - 50, t.clientY - dragOffset.current.y)) }) }
    const end = () => setIsDragging(false)
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', end)
    window.addEventListener('touchmove', tm); window.addEventListener('touchend', end)
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', end); window.removeEventListener('touchmove', tm); window.removeEventListener('touchend', end) }
  }, [isDragging])

  // Resize
  const onResizeStart = useCallback((e) => {
    if (isMobile()) return
    e.preventDefault(); e.stopPropagation()
    setIsResizing(true)
    dragOffset.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }, [size])

  useEffect(() => {
    if (!isResizing) return
    const m = (e) => setSize({ w: Math.max(300, Math.min(window.innerWidth - 32, dragOffset.current.w + (e.clientX - dragOffset.current.x))), h: Math.max(180, Math.min(window.innerHeight - 60, dragOffset.current.h + (e.clientY - dragOffset.current.y))) })
    const u = () => setIsResizing(false)
    window.addEventListener('mousemove', m); window.addEventListener('mouseup', u)
    return () => { window.removeEventListener('mousemove', m); window.removeEventListener('mouseup', u) }
  }, [isResizing])

  const openTerminal = () => { setHasBeenOpened(true); setPipState(isMobile() ? 'maximized' : 'pip') }

  // === Determine visual mode and style ===
  const mobile = isMobile()
  const isPip = pipState === 'pip'
  const isFloating = pipState === 'floating'
  const isMaximized = pipState === 'maximized'

  // When on /terminal page: dock into page container (position absolute to match it)
  const isDocked = isTerminalPage && pageRect

  // Is the terminal visually showing?
  const isVisible = isDocked || isPip || isFloating || isMaximized

  // Compute container style
  let containerStyle = {}
  let containerClass = ''
  let borderRadius = 0

  if (isDocked) {
    // Dock into the page container position
    containerStyle = {
      position: 'fixed',
      top: pageRect.top,
      left: pageRect.left,
      width: pageRect.width,
      height: pageRect.height,
      borderRadius: 12,
      background: '#0d1117',
      border: '1px solid rgba(88,166,255,0.1)',
      zIndex: 50,
      transition: 'all 0.3s ease'
    }
  } else if (isMaximized) {
    containerStyle = {
      position: 'fixed', inset: 0, borderRadius: 0,
      background: '#0d1117', border: '1px solid rgba(88,166,255,0.1)',
      zIndex: 9990
    }
  } else if (isPip || isFloating) {
    const pipSize = { w: mobile ? window.innerWidth - 16 : 380, h: mobile ? 220 : 240 }
    const currentSize = isPip ? pipSize : size
    const defaultPipPos = { x: mobile ? 8 : window.innerWidth - pipSize.w - 16, y: window.innerHeight - pipSize.h - 24 }
    const pos = isPip
      ? { x: position.x ?? defaultPipPos.x, y: position.y ?? defaultPipPos.y }
      : { x: position.x ?? 60, y: position.y ?? 100 }

    borderRadius = isPip ? 14 : 18
    containerStyle = {
      position: 'fixed',
      left: pos.x, top: pos.y,
      width: currentSize.w, height: currentSize.h,
      borderRadius,
      background: '#0d1117',
      border: '1px solid rgba(88,166,255,0.1)',
      boxShadow: isPip
        ? '0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(88,166,255,0.08)'
        : '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(88,166,255,0.1)',
      zIndex: 9990,
      transition: isDragging || isResizing ? 'none' : 'all 0.25s ease'
    }
  }

  const showHeader = !isDocked // No header when docked in page (clean look)
  const showMinBtn = !isTerminalPage && pipState !== 'minimized'

  return (
    <>
      {/* Minimized: floating button (only when NOT on terminal page) */}
      {!isTerminalPage && pipState === 'minimized' && (
        <div className="fixed bottom-4 left-4 z-[9990] group">
          <button
            onClick={openTerminal}
            className="relative flex items-center gap-2 rounded-2xl px-3.5 py-2 text-[12px] font-medium text-white/90 shadow-xl transition-all duration-200 hover:scale-[1.04] active:scale-[0.97] hover:shadow-2xl"
            style={{
              background: 'linear-gradient(145deg, #161b22, #0d1117)',
              border: '1px solid rgba(88,166,255,0.15)',
            }}
            title="Terminal (Ctrl+`)"
          >
            <TerminalIcon size={14} className="text-green-400" />
            <span className="text-gray-300">Terminal</span>
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
          </button>
        </div>
      )}

      {/* Terminal container — NEVER unmounts once opened */}
      {(isVisible || hasBeenOpened) && (
        <div
          ref={panelRef}
          className={`flex flex-col overflow-hidden ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
          style={{
            ...containerStyle,
            userSelect: isDragging || isResizing ? 'none' : 'auto',
            display: isVisible ? 'flex' : 'none'
          }}
        >
          {/* Header (hidden when docked in page) */}
          {showHeader && (
            <div
              onMouseDown={!mobile && (isPip || isFloating) ? onDragStart : undefined}
              onTouchStart={!mobile && (isPip || isFloating) ? onTouchDragStart : undefined}
              className={`flex shrink-0 items-center justify-between px-2.5 py-1 select-none ${!mobile && (isPip || isFloating) ? 'cursor-move' : ''}`}
              style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
            >
              <div className="flex items-center gap-1.5">
                {!mobile && (isPip || isFloating) && <GripVertical size={9} className="text-gray-700" />}
                <TerminalIcon size={10} className="text-green-400" />
                <span className="text-[10px] font-medium text-gray-500">Terminal</span>
              </div>
              <div className="flex items-center gap-0.5">
                {isPip && !mobile && (
                  <button onClick={() => setPipState('floating')} className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-white/5 transition" title="Expandir">
                    <Maximize2 size={9} className="text-gray-600 hover:text-gray-300" />
                  </button>
                )}
                {isFloating && !mobile && (
                  <button onClick={() => setPipState('maximized')} className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-white/5 transition" title="Tela cheia">
                    <Maximize2 size={9} className="text-gray-600 hover:text-gray-300" />
                  </button>
                )}
                {(isMaximized || isFloating) && (
                  <button onClick={() => setPipState('pip')} className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-white/5 transition" title="Mini player">
                    <Minimize2 size={9} className="text-gray-600 hover:text-gray-300" />
                  </button>
                )}
                <button onClick={() => setPipState('minimized')} className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-yellow-500/10 transition" title="Minimizar">
                  <Minus size={9} className="text-gray-600 hover:text-yellow-400" />
                </button>
                <button onClick={() => setPipState('closed')} className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-red-500/10 transition" title="Ocultar (Ctrl+` reabre)">
                  <X size={9} className="text-gray-600 hover:text-red-400" />
                </button>
              </div>
            </div>
          )}

          {/* Terminal instance — single, persistent, never remounts */}
          <div className="flex-1 overflow-hidden">
            <Terminal showPageIntro={false} />
          </div>

          {/* Resize handle */}
          {isFloating && !mobile && (
            <div
              onMouseDown={onResizeStart}
              className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-se-resize opacity-40 hover:opacity-80 transition-opacity"
              style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(88,166,255,0.4) 50%)' }}
            />
          )}
        </div>
      )}
    </>
  )
}

export default FloatingTerminal
