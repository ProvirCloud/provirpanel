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
          <div className="space-y-1">
            {title && <h2 className="text-lg font-semibold text-white">{title}</h2>}
            {subtitle && <p className="text-sm leading-6 text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </Card>
  )
}

export default SectionContainer
