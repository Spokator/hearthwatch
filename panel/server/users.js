// Comptes du panel : rôles, permissions, stockage et journal d'audit.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { hashPassword, verifyPassword } from './auth.js';
import { readEnv } from './envfile.js';
import { fail } from './errors.js';

export const PERMISSIONS = {
  'server.control': 'Démarrer, arrêter et redémarrer le serveur',
  'players.view': 'Voir les joueurs connectés et l’historique',
  'players.moderate': 'Expulser, bannir et gérer les listes d’accès',
  'players.cheat': 'Donner des objets, soigner, blesser, téléporter',
  'world.view': 'Voir le monde, les événements et les coffres',
  'map.view': 'Voir la carte en direct (zones explorées)',
  'map.spoilers': 'Voir toute la carte : zones inexplorées, boss, donjons et minerais cachés',
  'world.message': 'Envoyer des messages aux joueurs',
  'world.edit': 'Événements, progression, invocations, coffres et objets',
  'worlds.manage': 'Mondes, imports, sauvegardes et restaurations',
  'config.edit': 'Voir et modifier la configuration du serveur',
  'logs.view': 'Lire les journaux du serveur',
  console: 'Console RCON (commandes brutes)',
  'audit.view': 'Consulter le journal d’audit',
  'users.manage': 'Gérer les comptes du panel',
};

const ALL = Object.keys(PERMISSIONS);

export const ROLES = {
  owner: { label: 'Propriétaire', description: 'Accès total, y compris la gestion des comptes du panel.', permissions: ALL },
  admin: { label: 'Administrateur', description: 'Gère tout le serveur, sauf les comptes du panel.', permissions: ALL.filter((p) => p !== 'users.manage') },
  moderator: {
    label: 'Modérateur',
    description: 'Surveille et modère les joueurs, envoie des messages.',
    permissions: ['players.view', 'players.moderate', 'world.view', 'world.message', 'logs.view', 'map.view'],
  },
  viewer: {
    label: 'Observateur',
    description: 'Consultation seule : état, joueurs, carte des zones explorées et journaux.',
    permissions: ['players.view', 'world.view', 'logs.view', 'map.view'],
  },
};

const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
// Hash factice : la vérification prend le même temps que l'utilisateur existe ou non.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

export const randomPassword = () => crypto.randomBytes(12).toString('base64url');

export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) fail(400, 'Le mot de passe doit faire entre 10 et 200 caractères');
  return password;
}

export class UserStore {
  constructor(file, legacyEnvFile) {
    this.file = file;
    this.legacyEnvFile = legacyEnvFile;
    this.users = [];
    this.mtime = 0;
    this.queue = Promise.resolve();
  }

  static permissions(user) {
    return ROLES[user?.role]?.permissions || [];
  }

  static can(user, permission) {
    return UserStore.permissions(user).includes(permission);
  }

