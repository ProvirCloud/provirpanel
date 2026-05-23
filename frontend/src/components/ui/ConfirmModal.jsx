import { createContext, useCallback, useContext, useState } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'

const ConfirmContext = createContext(null)

export const useConfirm = () => useContext(ConfirmContext)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      setState({
        title: options.title || 'Confirmar',
        message: options.message || 'Tem certeza?',
        confirmText: options.confirmText || 'Confirmar',
        cancelText: options.cancelText || 'Cancelar',
        variant: options.variant || 'danger', // 'danger' | 'warning' | 'info'
        resolve,
      })
    })
  }, [])

  const handleConfirm = () => {
    state?.resolve(true)
    setState(null)
  }

  const handleCancel = () => {
    state?.resolve(false)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && <ConfirmModal {...state} onConfirm={handleConfirm} onCancel={handleCancel} />}
    </ConfirmContext.Provider>
  )
}

function ConfirmModal({ title, message, confirmText, cancelText, variant, onConfirm, onCancel }) {
  const colors = {
    danger: { icon: '#f87171', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)', btn: 'linear-gradient(135deg,#dc2626,#b91c1c)' },
    warning: { icon: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.25)', btn: 'linear-gradient(135deg,#d97706,#b45309)' },
    info: { icon: '#60a5fa', bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.25)', btn: 'linear-gradient(135deg,#2563eb,#1d4ed8)' },
  }
  const c = colors[variant] || colors.danger
  const Icon = variant === 'danger' ? Trash2 : AlertTriangle

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={{ width: '100%', maxWidth: 380, margin: '0 16px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', background: 'linear-gradient(160deg,#0f172a,#0c1322)', boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>
        {/* Header */}
        <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: c.bg, border: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={18} style={{ color: c.icon }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{title}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>{message}</div>
          </div>
          <button onClick={onCancel} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 7, color: '#64748b', cursor: 'pointer', padding: '4px 6px', lineHeight: 1, display: 'flex', flexShrink: 0 }}>
            <X size={12} />
          </button>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '20px' }}>
          <button onClick={onCancel}
            style={{ fontSize: 12, padding: '8px 16px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', cursor: 'pointer' }}>
            {cancelText}
          </button>
          <button onClick={onConfirm}
            style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 9, border: 'none', background: c.btn, color: '#fff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
