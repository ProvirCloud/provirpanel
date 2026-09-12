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
      // Por-core: guarda idle/total de cada núcleo para calcular distribuição.
      const perCore = cpus.map((cpu) => {
        const t = cpu.times;
        const coreTotal = t.user + t.nice + t.sys + t.irq + t.idle;
        idle += t.idle;
        total += coreTotal;
        return { idle: t.idle, total: coreTotal };
      });
      return { idle, total, perCore };
    };

    const start = snapshot();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const end = snapshot();

    const idleDelta = end.idle - start.idle;
    const totalDelta = end.total - start.total;
    const usage = totalDelta === 0 ? 0 : (1 - idleDelta / totalDelta) * 100;

    // Uso por núcleo (0–100% cada), na mesma janela de amostragem.
    const cores = end.perCore.map((core, i) => {
      const s = start.perCore[i] || { idle: 0, total: 0 };
      const iDelta = core.idle - s.idle;
      const tDelta = core.total - s.total;
      const u = tDelta === 0 ? 0 : (1 - iDelta / tDelta) * 100;
      return Number(Math.max(0, Math.min(100, u)).toFixed(1));
    });

    // Guarda no próprio objeto para getCPUCores() reusar sem re-amostrar.
    this._lastCores = cores;
    return Number(usage.toFixed(2));
  }

  /** Uso por núcleo da última amostragem de getCPUUsage(). */
  getCPUCores() {
    return this._lastCores || [];
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
      // O `ps` reporta %CPU relativo a UM núcleo (pode passar de 100% — ex.: 600%
      // num processo usando 6 núcleos). Normalizamos por nº de núcleos para uma
      // escala 0–100% do total da máquina, que é o que faz sentido no dashboard.
      const cores = os.cpus().length || 1;
      return lines.map((line) => {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[0]);
        const cpuRaw = Number(parts[parts.length - 2]);
        const mem = Number(parts[parts.length - 1]);
        const command = parts.slice(1, -2).join(' ');
        // cpu = % do total da máquina (0–100); cpuRaw = valor bruto do ps (por núcleo).
        const cpu = Number(Math.min(100, cpuRaw / cores).toFixed(1));
        return { pid, command, cpu, cpuRaw, mem };
      });
    } catch (err) {
      return [];
    }
  }

  getSystemInfo() {
    return {
      hostname: os.hostname(),
      uptime: os.uptime(),
      kernel: os.release(),
      platform: os.platform(),
      arch: os.arch(),
      cores: os.cpus().length,
      loadavg: os.loadavg().map((n) => Number(n.toFixed(2)))
    };
  }

  // Campos consultados no nvidia-smi (ordem fixa — o parser depende dela).
  static GPU_QUERY_FIELDS = [
    'index',
    'name',
    'utilization.gpu',
    'utilization.memory',
    'memory.used',
    'memory.total',
    'temperature.gpu',
    'power.draw',
    'power.limit'
  ];

  /**
   * Converte a saída CSV (noheader,nounits) do nvidia-smi em objetos por GPU.
   * Puro (sem I/O) para permitir teste unitário sem GPU real. Valores ausentes
   * (ex.: "[N/A]") viram null. Percentuais de memória são derivados de
   * used/total quando o driver não reporta utilization.memory de forma útil.
   */
  static parseGpuCsv(output) {
    if (!output || typeof output !== 'string') return [];
    const num = (v) => {
      const n = Number(String(v).trim());
      return Number.isFinite(n) ? n : null;
    };
    return output
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const p = line.split(',').map((s) => s.trim());
        if (p.length < 7) return null;
        const memUsed = num(p[4]);
        const memTotal = num(p[5]);
        const memPercent =
          memTotal && memUsed != null ? Number(((memUsed / memTotal) * 100).toFixed(1)) : null;
        return {
          index: num(p[0]) ?? 0,
          name: p[1] || 'GPU',
          utilization: num(p[2]),        // % de uso do núcleo da GPU
          memoryUtilization: num(p[3]),  // % reportado pelo driver
          memoryUsedMB: memUsed,
          memoryTotalMB: memTotal,
          memoryPercent: memPercent,     // derivado de used/total (mais confiável)
          temperature: num(p[6]),        // °C
          powerDraw: p[7] != null ? num(p[7]) : null,   // W
          powerLimit: p[8] != null ? num(p[8]) : null   // W
        };
      })
      .filter(Boolean);
  }

  /**
   * Lê o estado das GPUs NVIDIA via nvidia-smi. Degrada com segurança:
   * retorna { available:false, devices:[] } se o binário não existir ou o
   * driver estiver indisponível (ex.: version mismatch) — nunca lança.
   */
  getGPU() {
    try {
      const query = MetricsCollector.GPU_QUERY_FIELDS.join(',');
      const output = execSync(
        `nvidia-smi --query-gpu=${query} --format=csv,noheader,nounits`,
        { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }
      );
      const devices = MetricsCollector.parseGpuCsv(output);
      return { available: devices.length > 0, devices };
    } catch (err) {
      // Sem GPU, sem driver, ou nvidia-smi indisponível: degrada silenciosamente.
      return { available: false, devices: [] };
    }
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
    const memory = this.getMemoryUsage();
    const gpu = this.getGPU();
    const timestamp = new Date().toISOString();

    // Histórico em memória (ring buffer) para o dashboard renderizar gráficos
    // mesmo num carregamento novo, sem depender de acumular só no cliente.
    const memPercent = memory.total ? Number(((memory.used / memory.total) * 100).toFixed(1)) : 0;
    const gpuAvg = gpu.available && gpu.devices.length
      ? Number((gpu.devices.reduce((a, d) => a + (d.utilization || 0), 0) / gpu.devices.length).toFixed(1))
      : 0;
    this._pushHistory({ t: timestamp, cpu, mem: memPercent, gpu: gpuAvg });

    return {
      cpu,
      cpuCores: this.getCPUCores(),
      memory,
      disk: this.getDiskUsage(),
      gpu,
      processes: this.getProcesses(),
      system: this.getSystemInfo(),
      containersRunning,
      history: this._history || [],
      timestamp
    };
  }

  /** Mantém os últimos N pontos de telemetria para os gráficos de histórico. */
  _pushHistory(point) {
    if (!this._history) this._history = [];
    this._history.push(point);
    const MAX = 60; // ~5min a cada 5s
    if (this._history.length > MAX) this._history.shift();
  }
}

module.exports = MetricsCollector;
