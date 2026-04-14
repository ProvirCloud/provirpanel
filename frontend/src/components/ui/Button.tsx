import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: Variant
  leadingIcon?: ReactNode
}

const variantClassName: Record<Variant, string> = {
  primary: 'border border-blue-400/30 bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-white shadow-[0_14px_32px_rgba(76,99,255,0.32)] hover:brightness-110',
  secondary: 'border border-white/10 bg-white/[0.04] text-slate-100 hover:border-white/20 hover:bg-white/[0.08]',
  ghost: 'border border-transparent bg-transparent text-slate-300 hover:bg-white/[0.05] hover:text-white',
  danger: 'border border-rose-500/20 bg-rose-500/8 text-rose-200 hover:border-rose-400/30 hover:bg-rose-500/12',
}

const Button = ({ children, variant = 'secondary', leadingIcon, className = '', ...props }: ButtonProps) => {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${variantClassName[variant]} ${className}`.trim()}
    >
      {leadingIcon}
      <span>{children}</span>
    </button>
  )
}

export default Button
