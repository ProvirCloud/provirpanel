'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile, execSync } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const ARCHIVE_SUFFIXES = ['.tar.gz', '.tgz', '.tar', '.zip'];

class StorageManager {
  constructor(options = {}) {
    const envPath = process.env.CLOUDPAINEL_PROJECTS_DIR;
    const defaultPath = options.basePath || envPath || path.join(process.cwd(), 'backend/data/projects');
    this.basePath = defaultPath;
    try {
      fs.mkdirSync(this.basePath, { recursive: true });
    } catch (err) {
      // Fallback to a local writable directory if the preferred path is unavailable.
      this.basePath = path.join(process.cwd(), 'backend/data/projects');
      fs.mkdirSync(this.basePath, { recursive: true });
    }
    fs.mkdirSync(path.join(this.basePath, 'docker'), { recursive: true });
  }

  safeResolve(targetPath = '/') {
    const cleaned = targetPath.startsWith('/') ? targetPath.slice(1) : targetPath;
    const resolved = path.resolve(this.basePath, cleaned);
    if (!resolved.startsWith(this.basePath)) {
      throw new Error('Invalid path');
    }
    return resolved;
  }

  async listFiles(targetPath = '/') {
    const resolved = this.safeResolve(targetPath);
    const entries = await fsp.readdir(resolved, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(resolved, entry.name);
        const stats = await fsp.stat(entryPath);
        const relativePath = path.join('/', path.relative(this.basePath, entryPath));
        const isDir = entry.isDirectory();
        const isImage = !isDir && /\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name);
        return {
          name: entry.name,
          path: relativePath,
          isDir,
          isImage,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString()
        };
      })
    );
    return items.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async uploadFile(file, destination = '/') {
    if (!file) {
      throw new Error('File is required');
    }
    const targetDir = this.safeResolve(destination);
    await fsp.mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, file.originalname);
    await fsp.writeFile(targetPath, file.buffer);
    return { path: path.join('/', path.relative(this.basePath, targetPath)) };
  }

  async deleteFile(targetPath) {
    const resolved = this.safeResolve(targetPath);
    await fsp.rm(resolved, { recursive: true, force: true });
    return true;
  }

  async createFolder(targetPath) {
    const resolved = this.safeResolve(targetPath);
    await fsp.mkdir(resolved, { recursive: true });
    return true;
  }

  async getFileSize(targetPath) {
    const resolved = this.safeResolve(targetPath);
    const stats = await fsp.stat(resolved);
    if (!stats.isDirectory()) {
      return stats.size;
    }
    const walk = async (dir) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const sizes = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            return walk(entryPath);
          }
          const entryStats = await fsp.stat(entryPath);
          return entryStats.size;
        })
      );
      return sizes.reduce((sum, size) => sum + size, 0);
    };
    return walk(resolved);
  }

  async readFile(targetPath) {
    const resolved = this.safeResolve(targetPath);
    const stats = await fsp.stat(resolved);
    if (stats.isDirectory()) {
      throw new Error('Cannot read directory');
    }
    return fsp.readFile(resolved, 'utf8');
  }

  async writeFile(targetPath, content) {
    const resolved = this.safeResolve(targetPath);
    await fsp.writeFile(resolved, content, 'utf8');
    return true;
  }

  async moveFile(fromPath, toPath) {
    const source = this.safeResolve(fromPath);
    const destination = this.safeResolve(toPath);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.rename(source, destination);
    return true;
  }

  isSupportedArchive(targetPath) {
    const lowerPath = String(targetPath || '').toLowerCase();
    return ARCHIVE_SUFFIXES.some((suffix) => lowerPath.endsWith(suffix));
  }

  stripArchiveExtension(filename) {
    const lowerName = String(filename || '').toLowerCase();
    const matched = ARCHIVE_SUFFIXES.find((suffix) => lowerName.endsWith(suffix));
    if (!matched) {
      return filename;
    }
    return filename.slice(0, filename.length - matched.length);
  }

  async ensureUniquePath(targetPath) {
    const resolved = this.safeResolve(targetPath);
    const dir = path.dirname(resolved);
    const ext = path.extname(resolved);
    const base = path.basename(resolved, ext);
    let counter = 1;
    let candidate = resolved;

    while (true) {
      try {
        await fsp.access(candidate);
        const suffix = `-${counter}`;
        candidate = path.join(dir, `${base}${suffix}${ext}`);
        counter += 1;
      } catch (err) {
        if (err.code === 'ENOENT') {
          return path.join('/', path.relative(this.basePath, candidate));
        }
        throw err;
      }
    }
  }

  async extractArchive(archivePath, destinationPath) {
    const source = this.safeResolve(archivePath);
    const stats = await fsp.stat(source);
    if (stats.isDirectory()) {
      throw new Error('Archive path must be a file');
    }
    if (!this.isSupportedArchive(archivePath)) {
      throw new Error('Unsupported archive format');
    }

    const archiveDir = path.posix.dirname(archivePath || '/') || '/';
    const archiveName = path.posix.basename(archivePath);
    const suggestedPath = destinationPath || path.posix.join(archiveDir, this.stripArchiveExtension(archiveName));
    const targetPath = await this.ensureUniquePath(suggestedPath);
    const destination = this.safeResolve(targetPath);

    await fsp.mkdir(destination, { recursive: true });

    try {
      if (archivePath.toLowerCase().endsWith('.zip')) {
        await execFileAsync('unzip', ['-o', source, '-d', destination]);
      } else {
        await execFileAsync('tar', ['-xf', source, '-C', destination]);
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new Error('Extractor command not available');
      }
      throw err;
    }

    return {
      path: targetPath,
      name: path.posix.basename(targetPath)
    };
  }

  getStorageStats() {
    try {
      const output = execSync(`df -k "${this.basePath}"`, { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      const parts = lines[1].split(/\s+/);
      const total = Number(parts[1]) * 1024;
      const used = Number(parts[2]) * 1024;
      return { total, used };
    } catch (err) {
      return { total: 0, used: 0 };
    }
  }

  async listProjects() {
    const entries = await fsp.readdir(this.basePath, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory());
    if (dirs.length === 0) {
      const stats = await fsp.stat(this.basePath);
      const size = await this.getFileSize('/');
      return [
        {
          name: 'root',
          path: '/',
          size,
          createdAt: stats.birthtime.toISOString()
        }
      ];
    }

    const projects = await Promise.all(
      dirs.map(async (entry) => {
        const projectPath = path.join(this.basePath, entry.name);
        const stats = await fsp.stat(projectPath);
        const size = await this.getFileSize(path.join('/', entry.name));
        return {
          name: entry.name,
          path: path.join('/', entry.name),
          size,
          createdAt: stats.birthtime.toISOString()
        };
      })
    );
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }
}

module.exports = StorageManager;
