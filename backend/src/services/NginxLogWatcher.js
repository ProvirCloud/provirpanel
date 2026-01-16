'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const NginxServerManager = require('./NginxServerManager');

class NginxLogWatcher extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
    this.manager = new NginxServerManager();
    this.logPath = '/var/log/nginx/access.log';
    this.errorLogPath = '/var/log/nginx/error.log';
    this.tailProcess = null;
    this.errorTailProcess = null;
    this.isWatching = false;
    this.clients = new Map();
    this.domainToServerMap = new Map();
    this.saveToDb = true;
    this.batchSize = 50;
    this.logBuffer = [];
    this.flushInterval = null;
  }

  async init() {
    await this.refreshDomainMap();
    this.setupNamespace();
  }

  async refreshDomainMap() {
    try {
      const servers = await this.manager.getAllServers();
      this.domainToServerMap.clear();

      for (const server of servers) {
        this.domainToServerMap.set(server.primary_domain, server.id);
        if (server.additional_domains) {
          for (const domain of server.additional_domains) {
            this.domainToServerMap.set(domain, server.id);
          }
        }
      }
    } catch (err) {
      console.error('[NginxLogWatcher] Error refreshing domain map:', err.message);
    }
  }

  setupNamespace() {
    const namespace = this.io.of('/api/nginx/logs');

    namespace.on('connection', (socket) => {
      console.log('[NginxLogWatcher] Client connected:', socket.id);

      // Authenticate
      const token = socket.handshake.auth?.token ||
                   socket.handshake.query?.token;

      if (!token) {
        socket.emit('error', { message: 'Authentication required' });
        socket.disconnect();
        return;
      }

      // Store client preferences
      this.clients.set(socket.id, {
        serverId: null,
        filters: {}
      });

      // Start watching if first client
      if (this.clients.size === 1) {
        this.startWatching();
      }

      // Handle filter changes
      socket.on('filter', (data) => {
        const client = this.clients.get(socket.id);
        if (client) {
          client.serverId = data.serverId || null;
          client.filters = data.filters || {};
        }
      });

      // Handle subscription to specific server
      socket.on('subscribe', (serverId) => {
        const client = this.clients.get(socket.id);
        if (client) {
          client.serverId = serverId;
        }
        socket.join(`server:${serverId}`);
      });

      socket.on('unsubscribe', (serverId) => {
        socket.leave(`server:${serverId}`);
        const client = this.clients.get(socket.id);
        if (client) {
          client.serverId = null;
        }
      });

      // Handle request for recent logs
      socket.on('get-recent', async (options) => {
        try {
          const logs = await this.manager.getLogs(
            options.serverId,
            { limit: options.limit || 100 }
          );
          socket.emit('recent-logs', logs);
        } catch (err) {
          socket.emit('error', { message: err.message });
        }
      });

      socket.on('disconnect', () => {
        console.log('[NginxLogWatcher] Client disconnected:', socket.id);
        this.clients.delete(socket.id);

        // Stop watching if no clients
        if (this.clients.size === 0) {
          this.stopWatching();
        }
      });
    });
  }

  startWatching() {
    if (this.isWatching) return;

    console.log('[NginxLogWatcher] Starting log watch...');
    this.isWatching = true;

    // Watch access log
    if (fs.existsSync(this.logPath)) {
      this.tailProcess = spawn('tail', ['-F', '-n', '0', this.logPath]);

      this.tailProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          this.processLogLine(line, 'access');
        }
      });

      this.tailProcess.stderr.on('data', (data) => {
        console.error('[NginxLogWatcher] tail stderr:', data.toString());
      });

      this.tailProcess.on('close', (code) => {
        console.log('[NginxLogWatcher] Access log tail process closed with code:', code);
        if (this.isWatching) {
          // Restart if unexpected close
          setTimeout(() => this.startWatching(), 5000);
        }
      });
    } else {
      console.warn('[NginxLogWatcher] Access log not found:', this.logPath);
    }

    // Watch error log
    if (fs.existsSync(this.errorLogPath)) {
      this.errorTailProcess = spawn('tail', ['-F', '-n', '0', this.errorLogPath]);

      this.errorTailProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          this.processLogLine(line, 'error');
        }
      });
    }

    // Start flush interval for batch inserts
    this.flushInterval = setInterval(() => this.flushBuffer(), 5000);
  }

  stopWatching() {
    console.log('[NginxLogWatcher] Stopping log watch...');
    this.isWatching = false;

    if (this.tailProcess) {
      this.tailProcess.kill();
      this.tailProcess = null;
    }

    if (this.errorTailProcess) {
      this.errorTailProcess.kill();
      this.errorTailProcess = null;
    }

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Flush remaining logs
    this.flushBuffer();
  }

  processLogLine(line, type) {
    const parsed = this.manager.parseNginxLogLine(line);

    if (!parsed) {
      // Emit raw line for error logs or unparseable lines
      if (type === 'error') {
        this.emitToClients('error-log', { raw: line, timestamp: new Date() });
      }
      return;
    }

    // Try to find server ID from request Host header (would need to parse from log)
    // For now, try matching path patterns or use null
    let serverId = null;

    // Add to buffer for database insertion
    if (this.saveToDb) {
      this.logBuffer.push({
        ...parsed,
        server_id: serverId
      });

      if (this.logBuffer.length >= this.batchSize) {
        this.flushBuffer();
      }
    }

    // Format for real-time display
    const logEntry = {
      ...parsed,
      id: Date.now() + Math.random(),
      type,
      raw: line
    };

    // Emit to clients
    this.emitToClients('log', logEntry);

    // Also emit to server-specific rooms if we have a server ID
    if (serverId) {
      this.io.of('/api/nginx/logs').to(`server:${serverId}`).emit('log', logEntry);
    }
  }

  emitToClients(event, data) {
    const namespace = this.io.of('/api/nginx/logs');

    for (const [socketId, clientData] of this.clients) {
      const socket = namespace.sockets.get(socketId);
      if (!socket) continue;

      // Apply filters
      if (this.matchesFilters(data, clientData.filters, clientData.serverId)) {
        socket.emit(event, data);
      }
    }
  }

  matchesFilters(log, filters, serverId) {
    // If subscribed to a specific server, only send matching logs
    if (serverId && log.server_id && log.server_id !== serverId) {
      return false;
    }

    // Status filter
    if (filters.status && log.status_code !== filters.status) {
      return false;
    }

    // Status range filter (e.g., '4xx', '5xx')
    if (filters.statusRange) {
      const range = filters.statusRange;
      const statusStr = String(log.status_code);
      if (range === '2xx' && !statusStr.startsWith('2')) return false;
      if (range === '3xx' && !statusStr.startsWith('3')) return false;
      if (range === '4xx' && !statusStr.startsWith('4')) return false;
      if (range === '5xx' && !statusStr.startsWith('5')) return false;
    }

    // IP filter
    if (filters.ip && log.client_ip !== filters.ip) {
      return false;
    }

    // Path filter (partial match)
    if (filters.path && !log.request_path?.includes(filters.path)) {
      return false;
    }

    return true;
  }

  async flushBuffer() {
    if (this.logBuffer.length === 0) return;

    const logsToInsert = this.logBuffer.splice(0, this.logBuffer.length);

    try {
      // Batch insert
      for (const log of logsToInsert) {
        await this.manager.insertLog(log);
      }
    } catch (err) {
      console.error('[NginxLogWatcher] Error flushing logs to database:', err.message);
    }
  }

  getStatusColor(statusCode) {
    if (statusCode >= 200 && statusCode < 300) return 'green';
    if (statusCode >= 300 && statusCode < 400) return 'blue';
    if (statusCode >= 400 && statusCode < 500) return 'yellow';
    if (statusCode >= 500) return 'red';
    return 'gray';
  }
}

module.exports = NginxLogWatcher;
