import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

const ThemeToggle = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const saved = localStorage.getItem('zeus-theme')
    const next = saved === 'light' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-zeus-theme', next)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('zeus-theme', next)
    document.documentElement.setAttribute('data-zeus-theme', next)
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-slate-300 transition-all hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
      title="Alternar tema"
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      <span className="hidden sm:inline">Tema</span>
    </button>
  )
}

export default ThemeToggle
