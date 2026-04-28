import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type Tone =
  | 'domain'
  | 'http'
  | 'https'
  | 'proxy'
  | 'websocket'
  | 'static'
  | 'upstream'
  | 'target'

const TONE_CLASSES: Record<
  Tone,
  {
    shell: string
    icon: string
    detail: string
  }
> = {
  domain: {
    shell: 'border-[#2f6fe0] bg-[rgba(24,44,84,0.78)] text-[#eef5ff]',
    icon: 'bg-[#1e66ff]/18 text-[#4da1ff] border-[#4da1ff]/30',
    detail: 'text-[#9ec7ff]',
  },
  http: {
    shell: 'border-[#7a44d4] bg-[rgba(56,28,84,0.74)] text-[#f4ecff]',
    icon: 'bg-[#8c52ff]/18 text-[#b98aff] border-[#b98aff]/28',
    detail: 'text-[#d8c4ff]',
  },
  https: {
    shell: 'border-[#2e9a59] bg-[rgba(24,68,50,0.78)] text-[#effff5]',
    icon: 'bg-[#35c56d]/18 text-[#6ef08f] border-[#6ef08f]/28',
    detail: 'text-[#9cebaf]',
  },
  proxy: {
    shell: 'border-[#2c67c5] bg-[rgba(17,34,66,0.72)] text-[#edf5ff]',
    icon: 'bg-[#2b72ff]/14 text-[#59a6ff] border-[#59a6ff]/24',
    detail: 'text-[#9ccaff]',
  },
  websocket: {
    shell: 'border-[#7644d6] bg-[rgba(44,24,78,0.72)] text-[#f4efff]',
    icon: 'bg-[#9658ff]/14 text-[#c08eff] border-[#c08eff]/24',
    detail: 'text-[#d8c2ff]',
  },
  static: {
    shell: 'border-[#b06f1f] bg-[rgba(64,42,17,0.72)] text-[#fff7ed]',
    icon: 'bg-[#ffab3d]/14 text-[#ffbf63] border-[#ffbf63]/24',
    detail: 'text-[#ffd08c]',
  },
  upstream: {
    shell: 'border-[#345fa8] bg-[rgba(18,34,58,0.72)] text-[#eef5ff]',
    icon: 'bg-[#4e88ff]/14 text-[#76a8ff] border-[#76a8ff]/24',
    detail: 'text-[#a9c7ff]',
  },
  target: {
    shell: 'border-[#8f5f1d] bg-[rgba(58,40,18,0.72)] text-[#fff6e8]',
    icon: 'bg-[#ffb54a]/14 text-[#ffc975] border-[#ffc975]/24',
    detail: 'text-[#ffd89f]',
  },
}

type Props = {
  title: string
  subtitle?: string
  detail?: string
  tone: Tone
  icon: LucideIcon
  selected?: boolean
  onClick?: () => void
  children?: ReactNode
  className?: string
}

export default function NginxFlowNode({
  title,
  subtitle,
  detail,
  tone,
  icon: Icon,
  selected = false,
  onClick,
  children,
  className = '',
}: Props) {
  const palette = TONE_CLASSES[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full rounded-[11px] border px-3 py-2.5 text-left transition duration-200',
        'shadow-[0_18px_50px_rgba(3,8,20,0.2)] hover:-translate-y-0.5',
        selected ? 'ring-1 ring-white/35' : '',
        palette.shell,
        className,
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={[
            'mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-[9px] border',
            palette.icon,
          ].join(' ')}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-[1.2]">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-[10px] leading-[1.2] text-white/88">{subtitle}</p>
          ) : null}
          {detail ? (
            <p className={`mt-1 text-[10px] font-medium leading-[1.2] ${palette.detail}`}>{detail}</p>
          ) : null}
        </div>
      </div>
      {children ? <div className="mt-2.5">{children}</div> : null}
    </button>
  )
}
