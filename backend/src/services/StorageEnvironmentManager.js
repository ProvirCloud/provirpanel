'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_PROVIDER_CATALOG = {
  local: {
    id: 'local',
    label: 'Storage Local',
    status: 'active',
    capabilities: ['list', 'read', 'write', 'delete', 'create', 'move', 'upload', 'download', 'copy', 'preview'],
    configSchema: [
      { key: 'basePath', label: 'Base Path', type: 'text', required: false, secret: false }
    ]
  },
  s3: {
    id: 's3',
    label: 'AWS S3 / S3 Compatible',
    status: 'active',
    capabilities: ['list', 'read', 'write', 'delete', 'create', 'move', 'upload', 'download', 'copy', 'preview'],
    configSchema: [
      { key: 'bucket', label: 'Bucket', type: 'text', required: true, secret: false },
      { key: 'region', label: 'Region', type: 'text', required: true, secret: false },
      { key: 'accessKeyId', label: 'Access Key ID', type: 'text', required: true, secret: true },
      { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true, secret: true },
      { key: 'endpoint', label: 'Endpoint', type: 'text', required: false, secret: false },
      { key: 'forcePathStyle', label: 'Force Path Style', type: 'boolean', required: false, secret: false },
      { key: 'rootPath', label: 'Root Path', type: 'text', required: false, secret: false }
    ]
  },
  onedrive: {
    id: 'onedrive',
    label: 'OneDrive',
    status: 'planned',
    capabilities: ['list', 'read', 'write', 'delete', 'create', 'move', 'upload', 'download', 'copy', 'preview'],
    configSchema: [
      { key: 'accessToken', label: 'Graph Access Token', type: 'password', required: true, secret: true },
      { key: 'driveId', label: 'Drive ID', type: 'text', required: false, secret: false },
      { key: 'rootPath', label: 'Root Path', type: 'text', required: false, secret: false }
    ]
  },
  sharepoint: {
    id: 'sharepoint',
    label: 'SharePoint',
    status: 'planned',
    capabilities: ['list', 'read', 'write', 'delete', 'create', 'move', 'upload', 'download', 'copy', 'preview'],
    configSchema: [
      { key: 'accessToken', label: 'Graph Access Token', type: 'password', required: true, secret: true },
      { key: 'siteId', label: 'Site ID', type: 'text', required: true, secret: false },
      { key: 'driveId', label: 'Document Library Drive ID', type: 'text', required: false, secret: false },
      { key: 'rootPath', label: 'Root Path', type: 'text', required: false, secret: false }
    ]
  },
  azureBlob: {
    id: 'azureBlob',
    label: 'Azure Blob Storage',
    status: 'planned',
    capabilities: ['list', 'read', 'write', 'delete', 'create', 'move', 'upload', 'download', 'copy', 'preview'],
    configSchema: [
      { key: 'accountName', label: 'Account Name', type: 'text', required: true, secret: false },
      { key: 'container', label: 'Container', type: 'text', required: true, secret: false },
      { key: 'sasToken', label: 'SAS Token', type: 'password', required: false, secret: true },
      { key: 'connectionString', label: 'Connection String', type: 'password', required: false, secret: true }
    ]
  },
  ftp: {
    id: 'ftp',
    label: 'FTP / SFTP',
    status: 'planned',
    capabilities: ['list', 'read', 'write', 'delete', 'create', 'move', 'upload', 'download', 'copy'],
    configSchema: [
      { key: 'protocol', label: 'Protocol', type: 'select', required: true, secret: false, options: ['ftp', 'ftps', 'sftp'] },
      { key: 'host', label: 'Host', type: 'text', required: true, secret: false },
      { key: 'port', label: 'Port', type: 'number', required: false, secret: false },
      { key: 'username', label: 'Username', type: 'text', required: true, secret: false },
      { key: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { key: 'rootPath', label: 'Root Path', type: 'text', required: false, secret: false }
    ]
  }
};

const DEFAULT_PERMISSIONS = {
  admin: ['list', 'read', 'write', 'delete', 'create', 'move', 'upload', 'download', 'copy', 'preview'],
  dev: ['list', 'read', 'write', 'create', 'move', 'upload', 'download', 'copy', 'preview'],
  viewer: ['list', 'read', 'download', 'preview']
};

