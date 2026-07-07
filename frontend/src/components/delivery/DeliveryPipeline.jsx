import { Play, Copy, UploadCloud, ShieldCheck, Loader2, ExternalLink } from 'lucide-react'

const smallButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function DeliveryPipeline({
  service, workflow, setWorkflow, workflowRun, selectedBlueprint, selectedRepo, selectedBranch,
  connectionId, loadingAction, setLoadingAction, setMessage,
  generateWorkflow, dispatchWorkflow, validateAndFix,
  githubDeliveryApi, onReload, WorkflowRunPanel
}) {
  const hasWorkflow = !!(service.delivery?.workflowPath || workflow?.path)

  const saveWorkflowEdit = async () => {
    setLoadingAction('save-workflow-edit')
    try {
      const delivery = service.delivery || {}
      const [owner, repo] = (selectedRepo || delivery.repository || '').split('/')
      if (!owner || !repo) { setMessage('Repositório não configurado'); return }
      await githubDeliveryApi.saveWorkflowContent(service.id, {
        content: workflow.content,
        connectionId: connectionId || delivery.connectionId,
        repository: selectedRepo || delivery.repository,
        branch: selectedBranch || delivery.branch || 'main'
      })
      setMessage('✅ Workflow salvo no GitHub.')
      await onReload()
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Falha ao salvar')
    } finally {
      setLoadingAction('')
    }
  }

  const copySecret = async (key) => {
    let val = ''
    if (key === 'PROVIRPANEL_URL') {
      val = window.location.origin
    } else {
      try { val = await githubDeliveryApi.getDeployToken() } catch { val = '' }
    }
    if (!val) { setMessage(`⚠️ ${key} está vazio.`); return }
    const ta = document.createElement('textarea')
    ta.value = val; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    setMessage(`✅ Copiado: ${key}`)
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Play className="h-4 w-4 text-green-400" /> Pipeline
      </h3>

      <div className="flex flex-wrap gap-2">
        <button className={smallButtonClass} type="button" onClick={() => generateWorkflow(false)} disabled={!selectedBlueprint || loadingAction === 'workflow'}>
          {loadingAction === 'workflow' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          Gerar pipeline
        </button>
        <button className={primaryButtonClass} type="button" onClick={() => generateWorkflow(true)} disabled={!selectedBlueprint || !selectedRepo || loadingAction === 'save-workflow'}>
          {loadingAction === 'save-workflow' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          Salvar no GitHub
        </button>
        <button className={smallButtonClass} type="button" onClick={validateAndFix} disabled={loadingAction === 'validate'}>
          {loadingAction === 'validate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Validar
        </button>
        <button className={primaryButtonClass} type="button" onClick={dispatchWorkflow} disabled={!hasWorkflow || loadingAction === 'dispatch'}>
          {loadingAction === 'dispatch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Publicar
        </button>
      </div>

      {workflowRun ? <WorkflowRunPanel run={workflowRun} /> : null}

      {workflow?.content ? (
        <details className="group">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">Ver/editar YAML do workflow</summary>
          <div className="mt-2 space-y-2">
            <textarea
              className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-[11px] text-slate-300 font-mono resize-y min-h-[180px] max-h-[400px]"
              rows={14}
              value={workflow.content}
              onChange={e => setWorkflow({ ...workflow, content: e.target.value })}
            />
            <button className={smallButtonClass} type="button" onClick={saveWorkflowEdit} disabled={loadingAction === 'save-workflow-edit'}>
              {loadingAction === 'save-workflow-edit' ? 'Salvando...' : '💾 Salvar no GitHub'}
            </button>
          </div>
        </details>
      ) : null}

      {(service.delivery?.workflowUpdatedAt || service.delivery?.lastWorkflowDispatchAt) ? (
        <div className="text-xs text-slate-500 space-y-0.5">
          {service.delivery.workflowUpdatedAt && <p>Workflow atualizado: {new Date(service.delivery.workflowUpdatedAt).toLocaleString()}</p>}
          {service.delivery.lastWorkflowDispatchAt && <p>Último dispatch: {new Date(service.delivery.lastWorkflowDispatchAt).toLocaleString()}</p>}
          {service.delivery.workflowHtmlUrl && <a href={service.delivery.workflowHtmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300"><ExternalLink className="h-3 w-3" /> Ver no GitHub</a>}
        </div>
      ) : null}

      {service.delivery?.repository ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
          <p className="text-xs font-medium text-amber-200">GitHub Secrets necessários</p>
          <div className="flex flex-wrap gap-2">
            {['PROVIRPANEL_URL', 'PROVIRPANEL_TOKEN'].map(key => (
              <button key={key} onClick={() => copySecret(key)} className="rounded bg-slate-900 px-2 py-1 text-[11px] text-slate-300 font-mono hover:bg-slate-800 transition">
                {key} <span className="text-blue-400 ml-1">copiar</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500">Repo → Settings → Secrets → Actions</p>
        </div>
      ) : null}
    </div>
  )
}
