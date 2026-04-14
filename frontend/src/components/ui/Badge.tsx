import type { ReactNode } from 'react'

type BadgeProps = {
  children: ReactNode
  className?: string
}

const Badge = ({ children, className = '' }: BadgeProps) => {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${className}`.trim()}>
      {children}
    </span>
  )
}

export default Badge
