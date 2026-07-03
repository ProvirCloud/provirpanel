import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Brain, GitBranch, CheckCircle2, XCircle, Loader2, Zap,
  AlertTriangle, Beaker, GitMerge, FileCode, Lightbulb, ShieldAlert
} from 'lucide-react'
import { servicesApi } from '../services/serviceDetailsApi.js'

const PHASE_META = {
  diagnose: { icon: Brain, label: 'Diagnóstico', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  plan: { icon: Lightbulb, label: 'Plano', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  branch: { icon: GitBranch, label: 'Branch', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  fix: { icon: FileCode, label: 'Correção', color: 'text-orange-400', bg: 'bg-orange-500/10' },
  test: { icon: Beaker, label: 'Teste', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  merge: { icon: GitMerge, label: 'Merge', color: 'text-green-400', bg: 'bg-green-500/10' },
  discard: { icon: XCircle, label: 'Descarte', color: 'text-rose-400', bg: 'bg-rose-500/10' },
  result: { icon: CheckCircle2, label: 'Resultado', color: 'text-slate-400', bg: 'bg-slate-500/10' },
  error: { icon: AlertTriangle, label: 'Erro', color: 'text-rose-400', bg: 'bg-rose-500/10' }
}

const StepStatus = ({ step }) => {
  if (step.status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
  if (step.status === 'done') return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
  if (step.status === 'failed') return <XCircle className="h-3.5 w-3.5 text-rose-400" />
  if (step.status === 'skipped') return <AlertTriangle className="h-3.5 w-3.5 text-slate-500" />
  return <div className="h-3.5 w-3.5 rounded-full border border-slate-600" />
}

// Inline AI analysis shown inside a failed deploy log
export function DeployAiDiagnosis({ service, deployment }) {
  const [analysis, setAnalysis] = useState(null)
  const [fixJob, setFixJob] = useState(null)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  const pollingRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => () => {
    mountedRef.current = false
    if (pollingRef.current) clearInterval(pollingRef.current)
  }, [])

  const pollJob = useCallback((jobId) => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = setInterval(async () => {
      try {
        const { job } = await servicesApi.aiGetFixJob(service.id, jobId)
        if (!mountedRef.current) return
        setFixJob(job)
        if (job.status !== 'running') {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      } catch (err) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }, 1500)
  }, [service.id])

  const runAnalyze = async () => {
    setLoading('analyze')
    setError('')
    setAnalysis(null)
    try {
      const { analysis: result } = await servicesApi.aiAnalyze(service.id)
      if (mountedRef.current) setAnalysis(result)
    } catch (err) {
      if (mountedRef.current) setError(err.response?.data?.message || err.message)
    } finally {
      if (mountedRef.current) setLoading('')
    }
  }

  const runFix = async () => {
    setLoading('fix')
    setError('')
    setFixJob(null)
    try {
      const { jobId, job } = await servicesApi.aiStartFix(service.id, {
        error: deployment?.error || deployment?.deployLogError || '',
        logs: (deployment?.deployLog || []).map(l => typeof l === 'string' ? l : l?.message || '').join('\n').slice(-5000)
      })
      if (mountedRef.current) {
        setFixJob(job)
        pollJob(jobId)
      }
    } catch (err) {
      if (mountedRef.current) setError(err.response?.data?.message || err.message)
    } finally {
      if (mountedRef.current) setLoading('')
    }
  }

  const jobRunning = fixJob?.status === 'running'
  const jobSuccess = fixJob?.status === 'success'
  const jobFailed = fixJob?.status === 'failed' || fixJob?.status === 'error'

  return (
    <div className="mt-3 space-y-3 border-t border-purple-500/20 pt-3">
      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-purple-400" />
        <span className="text-xs font-semibold text-purple-200">Zeus AI</span>
        <div className="ml-auto flex gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-[11px] font-medium text-purple-200 transition hover:bg-purple-500/20 disabled:opacity-50"
            onClick={runAnalyze}
            disabled={!!loading || jobRunning}
          >
            {loading === 'analyze' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
            Diagnosticar
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-[11px] font-medium text-green-200 transition hover:bg-green-500/20 disabled:opacity-50"
            onClick={runFix}
            disabled={!!loading || jobRunning}
          >
            {loading === 'fix' || jobRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Corrigir Automaticamente
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-rose-500/20 bg-rose-950/30 px-2.5 py-1.5 text-[11px] text-rose-300">{error}</p>
      )}

      {/* Analysis result */}
      {analysis && !fixJob && (
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/80 p-3 space-y-2.5">
          {analysis.summary && (
            <p className="text-xs font-medium text-slate-200">{analysis.summary}</p>
          )}
          <p className="text-[11px] text-slate-400">{analysis.diagnosis}</p>

          {analysis.misconfigurations?.length > 0 && (
            <div className="space-y-1">
              <span className="flex items-center gap-1 text-[10px] uppercase text-rose-400">
                <ShieldAlert className="h-3 w-3" /> Problemas de configuração
              </span>
              {analysis.misconfigurations.map((m, i) => (
                <p key={i} className="text-[11px] text-rose-200 pl-4">• {m}</p>
              ))}
            </div>
          )}

          {analysis.risks?.length > 0 && (
            <div className="space-y-1">
              <span className="flex items-center gap-1 text-[10px] uppercase text-amber-400">
                <AlertTriangle className="h-3 w-3" /> Riscos
              </span>
              {analysis.risks.map((r, i) => (
                <p key={i} className="text-[11px] text-amber-200 pl-4">• {r}</p>
              ))}
            </div>
          )}

          {analysis.suggestions?.length > 0 && (
            <div className="space-y-1">
              <span className="flex items-center gap-1 text-[10px] uppercase text-blue-400">
                <Lightbulb className="h-3 w-3" /> Sugestões
              </span>
              {analysis.suggestions.map((s, i) => (
                <p key={i} className="text-[11px] text-blue-200 pl-4">• {s}</p>
              ))}
            </div>
          )}

          {analysis.confidence != null && (
            <div className="flex items-center gap-2 pt-1">
              <div className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-purple-500 transition-all"
                  style={{ width: `${Math.round(analysis.confidence * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-purple-300">{Math.round(analysis.confidence * 100)}% confiança</span>
            </div>
          )}
        </div>
      )}

      {/* Fix job timeline */}
      {fixJob && (
        <div className="rounded-lg border border-slate-700/50 bg-slate-950/90 p-3">
          {/* Header */}
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
            {jobRunning && <Loader2 className="h-4 w-4 animate-spin text-purple-400" />}
            {jobSuccess && <CheckCircle2 className="h-4 w-4 text-green-400" />}
            {jobFailed && <XCircle className="h-4 w-4 text-rose-400" />}
            <span className="text-xs font-medium text-slate-200">
              {jobRunning && 'Correção em andamento...'}
              {jobSuccess && 'Correção aplicada com sucesso!'}
              {jobFailed && 'Correção não resolveu o problema'}
              {fixJob.status === 'completed' && !jobSuccess && 'Análise concluída'}
            </span>
          </div>

          {/* Steps timeline */}
          <div className="space-y-0.5">
            {(fixJob.steps || []).map((step, i) => {
              const meta = PHASE_META[step.phase] || PHASE_META.error
              const PhaseIcon = meta.icon
              return (
                <div key={i} className="flex gap-2.5 py-1">
                  <div className="flex flex-col items-center pt-0.5">
                    <StepStatus step={step} />
                    {i < fixJob.steps.length - 1 && (
                      <div className="mt-1 w-px flex-1 bg-slate-800" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-2">
                    <div className="flex items-center gap-2">
                      <PhaseIcon className={`h-3 w-3 ${meta.color}`} />
                      <span className={`text-[10px] font-semibold uppercase ${meta.color}`}>{meta.label}</span>
                      <span className="text-[10px] text-slate-600 ml-auto">
                        {step.timestamp ? new Date(step.timestamp).toLocaleTimeString('pt-BR') : ''}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-300 break-words leading-relaxed">{step.message}</p>
                    {step.data?.actions && (
                      <div className="mt-1 space-y-0.5">
                        {step.data.actions.map((a, j) => (
                          <p key={j} className="text-[10px] text-slate-500 pl-2 border-l border-slate-700">
                            {a.type}: {a.description}
                          </p>
                        ))}
                      </div>
                    )}
                    {step.data?.applied && (
                      <div className="mt-1 space-y-0.5">
                        {step.data.applied.map((a, j) => (
                          <p key={j} className={`text-[10px] pl-2 border-l ${a.success ? 'border-green-700 text-green-400' : 'border-rose-700 text-rose-400'}`}>
                            {a.success ? '✓' : '✗'} {a.description}{a.error ? ` — ${a.error}` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Result messages */}
          {jobSuccess && (
            <div className="mt-2 rounded-md border border-green-500/20 bg-green-950/30 px-2.5 py-2 text-[11px] text-green-200">
              ✓ Código corrigido e testado. Faça um novo deploy para publicar a versão corrigida.
            </div>
          )}
          {jobFailed && fixJob.result?.testOutput && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-300">Ver output do teste</summary>
              <pre className="mt-1 max-h-24 overflow-auto rounded-md bg-black p-2 font-mono text-[10px] text-slate-500 leading-4">
                {fixJob.result.testOutput}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// Standalone panel for service overview (when no specific deploy is selected)
export default function AiFixPanel({ service, onReload }) {
  const deployments = Array.isArray(service.deployments) ? service.deployments : []
  const lastFailed = deployments.find((d) => d.status === 'failed')
  if (!lastFailed) return null

  return (
    <div className="rounded-xl border border-purple-500/15 bg-purple-950/5 p-3">
      <DeployAiDiagnosis service={service} deployment={lastFailed} />
    </div>
  )
}
