import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck,
  Server,
  Activity,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
} from 'lucide-react'
import api from '../services/api.js'
import logoNameDark from '../assets/images/logoname.webp'

const highlights = [
  {
    icon: Server,
    label: 'Infraestrutura centralizada',
    desc: 'Gerencie serviços, aplicações, storage e rede em uma única camada operacional.',
  },
  {
    icon: Activity,
    label: 'Operação em tempo real',
    desc: 'Monitore disponibilidade, observabilidade e estado dos ambientes sem trocar de contexto.',
  },
  {
    icon: Lock,
    label: 'Governança e segurança',
    desc: 'Controle acessos, políticas e fluxos críticos com postura enterprise desde a entrada.',
  },
]

const LoginPage = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaToken, setMfaToken] = useState('')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaSetupToken, setMfaSetupToken] = useState('')
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false)
  const [mfaSetup, setMfaSetup] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mfaSetupRequired) {
        if (!mfaSetup) {
          const r = await api.post('/auth/mfa/setup-login', { mfaSetupToken })
          setMfaSetup(r.data)
          setLoading(false)
          return
        }
        const r = await api.post('/auth/mfa/enable-login', { token: mfaCode, mfaSetupToken })
        if (r.data?.token) localStorage.setItem('provirpanel-token', r.data.token)
        window.dispatchEvent(new CustomEvent('provirpanel-auth', { detail: { authenticated: true } }))
        navigate('/')
        return
      }

      if (mfaRequired) {
        const r = await api.post('/auth/mfa/confirm', { token: mfaCode, mfaToken })
        if (r.data?.token) localStorage.setItem('provirpanel-token', r.data.token)
        window.dispatchEvent(new CustomEvent('provirpanel-auth', { detail: { authenticated: true } }))
        navigate('/')
        return
      }

      const r = await api.post('/auth/login', { username, password })
      if (r.data?.mfaSetupRequired) {
        setMfaSetupRequired(true)
        setMfaSetupToken(r.data.mfaSetupToken || '')
        setLoading(false)
        return
      }
      if (r.data?.mfaRequired) {
        setMfaRequired(true)
        setMfaToken(r.data.mfaToken || '')
        setLoading(false)
        return
      }
      if (r.data?.token) localStorage.setItem('provirpanel-token', r.data.token)
      window.dispatchEvent(new CustomEvent('provirpanel-auth', { detail: { authenticated: true } }))
      navigate('/')
    } catch {
      setError(
        mfaSetupRequired
          ? 'Não foi possível configurar o MFA'
          : mfaRequired
            ? 'Código MFA inválido'
            : 'Credenciais inválidas'
      )
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0f1a] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(71,107,255,0.26),transparent_24%),radial-gradient(circle_at_80%_18%,rgba(79,174,255,0.18),transparent_20%),radial-gradient(circle_at_55%_80%,rgba(115,74,255,0.16),transparent_26%)]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:88px_88px]" />
        <div className="absolute left-[8%] top-[14%] h-72 w-72 rounded-full bg-[#3d63ff]/25 blur-3xl animate-[pulse_12s_ease-in-out_infinite]" />
        <div className="absolute bottom-[10%] right-[10%] h-80 w-80 rounded-full bg-cyan-400/15 blur-3xl animate-[pulse_14s_ease-in-out_infinite]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-[1560px] items-center px-4 py-6 sm:px-6 lg:px-10">
        <div className="grid w-full items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] xl:gap-12">
          <section className="order-2 lg:order-1">
            <div className="mx-auto max-w-[720px] lg:mx-0 lg:min-h-[680px] lg:justify-center">
              <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-7 shadow-[0_20px_80px_rgba(6,12,28,0.38)] backdrop-blur-xl sm:p-10 lg:p-12">
                <img src={logoNameDark} alt="Zeus AI Cloud OS" className="h-12 w-auto object-contain sm:h-14" />

                <div className="mt-10 max-w-[640px] space-y-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-blue-200/85">
                    AI Cloud OS
                  </p>
                  <h1 className="max-w-[620px] text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-white sm:text-5xl xl:text-[4.25rem]">
                    Controle sua infraestrutura em uma única plataforma
                  </h1>
                  <p className="max-w-[620px] text-base leading-8 text-slate-300 sm:text-lg">
                    Orquestre aplicações, serviços, storage, backups e observabilidade com segurança e operação em tempo real.
                  </p>
                </div>

                <div className="mt-10 grid gap-3 sm:grid-cols-3">
                  {highlights.map(({ icon: Icon, label, desc }) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 transition-all duration-300 hover:border-blue-400/30 hover:bg-white/[0.05]"
                    >
                      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-blue-500/20 to-violet-500/10 shadow-[0_0_24px_rgba(61,99,255,0.18)]">
                        <Icon size={18} className="text-blue-200" />
                      </div>
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="order-1 lg:order-2">
            <div className="mx-auto w-full max-w-[420px]">
              <div className="rounded-[20px] border border-white/10 bg-[rgba(10,14,24,0.72)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-8">
                <div className="mb-8 lg:hidden">
                  <img src={logoNameDark} alt="Zeus AI Cloud OS" className="mx-auto h-12 w-auto object-contain sm:h-14" />
                </div>

                <div className="mb-8">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-blue-200/80">
                    Secure Access
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white">
                    {mfaSetupRequired ? 'Configurar MFA' : mfaRequired ? 'Verificação MFA' : 'Acesse o AI Cloud OS'}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-300">
                    {mfaRequired
                      ? 'Insira o código do autenticador para continuar.'
                      : 'Controle total da sua infraestrutura, aplicações e dados.'}
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  {!mfaRequired && !mfaSetupRequired && (
                    <>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-slate-200">Usuário ou email</span>
                        <input
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-base text-white outline-none transition-all placeholder:text-slate-500 focus:border-blue-400/60 focus:bg-white/[0.07] focus:shadow-[0_0_0_4px_rgba(64,120,255,0.12)]"
                          placeholder="Digite seu acesso"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          autoComplete="username"
                          autoFocus
                        />
                      </label>

                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-slate-200">Senha</span>
                        <div className="relative">
                          <input
                            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 pr-12 text-base text-white outline-none transition-all placeholder:text-slate-500 focus:border-blue-400/60 focus:bg-white/[0.07] focus:shadow-[0_0_0_4px_rgba(64,120,255,0.12)]"
                            type={showPassword ? 'text' : 'password'}
                            placeholder="Digite sua senha"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:text-white"
                            aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                          >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                      </label>
                    </>
                  )}

                  {mfaSetupRequired && (
                    <>
                      {!mfaSetup ? (
                        <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
                          MFA obrigatório. Continue para gerar o QR Code do autenticador.
                        </div>
                      ) : (
                        <>
                          {mfaSetup.qr && (
                            <div className="flex justify-center rounded-2xl border border-white/10 bg-white p-4">
                              <img src={mfaSetup.qr} alt="QR Code MFA" className="h-40 w-40" />
                            </div>
                          )}
                          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                            <p className="mb-1 text-xs text-slate-400">Código manual</p>
                            <p className="mono break-all text-sm text-blue-200">{mfaSetup.secret}</p>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {(mfaRequired || (mfaSetupRequired && mfaSetup)) && (
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-200">Código de autenticação</span>
                      <input
                        className="mono w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-base text-white outline-none transition-all placeholder:text-slate-500 focus:border-blue-400/60 focus:bg-white/[0.07] focus:shadow-[0_0_0_4px_rgba(64,120,255,0.12)]"
                        placeholder="000000"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value)}
                        autoComplete="one-time-code"
                        maxLength={6}
                        autoFocus
                      />
                    </label>
                  )}

                  {!mfaRequired && !mfaSetupRequired && (
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <label className="flex items-center gap-3 text-slate-300">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-400/30"
                        />
                        <span>Manter conectado</span>
                      </label>

                      <button type="button" className="text-slate-300 transition-colors hover:text-white">
                        Esqueceu sua senha?
                      </button>
                    </div>
                  )}

                  {error && <p className="text-sm text-red-300">{error}</p>}

                  <button
                    type="submit"
                    disabled={loading}
                    className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 px-4 py-3.5 text-base font-semibold text-white transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_18px_40px_rgba(77,99,255,0.35)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>{loading ? 'Aguarde...' : mfaSetupRequired ? 'Configurar MFA' : mfaRequired ? 'Verificar acesso' : 'Entrar no painel'}</span>
                    {!loading && !mfaRequired && !mfaSetupRequired && <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-0.5" />}
                  </button>
                </form>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
