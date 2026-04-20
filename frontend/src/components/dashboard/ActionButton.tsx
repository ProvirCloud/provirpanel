import type { LucideIcon } from 'lucide-react'
import Button from '../ui/Button'

type ActionButtonProps = {
  label: string
  icon?: LucideIcon
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  onClick?: () => void
  disabled?: boolean
}

const ActionButton = ({ label, icon: Icon, variant = 'secondary', onClick, disabled = false }: ActionButtonProps) => {
  return (
    <Button variant={variant} onClick={onClick} disabled={disabled} leadingIcon={Icon ? <Icon size={15} /> : undefined} size="sm" className="min-w-[116px]">
      {label}
    </Button>
  )
}

export default ActionButton
