import { useState } from 'react'
import { ShieldCheck, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react'

const fieldClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500/60 disabled:opacity-50 disabled:cursor-not-allowed'

const Field = ({ label, hint, children }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-slate-400">{label}</label>
    {children}
    {hint ? <span className="text-[11px] text-slate-600">{hint}</span> : null}
  </div>
)

const SettingsHealthcheck = ({ service, settingsState, setSettingsState }) => {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const hc = settingsState.healthcheck || {}
  const enabled = hc.enabled || false

  const setHc = (patch) => {
    setSettingsState((prev) => ({
      ...prev,
      healthcheck: { ...(prev.healthcheck || {}), ...patch }
    }))
  }

  const testHealthcheck = async () => {
    setTesting(true)
    setTestResult(null)
    const start = Date.now()
    try {
      const port = settingsState.hostPort || service.hostPort
      const target = hc.target || '/'
      const url = `/api/docker/services/${service.id}/proxy${target.startsWith('/') ? target : `/${target}`}`
      const res = await fetch(url)
      const elapsed = Date.now() - start
      setTestResult({ ok: res.ok, status: res.status, time: elapsed })
    } catch (err) {
      setTestResult({ ok: false, status: 0, time: Date.now() - start, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-blue-300" />
        <h2 className="text-sm font-semibold text-white">Healthcheck</h2>
      </div>
      <p className="mb-4 text-xs text-slate-500">Verifica se a aplicação está respondendo após o deploy.</p>

      {/* Main toggle */}
      <label className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 cursor-pointer hover:border-slate-700 transition mb-4">
        <input type="checkbox" className="accent-blue-500 mt-0.5" checked={enabled} onChange={(e) => setHc({ enabled: e.target.checked })} />
        <div>
          <span className="text-sm font-medium text-slate-200">Verificar saúde após deploy</span>
          <p className="text-[11px] text-slate-500 mt-0.5">O Zeus faz requisições HTTP no endpoint configurado para confirmar que a aplicação está online antes de finalizar o deploy.</p>
        </div>
      </label>

      {!enabled ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-200/80">A aplicação não será validada após o deploy. O container será considerado pronto assim que iniciar.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Endpoint de verificação" hint="Path HTTP que retorna 200 quando a aplicação está saudável.">
              <input className={fieldClass} value={hc.target || '/'} onChange={(e) => setHc({ target: e.target.value })} placeholder="/health ou /api/status" />
            </Field>
            <Field label="Tempo inicial de espera" hint="Segundos para aguardar antes da primeira verificação (tempo de boot).">
              <input className={fieldClass} type="number" value={hc.startPeriodSeconds || 5} onChange={(e) => setHc({ startPeriodSeconds: Number(e.target.value) })} />
            </Field>
            <Field label="Intervalo entre tentativas" hint="Segundos entre cada requisição de verificação.">
              <input className={fieldClass} type="number" value={hc.intervalSeconds || 10} onChange={(e) => setHc({ intervalSeconds: Number(e.target.value) })} />
            </Field>
            <Field label="Tempo limite por tentativa" hint="Se a resposta demorar mais que isso, conta como falha.">
              <input className={fieldClass} type="number" value={hc.timeoutSeconds || 5} onChange={(e) => setHc({ timeoutSeconds: Number(e.target.value) })} />
            </Field>
            <Field label="Número máximo de tentativas" hint="Após esse número de falhas consecutivas, o deploy é considerado falho.">
              <input className={fieldClass} type="number" value={hc.retries || 6} onChange={(e) => setHc({ retries: Number(e.target.value) })} />
            </Field>
          </div>

          {/* Container healthcheck toggle */}
          <label className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 cursor-pointer hover:border-slate-700 transition">
            <input type="checkbox" className="accent-blue-500 mt-0.5" checked={hc.containerEnabled || false} onChange={(e) => setHc({ containerEnabled: e.target.checked })} />
            <div>
              <span className="text-sm font-medium text-slate-200">Monitoramento contínuo (Docker)</span>
              <p className="text-[11px] text-slate-500 mt-0.5">Adiciona um HEALTHCHECK permanente no container. O Docker monitora continuamente e marca como indisponível se o endpoint parar de responder.</p>
            </div>
          </label>

          {/* Test button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-200 transition hover:bg-blue-500/20 disabled:opacity-50"
              onClick={testHealthcheck}
              disabled={testing}
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Testar agora
            </button>
            {testResult ? (
              <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${testResult.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200' : 'border-rose-500/30 bg-rose-500/5 text-rose-200'}`}>
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                HTTP {testResult.status} — {testResult.time}ms
                {testResult.error ? ` (${testResult.error})` : ''}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

export default SettingsHealthcheck
