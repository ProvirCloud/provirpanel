import { useEffect, useState } from 'react'
import { CheckCircle, ChevronDown, ChevronUp, Lock, RefreshCcw, ShieldCheck, X } from 'lucide-react'
import api from '../../services/api.js'
import type { NginxVisualState } from './nginxVisualConfig'
import { mutateHttps } from './nginxVisualConfig'

type CertbotStatus = {
  installed: boolean
  version?: string
  path?: string
  error?: string
}

type CertEntry = {
  domain: string
  certPath: string
  keyPath: string
  expiresAt?: string
}

type Props = {
  state: NginxVisualState
  onChange: (next: NginxVisualState) => void
}

const inputCls =
  'h-8 w-full rounded-[10px] border border-white/10 bg-[rgba(8,15,30,0.9)] px-3 text-[13px] text-white placeholder-white/25 outline-none transition focus:border-[#4d85ff]/60 focus:ring-1 focus:ring-[#4d85ff]/20'

const daysLeft = (expiresAt?: string) => {
  if (!expiresAt) return null
  return Math.floor((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default function CertbotPanel({ state, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<CertbotStatus | null>(null)
  const [certs, setCerts] = useState<CertEntry[]>([])
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [installLog, setInstallLog] = useState<string[]>([])
  const [domain, setDomain] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const checkStatus = async () => {
    setCheckingStatus(true)
    setError('')
    try {
      const res = await api.get('/nginx/ssl/status')
      setStatus(res.data)
    } catch {
      setStatus({ installed: false, error: 'Não foi possível verificar' })
    } finally {
      setCheckingStatus(false)
    }
  }

  const loadCerts = async () => {
    try {
      const res = await api.get('/nginx/ssl/certs')
      setCerts(res.data?.certs || [])
    } catch {
      // ignore — certs dir may not exist
    }
  }

  useEffect(() => {
    if (!open) return
    setDomain(state.domain.primary)
    checkStatus()
    loadCerts()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const installCertbot = async () => {
    setInstalling(true)
    setError('')
    setSuccess('')
    setInstallLog([])
    try {
      const res = await api.post('/nginx/ssl/install-certbot')
      const logs: string[] = (res.data?.logs || []).map(
        (l: { label: string; ok: boolean; error?: string }) =>
          `${l.ok ? '✓' : '✗'} ${l.label}${!l.ok && l.error ? ': ' + l.error : ''}`,
      )
      setInstallLog(logs)
      if (res.data?.success) {
        setStatus({ installed: true, version: res.data.version, path: res.data.path })
        setSuccess('Certbot instalado com sucesso.')
      } else {
        setError(res.data?.error || 'Falha na instalação do certbot.')
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setInstalling(false)
    }
  }

  const generateCert = async () => {
    if (!domain || !email) {
      setError('Domínio e e-mail são obrigatórios.')
      return
    }
    setGenerating(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.post('/nginx/ssl/install', { domain, email })
      if (res.data?.success) {
        const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`
        const keyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`
        onChange(mutateHttps(state, { certPath, keyPath, sslEnabled: true }))
        setSuccess('Certificado gerado! Caminhos preenchidos automaticamente.')
        await loadCerts()
      } else {
        setError(res.data?.error || 'Falha ao gerar certificado.')
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setGenerating(false)
    }
  }

  const useCert = (cert: CertEntry) => {
    onChange(mutateHttps(state, { certPath: cert.certPath, keyPath: cert.keyPath }))
    setSuccess(`Caminhos preenchidos para ${cert.domain}.`)
  }

  return (
    <div className="overflow-hidden rounded-[14px] border border-white/6 bg-white/2">
      {/* Toggle header */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/3"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-[#86efac]" />
          <span className="text-[12px] font-semibold text-white/70">Let&apos;s Encrypt / Certbot</span>
        </div>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-white/32" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-white/32" />
        )}
      </button>

      {open && (
        <div className="space-y-4 border-t border-white/6 px-4 py-4">
          {/* Certbot status row */}
          <div className="flex items-center justify-between">
            <div>
              {checkingStatus && (
                <p className="text-[12px] text-white/38">Verificando certbot...</p>
              )}
              {!checkingStatus && status?.installed && (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-[#86efac]" />
                  <span className="text-[12px] text-[#86efac]">Certbot instalado</span>
                  {status.version && (
                    <span className="font-mono text-[11px] text-white/30">{status.version}</span>
                  )}
                </div>
              )}
              {!checkingStatus && status && !status.installed && (
                <span className="text-[12px] text-[#fcd34d]">Certbot não instalado</span>
              )}
            </div>
            <button
              type="button"
              onClick={checkStatus}
              disabled={checkingStatus}
              title="Verificar status"
              className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-white/8 text-white/38 transition hover:bg-white/6 hover:text-white/70 disabled:opacity-40"
            >
              <RefreshCcw className={['h-3 w-3', checkingStatus ? 'animate-spin' : ''].join(' ')} />
            </button>
          </div>

          {/* Install certbot */}
          {status && !status.installed && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={installCertbot}
                disabled={installing}
                className="w-full rounded-[10px] border border-[#2d4f8f]/80 bg-[linear-gradient(135deg,#1a3a72,#142d58)] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_4px_16px_rgba(30,80,200,0.18)] transition hover:brightness-110 disabled:opacity-50"
              >
                {installing ? 'Instalando...' : 'Instalar Certbot automaticamente'}
              </button>
              {installLog.length > 0 && (
                <div className="max-h-32 overflow-auto rounded-[8px] border border-white/5 bg-black/30 px-3 py-2 space-y-0.5">
                  {installLog.map((line, i) => (
                    <p key={i} className="font-mono text-[10px] text-white/45 leading-relaxed">
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Generate certificate form */}
          {status?.installed && (
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <label className="text-[11px] text-white/45">Domínio</label>
                <input
                  className={inputCls}
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="example.com"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-white/45">E-mail (Let&apos;s Encrypt)</label>
                <input
                  className={inputCls}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                />
              </div>
              <button
                type="button"
                onClick={generateCert}
                disabled={generating || !domain || !email}
                className="w-full rounded-[10px] border border-[#2d4f8f]/80 bg-[linear-gradient(135deg,#1a3a72,#142d58)] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_4px_16px_rgba(30,80,200,0.18)] transition hover:brightness-110 disabled:opacity-50"
              >
                {generating ? 'Gerando certificado...' : 'Gerar certificado'}
              </button>
            </div>
          )}

          {/* Feedback messages */}
          {error && (
            <div className="flex items-start gap-2 rounded-[10px] border border-[#7f1d3a]/50 bg-[#3d0e1c]/50 px-3 py-2.5">
              <X className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#f87171]" />
              <p className="text-[12px] text-[#f87171]">{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 rounded-[10px] border border-[#1b5c38]/60 bg-[#0d2e1c]/60 px-3 py-2.5">
              <CheckCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#86efac]" />
              <p className="text-[12px] text-[#86efac]">{success}</p>
            </div>
          )}

          {/* Installed certs list */}
          {certs.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30">
                Certificados instalados
              </p>
              {certs.map((cert) => {
                const days = daysLeft(cert.expiresAt)
                const expired = days !== null && days <= 0
                const expiring = days !== null && days > 0 && days <= 30
                return (
                  <div
                    key={cert.domain}
                    className="overflow-hidden rounded-[10px] border border-white/6 bg-black/20"
                  >
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <div>
                        <p className="text-[12px] font-medium text-white/80">{cert.domain}</p>
                        {days !== null && (
                          <p
                            className={[
                              'text-[11px]',
                              expired
                                ? 'text-[#f87171]'
                                : expiring
                                  ? 'text-[#fcd34d]'
                                  : 'text-[#86efac]',
                            ].join(' ')}
                          >
                            {expired
                              ? 'Expirado'
                              : expiring
                                ? `Expira em ${days}d`
                                : `Válido (${days}d)`}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => useCert(cert)}
                        title="Usar estes caminhos de certificado"
                        className="flex items-center gap-1 rounded-[7px] border border-[#2d4f8f]/60 bg-[rgba(26,58,114,0.35)] px-2 py-1 text-[11px] font-medium text-[#7ab0ff] transition hover:brightness-110"
                      >
                        <Lock className="h-3 w-3" />
                        Usar
                      </button>
                    </div>
                    <div className="truncate border-t border-white/5 px-3 py-1.5 font-mono text-[10px] text-white/30">
                      {cert.certPath}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
