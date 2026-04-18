import type { Stack } from '../../types/stack'
import EmptyState from '../ui/EmptyState'
import StackCard from './StackCard'

type StackGridProps = {
  stacks: Stack[]
  onSync?: (stack: Stack) => void
  onStart?: (stack: Stack) => void
  onOpenCanvas?: (stack: Stack) => void
  onDelete?: (stack: Stack) => void
  busyAction?: string | null
}

const StackGrid = ({ stacks, onSync, onStart, onOpenCanvas, onDelete, busyAction }: StackGridProps) => {
  if (!stacks.length) {
    return <EmptyState title="Nenhuma stack encontrada" description="Assim que novas stacks forem criadas, elas aparecerão aqui com status, serviços e ações operacionais." />
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
      {stacks.map((stack) => (
        <StackCard
          key={stack.id}
          stack={stack}
          onSync={onSync}
          onStart={onStart}
          onOpenCanvas={onOpenCanvas}
          onDelete={onDelete}
          busyAction={busyAction}
        />
      ))}
    </div>
  )
}

export default StackGrid
