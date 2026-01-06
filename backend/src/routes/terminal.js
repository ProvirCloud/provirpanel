'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const CommandExecutor = require('../services/CommandExecutor');

const router = express.Router();
const jwtSecret = process.env.JWT_SECRET || 'change-me';
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
    socket.currentProcess = null;
    socket.emit('ready', { message: 'Terminal ready' });
    socket.emit('cwd', { cwd: socket.cwd });

    const cleanupProcess = () => {
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
