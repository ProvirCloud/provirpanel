'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const prisma = require('../config/prisma');

class NginxServerManager {
  constructor() {
    this.configPath = '/etc/nginx';
    this.sitesAvailable = path.join(this.configPath, 'sites-available');
    this.sitesEnabled = path.join(this.configPath, 'sites-enabled');
    this.confD = path.join(this.configPath, 'conf.d');
    this.accessLogPath = '/var/log/nginx/access.log';
    this.errorLogPath = '/var/log/nginx/error.log';
  }

  // ==================== DATABASE OPERATIONS ====================

  async getAllServers() {
    try {
      const servers = await prisma.nginxServer.findMany({
        include: { sslCerts: true },
        orderBy: { createdAt: 'desc' }
      });
      return servers.map(s => this.formatServerForApi(s));
    } catch (err) {
      if (err.code === 'P2021' || err.message?.includes('does not exist')) {
        console.warn('[NginxServerManager] Tables not created yet - run prisma db push');
        return [];
      }
      throw err;
    }
  }

  async getServerById(id) {
    try {
      const server = await prisma.nginxServer.findUnique({
        where: { id },
        include: { sslCerts: true }
      });
      return server ? this.formatServerForApi(server) : null;
    } catch (err) {
      if (err.code === 'P2021') return null;
      throw err;
    }
  }

  async createServer(data) {
    const primaryDomain = data.primary_domain;
    const configFileName = `${primaryDomain.replace(/[^a-zA-Z0-9.-]/g, '_')}.conf`;
    const configFilePath = path.join(this.getTargetDir(), configFileName);

    const server = await prisma.nginxServer.create({
      data: {
        name: data.name,
        primaryDomain: primaryDomain,
        additionalDomains: data.additional_domains || [],
        upstreamServers: data.upstream_servers || [],
        serverType: data.server_type || 'proxy',
        listenPort: data.listen_port || 80,
        sslType: data.ssl_type || 'none',
        sslCertPath: data.ssl_cert_path,
        sslKeyPath: data.ssl_key_path,
        proxyHost: data.proxy_host || 'localhost',
        proxyPort: data.proxy_port || 3000,
        rootPath: data.root_path || '/var/www/html',
        websocketEnabled: data.websocket_enabled ?? true,
        forwardHeaders: data.forward_headers ?? true,
        clientMaxBodySize: data.client_max_body_size || '50m',
        proxyConnectTimeout: data.proxy_connect_timeout || '5s',
        proxyReadTimeout: data.proxy_read_timeout || '60s',
        proxySendTimeout: data.proxy_send_timeout || '60s',
        isActive: data.is_active ?? true,
        configFilePath,
        notes: data.notes
      }
    });

    return this.formatServerForApi(server);
  }

  async updateServer(id, data) {
    const updateData = {};

    const fieldMap = {
      name: 'name',
      primary_domain: 'primaryDomain',
      additional_domains: 'additionalDomains',
      upstream_servers: 'upstreamServers',
      server_type: 'serverType',
      listen_port: 'listenPort',
      ssl_type: 'sslType',
      ssl_cert_path: 'sslCertPath',
      ssl_key_path: 'sslKeyPath',
      proxy_host: 'proxyHost',
      proxy_port: 'proxyPort',
      root_path: 'rootPath',
      websocket_enabled: 'websocketEnabled',
      forward_headers: 'forwardHeaders',
      client_max_body_size: 'clientMaxBodySize',
      proxy_connect_timeout: 'proxyConnectTimeout',
      proxy_read_timeout: 'proxyReadTimeout',
      proxy_send_timeout: 'proxySendTimeout',
      is_active: 'isActive',
      notes: 'notes'
    };

    for (const [apiField, prismaField] of Object.entries(fieldMap)) {
      if (data[apiField] !== undefined) {
        updateData[prismaField] = data[apiField];
      }
    }

    const server = await prisma.nginxServer.update({
      where: { id },
      data: updateData,
      include: { sslCerts: true }
    });

    return this.formatServerForApi(server);
  }

