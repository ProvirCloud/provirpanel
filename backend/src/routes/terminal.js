'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const CommandExecutor = require('../services/CommandExecutor');

const router = express.Router();
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const cookieName = process.env.AUTH_COOKIE_NAME || 'provirpanel_token';
const executor = new CommandExecutor();

router.post('/execute', (req, res) => {
  res.status(501).json({ message: 'Use websocket at /api/terminal' });
});

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
    if (scheme === 'Bearer') {
      return token;
    }
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

const initTerminalSocket = (io) => {
  const namespace = io.of('/api/terminal');

  namespace.use((socket, next) => {
    const token = extractToken(socket.handshake);
    if (!token) {
      return next(new Error('Unauthorized'));
    }
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
    const baseDir = process.env.TERMINAL_BASE_DIR || process.cwd();
    socket.cwd = baseDir;
    socket.ptyProcess = null;
    socket.currentProcess = null;
    socket.emit('ready', { message: 'Terminal ready' });
    socket.emit('cwd', { cwd: socket.cwd });

    let pty = null;
    try {
      pty = require('node-pty');
    } catch (err) {
      // node-pty not available, fallback to spawn
    }

    const cleanupProcess = () => {
      if (socket.ptyProcess) {
        try { socket.ptyProcess.kill(); } catch (err) { /* ignore */ }
        socket.ptyProcess = null;
        return;
      }
      const child = socket.currentProcess;
      if (child && !child.killed) {
        try {
          if (child.pid && child.detached && process.platform !== 'win32') {
            process.kill(-child.pid, 'SIGKILL');
          } else {
            child.kill('SIGKILL');
          }
        } catch (err) {
          // ignore kill errors
        }
      }
      socket.currentProcess = null;
    };

    // Check if command should use PTY mode (interactive shell)
    const isPtyCommand = (cmd) => /^\s*(bash|sh|zsh|fish)\s*$/.test(cmd.trim());

    socket.on('command', async (payload = {}) => {
      const command = payload.command || '';
      cleanupProcess();
      try {
        const trimmed = command.trim();
        if (trimmed === 'cd' || trimmed.startsWith('cd ')) {
          const target = trimmed === 'cd' ? '~' : trimmed.slice(3).trim();
          const resolved =
            target === '~'
              ? baseDir
              : require('path').resolve(socket.cwd, target);
          const stats = require('fs').existsSync(resolved)
            ? require('fs').statSync(resolved)
            : null;
          if (!stats || !stats.isDirectory()) {
            socket.emit('output', { data: `cd: ${target}: No such directory\n` });
          } else {
            socket.cwd = resolved;
            socket.emit('cwd', { cwd: socket.cwd });
          }
          socket.emit('done', { code: 0, signal: null, stderr: '', stdout: '' });
          return;
        }

        // PTY mode for interactive shells
        if (pty && isPtyCommand(trimmed)) {
          const shell = trimmed || 'bash';
          const ptyProc = pty.spawn(shell, [], {
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
          return;
        }

        // Fallback: spawnInteractive for non-shell commands
        const child = executor.spawnInteractive(
          command,
          socket.user.id,
          socket.user.role,
          (chunk) => socket.emit('output', chunk),
          (err, result) => {
            if (err) {
              socket.emit('error', { message: err.message || 'Command failed' });
              cleanupProcess();
              return;
            }
            socket.emit('done', {
              code: result.code,
              signal: result.signal,
              stderr: result.stderr,
              stdout: result.stdout
            });
            cleanupProcess();
          },
          { cwd: socket.cwd }
        );

        socket.currentProcess = child;
      } catch (err) {
        socket.emit('error', { message: err.message || 'Command failed' });
        cleanupProcess();
      }
    });

    socket.on('input', (payload = {}) => {
      const data = payload.data;
      if (data == null) {
        return;
      }
      // PTY mode: write directly to pty
      if (socket.ptyProcess) {
        try {
          socket.ptyProcess.write(data);
        } catch (err) {
          // ignore
        }
        return;
      }
      // Fallback: write to child stdin
      const child = socket.currentProcess;
      if (!child || child.killed || !child.stdin) {
        return;
      }
      try {
        child.stdin.write(data);
      } catch (err) {
        // Ignore write errors on closed streams.
      }
    });

    socket.on('resize', (payload = {}) => {
      const { cols, rows } = payload;
      if (socket.ptyProcess && cols && rows) {
        try {
          socket.ptyProcess.resize(cols, rows);
        } catch (err) {
          // ignore
        }
      }
    });

    socket.on('autocomplete', (payload = {}, callback) => {
      try {
        const input = payload.input || '';
        const token = input.split(/\s+/).pop() || '';
        const candidates = executor.listCompletions(socket.cwd, token);
        if (typeof callback === 'function') {
          callback({ candidates, token });
        }
      } catch (err) {
        if (typeof callback === 'function') {
          callback({ candidates: [], token: '' });
        }
      }
    });

    socket.on('disconnect', () => cleanupProcess());
  });
};

module.exports = {
  router,
  initTerminalSocket
};
