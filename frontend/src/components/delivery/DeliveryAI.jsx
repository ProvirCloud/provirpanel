import { useState } from 'react'
import { Sparkles, Brain, GitBranch, Loader2, Send, X } from 'lucide-react'

const fieldClass = 'rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
const smallButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function DeliveryAI({
  service, loadingAction, setLoadingAction, setMessage,
  aiIndexed, updateAiContext,
  showGitIndex, setShowGitIndex, gitIndexForm, setGitIndexForm, gitIndexStatus, gitIndexResult, submitGitIndex,
  projectAnalysis, setProjectAnalysis, runProjectAnalysis,
  // for apply actions
  workflow, setWorkflow, selectedRepo, selectedBranch, connectionId,
  githubDeliveryApi, onReload
}) {
  const [showDiag, setShowDiag] = useState(!!projectAnalysis)

  const applyActions = async () => {
    setLoadingAction('apply-actions')
    try {
      const autoActions = projectAnalysis.actions.filter(a => a.autoApply)
      const workflowActions = autoActions.filter(a => a.type === 'update_workflow' || a.type === 'fix_workflow')
      const otherActions = autoActions.filter(a => a.type !== 'update_workflow' && a.type !== 'fix_workflow')
      for (const action of otherActions) {
        if (action.type === 'update_env' && action.config?.key) {
          await githubDeliveryApi.aiApplyFixes(service.id, [{ type: 'env', field: action.config.key, newValue: action.config.value, reason: action.title }])
        } else if (action.type === 'update_command' && action.config?.command) {
          await githubDeliveryApi.aiApplyFixes(service.id, [{ type: 'command', newValue: action.config.command, reason: action.title }])
        } else if (action.type === 'update_healthcheck' && action.config) {
          await githubDeliveryApi.aiApplyFixes(service.id, [{ type: 'healthcheck', newValue: JSON.stringify({ enabled: true, target: action.config.target || '/', intervalSeconds: action.config.intervalSeconds || 10, timeoutSeconds: 5, retries: 6, startPeriodSeconds: 5 }), reason: action.title }])
        }
      }
      if (otherActions.length) await onReload()
      if (workflowActions.length) {
        const wfAction = workflowActions[0]
        if (wfAction.type === 'fix_workflow' && wfAction.config?.workflowContent) {
          setWorkflow({ content: wfAction.config.workflowContent })
          setMessage(`✅ ${otherActions.length} ação(ões) aplicada(s). Workflow gerado — revise e salve no GitHub.`)
        } else if (wfAction.type === 'update_workflow' && wfAction.config) {
          await githubDeliveryApi.aiApplyFixes(service.id, [{ type: 'update_workflow', config: wfAction.config, reason: wfAction.title }])
          await onReload()
          const result = await githubDeliveryApi.generateWorkflow(service.id, { connectionId, repository: selectedRepo || service.delivery?.repository, branch: selectedBranch || service.delivery?.branch })
          setWorkflow(result.workflow)
          setMessage(`✅ ${otherActions.length} ação(ões) aplicada(s). Workflow gerado — revise e salve no GitHub.`)
        }
      } else {
        setMessage(`✅ ${otherActions.length} ação(ões) aplicada(s).`)
      }
    } catch (err) {
      setMessage(err.message || 'Erro ao aplicar ações')
    } finally {
      setLoadingAction('')
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-purple-200">
        <Sparkles className="h-4 w-4" /> Zeus AI Assistant
      </h3>

      <div className="flex flex-wrap gap-2">
        <button className={smallButtonClass} type="button" onClick={updateAiContext} disabled={loadingAction === 'ai-context'}>
          {loadingAction === 'ai-context' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Atualizar conhecimento da IA
        </button>
        <button className={smallButtonClass} type="button" onClick={() => setShowGitIndex(v => !v)}>
          <GitBranch className="h-4 w-4" />
          Indexar via Git
        </button>
        <button className={smallButtonClass} type="button" onClick={() => { runProjectAnalysis(); setShowDiag(true) }} disabled={loadingAction === 'project-analysis'}>
          {loadingAction === 'project-analysis' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          Diagnóstico AI
        </button>
      </div>

      {aiIndexed && (
        <div className="flex items-center gap-2 rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-2">
          <Sparkles className="h-3 w-3 text-purple-400" />
          <span className="text-xs text-purple-200">IA aprendeu: {aiIndexed.fileCount} arquivos, {aiIndexed.chunks} chunks</span>
        </div>
      )}

      {showGitIndex && (
        <div className="space-y-3 rounded-lg border border-purple-500/20 bg-slate-900/60 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={`${fieldClass} w-full text-xs`} placeholder="Org" value={gitIndexForm.org} onChange={e => setGitIndexForm(f => ({ ...f, org: e.target.value }))} />
            <input className={`${fieldClass} w-full text-xs`} placeholder="Repo" value={gitIndexForm.repo} onChange={e => setGitIndexForm(f => ({ ...f, repo: e.target.value }))} />
            <input className={`${fieldClass} w-full text-xs`} placeholder="Branch (main)" value={gitIndexForm.branch} onChange={e => setGitIndexForm(f => ({ ...f, branch: e.target.value }))} />
            <input className={`${fieldClass} w-full text-xs`} placeholder="Collection (auto)" value={gitIndexForm.collection} onChange={e => setGitIndexForm(f => ({ ...f, collection: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2">
            <button className={primaryButtonClass} type="button" onClick={submitGitIndex} disabled={gitIndexStatus === 'indexing' || !gitIndexForm.org || !gitIndexForm.repo}>
              {gitIndexStatus === 'indexing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {gitIndexStatus === 'indexing' ? 'Indexando...' : 'Indexar'}
            </button>
            <button className={smallButtonClass} type="button" onClick={() => setShowGitIndex(false)}>Fechar</button>
          </div>
          {gitIndexStatus === 'indexing' && gitIndexResult?.progress && <p className="text-xs text-purple-300 animate-pulse">{gitIndexResult.progress}</p>}
          {gitIndexStatus === 'done' && gitIndexResult && <p className="text-xs text-green-300">✅ {gitIndexResult.files} arquivos, {gitIndexResult.chunks} chunks {gitIndexResult.note ? `(${gitIndexResult.note})` : ''}</p>}
          {gitIndexStatus === 'error' && gitIndexResult && <p className="text-xs text-red-400">❌ {gitIndexResult.error}</p>}
        </div>
      )}

      {projectAnalysis && showDiag ? (
        <div className="space-y-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-indigo-400" />
              <span className="text-xs font-semibold text-indigo-200">Diagnóstico</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${projectAnalysis.canRun ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                {projectAnalysis.canRun ? '✅ Pronto' : '❌ Ações necessárias'}
              </span>
            </div>
            <button onClick={() => { setProjectAnalysis(null); setShowDiag(false) }} className="text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></button>
          </div>
          <p className="text-xs text-slate-300">{projectAnalysis.summary}</p>

          {projectAnalysis.actions?.length ? (
            <div className="space-y-2">
              {projectAnalysis.actions.sort((a, b) => (a.priority || 99) - (b.priority || 99)).map((action, i) => (
                <div key={i} className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-5 w-5 flex items-center justify-center rounded text-[10px] font-bold ${
                      action.type === 'create_service' ? 'bg-blue-500/20 text-blue-300' :
                      action.type === 'update_env' ? 'bg-amber-500/20 text-amber-300' :
                      action.type === 'update_command' ? 'bg-purple-500/20 text-purple-300' :
                      'bg-slate-600/30 text-slate-400'
                    }`}>{action.priority || i + 1}</span>
                    <span className="text-xs text-slate-200">{action.title}</span>
                    {action.autoApply && <span className="text-[10px] text-green-400">⚡ auto</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 pl-7">{action.description}</p>
                </div>
              ))}
              <button
                className="w-full rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
                onClick={applyActions}
                disabled={loadingAction === 'apply-actions' || !projectAnalysis.actions.some(a => a.autoApply)}
              >
                {loadingAction === 'apply-actions' ? 'Aplicando...' : `⚡ Aplicar ${projectAnalysis.actions.filter(a => a.autoApply).length} ação(ões)`}
              </button>
            </div>
          ) : null}

          <form className="flex gap-2" onSubmit={async (e) => {
            e.preventDefault()
            const text = e.target.elements.aiInstruction.value.trim()
            if (!text) return
            setLoadingAction('project-analysis')
            setProjectAnalysis(null)
            try {
              const { analysis } = await githubDeliveryApi.aiProjectAnalysis(service.id, text)
              setProjectAnalysis(analysis)
            } catch (err) {
              setMessage(err.response?.data?.message || err.message || 'Falha')
            } finally {
              setLoadingAction('')
            }
          }}>
            <input name="aiInstruction" className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500" placeholder="Pedir modificação à AI..." />
            <button type="submit" disabled={loadingAction === 'project-analysis'} className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50">
              {loadingAction === 'project-analysis' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