  async deleteServer(id) {
    const server = await prisma.nginxServer.findUnique({ where: { id } });
    if (!server) {
      throw new Error('Server not found');
    }

    if (server.configFilePath && fs.existsSync(server.configFilePath)) {
      const filename = path.basename(server.configFilePath);
      this.disableConfigFile(filename);
      fs.unlinkSync(server.configFilePath);
    }

    await prisma.nginxServer.delete({ where: { id } });
    return { success: true };
  }

  formatServerForApi(server) {
    if (!server) return null;
    return {
      id: server.id,
      name: server.name,
      primary_domain: server.primaryDomain,
      additional_domains: server.additionalDomains,
      upstream_servers: server.upstreamServers,
      server_type: server.serverType,
      listen_port: server.listenPort,
      ssl_type: server.sslType,
      ssl_cert_path: server.sslCertPath,
      ssl_key_path: server.sslKeyPath,
      proxy_host: server.proxyHost,
      proxy_port: server.proxyPort,
      root_path: server.rootPath,
      websocket_enabled: server.websocketEnabled,
      forward_headers: server.forwardHeaders,
      client_max_body_size: server.clientMaxBodySize,
      proxy_connect_timeout: server.proxyConnectTimeout,
      proxy_read_timeout: server.proxyReadTimeout,
      proxy_send_timeout: server.proxySendTimeout,
      is_active: server.isActive,
      config_file_path: server.configFilePath,
      notes: server.notes,
      created_at: server.createdAt,
      updated_at: server.updatedAt,
      ssl_certs: server.sslCerts?.map(cert => this.formatCertForApi(cert)) || []
    };
  }

  formatCertForApi(cert) {
    if (!cert) return null;
    return {
      id: cert.id,
      server_id: cert.serverId,
      domain: cert.domain,
      cert_path: cert.certPath,
      key_path: cert.keyPath,
      issuer: cert.issuer,
      expires_at: cert.expiresAt,
      auto_renew: cert.autoRenew,
      last_renewed: cert.lastRenewed,
      next_renewal: cert.nextRenewal,
      status: cert.status,
      fingerprint: cert.fingerprint,
      created_at: cert.createdAt
    };
  }

  // ==================== CONFIG GENERATION ====================

  generateNginxConfig(server) {
    const domains = [server.primary_domain, ...(server.additional_domains || [])].filter(Boolean).join(' ');

    let config = '';

    if (server.server_type === 'balancer' && server.upstream_servers?.length > 0) {
      const upstreamName = `upstream_${server.primary_domain.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const upstreamServers = server.upstream_servers.map(s => {
        let line = `    server ${s.ip || s.host}:${s.port}`;
        if (s.weight && s.weight !== 1 && s.weight !== '1') {
          line += ` weight=${s.weight}`;
        }
        if (s.backup) {
          line += ' backup';
        }
        return line + ';';
      }).join('\n');

      config += `upstream ${upstreamName} {\n${upstreamServers}\n}\n\n`;
    }

    if (server.ssl_type !== 'none') {
      config += `server {
    listen 80;
    server_name ${domains};
    return 301 https://$server_name$request_uri;
}

`;
    }

    const listenDirective = server.ssl_type !== 'none'
      ? `listen 443 ssl http2;`
      : `listen ${server.listen_port || 80};`;

    config += `server {
    ${listenDirective}
    server_name ${domains};
`;

    if (server.ssl_type !== 'none') {
      const certPath = server.ssl_cert_path || `/etc/letsencrypt/live/${server.primary_domain}/fullchain.pem`;
      const keyPath = server.ssl_key_path || `/etc/letsencrypt/live/${server.primary_domain}/privkey.pem`;
      config += `
    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
`;
    }

    if (server.server_type === 'static') {
      config += `
    root ${server.root_path || '/var/www/html'};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
`;
    } else {
      let proxyTarget;
      if (server.server_type === 'balancer') {
        const upstreamName = `upstream_${server.primary_domain.replace(/[^a-zA-Z0-9]/g, '_')}`;
        proxyTarget = `http://${upstreamName}`;
      } else {
        proxyTarget = `http://${server.proxy_host || 'localhost'}:${server.proxy_port || 3000}`;
      }

      config += `
    client_max_body_size ${server.client_max_body_size || '50m'};

    location / {
        proxy_pass ${proxyTarget};
        proxy_http_version 1.1;
`;

      if (server.websocket_enabled) {
        config += `        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
`;
      }

      if (server.forward_headers) {
        config += `        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
`;
      }

      config += `        proxy_connect_timeout ${server.proxy_connect_timeout || '5s'};
        proxy_read_timeout ${server.proxy_read_timeout || '60s'};
        proxy_send_timeout ${server.proxy_send_timeout || '60s'};
        proxy_buffering off;
    }
`;
    }

    config += `}
`;

    return config;
  }

