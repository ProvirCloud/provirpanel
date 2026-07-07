import { HardDrive, Plus, Trash2 } from 'lucide-react'

const fieldClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500/60'

const SettingsStorage = ({ settingsState, setSettingsState }) => {
  const volumes = settingsState.volumes || []

  const updateVolume = (idx, key, value) => {
    setSettingsState((prev) => ({
      ...prev,
      volumes: prev.volumes.map((v, i) => (i === idx ? { ...v, [key]: value } : v))
    }))
  }

  const removeVolume = (idx) => {
    setSettingsState((prev) => ({ ...prev, volumes: prev.volumes.filter((_, i) => i !== idx) }))
  }

  const addVolume = () => {
    setSettingsState((prev) => ({ ...prev, volumes: [...(prev.volumes || []), { hostPath: '', containerPath: '' }] }))
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="mb-2 flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-blue-300" />
        <h2 className="text-sm font-semibold text-white">Armazenamento</h2>
      </div>
      <p className="mb-4 text-xs text-slate-500">Pastas compartilhadas entre o servidor e o container. Dados persistem mesmo após recriar o container.</p>

      {volumes.length > 0 ? (
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-2 text-[11px] font-medium uppercase tracking-wider text-slate-600">
            <span>Origem (servidor)</span>
            <span>Destino (container)</span>
            <span className="w-9" />
          </div>
          {volumes.map((vol, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-2">
              <input className={fieldClass} value={vol.hostPath} onChange={(e) => updateVolume(idx, 'hostPath', e.target.value)} placeholder="/srv/data" />
              <input className={fieldClass} value={vol.containerPath} onChange={(e) => updateVolume(idx, 'containerPath', e.target.value)} placeholder="/app/data" />
              <button className="inline-flex items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/5 px-2 py-2 text-rose-300 hover:bg-rose-500/15 transition" type="button" onClick={() => removeVolume(idx)} title="Remover volume">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 px-4 py-6 text-center text-xs text-slate-500">
          Nenhuma pasta compartilhada configurada.
        </div>
      )}

      <button className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-blue-500/40 hover:text-white" type="button" onClick={addVolume}>
        <Plus className="h-3.5 w-3.5" />
        Adicionar pasta compartilhada
      </button>
    </section>
  )
}

export default SettingsStorage
