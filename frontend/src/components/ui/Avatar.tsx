import type { HTMLAttributes } from 'react'

type AvatarProps = HTMLAttributes<HTMLDivElement> & {
  name: string
}

const Avatar = ({ name, className = '', ...props }: AvatarProps) => {
  const initial = name?.trim()?.charAt(0)?.toUpperCase() || 'Z'
  return (
    <div
      {...props}
      className={`flex h-9 w-9 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,var(--zeus-blue-500),var(--zeus-electric-400))] text-sm font-semibold text-white shadow-[0_12px_24px_rgba(37,99,235,0.26)] ${className}`.trim()}
    >
      {initial}
    </div>
  )
}

export default Avatar
