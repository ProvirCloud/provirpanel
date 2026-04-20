import type { ReactNode } from 'react'
import Card from './Card'

type EmptyStateProps = {
  title: string
  description: string
  action?: ReactNode
}

const EmptyState = ({ title, description, action }: EmptyStateProps) => {
  return (
    <Card variant="muted" className="border-dashed px-6 py-16 text-center">
      <h3 className="text-lg font-semibold text-[var(--color-text)]">{title}</h3>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--color-text-muted)]">{description}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </Card>
  )
}

export default EmptyState
