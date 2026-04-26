'use strict';

const path = require('path');
const { StorageEnvironmentManager } = require('./StorageEnvironmentManager');
const StorageManager = require('./StorageManager');
const S3StorageProvider = require('./S3StorageProvider');

class UnsupportedStorageProviderError extends Error {
  constructor(provider) {
    super(`Storage provider "${provider}" is not enabled yet`);
    this.status = 501;
  }
}

const ensureLeadingSlash = (value = '/') => {
  const normalized = String(value || '/').trim() || '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

class MultiStorageService {
  constructor(options = {}) {
    this.environmentManager = options.environmentManager || new StorageEnvironmentManager();
  }

  getEnvironment(environmentId) {
    if (!environmentId) {
      const environments = this.environmentManager.listEnvironments();
      const fallback = environments.find((env) => env.provider === 'local') || environments[0];
      if (!fallback) {
        throw new Error('No storage environments configured');
      }
      return fallback;
    }
    return this.environmentManager.getEnvironment(environmentId);
  }

  assertPermission(environmentId, role, action) {
    if (!this.environmentManager.canAccess(environmentId, role, action)) {
      const err = new Error(`Role ${role} cannot ${action} in this storage environment`);
      err.status = 403;
      throw err;
    }
  }

  getProvider(environment) {
    if (environment.provider === 'local') {
      return new StorageManager({
        basePath: environment.config?.basePath || process.env.CLOUDPAINEL_PROJECTS_DIR
      });
    }
    if (environment.provider === 's3') {
      return new S3StorageProvider(environment.config || {});
    }
    throw new UnsupportedStorageProviderError(environment.provider);
  }

  getProviderByDraft(payload = {}) {
    if (payload.provider === 'local') {
      return new StorageManager({
        basePath: payload.config?.basePath || process.env.CLOUDPAINEL_PROJECTS_DIR
      });
    }
    if (payload.provider === 's3') {
      return new S3StorageProvider(payload.config || {});
    }
    return null;
  }

  async listFiles(environmentId, targetPath = '/') {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    return provider.listFiles(targetPath);
  }

  async listTree(environmentId) {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    const projects = await provider.listProjects();
    return projects.map((project) => ({ name: project.name, path: project.path }));
  }

  getStats(environmentId) {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    return provider.getStorageStats();
  }

  async uploadFiles(environmentId, files, destination = '/') {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    return Promise.all((files || []).map((file) => provider.uploadFile(file, destination)));
  }

  async createEntry(environmentId, targetPath, type) {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    if (type === 'folder') {
      await provider.createFolder(targetPath);
      return { status: 'created' };
    }
    await provider.createFile(targetPath, '');
    return { status: 'created' };
  }

  async deleteEntry(environmentId, targetPath) {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    await provider.deleteFile(targetPath);
    return { status: 'deleted' };
  }

  async readTextFile(environmentId, targetPath) {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    return provider.readFile(targetPath);
  }

  async writeTextFile(environmentId, targetPath, content) {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    await provider.writeFile(targetPath, content);
    return { status: 'saved' };
  }

  async moveEntry(environmentId, fromPath, toPath) {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    await provider.moveFile(fromPath, toPath);
    return { status: 'moved' };
  }

  async extractArchive(environmentId, archivePath, destinationPath) {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    return provider.extractArchive(archivePath, destinationPath);
  }

  async readBinaryFile(environmentId, targetPath) {
    const environment = this.getEnvironment(environmentId);
    const provider = this.getProvider(environment);
    return provider.readBinaryFile(targetPath);
  }

  async copyBetweenEnvironments({ sourceEnvironmentId, sourcePath, targetEnvironmentId, targetPath }) {
    const sourceEnvironment = this.getEnvironment(sourceEnvironmentId);
    const targetEnvironment = this.getEnvironment(targetEnvironmentId);
    const sourceProvider = this.getProvider(sourceEnvironment);
    const targetProvider = this.getProvider(targetEnvironment);

    const sourceFile = await sourceProvider.readBinaryFile(sourcePath);
    const fileName = sourceFile.fileName || path.posix.basename(sourcePath);
    const finalTargetPath = targetPath
      ? ensureLeadingSlash(targetPath)
      : ensureLeadingSlash(path.posix.join('/', fileName));
    await targetProvider.putBuffer(finalTargetPath, sourceFile.buffer, {
      contentType: sourceFile.contentType
    });

    return {
      status: 'copied',
      from: { environmentId: sourceEnvironment.id, path: sourcePath },
      to: { environmentId: targetEnvironment.id, path: finalTargetPath }
    };
  }

  async validateEnvironmentConfig(payload = {}) {
    const provider = this.getProviderByDraft(payload);
    if (!provider || typeof provider.validateAccess !== 'function') {
      return;
    }
    await provider.validateAccess();
  }
}

module.exports = {
  MultiStorageService,
  UnsupportedStorageProviderError
};
