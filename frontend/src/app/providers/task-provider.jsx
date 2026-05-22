import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

const TaskContext = createContext({ tasks: [], history: [], runTask: async (_, fn) => fn(), startTask: () => '', completeTask: () => {}, failTask: () => {} })

export const useTask = () => useContext(TaskContext)

const makeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const HISTORY_KEY = 'provirpanel-task-history'
const MAX_HISTORY = 100

const loadHistory = () => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]').slice(0, MAX_HISTORY) } catch { return [] }
}
const persistHistory = (items) => {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))) } catch { /* ignore */ }
}

export function TaskProvider({ children }) {
  const [tasks, setTasks] = useState([])
  const [historyVersion, setHistoryVersion] = useState(0)
  const historyRef = useRef(loadHistory())

  const getHistory = useCallback(() => historyRef.current, [])

  const addToHistory = useCallback((task) => {
    historyRef.current = [task, ...historyRef.current].slice(0, MAX_HISTORY)
    persistHistory(historyRef.current)
    setHistoryVersion((v) => v + 1)
  }, [])

  const startTask = useCallback((label) => {
    const id = makeId()
    const task = { id, label, status: 'running', startedAt: new Date().toISOString(), completedAt: null, error: null }
    setTasks((prev) => [...prev, task])
    return id
  }, [])

  const completeTask = useCallback((taskId) => {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId)
      if (task) addToHistory({ ...task, status: 'success', completedAt: new Date().toISOString() })
      return prev.filter((t) => t.id !== taskId)
    })
  }, [addToHistory])

  const failTask = useCallback((taskId, error) => {
    const msg = typeof error === 'string' ? error : (error?.response?.data?.error || error?.message || 'Erro')
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId)
      if (task) addToHistory({ ...task, status: 'error', completedAt: new Date().toISOString(), error: msg })
      return prev.filter((t) => t.id !== taskId)
    })
  }, [addToHistory])

  const runTask = useCallback(async (label, fn) => {
    const id = startTask(label)
    try {
      const result = await fn()
      completeTask(id)
      return result
    } catch (err) {
      failTask(id, err)
      throw err
    }
  }, [startTask, completeTask, failTask])

  const value = useMemo(() => ({ tasks, runTask, startTask, completeTask, failTask, getHistory, historyVersion }), [tasks, historyVersion, runTask, startTask, completeTask, failTask, getHistory])

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>
}
