import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api.js'
import logoImg from '../assets/logo.png'

const LoginPage = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const response = await api.post('/auth/login', { username, password })
      localStorage.setItem('token', response.data.token)
      window.dispatchEvent(new Event('provirpanel-auth'))
      navigate('/')
    } catch (err) {
      setError('Credenciais invalidas')
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
          />
          <input
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400/60"
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <button className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
