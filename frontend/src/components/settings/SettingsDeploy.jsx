import { RotateCcw } from 'lucide-react'

const SettingsDeploy = ({ settingsState, setSettingsState }) => {
  const set = (key, value) => setSettingsState((prev) => ({ ...prev, [key]: value }))

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="mb-2 flex items-center gap-2">
        <RotateCcw className="h-4 w-4 text-blue-300" />
        <h2 className="text-sm font-semibold text-white">Deploy e Recuperação</h2>
      </div>
      <p className="mb-4 text-xs text-slate-500">Controla o comportamento em caso de falha durante o deploy.</p>

      <label className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 cursor-pointer hover:border-slate-700 transition">
        <input type="checkbox" className="accent-blue-500 mt-0.5" checked={settingsState.autoRollback} onChange={(e) => set('autoRollback', e.target.checked)} />
        <div>
          <span className="text-sm font-medium text-slate-200">Rollback automático</span>
          <p className="text-[11px] text-slate-500 mt-0.5">Quando ativado, o Zeus retorna automaticamente para a última versão saudável caso o deploy falhe ou o healthcheck não responda.</p>
        </div>
      </label>
    </section>
  )
}

export default SettingsDeploy
