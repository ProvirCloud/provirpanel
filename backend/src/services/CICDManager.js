'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class CICDManager {
  constructor(options = {}) {
    this.configPath =
      options.configPath || path.join(__dirname, '../../data/ci-cd-config.json');
    this.deployLogPath =
      options.deployLogPath || path.join(__dirname, '../../data/deploys.json');
    this.logsDir = options.logsDir || path.join(__dirname, '../../logs/deploys');

    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.mkdirSync(path.dirname(this.deployLogPath), { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  loadConfig() {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  saveConfig(config) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  listDeploys() {
    try {
      const raw = fs.readFileSync(this.deployLogPath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      return [];
    }
  }

  appendDeploy(entry) {
    const entries = this.listDeploys();
    entries.unshift(entry);
    fs.writeFileSync(this.deployLogPath, JSON.stringify(entries.slice(0, 200), null, 2));
  }

  execCommand(command, cwd) {
    return new Promise((resolve, reject) => {
      exec(
        command,
        { cwd, env: process.env, timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            return reject(new Error(`${error.message}\n${stderr || ''}`));
          }
          return resolve({ stdout, stderr });
        }
      );
    });
  }

  async gitCloneOrPull(config, log) {
    const repoPath = config.destinationPath;
    const gitDir = path.join(repoPath, '.git');

    if (!fs.existsSync(gitDir)) {
      await this.execCommand(`git clone ${config.repoUrl} "${repoPath}"`, process.cwd());
    }

    await this.execCommand(`git fetch origin`, repoPath);
    await this.execCommand(`git checkout ${config.branch}`, repoPath);
    await this.execCommand(`git pull origin ${config.branch}`, repoPath);
    log.push('Git sync completed');
  }

  async runBuild(config, log) {
    if (!config.buildScript) {
      log.push('No build script configured');
      return;
    }
    await this.execCommand(config.buildScript, config.destinationPath);
    log.push('Build script executed');
  }

  async restartApp(config, log) {
    if (!config.restart) {
      log.push('No restart config provided');
      return;
    }
    if (config.restart.type === 'pm2') {
      await this.execCommand(`pm2 restart ${config.restart.name}`, process.cwd());
      log.push(`PM2 restarted: ${config.restart.name}`);
      return;
    }
    if (config.restart.type === 'docker') {
      await this.execCommand(`docker restart ${config.restart.container}`, process.cwd());
      log.push(`Docker restarted: ${config.restart.container}`);
      return;
    }
    log.push('Unknown restart type');
  }

  async rollback(config, previousCommit, log) {
    if (!previousCommit) {
      log.push('No rollback commit available');
      return;
    }
    await this.execCommand(`git reset --hard ${previousCommit}`, config.destinationPath);
    log.push(`Rollback to ${previousCommit}`);
    await this.restartApp(config, log);
  }

  async runDeploy(payload = {}) {
    const config = this.loadConfig();
    if (!config) {
      throw new Error('CI/CD not configured');
    }

    const deployId = `${Date.now()}`;
    const logFile = path.join(this.logsDir, `${deployId}.log`);
    const logLines = [];

    const entry = {
      id: deployId,
      date: new Date().toISOString(),
      branch: config.branch,
      status: 'running',
      logFile
    };
    this.appendDeploy(entry);

    let previousCommit = null;
    try {
      if (fs.existsSync(path.join(config.destinationPath, '.git'))) {
        const { stdout } = await this.execCommand('git rev-parse HEAD', config.destinationPath);
        previousCommit = stdout.trim();
      }

      await this.gitCloneOrPull(config, logLines);
      await this.runBuild(config, logLines);
      await this.restartApp(config, logLines);

      entry.status = 'success';
    } catch (err) {
      logLines.push(`Deploy failed: ${err.message}`);
      entry.status = 'failed';
      try {
        await this.rollback(config, previousCommit, logLines);
        entry.status = 'rolled_back';
      } catch (rollbackErr) {
        logLines.push(`Rollback failed: ${rollbackErr.message}`);
      }
    } finally {
      fs.writeFileSync(logFile, logLines.join('\n'));
      this.appendDeploy(entry);
    }

    return entry;
  }
}

module.exports = CICDManager;