  // Renvoie { username, password } si un compte propriétaire vient d'être créé (premier démarrage).
  async load() {
    try {
      await this.#read();
      return null;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    // Ancienne installation : le compte unique de panel.env devient propriétaire.
    const env = await readEnv(this.legacyEnvFile);
    if (env.ADMIN_USER && env.ADMIN_PASSWORD_HASH) {
      this.users = [this.#newUser({ username: env.ADMIN_USER, role: 'owner', passwordHash: env.ADMIN_PASSWORD_HASH, mustChangePassword: false }, null)];
      await this.#save();
      return null;
    }
    // Nouvelle installation : propriétaire « admin » avec un mot de passe temporaire.
    const password = randomPassword();
    this.users = [this.#newUser({ username: 'admin', role: 'owner', passwordHash: hashPassword(password), mustChangePassword: true }, null)];
    await this.#save();
    return { username: 'admin', password };
  }

  // Relit le fichier s'il a été modifié ailleurs (ex. set-password.js).
  async refresh() {
    const st = await fs.stat(this.file).catch(() => null);
    if (st && st.mtimeMs !== this.mtime) await this.#read();
  }

  async #read() {
    const text = await fs.readFile(this.file, 'utf8');
    this.users = JSON.parse(text).users || [];
    this.mtime = (await fs.stat(this.file)).mtimeMs;
  }

  #save() {
    const write = async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ users: this.users }, null, 2), { mode: 0o600 });
      await fs.rename(tmp, this.file);
      this.mtime = (await fs.stat(this.file)).mtimeMs;
    };
    this.queue = this.queue.then(write, write);
    return this.queue;
  }

  #newUser({ username, role, passwordHash, mustChangePassword }, createdBy) {
    return {
      id: crypto.randomUUID(),
      username,
      role,
      passwordHash,
      disabled: false,
      mustChangePassword,
      createdAt: new Date().toISOString(),
      createdBy,
      lastLoginAt: null,
      lastLoginIp: null,
    };
  }

  #byName(name) {
    const n = String(name ?? '').toLowerCase();
    return this.users.find((u) => u.username.toLowerCase() === n) || null;
  }

  #get(id) {
    return this.byId(id) || fail(404, 'Compte introuvable');
  }

  #activeOwners(excludeId) {
    return this.users.filter((u) => u.role === 'owner' && !u.disabled && u.id !== excludeId).length;
  }

  byId(id) {
    return this.users.find((u) => u.id === id) || null;
  }

  publicUser(u) {
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      roleLabel: ROLES[u.role]?.label || u.role,
      permissions: UserStore.permissions(u),
      disabled: u.disabled,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt,
      createdBy: u.createdBy,
      lastLoginAt: u.lastLoginAt,
      lastLoginIp: u.lastLoginIp,
    };
  }

  list() {
    return this.users.map((u) => this.publicUser(u));
  }

  authenticate(username, password) {
    const user = this.#byName(username);
    const ok = verifyPassword(String(password ?? ''), user?.passwordHash || DUMMY_HASH);
    return user && ok && !user.disabled ? user : null;
  }

  async recordLogin(user, ip) {
    user.lastLoginAt = new Date().toISOString();
    user.lastLoginIp = ip;
    await this.#save();
  }

  async create({ username, role }, password, actor) {
    username = String(username ?? '').trim();
    if (!USERNAME.test(username)) fail(400, "Nom d'utilisateur invalide (3 à 32 caractères : lettres, chiffres, _ . -)");
    if (this.#byName(username)) fail(409, 'Ce nom est déjà utilisé');
    if (!ROLES[role]) fail(400, 'Rôle inconnu');
    const user = this.#newUser({ username, role, passwordHash: hashPassword(checkPassword(password)), mustChangePassword: true }, actor?.username ?? null);
    this.users.push(user);
    await this.#save();
    return user;
  }

  async update(id, { role, disabled }, actor) {
    const user = this.#get(id);
    if (user.id === actor.id) fail(400, 'Tu ne peux pas modifier ton propre rôle ni désactiver ton propre compte');
    if (role !== undefined && !ROLES[role]) fail(400, 'Rôle inconnu');
    if (disabled !== undefined && typeof disabled !== 'boolean') fail(400, 'Valeur invalide');
    const nextRole = role ?? user.role;
    const nextDisabled = disabled ?? user.disabled;
    if (user.role === 'owner' && (nextRole !== 'owner' || nextDisabled) && this.#activeOwners(user.id) === 0) {
      fail(400, 'Il doit rester au moins un propriétaire actif');
    }
    user.role = nextRole;
    user.disabled = nextDisabled;
    await this.#save();
    return user;
  }

  async setPassword(id, password, { mustChange }) {
    const user = this.#get(id);
    user.passwordHash = hashPassword(checkPassword(password));
    user.mustChangePassword = mustChange;
    await this.#save();
    return user;
  }

  async remove(id, actor) {
    const user = this.#get(id);
    if (user.id === actor.id) fail(400, 'Tu ne peux pas supprimer ton propre compte');
    if (user.role === 'owner' && this.#activeOwners(user.id) === 0) fail(400, 'Il doit rester au moins un propriétaire actif');
    this.users = this.users.filter((u) => u.id !== id);
    await this.#save();
    return user;
  }

  // Récupération d'accès en ligne de commande : compte propriétaire actif avec ce mot de passe.
  async recover(username, password) {
    let user = this.#byName(username);
    if (!user) {
      if (!USERNAME.test(username)) fail(400, "Nom d'utilisateur invalide");
      user = this.#newUser({ username, role: 'owner', passwordHash: '', mustChangePassword: false }, 'set-password.js');
      this.users.push(user);
    }
    Object.assign(user, { role: 'owner', disabled: false, mustChangePassword: false, passwordHash: hashPassword(checkPassword(password)) });
    await this.#save();
    return user;
  }
}

// Journal d'audit : une ligne JSON par action, rotation au-delà de 2 Mo.
export class AuditLog {
  constructor(file, maxBytes = 2 * 1024 * 1024) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.queue = Promise.resolve();
  }

  add(entry) {
    const write = async () => {
      const st = await fs.stat(this.file).catch(() => null);
      if (st && st.size > this.maxBytes) await fs.rename(this.file, `${this.file}.1`);
      await fs.appendFile(this.file, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
    };
    this.queue = this.queue.then(write, write).catch(() => {});
    return this.queue;
  }

  async list({ limit = 500, user } = {}) {
    const read = (f) => fs.readFile(f, 'utf8').catch(() => '');
    const lines = `${await read(`${this.file}.1`)}${await read(this.file)}`.split('\n').filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (!user || entry.user === user) out.push(entry);
      } catch {}
    }
    return out;
  }
}
