import { useState, useMemo } from 'react'
import { AlertTriangle, ShieldCheck, RotateCcw, Search, XCircle, Paperclip, Rocket, HardDriveDownload, FileUp } from 'lucide-react'

/**
 * Renderizador de blocos interativos (generative UI) — Fase 3.
 * kinds suportados: action_proposal, table (filtrável), metrics, error_alert.
 * Fallback: kind desconhecido → não renderiza nada (o texto do modelo já cobre).
 */

const riskColor = (risk) => (risk === 'high' ? 'var(--color-danger)' : risk === 'low' ? 'var(--color-success)' : '#f59e0b')

const statusColor = (v) => {
  const s = String(v || '').toLowerCase()
  if (['running', 'ativo', 'sim', 'online', 'up', 'healthy'].some((k) => s.includes(k))) return 'var(--color-success)'
  if (['stopped', 'exited', 'não', 'nao', 'offline', 'down', 'error', 'erro'].some((k) => s.includes(k))) return 'var(--color-danger)'
  return 'var(--color-text-muted)'
}

function Badge({ value }) {
  const color = statusColor(value)
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: 'var(--color-surface-sunken)', color, border: `1px solid ${color}33` }}>
      {value || '—'}
    </span>
  )
}

function TableBlock({ block }) {
  const [q, setQ] = useState('')
  const columns = useMemo(() => block.columns || [], [block.columns])
  const rows = useMemo(() => block.rows || [], [block.rows])
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(term)))
  }, [q, rows, columns])

  return (
    <div className="mt-3 overflow-hidden rounded-[14px] border" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--card-bg-elevated)', borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>{block.title || 'Resultado'}</span>
        <div className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)' }}>
          <Search size={12} style={{ color: 'var(--color-text-muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar..."
            className="w-28 bg-transparent text-[11px] outline-none" style={{ color: 'var(--color-text)' }} />
        </div>
      </div>
      <div className="max-h-[320px] overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="sticky top-0 px-3 py-2 text-left font-semibold"
                  style={{ background: 'var(--card-bg-elevated)', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id || i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2 align-top" style={{ color: 'var(--color-text)' }}>
                    {c.badge ? <Badge value={r[c.key]} /> : (String(r[c.key] ?? '') || '—')}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Nenhum resultado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MetricsBlock({ block }) {
  const items = block.items || []
  const barColor = (p) => (p >= 85 ? 'var(--color-danger)' : p >= 60 ? '#f59e0b' : 'var(--color-success)')
  return (
    <div className="mt-3 rounded-[14px] border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--card-bg-elevated)' }}>
      {block.title ? <div className="mb-2 text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>{block.title}</div> : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((it, i) => (
          <div key={i} className="rounded-[10px] p-2.5" style={{ background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)' }}>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{it.label}</div>
            <div className="mt-0.5 text-[15px] font-semibold" style={{ color: 'var(--color-text)' }}>{it.value}</div>
            {typeof it.percent === 'number' && (
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-border)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, it.percent))}%`, background: barColor(it.percent) }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ActionProposalBlock({ block, onConfirm, onReject, disabled }) {
  const a = block.action || {}
  const meta = block.meta || {}
  const target = a.input?.serviceName || a.input?.serviceId || a.input?.name || '—'
  return (
    <div className="mt-3 rounded-[14px] border p-3.5" style={{ borderColor: 'var(--color-border)', background: 'rgba(245,158,11,0.06)' }}>
      <div className="flex items-center gap-2">
        <AlertTriangle size={15} style={{ color: riskColor(meta.risk) }} />
        <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Ação proposta</span>
        <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: 'var(--color-surface-sunken)', color: riskColor(meta.risk) }}>risco {meta.risk || 'medium'}</span>
      </div>
      <div className="mt-2 space-y-1 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
        <div><span className="opacity-70">Ferramenta:</span> <code>{a.tool}</code></div>
        <div><span className="opacity-70">Alvo:</span> {target}</div>
        {meta.rollback ? <div className="flex items-center gap-1"><RotateCcw size={11} /> Rollback: {meta.rollback}</div> : null}
      </div>
      {onConfirm ? (
        <div className="mt-3 flex items-center gap-2">
          <button onClick={onReject} disabled={disabled} className="rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
            style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>Cancelar</button>
          <button onClick={() => onConfirm(a)} disabled={disabled}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}><ShieldCheck size={13} /> Confirmar e executar</button>
        </div>
      ) : (
        <div className="mt-2 text-[11px] italic" style={{ color: 'var(--color-text-soft)' }}>(proposta anterior — já resolvida)</div>
      )}
    </div>
  )
}

function ErrorAlertBlock({ block }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-[14px] border p-3" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)' }}>
      <XCircle size={15} style={{ color: 'var(--color-danger)' }} className="mt-0.5 shrink-0" />
      <div className="min-w-0 text-[12px]">
        <div className="font-semibold" style={{ color: 'var(--color-danger)' }}>Falha em {block.tool || 'operação'}</div>
        <div className="mt-0.5 break-words" style={{ color: 'var(--color-text-muted)' }}>{block.message}</div>
      </div>
    </div>
  )
}

// Bloco de análise de upload (Fase 5): mostra tipo detectado + ações.
function UploadAnalysisBlock({ block, onDecision, storages, disabled }) {
  const a = block.analysis || {}
  const det = a.detection || {}
  const sug = a.suggestion || {}
  const canPublish = det.publishable
  return (
    <div className="mt-3 rounded-[14px] border p-3.5" style={{ borderColor: 'var(--color-border)', background: 'var(--card-bg-elevated)' }}>
      <div className="flex items-center gap-2">
        <Paperclip size={14} style={{ color: 'var(--color-brand)' }} />
        <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>{block.filename || 'Arquivo'}</span>
        <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text-muted)' }}>{block.uploadKind || a.detection?.type || 'arquivo'}</span>
      </div>
      {a.summary ? <p className="mt-2 text-[12px]" style={{ color: 'var(--color-text)' }}>{a.summary}</p> : null}
      {sug.reason ? <p className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{sug.reason}</p> : null}
      {Array.isArray(a.files) && a.files.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px]" style={{ color: 'var(--color-brand)' }}>Ver conteúdo ({a.files.length})</summary>
          <ul className="mt-1 max-h-32 overflow-auto text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {a.files.map((f, i) => <li key={i} className="truncate">• {f}</li>)}
          </ul>
        </details>
      ) : null}
      {onDecision && block.status !== 'done' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canPublish && (
            <button onClick={() => onDecision(block.uploadId, 'publish_system')} disabled={disabled}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }}>
              <Rocket size={13} /> Publicar sistema
            </button>
          )}
          {sug.action === 'index_kb' && (
            <button onClick={() => onDecision(block.uploadId, 'index_kb')} disabled={disabled}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }}>
              <FileUp size={13} /> Indexar no conhecimento
            </button>
          )}
          <button onClick={() => onDecision(block.uploadId, 'save_local')} disabled={disabled}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
            style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
            <HardDriveDownload size={13} /> Salvar na pasta local
          </button>
          {Array.isArray(storages) && storages.filter((s) => s.id !== 'local' && s.id !== 'local-default').length > 0 && (
            <select onChange={(e) => e.target.value && onDecision(block.uploadId, 'save_storage', e.target.value)} disabled={disabled}
              defaultValue="" className="zeus-select text-xs">
              <option value="" disabled>Salvar em storage…</option>
              {storages.filter((s) => s.id !== 'local' && s.id !== 'local-default').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button onClick={() => onDecision(block.uploadId, 'discard')} disabled={disabled}
            className="rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
            style={{ background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
            Descartar
          </button>
        </div>
      ) : block.status === 'done' ? (
        <div className="mt-2 text-[11px] italic" style={{ color: 'var(--color-success)' }}>✓ {block.resultNote || 'Concluído.'}</div>
      ) : null}
    </div>
  )
}

// Wizard de publicação guiado (5.3): renderiza o passo atual e conduz o fluxo.
function PublishWizardBlock({ block, onWizard, disabled }) {
  const [val, setVal] = useState('')
  const state = block.wizard || {}
  const step = state.step
  const done = state.done
  const summary = state.summary
  const warning = state.warning

  if (done && state.result) {
    return (
      <div className="mt-3 rounded-[14px] border p-3.5" style={{ borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)' }}>
        <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--color-success)' }}>
          <Rocket size={14} /> Serviço publicado
        </div>
        <p className="mt-1 whitespace-pre-line text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{state.result}</p>
      </div>
    )
  }

  const renderReview = () => (
    <div className="mt-2 rounded-[10px] p-2.5 text-[12px]" style={{ background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)' }}>
      <div><span className="opacity-70">Tipo:</span> {summary?.type}</div>
      <div><span className="opacity-70">Nome:</span> {summary?.name}</div>
      <div><span className="opacity-70">Domínio:</span> {summary?.domain}</div>
      <div><span className="opacity-70">Porta interna:</span> {summary?.port}</div>
      {Array.isArray(summary?.env) && summary.env.length ? (
        <div className="mt-1"><span className="opacity-70">Variáveis:</span>
          <ul className="ml-3 list-disc">{summary.env.map((e) => <li key={e.key}>{e.key} = <code>{e.value}</code></li>)}</ul>
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="mt-3 rounded-[14px] border p-3.5" style={{ borderColor: 'var(--color-border)', background: 'var(--card-bg-elevated)' }}>
      <div className="flex items-center gap-2">
        <Rocket size={14} style={{ color: 'var(--color-brand)' }} />
        <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Publicação guiada</span>
        {typeof state.index === 'number' && state.total ? (
          <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>passo {state.index + 1}/{state.total}</span>
        ) : null}
      </div>

      {step ? (
        <div className="mt-2">
          <div className="text-[13px] font-medium" style={{ color: 'var(--color-text)' }}>{step.title}</div>
          <p className="mt-0.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{step.prompt}</p>
          {step.hint ? <p className="mt-1 rounded p-2 text-[11px]" style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text-muted)' }}>💡 {step.hint}</p> : null}
          {warning ? <p className="mt-1 text-[11px]" style={{ color: '#f59e0b' }}>⚠️ {warning}{state.suggestion ? ` Sugestão: ${state.suggestion}` : ''}</p> : null}

          {step.kind === 'confirm' ? (
            <div className="mt-2 flex gap-2">
              <button disabled={disabled} onClick={() => onWizard('answer', { value: true })}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }}>Sim, confirmar</button>
              <button disabled={disabled} onClick={() => onWizard('answer', { value: false })}
                className="rounded-lg px-3 py-1.5 text-xs disabled:opacity-40" style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>Não</button>
            </div>
          ) : step.kind === 'review' ? (
            <>
              {renderReview()}
              <button disabled={disabled} onClick={() => onWizard('confirm')}
                className="mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }}>
                <Rocket size={13} /> Confirmar publicação
              </button>
            </>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <input type={step.kind === 'secret' ? 'password' : 'text'} value={val} onChange={(e) => setVal(e.target.value)}
                placeholder={step.defaultValue ? `padrão: ${step.defaultValue}` : ''}
                className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none" style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
              {step.canGenerate ? (
                <button disabled={disabled} onClick={() => onWizard('generate', { setVal })}
                  className="rounded-lg px-2 py-1.5 text-[11px] disabled:opacity-40" style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-brand)', border: '1px solid var(--color-border)' }}>Gerar</button>
              ) : null}
              <button disabled={disabled} onClick={() => { onWizard('answer', { value: val || step.defaultValue || '' }); setVal('') }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-strong))' }}>Próximo</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default function AiBlocks({ blocks, onConfirmAction, onRejectAction, onUploadDecision, onWizard, storages, disabled }) {
  if (!Array.isArray(blocks) || !blocks.length) return null
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'action_proposal':
            return <ActionProposalBlock key={i} block={block} onConfirm={onConfirmAction} onReject={onRejectAction} disabled={disabled} />
          case 'table':
            return <TableBlock key={i} block={block} />
          case 'metrics':
            return <MetricsBlock key={i} block={block} />
          case 'error_alert':
            return <ErrorAlertBlock key={i} block={block} />
          case 'upload_analysis':
            return <UploadAnalysisBlock key={i} block={block} onDecision={onUploadDecision} storages={storages} disabled={disabled} />
          case 'publish_wizard':
            return <PublishWizardBlock key={i} block={block} onWizard={(action, extra) => onWizard?.(block, action, extra)} disabled={disabled} />
          default:
            return null
        }
      })}
    </>
  )
}
