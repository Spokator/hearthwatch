// Pilotage du serveur de jeu et lecture de ses journaux.
// - mode systemd (VPS) : systemctl / journalctl via sudo, avec les commandes exactes de deploy/systemd/sudoers-valheim-panel
// - mode docker : supervisorctl (socket local) et fichier journal écrit par docker/scripts/start-valheim.sh
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { LOG_FILE, MODE } from './runtime.js';

const run = promisify(execFile);
const UNIT = 'valheim.service';
const SUPERVISORCTL = ['-c', '/opt/hearthwatch/supervisord.conf'];

export async function serviceAction(action) {
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Action inconnue');
  if (MODE === 'docker') {
    // Non bloquant, comme `systemctl --no-block` : l'arrêt peut durer (sauvegarde du monde).
    spawn('supervisorctl', [...SUPERVISORCTL, action, 'valheim'], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  await run('sudo', ['-n', '/usr/bin/systemctl', '--no-block', action, UNIT], { timeout: 30000 });
}

export async function serviceStatus({ cpu = false } = {}) {
  const status = MODE === 'docker' ? await supervisorStatus() : await systemdStatus();
  return { ...status, cpu: cpu && status.pid ? await cpuPercent(status.pid) : null };
}

async function systemdStatus() {
  const props = ['ActiveState', 'SubState', 'MainPID', 'ActiveEnterTimestamp', 'MemoryCurrent', 'NRestarts'];
  const { stdout } = await run('systemctl', ['show', UNIT, '--timestamp=unix', `--property=${props.join(',')}`]);
  const s = {};
  for (const line of stdout.trim().split('\n')) {
    const i = line.indexOf('=');
    s[line.slice(0, i)] = line.slice(i + 1);
  }
  return {
    state: s.ActiveState,
    subState: s.SubState,
    pid: Number(s.MainPID) || null,
    since: /^@\d+$/.test(s.ActiveEnterTimestamp) ? new Date(Number(s.ActiveEnterTimestamp.slice(1)) * 1000).toISOString() : null,
    memory: /^\d+$/.test(s.MemoryCurrent) ? Number(s.MemoryCurrent) : null,
    restarts: Number(s.NRestarts) || 0,
  };
}

async function supervisorStatus() {
  let out = '';
  try {
    ({ stdout: out } = await run('supervisorctl', [...SUPERVISORCTL, 'status', 'valheim'], { timeout: 10000 }));
  } catch (err) {
    // supervisorctl sort en erreur quand le programme n'est pas RUNNING.
    out = err.stdout || '';
  }
  const program = out.match(/^valheim\s+([A-Z]+)/m)?.[1] || 'UNKNOWN';
  const updating = await fs.access('/tmp/hearthwatch-updating').then(
    () => true,
    () => false,
  );
  const state =
    { RUNNING: updating ? 'activating' : 'active', STARTING: 'activating', BACKOFF: 'activating', STOPPING: 'deactivating', FATAL: 'failed' }[program] || 'inactive';
  const pid = state === 'active' ? await findProcess('valheim_server') : null;
  return {
    state,
    subState: program.toLowerCase(),
    pid,
    since: pid ? await processStart(pid) : null,
    memory: pid ? await processMemory(pid) : null,
    restarts: 0,
  };
}

async function findProcess(prefix) {
  for (const entry of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if ((await fs.readFile(`/proc/${entry}/comm`, 'utf8')).startsWith(prefix)) return Number(entry);
    } catch {}
  }
  return null;
}

async function processStart(pid) {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
    const bootTime = Number((await fs.readFile('/proc/stat', 'utf8')).match(/^btime (\d+)/m)[1]);
    return new Date((bootTime + ticks / 100) * 1000).toISOString();
  } catch {
    return null;
  }
}

async function processMemory(pid) {
  try {
    const kb = (await fs.readFile(`/proc/${pid}/status`, 'utf8')).match(/VmRSS:\s+(\d+) kB/)?.[1];
    return kb ? Number(kb) * 1024 : null;
  } catch {
    return null;
  }
}

// Utilisation CPU du processus sur ~400 ms (100 % = un cœur).
async function cpuPercent(pid) {
  const read = async () => {
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return Number(f[11]) + Number(f[12]);
    } catch {
      return null;
    }
  };
  const a = await read();
  const t0 = process.hrtime.bigint();
  await new Promise((r) => setTimeout(r, 400));
  const b = await read();
  if (a === null || b === null) return null;
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  return Math.round(((b - a) / 100 / secs) * 10) / 10;
}

export async function hostStats() {
  const mem = {};
  try {
    for (const line of (await fs.readFile('/proc/meminfo', 'utf8')).split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+) kB/);
      if (m) mem[m[1]] = Number(m[2]) * 1024;
    }
  } catch {}
  return {
    load: os.loadavg(),
    cpus: os.cpus().length,
    memTotal: mem.MemTotal ?? os.totalmem(),
    memAvailable: mem.MemAvailable ?? os.freemem(),
    uptime: os.uptime(),
  };
}

export async function diskUsage(dir) {
  const s = await fs.statfs(dir);
  return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
}

// ---------- Journaux ----------

const TAIL_BYTES = 1024 * 1024;

export async function readJournal() {
  if (MODE !== 'docker') {
    const { stdout } = await run('sudo', ['-n', '/usr/bin/journalctl', '-u', UNIT, '-n', '2000', '--no-pager', '-o', 'short-iso'], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.split('\n').filter(Boolean);
  }
  let handle;
  try {
    handle = await fs.open(LOG_FILE, 'r');
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(size - start), 0, size - start, start);
    const lines = buffer.toString('utf8', 0, bytesRead).split('\n').filter(Boolean);
    if (start > 0) lines.shift(); // première ligne probablement tronquée
    return lines.slice(-2000);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  } finally {
    await handle?.close();
  }
}

export function followJournal(onLine, onExit) {
  if (MODE !== 'docker') {
    const child = spawn('sudo', ['-n', '/usr/bin/journalctl', '-u', UNIT, '-f', '-n', '0', '--no-pager', '-o', 'short-iso']);
    let rest = '';
    child.stdout.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      lines.filter(Boolean).forEach(onLine);
    });
    child.on('exit', () => onExit?.());
    child.on('error', () => {});
    return () => child.kill();
  }

  // Docker : suivi du fichier par sondage (gère la rotation faite par start-valheim.sh).
  let position = null;
  let rest = '';
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    let handle;
    try {
      handle = await fs.open(LOG_FILE, 'r');
      const { size } = await handle.stat();
      if (position === null || size < position) position = position === null ? size : 0;
      if (size > position) {
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(size - position), 0, size - position, position);
        position += bytesRead;
        const lines = (rest + buffer.toString('utf8', 0, bytesRead)).split('\n');
        rest = lines.pop();
        lines.filter(Boolean).forEach(onLine);
      }
    } catch {
      // Fichier pas encore créé ou en cours de rotation.
    } finally {
      await handle?.close();
      busy = false;
    }
  };
  const timer = setInterval(poll, 1000);
  return () => clearInterval(timer);
}
