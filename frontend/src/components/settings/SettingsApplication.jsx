import { Settings } from 'lucide-react'

const fieldClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500/60'

const Field = ({ label, hint, children }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-slate-400">{label}</label>
    {children}
    {hint ? <span className="text-[11px] text-slate-600">{hint}</span> : null}
  </div>
)

const SettingsApplication = ({ settingsState, setSettingsState }) => {
  const set = (key, value) => setSettingsState((prev) => ({ ...prev, [key]: value }))

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="mb-4 flex items-center gap-2">
        <Settings className="h-4 w-4 text-blue-300" />
        <h2 className="text-sm font-semibold text-white">Configuração da Aplicação</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Porta da aplicação" hint="Porta interna onde a aplicação escuta dentro do container.">
          <input className={fieldClass} value={settingsState.containerPort} onChange={(e) => set('containerPort', e.target.value)} placeholder="ex: 8080" />
        </Field>
        <Field label="Porta externa" hint="Porta acessível pela rede. Tráfego externo chega por aqui.">
          <input className={fieldClass} value={settingsState.hostPort} onChange={(e) => set('hostPort', e.target.value)} placeholder="ex: 3000" />
        </Field>
        <Field label="Comando de inicialização" hint="Substitui o CMD padrão da imagem. Deixe vazio para usar o padrão.">
          <input className={`${fieldClass} md:col-span-2`} value={settingsState.command} onChange={(e) => set('command', e.target.value)} placeholder="opcional — ex: npm start, java -jar app.jar" />
        </Field>
      </div>
    </section>
  )
}

export default SettingsApplication
