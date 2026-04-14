import type { ReactNode } from 'react'

type CardProps = {
  children: ReactNode
  className?: string
}

const Card = ({ children, className = '' }: CardProps) => {
  return (
    <div
      className={`rounded-3xl border border-white/10 bg-[#101522]/90 shadow-[0_18px_50px_rgba(0,0,0,0.28)] ${className}`.trim()}
    >
      {children}
    </div>
  )
}

export default Card
