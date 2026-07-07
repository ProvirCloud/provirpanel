import { useState } from 'react'
import { Terminal, ChevronDown, ChevronRight } from 'lucide-react'

const fieldClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500/60'

const SettingsAdvanced = ({ service, settingsState, setSettingsState }) => {
  const [open, setOpen] = useState(false)

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/70">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-4 text-left hover:bg-slate-900/40 transition rounded-xl"
        onClick={() => setOpen(!open)}
      >
        <Terminal className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-400 flex-1">Configuração Avançada</h2>
        {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
      </button>
      {open ? (
        <div className="border-t border-slate-800 p-4 space-y-3">
          <p className="text-[11px] text-slate-600 mb-3">Configurações técnicas do Docker. Altere apenas se souber o que está fazendo.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Entrypoint</label>
              <input className={`${fieldClass} opacity-70`} value={service.entrypoint || ''} readOnly placeholder="padrão da imagem" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Working Directory</label>
              <input className={`${fieldClass} opacity-70`} value={service.workingDir || ''} readOnly placeholder="padrão da imagem" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Runtime</label>
              <input className={`${fieldClass} opacity-70`} value={service.runtime || 'runc'} readOnly />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Restart Policy</label>
              <input className={`${fieldClass} opacity-70`} value={service.restartPolicy || 'unless-stopped'} readOnly />
            </div>
          </div>
          {settingsState.nodeServiceMode ? (
            <div className="flex flex-col gap-1 mt-2">
              <label className="text-xs text-slate-500">Modo do serviço Node</label>
              <input className={fieldClass} value={settingsState.nodeServiceMode} onChange={(e) => setSettingsState((prev) => ({ ...prev, nodeServiceMode: e.target.value }))} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export default SettingsAdvanced
