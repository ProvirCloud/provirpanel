import { GitBranch, Loader2, Trash2, Search } from 'lucide-react'

const fieldClass = 'rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
const smallButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function DeliveryCodeOrigin({
  activeConnection, editingToken, setEditingToken, token, setToken,
  repos, branches, selectedRepo, setSelectedRepo, selectedBranch, setSelectedBranch,
  deployMode, setDeployMode, loadingAction,
  connectGithub, removeGithubConnection, analyzeRepo
}) {
  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        <GitBranch className="h-4 w-4 text-blue-400" /> Origem do Código
      </h3>

      {activeConnection ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Conectado como <strong>{activeConnection.accountLogin}</strong> · {repos.length} repos</span>
            <div className="flex flex-wrap gap-2">
              <button className={smallButtonClass} type="button" onClick={() => setEditingToken(v => !v)}>
                {editingToken ? 'Cancelar' : 'Alterar token'}
              </button>
              <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={removeGithubConnection} disabled={loadingAction === 'remove-connection'}>
                {loadingAction === 'remove-connection' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Remover
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!activeConnection || editingToken ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            {activeConnection ? 'Cole o novo token para substituir.' : <>
              Use um <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300">fine-grained token</a> com acesso de leitura aos repositórios.
            </>}
          </p>
          <input className={`${fieldClass} w-full`} type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="github_pat_..." />
          <button className={primaryButtonClass} type="button" onClick={connectGithub} disabled={!token || loadingAction === 'connect'}>
            {loadingAction === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
            {activeConnection ? 'Atualizar token' : 'Conectar GitHub'}
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Repositório</span>
          <select className={`${fieldClass} w-full`} value={selectedRepo} onChange={e => setSelectedRepo(e.target.value)} disabled={!repos.length}>
            <option value="">Selecione</option>
            {repos.map(r => <option key={r.id} value={r.fullName}>{r.fullName}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Branch</span>
          <select className={`${fieldClass} w-full`} value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}>
            {branches.length ? branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>) : <option value={selectedBranch}>{selectedBranch}</option>}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Deploy mode</span>
          <select className={`${fieldClass} w-full`} value={deployMode} onChange={e => setDeployMode(e.target.value)}>
            <option value="manual">Manual</option>
            <option value="push">Auto (push)</option>
            <option value="tag">Auto (tag v*)</option>
          </select>
        </label>
      </div>

      <button className={smallButtonClass} type="button" onClick={analyzeRepo} disabled={!selectedRepo || !selectedBranch || loadingAction === 'analyze'}>
        {loadingAction === 'analyze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        Analisar projeto
      </button>
    </div>
  )
}
