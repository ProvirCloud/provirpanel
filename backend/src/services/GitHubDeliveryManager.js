'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const GITHUB_API = 'https://api.github.com';

const dirnamePosix = (filePath) => {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
};

const basenamePosix = (filePath) => String(filePath || '').replace(/\\/g, '/').split('/').pop() || '';

const joinPosix = (...parts) =>
  parts
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
    .map((part) => String(part).replace(/^\/+|\/+$/g, ''))
    .join('/');

const normalizeServiceName = (value, fallback = 'github-service') => {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
};

class GitHubDeliveryManager {
  constructor(options = {}) {
    this.storePath =
      options.storePath ||
      path.join(__dirname, '../../data/github-delivery.json');
    this.cryptoSecret =
      options.cryptoSecret ||
      process.env.GITHUB_TOKEN_ENCRYPTION_KEY ||
      process.env.JWT_SECRET ||
      'change-me';
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
  }

  readStore() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      return {
        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
        defaultConnectionId: parsed.defaultConnectionId || null
      };
    } catch (err) {
      return { connections: [], defaultConnectionId: null };
    }
  }

  writeStore(store) {
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2));
  }

  encryptionKey() {
    return crypto.createHash('sha256').update(String(this.cryptoSecret)).digest();
  }

  encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(value) {
    const text = String(value || '');
    if (!text.startsWith('enc:v1:')) return text;
    const [, , ivText, tagText, payloadText] = text.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(ivText, 'base64'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payloadText, 'base64')),
      decipher.final()
    ]).toString('utf8');
  }

  sanitizeConnection(connection = {}) {
    return {
      id: connection.id,
      provider: 'github',
      accountLogin: connection.accountLogin,
      accountName: connection.accountName || connection.accountLogin,
      avatarUrl: connection.avatarUrl || null,
      htmlUrl: connection.htmlUrl || null,
      tokenType: connection.tokenType || 'token',
      scopes: connection.scopes || [],
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt
    };
  }

  listConnections() {
    const store = this.readStore();
    return {
      defaultConnectionId: store.defaultConnectionId,
      connections: store.connections.map((connection) => this.sanitizeConnection(connection))
    };
  }

  getConnection(connectionId = null) {
    const store = this.readStore();
    const id = connectionId || store.defaultConnectionId;
    const connection = store.connections.find((entry) => entry.id === id) || store.connections[0];
    if (!connection) {
      const err = new Error('GitHub não conectado');
      err.status = 400;
      throw err;
    }
    return connection;
  }

  async githubRequest(connection, method, endpoint, options = {}) {
    const token = this.decrypt(connection.tokenEncrypted);
    try {
      const response = await axios.request({
        method,
        url: `${GITHUB_API}${endpoint}`,
        data: options.data,
        params: options.params,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.headers || {})
        },
        timeout: options.timeout || 30000
      });
      return response;
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.message || err.message || 'Erro ao chamar GitHub';
      const wrapped = new Error(`GitHub: ${message}`);
      wrapped.status = status || 502;
      throw wrapped;
    }
  }

  async connectWithToken({ token, label = '' }) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) {
      const err = new Error('Token do GitHub é obrigatório');
      err.status = 400;
      throw err;
    }

    const temporary = { tokenEncrypted: cleanToken };
    const userResponse = await this.githubRequest(temporary, 'GET', '/user');
    const scopeHeader = userResponse.headers['x-oauth-scopes'] || '';
    const scopes = scopeHeader.split(',').map((scope) => scope.trim()).filter(Boolean);
    const user = userResponse.data || {};
    const now = new Date().toISOString();
    const store = this.readStore();
    const existingIndex = store.connections.findIndex((entry) => entry.accountLogin === user.login);
    const connection = {
      id: existingIndex >= 0 ? store.connections[existingIndex].id : crypto.randomUUID(),
      provider: 'github',
      tokenType: 'token',
      tokenEncrypted: this.encrypt(cleanToken),
      accountLogin: user.login,
      accountName: label || user.name || user.login,
      avatarUrl: user.avatar_url || null,
      htmlUrl: user.html_url || null,
      scopes,
      createdAt: existingIndex >= 0 ? store.connections[existingIndex].createdAt : now,
      updatedAt: now
    };

    if (existingIndex >= 0) {
      store.connections[existingIndex] = connection;
    } else {
      store.connections.push(connection);
    }
    store.defaultConnectionId = connection.id;
    this.writeStore(store);
    return this.sanitizeConnection(connection);
  }

  async listRepositories(connectionId = null) {
    const connection = this.getConnection(connectionId);
    const repos = [];
    for (let page = 1; page <= 10; page += 1) {
      const response = await this.githubRequest(connection, 'GET', '/user/repos', {
        params: {
          per_page: 100,
          page,
          sort: 'updated',
          affiliation: 'owner,collaborator,organization_member'
        }
      });
      const items = Array.isArray(response.data) ? response.data : [];
      repos.push(...items.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        owner: repo.owner?.login,
        private: Boolean(repo.private),
        defaultBranch: repo.default_branch || 'main',
        htmlUrl: repo.html_url,
        description: repo.description || '',
        language: repo.language || '',
        pushedAt: repo.pushed_at,
        updatedAt: repo.updated_at
      })));
      if (items.length < 100) break;
    }
    return repos;
  }

  async listBranches({ connectionId = null, owner, repo }) {
    const connection = this.getConnection(connectionId);
    const branches = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await this.githubRequest(connection, 'GET', `/repos/${owner}/${repo}/branches`, {
        params: { per_page: 100, page }
      });
      const items = Array.isArray(response.data) ? response.data : [];
      branches.push(...items.map((branch) => ({
        name: branch.name,
        sha: branch.commit?.sha || null,
        protected: Boolean(branch.protected)
      })));
      if (items.length < 100) break;
    }
    return branches;
  }

  async getBranchSha(connection, owner, repo, branch) {
    const response = await this.githubRequest(
      connection,
      'GET',
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
    );
    return response.data?.commit?.sha;
  }

  async listTree({ connection, owner, repo, branch }) {
    const sha = await this.getBranchSha(connection, owner, repo, branch);
    if (!sha) throw new Error('Branch sem commit válido');
    const response = await this.githubRequest(connection, 'GET', `/repos/${owner}/${repo}/git/trees/${sha}`, {
      params: { recursive: '1' }
    });
    return Array.isArray(response.data?.tree) ? response.data.tree : [];
  }

  async readTextFile({ connection, owner, repo, branch, filePath }) {
    try {
      const response = await this.githubRequest(
        connection,
        'GET',
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`,
        { params: { ref: branch } }
      );
      if (response.data?.encoding === 'base64' && response.data?.content) {
        return Buffer.from(String(response.data.content).replace(/\n/g, ''), 'base64').toString('utf8');
      }
      return typeof response.data === 'string' ? response.data : '';
    } catch (err) {
      return '';
    }
  }

  detectPackageManager(files, root) {
    const has = (name) => files.has(joinPosix(root, name));
    if (has('pnpm-lock.yaml')) return 'pnpm';
    if (has('yarn.lock')) return 'yarn';
    if (has('package-lock.json')) return 'npm';
    return 'npm';
  }

  installCommand(packageManager) {
    if (packageManager === 'pnpm') return 'corepack enable && pnpm install --frozen-lockfile';
    if (packageManager === 'yarn') return 'corepack enable && yarn install --frozen-lockfile';
    return 'npm ci';
  }

  buildNodeBlueprint({ owner, repo, branch, root, packageJson, files }) {
    const pkg = packageJson || {};
    const scripts = pkg.scripts || {};
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {})
    };
    const depNames = Object.keys(allDeps).map((name) => name.toLowerCase());
    const packageManager = this.detectPackageManager(files, root);
    const hasBuild = typeof scripts.build === 'string';
    const hasStart = typeof scripts.start === 'string';
    const isNext = depNames.includes('next');
    const isServer =
      isNext ||
      depNames.some((name) => ['express', 'fastify', '@nestjs/core', 'koa', 'hapi'].includes(name)) ||
      hasStart;
    const isStatic =
      hasBuild &&
      !isNext &&
      depNames.some((name) => ['vite', 'react-scripts', '@angular/core', 'vue', 'svelte'].includes(name));
    const buildType = isStatic && !isServer ? 'node-site' : 'node-service';
    const outputFolder =
      files.has(joinPosix(root, 'dist')) || depNames.includes('vite')
        ? 'dist'
        : files.has(joinPosix(root, 'build'))
          ? 'build'
          : 'dist';

    return {
      id: `${buildType}:${root || '.'}`,
      source: 'github-scan',
      repository: `${owner}/${repo}`,
      branch,
      projectPath: root || '.',
      serviceName: normalizeServiceName(pkg.name || repo),
      buildType,
      label: buildType === 'node-site' ? 'Node site/static build' : 'Node service',
      confidence: isServer || isStatic ? 'high' : 'medium',
      templateId: 'node-app',
      imageName: 'node:20',
      containerPort: 3000,
      defaultPort: 8000,
      packageManager,
      installCommand: this.installCommand(packageManager),
      buildCommand: hasBuild ? `${packageManager} run build` : '',
      startCommand: hasStart ? `${packageManager} run start` : 'npm start',
      artifactPath: buildType === 'node-site' ? outputFolder : '.',
      nodeServiceMode: buildType === 'node-site' ? 'sites' : 'service',
      nodeSiteConfig: buildType === 'node-site'
        ? { siteType: 'spa', siteFolder: 'publish', fallbackFile: 'index.html' }
        : null,
      healthcheck: {
        enabled: true,
        target: buildType === 'node-site' ? '/' : '/health',
        intervalSeconds: 10,
        timeoutSeconds: 5,
        retries: 6,
        startPeriodSeconds: 5,
        containerEnabled: false
      },
      envKeys: ['NODE_ENV'],
      detectedFiles: [joinPosix(root, 'package.json')]
    };
  }

  buildJavaBlueprint({ owner, repo, branch, root, buildFile, content }) {
    const javaVersionMatch = content.match(/<java\.version>\s*([^<\s]+)\s*<\/java\.version>|sourceCompatibility\s*=\s*['"]?([0-9.]+)/i);
    const javaVersion = (javaVersionMatch?.[1] || javaVersionMatch?.[2] || '11').replace(/^1\./, '');
    const isGradle = /gradle/i.test(buildFile);
    return {
      id: `java-jar:${root || '.'}`,
      source: 'github-scan',
      repository: `${owner}/${repo}`,
      branch,
      projectPath: root || '.',
      serviceName: normalizeServiceName(repo),
      buildType: 'java-jar',
      label: isGradle ? 'Java Gradle service' : 'Java Maven service',
      confidence: 'high',
      templateId: 'custom-image',
      imageName: `eclipse-temurin:${javaVersion}-jdk-jammy`,
      containerPort: 8080,
      defaultPort: 8080,
      packageManager: isGradle ? 'gradle' : 'maven',
      buildCommand: isGradle ? './gradlew clean build -x test' : './mvnw clean package -DskipTests',
      artifactPath: isGradle ? 'build/libs/*.jar' : 'target/*.jar',
      nodeServiceMode: null,
      nodeSiteConfig: null,
      healthcheck: {
        enabled: true,
        target: '/actuator/health',
        intervalSeconds: 10,
        timeoutSeconds: 5,
        retries: 8,
        startPeriodSeconds: 10,
        containerEnabled: false
      },
      envKeys: ['JAVA_OPTS'],
      detectedFiles: [joinPosix(root, buildFile)]
    };
  }

  buildDockerBlueprint({ owner, repo, branch, root }) {
    return {
      id: `docker-image:${root || '.'}`,
      source: 'github-scan',
      repository: `${owner}/${repo}`,
      branch,
      projectPath: root || '.',
      serviceName: normalizeServiceName(repo),
      buildType: 'docker-image',
      label: 'Dockerfile project',
      confidence: 'medium',
      templateId: 'custom-image',
      imageName: `${normalizeServiceName(repo)}:latest`,
      containerPort: 8080,
      defaultPort: 8080,
      packageManager: 'docker',
      buildCommand: 'docker build',
      artifactPath: '.',
      nodeServiceMode: null,
      nodeSiteConfig: null,
      healthcheck: {
        enabled: true,
        target: '/health',
        intervalSeconds: 10,
        timeoutSeconds: 5,
        retries: 6,
        startPeriodSeconds: 5,
        containerEnabled: false
      },
      envKeys: [],
      detectedFiles: [joinPosix(root, 'Dockerfile')],
      notes: ['MVP publica artefato/arquivo pelo ProvirPanel; build/push de imagem Docker fica para a próxima etapa.']
    };
  }

  async analyzeRepository({ connectionId = null, owner, repo, branch = 'main' }) {
    const connection = this.getConnection(connectionId);
    const tree = await this.listTree({ connection, owner, repo, branch });
    const blobPaths = tree
      .filter((entry) => entry.type === 'blob' && entry.path)
      .map((entry) => entry.path);
    const files = new Set(blobPaths);
    const roots = new Map();

    const addRoot = (root, type, filePath) => {
      const normalizedRoot = root || '';
      const current = roots.get(normalizedRoot) || { root: normalizedRoot, markers: new Map() };
      current.markers.set(type, filePath);
      roots.set(normalizedRoot, current);
    };

    blobPaths.forEach((filePath) => {
      const base = basenamePosix(filePath);
      if (base === 'package.json') addRoot(dirnamePosix(filePath), 'package', filePath);
      if (base === 'pom.xml') addRoot(dirnamePosix(filePath), 'maven', filePath);
      if (base === 'build.gradle' || base === 'build.gradle.kts') addRoot(dirnamePosix(filePath), 'gradle', filePath);
      if (base === 'Dockerfile') addRoot(dirnamePosix(filePath), 'dockerfile', filePath);
    });

    const blueprints = [];
    for (const entry of roots.values()) {
      const root = entry.root;
      if (entry.markers.has('package')) {
        const rawPackage = await this.readTextFile({
          connection,
          owner,
          repo,
          branch,
          filePath: entry.markers.get('package')
        });
        let packageJson = {};
        try {
          packageJson = JSON.parse(rawPackage);
        } catch (err) {
          packageJson = {};
        }
        blueprints.push(this.buildNodeBlueprint({ owner, repo, branch, root, packageJson, files }));
      }
      if (entry.markers.has('maven') || entry.markers.has('gradle')) {
        const marker = entry.markers.get('maven') || entry.markers.get('gradle');
        const content = await this.readTextFile({ connection, owner, repo, branch, filePath: marker });
        blueprints.push(this.buildJavaBlueprint({
          owner,
          repo,
          branch,
          root,
          buildFile: basenamePosix(marker),
          content
        }));
      }
      if (entry.markers.has('dockerfile')) {
        blueprints.push(this.buildDockerBlueprint({ owner, repo, branch, root }));
      }
    }

    const unique = [];
    const seen = new Set();
    blueprints.forEach((blueprint) => {
      if (seen.has(blueprint.id)) return;
      seen.add(blueprint.id);
      unique.push(blueprint);
    });

    return {
      repository: { owner, repo, fullName: `${owner}/${repo}` },
      branch,
      filesScanned: blobPaths.length,
      blueprints: unique.slice(0, 20)
    };
  }

  generateWorkflow({ serviceId, serviceName, blueprint, provirPanelUrl = '', deployMode = 'manual' }) {
    const formJson = (name, value) =>
      `            -F '${name}=${JSON.stringify(value).replace(/'/g, "'\"'\"'")}'`;
    const projectPath = blueprint.projectPath && blueprint.projectPath !== '.' ? blueprint.projectPath : '.';
    const workflowName = `ProvirPanel Deploy - ${serviceName || blueprint.serviceName || 'service'}`;
    const branch = blueprint.branch || 'main';
    const triggers = deployMode === 'push'
      ? `  workflow_dispatch:\n  push:\n    branches:\n      - ${branch}\n`
      : deployMode === 'tag'
        ? `  workflow_dispatch:\n  push:\n    tags:\n      - 'v*'\n`
        : '  workflow_dispatch:\n';
    const uploadUrl = '${{ secrets.PROVIRPANEL_URL }}';
    const serviceTarget = serviceId || '${{ secrets.PROVIRPANEL_SERVICE_ID }}';
    const base = [
      `name: ${workflowName}`,
      '',
      'on:',
      triggers.trimEnd(),
      '',
      'concurrency:',
      `  group: provirpanel-${serviceTarget}`,
      '  cancel-in-progress: false',
      '',
      'jobs:',
      '  build-and-deploy:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4'
    ];

    if (blueprint.buildType === 'java-jar') {
      const javaVersion = String(blueprint.imageName || '').match(/temurin:([0-9]+)/)?.[1] || '11';
      base.push(
        '',
        '      - uses: actions/setup-java@v4',
        '        with:',
        '          distribution: temurin',
        `          java-version: '${javaVersion}'`,
        '',
        '      - name: Build',
        `        working-directory: ${projectPath}`,
        `        run: ${blueprint.buildCommand || './mvnw clean package -DskipTests'}`,
        '',
        '      - name: Select artifact',
        `        working-directory: ${projectPath}`,
        `        run: |`,
        `          mkdir -p "$GITHUB_WORKSPACE/.provirpanel-release"`,
        `          cp ${blueprint.artifactPath || 'target/*.jar'} "$GITHUB_WORKSPACE/.provirpanel-release/app.jar"`,
        '',
        '      - name: Deploy to ProvirPanel',
        '        run: |',
        `          curl -f -X POST "${uploadUrl}/api/docker/services/${serviceTarget}/project-upload" \\`,
        '            -H "Authorization: Bearer ${{ secrets.PROVIRPANEL_TOKEN }}" \\',
        '            -F "archive=@.provirpanel-release/app.jar" \\',
        '            -F "autoRollback=true" \\',
        `${formJson('healthcheck', blueprint.healthcheck || {})} \\`,
        formJson('versionMetadata', { mode: 'auto', changeType: 'feature' })
      );
      return base.join('\n') + '\n';
    }

    const packageManager = blueprint.packageManager || 'npm';
    const setupNode = [
      '',
      '      - uses: actions/setup-node@v4',
      '        with:',
      "          node-version: '20'"
    ];
    base.push(...setupNode);

    if (blueprint.buildType === 'node-site') {
      base.push(
        '',
        '      - name: Install dependencies',
        `        working-directory: ${projectPath}`,
        `        run: ${blueprint.installCommand || 'npm ci'}`,
        '',
        '      - name: Build static output',
        `        working-directory: ${projectPath}`,
        `        run: ${blueprint.buildCommand || `${packageManager} run build`}`,
        '',
        '      - name: Package static output',
        `        working-directory: ${projectPath}`,
        '        run: |',
        '          mkdir -p "$GITHUB_WORKSPACE/.provirpanel-release"',
        `          tar -czf "$GITHUB_WORKSPACE/.provirpanel-release/site.tgz" -C "${blueprint.artifactPath || 'dist'}" .`,
        '',
        '      - name: Deploy to ProvirPanel',
        '        run: |',
        `          curl -f -X POST "${uploadUrl}/api/docker/services/${serviceTarget}/project-upload" \\`,
        '            -H "Authorization: Bearer ${{ secrets.PROVIRPANEL_TOKEN }}" \\',
        '            -F "archive=@.provirpanel-release/site.tgz" \\',
        '            -F "autoRollback=true" \\',
        `            -F "nodeServiceMode=sites" \\`,
        `${formJson('nodeSiteConfig', blueprint.nodeSiteConfig || { siteType: 'spa', siteFolder: 'publish', fallbackFile: 'index.html' })} \\`,
        `${formJson('healthcheck', blueprint.healthcheck || {})} \\`,
        formJson('versionMetadata', { mode: 'auto', changeType: 'content' })
      );
      return base.join('\n') + '\n';
    }

    base.push(
      '',
      '      - name: Package source',
      `        working-directory: ${projectPath}`,
      '        run: |',
      '          mkdir -p "$GITHUB_WORKSPACE/.provirpanel-release"',
      '          tar --exclude=.git --exclude=node_modules --exclude=.next --exclude=dist --exclude=build -czf "$GITHUB_WORKSPACE/.provirpanel-release/source.tgz" .',
      '',
      '      - name: Deploy to ProvirPanel',
      '        run: |',
      `          curl -f -X POST "${uploadUrl}/api/docker/services/${serviceTarget}/project-upload" \\`,
      '            -H "Authorization: Bearer ${{ secrets.PROVIRPANEL_TOKEN }}" \\',
      '            -F "archive=@.provirpanel-release/source.tgz" \\',
      '            -F "autoRollback=true" \\',
      `${formJson('healthcheck', blueprint.healthcheck || {})} \\`,
      formJson('versionMetadata', { mode: 'auto', changeType: 'feature' })
    );
    return base.join('\n') + '\n';
  }

  async saveWorkflow({ connectionId = null, owner, repo, branch, workflowPath, content, message }) {
    const connection = this.getConnection(connectionId);
    let sha = null;
    try {
      const existing = await this.githubRequest(
        connection,
        'GET',
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(workflowPath).replace(/%2F/g, '/')}`,
        { params: { ref: branch } }
      );
      sha = existing.data?.sha || null;
    } catch (err) {
      if (err.status !== 404) throw err;
    }

    const response = await this.githubRequest(
      connection,
      'PUT',
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(workflowPath).replace(/%2F/g, '/')}`,
      {
        data: {
          message: message || `Add ProvirPanel workflow ${workflowPath}`,
          content: Buffer.from(content, 'utf8').toString('base64'),
          branch,
          ...(sha ? { sha } : {})
        }
      }
    );
    return {
      path: workflowPath,
      htmlUrl: response.data?.content?.html_url || null,
      commitSha: response.data?.commit?.sha || null
    };
  }

  async dispatchWorkflow({ connectionId = null, owner, repo, workflowPath, ref, inputs = {} }) {
    const connection = this.getConnection(connectionId);
    const workflowId = basenamePosix(workflowPath || '');
    if (!workflowId) {
      const err = new Error('Workflow não configurado');
      err.status = 400;
      throw err;
    }
    await this.githubRequest(
      connection,
      'POST',
      `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
      {
        data: {
          ref,
          inputs
        }
      }
    );
    return {
      workflowId,
      ref,
      dispatchedAt: new Date().toISOString()
    };
  }

  normalizeServiceName(value, fallback) {
    return normalizeServiceName(value, fallback);
  }
}

module.exports = GitHubDeliveryManager;
