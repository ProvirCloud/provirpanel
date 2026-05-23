import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.jsx'
import { ThemeProvider } from './app/providers/theme-provider'
import { TaskProvider } from './app/providers/task-provider'
import { ConfirmProvider } from './components/ui/ConfirmModal'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <TaskProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </TaskProvider>
    </ThemeProvider>
  </StrictMode>,
)
