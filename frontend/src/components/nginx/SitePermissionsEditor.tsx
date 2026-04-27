import { Shield, Users, Lock, User, Check, X, ChevronDown, Info } from 'lucide-react'
import { useState } from 'react'
import Button from '../ui/Button'
import Badge from '../ui/Badge'

type PermissionLevel = 'view' | 'edit' | 'manage' | 'admin'

type SitePermission = {
  id: string
  username: string
  level: PermissionLevel
  grantedAt: string
  grantedBy: string
}

type SitePermissionsEditorProps = {
  siteName: string
  permissions: SitePermission[]
  currentUserRole: 'admin' | 'editor' | 'viewer'
  onAddPermission: (username: string, level: PermissionLevel) => Promise<void>
  onRemovePermission: (id: string) => Promise<void>
  onUpdatePermission: (id: string, level: PermissionLevel) => Promise<void>
  onClose: () => void
}

const PERMISSION_LEVELS: Record<PermissionLevel, { label: string; description: string; icon: React.ReactNode; color: string }> = {
  view: {
    label: 'Visualizar',
    description: 'Apenas visualizar configuração',
    icon: <Info size={14} />,
    color: '#6b7280'
  },
  edit: {
    label: 'Editar',
    description: 'Visualizar e editar configuração',
    icon: <User size={14} />,
    color: '#3b82f6'
  },
  manage: {
    label: 'Gerenciar',
    description: 'Editar, ativar/desativar, backup',
    icon: <Lock size={14} />,
    color: '#8b5cf6'
  },
  admin: {
    label: 'Administrador',
    description: 'Acesso total, deletar, permissões',
    icon: <Shield size={14} />,
    color: '#ef4444'
  }
}

const SitePermissionsEditor = ({
  siteName,
  permissions,
  currentUserRole,
  onAddPermission,
  onRemovePermission,
  onUpdatePermission,
  onClose
}: SitePermissionsEditorProps) => {
  const [newUsername, setNewUsername] = useState('')
  const [newLevel, setNewLevel] = useState<PermissionLevel>('view')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canManagePermissions = currentUserRole === 'admin'

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUsername.trim()) return

    setLoading(true)
    setError('')
    try {
      await onAddPermission(newUsername.trim(), newLevel)
      setNewUsername('')
      setNewLevel('view')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao adicionar permissão')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
              Permissões do Site
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {siteName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-slate-800"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ✕
          </button>
        </div>

        {/* Permission Levels Reference */}
        <div className="mb-6 space-y-2 rounded-lg p-4" style={{ backgroundColor: 'var(--color-canvas-subtle)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>
            NÍVEIS DE PERMISSÃO:
          </p>
          {(Object.entries(PERMISSION_LEVELS) as [PermissionLevel, typeof PERMISSION_LEVELS[PermissionLevel]][]).map(
            ([level, info]) => (
              <div key={level} className="flex items-start gap-3">
                <span style={{ color: info.color }}>{info.icon}</span>
                <div>
                  <p className="text-xs font-medium" style={{ color: info.color }}>
                    {info.label}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {info.description}
                  </p>
                </div>
              </div>
            )
          )}
        </div>

        {/* Add Permission Form */}
        {canManagePermissions && (
          <form onSubmit={handleAdd} className="mb-6 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <input
                type="text"
                placeholder="Nome do usuário"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                disabled={loading}
                className="col-span-2 rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-panel)',
                  color: 'var(--color-text)'
                }}
              />
              <select
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value as PermissionLevel)}
                disabled={loading}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-panel)',
                  color: 'var(--color-text)'
                }}
              >
                {Object.entries(PERMISSION_LEVELS).map(([level, info]) => (
                  <option key={level} value={level}>
                    {info.label}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={loading || !newUsername.trim()}
            >
              {loading ? 'Adicionando...' : 'Adicionar'}
            </Button>
          </form>
        )}

        {/* Permissions List */}
        <div className="space-y-2">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Usuários com acesso ({permissions.length})
          </p>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {permissions.length ? (
              permissions.map((perm) => {
                const info = PERMISSION_LEVELS[perm.level]
                return (
                  <div
                    key={perm.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                    style={{
                      borderColor: 'var(--color-border-subtle)',
                      backgroundColor: 'var(--color-canvas-subtle)'
                    }}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span style={{ color: 'var(--color-text)' }} className="font-medium">
                          {perm.username}
                        </span>
                        <Badge variant="neutral" style={{ color: info.color }}>
                          {info.label}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        Concedido por {perm.grantedBy} • {new Date(perm.grantedAt).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    {canManagePermissions && (
                      <div className="ml-3 flex gap-2">
                        <select
                          value={perm.level}
                          onChange={(e) => onUpdatePermission(perm.id, e.target.value as PermissionLevel)}
                          className="rounded px-2 py-1 text-xs"
                          style={{
                            borderColor: 'var(--color-border)',
                            backgroundColor: 'var(--color-panel)',
                            color: 'var(--color-text)'
                          }}
                        >
                          {Object.entries(PERMISSION_LEVELS).map(([level, info]) => (
                            <option key={level} value={level}>
                              {info.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => onRemovePermission(perm.id)}
                          className="rounded px-2 py-1 text-xs hover:opacity-75"
                          style={{ color: '#ef4444' }}
                        >
                          Remover
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            ) : (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Sem permissões atribuídas
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  )
}

export default SitePermissionsEditor
