'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const os = require('os');

const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\/\b/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /:\s*\(\s*\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;\s*:/ // fork bomb
];

const DEV_ALLOWED = new Set([
  'ls',
  'cat',
  'pwd',
  'whoami',
  'tail',
  'head',
  'df',
  'du',
  'ps',
  'uptime',
  'free',
  'top',
  'htop',
  'grep',
  'find',
  'stat',
  'id',
  'claude'
]);

const VIEWER_ALLOWED = new Set([
  'ls',
  'cat',
  'pwd',
  'whoami',
  'tail',
  'head',
  'df',
  'du',
  'ps',
  'uptime',
  'free',
  'stat',
  'id'
]);

const COMMAND_HINTS = new Set([
  ...DEV_ALLOWED,
  ...VIEWER_ALLOWED,
  'cd',
  'clear'
]);

class CommandExecutor {
  constructor(options = {}) {
    const logDir = options.logDir || path.join(__dirname, '../../logs');
    this.logPath = options.logPath || path.join(logDir, 'commands.log');
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    const fallbackUser = process.env.USER || os.userInfo().username;
    this.execUser = this.resolveExecUser(options.execUser || process.env.TERMINAL_OS_USER || fallbackUser);
    this.shell =
      options.shell ||
      process.env.TERMINAL_SHELL ||
      (fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');
  }

  resolveExecUser(username) {
    if (!username) {
      return null;
    }
    try {
      const uid = Number(execSync(`id -u ${username}`).toString().trim());
      const gid = Number(execSync(`id -g ${username}`).toString().trim());
      return { username, uid, gid };
    } catch (err) {
      return null;
    }
  }

  isBlocked(command) {
    return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
  }

  isAllowedForRole(command, role) {
    const token = command.trim().split(/\s+/)[0];
    if (!token) {
      return false;
    }

    if (role === 'admin') {
      return true;
    }
    if (role === 'dev') {
      return DEV_ALLOWED.has(token);
    }
    if (role === 'viewer') {
      return VIEWER_ALLOWED.has(token);
    }
    return false;
  }

  logCommand({ userId, role, command }) {
    const entry = {
      timestamp: new Date().toISOString(),
      userId,
      role,
      osUser: this.execUser?.username || process.env.USER || 'unknown',
      command
    };
    fs.appendFile(this.logPath, `${JSON.stringify(entry)}\n`, () => {});
  }

  executeCommand(command, userId, role, onData, options = {}) {
    return new Promise((resolve, reject) => {
      if (!command || typeof command !== 'string') {
        return reject(new Error('Invalid command'));
      }

      if (this.isBlocked(command)) {
        return reject(new Error('Command blocked'));
      }

      if (!this.isAllowedForRole(command, role)) {
        return reject(new Error('Command not allowed'));
      }

      this.logCommand({ userId, role, command });

      const spawnOptions = { env: process.env, cwd: options.cwd };
      if (role === 'admin' && this.execUser?.uid != null && process.getuid) {
        if (process.getuid() === this.execUser.uid) {
          spawnOptions.uid = this.execUser.uid;
          spawnOptions.gid = this.execUser.gid;
        }
      }

      const child = spawn(this.shell, ['-lc', command], spawnOptions);

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, 30000);

      const handleData = (stream) => (chunk) => {
        const text = chunk.toString();
        if (stream === 'stdout') {
          stdout += text;
        } else {
          stderr += text;
        }
        if (typeof onData === 'function') {
          onData({ stream, data: text });
        }
      };

      child.stdout.on('data', handleData('stdout'));
      child.stderr.on('data', handleData('stderr'));

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      child.on('close', (code, signal) => {
        clearTimeout(timeout);
        if (timedOut) {
          return resolve({ code: 124, signal: 'SIGKILL', stdout, stderr: 'Command timed out' });
        }
        return resolve({ code, signal, stdout, stderr });
      });
    });
  }

  spawnInteractive(command, userId, role, onData, onExit, options = {}) {
    if (!command || typeof command !== 'string') {
      throw new Error('Invalid command');
    }

    if (this.isBlocked(command)) {
      throw new Error('Command blocked');
    }

    if (!this.isAllowedForRole(command, role)) {
      throw new Error('Command not allowed');
    }

    this.logCommand({ userId, role, command });

    // Clone env to allow safe mutation for sudo handling.
    const spawnOptions = { env: { ...process.env }, cwd: options.cwd };
    if (role === 'admin' && this.execUser?.uid != null && process.getuid) {
      if (process.getuid() === this.execUser.uid) {
        spawnOptions.uid = this.execUser.uid;
        spawnOptions.gid = this.execUser.gid;
      }
    }

    // If using sudo, force -S to read from stdin and set a visible prompt.
    const isSudo = /^\s*sudo\b/.test(command);
    const hasSFlag = /^\s*sudo\b[^\n]*\s-S\b/.test(command);
    if (isSudo && !hasSFlag) {
      command = command.replace(/^\s*sudo\b/, 'sudo -S');
      spawnOptions.env.SUDO_PROMPT = '[sudo] password: ';
    }

    // Make shell commands interactive when user types just bash/sh so prompts appear.
    const shellMatch = /^\s*(sudo\s+)?(bash|sh)\b/.exec(command);
    const hasInteractiveFlag = /\s-i(\s|$)/.test(command);
    if (shellMatch && !hasInteractiveFlag) {
      const prefix = shellMatch[1] || '';
      const shellName = shellMatch[2];
      command = command.replace(/^\s*(sudo\s+)?(bash|sh)\b/, `${prefix}${shellName} -i`);
      // Provide a simple prompt for visibility even without a true PTY.
      spawnOptions.env.PS1 = 'cloudpainel$ ';
    }

    // On POSIX, detach to create a new session/process group so signals and cwd don't leak.
    if (process.platform !== 'win32') {
      spawnOptions.detached = true;
    }

    const child = spawn(this.shell, ['-lc', command], spawnOptions);
    if (child.stdin) {
      child.stdin.setDefaultEncoding('utf-8');
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeoutMs = options.timeoutMs || 30000;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const handleData = (stream) => (chunk) => {
      const text = chunk.toString();
      if (stream === 'stdout') {
        stdout += text;
      } else {
        stderr += text;
      }
      if (typeof onData === 'function') {
        onData({ stream, data: text });
      }
    };

    child.stdout.on('data', handleData('stdout'));
    child.stderr.on('data', handleData('stderr'));

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (typeof onExit === 'function') {
        onExit(err);
      }
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        code = 124;
        signal = 'SIGKILL';
        stderr = 'Command timed out';
      }
      if (typeof onExit === 'function') {
        onExit(null, { code, signal, stdout, stderr });
      }
    });

    return child;
  }

  listCompletions(cwd, token) {
    const results = new Set();
    const current = token || '';

    if (!current.includes('/')) {
      COMMAND_HINTS.forEach((cmd) => {
        if (cmd.startsWith(current)) {
          results.add(cmd);
        }
      });
    }

    const baseDir = current.includes('/')
      ? path.resolve(cwd, path.dirname(current))
      : cwd;
    const prefix = current.includes('/') ? path.basename(current) : current;

    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      entries.forEach((entry) => {
        if (!entry.name.startsWith(prefix)) {
          return;
        }
        const suffix = entry.isDirectory() ? '/' : '';
        if (current.includes('/')) {
          results.add(path.join(path.dirname(current), entry.name) + suffix);
        } else {
          results.add(entry.name + suffix);
        }
      });
    } catch (err) {
      // Ignore unreadable directories.
    }

    return Array.from(results).sort();
  }
}

module.exports = CommandExecutor;
