import type { ReactNode } from 'react'
import Card from './Card'

type SectionContainerProps = {
  title?: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
}

const SectionContainer = ({ title, subtitle, children, actions, className = '' }: SectionContainerProps) => {
  return (
    <Card className={`p-6 lg:p-7 ${className}`.trim()}>
      {(title || subtitle || actions) && (
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1.5">
            {title ? <h2 className="text-lg font-semibold text-[var(--color-text)]">{title}</h2> : null}
            {subtitle ? <p className="text-sm leading-6 text-[var(--color-text-muted)]">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </Card>
  )
}

export default SectionContainer
