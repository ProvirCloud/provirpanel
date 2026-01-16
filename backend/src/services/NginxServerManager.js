'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const pool = require('../config/database');

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
    const result = await pool.query(`
      SELECT
        s.*,
        COALESCE(
          (SELECT json_agg(c.*) FROM nginx_ssl_certs c WHERE c.server_id = s.id),
          '[]'
        ) as ssl_certs
      FROM nginx_servers s
      ORDER BY s.created_at DESC
    `);
    return result.rows;
  }

  async getServerById(id) {
    const result = await pool.query(`
      SELECT
        s.*,
        COALESCE(
          (SELECT json_agg(c.*) FROM nginx_ssl_certs c WHERE c.server_id = s.id),
          '[]'
        ) as ssl_certs
      FROM nginx_servers s
      WHERE s.id = $1
    `, [id]);
    return result.rows[0] || null;
  }

  async createServer(data) {
    const {
      name,
      primary_domain,
      additional_domains = [],
      upstream_servers = [],
      server_type = 'proxy',
      listen_port = 80,
      ssl_type = 'none',
      ssl_cert_path,
      ssl_key_path,
      proxy_host = 'localhost',
      proxy_port = 3000,
      root_path = '/var/www/html',
      websocket_enabled = true,
      forward_headers = true,
      client_max_body_size = '50m',
      proxy_connect_timeout = '5s',
      proxy_read_timeout = '60s',
      proxy_send_timeout = '60s',
      is_active = true,
      notes
    } = data;

    const configFileName = `${primary_domain.replace(/[^a-zA-Z0-9.-]/g, '_')}.conf`;
    const configFilePath = path.join(this.getTargetDir(), configFileName);

    const result = await pool.query(`
      INSERT INTO nginx_servers (
        name, primary_domain, additional_domains, upstream_servers,
        server_type, listen_port, ssl_type, ssl_cert_path, ssl_key_path,
        proxy_host, proxy_port, root_path, websocket_enabled, forward_headers,
        client_max_body_size, proxy_connect_timeout, proxy_read_timeout,
        proxy_send_timeout, is_active, config_file_path, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `, [
      name, primary_domain, additional_domains, JSON.stringify(upstream_servers),
      server_type, listen_port, ssl_type, ssl_cert_path, ssl_key_path,
      proxy_host, proxy_port, root_path, websocket_enabled, forward_headers,
      client_max_body_size, proxy_connect_timeout, proxy_read_timeout,
      proxy_send_timeout, is_active, configFilePath, notes
    ]);

    return result.rows[0];
  }

  async updateServer(id, data) {
    const server = await this.getServerById(id);
    if (!server) {
      throw new Error('Server not found');
    }

    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = [
      'name', 'primary_domain', 'additional_domains', 'upstream_servers',
      'server_type', 'listen_port', 'ssl_type', 'ssl_cert_path', 'ssl_key_path',
      'proxy_host', 'proxy_port', 'root_path', 'websocket_enabled', 'forward_headers',
      'client_max_body_size', 'proxy_connect_timeout', 'proxy_read_timeout',
      'proxy_send_timeout', 'is_active', 'notes'
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = $${paramCount}`);
        if (field === 'upstream_servers') {
          values.push(JSON.stringify(data[field]));
        } else {
          values.push(data[field]);
        }
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return server;
    }

    values.push(id);
    const result = await pool.query(`
      UPDATE nginx_servers
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `, values);

    return result.rows[0];
  }

  async deleteServer(id) {
    const server = await this.getServerById(id);
    if (!server) {
      throw new Error('Server not found');
    }

    // Remove config file if exists
    if (server.config_file_path && fs.existsSync(server.config_file_path)) {
      const filename = path.basename(server.config_file_path);
      this.disableConfigFile(filename);
      fs.unlinkSync(server.config_file_path);
    }

    await pool.query('DELETE FROM nginx_servers WHERE id = $1', [id]);
    return { success: true };
  }

  // ==================== CONFIG GENERATION ====================

  generateNginxConfig(server) {
    const domains = [server.primary_domain, ...(server.additional_domains || [])].filter(Boolean).join(' ');

    let config = '';

    // Upstream block for load balancer
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

    // SSL redirect block
    if (server.ssl_type !== 'none') {
      config += `server {
    listen 80;
    server_name ${domains};
    return 301 https://$server_name$request_uri;
}

`;
    }

    // Main server block
    const listenDirective = server.ssl_type !== 'none'
      ? `listen 443 ssl http2;`
      : `listen ${server.listen_port || 80};`;

    config += `server {
    ${listenDirective}
    server_name ${domains};
`;

    // SSL configuration
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

    // Location blocks based on server type
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
      // Proxy or Load Balancer
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

    // Write config file
    fs.writeFileSync(server.config_file_path, config);

    // Test configuration
    const testResult = this.testConfig();
    if (!testResult.valid) {
      // Rollback - delete the file
      if (fs.existsSync(server.config_file_path)) {
        fs.unlinkSync(server.config_file_path);
      }
      throw new Error(`Invalid Nginx configuration: ${testResult.error}`);
    }

    // Enable if active
    if (server.is_active && fs.existsSync(this.sitesAvailable)) {
      this.enableConfigFile(configFileName);
    }

    // Reload Nginx
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

    let query = 'SELECT * FROM nginx_logs WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (serverId) {
      query += ` AND server_id = $${paramCount}`;
      params.push(serverId);
      paramCount++;
    }

    if (status) {
      query += ` AND status_code = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (ip) {
      query += ` AND client_ip = $${paramCount}`;
      params.push(ip);
      paramCount++;
    }

    if (reqPath) {
      query += ` AND request_path LIKE $${paramCount}`;
      params.push(`%${reqPath}%`);
      paramCount++;
    }

    if (startDate) {
      query += ` AND timestamp >= $${paramCount}`;
      params.push(startDate);
      paramCount++;
    }

    if (endDate) {
      query += ` AND timestamp <= $${paramCount}`;
      params.push(endDate);
      paramCount++;
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }

  async getMetrics(serverId, period = '24h') {
    const periodMap = {
      '1h': '1 hour',
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days'
    };
    const interval = periodMap[period] || '24 hours';

    // Get aggregated metrics
    const metricsQuery = await pool.query(`
      SELECT
        COUNT(*) as total_requests,
        ROUND(AVG(response_time_ms)::numeric, 2) as avg_response_time,
        ROUND(AVG(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) * 100, 2) as error_rate,
        SUM(bytes_sent) as total_bytes,
        COUNT(DISTINCT client_ip) as unique_visitors
      FROM nginx_logs
      WHERE ($1::int IS NULL OR server_id = $1)
        AND timestamp >= NOW() - INTERVAL '${interval}'
    `, [serverId || null]);

    // Get requests per minute/hour based on period
    const groupBy = period === '1h' ? 'minute' : period === '24h' ? 'hour' : 'day';
    const timeSeriesQuery = await pool.query(`
      SELECT
        date_trunc('${groupBy}', timestamp) as time_bucket,
        COUNT(*) as requests,
        ROUND(AVG(response_time_ms)::numeric, 2) as avg_response_time,
        COUNT(CASE WHEN status_code >= 400 THEN 1 END) as errors
      FROM nginx_logs
      WHERE ($1::int IS NULL OR server_id = $1)
        AND timestamp >= NOW() - INTERVAL '${interval}'
      GROUP BY time_bucket
      ORDER BY time_bucket
    `, [serverId || null]);

    // Get status code distribution
    const statusQuery = await pool.query(`
      SELECT
        CASE
          WHEN status_code >= 200 AND status_code < 300 THEN '2xx'
          WHEN status_code >= 300 AND status_code < 400 THEN '3xx'
          WHEN status_code >= 400 AND status_code < 500 THEN '4xx'
          WHEN status_code >= 500 THEN '5xx'
          ELSE 'other'
        END as status_group,
        COUNT(*) as count
      FROM nginx_logs
      WHERE ($1::int IS NULL OR server_id = $1)
        AND timestamp >= NOW() - INTERVAL '${interval}'
      GROUP BY status_group
    `, [serverId || null]);

    return {
      summary: metricsQuery.rows[0] || {},
      timeSeries: timeSeriesQuery.rows,
      statusDistribution: statusQuery.rows
    };
  }

  async insertLog(logData) {
    const {
      server_id,
      client_ip,
      request_method,
      request_path,
      status_code,
      response_time_ms,
      bytes_sent,
      user_agent,
      referer,
      timestamp
    } = logData;

    await pool.query(`
      INSERT INTO nginx_logs (
        server_id, client_ip, request_method, request_path,
        status_code, response_time_ms, bytes_sent, user_agent, referer, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      server_id, client_ip, request_method, request_path,
      status_code, response_time_ms, bytes_sent, user_agent, referer,
      timestamp || new Date()
    ]);
  }

  parseNginxLogLine(line) {
    // Standard Nginx combined log format:
    // $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" $request_time
    const regex = /^(\S+) - \S+ \[([^\]]+)\] "(\S+) ([^"]+)" (\d+) (\d+) "([^"]*)" "([^"]*)"(?: (\d+\.?\d*))?$/;
    const match = line.match(regex);

    if (!match) return null;

    const [, clientIp, timeLocal, method, path, status, bytes, referer, userAgent, responseTime] = match;

    return {
      client_ip: clientIp,
      request_method: method,
      request_path: path.split(' ')[0],
      status_code: parseInt(status, 10),
      bytes_sent: parseInt(bytes, 10),
      referer: referer === '-' ? null : referer,
      user_agent: userAgent,
      response_time_ms: responseTime ? Math.round(parseFloat(responseTime) * 1000) : null,
      timestamp: this.parseNginxDate(timeLocal)
    };
  }

  parseNginxDate(dateStr) {
    // Format: 10/Jan/2024:13:55:36 +0000
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
    const result = await pool.query(`
      SELECT c.*, s.name as server_name, s.primary_domain
      FROM nginx_ssl_certs c
      LEFT JOIN nginx_servers s ON s.id = c.server_id
      ORDER BY c.expires_at ASC
    `);
    return result.rows;
  }

  async getCertsByServer(serverId) {
    const result = await pool.query(`
      SELECT * FROM nginx_ssl_certs
      WHERE server_id = $1
      ORDER BY expires_at ASC
    `, [serverId]);
    return result.rows;
  }

  async syncCertFromFile(serverId, domain, certPath, keyPath) {
    try {
      if (!fs.existsSync(certPath)) {
        throw new Error('Certificate file not found');
      }

      // Get certificate info using openssl
      const expiryOutput = execSync(`openssl x509 -in "${certPath}" -noout -enddate`, { encoding: 'utf8' });
      const issuerOutput = execSync(`openssl x509 -in "${certPath}" -noout -issuer`, { encoding: 'utf8' });
      const fingerprintOutput = execSync(`openssl x509 -in "${certPath}" -noout -fingerprint -sha256`, { encoding: 'utf8' });

      const expiryMatch = expiryOutput.match(/notAfter=(.+)/);
      const issuerMatch = issuerOutput.match(/O\s*=\s*([^,\/\n]+)/);
      const fingerprintMatch = fingerprintOutput.match(/SHA256 Fingerprint=(.+)/);

      const expiresAt = expiryMatch ? new Date(expiryMatch[1]) : null;
      const issuer = issuerMatch ? issuerMatch[1].trim() : 'Unknown';
      const fingerprint = fingerprintMatch ? fingerprintMatch[1].trim() : null;

      // Calculate status and next renewal
      let status = 'valid';
      const daysLeft = expiresAt ? Math.floor((expiresAt - new Date()) / (1000 * 60 * 60 * 24)) : null;
      if (daysLeft !== null) {
        if (daysLeft <= 0) status = 'expired';
        else if (daysLeft <= 30) status = 'expiring_soon';
      }

      const nextRenewal = expiresAt ? new Date(expiresAt.getTime() - (30 * 24 * 60 * 60 * 1000)) : null;

      // Upsert certificate
      await pool.query(`
        INSERT INTO nginx_ssl_certs (
          server_id, domain, cert_path, key_path, issuer,
          expires_at, status, fingerprint, next_renewal
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (domain) DO UPDATE SET
          server_id = EXCLUDED.server_id,
          cert_path = EXCLUDED.cert_path,
          key_path = EXCLUDED.key_path,
          issuer = EXCLUDED.issuer,
          expires_at = EXCLUDED.expires_at,
          status = EXCLUDED.status,
          fingerprint = EXCLUDED.fingerprint,
          next_renewal = EXCLUDED.next_renewal
      `, [serverId, domain, certPath, keyPath, issuer, expiresAt, status, fingerprint, nextRenewal]);

      return { success: true, status, daysLeft, expiresAt, issuer };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async renewCert(certId) {
    const certResult = await pool.query('SELECT * FROM nginx_ssl_certs WHERE id = $1', [certId]);
    const cert = certResult.rows[0];

    if (!cert) {
      throw new Error('Certificate not found');
    }

    try {
      // Check if certbot is installed
      execSync('command -v certbot', { stdio: 'pipe' });

      // Run certbot renew for specific domain
      execSync(`certbot certonly --nginx -d ${cert.domain} --non-interactive --agree-tos`, {
        encoding: 'utf8',
        timeout: 120000
      });

      // Update certificate info
      await pool.query(`
        UPDATE nginx_ssl_certs
        SET last_renewed = NOW()
        WHERE id = $1
      `, [certId]);

      // Re-sync to get new expiry date
      await this.syncCertFromFile(cert.server_id, cert.domain, cert.cert_path, cert.key_path);

      return { success: true };
    } catch (err) {
      throw new Error(`Renewal failed: ${err.message}`);
    }
  }

  async toggleAutoRenew(certId, autoRenew) {
    await pool.query(`
      UPDATE nginx_ssl_certs
      SET auto_renew = $2
      WHERE id = $1
    `, [certId, autoRenew]);
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
      // Try alternative reload method
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
      // Check if nginx process is running
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

  // ==================== HEALTH CHECK ====================

  async healthCheck() {
    const checks = {
      nginx: { ok: false, message: '' },
      database: { ok: false, message: '' },
      configDir: { ok: false, message: '' }
    };

    // Check Nginx status
    const nginxStatus = this.getStatus();
    checks.nginx.ok = nginxStatus.running;
    checks.nginx.message = nginxStatus.running ? 'Nginx is running' : 'Nginx is not running';

    // Check database connection
    try {
      await pool.query('SELECT 1');
      checks.database.ok = true;
      checks.database.message = 'Database connected';
    } catch (err) {
      checks.database.message = `Database error: ${err.message}`;
    }

    // Check config directory
    const configDir = this.getTargetDir();
    if (fs.existsSync(configDir)) {
      checks.configDir.ok = true;
      checks.configDir.message = `Config directory: ${configDir}`;
    } else {
      checks.configDir.message = 'Config directory not found';
    }

    return checks;
  }
}

module.exports = NginxServerManager;
