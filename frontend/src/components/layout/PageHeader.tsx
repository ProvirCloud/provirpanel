import type { ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  subtitle?: string
  actions?: ReactNode
}

const PageHeader = ({ title, subtitle, actions }: PageHeaderProps) => {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-2">
        <p className="zeus-eyebrow">Cloud Operations</p>
        <h1 className="text-[clamp(2rem,3vw,2.75rem)] font-bold tracking-[-0.05em] text-[var(--color-text)]">{title}</h1>
        {subtitle ? <p className="max-w-3xl text-sm leading-7 text-[var(--color-text-muted)] sm:text-[15px]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  )
}

export default PageHeader
