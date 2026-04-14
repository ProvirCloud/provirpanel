import type { CSSProperties, ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useTheme } from '../../app/providers/theme-provider'
import logoDark from '../../assets/images/logoname.webp'
import logoLight from '../../assets/images/logoname_w.webp'
import Card from '../ui/Card'

type LoginCardProps = {
  title: string
  subtitle: string
  children: ReactNode
}

const LoginCard = ({ title, subtitle, children }: LoginCardProps) => {
  const { theme } = useTheme()
  const logo = theme === 'light' ? logoDark : logoLight

  return (
    <section className="order-1 lg:order-2">
      <div className="mx-auto w-full max-w-[440px]">
        <Card className="overflow-hidden p-5 sm:p-8" style={{ background: 'color-mix(in srgb, var(--card-bg-elevated) 84%, transparent)', backdropFilter: 'blur(24px)' } as CSSProperties}>
          <div className="mb-8 lg:hidden">
            <img src={logo} alt="Zeus AI Cloud OS" className="mx-auto h-12 w-auto object-contain sm:h-14" />
          </div>

          <div className="mb-8 flex items-start gap-4">
            <div className="hidden h-12 w-12 items-center justify-center rounded-[16px] border lg:flex" style={{ borderColor: 'var(--color-border)', background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}>
              <ShieldCheck size={20} />
            </div>
            <div>
              <p className="zeus-eyebrow">Secure access</p>
              <h2 className="mt-3 text-[2rem] font-bold tracking-[-0.04em] text-[var(--color-text)]">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--color-text-muted)]">{subtitle}</p>
            </div>
          </div>

          {children}
        </Card>
      </div>
    </section>
  )
}

export default LoginCard
