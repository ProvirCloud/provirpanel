'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DEFAULT_FIREWALL_RULES = [
  {
    mode: 'managed_challenge',
    configuration: { target: 'country', value: 'RU' },
    notes: '[Zeus Default] Challenge trafego de origem sensivel'
  }
];

const DEFAULT_WAF_RULES = [
  {
    description: '[Zeus Default] Bloquear paths sensiveis',
    expression: '(http.request.uri.path contains "/.env") or (http.request.uri.path contains "/wp-config")',
    action: 'block',
    enabled: true
  },
  {
    description: '[Zeus Default] Challenge no admin',
    expression: '(http.request.uri.path contains "/admin") and not ip.src in {127.0.0.1}',
    action: 'managed_challenge',
    enabled: true
  }
];

const createDefaultState = () => ({
  credentials: {
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    accountEmail: process.env.CLOUDFLARE_ACCOUNT_EMAIL || ''
  },
  options: {
    autoSyncZones: true,
    managedByDefault: true
  },
  defaults: {
    sslMode: 'strict',
    alwaysUseHttps: true,
    automaticHttpsRewrites: true,
    securityLevel: 'medium',
    proxiedByDefault: true,
    emailRoutingEnabled: true,
    firewallRules: DEFAULT_FIREWALL_RULES,
    wafRules: DEFAULT_WAF_RULES
  },
  managedZones: []
});

class CloudflareManager {
  constructor(options = {}) {
    this.configPath = options.configPath || path.join(__dirname, '../../data/cloudflare-config.json');
    this.baseUrl = 'https://api.cloudflare.com/client/v4';
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    if (!fs.existsSync(this.configPath)) {
      this.writeState(createDefaultState());
    }
  }

