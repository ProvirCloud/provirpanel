import Badge from '../ui/Badge'
import type { StackStatus } from '../../types/stack'

const statusMeta: Record<StackStatus, { label: string; className: string }> = {
  running: { label: 'Rodando', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
  partial: { label: 'Parcial', className: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  stopped: { label: 'Parado', className: 'border-slate-500/20 bg-slate-500/10 text-slate-300' },
}

type StatusBadgeProps = {
  status: StackStatus
}

const StatusBadge = ({ status }: StatusBadgeProps) => {
  const meta = statusMeta[status]
  return <Badge className={meta.className}>{meta.label}</Badge>
}

export default StatusBadge
