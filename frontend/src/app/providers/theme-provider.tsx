import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ThemeName } from '../../types/theme'

type ThemeContextValue = {
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'zeus-theme'

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<ThemeName>('dark')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const nextTheme: ThemeName = stored === 'light' ? 'light' : 'dark'
    setThemeState(nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
  }, [])

  const setTheme = (nextTheme: ThemeName) => {
    setThemeState(nextTheme)
    localStorage.setItem(STORAGE_KEY, nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
  }

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
