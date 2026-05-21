'use strict';

/**
 * ComposeParser — converte docker-compose.yml em estrutura de Stack.
 */

const crypto = require('crypto');

const generateId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
};

const ROLE_HINTS = {
  'entry-point': ['nginx', 'traefik', 'haproxy', 'caddy', 'envoy', 'gateway', 'proxy', 'ingress'],
  'database': ['postgres', 'mysql', 'mariadb', 'mongo', 'mongodb', 'sqlserver', 'cockroach'],
  'cache': ['redis', 'memcached', 'valkey', 'dragonfly'],
  'queue': ['rabbitmq', 'kafka', 'nats', 'activemq', 'celery', 'worker', 'bull'],
  'monitor': ['prometheus', 'grafana', 'loki', 'jaeger', 'zabbix', 'datadog'],
  'storage': ['minio', 's3', 'seaweedfs', 'ceph'],
};

function inferRole(serviceName, image) {
  const fingerprint = `${serviceName} ${image}`.toLowerCase();
  for (const [role, hints] of Object.entries(ROLE_HINTS)) {
    if (hints.some((h) => fingerprint.includes(h))) return role;
  }
  return 'runtime';
}

function parseEnvValue(val) {
  if (val === undefined || val === null) return '';
  return String(val);
}

function isSecret(key) {
  return /password|secret|token|key|auth|private/i.test(key);
}

function parseEnvList(env) {
  if (!env) return [];
  if (Array.isArray(env)) {
    return env.map((entry) => {
      if (typeof entry === 'string') {
        const idx = entry.indexOf('=');
        if (idx < 0) return { key: entry, value: '', secret: isSecret(entry) };
        const key = entry.slice(0, idx);
        const value = entry.slice(idx + 1);
        return { key, value: parseEnvValue(value), secret: isSecret(key) };
      }
      if (typeof entry === 'object' && entry.key) {
        return { key: entry.key, value: parseEnvValue(entry.value), secret: entry.secret || isSecret(entry.key) };
      }
      return null;
    }).filter(Boolean);
  }
  if (typeof env === 'object') {
    return Object.entries(env).map(([key, value]) => ({
      key, value: parseEnvValue(value), secret: isSecret(key)
    }));
  }
  return [];
}

function parsePorts(ports) {
  if (!ports) return [];
  return ports.map((p) => {
    if (typeof p === 'string') {
      const parts = p.replace(/\/\w+$/, '').split(':');
      if (parts.length >= 2) {
        return { host: Number(parts[0]) || 0, container: Number(parts[1]) || 0 };
      }
      return { host: Number(parts[0]) || 0, container: Number(parts[0]) || 0 };
    }
    if (typeof p === 'object') {
      return { host: Number(p.published || p.host || 0), container: Number(p.target || p.container || 0) };
    }
    if (typeof p === 'number') {
      return { host: p, container: p };
    }
    return null;
  }).filter(Boolean);
}

function parseVolumes(volumes) {
  if (!volumes) return [];
  return volumes.map((v) => {
    if (typeof v === 'string') {
      const parts = v.split(':');
      if (parts.length >= 2) {
        return { host: parts[0], container: parts[1] };
      }
      return { host: parts[0], container: parts[0] };
    }
    if (typeof v === 'object') {
      return { host: v.source || '', container: v.target || '' };
    }
    return null;
  }).filter(Boolean);
}

function parseCommand(cmd) {
  if (!cmd) return [];
  if (Array.isArray(cmd)) return cmd.map(String);
  if (typeof cmd === 'string') return cmd.split(/\s+/);
  return [];
}

/**
 * Simple YAML-like parser for docker-compose.
 * Handles the most common patterns without requiring a full YAML library.
 */
