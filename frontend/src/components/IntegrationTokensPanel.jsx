import { useState, useEffect, useCallback } from 'react'
import { KeyRound, Plus, Trash2, Copy, Check, ShieldAlert } from 'lucide-react'
import api from '../services/api'

/**
 * Gerenciamento de Integration Tokens (Open WebUI / integrações OpenAI-compatíveis).
 * Só é montado no Hub Central (checado no App via panel-info). O backend também
 * revalida (central + admin) — defesa em profundidade.
 */
const IntegrationTokensPanel = () => {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState(null) // { token, name } — exibido 1x
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data } = await api.get('/zeus/integrations/tokens')
      setTokens(data.tokens || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Falha ao carregar tokens.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (creating) return
    setCreating(true); setError(''); setNewToken(null)
    try {
      const { data } = await api.post('/zeus/integrations/tokens', { name: name.trim() || 'integration', scope: 'openai' })
      setNewToken({ token: data.token, name: data.name })
      setName('')
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Falha ao gerar token.')
    } finally { setCreating(false) }
  }

  const revoke = async (id) => {
    try { await api.delete(`/zeus/integrations/tokens/${id}`); load() }
    catch (err) { setError(err.response?.data?.error || 'Falha ao revogar.') }
  }

  const copy = () => {
    if (!newToken) return
    navigator.clipboard.writeText(newToken.token)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-[12px]"
          style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)' }}>
          <KeyRound size={18} />
        </div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Tokens de Integração</h2>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Credenciais escopadas para conectar o Open WebUI (e outras integrações OpenAI) ao gateway Zeus.
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-[12px] px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)' }}>
          <ShieldAlert size={15} /> {error}
        </div>
      ) : null}

      {/* Criar */}
      <div className="rounded-[16px] p-4" style={{ background: 'var(--card-bg-elevated)', border: '1px solid var(--color-border)' }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[220px] space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Nome da integração</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: open-webui"
              className="w-full rounded-[10px] px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
          </label>
          <button onClick={create} disabled={creating}
            className="flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-medium text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }}>
            <Plus size={15} /> {creating ? 'Gerando...' : 'Gerar token (scope openai)'}
          </button>
        </div>

        {newToken ? (
          <div className="mt-3 rounded-[12px] p-3" style={{ background: 'rgba(56,162,255,0.08)', border: '1px solid var(--color-brand)' }}>
            <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--color-brand)' }}>
              Token gerado para "{newToken.name}" — copie agora, não será exibido novamente:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded px-2 py-1.5 text-[12px]"
                style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text)' }}>{newToken.token}</code>
              <button onClick={copy} className="flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-xs"
                style={{ background: 'var(--color-surface-sunken)', color: copied ? 'var(--color-brand)' : 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                {copied ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar</>}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Lista */}
      <div className="rounded-[16px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--card-bg-elevated)' }}>
              {['Nome', 'Scope', 'Final', 'Criado', 'Último uso', ''].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-semibold" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center" style={{ color: 'var(--color-text-muted)' }}>Carregando...</td></tr>
            ) : tokens.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center" style={{ color: 'var(--color-text-muted)' }}>Nenhum token ainda.</td></tr>
            ) : tokens.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid var(--color-border)', opacity: t.revoked ? 0.5 : 1 }}>
                <td className="px-4 py-2.5" style={{ color: 'var(--color-text)' }}>{t.name}</td>
                <td className="px-4 py-2.5"><code style={{ color: 'var(--color-brand)' }}>{t.scope}</code></td>
                <td className="px-4 py-2.5" style={{ color: 'var(--color-text-muted)' }}>…{t.last4}</td>
                <td className="px-4 py-2.5" style={{ color: 'var(--color-text-muted)' }}>{new Date(t.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2.5" style={{ color: 'var(--color-text-muted)' }}>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  {t.revoked ? (
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>revogado</span>
                  ) : (
                    <button onClick={() => revoke(t.id)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:opacity-80"
                      style={{ color: 'var(--color-danger)' }}><Trash2 size={12} /> Revogar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        No Open WebUI: use este token em <code>OPENAI_API_KEY</code> apontando para <code>/v1</code> do gateway.
      </p>
    </div>
  )
}

export default IntegrationTokensPanel
