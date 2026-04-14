import { LayoutPanelTop, Play, RefreshCw, Trash2 } from 'lucide-react'
import type { Stack } from '../../types/stack'
import Card from '../ui/Card'
import StatusBadge from './StatusBadge'
import ActionButton from './ActionButton'

type StackCardProps = {
  stack: Stack
}

const StackCard = ({ stack }: StackCardProps) => {
  return (
    <Card className="p-6 transition-all duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--color-text)]">{stack.name}</h3>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{stack.environment} · {stack.project}</p>
        </div>
        <StatusBadge status={stack.status} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {stack.services.map((service) => (
          <span key={service} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-muted)', color: 'var(--color-text-muted)' }}>
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
        <ActionButton label="Sync" icon={RefreshCw} />
        <ActionButton label="Start" icon={Play} />
        <ActionButton label="Abrir Canvas" icon={LayoutPanelTop} variant="primary" />
        <ActionButton label="Delete" icon={Trash2} variant="danger" />
      </div>
    </Card>
  )
}

export default StackCard
