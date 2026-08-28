/**
 * TerminalPage - Container placeholder para a rota /terminal.
 * 
 * O FloatingTerminal (instância única global) detecta esta página via useLocation
 * e "encaixa" visualmente neste container usando position:fixed + getBoundingClientRect.
 * Isso evita unmount/remount do Terminal, mantendo a sessão WebSocket viva.
 */

const TERMINAL_PAGE_CONTAINER_ID = 'terminal-page-container'

const TerminalPage = () => {
  return (
    <div
      id={TERMINAL_PAGE_CONTAINER_ID}
      className="h-full w-full min-h-[500px] rounded-xl"
      style={{ background: 'transparent' }}
    />
  )
}

export { TERMINAL_PAGE_CONTAINER_ID }
export default TerminalPage