function simpleYamlParse(content) {
  // Try JSON first (some compose files are JSON)
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* not JSON */ }

  // Basic YAML parsing for docker-compose structure
  const result = { version: '', services: {}, networks: {}, volumes: {} };
  const lines = content.split('\n');
  let currentSection = null; // 'services' | 'networks' | 'volumes'
  let currentService = null;
  let currentKey = null;
  let currentIndent = 0;
  let inArray = false;
  let arrayKey = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimEnd();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = raw.length - raw.trimStart().length;
    const line = trimmed.trim();

    // Top-level keys
    if (indent === 0 && line.endsWith(':')) {
      const key = line.slice(0, -1).trim();
      if (key === 'services') { currentSection = 'services'; currentService = null; }
      else if (key === 'networks') { currentSection = 'networks'; currentService = null; }
      else if (key === 'volumes') { currentSection = 'volumes'; currentService = null; }
      else if (key === 'version') { currentSection = null; }
      else { currentSection = null; }
      inArray = false;
      continue;
    }

    // Version line
    if (line.startsWith('version:')) {
      result.version = line.split(':').slice(1).join(':').trim().replace(/['"]/g, '');
      continue;
    }

    if (currentSection === 'services') {
      // Service name (indent 2)
      if (indent === 2 && line.endsWith(':') && !line.startsWith('-')) {
        currentService = line.slice(0, -1).trim();
        result.services[currentService] = {};
        currentKey = null;
        inArray = false;
        continue;
      }

      if (!currentService) continue;
      const svc = result.services[currentService];

      // Service property (indent 4)
      if (indent === 4 && line.includes(':') && !line.startsWith('-')) {
        const colonIdx = line.indexOf(':');
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        currentKey = key;
        inArray = false;

        if (val && !val.startsWith('[') && !val.startsWith('{')) {
          // Simple value
          svc[key] = val.replace(/^['"]|['"]$/g, '');
        } else if (val.startsWith('[')) {
          // Inline array
          try {
            svc[key] = JSON.parse(val);
          } catch {
            svc[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
          }
        } else {
          // Will be filled by subsequent lines
          if (!svc[key]) svc[key] = [];
          inArray = true;
          arrayKey = key;
        }
        continue;
      }

      // Array items (indent 6, starts with -)
      if (indent >= 6 && line.startsWith('-') && currentKey) {
        const val = line.slice(1).trim().replace(/^['"]|['"]$/g, '');
        if (!Array.isArray(svc[currentKey])) svc[currentKey] = [];
        svc[currentKey].push(val);
        continue;
      }

      // Nested object values (indent 6, key: value for environment as object)
      if (indent === 6 && line.includes(':') && !line.startsWith('-') && currentKey) {
        if (!svc[currentKey] || Array.isArray(svc[currentKey])) {
          if (Array.isArray(svc[currentKey]) && svc[currentKey].length === 0) {
            svc[currentKey] = {};
          }
        }
        if (typeof svc[currentKey] === 'object' && !Array.isArray(svc[currentKey])) {
          const colonIdx = line.indexOf(':');
          const k = line.slice(0, colonIdx).trim();
          const v = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          svc[currentKey][k] = v;
        }
        continue;
      }
    }

    if (currentSection === 'volumes' && indent === 2 && line.endsWith(':')) {
      const volName = line.slice(0, -1).trim();
      result.volumes[volName] = {};
      continue;
    }

    if (currentSection === 'networks' && indent === 2 && line.endsWith(':')) {
      const netName = line.slice(0, -1).trim();
      result.networks[netName] = {};
      continue;
    }
  }

  return result;
}

class ComposeParser {
  /**
   * Parse docker-compose.yml content into a stack-compatible structure.
   * @param {string} content - Raw YAML/JSON content
   * @param {object} options - { name, client, environment }
   * @returns {object} Stack-like object with services array
   */
  parse(content, options = {}) {
    const parsed = simpleYamlParse(content);
    const services = parsed.services || {};
    const networkName = Object.keys(parsed.networks || {})[0] || '';

    const stackServices = [];
    const serviceNameToId = {};

    // First pass: create services
    for (const [name, config] of Object.entries(services)) {
      const id = generateId();
      serviceNameToId[name] = id;

      const image = (config.image || '').split(':');
      const imageName = image[0] || name;
      const imageTag = image[1] || 'latest';

      stackServices.push({
        id,
        name,
        role: inferRole(name, imageName),
        image: imageName,
        tag: imageTag,
        ports: parsePorts(config.ports),
        volumes: parseVolumes(config.volumes),
        env: parseEnvList(config.environment),
        command: parseCommand(config.command || config.entrypoint),
        dependencies: [],
        containerId: null,
        status: 'pending',
        position: { x: 0, y: 0 },
      });
    }

    // Second pass: resolve depends_on
    for (const [name, config] of Object.entries(services)) {
      const svc = stackServices.find((s) => s.name === name);
      if (!svc) continue;

      let deps = config.depends_on;
      if (Array.isArray(deps)) {
        svc.dependencies = deps.map((d) => serviceNameToId[d]).filter(Boolean);
      } else if (typeof deps === 'object' && deps) {
        svc.dependencies = Object.keys(deps).map((d) => serviceNameToId[d]).filter(Boolean);
      }
    }

    return {
      name: options.name || 'Imported Stack',
      description: options.description || `Importado de docker-compose (${Object.keys(services).length} serviços)`,
      client: options.client || '',
      environment: options.environment || 'production',
      network: networkName || undefined,
      services: stackServices,
    };
  }
}

module.exports = ComposeParser;