  async generatePreview(serverId) {
    const server = await this.getServerById(serverId);
    if (!server) {
      throw new Error('Server not found');
    }
    return this.generateNginxConfig(server);
  }

  async applyConfig(serverId) {
    const server = await this.getServerById(serverId);
    if (!server) {
      throw new Error('Server not found');
    }

    const config = this.generateNginxConfig(server);
    const configFileName = path.basename(server.config_file_path);

    fs.writeFileSync(server.config_file_path, config);

    const testResult = this.testConfig();
    if (!testResult.valid) {
      if (fs.existsSync(server.config_file_path)) {
        fs.unlinkSync(server.config_file_path);
      }
      throw new Error(`Invalid Nginx configuration: ${testResult.error}`);
    }

    if (server.is_active && fs.existsSync(this.sitesAvailable)) {
      this.enableConfigFile(configFileName);
    }

    this.reload();

    return { success: true, config };
  }

  async getCurrentConfig(serverId) {
    const server = await this.getServerById(serverId);
    if (!server || !server.config_file_path) {
      throw new Error('Server or config file not found');
    }

    if (!fs.existsSync(server.config_file_path)) {
      return { content: '', exists: false };
    }

    const content = fs.readFileSync(server.config_file_path, 'utf8');
    return { content, exists: true };
  }

  // ==================== LOGS & METRICS ====================

  async getLogs(serverId, options = {}) {
    const { limit = 100, offset = 0, status, ip, path: reqPath, startDate, endDate } = options;

    try {
      const where = {};

      if (serverId) where.serverId = serverId;
      if (status) where.statusCode = status;
      if (ip) where.clientIp = ip;
      if (reqPath) where.requestPath = { contains: reqPath };
      if (startDate || endDate) {
        where.timestamp = {};
        if (startDate) where.timestamp.gte = new Date(startDate);
        if (endDate) where.timestamp.lte = new Date(endDate);
      }

      const logs = await prisma.nginxLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset
      });

