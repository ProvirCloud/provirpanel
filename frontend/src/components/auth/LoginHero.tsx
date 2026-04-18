import { CloudCog, Globe2, SlidersHorizontal } from 'lucide-react'
import { useTheme } from '../../app/providers/theme-provider'
import logoDark from '../../assets/images/logoname.webp'
import logoLight from '../../assets/images/logoname_w.webp'
import Card from '../ui/Card'

const features = [
  {
    icon: CloudCog,
    title: 'Criação Autônoma',
    description: 'Agilidade, Eficiência e custo inigualável',
  },
  {
    icon: Globe2,
    title: 'Gestão de Multiplas Núvens',
    description: 'AWS, VPS, AZURE, Google, Digital Oceans, Firebase, IBM',
  },
  {
    icon: SlidersHorizontal,
    title: 'Infraestrutura Adaptativa',
    description: 'Modelagem operacional altamente personalizável.',
  },
]

const LoginHero = () => {
  const { theme } = useTheme()
  const logo = theme === 'light' ? logoLight : logoDark
  const overlayClass = theme === 'light'
    ? 'bg-[radial-gradient(circle_at_22%_18%,rgba(79,144,255,0.08),transparent_22%),radial-gradient(circle_at_82%_14%,rgba(47,192,255,0.05),transparent_16%),radial-gradient(circle_at_62%_82%,rgba(37,99,235,0.05),transparent_22%)]'
    : 'bg-[radial-gradient(circle_at_22%_18%,rgba(79,144,255,0.22),transparent_24%),radial-gradient(circle_at_82%_14%,rgba(47,192,255,0.12),transparent_18%),radial-gradient(circle_at_62%_82%,rgba(37,99,235,0.12),transparent_26%)]'

  return (
    <section className="order-2 lg:order-1">
      <Card className="zeus-surface-grid relative overflow-hidden p-7 sm:p-10 lg:p-12" variant={theme === 'light' ? 'elevated' : 'default'}>
        <div className={`pointer-events-none absolute inset-0 ${overlayClass}`} />
        <div className="relative">
          <img src={logo} alt="Zeus AI Cloud OS" className="zeus-logo-glow h-12 w-auto object-contain sm:h-14" />

          <div className="mt-10 max-w-[640px] space-y-6">
            <p className="zeus-eyebrow">ZEUSCLOUD | AI CLOUD OS</p>
            <h1 className="zeus-heading-title max-w-[680px]">Crie e Gerencie Infraestruturas Multi-Cloud em uma Única Plataforma.</h1>
            <p className="max-w-[620px] text-base leading-8 text-[var(--color-text-muted)] sm:text-lg">
              Orquestre aplicações, serviços, storage, backups e observabilidade com segurança em tempo real.
            </p>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <Card key={title} variant="muted" className="p-4 transition-transform duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:-translate-y-0.5">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[14px] border bg-[var(--color-brand-soft)] text-[var(--color-brand)]" style={{ borderColor: 'var(--color-border)' }}>
                  <Icon size={18} />
                </div>
                <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>
              </Card>
            ))}
          </div>
        </div>
      </Card>
    </section>
  )
}

export default LoginHero
