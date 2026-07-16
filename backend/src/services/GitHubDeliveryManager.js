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

  removeConnection(connectionId) {
    const store = this.readStore();
    const id = connectionId || store.defaultConnectionId;
    const existing = store.connections.find((entry) => entry.id === id);
    if (!existing) {
      const err = new Error('Conexão GitHub não encontrada');
      err.status = 404;
      throw err;
    }
    const nextConnections = store.connections.filter((entry) => entry.id !== id);
    const nextStore = {
      connections: nextConnections,
      defaultConnectionId:
        store.defaultConnectionId === id
          ? nextConnections[0]?.id || null
          : store.defaultConnectionId
    };
    this.writeStore(nextStore);
    return {
      removedConnection: this.sanitizeConnection(existing),
      ...this.listConnections()
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
      const ghMessage = err.response?.data?.message || err.message || 'Erro ao chamar GitHub';
      const detail = status === 403
        ? `${ghMessage}. Verifique se o token tem permissão Workflows (Read & Write) e se o repositório está acessível. Endpoint: ${method} ${endpoint}`
        : ghMessage;
      const wrapped = new Error(`GitHub: ${detail}`);
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
        // A rota raiz é o único default seguro sem analisar as rotas da
        // aplicação. APIs que não publicam uma página ainda provam readiness
        // ao responder HTTP (inclusive 401/404) na raiz.
        target: '/',
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
        target: '/',
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
        target: '/',
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
    const fs = require('fs');
    const path = require('path');
    const projectPath = blueprint.projectPath && blueprint.projectPath !== '.' ? blueprint.projectPath : '.';
    const workflowName = `ProvirPanel Deploy - ${serviceName || blueprint.serviceName || 'service'}`;
    const branch = blueprint.branch || 'main';

    const nodeVersion = blueprint.nodeVersion || '20';
    const packageManager = blueprint.packageManager || 'npm';
    const buildCommand = blueprint.buildCommand || `${packageManager === 'yarn' ? 'yarn' : 'npm run'} build`;
    const installCommand = blueprint.installCommand || (packageManager === 'yarn' ? 'yarn install --frozen-lockfile' : packageManager === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'npm ci');
    const artifactPath = blueprint.artifactPath || 'dist';

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

    // Helper: generates chunked upload deploy step
    const chunkedDeployStep = (archiveFile, extraFields = {}) => {
      const fieldsJson = JSON.stringify({
        autoRollback: true,
        versionMetadata: { mode: 'auto', changeType: 'feature', commitSha: '${{ github.sha }}' },
        ...extraFields
      });
      return [
        '',
        '      - name: Deploy to ProvirPanel (chunked upload)',
        '        env:',
        '          PANEL_URL: ${{ secrets.PROVIRPANEL_URL }}',
        '          PANEL_TOKEN: ${{ secrets.PROVIRPANEL_TOKEN }}',
        `          SERVICE_ID: ${serviceTarget}`,
        `          ARCHIVE_FILE: ${archiveFile.replace('$GITHUB_WORKSPACE', '${{ github.workspace }}')}`,
        `          EXTRA_FIELDS: '${fieldsJson.replace(/'/g, "'\\''")}' `,
        '        run: |',
        '          CHUNK_SIZE=50000000',
        '          FILE_SIZE=$(stat --printf="%s" "$ARCHIVE_FILE")',
        '          TOTAL_CHUNKS=$(( (FILE_SIZE + CHUNK_SIZE - 1) / CHUNK_SIZE ))',
        '          FILENAME=$(basename "$ARCHIVE_FILE")',
        '          echo "Uploading $FILENAME ($FILE_SIZE bytes) in $TOTAL_CHUNKS chunk(s)"',
        '          ',
        '          # Parse extra fields for init',
        '          INIT_BODY=$(echo "$EXTRA_FIELDS" | jq -c --arg fn "$FILENAME" --argjson tc $TOTAL_CHUNKS --argjson sz $FILE_SIZE \'. + {totalChunks: $tc, filename: $fn, size: $sz}\')',
        '          ',
        '          # Init upload',
        '          UPLOAD_ID=$(curl -sf -X POST "$PANEL_URL/api/docker/services/$SERVICE_ID/project-upload/init" \\',
        '            -H "Authorization: Bearer $PANEL_TOKEN" \\',
        '            -H "Content-Type: application/json" \\',
        '            -d "$INIT_BODY" | jq -r .uploadId)',
        '          ',
        '          if [ -z "$UPLOAD_ID" ] || [ "$UPLOAD_ID" = "null" ]; then',
        '            echo "❌ Failed to init upload"; exit 1',
        '          fi',
        '          echo "Upload ID: $UPLOAD_ID"',
        '          ',
        '          # Split and send chunks',
        '          split -b $CHUNK_SIZE -d --additional-suffix=.chunk "$ARCHIVE_FILE" /tmp/chunk_',
        '          CHUNK_INDEX=0',
        '          for CHUNK_FILE in /tmp/chunk_*.chunk; do',
        '            echo "  Sending chunk $CHUNK_INDEX / $((TOTAL_CHUNKS - 1))..."',
        '            HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" -X POST \\',
        '              "$PANEL_URL/api/docker/services/$SERVICE_ID/project-upload/chunk" \\',
        '              -H "Authorization: Bearer $PANEL_TOKEN" \\',
        '              -F "uploadId=$UPLOAD_ID" \\',
        '              -F "chunkIndex=$CHUNK_INDEX" \\',
        '              -F "chunk=@$CHUNK_FILE")',
        '            if [ "$HTTP_CODE" != "200" ]; then',
        '              echo "❌ Chunk $CHUNK_INDEX failed (HTTP $HTTP_CODE)"; exit 1',
        '            fi',
        '            CHUNK_INDEX=$((CHUNK_INDEX + 1))',
        '          done',
        '          ',
        '          # Complete upload',
        '          RESULT=$(curl -sf -X POST "$PANEL_URL/api/docker/services/$SERVICE_ID/project-upload/complete" \\',
        '            -H "Authorization: Bearer $PANEL_TOKEN" \\',
        '            -H "Content-Type: application/json" \\',
        '            -d "{\\"uploadId\\": \\"$UPLOAD_ID\\"}")',
        '          echo "✅ Deploy initiated: $(echo $RESULT | jq -r \'(.message // .jobId // "ok")\')"'
      ];
    };

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
        `          cp ${(blueprint.artifactPath && blueprint.artifactPath !== '.') ? blueprint.artifactPath : 'target/*.jar'} "$GITHUB_WORKSPACE/.provirpanel-release/app.jar"`,
        ...chunkedDeployStep('$GITHUB_WORKSPACE/.provirpanel-release/app.jar')
      );
      return base.join('\n') + '\n';
    }

    const setupNode = [
      '',
      '      - uses: actions/setup-node@v4',
      '        with:',
      `          node-version: '${nodeVersion}'`
    ];
    base.push(...setupNode);

    if (blueprint.buildType === 'node-site') {
      base.push(
        '',
        '      - name: Install dependencies',
        `        working-directory: ${projectPath}`,
        `        run: ${installCommand}`,
        '',
        '      - name: Build static output',
        `        working-directory: ${projectPath}`,
        `        run: ${buildCommand}`,
        '',
        '      - name: Package static output',
        `        working-directory: ${projectPath}`,
        '        run: |',
        '          mkdir -p "$GITHUB_WORKSPACE/.provirpanel-release"',
        `          tar -czf "$GITHUB_WORKSPACE/.provirpanel-release/site.tgz" -C "${artifactPath}" .`,
        ...chunkedDeployStep('$GITHUB_WORKSPACE/.provirpanel-release/site.tgz', {
          nodeServiceMode: 'sites',
          nodeSiteConfig: blueprint.nodeSiteConfig || { siteType: 'spa', siteFolder: 'publish', fallbackFile: 'index.html' }
        })
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
      ...chunkedDeployStep('$GITHUB_WORKSPACE/.provirpanel-release/source.tgz')
    );
    return base.join('\n') + '\n';
  }

  async detectProjectConfig({ connectionId, owner, repo, branch = 'main', projectPath = '.' }) {
    const conn = this.getConnection(connectionId);
    const prefix = projectPath === '.' ? '' : `${projectPath}/`;
    const config = {};

    // Fetch .nvmrc
    try {
      const res = await this.githubRequest(conn, 'GET', `/repos/${owner}/${repo}/contents/${prefix}.nvmrc?ref=${branch}`);
      if (res.data?.content) {
        config.nodeVersion = Buffer.from(res.data.content, 'base64').toString('utf8').trim().replace(/^v/i, '');
      }
    } catch {}

    // Fetch package.json
    try {
      const res = await this.githubRequest(conn, 'GET', `/repos/${owner}/${repo}/contents/${prefix}package.json?ref=${branch}`);
      if (res.data?.content) {
        const pkg = JSON.parse(Buffer.from(res.data.content, 'base64').toString('utf8'));
        // Node version from engines
        if (!config.nodeVersion && pkg.engines?.node) {
          const m = pkg.engines.node.match(/(\d+\.?\d*\.?\d*)/);
          if (m) config.nodeVersion = m[1];
        }
        // Package manager
        if (pkg.packageManager) {
          const pm = pkg.packageManager.split('@')[0];
          if (['yarn', 'pnpm', 'npm'].includes(pm)) config.packageManager = pm;
        }
        // Build command
        if (pkg.scripts?.build) {
          const pm = config.packageManager || 'npm';
          config.buildCommand = pm === 'yarn' ? 'yarn build' : pm === 'pnpm' ? 'pnpm build' : 'npm run build';
          // Check for specific build modes
          if (pkg.scripts.build.includes('--mode')) config.buildCommand = `${pm === 'yarn' ? 'yarn' : pm === 'pnpm' ? 'pnpm' : 'npm run'} build`;
        }
        // Install command
        const pm = config.packageManager || 'npm';
        config.installCommand = pm === 'yarn' ? 'yarn install --frozen-lockfile' : pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'npm ci';
      }
    } catch {}

    // Detect lock file for package manager if not yet detected
    if (!config.packageManager) {
      try {
        await this.githubRequest(conn, 'GET', `/repos/${owner}/${repo}/contents/${prefix}yarn.lock?ref=${branch}`);
        config.packageManager = 'yarn';
        config.installCommand = 'yarn install --frozen-lockfile';
      } catch {
        try {
          await this.githubRequest(conn, 'GET', `/repos/${owner}/${repo}/contents/${prefix}pnpm-lock.yaml?ref=${branch}`);
          config.packageManager = 'pnpm';
          config.installCommand = 'pnpm install --frozen-lockfile';
        } catch {
          config.packageManager = config.packageManager || 'npm';
        }
      }
    }

    // Detect artifact path from config files
    if (!config.artifactPath) {
      const checks = ['vite.config.ts', 'vite.config.js', 'vue.config.js', 'angular.json', 'next.config.js', 'next.config.mjs', 'nuxt.config.ts'];
      for (const file of checks) {
        try {
          await this.githubRequest(conn, 'GET', `/repos/${owner}/${repo}/contents/${prefix}${file}?ref=${branch}`);
          if (file.includes('next')) config.artifactPath = '.next';
          else if (file.includes('nuxt')) config.artifactPath = '.output/public';
          else config.artifactPath = 'dist';
          break;
        } catch {}
      }
      if (!config.artifactPath) config.artifactPath = 'dist';
    }

    return config;
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
      if (err.status !== 404) {
        if (err.status === 403) {
          const hint = `Falha ao acessar ${owner}/${repo} (branch ${branch}). Verifique se o token tem acesso ao reposit\u00f3rio e permiss\u00e3o Contents + Workflows (Read & Write).`;
          const wrapped = new Error(`GitHub: ${hint}`);
          wrapped.status = 403;
          throw wrapped;
        }
        throw err;
      }
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

  async getLatestWorkflowRun({ connectionId = null, owner, repo, workflowPath, branch }) {
    const connection = this.getConnection(connectionId);
    const workflowId = basenamePosix(workflowPath || '');
    if (!workflowId) return null;
    const response = await this.githubRequest(
      connection,
      'GET',
      `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflowId)}/runs`,
      { params: { branch, per_page: 1 } }
    );
    const run = response?.data?.workflow_runs?.[0];
    if (!run) return null;
    return {
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      htmlUrl: run.html_url
    };
  }

  /**
   * Get failed workflow run logs (job steps + annotations)
   */
  async getWorkflowRunFailureLogs({ connectionId = null, owner, repo, runId }) {
    const connection = this.getConnection(connectionId);
    try {
      const jobsRes = await this.githubRequest(connection, 'GET', `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`);
      const jobs = jobsRes?.data?.jobs || [];
      const lines = [];
      for (const job of jobs) {
        if (job.conclusion !== 'failure') continue;
        lines.push(`Job: ${job.name} - FAILED`);
        for (const step of (job.steps || [])) {
          if (step.conclusion === 'failure') {
            lines.push(`  Step FAILED: ${step.name}`);
          }
        }
        // Get annotations (error messages)
        try {
          const annRes = await this.githubRequest(connection, 'GET', `/repos/${owner}/${repo}/check-runs/${job.id}/annotations`);
          for (const ann of (annRes?.data || [])) {
            if (ann.annotation_level === 'failure' || ann.annotation_level === 'warning') {
              lines.push(`  ${ann.annotation_level}: ${ann.message || ann.raw_details || ''}`.slice(0, 300));
            }
          }
        } catch { /* annotations not available */ }
        // Get actual job logs (text output)
        try {
          const token = this.decrypt(connection.tokenEncrypted);
          const logRes = await axios.get(`${GITHUB_API}/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
            maxRedirects: 5, timeout: 15000, responseType: 'text'
          });
          if (logRes.data) {
            // Extract last 150 lines (most relevant for errors)
            const logLines = String(logRes.data).split('\n');
            const tail = logLines.slice(-150).join('\n');
            lines.push(`  --- Job Logs (last 150 lines) ---`);
            lines.push(tail);
          }
        } catch { /* logs download not available */ }
      }
      return lines.join('\n') || 'No failure details available';
    } catch (err) {
      return `Failed to fetch logs: ${err.message}`;
    }
  }

  /**
   * Get commits between two SHAs (for changelog generation)
   */
  async getCommitsBetween({ connectionId = null, owner, repo, baseSha, headSha }) {
    const connection = this.getConnection(connectionId);
    try {
      const response = await this.githubRequest(
        connection,
        'GET',
        `/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`,
        { timeout: 15000 }
      );
      const commits = (response?.data?.commits || []).map(c => ({
        sha: c.sha?.slice(0, 7),
        message: (c.commit?.message || '').split('\n')[0].slice(0, 120),
        author: c.commit?.author?.name || c.author?.login || 'unknown',
        date: c.commit?.author?.date
      }));
      return { commits, totalCommits: response?.data?.total_commits || commits.length };
    } catch {
      return { commits: [], totalCommits: 0 };
    }
  }

  /**
   * Get recent commits on a branch (fallback when no base SHA)
   */
  async getRecentCommits({ connectionId = null, owner, repo, branch = 'main', count = 10 }) {
    const connection = this.getConnection(connectionId);
    try {
      const response = await this.githubRequest(
        connection,
        'GET',
        `/repos/${owner}/${repo}/commits`,
        { params: { sha: branch, per_page: count } }
      );
      return (response?.data || []).map(c => ({
        sha: c.sha?.slice(0, 7),
        message: (c.commit?.message || '').split('\n')[0].slice(0, 120),
        author: c.commit?.author?.name || c.author?.login || 'unknown',
        date: c.commit?.author?.date
      }));
    } catch {
      return [];
    }
  }

  /**
   * Set a repository secret (Actions secret) using libsodium for encryption
   */
  async setRepositorySecret({ connectionId = null, owner, repo, secretName, secretValue }) {
    const connection = this.getConnection(connectionId);
    // Get repo public key for encrypting secrets
    const keyRes = await this.githubRequest(connection, 'GET', `/repos/${owner}/${repo}/actions/secrets/public-key`);
    const { key: publicKey, key_id } = keyRes.data;
    // Encrypt using libsodium sealed box
    const sodium = require('libsodium-wrappers');
    await sodium.ready;
    const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
    const messageBytes = sodium.from_string(secretValue);
    const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes);
    const encryptedBase64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
    // Create or update the secret
    await this.githubRequest(connection, 'PUT', `/repos/${owner}/${repo}/actions/secrets/${secretName}`, {
      data: { encrypted_value: encryptedBase64, key_id }
    });
    return { secretName, created: true };
  }

  normalizeServiceName(value, fallback) {
    return normalizeServiceName(value, fallback);
  }
}

module.exports = GitHubDeliveryManager;
