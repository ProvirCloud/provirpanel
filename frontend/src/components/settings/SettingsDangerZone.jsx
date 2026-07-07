import { useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { servicesApi } from '../../services/serviceDetailsApi.js'

const fieldClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500/60'

const SettingsDangerZone = ({ service }) => {
  const [deleteText, setDeleteText] = useState('')
  const [removing, setRemoving] = useState(false)
  const navigate = useNavigate()

  const removeService = async () => {
    if (deleteText !== service.name) return
    setRemoving(true)
    try {
      await servicesApi.remove(service.id, { removeFolder: false })
      navigate('/docker')
    } catch {
      setRemoving(false)
    }
  }

  return (
    <section className="rounded-xl border border-rose-500/20 bg-rose-500/[0.02] p-4">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-rose-400" />
        <h2 className="text-sm font-semibold text-rose-300">Ações permanentes</h2>
      </div>
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-500/10 bg-slate-950/60 p-3 text-xs text-slate-400 space-y-1">
          <p className="font-medium text-rose-200/80">Esta ação não poderá ser desfeita. Ao remover:</p>
          <ul className="list-disc list-inside space-y-0.5 text-slate-500">
            <li>O container será destruído</li>
            <li>O histórico de deploys será removido</li>
            <li>Todas as configurações serão perdidas</li>
            <li>Variáveis de ambiente serão apagadas</li>
          </ul>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Digite <span className="font-mono text-rose-300">{service.name}</span> para confirmar</label>
          <input className={fieldClass} value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder={service.name} />
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 transition"
          type="button"
          onClick={removeService}
          disabled={deleteText !== service.name || removing}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remover serviço permanentemente
        </button>
      </div>
    </section>
  )
}

export default SettingsDangerZone
