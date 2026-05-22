import { useTask } from '../../app/providers/task-provider'
import { CheckCircle, XCircle, Loader2, Clock, Trash2, ChevronDown, ChevronUp } from 'lucide-react'

const formatTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const formatDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + formatTime(iso)
}

export default function TaskBar() {
  const { tasks, history, showHistory, setShowHistory, clearHistory } = useTask()

  const activeTasks = tasks.filter((t) => t.status === 'running')
  const recentDone = tasks.filter((t) => t.status !== 'running')

  if (activeTasks.length === 0 && recentDone.length === 0 && !showHistory) return null

  return (
    <>
      {/* Top bar */}
      {(activeTasks.length > 0 || recentDone.length > 0) && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px',
          background: 'linear-gradient(90deg, rgba(6,12,24,0.97), rgba(10,18,36,0.97))',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          {/* Active tasks */}
          {activeTasks.map((task) => (
            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 8, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }}>
              <Loader2 size={12} style={{ color: '#60a5fa', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 11, color: '#93c5fd', fontWeight: 500 }}>{task.label}</span>
            </div>
          ))}

          {/* Recently completed */}
          {recentDone.map((task) => (
            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 8, background: task.status === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${task.status === 'success' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
              {task.status === 'success' ? <CheckCircle size={12} style={{ color: '#34d399' }} /> : <XCircle size={12} style={{ color: '#f87171' }} />}
              <span style={{ fontSize: 11, color: task.status === 'success' ? '#6ee7b7' : '#fca5a5', fontWeight: 500 }}>{task.label}</span>
            </div>
          ))}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* History toggle */}
          <button onClick={() => setShowHistory(!showHistory)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 8px' }}>
            <Clock size={11} />
            Histórico ({history.length})
            {showHistory ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        </div>
      )}

      {/* History panel */}
      {showHistory && (
        <div style={{
          position: 'fixed', top: activeTasks.length > 0 || recentDone.length > 0 ? 38 : 0, right: 16, zIndex: 9998,
          width: 380, maxHeight: '70vh', overflowY: 'auto',
          borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)',
          background: 'linear-gradient(160deg, rgba(8,16,32,0.98), rgba(6,13,26,0.98))',
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
          backdropFilter: 'blur(16px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>Histórico de operações</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={clearHistory} style={{ fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Trash2 size={10} /> Limpar
              </button>
              <button onClick={() => setShowHistory(false)} style={{ fontSize: 12, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>
          </div>
          <div style={{ padding: '8px' }}>
            {history.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 11, color: '#334155' }}>Nenhuma operação registrada</div>
            )}
            {history.map((task, i) => (
              <div key={`${task.id}-${i}`} style={{ display: 'flex', gap: 10, padding: '8px 10px', borderRadius: 8, marginBottom: 2, background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ marginTop: 2, flexShrink: 0 }}>
                  {task.status === 'success' ? <CheckCircle size={14} style={{ color: '#34d399' }} /> : <XCircle size={14} style={{ color: '#f87171' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: '#e2e8f0' }}>{task.label}</div>
                  <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
                    {formatDate(task.startedAt)}
                    {task.user && <span> · {task.user}</span>}
                  </div>
                  {task.error && (
                    <div style={{ fontSize: 10, color: '#fca5a5', marginTop: 4, padding: '4px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', fontFamily: 'ui-monospace,monospace', wordBreak: 'break-all' }}>
                      {task.error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  )
}
