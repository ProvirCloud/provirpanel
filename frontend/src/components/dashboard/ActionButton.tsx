import type { LucideIcon } from 'lucide-react'
import Button from '../ui/Button'

type ActionButtonProps = {
  label: string
  icon?: LucideIcon
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  onClick?: () => void
}

const ActionButton = ({ label, icon: Icon, variant = 'secondary', onClick }: ActionButtonProps) => {
  return (
    <Button variant={variant} onClick={onClick} leadingIcon={Icon ? <Icon size={15} /> : undefined} className="min-w-[112px]">
      {label}
    </Button>
  )
}

export default ActionButton