      return logs.map(log => ({
        id: log.id,
        server_id: log.serverId,
        client_ip: log.clientIp,
        request_method: log.requestMethod,
        request_path: log.requestPath,
        status_code: log.statusCode,
        response_time_ms: log.responseTimeMs,
        bytes_sent: log.bytesSent,
        user_agent: log.userAgent,
        referer: log.referer,
        timestamp: log.timestamp
      }));
    } catch (err) {
      if (err.code === 'P2021') return [];
      throw err;
    }
  }

  async getMetrics(serverId, period = '24h') {
    const periodMap = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };
    const hours = periodMap[period] || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    try {
      const where = { timestamp: { gte: since } };
      if (serverId) where.serverId = serverId;

      const logs = await prisma.nginxLog.findMany({ where });

      const totalRequests = logs.length;
      const avgResponseTime = logs.length > 0
        ? Math.round(logs.reduce((sum, l) => sum + (l.responseTimeMs || 0), 0) / logs.length)
        : 0;
      const errorCount = logs.filter(l => l.statusCode >= 400).length;
      const errorRate = totalRequests > 0 ? Math.round((errorCount / totalRequests) * 10000) / 100 : 0;
      const totalBytes = logs.reduce((sum, l) => sum + (l.bytesSent || 0), 0);
      const uniqueVisitors = new Set(logs.map(l => l.clientIp)).size;

      const groupByMinutes = period === '1h' ? 5 : period === '24h' ? 60 : 60 * 24;
      const timeSeries = this.groupLogsByTime(logs, groupByMinutes);

      const statusGroups = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
      logs.forEach(l => {
        const code = l.statusCode;
        if (code >= 200 && code < 300) statusGroups['2xx']++;
        else if (code >= 300 && code < 400) statusGroups['3xx']++;
        else if (code >= 400 && code < 500) statusGroups['4xx']++;
        else if (code >= 500) statusGroups['5xx']++;
      });

      const statusDistribution = Object.entries(statusGroups).map(([status_group, count]) => ({
        status_group,
        count
      }));

      return {
        summary: {
          total_requests: totalRequests,
          avg_response_time: avgResponseTime,
          error_rate: errorRate,
          total_bytes: totalBytes,
          unique_visitors: uniqueVisitors
        },
        timeSeries,
        statusDistribution
      };
    } catch (err) {
      if (err.code === 'P2021') {
        return {
          summary: { total_requests: 0, avg_response_time: 0, error_rate: 0, total_bytes: 0, unique_visitors: 0 },
          timeSeries: [],
          statusDistribution: []
        };
      }
      throw err;
    }
  }

  groupLogsByTime(logs, minutesInterval) {
    const buckets = new Map();

    logs.forEach(log => {
      const timestamp = new Date(log.timestamp);
      const bucketTime = new Date(Math.floor(timestamp.getTime() / (minutesInterval * 60 * 1000)) * minutesInterval * 60 * 1000);
      const key = bucketTime.toISOString();

      if (!buckets.has(key)) {
        buckets.set(key, { requests: 0, totalResponseTime: 0, errors: 0 });
      }

      const bucket = buckets.get(key);
      bucket.requests++;
      bucket.totalResponseTime += log.responseTimeMs || 0;
      if (log.statusCode >= 400) bucket.errors++;
    });

    return Array.from(buckets.entries())
      .map(([time_bucket, data]) => ({
        time_bucket,
        requests: data.requests,
        avg_response_time: data.requests > 0 ? Math.round(data.totalResponseTime / data.requests) : 0,
        errors: data.errors
      }))
      .sort((a, b) => a.time_bucket.localeCompare(b.time_bucket));
  }

  async insertLog(logData) {
    try {
      await prisma.nginxLog.create({
        data: {
          serverId: logData.server_id,
          clientIp: logData.client_ip,
          requestMethod: logData.request_method,
          requestPath: logData.request_path,
          statusCode: logData.status_code,
          responseTimeMs: logData.response_time_ms,
          bytesSent: logData.bytes_sent,
          userAgent: logData.user_agent,
          referer: logData.referer,
          timestamp: logData.timestamp || new Date()
        }
      });
    } catch (err) {
      if (err.code !== 'P2021') {
        console.error('[NginxServerManager] Error inserting log:', err.message);
      }
    }
  }

  parseNginxLogLine(line) {
    const regex = /^(\S+) - \S+ \[([^\]]+)\] "(\S+) ([^"]+)" (\d+) (\d+) "([^"]*)" "([^"]*)"(?: (\d+\.?\d*))?$/;
    const match = line.match(regex);

    if (!match) return null;

    const [, clientIp, timeLocal, method, pathStr, status, bytes, referer, userAgent, responseTime] = match;

    return {
      client_ip: clientIp,
      request_method: method,
      request_path: pathStr.split(' ')[0],
      status_code: parseInt(status, 10),
      bytes_sent: parseInt(bytes, 10),
      referer: referer === '-' ? null : referer,
      user_agent: userAgent,
      response_time_ms: responseTime ? Math.round(parseFloat(responseTime) * 1000) : null,
      timestamp: this.parseNginxDate(timeLocal)
    };
  }

  parseNginxDate(dateStr) {
    const months = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };
    const match = dateStr.match(/(\d+)\/(\w+)\/(\d+):(\d+):(\d+):(\d+)/);
    if (!match) return new Date();

    const [, day, month, year, hour, min, sec] = match;
    return new Date(year, months[month], day, hour, min, sec);
  }

  // ==================== SSL CERTIFICATE MANAGEMENT ====================

  async getAllCerts() {
    try {
      const certs = await prisma.nginxSslCert.findMany({
        include: { server: { select: { name: true, primaryDomain: true } } },
        orderBy: { expiresAt: 'asc' }
      });
      return certs.map(cert => ({
        ...this.formatCertForApi(cert),
        server_name: cert.server?.name,
        primary_domain: cert.server?.primaryDomain
      }));
    } catch (err) {
      if (err.code === 'P2021') return [];
      throw err;
    }
  }

  async getCertsByServer(serverId) {
    try {
      const certs = await prisma.nginxSslCert.findMany({
        where: { serverId },
        orderBy: { expiresAt: 'asc' }
      });
      return certs.map(cert => this.formatCertForApi(cert));
    } catch (err) {
      if (err.code === 'P2021') return [];
      throw err;
    }
  }

  async syncCertFromFile(serverId, domain, certPath, keyPath) {
    try {
      if (!fs.existsSync(certPath)) {
        throw new Error('Certificate file not found');
      }

      const expiryOutput = execSync(`openssl x509 -in "${certPath}" -noout -enddate`, { encoding: 'utf8' });
      const issuerOutput = execSync(`openssl x509 -in "${certPath}" -noout -issuer`, { encoding: 'utf8' });
      const fingerprintOutput = execSync(`openssl x509 -in "${certPath}" -noout -fingerprint -sha256`, { encoding: 'utf8' });

      const expiryMatch = expiryOutput.match(/notAfter=(.+)/);
      const issuerMatch = issuerOutput.match(/O\s*=\s*([^,\/\n]+)/);
      const fingerprintMatch = fingerprintOutput.match(/SHA256 Fingerprint=(.+)/);

      const expiresAt = expiryMatch ? new Date(expiryMatch[1]) : null;
      const issuer = issuerMatch ? issuerMatch[1].trim() : 'Unknown';
      const fingerprint = fingerprintMatch ? fingerprintMatch[1].trim() : null;

      let status = 'valid';
      const daysLeft = expiresAt ? Math.floor((expiresAt - new Date()) / (1000 * 60 * 60 * 24)) : null;
      if (daysLeft !== null) {
        if (daysLeft <= 0) status = 'expired';
        else if (daysLeft <= 30) status = 'expiring_soon';
      }

      const nextRenewal = expiresAt ? new Date(expiresAt.getTime() - (30 * 24 * 60 * 60 * 1000)) : null;

      await prisma.nginxSslCert.upsert({
        where: { domain },
        create: {
          serverId,
          domain,
          certPath,
          keyPath,
          issuer,
          expiresAt,
          status,
          fingerprint,
          nextRenewal
        },
        update: {
          serverId,
          certPath,
          keyPath,
          issuer,
          expiresAt,
          status,
          fingerprint,
          nextRenewal
        }
      });

      return { success: true, status, daysLeft, expiresAt, issuer };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async renewCert(certId) {
    const cert = await prisma.nginxSslCert.findUnique({ where: { id: certId } });
    if (!cert) {
      throw new Error('Certificate not found');
    }

    try {
      execSync('command -v certbot', { stdio: 'pipe' });
      execSync(`certbot certonly --nginx -d ${cert.domain} --non-interactive --agree-tos`, {
        encoding: 'utf8',
        timeout: 120000
      });

      await prisma.nginxSslCert.update({
        where: { id: certId },
        data: { lastRenewed: new Date() }
      });

      await this.syncCertFromFile(cert.serverId, cert.domain, cert.certPath, cert.keyPath);
      return { success: true };
    } catch (err) {
      throw new Error(`Renewal failed: ${err.message}`);
    }
  }

  async toggleAutoRenew(certId, autoRenew) {
    await prisma.nginxSslCert.update({
      where: { id: certId },
      data: { autoRenew }
    });
    return { success: true };
  }

  // ==================== NGINX CONTROL ====================

  getTargetDir() {
    if (fs.existsSync(this.sitesAvailable)) return this.sitesAvailable;
    if (fs.existsSync(this.confD)) return this.confD;
    throw new Error('Nginx config directory not found');
  }

  testConfig() {
    try {
      execSync('nginx -t', { stdio: 'pipe' });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.stderr?.toString() || err.message };
    }
  }

  reload() {
    try {
      execSync('systemctl reload nginx', { stdio: 'pipe' });
      return { success: true };
    } catch (err) {
      try {
        execSync('nginx -s reload', { stdio: 'pipe' });
        return { success: true };
      } catch (err2) {
        throw new Error(`Failed to reload Nginx: ${err2.message}`);
      }
    }
  }

  restart() {
    try {
      execSync('systemctl restart nginx', { stdio: 'pipe' });
      return { success: true };
    } catch (err) {
      throw new Error(`Failed to restart Nginx: ${err.message}`);
    }
  }

  getStatus() {
    try {
      const output = execSync('systemctl is-active nginx', { encoding: 'utf8' }).trim();
      return { running: output === 'active', status: output };
    } catch {
      try {
        execSync('pgrep nginx', { stdio: 'pipe' });
        return { running: true, status: 'running' };
      } catch {
        return { running: false, status: 'stopped' };
      }
    }
  }

  enableConfigFile(filename) {
    if (!fs.existsSync(this.sitesEnabled)) return;

    const source = path.join(this.sitesAvailable, filename);
    const target = path.join(this.sitesEnabled, filename);

    if (fs.existsSync(source) && !fs.existsSync(target)) {
      fs.symlinkSync(source, target);
    }
  }

  disableConfigFile(filename) {
    if (!fs.existsSync(this.sitesEnabled)) return;

    const target = path.join(this.sitesEnabled, filename);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }

  async healthCheck() {
    const checks = {
      nginx: { ok: false, message: '' },
      database: { ok: false, message: '' },
      configDir: { ok: false, message: '' }
    };

    const nginxStatus = this.getStatus();
    checks.nginx.ok = nginxStatus.running;
    checks.nginx.message = nginxStatus.running ? 'Nginx is running' : 'Nginx is not running';

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database.ok = true;
      checks.database.message = 'Database connected';
    } catch (err) {
      checks.database.message = `Database error: ${err.message}`;
    }

    try {
      const configDir = this.getTargetDir();
      checks.configDir.ok = true;
      checks.configDir.message = `Config directory: ${configDir}`;
    } catch {
      checks.configDir.message = 'Config directory not found';
    }

    return checks;
  }

  // ==================== IMPORT EXISTING CONFIGS ====================

  async scanExistingConfigs() {
    const configs = [];
    const scannedFiles = new Set();

    // Scan sites-available
    if (fs.existsSync(this.sitesAvailable)) {
      const files = fs.readdirSync(this.sitesAvailable);
      for (const file of files) {
        if (file === 'default' || file.startsWith('.')) continue;
        const filePath = path.join(this.sitesAvailable, file);
        if (fs.statSync(filePath).isFile()) {
          const parsed = this.parseNginxConfigFile(filePath);
          if (parsed) {
            const enabledPath = path.join(this.sitesEnabled, file);
            parsed.is_enabled = fs.existsSync(enabledPath);
            configs.push(parsed);
            scannedFiles.add(file);
          }
        }
      }
    }

    // Scan conf.d
    if (fs.existsSync(this.confD)) {
      const files = fs.readdirSync(this.confD);
      for (const file of files) {
        if (!file.endsWith('.conf') || file.startsWith('.') || scannedFiles.has(file)) continue;
        const filePath = path.join(this.confD, file);
        if (fs.statSync(filePath).isFile()) {
          const parsed = this.parseNginxConfigFile(filePath);
          if (parsed) {
            parsed.is_enabled = true; // conf.d is always enabled
            configs.push(parsed);
          }
        }
      }
    }

    return configs;
  }

  parseNginxConfigFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const filename = path.basename(filePath);

      // Extract server_name
      const serverNameMatch = content.match(/server_name\s+([^;]+);/);
      if (!serverNameMatch) return null;

      const domains = serverNameMatch[1].trim().split(/\s+/).filter(d => d && d !== '_');
      if (domains.length === 0) return null;

      const primaryDomain = domains[0];
      const additionalDomains = domains.slice(1);

      // Extract listen port
      const listenMatch = content.match(/listen\s+(\d+)/);
      const listenPort = listenMatch ? parseInt(listenMatch[1], 10) : 80;

      // Check for SSL
      const hasSSL = content.includes('ssl_certificate') || content.includes('listen 443');
      const sslCertMatch = content.match(/ssl_certificate\s+([^;]+);/);
      const sslKeyMatch = content.match(/ssl_certificate_key\s+([^;]+);/);

      // Check server type
      let serverType = 'proxy';
      if (content.includes('upstream ')) {
        serverType = 'balancer';
      } else if (content.includes('root ') && !content.includes('proxy_pass')) {
        serverType = 'static';
      }

      // Extract proxy settings
      const proxyPassMatch = content.match(/proxy_pass\s+http:\/\/([^:\/]+):?(\d+)?/);
      let proxyHost = 'localhost';
      let proxyPort = 3000;
      if (proxyPassMatch) {
        proxyHost = proxyPassMatch[1];
        proxyPort = proxyPassMatch[2] ? parseInt(proxyPassMatch[2], 10) : 80;
      }

      // Extract root path for static sites
      const rootMatch = content.match(/root\s+([^;]+);/);
      const rootPath = rootMatch ? rootMatch[1].trim() : '/var/www/html';

      // Extract upstream servers for balancer
      const upstreamServers = [];
      if (serverType === 'balancer') {
        const upstreamMatch = content.match(/upstream\s+\w+\s*\{([^}]+)\}/);
        if (upstreamMatch) {
          const upstreamContent = upstreamMatch[1];
          const serverLines = upstreamContent.match(/server\s+([^;]+);/g);
          if (serverLines) {
            for (const line of serverLines) {
              const serverMatch = line.match(/server\s+([^:\s]+):?(\d+)?(?:\s+weight=(\d+))?(?:\s+(backup))?/);
              if (serverMatch) {
                upstreamServers.push({
                  host: serverMatch[1],
                  port: serverMatch[2] ? parseInt(serverMatch[2], 10) : 80,
                  weight: serverMatch[3] ? parseInt(serverMatch[3], 10) : 1,
                  backup: !!serverMatch[4]
                });
              }
            }
          }
        }
      }

      // Extract timeouts
      const connectTimeoutMatch = content.match(/proxy_connect_timeout\s+([^;]+);/);
      const readTimeoutMatch = content.match(/proxy_read_timeout\s+([^;]+);/);
      const sendTimeoutMatch = content.match(/proxy_send_timeout\s+([^;]+);/);
      const clientMaxBodyMatch = content.match(/client_max_body_size\s+([^;]+);/);

      // Check for websocket support
      const websocketEnabled = content.includes('Upgrade') && content.includes('upgrade');

      // Check for forward headers
      const forwardHeaders = content.includes('X-Real-IP') || content.includes('X-Forwarded-For');

      return {
        config_file_path: filePath,
        filename,
        name: primaryDomain,
        primary_domain: primaryDomain,
        additional_domains: additionalDomains,
        server_type: serverType,
        listen_port: listenPort,
        ssl_type: hasSSL ? 'letsencrypt' : 'none',
        ssl_cert_path: sslCertMatch ? sslCertMatch[1].trim() : null,
        ssl_key_path: sslKeyMatch ? sslKeyMatch[1].trim() : null,
        proxy_host: proxyHost,
        proxy_port: proxyPort,
        root_path: rootPath,
        upstream_servers: upstreamServers,
        websocket_enabled: websocketEnabled,
        forward_headers: forwardHeaders,
        client_max_body_size: clientMaxBodyMatch ? clientMaxBodyMatch[1].trim() : '50m',
        proxy_connect_timeout: connectTimeoutMatch ? connectTimeoutMatch[1].trim() : '5s',
        proxy_read_timeout: readTimeoutMatch ? readTimeoutMatch[1].trim() : '60s',
        proxy_send_timeout: sendTimeoutMatch ? sendTimeoutMatch[1].trim() : '60s',
        raw_config: content
      };
    } catch (err) {
      console.error(`[NginxServerManager] Error parsing ${filePath}:`, err.message);
      return null;
    }
  }

  async importConfig(configData) {
    // Check if already imported
    const existing = await prisma.nginxServer.findFirst({
      where: { primaryDomain: configData.primary_domain }
    });

    if (existing) {
      return { success: false, error: 'Server already exists', existing: this.formatServerForApi(existing) };
    }

    const server = await prisma.nginxServer.create({
      data: {
        name: configData.name,
        primaryDomain: configData.primary_domain,
        additionalDomains: configData.additional_domains || [],
        upstreamServers: configData.upstream_servers || [],
        serverType: configData.server_type || 'proxy',
        listenPort: configData.listen_port || 80,
        sslType: configData.ssl_type || 'none',
        sslCertPath: configData.ssl_cert_path,
        sslKeyPath: configData.ssl_key_path,
        proxyHost: configData.proxy_host || 'localhost',
        proxyPort: configData.proxy_port || 3000,
        rootPath: configData.root_path || '/var/www/html',
        websocketEnabled: configData.websocket_enabled ?? true,
        forwardHeaders: configData.forward_headers ?? true,
        clientMaxBodySize: configData.client_max_body_size || '50m',
        proxyConnectTimeout: configData.proxy_connect_timeout || '5s',
        proxyReadTimeout: configData.proxy_read_timeout || '60s',
        proxySendTimeout: configData.proxy_send_timeout || '60s',
        isActive: configData.is_enabled ?? true,
        configFilePath: configData.config_file_path,
        notes: `Imported from ${configData.filename}`
      }
    });

    // Sync SSL cert if exists
    if (configData.ssl_cert_path && fs.existsSync(configData.ssl_cert_path)) {
      await this.syncCertFromFile(
        server.id,
        configData.primary_domain,
        configData.ssl_cert_path,
        configData.ssl_key_path
      );
    }

    return { success: true, server: this.formatServerForApi(server) };
  }

  async importAllConfigs() {
    const configs = await this.scanExistingConfigs();
    const results = {
      imported: [],
      skipped: [],
      errors: []
    };

    for (const config of configs) {
      try {
        const result = await this.importConfig(config);
        if (result.success) {
          results.imported.push({ domain: config.primary_domain, server: result.server });
        } else if (result.existing) {
          results.skipped.push({ domain: config.primary_domain, reason: result.error });
        }
      } catch (err) {
        results.errors.push({ domain: config.primary_domain, error: err.message });
      }
    }

    return results;
  }
}

module.exports = NginxServerManager;
