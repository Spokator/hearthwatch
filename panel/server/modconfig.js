// Éditeur des fichiers de configuration BepInEx (.cfg) des mods serveur.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fail } from './errors.js';

// Fichiers jamais exposés : la config RCON contient le mot de passe utilisé par le panel,
// et une erreur dans BepInEx.cfg peut empêcher tous les mods de se charger.
const HIDDEN = new Set(['org.tristan.rcon.cfg', 'BepInEx.cfg']);
const NUMERIC = /^(Byte|SByte|Int16|UInt16|Int32|UInt32|Int64|UInt64|Single|Double|Decimal)$/;

const freshMeta = () => ({ description: [] });

// Format BepInEx : "## description", "# Setting type: X", "# Default value: Y", "# Acceptable values: A, B", "Clé = valeur".
export function parseCfg(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let section = '';
  let plugin = null;
  let guid = null;
  let meta = freshMeta();

  lines.forEach((raw, index) => {
    const line = raw.trim();
    let m;
    if (!line) {
      meta = freshMeta();
    } else if ((m = line.match(/^## Settings file was created by plugin (.+)$/))) {
      plugin = m[1];
    } else if ((m = line.match(/^## Plugin GUID: (.+)$/))) {
      guid = m[1];
    } else if ((m = line.match(/^\[(.+)\]$/))) {
      section = m[1];
      meta = freshMeta();
    } else if ((m = line.match(/^## ?(.*)$/))) {
      meta.description.push(m[1]);
    } else if ((m = line.match(/^# Setting type: (.+)$/))) {
      meta.type = m[1];
    } else if ((m = line.match(/^# Default value: ?(.*)$/))) {
      meta.default = m[1];
    } else if ((m = line.match(/^# Acceptable values: (.+)$/))) {
      meta.acceptable = m[1].split(',').map((s) => s.trim());
    } else if ((m = line.match(/^# Acceptable value range: From (.+) to (.+)$/))) {
      meta.range = [Number(m[1]), Number(m[2])];
    } else if (/^# Multiple values can be set/.test(line)) {
      meta.flags = true;
    } else if (!line.startsWith('#') && section && (m = raw.match(/^([^=]+?)\s*=\s?(.*)$/))) {
      const key = m[1].trim();
      entries.push({
        id: `${section}/${key}`,
        section,
        key,
        value: m[2],
        type: meta.type || 'String',
        default: meta.default ?? null,
        description: meta.description.join('\n'),
        acceptable: meta.acceptable || null,
        range: meta.range || null,
        flags: !!meta.flags,
        line: index,
      });
      meta = freshMeta();
    }
  });
  return { plugin, guid, entries };
}

function validate(entry, input) {
  const raw = typeof input === 'boolean' ? String(input) : String(input ?? '');
  if (/[\r\n]/.test(raw)) fail(400, `Valeur invalide pour ${entry.key}`);
  const value = raw.trim();

  if (entry.type === 'Boolean') {
    if (!/^(true|false)$/i.test(value)) fail(400, `${entry.key} : true ou false attendu`);
    return value.toLowerCase();
  }
  if (NUMERIC.test(entry.type)) {
    const n = Number(value);
    if (value === '' || !Number.isFinite(n)) fail(400, `${entry.key} : nombre attendu`);
    if (/Int|Byte/.test(entry.type) && !Number.isInteger(n)) fail(400, `${entry.key} : nombre entier attendu`);
    if (entry.range && (n < entry.range[0] || n > entry.range[1])) fail(400, `${entry.key} : valeur entre ${entry.range[0]} et ${entry.range[1]} attendue`);
    return String(n);
  }
  if (entry.acceptable) {
    const parts = entry.flags ? value.split(',').map((s) => s.trim()).filter(Boolean) : [value];
    for (const part of parts) if (!entry.acceptable.includes(part)) fail(400, `${entry.key} : valeur « ${part} » non autorisée`);
    return entry.flags ? parts.join(', ') : value;
  }
  return value;
}

export class ModConfig {
  constructor(dir) {
    this.dir = dir;
  }

  #path(file) {
    const name = String(file ?? '');
    if (!/^[\w.-]+\.cfg$/.test(name) || HIDDEN.has(name)) fail(404, 'Fichier de configuration introuvable');
    return path.join(this.dir, name);
  }

  async list() {
    const names = (await fs.readdir(this.dir).catch(() => [])).filter((f) => f.endsWith('.cfg') && !HIDDEN.has(f)).sort();
    const files = [];
    for (const file of names) {
      const p = path.join(this.dir, file);
      const [text, st] = await Promise.all([fs.readFile(p, 'utf8'), fs.stat(p)]);
      const { plugin, guid, entries } = parseCfg(text);
      files.push({ file, plugin, guid, entries: entries.length, modified: st.mtime });
    }
    return files;
  }

  async read(file) {
    const p = this.#path(file);
    const text = await fs.readFile(p, 'utf8').catch(() => fail(404, 'Fichier de configuration introuvable'));
    const { plugin, guid, entries } = parseCfg(text);
    return { file, plugin, guid, entries: entries.map(({ line, ...entry }) => entry) };
  }

  async write(file, changes) {
    const p = this.#path(file);
    const text = await fs.readFile(p, 'utf8').catch(() => fail(404, 'Fichier de configuration introuvable'));
    const { entries } = parseCfg(text);
    const lines = text.split(/\r?\n/);
    let changed = 0;
    for (const [id, input] of Object.entries(changes || {})) {
      const entry = entries.find((e) => e.id === id) || fail(400, `Réglage inconnu : ${id}`);
      lines[entry.line] = `${entry.key} = ${validate(entry, input)}`;
      changed++;
    }
    if (changed) {
      const tmp = `${p}.${process.pid}.tmp`;
      await fs.writeFile(tmp, lines.join(text.includes('\r\n') ? '\r\n' : '\n'));
      await fs.rename(tmp, p);
      // Mémorisé ici plutôt que via la date du fichier : les mods réécrivent leurs .cfg à chaque démarrage.
      this.lastWrite = Date.now();
    }
    return { changed };
  }
}
