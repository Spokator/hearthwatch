// Mondes Valheim 1.0 : un dossier par monde dans worlds_local (_main.N.fwl2 / .db2, .chunk, .ok).
// Les anciens mondes (Nom.db + Nom.fwl) sont convertis par le jeu à leur premier chargement.
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { fail } from './errors.js';

const run = promisify(execFile);
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

async function dirStats(dir) {
  const out = { size: 0, modified: 0, generation: null, ok: false };
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const s = await dirStats(p);
      out.size += s.size;
      out.modified = Math.max(out.modified, s.modified);
      continue;
    }
    const st = await fs.lstat(p).catch(() => null);
    if (!st) continue;
    out.size += st.size;
    out.modified = Math.max(out.modified, st.mtimeMs);
    const m = entry.name.match(/^_main\.(\d+)\.fwl2$/);
    if (m) out.generation = Math.max(out.generation ?? 0, Number(m[1]));
    if (entry.name.endsWith('.ok')) out.ok = true;
  }
  return out;
}

async function assertNoSymlinks(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail(400, 'Archive refusée : elle contient des liens symboliques');
    if (entry.isDirectory()) await assertNoSymlinks(path.join(dir, entry.name));
  }
}

// Cherche un monde dans un dossier extrait : dossier 1.0 ou couple Nom.db / Nom.fwl.
async function findWorld(root) {
  const walk = async (dir, depth) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && /^_main\.\d+\.fwl2$/.test(e.name))) return { type: 'folder', path: dir, name: path.basename(dir) };
    for (const fwl of entries.filter((e) => e.isFile() && e.name.endsWith('.fwl'))) {
      const base = fwl.name.slice(0, -4);
      if (!base.includes('_backup_') && entries.some((e) => e.isFile() && e.name === `${base}.db`)) {
        return { type: 'legacy', name: base, db: path.join(dir, `${base}.db`), fwl: path.join(dir, fwl.name) };
      }
    }
    if (depth >= 4) return null;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.includes('_backup_') || e.name === '__MACOSX') continue;
      const found = await walk(path.join(dir, e.name), depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(root, 0);
}

export class Worlds {
  constructor(base) {
    this.data = path.join(base, 'data');
    this.dir = path.join(this.data, 'worlds_local');
    this.uploads = path.join(this.data, 'uploads');
    this.archiveDir = path.join(base, 'backups');
  }

  checkName(name) {
    const s = String(name ?? '').trim();
    if (!NAME.test(s)) fail(400, 'Nom de monde invalide (1 à 40 caractères : lettres sans accent, chiffres, _ et -)');
    return s;
  }

  checkArchive(file) {
    const s = String(file ?? '');
    if (!/^[\w-]+(?:\.[\w-]+)*\.tar\.gz$/.test(s)) fail(400, 'Archive invalide');
    return s;
  }

