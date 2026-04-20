import { useCallback, useEffect, useState } from 'react'
import {
  Shield,
  Globe,
  Mail,
  RefreshCcw,
  Save,
  Plus,
  Trash2,
  Wand2,
  LoaderCircle,
} from 'lucide-react'
import api from '../services/api.js'

const defaultConfigForm = {
  credentials: {
    accountId: '',
    accountEmail: '',
    apiToken: '',
  },
  options: {
    autoSyncZones: true,
    managedByDefault: true,
  },
  defaults: {
    sslMode: 'strict',
    alwaysUseHttps: true,
    automaticHttpsRewrites: true,
    securityLevel: 'medium',
    proxiedByDefault: true,
    emailRoutingEnabled: true,
    firewallRules: [],
    wafRules: [],
  },
}

const defaultDnsForm = {
  type: 'A',
  name: '@',
  content: '',
  ttl: 1,
  proxied: true,
  priority: '',
}

const defaultEmailForm = {
  name: '',
  source: '',
  destinations: '',
  enabled: true,
  priority: '',
}

const defaultFirewallForm = {
  target: 'ip',
  value: '',
  mode: 'managed_challenge',
  notes: '',
}

const defaultWafForm = {
  description: '',
  expression: '',
  action: 'managed_challenge',
  enabled: true,
}

const SectionCard = ({ title, subtitle, actions, children }) => (
  <section className="rounded-3xl border border-slate-800 bg-slate-950/65 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.25)]">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
    {children}
  </section>
)

const StatPill = ({ label, value }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
    <p className="mt-2 text-lg font-semibold text-white">{value}</p>
  </div>
)

