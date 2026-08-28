'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const jwtSecret = process.env.JWT_SECRET || 'change-me';
const cookieName = process.env.AUTH_COOKIE_NAME || 'provirpanel_token';
const PORT = process.env.TERMINAL_SERVICE_PORT || 3003;
const BASE_DIR = process.env.TERMINAL_BASE_DIR || '/opt/provirpanel';

// ─── PTY ────────────────────────────────────────────────────────────────────────
let pty;
try {
  pty = require('node-pty');
} catch (err) {
  console.error('[terminal-service] node-pty not available:', err.message);
  process.exit(1);
}

// ─── HTTP + Socket.IO ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'terminal-service', pid: process.pid }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true
  },
  path: '/terminal-ws'
});

// ─── Auth helpers ───────────────────────────────────────────────────────────────
const extractToken = (handshake) => {
  if (handshake.auth && handshake.auth.token) {
    return handshake.auth.token;
  }
  if (handshake.query && handshake.query.token) {
    return handshake.query.token;
  }
  const authHeader = handshake.headers && handshake.headers.authorization;
  if (authHeader) {
    const [scheme, token] = authHeader.split(' ');
    if (scheme === 'Bearer') return token;
  }
  const cookieHeader = handshake.headers && handshake.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, pair) => {
      const index = pair.indexOf('=');
      if (index === -1) return acc;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
    return cookies[cookieName] || cookies.token || null;
  }
  return null;
};

// ─── Shell resolution ───────────────────────────────────────────────────────────
const resolvePreferredShell = () => {
  if (process.env.TERMINAL_SHELL) return process.env.TERMINAL_SHELL;
  if (process.env.SHELL) return process.env.SHELL;
  return 'bash';
};

// ─── Terminal namespace ─────────────────────────────────────────────────────────
const namespace = io.of('/api/terminal');

namespace.use((socket, next) => {
  const token = extractToken(socket.handshake);
  if (!token) return next(new Error('Unauthorized'));
  try {
    const payload = jwt.verify(token, jwtSecret);
    socket.user = {
      id: payload.sub,
      role: payload.role,
      username: payload.username
    };
    return next();
  } catch (err) {
    return next(new Error('Unauthorized'));
  }
});

namespace.on('connection', (socket) => {
  socket.cwd = BASE_DIR;
  socket.ptyProcess = null;
  socket.emit('ready', { message: 'Terminal ready' });
  socket.emit('cwd', { cwd: socket.cwd });

  const cleanupProcess = () => {
    if (socket.ptyProcess) {
      try { socket.ptyProcess.kill(); } catch (_) { /* ignore */ }
      socket.ptyProcess = null;
    }
  };

  const INTERNAL_SHELL_BOOTSTRAP = '__provir_shell__';

  const resolvePtyCommand = (cmd) => {
    const trimmed = (cmd || '').trim();

    if (!trimmed || trimmed === INTERNAL_SHELL_BOOTSTRAP) {
      return { shell: resolvePreferredShell(), args: [] };
    }

    if (/^\s*(bash|sh|zsh|fish)\s*$/.test(trimmed)) {
      return { shell: trimmed, args: [] };
    }

    // Amazon Q CLI
    const qMatch = trimmed.match(/^q(\s+(.*))?$/);
    if (qMatch) {
      const qArgs = qMatch[2] ? qMatch[2].split(/\s+/) : [];
      return { shell: '/usr/local/bin/q', args: qArgs };
    }

    return null;
  };

  socket.on('command', (payload = {}) => {
    const command = payload.command || '';
    cleanupProcess();

    try {
      const trimmed = command.trim();

      // Handle cd
      if (trimmed === 'cd' || trimmed.startsWith('cd ')) {
        const target = trimmed === 'cd' ? '~' : trimmed.slice(3).trim();
        const resolved = target === '~'
          ? BASE_DIR
          : path.resolve(socket.cwd, target);
        const stats = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
        if (!stats || !stats.isDirectory()) {
          socket.emit('output', { data: `cd: ${target}: No such directory\n` });
        } else {
          socket.cwd = resolved;
          socket.emit('cwd', { cwd: socket.cwd });
        }
        socket.emit('done', { code: 0, signal: null, stderr: '', stdout: '' });
        return;
      }

      // Resolve PTY command (interactive shells and special commands)
      const ptyCommand = resolvePtyCommand(trimmed);

      if (ptyCommand) {
        // Spawn PTY for interactive shell
        const ptyProc = pty.spawn(ptyCommand.shell, ptyCommand.args, {
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd: socket.cwd,
          env: (() => {
            const e = { ...process.env, TERM: 'xterm-256color' };
            delete e.Q_PARENT;
            return e;
          })()
        });
        socket.ptyProcess = ptyProc;

        ptyProc.onData((data) => {
          socket.emit('output', { data });
        });

        ptyProc.onExit(({ exitCode, signal }) => {
          socket.ptyProcess = null;
          socket.emit('done', { code: exitCode, signal: signal || null, stderr: '', stdout: '' });
        });
        return;
      }

      // For non-interactive commands, spawn via PTY as well (preserves colors, signals)
      const shell = resolvePreferredShell();
      const ptyProc = pty.spawn(shell, ['-lc', trimmed], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: socket.cwd,
        env: { ...process.env, TERM: 'xterm-256color' }
      });
      socket.ptyProcess = ptyProc;

      ptyProc.onData((data) => {
        socket.emit('output', { data });
      });

      ptyProc.onExit(({ exitCode, signal }) => {
        socket.ptyProcess = null;
        socket.emit('done', { code: exitCode, signal: signal || null, stderr: '', stdout: '' });
      });
    } catch (err) {
      socket.emit('error', { message: err.message || 'Command failed' });
      cleanupProcess();
    }
  });

  socket.on('input', (payload = {}) => {
    const data = payload.data;
    if (data == null) return;
    if (socket.ptyProcess) {
      try { socket.ptyProcess.write(data); } catch (_) { /* ignore */ }
    }
  });

  socket.on('resize', (payload = {}) => {
    const { cols, rows } = payload;
    if (socket.ptyProcess && cols && rows) {
      try { socket.ptyProcess.resize(cols, rows); } catch (_) { /* ignore */ }
    }
  });

  socket.on('disconnect', () => cleanupProcess());
});

// ─── Start ──────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[terminal-service] listening on port ${PORT} (pid ${process.pid})`);
});
