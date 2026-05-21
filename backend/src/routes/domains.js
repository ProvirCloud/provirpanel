'use strict';

const express = require('express');
const CloudflareManager = require('../services/CloudflareManager');

const router = express.Router();
const cloudflare = new CloudflareManager();

const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

const normalizeDnsPayload = (body = {}) => ({
  type: body.type,
  name: body.name,
  content: body.content,
  ttl: Number(body.ttl) || 1,
  proxied: body.proxied === undefined ? true : !!body.proxied,
  priority: body.priority !== undefined && body.priority !== null && body.priority !== ''
    ? Number(body.priority)
    : undefined
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const config = cloudflare.getPublicConfig();
    const zones = await cloudflare.safeRequest('get', '/zones', config.managedZones);
    res.json({
      provider: 'cloudflare',
      configured: config.credentials.apiTokenConfigured,
      config,
      zones: Array.isArray(zones)
        ? zones.map((zone) => ({
            zoneId: zone.id || zone.zoneId,
            name: zone.name,
            status: zone.status || 'unknown'
          }))
        : config.managedZones
    });
  })
);

router.get('/cloudflare/config', (req, res) => {
  res.json(cloudflare.getPublicConfig());
});

router.put(
  '/cloudflare/config',
  asyncHandler(async (req, res) => {
    const config = cloudflare.updateConfig(req.body || {});
    res.json(config);
  })
);

router.get(
  '/cloudflare/zones',
  asyncHandler(async (req, res) => {
    const zones = await cloudflare.listZones();
    res.json({ zones });
  })
);

router.post(
  '/cloudflare/zones/sync',
  asyncHandler(async (req, res) => {
    const zones = await cloudflare.syncZones();
    res.json({ zones });
  })
);

router.patch(
  '/cloudflare/zones/:zoneId/metadata',
  asyncHandler(async (req, res) => {
    const zone = cloudflare.updateZoneMetadata(req.params.zoneId, req.body || {});
    res.json({ zone });
  })
);

router.get(
  '/cloudflare/zones/:zoneId/overview',
  asyncHandler(async (req, res) => {
    const overview = await cloudflare.getZoneOverview(req.params.zoneId);
    res.json(overview);
  })
);

router.post(
  '/cloudflare/zones/:zoneId/apply-defaults',
  asyncHandler(async (req, res) => {
    const overview = await cloudflare.applyDefaultsToZone(req.params.zoneId);
    res.json(overview);
  })
);

router.patch(
  '/cloudflare/zones/:zoneId/settings',
  asyncHandler(async (req, res) => {
    const { sslMode, alwaysUseHttps, automaticHttpsRewrites, securityLevel } = req.body || {};
    const updates = [];
    if (sslMode) {
      updates.push(cloudflare.updateZoneSetting(req.params.zoneId, 'ssl', sslMode));
    }
    if (alwaysUseHttps !== undefined) {
      updates.push(cloudflare.updateZoneSetting(req.params.zoneId, 'always_use_https', alwaysUseHttps ? 'on' : 'off'));
    }
    if (automaticHttpsRewrites !== undefined) {
      updates.push(
        cloudflare.updateZoneSetting(
          req.params.zoneId,
          'automatic_https_rewrites',
          automaticHttpsRewrites ? 'on' : 'off'
        )
      );
    }
    if (securityLevel) {
      updates.push(cloudflare.updateZoneSetting(req.params.zoneId, 'security_level', securityLevel));
    }
    await Promise.all(updates);
    const overview = await cloudflare.getZoneOverview(req.params.zoneId);
    res.json(overview);
  })
);

router.post(
  '/cloudflare/zones/:zoneId/dns-records',
  asyncHandler(async (req, res) => {
    const record = await cloudflare.createDnsRecord(req.params.zoneId, normalizeDnsPayload(req.body));
    res.json({ record });
  })
);

router.put(
  '/cloudflare/zones/:zoneId/dns-records/:recordId',
  asyncHandler(async (req, res) => {
    const record = await cloudflare.updateDnsRecord(
      req.params.zoneId,
      req.params.recordId,
      normalizeDnsPayload(req.body)
    );
    res.json({ record });
  })
);

router.delete(
  '/cloudflare/zones/:zoneId/dns-records/:recordId',
  asyncHandler(async (req, res) => {
    await cloudflare.deleteDnsRecord(req.params.zoneId, req.params.recordId);
    res.json({ status: 'removed' });
  })
);

router.post(
  '/cloudflare/zones/:zoneId/email-routing/rules',
  asyncHandler(async (req, res) => {
    const { name, source, destinations, enabled, priority } = req.body || {};
    const rule = await cloudflare.createEmailRoutingRule(req.params.zoneId, {
      name,
      enabled: enabled !== false,
      priority: priority !== undefined ? Number(priority) : undefined,
      matchers: source === '*'
        ? [{ type: 'all' }]
        : [{ type: 'literal', field: 'to', value: source }],
      actions: [{ type: 'forward', value: Array.isArray(destinations) ? destinations : [] }]
    });
    res.json({ rule });
  })
);

router.delete(
  '/cloudflare/zones/:zoneId/email-routing/rules/:ruleId',
  asyncHandler(async (req, res) => {
    await cloudflare.deleteEmailRoutingRule(req.params.zoneId, req.params.ruleId);
    res.json({ status: 'removed' });
  })
);

router.post(
  '/cloudflare/zones/:zoneId/firewall/access-rules',
  asyncHandler(async (req, res) => {
    const { target, value, mode, notes } = req.body || {};
    const rule = await cloudflare.createFirewallAccessRule(req.params.zoneId, {
      mode,
      notes,
      configuration: { target, value }
    });
    res.json({ rule });
  })
);

router.patch(
  '/cloudflare/zones/:zoneId/firewall/access-rules/:ruleId',
  asyncHandler(async (req, res) => {
    const { target, value, mode, notes } = req.body || {};
    const rule = await cloudflare.updateFirewallAccessRule(req.params.zoneId, req.params.ruleId, {
      mode,
      notes,
      configuration: { target, value }
    });
    res.json({ rule });
  })
);

router.delete(
  '/cloudflare/zones/:zoneId/firewall/access-rules/:ruleId',
  asyncHandler(async (req, res) => {
    await cloudflare.deleteFirewallAccessRule(req.params.zoneId, req.params.ruleId);
    res.json({ status: 'removed' });
  })
);

router.post(
  '/cloudflare/zones/:zoneId/waf/rules',
  asyncHandler(async (req, res) => {
    const { description, expression, action, enabled } = req.body || {};
    const rule = await cloudflare.createWafRule(req.params.zoneId, {
      description,
      expression,
      action,
      enabled: enabled !== false
    });
    res.json({ rule });
  })
);

router.patch(
  '/cloudflare/zones/:zoneId/waf/rules/:rulesetId/:ruleId',
  asyncHandler(async (req, res) => {
    const { description, expression, action, enabled } = req.body || {};
    const rule = await cloudflare.updateWafRule(req.params.zoneId, req.params.rulesetId, req.params.ruleId, {
      description,
      expression,
      action,
      enabled: enabled !== false
    });
    res.json({ rule });
  })
);

router.delete(
  '/cloudflare/zones/:zoneId/waf/rules/:rulesetId/:ruleId',
  asyncHandler(async (req, res) => {
    await cloudflare.deleteWafRule(req.params.zoneId, req.params.rulesetId, req.params.ruleId);
    res.json({ status: 'removed' });
  })
);

module.exports = router;