const generateId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}`);

const deepClone = (value) => JSON.parse(JSON.stringify(value));

class StorageEnvironmentManager {
  constructor(options = {}) {
    this.registryPath = options.registryPath || path.join(__dirname, '../../data/storage-environments.json');
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
    if (!fs.existsSync(this.registryPath)) {
      this.writeRegistry(this.createDefaultRegistry());
    } else {
      this.ensureDefaults();
    }
  }

  createDefaultRegistry() {
    return {
      environments: [
        {
          id: 'local-default',
          name: 'Servidor Local',
          provider: 'local',
          isActive: true,
          config: {},
          permissions: deepClone(DEFAULT_PERMISSIONS),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };
  }

  ensureDefaults() {
    const registry = this.readRegistry();
    if (!registry.environments.some((env) => env.provider === 'local')) {
      registry.environments.unshift(this.createDefaultRegistry().environments[0]);
      this.writeRegistry(registry);
    }
  }

  readRegistry() {
    try {
      const raw = fs.readFileSync(this.registryPath, 'utf8');
      const parsed = JSON.parse(raw);
      const environments = Array.isArray(parsed.environments) ? parsed.environments : [];
      return {
        environments: environments.map((env) => this.normalizeEnvironment(env))
      };
    } catch (err) {
      const fallback = this.createDefaultRegistry();
      this.writeRegistry(fallback);
      return fallback;
    }
  }

  writeRegistry(registry) {
    fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2));
  }

  normalizeEnvironment(env = {}) {
    const provider = STORAGE_PROVIDER_CATALOG[env.provider] ? env.provider : 'local';
    return {
      id: env.id || generateId(),
      name: env.name || 'Storage',
      provider,
      isActive: env.isActive !== false,
      config: typeof env.config === 'object' && env.config ? env.config : {},
      permissions: this.normalizePermissions(env.permissions),
      createdAt: env.createdAt || new Date().toISOString(),
      updatedAt: env.updatedAt || new Date().toISOString()
    };
  }

  normalizePermissions(permissions = {}) {
    return {
      admin: Array.isArray(permissions.admin) ? permissions.admin : deepClone(DEFAULT_PERMISSIONS.admin),
      dev: Array.isArray(permissions.dev) ? permissions.dev : deepClone(DEFAULT_PERMISSIONS.dev),
      viewer: Array.isArray(permissions.viewer) ? permissions.viewer : deepClone(DEFAULT_PERMISSIONS.viewer)
    };
  }

  listCatalog() {
    return Object.values(STORAGE_PROVIDER_CATALOG);
  }

  listEnvironments() {
    return this.readRegistry().environments;
  }

  getEnvironment(environmentId) {
    const registry = this.readRegistry();
    const environment = registry.environments.find((env) => env.id === environmentId);
    if (!environment) {
      throw new Error('Storage environment not found');
    }
    return environment;
  }

  validateEnvironmentPayload(payload = {}) {
    const providerMeta = STORAGE_PROVIDER_CATALOG[payload.provider];
    if (!providerMeta) {
      throw new Error('Unsupported storage provider');
    }
    if (!payload.name || !String(payload.name).trim()) {
      throw new Error('Storage environment name is required');
    }

    const config = payload.config && typeof payload.config === 'object' ? payload.config : {};
    const missing = providerMeta.configSchema
      .filter((field) => field.required)
      .filter((field) => {
        const value = config[field.key];
        return value === undefined || value === null || String(value).trim() === '';
      });

    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.map((field) => field.key).join(', ')}`);
    }
  }

  createEnvironment(payload = {}) {
    this.validateEnvironmentPayload(payload);
    const registry = this.readRegistry();
    const environment = this.normalizeEnvironment({
      id: generateId(),
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    registry.environments.push(environment);
    this.writeRegistry(registry);
    return environment;
  }

  updateEnvironment(environmentId, payload = {}) {
    const registry = this.readRegistry();
    const index = registry.environments.findIndex((env) => env.id === environmentId);
    if (index === -1) {
      throw new Error('Storage environment not found');
    }

    const next = {
      ...registry.environments[index],
      ...payload,
      config: payload.config !== undefined ? payload.config : registry.environments[index].config,
      permissions: payload.permissions !== undefined
        ? this.normalizePermissions(payload.permissions)
        : registry.environments[index].permissions,
      updatedAt: new Date().toISOString()
    };
    this.validateEnvironmentPayload(next);
    registry.environments[index] = this.normalizeEnvironment(next);
    this.writeRegistry(registry);
    return registry.environments[index];
  }

  deleteEnvironment(environmentId) {
    const registry = this.readRegistry();
    const environment = registry.environments.find((env) => env.id === environmentId);
    if (!environment) {
      throw new Error('Storage environment not found');
    }
    if (environment.id === 'local-default') {
      throw new Error('Default local storage cannot be removed');
    }
    registry.environments = registry.environments.filter((env) => env.id !== environmentId);
    this.writeRegistry(registry);
    return true;
  }

  canAccess(environmentId, role, action) {
    const environment = this.getEnvironment(environmentId);
    const normalizedRole = String(role || 'viewer').toLowerCase();
    const allowed = environment.permissions[normalizedRole] || [];
    return allowed.includes(action);
  }

  getEnvironmentView(role) {
    const normalizedRole = String(role || 'viewer').toLowerCase();
    return {
      catalog: this.listCatalog(),
      environments: this.listEnvironments().map((environment) => ({
        ...environment,
        availableActions: environment.permissions[normalizedRole] || []
      }))
    };
  }
}

module.exports = {
  StorageEnvironmentManager,
  STORAGE_PROVIDER_CATALOG,
  DEFAULT_PERMISSIONS
};
