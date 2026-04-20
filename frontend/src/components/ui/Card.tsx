import type { HTMLAttributes, ReactNode } from 'react'

type Variant = 'default' | 'elevated' | 'muted'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  variant?: Variant
}

const variantClassName: Record<Variant, string> = {
  default: 'zeus-panel',
  elevated: 'zeus-panel-elevated',
  muted: 'zeus-panel-muted',
}

const Card = ({ children, variant = 'default', className = '', ...props }: CardProps) => {
  return (
    <div {...props} className={`${variantClassName[variant]} ${className}`.trim()}>
      {children}
    </div>
  )
}

export default Card
