import { Plus, Server, Trash2, Waypoints } from 'lucide-react'
import type { NginxVisualState, SelectedNode } from './nginxVisualConfig'
import { addUpstream, removeUpstream } from './nginxVisualConfig'

type Props = {
  state: NginxVisualState
  selected: SelectedNode
  onSelect: (s: SelectedNode) => void
  onChange: (next: NginxVisualState) => void
}

const LB_LABELS: Record<string, string> = {
  round_robin: 'Round Robin',
  least_conn: 'Least Conn',
  ip_hash: 'IP Hash',
  random: 'Random',
}

export default function UpstreamList({ state, selected, onSelect, onChange }: Props) {
  const handleAdd = () => {
    const next = addUpstream(state)
    const newUp = next.upstreams[next.upstreams.length - 1]
    onChange(next)
    onSelect({ kind: 'upstream', id: newUp.id })
  }

  return (
    <section className="rounded-[20px] border border-white/8 bg-[linear-gradient(160deg,rgba(8,16,32,0.98),rgba(6,13,26,0.96))] shadow-[0_24px_80px_rgba(1,5,16,0.5)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/6 px-5 py-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
          Upstreams
        </span>
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1.5 rounded-[10px] border border-[#2d4f8f]/80 bg-[rgba(16,31,56,0.7)] px-3 py-1.5 text-[12px] font-medium text-[#6aa4ff] transition hover:bg-[rgba(22,42,74,0.9)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Novo
        </button>
      </div>

      <div className="space-y-2 p-3">
        {state.upstreams.length === 0 && (
          <p className="px-2 py-4 text-center text-[12px] text-white/25">
            Nenhum upstream configurado
          </p>
        )}
        {state.upstreams.map((upstream) => {
          const isSelected = selected.kind === 'upstream' && selected.id === upstream.id
          return (
            <div
              key={upstream.id}
              className={[
                'group relative rounded-[14px] border transition cursor-pointer',
                isSelected
                  ? 'border-[#2d4f8f]/80 bg-[rgba(20,36,66,0.9)]'
                  : 'border-white/6 bg-[rgba(10,18,33,0.5)] hover:border-white/12 hover:bg-[rgba(12,22,40,0.7)]',
              ].join(' ')}
              onClick={() => onSelect({ kind: 'upstream', id: upstream.id })}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#4e88ff]/22 bg-[#4e88ff]/10 text-[#7fb0ff]">
                  {upstream.name.includes('socket') ? (
                    <Waypoints className="h-4 w-4" />
                  ) : (
                    <Server className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-white">{upstream.name}</p>
                  <p className="mt-0.5 text-[11px] text-white/40">
                    {LB_LABELS[upstream.method] || upstream.method} · {upstream.servers.length} servidor{upstream.servers.length !== 1 ? 'es' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  title="Remover upstream"
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(removeUpstream(state, upstream.id))
                  }}
                  className="hidden group-hover:flex h-6 w-6 items-center justify-center rounded-[6px] border border-[#7f1d3a]/50 bg-[#3d0e1c]/50 text-[#f87171] transition hover:bg-[#7f1d3a]/40"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="border-t border-white/5 px-4 py-2">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {upstream.servers.slice(0, 4).map((s) => (
                    <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-white/42">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" />
                      <code className="font-mono">{s.host}:{s.port}</code>
                    </span>
                  ))}
                  {upstream.servers.length > 4 && (
                    <span className="text-[11px] text-white/28">
                      +{upstream.servers.length - 4} mais
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
