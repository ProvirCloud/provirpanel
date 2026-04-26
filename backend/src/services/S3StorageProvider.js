'use strict';

const path = require('path');
const {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  HeadBucketCommand
} = require('@aws-sdk/client-s3');

const IMAGE_REGEX = /\.(png|jpe?g|gif|webp|svg)$/i;

const normalizeStoragePath = (targetPath = '/', options = {}) => {
  const input = String(targetPath || '/').replace(/\\/g, '/').trim() || '/';
  const preserveTrailingSlash = options.preserveTrailingSlash === true;
  const segments = input.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) {
    throw new Error('Invalid path');
  }
  const normalized = `/${segments.join('/')}`.replace(/\/+/g, '/');
  if (normalized === '/') {
    return '/';
  }
  if (preserveTrailingSlash && input.endsWith('/')) {
    return `${normalized}/`;
  }
  return normalized;
};

const joinKey = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

const stripTrailingSlash = (value = '') => value.replace(/\/+$/g, '');

const encodeCopySource = (bucket, key) => `${bucket}/${key.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;

class S3StorageProvider {
  constructor(config = {}) {
    this.bucket = String(config.bucket || '').trim();
    this.region = String(config.region || '').trim();
    this.rootPath = stripTrailingSlash(String(config.rootPath || '').trim().replace(/^\/+/g, ''));
    if (!this.bucket || !this.region || !config.accessKeyId || !config.secretAccessKey) {
      throw new Error('S3 bucket, region, accessKeyId and secretAccessKey are required');
    }

    this.client = new S3Client({
      region: this.region,
      endpoint: config.endpoint ? String(config.endpoint).trim() : undefined,
      forcePathStyle: config.forcePathStyle === true || String(config.forcePathStyle).toLowerCase() === 'true',
      credentials: {
        accessKeyId: String(config.accessKeyId),
        secretAccessKey: String(config.secretAccessKey)
      }
    });
  }

  normalizePath(targetPath = '/', options = {}) {
    return normalizeStoragePath(targetPath, options);
  }

  toRelativePath(key) {
    if (this.rootPath) {
      if (key === this.rootPath) return '/';
      if (!key.startsWith(`${this.rootPath}/`)) return null;
      key = key.slice(this.rootPath.length + 1);
    }
    const cleaned = String(key || '').replace(/^\/+/g, '');
    return cleaned ? `/${cleaned}` : '/';
  }

  toKey(targetPath = '/', options = {}) {
    const normalized = this.normalizePath(targetPath, options);
    const relative = normalized === '/' ? '' : normalized.slice(1);
    let key = joinKey(this.rootPath, relative);
    if (options.directory === true && key && !key.endsWith('/')) {
      key = `${key}/`;
    }
    return key;
  }

  async listFiles(targetPath = '/') {
    const normalized = this.normalizePath(targetPath);
    const prefix = this.toKey(normalized, { directory: normalized !== '/' });
    const response = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix || undefined,
      Delimiter: '/'
    }));

    const directories = (response.CommonPrefixes || [])
      .map((entry) => entry.Prefix)
      .filter(Boolean)
      .map((prefixKey) => {
        const relativePath = this.toRelativePath(stripTrailingSlash(prefixKey));
        if (!relativePath || relativePath === normalized) {
          return null;
        }
        return {
          name: path.posix.basename(relativePath),
          path: relativePath,
          isDir: true,
          isImage: false,
          size: 0,
          createdAt: null,
          modifiedAt: null
        };
      })
      .filter(Boolean);

    const files = (response.Contents || [])
      .filter((entry) => entry.Key && entry.Key !== prefix)
      .map((entry) => {
        const relativePath = this.toRelativePath(entry.Key);
        if (!relativePath || relativePath === normalized) {
          return null;
        }
        const name = path.posix.basename(relativePath);
        return {
          name,
          path: relativePath,
          isDir: false,
          isImage: IMAGE_REGEX.test(name),
          size: entry.Size || 0,
          createdAt: entry.LastModified ? new Date(entry.LastModified).toISOString() : null,
          modifiedAt: entry.LastModified ? new Date(entry.LastModified).toISOString() : null
        };
      })
      .filter(Boolean);

    return [...directories, ...files].sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async listProjects() {
    const rootItems = await this.listFiles('/');
    const directories = rootItems.filter((item) => item.isDir);
    if (directories.length > 0) {
      return directories.map((item) => ({
        name: item.name,
        path: item.path,
        size: 0,
        createdAt: item.createdAt || new Date().toISOString()
      }));
    }
    return [{ name: 'root', path: '/', size: 0, createdAt: new Date().toISOString() }];
  }

  async getStorageStats() {
    let used = 0;
    let continuationToken;
    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: this.rootPath || undefined,
        ContinuationToken: continuationToken
      }));
      for (const entry of response.Contents || []) {
        used += Number(entry.Size || 0);
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return { used, total: 0 };
  }

  async uploadFile(file, destination = '/') {
    if (!file) {
      throw new Error('File is required');
    }
    const normalizedDestination = this.normalizePath(destination);
    const targetPath = normalizeStoragePath(path.posix.join(normalizedDestination, file.originalname));
    await this.putBuffer(targetPath, file.buffer, { contentType: file.mimetype });
    return { path: targetPath };
  }

  async createFolder(targetPath) {
    const folderPath = this.normalizePath(targetPath, { preserveTrailingSlash: true });
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.toKey(folderPath, { directory: true }),
      Body: ''
    }));
    return true;
  }

  async createFile(targetPath, content = '') {
    const normalized = this.normalizePath(targetPath);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.toKey(normalized),
      Body: Buffer.from(String(content), 'utf8'),
      ContentType: 'text/plain; charset=utf-8'
    }));
    return true;
  }

  async deleteFile(targetPath) {
    const normalized = this.normalizePath(targetPath);
    const objectKey = this.toKey(normalized);
    const prefixKey = this.toKey(normalized, { directory: normalized !== '/' });
    const response = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefixKey || undefined
    }));

    if ((response.Contents || []).length > 0 && normalized !== '/') {
      await this.deleteByKeys((response.Contents || []).map((entry) => entry.Key).filter(Boolean));
      return true;
    }

    if (objectKey) {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey
      }));
    }
    return true;
  }

  async readFile(targetPath) {
    const data = await this.readBinaryFile(targetPath);
    return data.buffer.toString('utf8');
  }

  async readBinaryFile(targetPath) {
    const normalized = this.normalizePath(targetPath);
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.toKey(normalized)
    }));
    const bytes = await response.Body.transformToByteArray();
    return {
      buffer: Buffer.from(bytes),
      contentType: response.ContentType || 'application/octet-stream',
      fileName: path.posix.basename(normalized)
    };
  }

  async writeFile(targetPath, content) {
    const normalized = this.normalizePath(targetPath);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.toKey(normalized),
      Body: Buffer.from(String(content), 'utf8'),
      ContentType: 'text/plain; charset=utf-8'
    }));
    return true;
  }

  async putBuffer(targetPath, buffer, options = {}) {
    const normalized = this.normalizePath(targetPath);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.toKey(normalized),
      Body: buffer,
      ContentType: options.contentType || 'application/octet-stream'
    }));
    return true;
  }

  async moveFile(fromPath, toPath) {
    const normalizedFrom = this.normalizePath(fromPath);
    const normalizedTo = this.normalizePath(toPath);
    const sourcePrefix = this.toKey(normalizedFrom, { directory: normalizedFrom !== '/' });
    const sourceObjectKey = this.toKey(normalizedFrom);
    const directoryProbe = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: sourcePrefix || undefined
    }));

    if ((directoryProbe.Contents || []).length > 0 && normalizedFrom !== '/') {
      for (const entry of directoryProbe.Contents || []) {
        const relativeChild = entry.Key.slice(sourcePrefix.length);
        const targetKey = joinKey(this.toKey(normalizedTo, { directory: true }), relativeChild);
        await this.copyKey(entry.Key, targetKey);
      }
      await this.deleteByKeys((directoryProbe.Contents || []).map((entry) => entry.Key));
      return true;
    }

    await this.copyKey(sourceObjectKey, this.toKey(normalizedTo));
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: sourceObjectKey
    }));
    return true;
  }

  async extractArchive() {
    throw new Error('Archive extraction is not supported for S3 environments');
  }

  async validateAccess() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: this.rootPath || undefined,
      MaxKeys: 1
    }));
  }

  async copyKey(sourceKey, targetKey) {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      Key: targetKey,
      CopySource: encodeCopySource(this.bucket, sourceKey)
    }));
  }

  async deleteByKeys(keys = []) {
    const filtered = keys.filter(Boolean);
    while (filtered.length > 0) {
      const chunk = filtered.splice(0, 1000).map((Key) => ({ Key }));
      await this.client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: chunk, Quiet: true }
      }));
    }
  }
}

module.exports = S3StorageProvider;
