'use strict';

/**
 * NginxStackIntegration — configura Nginx automaticamente baseado nos serviços da stack.
 *
 * Para cada serviço com domainMode != 'none':
 *   - 'subdomain' → cria/atualiza arquivo separado (subdominio.conf)
 *   - 'path' → adiciona location no arquivo principal da stack
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class NginxStackIntegration {
  constructor() {
    this.sitesAvailable = process.env.NGINX_SITES_AVAILABLE || '/etc/nginx/sites-available';
    this.sitesEnabled = process.env.NGINX_SITES_ENABLED || '/etc/nginx/sites-enabled';
    this.backupDir = process.env.NGINX_BACKUP_DIR || '/etc/nginx/provirpanel-backups';
  }

  /**
   * Aplica configuração Nginx para uma stack inteira.
   * Chamado após startStack com sucesso.
   */
  applyForStack(stack) {
    const services = (stack.services || []).filter((s) => s.domainMode && s.domainMode !== 'none');
    if (!services.length) return { applied: false, reason: 'Nenhum serviço com acesso configurado' };

    const pathServices = services.filter((s) => s.domainMode === 'path');
    const subdomainServices = services.filter((s) => s.domainMode === 'subdomain');

    const results = [];

    // Path-based services → single config file for the stack
    if (pathServices.length > 0) {
      const result = this._applyPathConfig(stack, pathServices);
      results.push(result);
    }

    // Subdomain services → one config per subdomain
    for (const svc of subdomainServices) {
      const result = this._applySubdomainConfig(stack, svc);
      results.push(result);
    }

    // Test and reload
    const testResult = this._testConfig();
    if (!testResult.valid) {
      return { applied: false, error: testResult.error, results };
    }

    this._reload();
    return { applied: true, results };
  }

  /**
   * Gera config para serviços com domainMode='path' (proxy_pass por caminho).
   */
  _applyPathConfig(stack, services) {
    const filename = `provir-stack-${stack.id.slice(0, 8)}.conf`;
    const filePath = path.join(this.sitesAvailable, filename);

    const locations = services.map((svc) => {
      const port = svc.exposedPort || svc.ports?.[0]?.container || 3000;
      const host = svc.bindLocalOnly !== false ? '127.0.0.1' : '0.0.0.0';
      const pathPrefix = svc.pathPrefix || `/${svc.name}/`;
      return `    location ${pathPrefix} {
        proxy_pass http://${host}:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix ${pathPrefix.replace(/\/$/, '')};
    }`;
    }).join('\n\n');

    const config = `# ProvirPanel Stack: ${stack.name} (${stack.id.slice(0, 8)})
# Auto-generated — do not edit manually

${locations}
`;

    this._writeConfig(filePath, config);
    this._enableSite(filename);
    return { type: 'path', filename, services: services.map((s) => s.name) };
  }

  /**
   * Gera config para um serviço com domainMode='subdomain'.
   */
  _applySubdomainConfig(stack, svc) {
    const subdomain = svc.subdomain || svc.name;
    const filename = `provir-${subdomain}.conf`;
    const filePath = path.join(this.sitesAvailable, filename);
    const port = svc.exposedPort || svc.ports?.[0]?.container || 3000;
    const host = svc.bindLocalOnly !== false ? '127.0.0.1' : '0.0.0.0';

    const config = `# ProvirPanel Stack: ${stack.name} — Service: ${svc.name}
# Subdomain: ${subdomain}
# Auto-generated — do not edit manually

server {
    listen 80;
    server_name ${subdomain}.*;

    location / {
        proxy_pass http://${host}:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;

    this._writeConfig(filePath, config);
    this._enableSite(filename);
    return { type: 'subdomain', filename, subdomain, service: svc.name };
  }

  _writeConfig(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(filePath)) {
      // Backup
      fs.mkdirSync(this.backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
      fs.copyFileSync(filePath, path.join(this.backupDir, `${path.basename(filePath)}.bak-${stamp}`));
    }
    fs.writeFileSync(filePath, content);
  }

  _enableSite(filename) {
    if (!fs.existsSync(this.sitesEnabled)) return;
    const target = path.join(this.sitesEnabled, filename);
    const source = path.join(this.sitesAvailable, filename);
    if (!fs.existsSync(target)) {
      try { fs.symlinkSync(source, target); } catch { /* ignore */ }
    }
  }

  _testConfig() {
    const commands = ['sudo -n nginx -t', 'nginx -t'];
    for (const cmd of commands) {
      try {
        execSync(cmd, { stdio: 'pipe', timeout: 10000 });
        return { valid: true };
      } catch (err) {
        const stderr = err.stderr?.toString() || '';
        if (stderr.includes('Permission denied') || stderr.includes('EACCES')) continue;
        return { valid: false, error: stderr || err.message };
      }
    }
    return { valid: false, error: 'Cannot run nginx -t' };
  }

  _reload() {
    const commands = ['sudo -n nginx -s reload', 'sudo -n systemctl reload nginx', 'nginx -s reload'];
    for (const cmd of commands) {
      try { execSync(cmd, { stdio: 'pipe', timeout: 10000 }); return; } catch { /* next */ }
    }
  }
}

module.exports = NginxStackIntegration;