  readState() {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return this.normalizeState(parsed);
    } catch (err) {
      const fallback = createDefaultState();
      this.writeState(fallback);
      return fallback;
    }
  }

  writeState(state) {
    fs.writeFileSync(this.configPath, JSON.stringify(this.normalizeState(state), null, 2));
  }

  normalizeState(input = {}) {
    const base = createDefaultState();
    return {
      credentials: {
        ...base.credentials,
        ...(input.credentials || {})
      },
      options: {
        ...base.options,
        ...(input.options || {})
      },
      defaults: {
        ...base.defaults,
        ...(input.defaults || {}),
        firewallRules: Array.isArray(input.defaults?.firewallRules)
          ? input.defaults.firewallRules
          : base.defaults.firewallRules,
        wafRules: Array.isArray(input.defaults?.wafRules)
          ? input.defaults.wafRules
          : base.defaults.wafRules
      },
      managedZones: Array.isArray(input.managedZones)
        ? input.managedZones.map((zone) => ({
            zoneId: zone.zoneId || '',
            name: zone.name || '',
            clientName: zone.clientName || '',
            autoApplyDefaults: zone.autoApplyDefaults !== false,
            notes: zone.notes || '',
            lastSyncedAt: zone.lastSyncedAt || null,
            status: zone.status || 'unknown'
          }))
        : []
    };
  }

  getPublicConfig() {
    const state = this.readState();
    return {
      credentials: {
        accountId: state.credentials.accountId,
        accountEmail: state.credentials.accountEmail,
        apiTokenConfigured: !!state.credentials.apiToken
      },
      options: state.options,
      defaults: state.defaults,
      managedZones: state.managedZones
    };
  }

  updateConfig(payload = {}) {
    const state = this.readState();
    const next = this.normalizeState({
      ...state,
      credentials: {
        ...state.credentials,
        ...(payload.credentials || {}),
        apiToken: payload.credentials?.apiToken !== undefined
          ? String(payload.credentials.apiToken || '').trim()
          : state.credentials.apiToken
      },
      options: {
        ...state.options,
        ...(payload.options || {})
      },
      defaults: {
        ...state.defaults,
        ...(payload.defaults || {})
      }
    });
    this.writeState(next);
    return this.getPublicConfig();
  }

  updateZoneMetadata(zoneId, payload = {}) {
    const state = this.readState();
    const index = state.managedZones.findIndex((zone) => zone.zoneId === zoneId);
    if (index >= 0) {
      state.managedZones[index] = {
        ...state.managedZones[index],
        ...payload,
        zoneId
      };
    } else {
      state.managedZones.push({
        zoneId,
        name: payload.name || '',
        clientName: payload.clientName || '',
        autoApplyDefaults: payload.autoApplyDefaults !== false,
        notes: payload.notes || '',
        lastSyncedAt: null,
        status: payload.status || 'unknown'
      });
    }
    this.writeState(state);
    return state.managedZones.find((zone) => zone.zoneId === zoneId);
  }

  hasCredentials() {
    const state = this.readState();
    return !!state.credentials.apiToken;
  }

  buildHeaders() {
    const state = this.readState();
    if (!state.credentials.apiToken) {
      throw new Error('Cloudflare API token nao configurado');
    }
    return {
      Authorization: `Bearer ${state.credentials.apiToken}`,
      'Content-Type': 'application/json'
    };
  }

  async request(method, targetPath, data, params) {
    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${targetPath}`,
        headers: this.buildHeaders(),
        data,
        params
      });
      if (response.data?.success === false) {
        const detail = response.data?.errors?.[0]?.message || 'Falha na API Cloudflare';
        throw new Error(detail);
      }
      return response.data?.result;
    } catch (err) {
      const apiMessage = err.response?.data?.errors?.[0]?.message;
      throw new Error(apiMessage || err.message || 'Falha na API Cloudflare');
    }
  }

  async listZones() {
    const state = this.readState();
    if (!this.hasCredentials()) {
      return state.managedZones;
    }
    const zones = await this.request('get', '/zones', null, { per_page: 100 });
    return (zones || []).map((zone) => {
      const local = state.managedZones.find((item) => item.zoneId === zone.id || item.name === zone.name);
      return {
        zoneId: zone.id,
        id: zone.id,
        name: zone.name,
        status: zone.status,
        paused: !!zone.paused,
        type: zone.type,
        plan: zone.plan?.name || null,
        nameServers: zone.name_servers || [],
        clientName: local?.clientName || '',
        autoApplyDefaults: local?.autoApplyDefaults !== false,
        notes: local?.notes || '',
        lastSyncedAt: local?.lastSyncedAt || null
      };
    });
  }

  async syncZones() {
    const state = this.readState();
    const zones = await this.listZones();
    state.managedZones = zones.map((zone) => ({
      zoneId: zone.zoneId,
      name: zone.name,
      clientName: zone.clientName || '',
      autoApplyDefaults: zone.autoApplyDefaults !== false,
      notes: zone.notes || '',
      lastSyncedAt: new Date().toISOString(),
      status: zone.status || 'unknown'
    }));
    this.writeState(state);
    return zones;
  }

  async getZoneOverview(zoneId) {
    const state = this.readState();
    const localZone = state.managedZones.find((item) => item.zoneId === zoneId) || null;
    const zone = await this.request('get', `/zones/${zoneId}`);

    const [dnsRecords, emailRoutingDns, emailRoutingRules, firewallAccessRules, wafRuleset, ssl, alwaysUseHttps, automaticHttpsRewrites, securityLevel] = await Promise.all([
      this.request('get', `/zones/${zoneId}/dns_records`, null, { per_page: 100 }),
      this.safeRequest('get', `/zones/${zoneId}/email/routing/dns`, []),
      this.safeRequest('get', `/zones/${zoneId}/email/routing/rules`, []),
      this.safeRequest('get', `/zones/${zoneId}/firewall/access_rules/rules`, []),
      this.safeRequest('get', `/zones/${zoneId}/rulesets/phases/http_request_firewall_custom/entrypoint`, null),
      this.safeRequest('get', `/zones/${zoneId}/settings/ssl`, null),
      this.safeRequest('get', `/zones/${zoneId}/settings/always_use_https`, null),
      this.safeRequest('get', `/zones/${zoneId}/settings/automatic_https_rewrites`, null),
      this.safeRequest('get', `/zones/${zoneId}/settings/security_level`, null)
    ]);

    return {
      zone: {
        zoneId: zone.id,
        name: zone.name,
        status: zone.status,
        paused: !!zone.paused,
        plan: zone.plan?.name || null,
        nameServers: zone.name_servers || [],
        clientName: localZone?.clientName || '',
        autoApplyDefaults: localZone?.autoApplyDefaults !== false,
        notes: localZone?.notes || ''
      },
      defaults: state.defaults,
      settings: {
        ssl: ssl?.value || null,
        alwaysUseHttps: alwaysUseHttps?.value || null,
        automaticHttpsRewrites: automaticHttpsRewrites?.value || null,
        securityLevel: securityLevel?.value || null
      },
      dnsRecords: dnsRecords || [],
      emailRouting: {
        dnsRecords: emailRoutingDns || [],
        rules: emailRoutingRules || []
      },
      firewall: {
        accessRules: firewallAccessRules?.result || firewallAccessRules || []
      },
      waf: {
        entrypointRulesetId: wafRuleset?.id || null,
        rules: wafRuleset?.rules || []
      }
    };
  }

  async safeRequest(method, targetPath, fallback) {
    try {
      return await this.request(method, targetPath);
    } catch (err) {
      return fallback;
    }
  }

  async updateZoneSetting(zoneId, settingId, value) {
    const result = await this.request('patch', `/zones/${zoneId}/settings/${settingId}`, { value });
    return result;
  }

  async updateDnsRecord(zoneId, recordId, payload) {
    return this.request('put', `/zones/${zoneId}/dns_records/${recordId}`, payload);
  }

  async createDnsRecord(zoneId, payload) {
    return this.request('post', `/zones/${zoneId}/dns_records`, payload);
  }

  async deleteDnsRecord(zoneId, recordId) {
    return this.request('delete', `/zones/${zoneId}/dns_records/${recordId}`);
  }

  async createEmailRoutingRule(zoneId, payload) {
    return this.request('post', `/zones/${zoneId}/email/routing/rules`, payload);
  }

  async deleteEmailRoutingRule(zoneId, ruleId) {
    return this.request('delete', `/zones/${zoneId}/email/routing/rules/${ruleId}`);
  }

  async createFirewallAccessRule(zoneId, payload) {
    return this.request('post', `/zones/${zoneId}/firewall/access_rules/rules`, payload);
  }

  async updateFirewallAccessRule(zoneId, ruleId, payload) {
    return this.request('patch', `/zones/${zoneId}/firewall/access_rules/rules/${ruleId}`, payload);
  }

  async deleteFirewallAccessRule(zoneId, ruleId) {
    return this.request('delete', `/zones/${zoneId}/firewall/access_rules/rules/${ruleId}`);
  }

  async getOrCreateWafEntrypointRuleset(zoneId) {
    const existing = await this.safeRequest('get', `/zones/${zoneId}/rulesets/phases/http_request_firewall_custom/entrypoint`, null);
    if (existing?.id) {
      return existing;
    }
    return this.request('post', `/zones/${zoneId}/rulesets`, {
      name: 'Zeus WAF Entrypoint',
      kind: 'zone',
      phase: 'http_request_firewall_custom'
    });
  }

  async createWafRule(zoneId, payload) {
    const ruleset = await this.getOrCreateWafEntrypointRuleset(zoneId);
    return this.request('post', `/zones/${zoneId}/rulesets/${ruleset.id}/rules`, payload);
  }

  async updateWafRule(zoneId, rulesetId, ruleId, payload) {
    return this.request('patch', `/zones/${zoneId}/rulesets/${rulesetId}/rules/${ruleId}`, payload);
  }

  async deleteWafRule(zoneId, rulesetId, ruleId) {
    return this.request('delete', `/zones/${zoneId}/rulesets/${rulesetId}/rules/${ruleId}`);
  }

  async applyDefaultsToZone(zoneId) {
    const state = this.readState();
    const defaults = state.defaults;

    await Promise.all([
      this.updateZoneSetting(zoneId, 'ssl', defaults.sslMode),
      this.updateZoneSetting(zoneId, 'always_use_https', defaults.alwaysUseHttps ? 'on' : 'off'),
      this.updateZoneSetting(zoneId, 'automatic_https_rewrites', defaults.automaticHttpsRewrites ? 'on' : 'off'),
      this.updateZoneSetting(zoneId, 'security_level', defaults.securityLevel)
    ]);

    const accessRules = await this.safeRequest('get', `/zones/${zoneId}/firewall/access_rules/rules`, []);
    for (const rule of defaults.firewallRules) {
      const exists = (accessRules?.result || accessRules || []).some((existing) =>
        existing.mode === rule.mode &&
        existing.configuration?.target === rule.configuration?.target &&
        existing.configuration?.value === rule.configuration?.value
      );
      if (!exists) {
        await this.createFirewallAccessRule(zoneId, rule);
      }
    }

    const ruleset = await this.getOrCreateWafEntrypointRuleset(zoneId);
    const existingRules = ruleset.rules || [];
    for (const rule of defaults.wafRules) {
      const exists = existingRules.some((existing) =>
        existing.action === rule.action &&
        existing.expression === rule.expression
      );
      if (!exists) {
        await this.createWafRule(zoneId, rule);
      }
    }

    this.updateZoneMetadata(zoneId, { lastSyncedAt: new Date().toISOString() });
    return this.getZoneOverview(zoneId);
  }
}

module.exports = CloudflareManager;
