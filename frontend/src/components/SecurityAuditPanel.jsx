import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck, ShieldAlert } from 'lucide-react'
import api from '../services/api.js'

const statusStyles = {
  PASS: 'text-emerald-200 bg-emerald-500/15 border-emerald-500/30',
  WARNING: 'text-amber-200 bg-amber-500/15 border-amber-500/30',
  FAIL: 'text-rose-200 bg-rose-500/15 border-rose-500/30',
  INFO: 'text-sky-200 bg-sky-500/15 border-sky-500/30'
}

const statusIcon = {
  PASS: CheckCircle2,
  WARNING: AlertTriangle,
  FAIL: XCircle,
  INFO: AlertTriangle
}

const formatDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('pt-BR')
}

const SecurityAuditPanel = () => {
  const [url, setUrl] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [plan, setPlan] = useState(null)
  const [applyResult, setApplyResult] = useState(null)
  const [reputationResult, setReputationResult] = useState(null)
  const [reputationLoading, setReputationLoading] = useState(false)
  const [cookieAuditEnabled, setCookieAuditEnabled] = useState(false)
  const [cookieUser, setCookieUser] = useState('')
  const [cookiePass, setCookiePass] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUrl(window.location.origin)
    }
  }, [])

  const recommendations = useMemo(() => {
    if (!result?.recommendations) return []
    return result.recommendations
  }, [result])

  const runAudit = async () => {
    if (!url) return
    if (cookieAuditEnabled && (!cookieUser || !cookiePass)) {
      setError('Informe usuario e senha para validar cookies.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const payload = { url }
      if (cookieAuditEnabled) {
        payload.auth = { username: cookieUser, password: cookiePass }
      }
      const response = await api.post('/security/audit', payload)
      setResult(response.data)
      setPlan(null)
    } catch (err) {
      const message = err.response?.data?.message || err.message
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const loadPlan = async () => {
    if (!url) return
    setPlanning(true)
    setError('')
    setApplyResult(null)
    try {
      const response = await api.post('/security/plan', { url })
      setPlan(response.data)
    } catch (err) {
      const message = err.response?.data?.message || err.message
      setError(message)
    } finally {
      setPlanning(false)
    }
  }

  const applyPlan = async () => {
    if (!url) return
    setApplying(true)
    setError('')
    setApplyResult(null)
    try {
      const response = await api.post('/security/apply', { url })
      setApplyResult(response.data)
      await runAudit()
    } catch (err) {
      const message = err.response?.data?.message || err.message
      const detail = err.response?.data?.detail
      setError(detail ? `${message} - ${detail}` : message)
    } finally {
      setApplying(false)
    }
  }

  const runReputation = async () => {
    if (!url) return
    setReputationLoading(true)
    setError('')
    setReputationResult(null)
    try {
      const response = await api.post('/security/reputation', { url })
      setReputationResult(response.data)
    } catch (err) {
      const message = err.response?.data?.message || err.message
      const detail = err.response?.data?.detail
      setError(detail ? `${message} - ${detail}` : message)
    } finally {
      setReputationLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Seguranca</p>
          <h2 className="text-2xl font-semibold text-white">Auditoria do ambiente</h2>
        </div>
        <button
          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950"
          onClick={runAudit}
          disabled={loading}
        >
          {loading ? 'Validando...' : 'Validar agora'}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex-1">
            <label className="text-xs text-slate-400">URL</label>
            <input
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://exbonus.provircloud.com.br"
            />
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-400">
            {result ? `Ultima execucao: ${formatDate(result.generatedAt)}` : 'Nenhuma auditoria executada'}
          </div>
        </div>
        {error && (
          <p className="mt-3 rounded-xl border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        )}
        {applyResult?.applied && (
          <p className="mt-3 rounded-xl border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
            Correcoes aplicadas. Backup: {applyResult.backupPath || 'nenhum'}
          </p>
        )}
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cookieAuditEnabled}
              onChange={(e) => setCookieAuditEnabled(e.target.checked)}
            />
            Validar cookies usando login
          </label>
          {cookieAuditEnabled && (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <input
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                placeholder="Usuario"
                value={cookieUser}
                onChange={(e) => setCookieUser(e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                type="password"
                placeholder="Senha"
                value={cookiePass}
                onChange={(e) => setCookiePass(e.target.value)}
              />
              <p className="md:col-span-2 text-[11px] text-slate-400">
                Usado apenas para checar os flags do cookie em /auth/login.
              </p>
            </div>
          )}
        </div>
      </div>

      {result && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Score Geral</p>
                {result.score >= 70 ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-300" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-amber-300" />
                )}
              </div>
              <p className="mt-4 text-3xl font-semibold text-white">{result.score}/100</p>
              <p className="mt-2 text-xs text-slate-400">{result.url}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Status</p>
              <p className="mt-4 text-sm text-slate-200">
                {recommendations.length === 0
                  ? 'Nenhuma recomendacao pendente.'
                  : `${recommendations.length} recomendacoes pendentes.`}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Priorize os itens em FAIL e WARNING.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Resumo</p>
              <p className="mt-4 text-sm text-slate-200">
                Headers criticos, TLS e cookies sao avaliados para reduzir riscos.
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Atualize o Nginx e reinicie os servicos apos ajustes.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-sm font-semibold text-slate-200">Checklist de seguranca</h3>
            <div className="mt-4 space-y-3">
              {result.checks?.map((check) => {
                const Icon = statusIcon[check.status] || AlertTriangle
                return (
                  <div
                    key={check.id}
                    className={`flex flex-col gap-2 rounded-xl border px-4 py-3 md:flex-row md:items-center md:justify-between ${statusStyles[check.status] || statusStyles.WARNING}`}
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-100">{check.title}</p>
                      <p className="text-xs text-slate-300">{check.detail}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-200">
                      <Icon className="h-4 w-4" />
                      {check.status}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-sm font-semibold text-slate-200">Recomendacoes</h3>
            <div className="mt-4 space-y-3">
              {recommendations.length === 0 && (
                <p className="text-xs text-slate-400">Nenhuma recomendacao pendente.</p>
              )}
              {recommendations.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-400">{item.title}</p>
                  <p className="mt-2 text-sm text-slate-200">{item.recommendation}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Correcoes automaticas</h3>
                <p className="text-xs text-slate-400">
                  Aplicacao segura com backup e teste do Nginx.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-xs text-slate-200"
                  onClick={loadPlan}
                  disabled={planning}
                >
                  {planning ? 'Gerando...' : 'Gerar correcoes'}
                </button>
                <button
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950"
                  onClick={applyPlan}
                  disabled={applying}
                >
                  {applying ? 'Aplicando...' : 'Aplicar no Nginx'}
                </button>
              </div>
            </div>
            {plan && (
              <div className="mt-4">
                <p className="text-xs text-slate-400">Arquivo: {plan.filePath}</p>
                <p className="text-xs text-slate-400">Nota: {plan.notes}</p>
                <textarea
                  className="mt-3 h-40 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                  value={plan.content || ''}
                  readOnly
                />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Reputacao do dominio</h3>
                <p className="text-xs text-slate-400">
                  Consulta servicos externos para detectar alertas de malware.
                </p>
              </div>
              <button
                className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-slate-950"
                onClick={runReputation}
                disabled={reputationLoading}
              >
                {reputationLoading ? 'Consultando...' : 'Checar reputacao'}
              </button>
            </div>
            {reputationResult && (
              <div className="mt-4">
                <p className="text-xs text-slate-400">Provider: {reputationResult.provider}</p>
                <textarea
                  className="mt-3 h-40 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                  value={JSON.stringify(reputationResult.result, null, 2)}
                  readOnly
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default SecurityAuditPanel