const DomainsPanel = ({ showPageIntro = true }) => {
  const [configForm, setConfigForm] = useState(defaultConfigForm)
  const [zones, setZones] = useState([])
  const [selectedZoneId, setSelectedZoneId] = useState('')
  const [overview, setOverview] = useState(null)
  const [metadataForm, setMetadataForm] = useState({ clientName: '', notes: '', autoApplyDefaults: true })
  const [settingsForm, setSettingsForm] = useState({
    sslMode: 'strict',
    alwaysUseHttps: true,
    automaticHttpsRewrites: true,
    securityLevel: 'medium',
  })
  const [dnsForm, setDnsForm] = useState(defaultDnsForm)
  const [emailForm, setEmailForm] = useState(defaultEmailForm)
  const [firewallForm, setFirewallForm] = useState(defaultFirewallForm)
  const [wafForm, setWafForm] = useState(defaultWafForm)
  const [defaultFirewallRuleForm, setDefaultFirewallRuleForm] = useState(defaultFirewallForm)
  const [defaultWafRuleForm, setDefaultWafRuleForm] = useState(defaultWafForm)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const loadOverview = useCallback(async (zoneId) => {
    const response = await api.get(`/domains/cloudflare/zones/${zoneId}/overview`)
    const data = response.data
    setOverview(data)
    setMetadataForm({
      clientName: data.zone?.clientName || '',
      notes: data.zone?.notes || '',
      autoApplyDefaults: data.zone?.autoApplyDefaults !== false,
    })
    setSettingsForm({
      sslMode: data.settings?.ssl || 'strict',
      alwaysUseHttps: data.settings?.alwaysUseHttps === 'on',
      automaticHttpsRewrites: data.settings?.automaticHttpsRewrites === 'on',
      securityLevel: data.settings?.securityLevel || 'medium',
    })
  }, [])

  const loadBase = useCallback(async (preferZoneId) => {
    const [configRes, zonesRes] = await Promise.all([
      api.get('/domains/cloudflare/config'),
      api.get('/domains/cloudflare/zones'),
    ])
    setConfigForm((current) => ({
      ...current,
      ...configRes.data,
      credentials: {
        accountId: configRes.data.credentials?.accountId || '',
        accountEmail: configRes.data.credentials?.accountEmail || '',
        apiToken: '',
      },
      options: {
        autoSyncZones: configRes.data.options?.autoSyncZones !== false,
        managedByDefault: configRes.data.options?.managedByDefault !== false,
      },
      defaults: {
        ...current.defaults,
        ...configRes.data.defaults,
      },
    }))

    const nextZones = zonesRes.data.zones || []
    setZones(nextZones)

    const nextZoneId = preferZoneId || selectedZoneId || nextZones[0]?.zoneId || ''
    if (nextZoneId) {
      setSelectedZoneId(nextZoneId)
      await loadOverview(nextZoneId)
    } else {
      setOverview(null)
    }
  }, [loadOverview, selectedZoneId])

  useEffect(() => {
    let active = true
    setLoading(true)
    loadBase().catch((err) => {
      if (active) {
        alert(err.response?.data?.message || err.message || 'Erro ao carregar integração Cloudflare')
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [loadBase])

  const addDefaultFirewallRule = () => {
    if (!defaultFirewallRuleForm.value.trim()) return
    setConfigForm((current) => ({
      ...current,
      defaults: {
        ...current.defaults,
        firewallRules: [
          ...(current.defaults.firewallRules || []),
          {
            mode: defaultFirewallRuleForm.mode,
            notes: defaultFirewallRuleForm.notes,
            configuration: {
              target: defaultFirewallRuleForm.target,
              value: defaultFirewallRuleForm.value,
            },
          },
        ],
      },
    }))
    setDefaultFirewallRuleForm(defaultFirewallForm)
  }

  const addDefaultWafRule = () => {
    if (!defaultWafRuleForm.expression.trim()) return
    setConfigForm((current) => ({
      ...current,
      defaults: {
        ...current.defaults,
        wafRules: [
          ...(current.defaults.wafRules || []),
          {
            description: defaultWafRuleForm.description,
            expression: defaultWafRuleForm.expression,
            action: defaultWafRuleForm.action,
            enabled: defaultWafRuleForm.enabled,
          },
        ],
      },
    }))
    setDefaultWafRuleForm(defaultWafForm)
  }

  const runAction = async (callback) => {
    setBusy(true)
    try {
      await callback()
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Falha na operação')
    } finally {
      setBusy(false)
    }
  }

  const saveCloudflareConfig = async (event) => {
    event.preventDefault()
    await runAction(async () => {
      await api.put('/domains/cloudflare/config', configForm)
      await loadBase(selectedZoneId)
    })
  }

  const syncZones = async () => {
    await runAction(async () => {
      await api.post('/domains/cloudflare/zones/sync')
      await loadBase(selectedZoneId)
    })
  }

  const saveMetadata = async (event) => {
    event.preventDefault()
    if (!selectedZoneId) return
    await runAction(async () => {
      await api.patch(`/domains/cloudflare/zones/${selectedZoneId}/metadata`, metadataForm)
      await loadBase(selectedZoneId)
    })
  }

  const saveZoneSettings = async (event) => {
    event.preventDefault()
    if (!selectedZoneId) return
    await runAction(async () => {
      await api.patch(`/domains/cloudflare/zones/${selectedZoneId}/settings`, settingsForm)
      await loadOverview(selectedZoneId)
    })
  }

  const applyDefaults = async () => {
    if (!selectedZoneId) return
    await runAction(async () => {
      await api.post(`/domains/cloudflare/zones/${selectedZoneId}/apply-defaults`)
      await loadOverview(selectedZoneId)
      await loadBase(selectedZoneId)
    })
  }

  const createDnsRecord = async (event) => {
    event.preventDefault()
    await runAction(async () => {
      await api.post(`/domains/cloudflare/zones/${selectedZoneId}/dns-records`, dnsForm)
      setDnsForm({
        ...defaultDnsForm,
        proxied: configForm.defaults?.proxiedByDefault !== false,
      })
      await loadOverview(selectedZoneId)
    })
  }

  const removeDnsRecord = async (recordId) => {
    await runAction(async () => {
      await api.delete(`/domains/cloudflare/zones/${selectedZoneId}/dns-records/${recordId}`)
      await loadOverview(selectedZoneId)
    })
  }

  const createEmailRule = async (event) => {
    event.preventDefault()
    await runAction(async () => {
      await api.post(`/domains/cloudflare/zones/${selectedZoneId}/email-routing/rules`, {
        ...emailForm,
        destinations: emailForm.destinations.split(',').map((item) => item.trim()).filter(Boolean),
      })
      setEmailForm(defaultEmailForm)
      await loadOverview(selectedZoneId)
    })
  }

  const removeEmailRule = async (ruleId) => {
    await runAction(async () => {
      await api.delete(`/domains/cloudflare/zones/${selectedZoneId}/email-routing/rules/${ruleId}`)
      await loadOverview(selectedZoneId)
    })
  }

  const createFirewallRule = async (event) => {
    event.preventDefault()
    await runAction(async () => {
      await api.post(`/domains/cloudflare/zones/${selectedZoneId}/firewall/access-rules`, firewallForm)
      setFirewallForm(defaultFirewallForm)
      await loadOverview(selectedZoneId)
    })
  }

  const removeFirewallRule = async (ruleId) => {
    await runAction(async () => {
      await api.delete(`/domains/cloudflare/zones/${selectedZoneId}/firewall/access-rules/${ruleId}`)
      await loadOverview(selectedZoneId)
    })
  }

  const createWafRule = async (event) => {
    event.preventDefault()
    await runAction(async () => {
      await api.post(`/domains/cloudflare/zones/${selectedZoneId}/waf/rules`, wafForm)
      setWafForm(defaultWafForm)
      await loadOverview(selectedZoneId)
    })
  }

  const removeWafRule = async (ruleId, rulesetId) => {
    await runAction(async () => {
      await api.delete(`/domains/cloudflare/zones/${selectedZoneId}/waf/rules/${rulesetId}/${ruleId}`)
      await loadOverview(selectedZoneId)
    })
  }

  const selectedZone = zones.find((zone) => zone.zoneId === selectedZoneId)

  if (loading) {
    return <div className="p-6 text-slate-400">Carregando integração Cloudflare...</div>
  }

  return (
    <div className="space-y-6">
      {showPageIntro ? (
        <div>
          <h1 className="text-3xl font-semibold text-white">Cloudflare Control Plane</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            O Zeus passa a operar domínios, e-mail, firewall e WAF com um perfil padrão por cliente e ajustes pontuais por zona.
          </p>
        </div>
      ) : null}

      <SectionCard
        title="Perfil padrão Zeus"
        subtitle="Credenciais da conta Cloudflare e baseline aplicado para todos os clientes."
        actions={[
          <button
            key="sync"
            type="button"
            onClick={syncZones}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            <RefreshCcw className="h-4 w-4" />
            Sincronizar zonas
          </button>,
          <button
            key="save"
            type="submit"
            form="cloudflare-config-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            Salvar perfil
          </button>,
        ]}
      >
        <form id="cloudflare-config-form" onSubmit={saveCloudflareConfig} className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm text-slate-300">Account ID</span>
            <input
              value={configForm.credentials.accountId}
              onChange={(event) => setConfigForm((current) => ({
                ...current,
                credentials: { ...current.credentials, accountId: event.target.value },
              }))}
              className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
              placeholder="Cloudflare account id"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm text-slate-300">E-mail administrativo</span>
            <input
              value={configForm.credentials.accountEmail}
              onChange={(event) => setConfigForm((current) => ({
                ...current,
                credentials: { ...current.credentials, accountEmail: event.target.value },
              }))}
              className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
              placeholder="infra@cliente.com"
            />
          </label>
          <label className="space-y-2 lg:col-span-2">
            <span className="text-sm text-slate-300">API Token</span>
            <input
              type="password"
              value={configForm.credentials.apiToken}
              onChange={(event) => setConfigForm((current) => ({
                ...current,
                credentials: { ...current.credentials, apiToken: event.target.value },
              }))}
              className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
              placeholder="Cole apenas para atualizar"
            />
            <p className="text-xs text-slate-500">Permissões sugeridas: `Zone DNS Write`, `Zone WAF Write`, `Zone Settings Write`, `Email Routing Rules Write` e `Access: Apps and Policies Write`.</p>
          </label>
          <label className="space-y-2">
            <span className="text-sm text-slate-300">SSL padrão</span>
            <select
              value={configForm.defaults.sslMode}
              onChange={(event) => setConfigForm((current) => ({
                ...current,
                defaults: { ...current.defaults, sslMode: event.target.value },
              }))}
              className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
            >
              <option value="off">Off</option>
              <option value="flexible">Flexible</option>
              <option value="full">Full</option>
              <option value="strict">Full (Strict)</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm text-slate-300">Security level padrão</span>
            <select
              value={configForm.defaults.securityLevel}
              onChange={(event) => setConfigForm((current) => ({
                ...current,
                defaults: { ...current.defaults, securityLevel: event.target.value },
              }))}
              className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
            >
              <option value="essentially_off">Essentially off</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="under_attack">Under attack</option>
            </select>
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={configForm.defaults.alwaysUseHttps}
              onChange={(event) => setConfigForm((current) => ({
                ...current,
                defaults: { ...current.defaults, alwaysUseHttps: event.target.checked },
              }))}
            />
            Always Use HTTPS
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={configForm.defaults.automaticHttpsRewrites}
              onChange={(event) => setConfigForm((current) => ({
                ...current,
                defaults: { ...current.defaults, automaticHttpsRewrites: event.target.checked },
              }))}
            />
            Automatic HTTPS Rewrites
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={configForm.defaults.proxiedByDefault}
              onChange={(event) => setConfigForm((current) => ({
                ...current,
                defaults: { ...current.defaults, proxiedByDefault: event.target.checked },
              }))}
            />
            DNS proxied por padrão
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={configForm.options.autoSyncZones}
              onChange={(event) => setConfigForm((current) => ({
                ...current,
                options: { ...current.options, autoSyncZones: event.target.checked },
              }))}
            />
            Sincronização automática habilitada
          </label>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 lg:col-span-2">
            <div className="mb-3 flex items-center gap-2 text-white">
              <Shield className="h-4 w-4 text-cyan-300" />
              <h3 className="font-medium">Firewall padrão</h3>
            </div>
            <div className="space-y-2">
              {(configForm.defaults.firewallRules || []).map((rule, index) => (
                <div key={`${rule.configuration?.target}-${rule.configuration?.value}-${index}`} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-300">
                  <span>{rule.mode} • {rule.configuration?.target}:{rule.configuration?.value}</span>
                  <button
                    type="button"
                    onClick={() => setConfigForm((current) => ({
                      ...current,
                      defaults: {
                        ...current.defaults,
                        firewallRules: current.defaults.firewallRules.filter((_, itemIndex) => itemIndex !== index),
                      },
                    }))}
                    className="text-rose-400 hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="grid gap-2 md:grid-cols-4">
                <select
                  value={defaultFirewallRuleForm.target}
                  onChange={(event) => setDefaultFirewallRuleForm((current) => ({ ...current, target: event.target.value }))}
                  className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white"
                >
                  <option value="ip">IP</option>
                  <option value="ip_range">IP Range</option>
                  <option value="asn">ASN</option>
                  <option value="country">Country</option>
                </select>
                <input
                  value={defaultFirewallRuleForm.value}
                  onChange={(event) => setDefaultFirewallRuleForm((current) => ({ ...current, value: event.target.value }))}
                  className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white"
                  placeholder="Valor"
                />
                <select
                  value={defaultFirewallRuleForm.mode}
                  onChange={(event) => setDefaultFirewallRuleForm((current) => ({ ...current, mode: event.target.value }))}
                  className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white"
                >
                  <option value="block">Block</option>
                  <option value="challenge">Challenge</option>
                  <option value="js_challenge">JS Challenge</option>
                  <option value="managed_challenge">Managed Challenge</option>
                  <option value="whitelist">Whitelist</option>
                </select>
                <button
                  type="button"
                  onClick={addDefaultFirewallRule}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-800 px-4 py-3 text-sm text-cyan-300"
                >
                  <Plus className="h-4 w-4" />
                  Regra padrão
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 lg:col-span-2">
            <div className="mb-3 flex items-center gap-2 text-white">
              <Shield className="h-4 w-4 text-emerald-300" />
              <h3 className="font-medium">WAF padrão</h3>
            </div>
            <div className="space-y-2">
              {(configForm.defaults.wafRules || []).map((rule, index) => (
                <div key={`${rule.action}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-300">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-white">{rule.description}</p>
                      <p className="mt-1 text-slate-400">{rule.action}</p>
                      <code className="mt-2 block overflow-x-auto text-xs text-cyan-300">{rule.expression}</code>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfigForm((current) => ({
                        ...current,
                        defaults: {
                          ...current.defaults,
                          wafRules: current.defaults.wafRules.filter((_, itemIndex) => itemIndex !== index),
                        },
                      }))}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-2">
              <input
                value={defaultWafRuleForm.description}
                onChange={(event) => setDefaultWafRuleForm((current) => ({ ...current, description: event.target.value }))}
                className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white"
                placeholder="Descrição da regra padrão"
              />
              <textarea
                value={defaultWafRuleForm.expression}
                onChange={(event) => setDefaultWafRuleForm((current) => ({ ...current, expression: event.target.value }))}
                rows={3}
                className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white"
                placeholder='(http.request.uri.path contains "/admin")'
              />
              <div className="grid gap-2 md:grid-cols-[1fr,auto]">
                <select
                  value={defaultWafRuleForm.action}
                  onChange={(event) => setDefaultWafRuleForm((current) => ({ ...current, action: event.target.value }))}
                  className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white"
                >
                  <option value="block">Block</option>
                  <option value="managed_challenge">Managed Challenge</option>
                  <option value="challenge">Challenge</option>
                  <option value="skip">Skip</option>
                  <option value="log">Log</option>
                </select>
                <button
                  type="button"
                  onClick={addDefaultWafRule}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-800 px-4 py-3 text-sm text-emerald-300"
                >
                  <Plus className="h-4 w-4" />
                  WAF padrão
                </button>
              </div>
            </div>
          </div>
        </form>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[360px,minmax(0,1fr)]">
        <SectionCard
          title="Clientes e zonas"
          subtitle="Cloudflare passa a ser o edge padrão de todos os clientes."
        >
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatPill label="Zonas" value={zones.length} />
            <StatPill label="Gerenciadas" value={zones.filter((zone) => zone.autoApplyDefaults !== false).length} />
            <StatPill label="Token" value={configForm.credentials.apiToken ? 'Atualizando' : 'Persistido'} />
          </div>
          <div className="space-y-3">
            {zones.map((zone) => (
              <button
                key={zone.zoneId}
                type="button"
                onClick={() => {
                  setSelectedZoneId(zone.zoneId)
                  loadOverview(zone.zoneId).catch((err) => alert(err.response?.data?.message || err.message))
                }}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                  selectedZoneId === zone.zoneId
                    ? 'border-cyan-400/50 bg-cyan-500/10'
                    : 'border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{zone.clientName || zone.name}</p>
                    <p className="text-sm text-slate-400">{zone.name}</p>
                  </div>
                  <span className="rounded-full border border-slate-700 px-2 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">
                    {zone.status}
                  </span>
                </div>
                {zone.notes ? <p className="mt-3 text-xs text-slate-500">{zone.notes}</p> : null}
              </button>
            ))}
            {zones.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
                Nenhuma zona encontrada. Salve as credenciais e sincronize a conta Cloudflare.
              </div>
            ) : null}
          </div>
        </SectionCard>

        <div className="space-y-6">
          {selectedZone && overview ? (
            <>
              <SectionCard
                title={overview.zone.clientName || overview.zone.name}
                subtitle={`${overview.zone.name} • Plano ${overview.zone.plan || 'n/a'} • Nameservers: ${(overview.zone.nameServers || []).join(', ') || 'não informado'}`}
                actions={[
                  <button
                    key="apply-defaults"
                    type="button"
                    onClick={applyDefaults}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-60"
                  >
                    <Wand2 className="h-4 w-4" />
                    Aplicar baseline Zeus
                  </button>,
                ]}
              >
                <div className="grid gap-3 md:grid-cols-4">
                  <StatPill label="DNS" value={overview.dnsRecords.length} />
                  <StatPill label="E-mail rules" value={overview.emailRouting.rules.length} />
                  <StatPill label="Firewall" value={overview.firewall.accessRules.length} />
                  <StatPill label="WAF" value={overview.waf.rules.length} />
                </div>
              </SectionCard>

              <SectionCard title="Metadata do cliente" subtitle="Dados do cliente dentro do Zeus para governança e operação.">
                <form onSubmit={saveMetadata} className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">Nome do cliente</span>
                    <input
                      value={metadataForm.clientName}
                      onChange={(event) => setMetadataForm((current) => ({ ...current, clientName: event.target.value }))}
                      className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                    />
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={metadataForm.autoApplyDefaults}
                      onChange={(event) => setMetadataForm((current) => ({ ...current, autoApplyDefaults: event.target.checked }))}
                    />
                    Auto-aplicar baseline Zeus nesta zona
                  </label>
                  <label className="space-y-2 lg:col-span-2">
                    <span className="text-sm text-slate-300">Notas operacionais</span>
                    <textarea
                      value={metadataForm.notes}
                      onChange={(event) => setMetadataForm((current) => ({ ...current, notes: event.target.value }))}
                      rows={3}
                      className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                    />
                  </label>
                  <div className="lg:col-span-2">
                    <button className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">
                      <Save className="h-4 w-4" />
                      Salvar metadata
                    </button>
                  </div>
                </form>
              </SectionCard>

              <SectionCard title="Configurações da zona" subtitle="SSL, redirect HTTPS e postura de segurança principal.">
                <form onSubmit={saveZoneSettings} className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">SSL</span>
                    <select
                      value={settingsForm.sslMode}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, sslMode: event.target.value }))}
                      className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                    >
                      <option value="off">Off</option>
                      <option value="flexible">Flexible</option>
                      <option value="full">Full</option>
                      <option value="strict">Full (Strict)</option>
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">Security level</span>
                    <select
                      value={settingsForm.securityLevel}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, securityLevel: event.target.value }))}
                      className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                    >
                      <option value="essentially_off">Essentially off</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="under_attack">Under attack</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={settingsForm.alwaysUseHttps}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, alwaysUseHttps: event.target.checked }))}
                    />
                    Always Use HTTPS
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={settingsForm.automaticHttpsRewrites}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, automaticHttpsRewrites: event.target.checked }))}
                    />
                    Automatic HTTPS Rewrites
                  </label>
                  <div className="lg:col-span-2">
                    <button className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">
                      <Save className="h-4 w-4" />
                      Atualizar zona
                    </button>
                  </div>
                </form>
              </SectionCard>

              <div className="grid gap-6 2xl:grid-cols-2">
                <SectionCard title="DNS" subtitle="Gerencie registros publicados no edge Cloudflare.">
                  <form onSubmit={createDnsRecord} className="grid gap-3 md:grid-cols-2">
                    <select
                      value={dnsForm.type}
                      onChange={(event) => setDnsForm((current) => ({ ...current, type: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                    >
                      <option value="A">A</option>
                      <option value="AAAA">AAAA</option>
                      <option value="CNAME">CNAME</option>
                      <option value="MX">MX</option>
                      <option value="TXT">TXT</option>
                    </select>
                    <input
                      value={dnsForm.name}
                      onChange={(event) => setDnsForm((current) => ({ ...current, name: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                      placeholder="@"
                    />
                    <input
                      value={dnsForm.content}
                      onChange={(event) => setDnsForm((current) => ({ ...current, content: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white md:col-span-2"
                      placeholder="IP, hostname ou valor do TXT"
                    />
                    <input
                      value={dnsForm.priority}
                      onChange={(event) => setDnsForm((current) => ({ ...current, priority: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                      placeholder="Priority (MX)"
                    />
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={dnsForm.proxied}
                        onChange={(event) => setDnsForm((current) => ({ ...current, proxied: event.target.checked }))}
                      />
                      Proxy habilitado
                    </label>
                    <div className="md:col-span-2">
                      <button className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">
                        <Plus className="h-4 w-4" />
                        Criar registro
                      </button>
                    </div>
                  </form>
                  <div className="mt-4 space-y-2">
                    {overview.dnsRecords.map((record) => (
                      <div key={record.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm">
                        <div>
                          <p className="font-medium text-white">{record.type} • {record.name}</p>
                          <p className="text-slate-400">{record.content}</p>
                        </div>
                        <button onClick={() => removeDnsRecord(record.id)} className="text-rose-400 hover:text-rose-300">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Email Routing" subtitle="Regras de encaminhamento e registros exigidos pelo Cloudflare.">
                  <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                    <div className="mb-2 flex items-center gap-2 text-white">
                      <Mail className="h-4 w-4 text-cyan-300" />
                      <span className="font-medium">Registros exigidos</span>
                    </div>
                    <div className="space-y-2 text-sm text-slate-300">
                      {(overview.emailRouting.dnsRecords || []).map((record, index) => (
                        <p key={`${record.name}-${index}`}>{record.type} • {record.name} • {record.content}</p>
                      ))}
                    </div>
                  </div>
                  <form onSubmit={createEmailRule} className="grid gap-3">
                    <input
                      value={emailForm.name}
                      onChange={(event) => setEmailForm((current) => ({ ...current, name: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                      placeholder="Nome da regra"
                    />
                    <input
                      value={emailForm.source}
                      onChange={(event) => setEmailForm((current) => ({ ...current, source: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                      placeholder="contato@dominio.com ou *"
                    />
                    <input
                      value={emailForm.destinations}
                      onChange={(event) => setEmailForm((current) => ({ ...current, destinations: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                      placeholder="destino1@empresa.com, destino2@empresa.com"
                    />
                    <button className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">
                      <Plus className="h-4 w-4" />
                      Criar encaminhamento
                    </button>
                  </form>
                  <div className="mt-4 space-y-2">
                    {overview.emailRouting.rules.map((rule) => (
                      <div key={rule.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm">
                        <div>
                          <p className="font-medium text-white">{rule.name || rule.id}</p>
                          <p className="text-slate-400">{JSON.stringify(rule.matchers)} → {JSON.stringify(rule.actions)}</p>
                        </div>
                        <button onClick={() => removeEmailRule(rule.id)} className="text-rose-400 hover:text-rose-300">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Firewall" subtitle="Access Rules para IP, ASN, country e ranges.">
                  <form onSubmit={createFirewallRule} className="grid gap-3 md:grid-cols-2">
                    <select
                      value={firewallForm.target}
                      onChange={(event) => setFirewallForm((current) => ({ ...current, target: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                    >
                      <option value="ip">IP</option>
                      <option value="ip_range">IP Range</option>
                      <option value="asn">ASN</option>
                      <option value="country">Country</option>
                    </select>
                    <select
                      value={firewallForm.mode}
                      onChange={(event) => setFirewallForm((current) => ({ ...current, mode: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                    >
                      <option value="block">Block</option>
                      <option value="challenge">Challenge</option>
                      <option value="js_challenge">JS Challenge</option>
                      <option value="managed_challenge">Managed Challenge</option>
                      <option value="whitelist">Whitelist</option>
                    </select>
                    <input
                      value={firewallForm.value}
                      onChange={(event) => setFirewallForm((current) => ({ ...current, value: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                      placeholder="Valor"
                    />
                    <input
                      value={firewallForm.notes}
                      onChange={(event) => setFirewallForm((current) => ({ ...current, notes: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                      placeholder="Observação"
                    />
                    <div className="md:col-span-2">
                      <button className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">
                        <Plus className="h-4 w-4" />
                        Criar regra
                      </button>
                    </div>
                  </form>
                  <div className="mt-4 space-y-2">
                    {overview.firewall.accessRules.map((rule) => (
                      <div key={rule.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm">
                        <div>
                          <p className="font-medium text-white">{rule.mode} • {rule.configuration?.target}:{rule.configuration?.value}</p>
                          <p className="text-slate-400">{rule.notes || 'Sem observação'}</p>
                        </div>
                        <button onClick={() => removeFirewallRule(rule.id)} className="text-rose-400 hover:text-rose-300">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="WAF" subtitle="Custom rules zone-level usando Ruleset Engine do Cloudflare.">
                  <form onSubmit={createWafRule} className="grid gap-3">
                    <input
                      value={wafForm.description}
                      onChange={(event) => setWafForm((current) => ({ ...current, description: event.target.value }))}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                      placeholder="Descrição"
                    />
                    <textarea
                      value={wafForm.expression}
                      onChange={(event) => setWafForm((current) => ({ ...current, expression: event.target.value }))}
                      rows={3}
                      className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                      placeholder='(http.request.uri.path contains "/admin")'
                    />
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        value={wafForm.action}
                        onChange={(event) => setWafForm((current) => ({ ...current, action: event.target.value }))}
                        className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white"
                      >
                        <option value="block">Block</option>
                        <option value="managed_challenge">Managed Challenge</option>
                        <option value="challenge">Challenge</option>
                        <option value="skip">Skip</option>
                        <option value="log">Log</option>
                      </select>
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={wafForm.enabled}
                          onChange={(event) => setWafForm((current) => ({ ...current, enabled: event.target.checked }))}
                        />
                        Regra habilitada
                      </label>
                    </div>
                    <button className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">
                      <Plus className="h-4 w-4" />
                      Criar regra WAF
                    </button>
                  </form>
                  <div className="mt-4 space-y-2">
                    {overview.waf.rules.map((rule) => (
                      <div key={rule.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium text-white">{rule.description || rule.ref || rule.id}</p>
                            <p className="mt-1 text-slate-400">{rule.action}</p>
                            <code className="mt-2 block overflow-x-auto text-xs text-cyan-300">{rule.expression}</code>
                          </div>
                          <button
                            onClick={() => removeWafRule(rule.id, overview.waf.entrypointRulesetId)}
                            className="text-rose-400 hover:text-rose-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>
            </>
          ) : (
            <SectionCard title="Nenhuma zona selecionada" subtitle="Sincronize a conta Cloudflare e escolha uma zona para operar pelo Zeus.">
              <div className="flex items-center gap-3 text-slate-400">
                <Globe className="h-5 w-5" />
                <span>As zonas cadastradas aparecerão aqui com DNS, Email Routing, Firewall e WAF.</span>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {busy ? (
        <div className="fixed bottom-6 right-6 flex items-center gap-3 rounded-full border border-slate-700 bg-slate-950/95 px-4 py-3 text-sm text-slate-200 shadow-2xl">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Executando mudança no Cloudflare...
        </div>
      ) : null}
    </div>
  )
}

export default DomainsPanel