  async list() {
    let entries = [];
    try {
      entries = await fs.readdir(this.dir, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const worlds = new Map();
    const get = (name) => {
      if (!worlds.has(name)) worlds.set(name, { name, size: 0, modified: 0, format: null, generation: null, legacy: false, backups: [] });
      return worlds.get(name);
    };

    for (const e of entries) {
      const p = path.join(this.dir, e.name);
      const backup = e.name.match(/^(.+?)_backup_(.+?)(\.(db|fwl))?$/);
      if (backup) {
        const st = e.isDirectory() ? await dirStats(p) : await fs.stat(p).then((s) => ({ size: s.size, modified: s.mtimeMs }));
        const w = get(backup[1]);
        let b = w.backups.find((x) => x.tag === backup[2]);
        if (!b) w.backups.push((b = { tag: backup[2], size: 0, modified: 0, legacy: !e.isDirectory() }));
        b.size += st.size;
        b.modified = Math.max(b.modified, st.modified);
      } else if (e.isDirectory() && NAME.test(e.name)) {
        const st = await dirStats(p);
        if (st.generation === null && !st.ok) continue;
        const w = get(e.name);
        Object.assign(w, { size: w.size + st.size, modified: Math.max(w.modified, st.modified), format: '1.0', generation: st.generation });
      } else if (e.isFile()) {
        const m = e.name.match(/^([A-Za-z0-9_-]{1,40})\.(db|fwl)$/);
        if (!m) continue;
        const st = await fs.stat(p);
        const w = get(m[1]);
        w.legacy = true;
        w.format ??= 'ancien';
        w.size += st.size;
        w.modified = Math.max(w.modified, st.mtimeMs);
      }
    }

    return [...worlds.values()]
      .filter((w) => w.format)
      .map((w) => ({
        ...w,
        modified: w.modified ? new Date(w.modified) : null,
        backups: w.backups.map((b) => ({ ...b, modified: new Date(b.modified) })).sort((a, b) => b.modified - a.modified),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Chemins (relatifs à data/) qui composent un monde.
  async worldEntries(name) {
    const out = [];
    for (const rel of [`worlds_local/${name}`, `worlds_local/${name}.db`, `worlds_local/${name}.fwl`]) {
      if (await fs.access(path.join(this.data, rel)).then(() => true, () => false)) out.push(rel);
    }
    if (!out.length) fail(404, `Monde « ${name} » introuvable`);
    return out;
  }

  async removeWorld(name) {
    const entries = await this.worldEntries(name);
    const archive = await this.createArchive(`supprime_${name}`, entries);
    for (const rel of entries) await fs.rm(path.join(this.data, rel), { recursive: true, force: true });
    return archive;
  }

  // Zip du monde pour téléchargement (supprimé une fois envoyé).
  async zipWorld(name) {
    const entries = await this.worldEntries(name);
    await fs.mkdir(this.uploads, { recursive: true });
    const tmp = await fs.mkdtemp(path.join(this.uploads, 'dl-'));
    const zip = path.join(tmp, `${name}.zip`);
    try {
      await run('python3', ['-m', 'zipfile', '-c', zip, ...entries.map((e) => path.basename(e))], { cwd: this.dir, timeout: 600000 });
    } catch (err) {
      await fs.rm(tmp, { recursive: true, force: true });
      throw err;
    }
    const stream = createReadStream(zip);
    stream.on('close', () => fs.rm(tmp, { recursive: true, force: true }));
    return stream;
  }

  async restoreAutoBackup(name, tag) {
    name = this.checkName(name);
    tag = String(tag ?? '');
    if (!/^[\w.-]{1,80}$/.test(tag) || tag.includes('..')) fail(400, 'Sauvegarde invalide');
    const existing = await this.worldEntries(name).catch(() => []);
    const folder = path.join(this.dir, `${name}_backup_${tag}`);

    if (await fs.stat(folder).then((s) => s.isDirectory(), () => false)) {
      const safety = existing.length ? await this.createArchive(`avant_restauration_${name}`, existing) : null;
      await fs.rm(path.join(this.dir, name), { recursive: true, force: true });
      await fs.cp(folder, path.join(this.dir, name), { recursive: true });
      return safety;
    }

    const pairs = ['db', 'fwl'].map((ext) => [path.join(this.dir, `${name}_backup_${tag}.${ext}`), path.join(this.dir, `${name}.${ext}`)]);
    for (const [src] of pairs) await fs.access(src).catch(() => fail(404, 'Sauvegarde introuvable'));
    const safety = existing.length ? await this.createArchive(`avant_restauration_${name}`, existing) : null;
    // Ancien format : on retire le dossier 1.0 pour que le jeu reconvertisse la sauvegarde.
    await fs.rm(path.join(this.dir, name), { recursive: true, force: true });
    for (const [src, dst] of pairs) await fs.copyFile(src, dst);
    return safety;
  }

  // ---------- Import ----------

  async receiveUpload(part) {
    const ext = String(part.filename || '').toLowerCase().match(/\.(zip|tar\.gz|tgz)$/)?.[1];
    if (!ext) {
      part.file.resume();
      fail(400, 'Formats acceptés : .zip ou .tar.gz contenant le dossier du monde');
    }
    await fs.mkdir(this.uploads, { recursive: true });
    const tmp = await fs.mkdtemp(path.join(this.uploads, 'up-'));
    const upload = { tmp, archive: path.join(tmp, ext === 'zip' ? 'monde.zip' : 'monde.tar.gz'), zip: ext === 'zip' };
    await pipeline(part.file, createWriteStream(upload.archive));
    if (part.file.truncated) {
      await this.cleanup([upload]);
      fail(413, 'Fichier trop volumineux (2 Go maximum)');
    }
    return upload;
  }

  async importWorld(upload, { activeName, running }) {
    const out = path.join(upload.tmp, 'contenu');
    await fs.mkdir(out);
    if (upload.zip) {
      await run('python3', ['-m', 'zipfile', '-e', upload.archive, out], { timeout: 600000 });
    } else {
      const { stdout } = await run('tar', ['-tzf', upload.archive], { maxBuffer: 64 * 1024 * 1024 });
      if (stdout.split('\n').some((e) => e.startsWith('/') || e.split('/').includes('..'))) fail(400, 'Archive refusée (chemins invalides)');
      await run('tar', ['-xzf', upload.archive, '-C', out, '--no-same-owner', '--no-same-permissions'], { timeout: 600000 });
    }
    await assertNoSymlinks(out);

    const found = await findWorld(out);
    if (!found) {
      fail(400, "Aucun monde trouvé : l'archive doit contenir le dossier du monde (avec ses fichiers _main…) ou un couple Nom.db + Nom.fwl.");
    }
    if (found.type === 'folder' && found.path === out) {
      fail(400, "Les fichiers du monde sont à la racine de l'archive : zippe le dossier du monde lui-même (clic droit sur le dossier → Compresser).");
    }
    const name = this.checkName(found.name);
    if (name === activeName && running) fail(409, 'Arrête le serveur avant de remplacer le monde actif.');

    await fs.mkdir(this.dir, { recursive: true });
    const existing = await this.worldEntries(name).catch(() => []);
    const safety = existing.length ? await this.createArchive(`avant_import_${name}`, existing) : null;
    for (const rel of existing) await fs.rm(path.join(this.data, rel), { recursive: true, force: true });

    if (found.type === 'folder') {
      await fs.rename(found.path, path.join(this.dir, name));
    } else {
      await fs.rename(found.db, path.join(this.dir, `${name}.db`));
      await fs.rename(found.fwl, path.join(this.dir, `${name}.fwl`));
    }
    return { name, format: found.type === 'folder' ? '1.0' : 'ancien', safety };
  }

  async cleanup(uploads) {
    for (const u of uploads) await fs.rm(u.tmp, { recursive: true, force: true });
  }

  // ---------- Archives complètes (<données>/backups) ----------

  // Garde les `keep` archives les plus récentes dont le nom commence par `prefix`.
  async pruneArchives(prefix, keep) {
    const old = (await this.archives()).filter((a) => a.file.startsWith(prefix)).slice(keep);
    for (const a of old) await fs.rm(path.join(this.archiveDir, a.file), { force: true });
    return old.length;
  }

  async archives() {
    await fs.mkdir(this.archiveDir, { recursive: true });
    const out = [];
    for (const file of await fs.readdir(this.archiveDir)) {
      if (!file.endsWith('.tar.gz')) continue;
      const st = await fs.stat(path.join(this.archiveDir, file));
      out.push({ file, size: st.size, created: st.mtime });
    }
    return out.sort((a, b) => b.created - a.created);
  }

  async createArchive(label, entries = ['worlds_local']) {
    await fs.mkdir(this.dir, { recursive: true });
    const file = `${label}-${stamp()}.tar.gz`;
    await run('tar', ['-czf', path.join(this.archiveDir, file), '-C', this.data, ...entries], { timeout: 600000 });
    return file;
  }

  async archivePath(file) {
    const p = path.join(this.archiveDir, this.checkArchive(file));
    await fs.access(p).catch(() => fail(404, 'Archive introuvable'));
    return p;
  }

  async deleteArchive(file) {
    await fs.rm(await this.archivePath(file));
  }

  async restoreArchive(file) {
    const src = await this.archivePath(file);
    const { stdout } = await run('tar', ['-tzf', src], { maxBuffer: 64 * 1024 * 1024 });
    const entries = stdout.split('\n').filter(Boolean);
    if (!entries.length || entries.some((e) => !/^worlds_local(\/|$)/.test(e) || e.split('/').includes('..'))) {
      fail(400, 'Cette archive ne contient pas de mondes Valheim reconnus');
    }
    const safety = await this.createArchive('avant_restauration');
    if (entries.some((e) => e === 'worlds_local/' || e === 'worlds_local')) {
      await fs.rm(this.dir, { recursive: true, force: true });
    } else {
      // Archive d'un seul monde : on remplace uniquement ce monde.
      const roots = new Set(entries.map((e) => e.split('/')[1]).filter(Boolean).map((n) => n.replace(/\.(db|fwl)$/, '')));
      for (const name of roots) {
        for (const rel of [name, `${name}.db`, `${name}.fwl`]) await fs.rm(path.join(this.dir, rel), { recursive: true, force: true });
      }
    }
    await run('tar', ['-xzf', src, '-C', this.data, '--no-same-owner'], { timeout: 600000 });
    return safety;
  }

  streamArchive(p) {
    return createReadStream(p);
  }

  // ---------- Listes (adminlist.txt, bannedlist.txt, permittedlist.txt) ----------

  async readList(file) {
    try {
      const text = await fs.readFile(path.join(this.data, file), 'utf8');
      return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async editList(file, id, add) {
    const p = path.join(this.data, file);
    let lines = [];
    try {
      lines = (await fs.readFile(p, 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {}
    lines = lines.filter((l) => l !== id);
    if (add) lines.push(id);
    await fs.writeFile(p, `${lines.join('\n')}\n`);
  }
}
