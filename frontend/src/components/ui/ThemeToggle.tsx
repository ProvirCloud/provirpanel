import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../app/providers/theme-provider'
import Button from './Button'

const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme()

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={toggleTheme}
      leadingIcon={theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      className="h-10 px-3"
    >
      <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </Button>
  )
}

export default ThemeToggle
