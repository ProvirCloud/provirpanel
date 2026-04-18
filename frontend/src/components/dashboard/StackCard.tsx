import { LayoutPanelTop, Play, RefreshCw, Trash2 } from 'lucide-react'
import type { Stack } from '../../types/stack'
import Card from '../ui/Card'
import StatusBadge from './StatusBadge'
import ActionButton from './ActionButton'

type StackCardProps = {
  stack: Stack
  onSync?: (stack: Stack) => void
  onStart?: (stack: Stack) => void
  onOpenCanvas?: (stack: Stack) => void
  onDelete?: (stack: Stack) => void
  busyAction?: string | null
}

const StackCard = ({ stack, onSync, onStart, onOpenCanvas, onDelete, busyAction }: StackCardProps) => {
  const isRunning = stack.status === 'running'
  const actionKey = `${stack.id}:`

  return (
    <Card variant="elevated" className="p-6 transition-all duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--color-text)]">{stack.name}</h3>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{stack.environment} · {stack.project}</p>
        </div>
        <StatusBadge status={stack.status} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {stack.services.map((service) => (
          <span key={service} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-canvas-subtle)', color: 'var(--color-text-muted)' }}>
            {service}
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--color-text-muted)]">
        <span>{stack.totalServices} serviços</span>
        <span>{stack.runningServices} rodando</span>
        {stack.network ? <span>rede: {stack.network}</span> : null}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <ActionButton label="Sync" icon={RefreshCw} onClick={() => onSync?.(stack)} disabled={busyAction === `${actionKey}sync`} />
        <ActionButton label={isRunning ? 'Stop' : 'Start'} icon={Play} onClick={() => onStart?.(stack)} disabled={busyAction === `${actionKey}start`} />
        <ActionButton label="Abrir Canvas" icon={LayoutPanelTop} variant="primary" onClick={() => onOpenCanvas?.(stack)} />
        <ActionButton label="Delete" icon={Trash2} variant="danger" onClick={() => onDelete?.(stack)} disabled={busyAction === `${actionKey}delete`} />
      </div>
    </Card>
  )
}

export default StackCard
