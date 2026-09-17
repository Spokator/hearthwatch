// Pont avec le plugin (corps du monde) : lit <panelmap>/world/events.jsonl au fil de l'eau et state.json, dépose les
// commandes dans world/cmd/ et attend leurs résultats.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

export class Bridge extends EventEmitter {
  constructor(panelDir) {
    super();
    this.dir = path.join(panelDir, 'world');
    this.cmdDir = path.join(this.dir, 'cmd');
    this.eventsFile = path.join(this.dir, 'events.jsonl');
    this.stateFile = path.join(this.dir, 'state.json');
    this.offset = null;
    this.state = null;
    this.waiters = new Map();
    this.timer = null;
    this.polling = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), 500);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  get online() {
    return !!this.state && Date.now() - (this.state.time || 0) < 15000;
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.readState();
      await this.readEvents();
    } catch (error) {
      console.error('[world] bridge poll', error.message);
    } finally {
      this.polling = false;
    }
  }

  async readState() {
    try {
      const state = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (!this.state || state.time !== this.state.time) {
        this.state = state;
        this.emit('state', state);
      }
    } catch {
      // pas encore d'état (serveur arrêté)
    }
  }

  async readEvents() {
    let stat;
    try {
      stat = await fs.stat(this.eventsFile);
    } catch {
      return;
    }
    // Premier passage : on ignore l'historique (le monde repart de son état enregistré).
    if (this.offset === null || stat.size < this.offset) this.offset = this.offset === null ? stat.size : 0;
    if (stat.size === this.offset) return;
    const handle = await fs.open(this.eventsFile, 'r');
    try {
      const length = stat.size - this.offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, this.offset);
      const text = buffer.toString('utf8');
      const end = text.lastIndexOf('\n');
      if (end < 0) return;
      this.offset += Buffer.byteLength(text.slice(0, end + 1), 'utf8');
      for (const line of text.slice(0, end).split('\n')) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === 'result' && this.waiters.has(event.id)) {
          this.waiters.get(event.id)(event);
          this.waiters.delete(event.id);
        }
        this.emit('event', event);
      }
    } finally {
      await handle.close();
    }
  }

  // Dépose une commande ; avec `wait`, attend le résultat (ou null après le délai).
  async send(op, params = {}, { wait = false, timeout = 8000 } = {}) {
    const id = crypto.randomBytes(6).toString('hex');
    await fs.mkdir(this.cmdDir, { recursive: true });
    const file = path.join(this.cmdDir, `${Date.now()}-${id}.json`);
    await fs.writeFile(`${file}.tmp`, JSON.stringify({ id, op, ...params }), 'utf8');
    await fs.rename(`${file}.tmp`, file);
    if (!wait) return { id };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        resolve(null);
      }, timeout);
      this.waiters.set(id, (event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }
}
