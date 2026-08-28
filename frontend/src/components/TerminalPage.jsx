import { useEffect, useRef } from 'react'

const TERMINAL_PAGE_CONTAINER_ID = 'terminal-page-container'

/**
 * TerminalPage - Container para o terminal quando na rota /terminal.
 * O FloatingTerminal detecta este container e renderiza o terminal aqui via portal.
 * Isso mantém uma única instância de Terminal (sem duplicação de WebSocket).
 */
const TerminalPage = () => {
  return (
    <div
      id={TERMINAL_PAGE_CONTAINER_ID}
      className="flex flex-col h-full w-full min-h-[400px] rounded-xl overflow-hidden border border-[var(--color-border)]"
      style={{ background: '#0d1117' }}
    />
  )
}

export { TERMINAL_PAGE_CONTAINER_ID }
export default TerminalPage
