'use strict';

const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

class MetricsCollector {
  async getCPUUsage() {
    const snapshot = () => {
      const cpus = os.cpus();
      let idle = 0;
      let total = 0;
      cpus.forEach((cpu) => {
        const times = cpu.times;
        idle += times.idle;
        total += times.user + times.nice + times.sys + times.irq + times.idle;
      });
      return { idle, total };
    };

    const start = snapshot();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const end = snapshot();

    const idleDelta = end.idle - start.idle;
    const totalDelta = end.total - start.total;
    const usage = totalDelta === 0 ? 0 : (1 - idleDelta / totalDelta) * 100;

    return Number(usage.toFixed(2));
  }

  getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;

    return { total, used, free };
  }

  getDiskUsage() {
    try {
      const output = execSync('df -k /', { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      if (lines.length < 2) {
        throw new Error('Unexpected df output');
      }
      const parts = lines[1].split(/\s+/);
      const total = Number(parts[1]) * 1024;
      const used = Number(parts[2]) * 1024;
      const free = Number(parts[3]) * 1024;
      return { total, used, free };
    } catch (err) {
      return { total: 0, used: 0, free: 0 };
    }
  }

  getProcesses() {
    try {
      const platform = os.platform();
      const psCommand =
        platform === 'linux'
          ? 'ps -eo pid,comm,pcpu,pmem --sort=-pcpu'
          : 'ps -axo pid,comm,pcpu,pmem -r';
      const output = execSync(psCommand, { encoding: 'utf8' });
      const lines = output.trim().split('\n').slice(1, 6);
      return lines.map((line) => {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[0]);
        const cpu = Number(parts[parts.length - 2]);
        const mem = Number(parts[parts.length - 1]);
        const command = parts.slice(1, -2).join(' ');
        return { pid, command, cpu, mem };
      });
    } catch (err) {
      return [];
    }
  }

  getSystemInfo() {
    return {
      hostname: os.hostname(),
      uptime: os.uptime(),
      kernel: os.release()
    };
  }

  async getContainersCount() {
    try {
      const Docker = require('dockerode');
      const docker = new Docker();
      const containers = await docker.listContainers({ all: false });
      return containers.length;
    } catch (err) {
      return 0;
    }
  }

  async collect() {
    const [cpu, containersRunning] = await Promise.all([
      this.getCPUUsage(),
      this.getContainersCount()
    ]);
    return {
      cpu,
      memory: this.getMemoryUsage(),
      disk: this.getDiskUsage(),
      processes: this.getProcesses(),
      system: this.getSystemInfo(),
      containersRunning,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = MetricsCollector;
