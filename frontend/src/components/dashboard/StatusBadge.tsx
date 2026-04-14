import Badge from '../ui/Badge'
import type { StackStatus } from '../../types/stack'

const statusMeta: Record<StackStatus, { label: string; variant: 'success' | 'warning' | 'neutral' }> = {
  running: { label: 'Rodando', variant: 'success' },
  partial: { label: 'Parcial', variant: 'warning' },
  stopped: { label: 'Parado', variant: 'neutral' },
}

type StatusBadgeProps = {
  status: StackStatus
}

const StatusBadge = ({ status }: StatusBadgeProps) => {
  const meta = statusMeta[status]
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

export default StatusBadge
