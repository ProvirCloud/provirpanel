import { Network } from 'lucide-react'

const fieldClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500/60'

const Field = ({ label, hint, children }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-slate-400">{label}</label>
    {children}
    {hint ? <span className="text-[11px] text-slate-600">{hint}</span> : null}
  </div>
)

const SettingsNetwork = ({ service, settingsState, setSettingsState }) => {
  const set = (key, value) => setSettingsState((prev) => ({ ...prev, [key]: value }))

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="mb-4 flex items-center gap-2">
        <Network className="h-4 w-4 text-blue-300" />
        <h2 className="text-sm font-semibold text-white">Rede</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Network Docker" hint="Rede interna onde o container se comunica com outros serviços.">
          <input className={fieldClass} value={settingsState.networkName} onChange={(e) => set('networkName', e.target.value)} placeholder="bridge" />
        </Field>
        <Field label="Hostname" hint="Nome pelo qual outros containers encontram este serviço na rede.">
          <input className={`${fieldClass} opacity-70`} value={service.name || ''} readOnly />
        </Field>
        <div className="md:col-span-2">
          <label className="inline-flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-300 cursor-pointer hover:border-slate-700 transition">
            <input type="checkbox" className="accent-blue-500" checked={settingsState.bindLocalOnly} onChange={(e) => set('bindLocalOnly', e.target.checked)} />
            <div>
              <span className="font-medium text-slate-200">Acessível apenas internamente</span>
              <p className="text-[11px] text-slate-500 mt-0.5">Quando ativado, o serviço não fica exposto para a internet — apenas outros containers na mesma rede conseguem acessá-lo.</p>
            </div>
          </label>
        </div>
      </div>
    </section>
  )
}

export default SettingsNetwork
