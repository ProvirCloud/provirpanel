import type { Stack } from '../../types/stack'
import EmptyState from '../ui/EmptyState'
import StackCard from './StackCard'

type StackGridProps = {
  stacks: Stack[]
}

const StackGrid = ({ stacks }: StackGridProps) => {
  if (!stacks.length) {
    return <EmptyState title="Nenhuma stack encontrada" description="Assim que novas stacks forem criadas, elas aparecerão aqui com status, serviços e ações operacionais." />
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
      {stacks.map((stack) => (
        <StackCard key={stack.id} stack={stack} />
      ))}
    </div>
  )
}

export default StackGrid
