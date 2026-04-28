import type { NginxVisualState } from './nginxVisualConfig'
import { mutateHttps } from './nginxVisualConfig'

type Props = {
  state: NginxVisualState
  onChange: (next: NginxVisualState) => void
}

const Toggle = ({
  checked,
  onChange,
  label,
  value,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  value: string
}) => (
  <div className="flex items-center justify-between gap-3">
    <div className="min-w-0">
      <p className="text-[13px] text-white/80">{label}</p>
      <p className="mt-0.5 text-[11px] font-mono text-white/30 truncate">{value}</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-5 w-9 flex-shrink-0 rounded-full border transition-all duration-200',
        checked ? 'border-[#3d72ff] bg-[#2b5fdd]' : 'border-white/12 bg-white/6',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200',
          checked ? 'left-4' : 'left-0.5',
        ].join(' ')}
      />
    </button>
  </div>
)

export default function SecurityRulesPanel({ state, onChange }: Props) {
  return (
    <section className="rounded-[20px] border border-white/8 bg-[linear-gradient(160deg,rgba(8,16,32,0.98),rgba(6,13,26,0.96))] shadow-[0_24px_80px_rgba(1,5,16,0.5)] overflow-hidden">
      <div className="border-b border-white/6 px-5 py-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
          Segurança
        </span>
      </div>

      <div className="space-y-4 px-5 py-4">
        <Toggle
          label="SSL / TLS"
          value={state.https.sslEnabled ? 'TLSv1.2 TLSv1.3' : 'Desativado'}
          checked={state.https.sslEnabled}
          onChange={(v) => onChange(mutateHttps(state, { sslEnabled: v }))}
        />
        <Toggle
          label="HTTP/2"
          value={state.https.http2Enabled ? 'Ativo' : 'Desativado'}
          checked={state.https.http2Enabled}
          onChange={(v) => onChange(mutateHttps(state, { http2Enabled: v }))}
        />
        <Toggle
          label="HSTS"
          value="max-age=31536000; includeSubDomains"
          checked={state.https.hstsEnabled}
          onChange={(v) => onChange(mutateHttps(state, { hstsEnabled: v }))}
        />
        <Toggle
          label="Security Headers"
          value="X-Frame-Options, CSP, HSTS…"
          checked={state.https.securityHeadersEnabled}
          onChange={(v) => onChange(mutateHttps(state, { securityHeadersEnabled: v }))}
        />
        <Toggle
          label="server_tokens off"
          value={state.https.serverTokensOff ? 'Versão nginx oculta' : 'Exposta'}
          checked={state.https.serverTokensOff}
          onChange={(v) => onChange(mutateHttps(state, { serverTokensOff: v }))}
        />
        <Toggle
          label="Redirect HTTP → HTTPS"
          value={`${state.http.port} → ${state.https.port}`}
          checked={state.http.redirectToHttps}
          onChange={(v) => onChange({ ...state, http: { ...state.http, redirectToHttps: v } })}
        />

        <div className="border-t border-white/6 pt-3">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex-shrink-0 text-white/60">client_max_body_size</span>
            <input
              className="h-7 w-24 rounded-[8px] border border-white/10 bg-[rgba(8,15,30,0.9)] px-2 text-right font-mono text-[12px] text-white/80 outline-none transition focus:border-[#4d85ff]/60 focus:ring-1 focus:ring-[#4d85ff]/20"
              value={state.https.clientMaxBodySize}
              onChange={(e) => onChange(mutateHttps(state, { clientMaxBodySize: e.target.value }))}
              placeholder="500m"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
