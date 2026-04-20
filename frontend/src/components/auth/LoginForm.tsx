import { Eye, EyeOff } from 'lucide-react'
import type { FormEvent } from 'react'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import Input from '../ui/Input'

type LoginFormProps = {
  username: string
  password: string
  showPassword: boolean
  rememberMe: boolean
  loading: boolean
  error: string
  mfaCode: string
  mfaRequired: boolean
  mfaSetupRequired: boolean
  mfaSetup: { qr?: string; secret?: string } | null
  onSubmit: (event: FormEvent) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onTogglePassword: () => void
  onRememberMeChange: (value: boolean) => void
  onMfaCodeChange: (value: string) => void
}

const LoginForm = ({
  username,
  password,
  showPassword,
  rememberMe,
  loading,
  error,
  mfaCode,
  mfaRequired,
  mfaSetupRequired,
  mfaSetup,
  onSubmit,
  onUsernameChange,
  onPasswordChange,
  onTogglePassword,
  onRememberMeChange,
  onMfaCodeChange,
}: LoginFormProps) => {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {!mfaRequired && !mfaSetupRequired ? (
        <>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-[var(--color-text)]">Usuário ou email</span>
            <Input
              placeholder="Digite seu acesso"
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-[var(--color-text)]">Senha</span>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Digite sua senha"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                autoComplete="current-password"
                className="pr-12"
              />
              <button
                type="button"
                onClick={onTogglePassword}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[var(--color-text-soft)] transition-colors hover:text-[var(--color-text)]"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
        </>
      ) : null}

      {mfaSetupRequired ? (
        !mfaSetup ? (
          <div className="rounded-[18px] border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-brand)', background: 'var(--color-brand-soft)', color: 'var(--color-text)' }}>
            MFA obrigatório. Continue para gerar o QR Code do autenticador.
          </div>
        ) : (
          <>
            {mfaSetup.qr ? (
              <div className="flex justify-center rounded-[20px] border bg-white p-4" style={{ borderColor: 'var(--color-border)' }}>
                <img src={mfaSetup.qr} alt="QR Code MFA" className="h-40 w-40" />
              </div>
            ) : null}
            <div className="rounded-[18px] border px-4 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-muted)' }}>
              <p className="mb-1 text-xs text-[var(--color-text-soft)]">Código manual</p>
              <p className="break-all font-mono text-sm text-[var(--color-brand)]">{mfaSetup.secret}</p>
            </div>
          </>
        )
      ) : null}

      {(mfaRequired || (mfaSetupRequired && mfaSetup)) ? (
        <label className="block space-y-2">
          <span className="text-sm font-medium text-[var(--color-text)]">Código de autenticação</span>
          <Input
            placeholder="000000"
            value={mfaCode}
            onChange={(event) => onMfaCodeChange(event.target.value)}
            autoComplete="one-time-code"
            maxLength={6}
            className="font-mono"
            autoFocus
          />
        </label>
      ) : null}

      {!mfaRequired && !mfaSetupRequired ? (
        <div className="flex items-center justify-between gap-4 text-sm">
          <Checkbox checked={rememberMe} onChange={(event) => onRememberMeChange(event.target.checked)} label="Manter conectado" />
          <button type="button" className="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]">
            Esqueceu sua senha?
          </button>
        </div>
      ) : null}

      {error ? <div className="rounded-[18px] border px-4 py-3 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-danger) 35%, transparent)', background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}>{error}</div> : null}

      <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
        {mfaSetupRequired ? (mfaSetup ? 'Ativar MFA' : 'Gerar QR Code') : mfaRequired ? 'Validar acesso' : 'Entrar no painel'}
      </Button>
    </form>
  )
}

export default LoginForm
