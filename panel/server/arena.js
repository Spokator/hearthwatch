// Arène de combat : dialogue avec le plugin HearthwatchArena par fichiers dans data/panelmap.
// Le plugin exporte arena-state.json toutes les 2 s et exécute les commandes déposées dans arena-cmd/.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fail } from './errors.js';

const STALE_AFTER = 15; // secondes sans export → plugin absent ou serveur arrêté

export class ArenaService {
  constructor(dir) {
    this.dir = dir;
    this.commandDir = path.join(dir, 'arena-cmd');
    this.stateFile = path.join(dir, 'arena-state.json');
  }

  async state() {
    let data;
    try {
      data = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
    } catch {
      return null;
    }
    const age = Math.floor(Date.now() / 1000) - (data.time || 0);
    return { ...data, stale: age > STALE_AFTER };
  }

  // Dépose une commande et attend son résultat (le plugin relit le dossier chaque seconde).
  async command(op, params = {}, { timeout = 20000 } = {}) {
    const state = await this.state();
    if (!state || state.stale) fail(503, "Le plugin d'arène ne répond pas : le serveur est-il démarré avec les mods ?");

    const id = crypto.randomBytes(6).toString('hex');
    const lines = [`id=${id}`, `op=${op}`];
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      lines.push(`${key}=${String(value).replace(/[\r\n]+/g, ' ')}`);
    }
    await fs.mkdir(this.commandDir, { recursive: true });
    const file = path.join(this.commandDir, `${Date.now()}-${id}.txt`);
    await fs.writeFile(`${file}.tmp`, lines.join('\n') + '\n', 'utf8');
    await fs.rename(`${file}.tmp`, file);

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      const current = await this.state();
      const result = current?.commands?.find((c) => c.id === id);
      if (result) {
        if (!result.ok) fail(409, result.message || 'Commande refusée par le plugin');
        return { message: result.message, state: current };
      }
    }
    fail(504, "Le plugin d'arène n'a pas répondu à temps");
  }
}
