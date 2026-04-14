import type { CSSProperties, ReactNode } from 'react'

type Variant = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

type BadgeProps = {
  children: ReactNode
  className?: string
  variant?: Variant
}

const styleMap: Record<Variant, CSSProperties> = {
  neutral: { background: 'var(--color-surface-2)', color: 'var(--color-text-muted)', borderColor: 'var(--color-border)' },
  success: { background: 'var(--color-success-soft)', color: 'var(--color-success)', borderColor: 'color-mix(in srgb, var(--color-success) 28%, transparent)' },
  warning: { background: 'var(--color-warning-soft)', color: 'var(--color-warning)', borderColor: 'color-mix(in srgb, var(--color-warning) 28%, transparent)' },
  danger: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)', borderColor: 'color-mix(in srgb, var(--color-danger) 28%, transparent)' },
  info: { background: 'var(--color-info-soft)', color: 'var(--color-info)', borderColor: 'color-mix(in srgb, var(--color-info) 28%, transparent)' },
}

const Badge = ({ children, className = '', variant = 'neutral' }: BadgeProps) => {
  return <span className={`zeus-badge ${className}`.trim()} style={styleMap[variant]}>{children}</span>
}

export default Badge
