import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: Variant
  size?: Size
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  loading?: boolean
}

const variantClassName: Record<Variant, string> = {
  primary: 'zeus-btn zeus-btn-primary',
  secondary: 'zeus-btn zeus-btn-secondary',
  ghost: 'zeus-btn zeus-btn-ghost',
  danger: 'zeus-btn zeus-btn-danger',
}

const sizeClassName: Record<Size, string> = {
  sm: 'min-h-[36px] px-3 py-2 text-xs',
  md: 'min-h-[42px] px-4 py-2.5 text-sm',
  lg: 'min-h-[48px] px-5 py-3 text-sm',
}

const Button = ({
  children,
  variant = 'secondary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  loading = false,
  className = '',
  disabled,
  ...props
}: ButtonProps) => {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${variantClassName[variant]} ${sizeClassName[size]} ${className}`.trim()}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : leadingIcon}
      <span>{children}</span>
      {!loading ? trailingIcon : null}
    </button>
  )
}

export default Button
