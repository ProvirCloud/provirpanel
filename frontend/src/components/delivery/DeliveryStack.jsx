import { Package, Brain, Save, Loader2 } from 'lucide-react'

const smallButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function DeliveryStack({
  service, analysis, selectedBlueprint, selectedBlueprintId, setSelectedBlueprintId,
  loadingAction, saveDelivery, generateSmartBlueprint
}) {
  const blueprints = analysis?.blueprints || (service.delivery?.blueprint ? [service.delivery.blueprint] : [])

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Package className="h-4 w-4 text-cyan-400" /> Stack Detectada
      </h3>

      {service.delivery ? (
        <p className="text-xs text-slate-400">
          Vinculado: <span className="text-slate-200">{service.delivery.repository}</span> / {service.delivery.branch} / {service.delivery.projectPath || '.'}
        </p>
      ) : null}

      {blueprints.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {blueprints.map(bp => (
            <button
              key={bp.id}
              type="button"
              className={`rounded-xl border p-3 text-left transition ${
                selectedBlueprint?.id === bp.id
                  ? 'border-blue-500/50 bg-blue-500/10'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
              }`}
              onClick={() => setSelectedBlueprintId(bp.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-white text-sm">{bp.label}</p>
                <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">{bp.confidence}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{bp.projectPath || '.'} · {bp.buildType} / {bp.imageName}</p>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Analise o repositório para detectar a stack.</p>
      )}

      {selectedBlueprint ? (
        <div className="grid gap-2 sm:grid-cols-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-300">
          <div><span className="text-slate-500">Build:</span> {selectedBlueprint.buildCommand || selectedBlueprint.buildType}</div>
          <div><span className="text-slate-500">Artefato:</span> {selectedBlueprint.artifactPath || '.'}</div>
          <div><span className="text-slate-500">Porta:</span> {selectedBlueprint.containerPort}</div>
          <div><span className="text-slate-500">Health:</span> {selectedBlueprint.healthcheck?.target || '-'}</div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button className={smallButtonClass} type="button" onClick={generateSmartBlueprint} disabled={loadingAction === 'smart-blueprint'}>
          {loadingAction === 'smart-blueprint' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          Blueprint Inteligente
        </button>
        <button className={primaryButtonClass} type="button" onClick={saveDelivery} disabled={!selectedBlueprint || loadingAction === 'save'}>
          {loadingAction === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar vínculo
        </button>
      </div>
    </div>
  )
}
