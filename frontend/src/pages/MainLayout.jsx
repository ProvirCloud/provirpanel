import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import AppShell from '../components/layout/AppShell'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Input from '../components/ui/Input'
import api from '../services/api.js'

const Field = ({ label, children }) => (
  <label className="block space-y-2">
    <span className="text-sm font-medium text-[var(--color-text)]">{label}</span>
    {children}
  </label>
)

const Modal = ({ title, subtitle, children, footer }) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: 'var(--color-overlay)' }}>
    <Card variant="elevated" className="w-full max-w-md p-6">
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-[var(--color-text)]">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-[var(--color-text-muted)]">{subtitle}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
      {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
    </Card>
  </div>
)

const MainLayout = () => {
  const navigate = useNavigate()
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showMfaModal, setShowMfaModal] = useState(false)
  const [mfaEnabled, setMfaEnabled] = useState(false)
  const [mfaSetup, setMfaSetup] = useState(null)
  const [mfaCode, setMfaCode] = useState('')
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' })
  const [createForm, setCreateForm] = useState({ username: '', password: '', role: 'dev' })
  const [message, setMessage] = useState('')
  const [username, setUsername] = useState('admin')

  useEffect(() => {
    api.get('/auth/me').then((response) => {
      if (response.data?.user?.username) setUsername(response.data.user.username)
    }).catch(() => {
      setUsername('admin')
    })
  }, [])

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      // ignore
    }
    try {
      localStorage.clear()
      sessionStorage.clear()
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent('provirpanel-auth', { detail: { authenticated: false } }))
    navigate('/login', { replace: true })
  }

  const openMfaModal = async () => {
    setMessage('')
    setShowMfaModal(true)
    setMfaSetup(null)
    setMfaCode('')
    try {
      const response = await api.get('/auth/mfa/status')
      setMfaEnabled(!!response.data?.enabled)
    } catch {
      setMessage('Erro ao carregar status MFA')
    }
  }

  const submitPassword = async (event) => {
    event.preventDefault()
    setMessage('')
    try {
      await api.post('/auth/change-password', passwordForm)
      setMessage('Senha atualizada com sucesso')
      setShowPasswordModal(false)
      setPasswordForm({ currentPassword: '', newPassword: '' })
    } catch {
      setMessage('Erro ao atualizar senha')
    }
  }

  const submitCreateUser = async (event) => {
    event.preventDefault()
    setMessage('')
    try {
      await api.post('/auth/users', createForm)
      setMessage('Usuário criado com sucesso')
      setShowCreateModal(false)
      setCreateForm({ username: '', password: '', role: 'dev' })
    } catch {
      setMessage('Erro ao criar usuário')
    }
  }

  return (
    <AppShell
      username={username}
      onLogout={handleLogout}
      onChangePassword={() => { setMessage(''); setShowPasswordModal(true) }}
      onCreateUser={() => { setMessage(''); setShowCreateModal(true) }}
      onManageMfa={openMfaModal}
    >
      <Outlet />

      {showPasswordModal ? (
        <Modal
          title="Alterar senha"
          subtitle="Atualize a credencial de acesso administrativo."
          footer={(
            <>
              <Button variant="secondary" type="button" onClick={() => setShowPasswordModal(false)}>Cancelar</Button>
              <Button variant="primary" onClick={submitPassword}>Salvar senha</Button>
            </>
          )}
        >
          <Field label="Senha atual">
            <Input type="password" placeholder="••••••••" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))} />
          </Field>
          <Field label="Nova senha">
            <Input type="password" placeholder="••••••••" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))} />
          </Field>
          {message ? <p className="text-sm text-[var(--color-text-muted)]">{message}</p> : null}
        </Modal>
      ) : null}

      {showCreateModal ? (
        <Modal
          title="Criar usuário"
          subtitle="Provisionar um novo acesso ao Zeus Cloud."
          footer={(
            <>
              <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)}>Cancelar</Button>
              <Button variant="primary" onClick={submitCreateUser}>Criar usuário</Button>
            </>
          )}
        >
          <Field label="Usuário">
            <Input placeholder="nome-do-usuario" value={createForm.username} onChange={(event) => setCreateForm((prev) => ({ ...prev, username: event.target.value }))} />
          </Field>
          <Field label="Senha">
            <Input type="password" placeholder="••••••••" value={createForm.password} onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))} />
          </Field>
          <Field label="Perfil">
            <select className="zeus-select" value={createForm.role} onChange={(event) => setCreateForm((prev) => ({ ...prev, role: event.target.value }))}>
              <option value="admin">Admin</option>
              <option value="dev">Dev</option>
              <option value="viewer">Viewer</option>
            </select>
          </Field>
          {message ? <p className="text-sm text-[var(--color-text-muted)]">{message}</p> : null}
        </Modal>
      ) : null}

      {showMfaModal ? (
        <Modal
          title="Autenticação em dois fatores"
          subtitle="Use Google Authenticator, Microsoft Authenticator ou Authy."
          footer={<Button variant="secondary" type="button" onClick={() => setShowMfaModal(false)}>Fechar</Button>}
        >
          {mfaEnabled ? (
            <>
              <div className="rounded-[18px] border px-4 py-3 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-success) 30%, transparent)', background: 'var(--color-success-soft)', color: 'var(--color-success)' }}>
                MFA ativo na conta.
              </div>
              <Field label="Código MFA para desativar">
                <Input placeholder="000000" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} />
              </Field>
              <Button
                variant="danger"
                className="w-full"
                onClick={async () => {
                  setMessage('')
                  try {
                    await api.post('/auth/mfa/disable', { token: mfaCode })
                    setMfaEnabled(false)
                    setMfaCode('')
                    setMessage('MFA desativado')
                  } catch {
                    setMessage('Erro ao desativar MFA')
                  }
                }}
              >
                Desativar MFA
              </Button>
            </>
          ) : (
            <>
              {!mfaSetup ? (
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={async () => {
                    setMessage('')
                    try {
                      const response = await api.post('/auth/mfa/setup')
                      setMfaSetup(response.data)
                    } catch {
                      setMessage('Erro ao iniciar MFA')
                    }
                  }}
                >
                  Gerar QR Code
                </Button>
              ) : (
                <>
                  {mfaSetup.qr ? <div className="flex justify-center rounded-[20px] border bg-white p-3" style={{ borderColor: 'var(--color-border)' }}><img src={mfaSetup.qr} alt="QR Code MFA" className="h-40 w-40" /></div> : null}
                  <div className="rounded-[18px] border px-4 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-muted)' }}>
                    <p className="mb-1 text-xs text-[var(--color-text-soft)]">Código manual</p>
                    <p className="break-all font-mono text-sm text-[var(--color-brand)]">{mfaSetup.secret}</p>
                  </div>
                  <Field label="Código do autenticador">
                    <Input placeholder="000000" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} />
                  </Field>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      setMessage('')
                      try {
                        await api.post('/auth/mfa/enable', { token: mfaCode })
                        setMfaEnabled(true)
                        setMfaCode('')
                        setMfaSetup(null)
                        setMessage('MFA ativado')
                      } catch {
                        setMessage('Código MFA inválido')
                      }
                    }}
                  >
                    Ativar MFA
                  </Button>
                </>
              )}
            </>
          )}
          {message ? <p className="text-sm text-[var(--color-text-muted)]">{message}</p> : null}
        </Modal>
      ) : null}
    </AppShell>
  )
}

export default MainLayout
