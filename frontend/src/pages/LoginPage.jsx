import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, ShieldCheck } from 'lucide-react'
import api from '../services/api.js'
import logoImg from '../assets/logo.png'

const LoginPage = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaToken, setMfaToken] = useState('')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaSetupToken, setMfaSetupToken] = useState('')
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false)
  const [mfaSetup, setMfaSetup] = useState(null)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      if (mfaSetupRequired) {
        if (!mfaSetup) {
          const setupResponse = await api.post('/auth/mfa/setup-login', { mfaSetupToken })
          setMfaSetup(setupResponse.data)
          return
        }
        const enableResponse = await api.post('/auth/mfa/enable-login', {
          token: mfaCode,
          mfaSetupToken
        })
        if (enableResponse.data?.token) {
          localStorage.setItem('provirpanel-token', enableResponse.data.token)
        }
        window.dispatchEvent(new CustomEvent('provirpanel-auth', {
          detail: { authenticated: true }
        }))
        navigate('/')
        return
      }

      if (mfaRequired) {
        const response = await api.post('/auth/mfa/confirm', {
          token: mfaCode,
          mfaToken
        })
        if (response.data?.token) {
          localStorage.setItem('provirpanel-token', response.data.token)
        }
        window.dispatchEvent(new CustomEvent('provirpanel-auth', {
          detail: { authenticated: true }
        }))
        navigate('/')
        return
      }

      const response = await api.post('/auth/login', { username, password })
      if (response.data?.mfaSetupRequired) {
        setMfaSetupRequired(true)
        setMfaSetupToken(response.data.mfaSetupToken || '')
        return
      }
      if (response.data?.mfaRequired) {
        setMfaRequired(true)
        setMfaToken(response.data.mfaToken || '')
        return
      }
      if (response.data?.token) {
        localStorage.setItem('provirpanel-token', response.data.token)
      }
      window.dispatchEvent(new CustomEvent('provirpanel-auth', {
        detail: { authenticated: true }
      }))
      navigate('/')
    } catch (err) {
      if (mfaSetupRequired) {
        setError('Nao foi possivel configurar o MFA')
      } else {
        setError(mfaRequired ? 'Codigo MFA invalido' : 'Credenciais invalidas')
      }
    }
  }

  return (
    <div className="zeus-shell relative overflow-hidden px-6 py-10">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-7xl items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="relative overflow-hidden rounded-[2.5rem] border border-blue-200/60 bg-[linear-gradient(135deg,_rgba(255,255,255,0.92),_rgba(226,238,255,0.8))] p-8 shadow-[0_24px_90px_rgba(22,54,111,0.12)] lg:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(125,211,252,0.16),_transparent_40%)]" />
          <div className="relative">
            <p className="zeus-kicker text-xs font-semibold uppercase">ZeusEngine | Hybrid AI Development Platform</p>
            <h1 className="zeus-title mt-5 max-w-4xl text-4xl font-bold leading-tight lg:text-6xl">
              Plataforma hibrida de IA para o desenvolvimento de softwares e negocios.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Painel operacional com identidade ZeusEngine para deploy, Docker, rotas, arquivos
              e governanca de infraestrutura.
            </p>

            <div className="mt-10 rounded-[2rem] border border-white/70 bg-white/60 p-6 shadow-inner shadow-sky-100/70">
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div className="flex items-center gap-5">
                  <div className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-blue-200 bg-white shadow-lg shadow-blue-500/10">
                    <img src={logoImg} alt="Zeus Engine" className="h-12 w-12 object-contain" />
                  </div>
                  <div>
                    <p className="text-4xl font-black tracking-[0.1em] text-[#16366f]">ZEUS ENGINE</p>
                    <p className="mt-2 text-xl font-medium text-slate-500">peerless technology</p>
                  </div>
                </div>
                <div className="rounded-[1.5rem] border border-sky-200 bg-[linear-gradient(135deg,_rgba(125,211,252,0.2),_rgba(255,255,255,0.8))] p-4">
                  <Zap className="h-10 w-10 text-blue-700" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="zeus-panel relative rounded-[2.25rem] p-8 lg:p-10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,_#16366f,_#3b82f6)] text-white shadow-lg shadow-blue-500/20">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="zeus-kicker text-[10px] font-semibold uppercase">Acesso seguro</p>
              <h2 className="mt-1 text-2xl font-bold text-slate-900">Entrar no painel</h2>
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-600">
            Autenticacao unificada para operacao, observabilidade e administracao da plataforma.
          </p>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <input
              className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-blue-400"
              placeholder="Usuario"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              disabled={mfaRequired || mfaSetupRequired}
            />
            <input
              className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-blue-400"
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={mfaRequired || mfaSetupRequired}
            />

            {mfaSetupRequired && (
              <>
                {!mfaSetup ? (
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-xs text-slate-700">
                    MFA obrigatorio. Continue para gerar o QR Code.
                  </div>
                ) : (
                  <>
                    {mfaSetup.qr && (
                      <img src={mfaSetup.qr} alt="QR Code MFA" className="mx-auto h-36 w-36 rounded-2xl bg-white p-2" />
                    )}
                    <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 text-xs text-slate-700">
                      Codigo manual: <span className="mono text-blue-700">{mfaSetup.secret}</span>
                    </div>
                  </>
                )}
              </>
            )}

            {(mfaRequired || mfaSetupRequired) && (
              <input
                className="w-full rounded-2xl border border-blue-100 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-blue-400"
                placeholder="Codigo MFA (6 digitos)"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                autoComplete="one-time-code"
              />
            )}

            {error && <p className="text-xs text-rose-600">{error}</p>}

            <button className="w-full rounded-2xl bg-[linear-gradient(135deg,_#16366f,_#2563eb)] py-3.5 text-sm font-semibold tracking-[0.08em] text-white transition hover:brightness-110">
              {mfaSetupRequired ? 'CONFIGURAR MFA' : mfaRequired ? 'VALIDAR MFA' : 'ENTRAR'}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}

export default LoginPage
