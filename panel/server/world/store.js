// Persistance du monde vivant : un fichier JSON écrit de façon atomique (écriture groupée), plus des journaux JSONL.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  constructor(file, initial) {
    this.file = file;
    this.data = initial;
    this.timer = null;
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      this.data = { ...this.data, ...JSON.parse(await fs.readFile(this.file, 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Fichier corrompu : on le met de côté plutôt que de l'écraser.
        await fs.rename(this.file, `${this.file}.broken-${Date.now()}`).catch(() => {});
      }
    }
    return this.data;
  }

  // Enregistre dans les 2 s (plusieurs changements rapprochés = une seule écriture).
  touch() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 2000);
  }

  flush() {
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data), 'utf8');
      await fs.rename(tmp, this.file);
    }).catch((error) => console.error('[world] save failed', error));
    return this.writing;
  }
}

// Journal en ajout seul (conversations, chronique), avec lecture des dernières lignes.
export class JsonLog {
  constructor(file, { maxBytes = 8 * 1024 * 1024 } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.queue = Promise.resolve();
  }

  append(entry) {
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      try {
        const stat = await fs.stat(this.file);
        if (stat.size > this.maxBytes) await fs.rename(this.file, `${this.file}.1`);
      } catch {
        // pas encore de fichier
      }
      await fs.appendFile(this.file, JSON.stringify(entry) + '\n', 'utf8');
    }).catch((error) => console.error('[world] log failed', error));
    return this.queue;
  }

  async tail(count = 100, filter = null) {
    let text = '';
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    const lines = text.trim().split('\n');
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < count; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (!filter || filter(entry)) out.push(entry);
      } catch {
        // ligne tronquée
      }
    }
    return out.reverse();
  }
}
