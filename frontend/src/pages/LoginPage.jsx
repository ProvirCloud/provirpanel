import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api.js'
import LoginHero from '../components/auth/LoginHero'
import LoginCard from '../components/auth/LoginCard'
import LoginForm from '../components/auth/LoginForm'

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

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mfaSetupRequired) {
        if (!mfaSetup) {
          const response = await api.post('/auth/mfa/setup-login', { mfaSetupToken })
          setMfaSetup(response.data)
          setLoading(false)
          return
        }

        const response = await api.post('/auth/mfa/enable-login', { token: mfaCode, mfaSetupToken })
        if (response.data?.token) localStorage.setItem('provirpanel-token', response.data.token)
        window.dispatchEvent(new CustomEvent('provirpanel-auth', { detail: { authenticated: true } }))
        navigate('/')
        return
      }

      if (mfaRequired) {
        const response = await api.post('/auth/mfa/confirm', { token: mfaCode, mfaToken })
        if (response.data?.token) localStorage.setItem('provirpanel-token', response.data.token)
        window.dispatchEvent(new CustomEvent('provirpanel-auth', { detail: { authenticated: true } }))
        navigate('/')
        return
      }

      const response = await api.post('/auth/login', { username, password, rememberMe })
      if (response.data?.mfaSetupRequired) {
        setMfaSetupRequired(true)
        setMfaSetupToken(response.data.mfaSetupToken || '')
        setLoading(false)
        return
      }
      if (response.data?.mfaRequired) {
        setMfaRequired(true)
        setMfaToken(response.data.mfaToken || '')
        setLoading(false)
        return
      }
      if (response.data?.token) localStorage.setItem('provirpanel-token', response.data.token)
      window.dispatchEvent(new CustomEvent('provirpanel-auth', { detail: { authenticated: true } }))
      navigate('/')
    } catch {
      setError(
        mfaSetupRequired
          ? 'Não foi possível configurar o MFA.'
          : mfaRequired
            ? 'Código MFA inválido.'
            : 'Credenciais inválidas.'
      )
      setLoading(false)
    }
  }

  return (
    <div className="zeus-shell relative overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-[1560px] items-center px-4 py-6 sm:px-6 lg:px-10">
        <div className="grid w-full items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] xl:gap-12">
          <LoginHero />
          <LoginCard
            title={mfaSetupRequired ? 'Configurar MFA' : mfaRequired ? 'Verificação MFA' : 'Acesse o Zeus Cloud'}
            subtitle={mfaRequired ? 'Insira o código do autenticador para continuar.' : 'Acesso ao seu AI Cloud OS — controle total da sua infraestrutura, aplicações e dados.'}
          >
            <LoginForm
              username={username}
              password={password}
              showPassword={showPassword}
              rememberMe={rememberMe}
              loading={loading}
              error={error}
              mfaCode={mfaCode}
              mfaRequired={mfaRequired}
              mfaSetupRequired={mfaSetupRequired}
              mfaSetup={mfaSetup}
              onSubmit={handleSubmit}
              onUsernameChange={setUsername}
              onPasswordChange={setPassword}
              onTogglePassword={() => setShowPassword((value) => !value)}
              onRememberMeChange={setRememberMe}
              onMfaCodeChange={setMfaCode}
            />
          </LoginCard>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
