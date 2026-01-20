import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
        localStorage.setItem('token', enableResponse.data.token)
        window.dispatchEvent(new Event('provirpanel-auth'))
        navigate('/')
        return
      }

      if (mfaRequired) {
        const response = await api.post('/auth/mfa/confirm', {
          token: mfaCode,
          mfaToken
        })
        localStorage.setItem('token', response.data.token)
        window.dispatchEvent(new Event('provirpanel-auth'))
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
      localStorage.setItem('token', response.data.token)
      window.dispatchEvent(new Event('provirpanel-auth'))
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.15),_transparent_55%)] px-6 py-16">
      <div className="mx-auto max-w-lg rounded-3xl border border-slate-800 bg-slate-900/70 p-10 shadow-2xl shadow-emerald-500/10">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-blue-500/20 border border-emerald-400/30">
            <img src={logoImg} alt="Provir" className="h-8 w-8" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-200/70 font-medium">Provir Cloud Panel</p>
            <p className="text-xs text-slate-400 mt-1">Infraestrutura em suas mãos</p>
          </div>
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">Acesso seguro</h1>
        <p className="mt-2 text-sm text-slate-400">
          Centralize o controle da infraestrutura e monitore tudo em tempo real.
        </p>
        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <input
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400/60"
            placeholder="Usuario"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={mfaRequired || mfaSetupRequired}
          />
          <input
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400/60"
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={mfaRequired || mfaSetupRequired}
          />
          {mfaSetupRequired && (
            <>
              {!mfaSetup ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs text-slate-300">
                  MFA obrigatorio. Clique em continuar para gerar o QR Code.
                </div>
              ) : (
                <>
                  {mfaSetup.qr && (
                    <img src={mfaSetup.qr} alt="QR Code MFA" className="mx-auto h-36 w-36 rounded-xl bg-white p-2" />
                  )}
                  <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs text-slate-200">
                    Codigo manual: <span className="font-mono text-emerald-300">{mfaSetup.secret}</span>
                  </div>
                </>
              )}
            </>
          )}
          {(mfaRequired || mfaSetupRequired) && (
            <input
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400/60"
              placeholder="Codigo MFA (6 digitos)"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
            />
          )}
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <button className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
            {mfaSetupRequired ? 'Configurar MFA' : mfaRequired ? 'Validar MFA' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
