'use strict';

/**
 * Zeus Heartbeat Service
 * Periodically pushes local panel context to the Zeus AI hub.
 * Runs as a background interval inside the panel backend.
 */

const fs = require('fs');
const path = require('path');

const INTERVAL_MS = parseInt(process.env.ZEUS_HEARTBEAT_INTERVAL || '300000', 10); // 5 min default
const GATEWAY_URL = process.env.ZEUS_GATEWAY_URL;
const PANEL_ID = process.env.ZEUS_PANEL_ID;
const PANEL_API_KEY = process.env.ZEUS_PANEL_API_KEY;

let intervalHandle = null;

const collectContext = async () => {
  const context = {};

  // Collect sites (try JSON file first, then API)
  try {
    const sitesFile = path.join(__dirname, '../../data/sites.json');
    if (fs.existsSync(sitesFile)) {
      const sites = JSON.parse(fs.readFileSync(sitesFile, 'utf-8'));
      context.sites = (Array.isArray(sites) ? sites : []).map(s => ({
        id: s.id, name: s.name, domain: s.domain,
        status: s.status || 'active', behindProxy: s.behindProxy, ssl: s.ssl
      }));
    }
  } catch {}
  if (!context.sites) {
    try {
      const port = process.env.PORT || 3000;
      const res = await fetch(`http://localhost:${port}/api/sites`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = await res.json();
        const sites = data.sites || data || [];
        context.sites = sites.map(s => ({
          id: s.id, name: s.name, domain: s.domain,
          status: s.status || 'active', behindProxy: s.behindProxy, ssl: s.ssl
        }));
      }
    } catch {}
  }

  // Collect docker services
  try {
    const { execSync } = require('child_process');
    const output = execSync('docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}"', {
      encoding: 'utf-8', timeout: 10000
    });
    context.services = output.trim().split('\n').filter(Boolean).map(line => {
      const [name, image, status, ports] = line.split('|');
      return { name, image, status, ports };
    });
  } catch {}

  // Collect nginx configs
  try {
    const { execSync } = require('child_process');
    const sitesEnabled = '/etc/nginx/sites-enabled';
    if (fs.existsSync(sitesEnabled)) {
      const files = fs.readdirSync(sitesEnabled).filter(f => f !== 'default' && !f.startsWith('.'));
      context.nginx = files.map(f => {
        const filePath = path.join('/etc/nginx/sites-available', f);
        let domains = [f.replace(/\.conf$/, '')];
        let proxyPass = null, listen = null, ssl = false;
        try {
          const content = fs.readFileSync(fs.existsSync(filePath) ? filePath : path.join(sitesEnabled, f), 'utf-8');
          const nameMatch = content.match(/server_name\s+([^;]+);/);
          if (nameMatch) domains = nameMatch[1].trim().split(/\s+/).filter(d => d && d !== '_');
          const proxyMatch = content.match(/proxy_pass\s+(https?:\/\/[^;\s]+)/);
          if (proxyMatch) proxyPass = proxyMatch[1];
          const listenMatch = content.match(/listen\s+(\d+)/);
          if (listenMatch) listen = listenMatch[1];
          ssl = /ssl_certificate/.test(content) || /listen\s+443/.test(content);
        } catch {}
        return { file: f, domains, enabled: true, proxyPass, listen, ssl };
      });
    }
  } catch {}

  // Collect disk usage
  try {
    const { execSync } = require('child_process');
    const dfOutput = execSync("df -h / --output=size,used,avail,pcent | tail -1", { encoding: 'utf-8', timeout: 5000 });
    const parts = dfOutput.trim().split(/\s+/);
    if (parts.length >= 4) {
      context.disk = { total: parts[0], used: parts[1], available: parts[2], usedPercent: parts[3] };
    }
  } catch {}

  // Collect recent error logs (last 10 lines of nginx error log)
  try {
    const errorLog = '/var/log/nginx/error.log';
    if (fs.existsSync(errorLog)) {
      const { execSync } = require('child_process');
      const lines = execSync(`tail -10 ${errorLog}`, { encoding: 'utf-8', timeout: 5000 });
      context.recentErrors = lines.trim().split('\n').filter(Boolean).slice(-5);
    }
  } catch {}

  // Collect database connections (names only, no passwords)
  try {
    const port = process.env.PORT || 3000;
    const res = await fetch(`http://localhost:${port}/api/database-connections`, {
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      const conns = Array.isArray(data) ? data : (data.connections || []);
      context.databases = conns.map(c => ({ id: c.id, name: c.name, type: c.type, host: c.host, database: c.database }));
    }
  } catch {}

  // Collect system metrics
  try {
    const os = require('os');
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    context.metrics = {
      cpu: { cores: cpus.length, model: cpus[0]?.model },
      memory: { total: Math.round(totalMem / 1024 / 1024), free: Math.round(freeMem / 1024 / 1024), usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100) },
      uptime: Math.round(os.uptime() / 3600) + 'h',
      loadavg: os.loadavg().map(l => l.toFixed(2))
    };
  } catch {}

  return context;
};

const sendHeartbeat = async () => {
  if (!GATEWAY_URL || !PANEL_ID || !PANEL_API_KEY) return;

  try {
    const context = await collectContext();
    const API_KEY = process.env.ZEUS_API_KEY || '';
    const res = await fetch(`${GATEWAY_URL}/api/panels/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ panelId: PANEL_ID, apiKey: PANEL_API_KEY, context }),
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) {
      console.log('[Zeus Heartbeat] Sent successfully');
    } else {
      console.error('[Zeus Heartbeat] Failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('[Zeus Heartbeat] Error:', err.message);
  }
};

const start = () => {
  if (!GATEWAY_URL || !PANEL_ID || !PANEL_API_KEY) {
    console.log('[Zeus Heartbeat] Not configured (missing ZEUS_GATEWAY_URL, ZEUS_PANEL_ID, or ZEUS_PANEL_API_KEY)');
    return;
  }
  console.log(`[Zeus Heartbeat] Starting (interval: ${INTERVAL_MS / 1000}s, gateway: ${GATEWAY_URL})`);
  // Send first heartbeat after 10s (let server boot)
  setTimeout(() => {
    sendHeartbeat();
    intervalHandle = setInterval(sendHeartbeat, INTERVAL_MS);
  }, 10000);
};

const stop = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};

module.exports = { start, stop, sendHeartbeat };
