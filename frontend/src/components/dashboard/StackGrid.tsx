import type { Stack } from '../../types/stack'
import StackCard from './StackCard'

type StackGridProps = {
  stacks: Stack[]
}

const StackGrid = ({ stacks }: StackGridProps) => {
  if (!stacks.length) {
    return (
      <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center text-slate-400">
        Nenhuma stack encontrada.
      </div>
    )
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
