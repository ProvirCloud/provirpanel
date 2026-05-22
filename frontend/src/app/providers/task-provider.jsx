import { createContext, useCallback, useContext, useRef, useState } from 'react'

const TaskContext = createContext(null)

export const useTask = () => useContext(TaskContext)

const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export function TaskProvider({ children }) {
  const [tasks, setTasks] = useState([]) // active tasks
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('provirpanel-task-history')
      return saved ? JSON.parse(saved).slice(0, 50) : []
    } catch { return [] }
  })
  const [showHistory, setShowHistory] = useState(false)
  const tasksRef = useRef([])

  const saveHistory = (items) => {
    const trimmed = items.slice(0, 50)
    setHistory(trimmed)
    try { localStorage.setItem('provirpanel-task-history', JSON.stringify(trimmed)) } catch { /* ignore */ }
  }

  const startTask = useCallback((label, options = {}) => {
    const task = {
      id: generateId(),
      label,
      status: 'running', // running | success | error
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      user: options.user || null,
    }
    setTasks((prev) => [...prev, task])
    tasksRef.current = [...tasksRef.current, task]
    return task.id
  }, [])

  const completeTask = useCallback((taskId, options = {}) => {
    setTasks((prev) => {
      const updated = prev.map((t) =>
        t.id === taskId ? { ...t, status: 'success', completedAt: new Date().toISOString() } : t
      )
      tasksRef.current = updated
      return updated
    })
    // Move to history after 3s
    setTimeout(() => {
      setTasks((prev) => {
        const task = prev.find((t) => t.id === taskId)
        if (task) {
          saveHistory([{ ...task, status: 'success', completedAt: task.completedAt || new Date().toISOString() }, ...history])
        }
        const filtered = prev.filter((t) => t.id !== taskId)
        tasksRef.current = filtered
        return filtered
      })
    }, 3000)
  }, [history])

  const failTask = useCallback((taskId, error) => {
    const errorMsg = typeof error === 'string' ? error : (error?.message || error?.response?.data?.error || 'Erro desconhecido')
    setTasks((prev) => {
      const updated = prev.map((t) =>
        t.id === taskId ? { ...t, status: 'error', completedAt: new Date().toISOString(), error: errorMsg } : t
      )
      tasksRef.current = updated
      return updated
    })
    // Move to history after 5s
    setTimeout(() => {
      setTasks((prev) => {
        const task = prev.find((t) => t.id === taskId)
        if (task) {
          saveHistory([{ ...task }, ...history])
        }
        const filtered = prev.filter((t) => t.id !== taskId)
        tasksRef.current = filtered
        return filtered
      })
    }, 5000)
  }, [history])

  // Helper: run an async function with automatic task tracking
  const runTask = useCallback(async (label, fn, options = {}) => {
    const taskId = startTask(label, options)
    try {
      const result = await fn()
      completeTask(taskId)
      return result
    } catch (err) {
      failTask(taskId, err)
      throw err
    }
  }, [startTask, completeTask, failTask])

  const clearHistory = useCallback(() => {
    saveHistory([])
  }, [])

  return (
    <TaskContext.Provider value={{ tasks, history, showHistory, setShowHistory, startTask, completeTask, failTask, runTask, clearHistory }}>
      {children}
    </TaskContext.Provider>
  )
}
