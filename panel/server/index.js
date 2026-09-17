// Panel d'administration Valheim : API + interface web.
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Sessions, verifyPassword } from './auth.js';
import { readEnv, updateEnv } from './envfile.js';
import { fail } from './errors.js';
import { requestLanguage, translate } from './i18n.js';
import * as P from './parsers.js';
import { RconClient, RconError } from './rcon.js';
import * as runtime from './runtime.js';
import * as sys from './system.js';
import { MapService } from './map.js';
import { ModConfig } from './modconfig.js';
import { BOSSES, GameMaster, LOOT_PRESETS } from './gamemaster.js';
import { ArenaService } from './arena.js';
import { CityService } from './city/service.js';
import { WorldEngine } from './world/engine.js';
import { AuditLog, PERMISSIONS, ROLES, UserStore, randomPassword } from './users.js';
import { Worlds } from './worlds.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BASE = runtime.DATA_DIR;
const GAME_ENV = path.join(BASE, 'valheim.env');
const PANEL_ENV = path.join(BASE, 'panel.env');
const PLUGINS = path.join(BASE, 'server/BepInEx/plugins');
const COOKIE = 'vp_session';
const PORTAL_COOKIE = 'hw_portal';

const panelEnv = await readEnv(PANEL_ENV);
const PUBLIC_ADDRESS = runtime.PUBLIC_ADDRESS || panelEnv.PUBLIC_HOST || '';
const rcon = new RconClient({ port: Number(panelEnv.RCON_PORT || 2458), password: panelEnv.RCON_PASSWORD || '' });
const sessions = new Sessions();
const users = new UserStore(path.join(BASE, 'panel-users.json'), PANEL_ENV);
const initialAdmin = await users.load();
if (initialAdmin) {
  console.log(
    [
      '',
      '[hearthwatch] First start: owner account created.',
      `[hearthwatch]   username: ${initialAdmin.username}`,
      `[hearthwatch]   password: ${initialAdmin.password}`,
      '[hearthwatch] You will be asked to choose your own password after signing in.',
      '',
    ].join('\n'),
  );
}
const audit = new AuditLog(path.join(BASE, 'panel-audit.log'));
const worlds = new Worlds(BASE);
const map = new MapService(path.join(BASE, 'data/panelmap'));
const arena = new ArenaService(path.join(BASE, 'data/panelmap'));
const city = new CityService(path.join(BASE, 'data/panelmap'), arena);
// Monde vivant : habitants, émotions, économie, quêtes, dialogue par IA (voir server/world).
const world = new WorldEngine({
  panelDir: path.join(BASE, 'data/panelmap'),
  dataDir: path.join(BASE, 'world'),
  arena,
  // Console du serveur : invocations des raids et des primes de chasse.
  rcon: (line) => command(line),
  // Relief du monde : pour poser un coffre ou des bêtes sur la terre ferme.
  ground: (x, z) => map.groundHeight(x, z),
  // Service vocal facultatif (deploy/install-voice.sh) : voix des habitants et dictée sur le portail.
  voice: { baseUrl: panelEnv.VOICE_URL || process.env.VOICE_URL || '', key: panelEnv.VOICE_KEY || process.env.VOICE_KEY || '' },
});
await world.start().catch((error) => console.error('[world] start failed', error));
const modConfig = new ModConfig(path.join(BASE, 'server/BepInEx/config'));
// Les fonctions utilitaires (command, arg...) sont déclarées plus bas : elles sont hissées et appelées plus tard.
const gm = new GameMaster(path.join(BASE, 'panel-gm.json'), {
  command: (cmd) => command(cmd),
  arg: (value, label) => arg(value, label),
  int: (value, label, min, max) => int(value, label, min, max),
  prefabName: (value) => prefabName(value),
  onlinePlayers: () => onlinePlayers(),
  groundHeight: (x, z) => map.groundHeight(x, z),
  controlGame: (action) => controlGame(action),
  log: (message) => console.warn(message),
});
await gm.load();
const prefabs = readFileSync(path.join(ROOT, 'data/prefabs.json'), 'utf8');
const live = P.createJournalState();
const logClients = new Set();

const PRESETS = ['casual', 'easy', 'normal', 'hard', 'hardcore', 'immersive', 'hammer'];
const MODIFIERS = {
  combat: ['veryeasy', 'easy', 'hard', 'veryhard'],
  deathpenalty: ['casual', 'veryeasy', 'easy', 'hard', 'hardcore'],
  resources: ['muchless', 'less', 'more', 'muchmore'],
  raids: ['none', 'muchless', 'less', 'more', 'muchmore'],
  portals: ['casual', 'hard', 'veryhard'],
};
const WORLD_KEYS = ['nobuildcost', 'playerevents', 'passivemobs', 'nomap'];
const CHESTS = ['piece_chest_wood', 'piece_chest', 'piece_chest_private', 'piece_chest_blackmetal', 'piece_chest_barrel', 'piece_chest_grausten', 'piece_chest_warderobe'];
const LISTS = {
  admin: { file: 'adminlist.txt', add: 'addAdmin', remove: 'removeAdmin', label: 'administrateurs' },
  banned: { file: 'bannedlist.txt', add: 'ban', remove: 'unban', label: 'bannis' },
  permitted: { file: 'permittedlist.txt', add: 'addPermitted', remove: 'removePermitted', label: 'liste blanche' },
};
// Réponses de ValheimRcon qui signalent un échec.
const RCON_FAILURE =
  /^(Cannot |Unknown |No object found|Either |Index -?\d+ is out|Item .+ not found|Object .+ (is not|cannot)|Container .+ (is currently|is owned)|Failed|Prefab .+ not found|.+ must be at least|At least one|Argument at|Nothing to spawn|Unauthorized|Empty command|Error|Exception)/;

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, trustProxy: runtime.TRUST_PROXY, bodyLimit: 1024 * 1024 });
app.decorateRequest('user', null);
app.decorateRequest('token', null);
app.decorateRequest('audit', null);
await app.register(cookie);
await app.register(rateLimit, { global: false });
await app.register(multipart, { limits: { fileSize: 2 * 1024 ** 3, files: 1, fields: 4 } });
await app.register(fastifyStatic, { root: path.join(ROOT, '../dist'), wildcard: false });
// Le portail des joueurs envoie de courts enregistrements à transcrire : ils arrivent bruts.
app.addContentTypeParser(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/mpeg', 'application/octet-stream'], { parseAs: 'buffer' }, (req, body, done) => done(null, body));

// ---------- Utilitaires ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookieOptions = (req) => ({ path: '/', httpOnly: true, sameSite: 'strict', secure: req.protocol === 'https', maxAge: 12 * 3600 });
const isRunning = async () => (await sys.serviceStatus()).state === 'active';
const perm = (permission) => ({ config: { perm: permission } });

function requirePerm(req, permission) {
  if (!UserStore.can(req.user, permission)) fail(403, 'Ton rôle ne permet pas cette action.');
}

async function command(cmd) {
  let out;
  try {
    out = (await rcon.exec(cmd)).trim();
  } catch (err) {
    if (err instanceof RconError) fail(503, `Serveur de jeu injoignable : il est arrêté ou en cours de démarrage (${err.message}).`);
    throw err;
  }
  if (RCON_FAILURE.test(out)) fail(400, out);
  return out;
}

// Argument de commande RCON : les espaces sont protégés par des guillemets.
function arg(value, label = 'Valeur') {
  const s = String(value ?? '').trim();
  if (!s || s.length > 200 || /["\r\n]/.test(s)) fail(400, `${label} invalide`);
  return /\s/.test(s) ? `"${s}"` : s;
}

function int(value, label, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${label} : nombre entier entre ${min} et ${max} attendu`);
  return n;
}

function coord(value, label) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n) || Math.abs(n) > 100000) fail(400, `Coordonnée ${label} invalide`);
  return Math.round(n * 100) / 100;
}

function prefabName(value) {
  const s = String(value ?? '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(s)) fail(400, 'Nom de prefab invalide');
  return s;
}

function objectId(value) {
  const s = String(value ?? '');
  if (!/^\d{1,10}:-?\d{1,20}$/.test(s)) fail(400, "Identifiant d'objet invalide");
  return s;
}

async function onlinePlayers() {
  return P.parsePlayers(await command('players')).players;
}

// { player } ou { x, y, z } -> [x, y, z]
async function resolvePosition(body = {}) {
  if (body.player) {
    const p = (await onlinePlayers()).find((x) => x.id === body.player || x.name === body.player);
    if (!p) fail(404, 'Joueur introuvable (déconnecté ?)');
    return p.position;
  }
  return [coord(body.x, 'X'), coord(body.y, 'Y'), coord(body.z, 'Z')];
}

async function controlGame(action) {
  if (action !== 'start' && (await isRunning())) {
    try {
      await rcon.exec('save');
      await sleep(2000);
    } catch {}
  }
  await sys.serviceAction(action);
}

// ---------- Sécurité : session, permissions, audit ----------

// Toute route /api (hors authentification) doit déclarer sa permission.
app.addHook('onRoute', (route) => {
  if (route.method === 'HEAD' || !route.url.startsWith('/api/') || route.url.startsWith('/api/auth/')) return;
  if (route.url.startsWith('/api/portal/')) return; // le portail a sa propre session, liée à un compte de joueur
  if (route.url.startsWith('/api/ai-worker/')) return; // le renfort IA s'authentifie avec sa propre clé
  if (!route.config?.perm) throw new Error(`Permission manquante pour ${route.method} ${route.url}`);
});

const ALLOWED_WHILE_PASSWORD_EXPIRED = new Set(['/api/auth/me', '/api/auth/password', '/api/auth/logout']);

app.addHook('onRequest', async (req) => {
  if (!req.url.startsWith('/api/')) return;
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-panel'] !== '1') fail(403, 'Requête refusée');
  const route = req.routeOptions.url;
  // Renfort IA : une machine de confiance qui vient chercher le travail de dialogue, avec sa clé.
  if (route.startsWith('/api/ai-worker/')) {
    if (req.headers['x-worker-key'] !== world.data.workerKey) fail(403, 'Clé du renfort invalide');
    return;
  }
  // Portail des Élus : session propre au joueur, ouverte avec un code donné en jeu.
  if (route.startsWith('/api/portal/')) {
    if (route === '/api/portal/login') return;
    const account = world.portalAccount(req.cookies[PORTAL_COOKIE]);
    if (!account) fail(401, 'Session expirée : tapez !portail en jeu pour un nouveau code.');
    req.portal = account;
    return;
  }
  if (route === '/api/auth/login') return;

  const token = req.cookies[COOKIE];
  const session = sessions.get(token);
  if (!session) fail(401, 'Session expirée : reconnecte-toi.');
  await users.refresh();
  const user = users.byId(session.user);
  if (!user || user.disabled) {
    sessions.destroy(token);
    fail(401, 'Compte désactivé ou supprimé.');
  }
  if (user.mustChangePassword && !ALLOWED_WHILE_PASSWORD_EXPIRED.has(route)) fail(403, 'Choisis ton mot de passe personnel avant de continuer.');
  const permission = req.routeOptions.config?.perm;
  if (permission && permission !== 'authenticated' && !UserStore.can(user, permission)) fail(403, "Ton rôle ne permet pas d'accéder à cette fonction.");
  req.user = user;
  req.token = token;
});

const SERVER_ACTIONS = { start: 'Démarrage du serveur', stop: 'Arrêt du serveur', restart: 'Redémarrage du serveur' };
const PLAYER_ACTIONS = { kick: 'Expulsion', ban: 'Bannissement', heal: 'Soin', damage: 'Dégâts', teleport: 'Téléportation', give: 'Don d’objet' };

// Description lisible des actions pour le journal d'audit.
function describe(req) {
  const b = req.body || {};
  const p = req.params || {};
  switch (`${req.method} ${req.routeOptions.url}`) {
    case 'POST /api/server/:action':
      return SERVER_ACTIONS[p.action];
    case 'PUT /api/config':
      return `Configuration modifiée${b.restart ? ' (avec redémarrage)' : ''}`;
    case 'POST /api/players/action': {
      let text = `${PLAYER_ACTIONS[b.action] || b.action} : ${b.target}`;
      if (b.action === 'give') text += ` — ${b.count} × ${b.item} (qualité ${b.quality ?? 1})`;
      if (b.action === 'heal' || b.action === 'damage') text += ` (${b.amount})`;
      return text;
    }
    case 'POST /api/lists/:list':
      return `Ajout à la liste ${LISTS[p.list]?.label} : ${b.id}`;
    case 'DELETE /api/lists/:list/:id':
      return `Retrait de la liste ${LISTS[p.list]?.label} : ${p.id}`;
    case 'POST /api/containers/:id/add':
      return `Coffre ${p.id} : ajout de ${b.count} × ${b.item}`;
    case 'POST /api/containers/:id/remove':
      return `Coffre ${p.id} : retrait de ${b.count} objet(s) (emplacement ${b.index})`;
    case 'POST /api/containers/:id/clear':
      return `Coffre ${p.id} vidé`;
    case 'POST /api/objects/delete':
      return `Objet supprimé du monde : ${b.id}`;
    case 'POST /api/world/event':
      return `Événement lancé : ${b.event}`;
    case 'POST /api/world/event/stop':
      return 'Événement arrêté';
    case 'POST /api/world/keys':
      return `Clé globale ajoutée : ${b.key}`;
    case 'DELETE /api/world/keys/:key':
      return `Clé globale retirée : ${p.key}`;
    case 'POST /api/world/spawn':
      return `Invocation : ${b.count ?? 1} × ${b.prefab}`;
    case 'POST /api/world/message':
      return `Message ${b.kind === 'center' ? 'à l’écran' : 'dans le chat'} : « ${String(b.text ?? '').slice(0, 150)} »`;
    case 'POST /api/world/save':
      return 'Sauvegarde du monde';
    case 'POST /api/console':
      return `Console : ${String(b.command ?? '').slice(0, 200)}`;
    case 'POST /api/worlds/activate':
      return `Monde activé : ${b.name}`;
    case 'DELETE /api/worlds/:name':
      return `Monde supprimé : ${p.name}`;
    case 'POST /api/worlds/:name/restore':
      return `Sauvegarde restaurée pour ${p.name} (${b.tag})`;
    case 'POST /api/archives':
      return 'Archive créée';
    case 'POST /api/archives/:file/restore':
      return `Archive restaurée : ${p.file}`;
    case 'DELETE /api/archives/:file':
      return `Archive supprimée : ${p.file}`;
    case 'POST /api/auth/password':
      return 'Mot de passe personnel modifié';
    default:
      return `${req.method} ${req.routeOptions.url}`;
  }
}

app.addHook('onResponse', async (req, reply) => {
  if (!req.user || req.method === 'GET' || req.method === 'HEAD' || reply.statusCode >= 400) return;
  audit.add({ user: req.user.username, ip: req.ip, action: req.audit || describe(req) });
});

app.addHook('onSend', async (req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (req.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  return payload;
});

app.setErrorHandler((err, req, reply) => {
  const code = err.statusCode >= 400 ? err.statusCode : 500;
  if (code >= 500) req.log.error(err);
  const message = code === 500 ? `Erreur interne : ${err.message}` : err.message;
  reply.code(code).send({ error: translate(requestLanguage(req), message) });
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: translate(requestLanguage(req), 'Route inconnue') });
  return reply.sendFile('index.html');
});

// ---------- Authentification ----------

app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
  const { username, password } = req.body || {};
  await users.refresh();
  const user = users.authenticate(username, password);
  if (!user) {
    await sleep(800);
    audit.add({ user: String(username ?? '').slice(0, 32), ip: req.ip, action: 'Échec de connexion', failed: true });
    req.log.warn({ ip: req.ip }, 'échec de connexion au panel');
    fail(401, 'Identifiants incorrects');
  }
  await users.recordLogin(user, req.ip);
  audit.add({ user: user.username, ip: req.ip, action: 'Connexion' });
  reply.setCookie(COOKIE, sessions.create(user.id), cookieOptions(req));
  return { user: users.publicUser(user) };
});

app.get('/api/auth/me', async (req) => ({ user: users.publicUser(req.user), roles: ROLES, permissions: PERMISSIONS }));

app.post('/api/auth/logout', async (req, reply) => {
  sessions.destroy(req.token);
  reply.clearCookie(COOKIE, { path: '/' });
  req.audit = 'Déconnexion';
  return { ok: true };
});

app.post('/api/auth/password', async (req) => {
  const { current, next } = req.body || {};
  if (!verifyPassword(String(current ?? ''), req.user.passwordHash)) fail(400, 'Mot de passe actuel incorrect');
  if (current === next) fail(400, 'Choisis un mot de passe différent de l’actuel');
  const user = await users.setPassword(req.user.id, next, { mustChange: false });
  sessions.destroyUser(user.id, req.token);
  return { user: users.publicUser(user) };
});

// ---------- Comptes du panel ----------

app.get('/api/users', perm('users.manage'), async () => ({ users: users.list(), roles: ROLES, permissions: PERMISSIONS }));

app.post('/api/users', perm('users.manage'), async (req) => {
  const password = randomPassword();
  const user = await users.create(req.body || {}, password, req.user);
  req.audit = `Compte créé : ${user.username} (${ROLES[user.role].label})`;
  return { user: users.publicUser(user), password };
});

app.patch('/api/users/:id', perm('users.manage'), async (req) => {
  const { role, disabled } = req.body || {};
  const user = await users.update(req.params.id, { role, disabled }, req.user);
  if (user.disabled) sessions.destroyUser(user.id);
  req.audit = disabled !== undefined ? `Compte ${user.disabled ? 'désactivé' : 'réactivé'} : ${user.username}` : `Rôle de ${user.username} : ${ROLES[user.role].label}`;
  return { user: users.publicUser(user) };
});

app.post('/api/users/:id/reset-password', perm('users.manage'), async (req) => {
  if (req.params.id === req.user.id) fail(400, 'Utilise « Mon compte » pour changer ton propre mot de passe');
  const password = randomPassword();
  const user = await users.setPassword(req.params.id, password, { mustChange: true });
  sessions.destroyUser(user.id);
  req.audit = `Mot de passe réinitialisé : ${user.username}`;
  return { password };
});

app.delete('/api/users/:id', perm('users.manage'), async (req) => {
  const user = await users.remove(req.params.id, req.user);
  sessions.destroyUser(user.id);
  req.audit = `Compte supprimé : ${user.username}`;
  return { ok: true };
});

app.get('/api/audit', perm('audit.view'), async (req) => {
  const user = req.query.user ? String(req.query.user) : undefined;
  const [entries, all] = await Promise.all([audit.list({ limit: 500, user }), audit.list({ limit: 5000 })]);
  return { entries, users: [...new Set(all.map((e) => e.user).filter(Boolean))].sort() };
});

// ---------- État & contrôle ----------

app.get('/api/status', perm('authenticated'), async (req) => {
  const [service, env, host, disk] = await Promise.all([sys.serviceStatus({ cpu: true }), readEnv(GAME_ENV), sys.hostStats(), sys.diskUsage(BASE)]);
  const mods = env.MODS_ENABLED !== '0';
  let stats = null;
  let players = [];
  let rconError = null;
  if (service.state === 'active' && mods) {
    try {
      stats = P.parseServerStats(await rcon.exec('serverStats'));
      players = P.parsePlayers(await rcon.exec('players')).players;
    } catch (err) {
      rconError = translate(requestLanguage(req), err.message);
    }
  }
  const phase =
    { active: stats || !mods ? 'online' : 'starting', activating: 'updating', deactivating: 'stopping', failed: 'failed' }[service.state] || 'stopped';
  const envMtime = (await fs.stat(GAME_ENV)).mtimeMs;
  return {
    phase,
    service,
    stats,
    players,
    rconError,
    host,
    disk,
    pendingRestart:
      service.state === 'active' && !!service.since && (envMtime > Date.parse(service.since) + 2000 || (modConfig.lastWrite ?? 0) > Date.parse(service.since)),
    game: {
      name: env.SERVER_NAME,
      world: env.WORLD_NAME,
      host: PUBLIC_ADDRESS || req.hostname,
      port: Number(env.SERVER_PORT || 2456),
      public: env.SERVER_PUBLIC === '1',
      crossplay: env.SERVER_CROSSPLAY === '1',
      mods,
      joinCode: service.state === 'active' ? live.joinCode : null,
      version: live.version,
    },
    recent: live.history.slice(0, 8),
  };
});

app.post('/api/server/:action', perm('server.control'), async (req) => {
  const { action } = req.params;
  if (!['start', 'stop', 'restart'].includes(action)) fail(404, 'Action inconnue');
  await controlGame(action);
  return { ok: true };
});

// ---------- Configuration ----------

app.get('/api/config', perm('config.edit'), async () => {
  const env = await readEnv(GAME_ENV);
  return {
    values: {
      name: env.SERVER_NAME || '',
      password: env.SERVER_PASSWORD || '',
      world: env.WORLD_NAME || '',
      public: env.SERVER_PUBLIC === '1',
      crossplay: env.SERVER_CROSSPLAY === '1',
      mods: env.MODS_ENABLED !== '0',
      saveInterval: Number(env.SAVE_INTERVAL || 1200),
      backups: Number(env.BACKUPS || 4),
      backupShort: Number(env.BACKUP_SHORT || 7200),
      backupLong: Number(env.BACKUP_LONG || 43200),
      preset: env.WORLD_PRESET || '',
      modifiers: Object.fromEntries((env.WORLD_MODIFIERS || '').split(/\s+/).filter(Boolean).map((m) => m.split(':'))),
      keys: (env.WORLD_KEYS || '').split(/\s+/).filter(Boolean),
    },
    port: Number(env.SERVER_PORT || 2456),
    worlds: (await worlds.list()).map((w) => w.name),
  };
});

app.put('/api/config', perm('config.edit'), async (req) => {
  const b = req.body || {};
  const name = String(b.name ?? '').trim();
  const password = String(b.password ?? '');
  const world = worlds.checkName(b.world);
  if (!name || name.length > 64 || /["'\\$`\r\n]/.test(name)) fail(400, 'Nom du serveur invalide (1 à 64 caractères, sans guillemets ni $)');
  if (password.length < 5 || password.length > 64 || /["'\\$`\s]/.test(password)) {
    fail(400, 'Mot de passe : 5 à 64 caractères, sans espace, guillemet ni $');
  }
  if (name.toLowerCase().includes(password.toLowerCase())) fail(400, 'Le mot de passe ne doit pas apparaître dans le nom du serveur (règle de Valheim)');
  const preset = String(b.preset ?? '');
  if (preset && !PRESETS.includes(preset)) fail(400, 'Préréglage inconnu');
  const modifiers = Object.entries(b.modifiers || {}).filter(([, v]) => v);
  for (const [k, v] of modifiers) if (!MODIFIERS[k]?.includes(v)) fail(400, `Modificateur invalide : ${k}`);
  const keys = [...new Set(b.keys || [])];
  for (const k of keys) if (!WORLD_KEYS.includes(k)) fail(400, `Option inconnue : ${k}`);

  await updateEnv(GAME_ENV, {
    SERVER_NAME: name,
    SERVER_PASSWORD: password,
    WORLD_NAME: world,
    SERVER_PUBLIC: b.public ? '1' : '0',
    SERVER_CROSSPLAY: b.crossplay ? '1' : '0',
    MODS_ENABLED: b.mods ? '1' : '0',
    SAVE_INTERVAL: String(int(b.saveInterval, 'Intervalle de sauvegarde', 60, 7200)),
    BACKUPS: String(int(b.backups, 'Nombre de sauvegardes', 1, 50)),
    BACKUP_SHORT: String(int(b.backupShort, 'Délai sauvegarde courte', 300, 86400)),
    BACKUP_LONG: String(int(b.backupLong, 'Délai sauvegarde longue', 3600, 604800)),
    WORLD_PRESET: preset,
    WORLD_MODIFIERS: modifiers.map(([k, v]) => `${k}:${v}`).join(' '),
    WORLD_KEYS: keys.join(' '),
  });
  if (b.restart) await controlGame('restart');
  return { ok: true };
});

app.get('/api/mods', perm('config.edit'), async () => {
  const mods = [];
  for (const dir of await fs.readdir(PLUGINS).catch(() => [])) {
    try {
      const m = JSON.parse((await fs.readFile(path.join(PLUGINS, dir, 'manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
      mods.push({ name: m.name, version: m.version_number, description: m.description, website: m.website_url });
    } catch {
      mods.push({ name: dir });
    }
  }
  return { mods };
});

// ---------- Joueurs ----------

app.get('/api/players', perm('players.view'), async () => {
  let data = { online: 0, players: [] };
  let error = null;
  if (await isRunning()) {
    try {
      data = P.parsePlayers(await rcon.exec('players'));
    } catch (err) {
      error = err.message;
    }
  }
  return { ...data, error, history: live.history };
});

app.post('/api/players/action', perm('players.view'), async (req) => {
  const b = req.body || {};
  requirePerm(req, ['kick', 'ban'].includes(b.action) ? 'players.moderate' : 'players.cheat');
  const target = arg(b.target, 'Joueur');
  switch (b.action) {
    case 'kick':
      return { output: await command(`kick ${target}`) };
    case 'ban':
      return { output: await command(`ban ${target}`) };
    case 'heal':
      return { output: await command(`heal ${target} ${int(b.amount, 'Soin', 1, 100000)}`) };
    case 'damage':
      return { output: await command(`damage ${target} ${int(b.amount, 'Dégâts', 1, 100000)}`) };
    case 'teleport': {
      const [x, y, z] = await resolvePosition(b.to);
      return { output: await command(`teleport ${target} ${x} ${y} ${z}`) };
    }
    case 'give': {
      const cmd = `give ${target} ${prefabName(b.item)} -count ${int(b.count, 'Quantité', 1, 9999)} -quality ${int(b.quality ?? 1, 'Qualité', 1, 10)}`;
      return { output: await command(cmd) };
    }
    default:
      fail(400, 'Action inconnue');
  }
});

app.get('/api/lists', perm('players.view'), async () => {
  const out = {};
  for (const [key, list] of Object.entries(LISTS)) out[key] = await worlds.readList(list.file);
  return out;
});

async function editList(req, add) {
  const list = LISTS[req.params.list] || fail(404, 'Liste inconnue');
  const id = String((add ? req.body?.id : req.params.id) ?? '').trim();
  if (!/^[\w:.@-]{2,100}$/.test(id)) fail(400, 'Identifiant invalide (sans espace)');
  if (await isRunning()) await command(`${add ? list.add : list.remove} ${id}`);
  else await worlds.editList(list.file, id, add);
  return { ok: true };
}
app.post('/api/lists/:list', perm('players.moderate'), (req) => editList(req, true));
app.delete('/api/lists/:list/:id', perm('players.moderate'), (req) => editList(req, false));

// ---------- Objets, coffres ----------

app.get('/api/prefabs', perm('authenticated'), async (req, reply) => {
  reply.header('Cache-Control', 'private, max-age=3600').type('application/json');
  return prefabs;
});

async function nearClause(q) {
  if (!q.player && (q.x ?? '') === '') return '';
  const [x, y, z] = await resolvePosition(q);
  return ` -near ${x} ${y} ${z} ${int(q.radius ?? 50, 'Rayon', 1, 20000)}`;
}

app.get('/api/containers', perm('world.view'), async (req) => {
  const near = await nearClause(req.query);
  const list = req.query.prefab ? [prefabName(req.query.prefab)] : CHESTS;
  const objects = [];
  let truncated = false;
  for (const prefab of list) {
    const r = P.parseObjects(await command(`findObjects -prefab ${prefab}${near}`));
    objects.push(...r.objects);
    truncated ||= r.truncated;
  }
  return { objects, truncated };
});

app.get('/api/containers/:id', perm('world.view'), async (req) => {
  const id = objectId(req.params.id);
  const out = await command(`showContainer ${id}`);
  return { id, info: P.parseObjectLine(out.split('\n')[0]), ...P.parseContainer(out) };
});

app.post('/api/containers/:id/add', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const cmd = `addItemToContainer ${objectId(req.params.id)} ${prefabName(b.item)} -count ${int(b.count, 'Quantité', 1, 9999)} -quality ${int(b.quality ?? 1, 'Qualité', 1, 10)}`;
  return { output: await command(cmd + (b.force ? ' -force' : '')) };
});

app.post('/api/containers/:id/remove', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const cmd = `removeItemFromContainer ${objectId(req.params.id)} -index ${int(b.index, 'Index', 0, 10000)} -count ${int(b.count, 'Quantité', 1, 9999)}`;
  return { output: await command(cmd + (b.force ? ' -force' : '')) };
});

app.post('/api/containers/:id/clear', perm('world.edit'), async (req) => {
  return { output: await command(`clearContainer ${objectId(req.params.id)}${req.body?.force ? ' -force' : ''}`) };
});

app.get('/api/objects', perm('world.view'), async (req) => {
  const q = req.query;
  let criteria = await nearClause(q);
  if (q.prefab) criteria += ` -prefab ${prefabName(q.prefab)}`;
  if (q.tag) criteria += ` -tag ${arg(q.tag, 'Tag')}`;
  if (!criteria) fail(400, 'Indique au moins un critère (prefab ou position)');
  return P.parseObjects(await command(`findObjects${criteria}`));
});

app.post('/api/objects/delete', perm('world.edit'), async (req) => {
  return { output: await command(`deleteObjects -id ${objectId(req.body?.id)}${req.body?.force ? ' -force' : ''}`) };
});

// ---------- Monde ----------

app.get('/api/world', perm('world.view'), async () => {
  const time = await command('time');
  const keys = await command('globalKeys');
  const events = await command('eventsList');
  const current = await command('currentEvent');
  return {
    time: P.parseTime(time),
    globalKeys: P.parseGlobalKeys(keys),
    events: P.parseEvents(events),
    currentEvent: /^No active/.test(current) ? null : current,
  };
});

app.post('/api/world/event', perm('world.edit'), async (req) => {
  const event = String(req.body?.event ?? '');
  if (!/^[A-Za-z0-9_]{2,60}$/.test(event)) fail(400, 'Événement invalide');
  const [x, y, z] = await resolvePosition(req.body);
  return { output: await command(`startEvent ${event} ${x} ${y} ${z}`) };
});

app.post('/api/world/event/stop', perm('world.edit'), async () => ({ output: await command('stopEvent') }));

app.post('/api/world/keys', perm('world.edit'), async (req) => {
  const key = String(req.body?.key ?? '').trim();
  if (!/^[A-Za-z0-9_]{2,60}$/.test(key)) fail(400, 'Clé invalide');
  return { output: await command(`addGlobalKey ${key}`) };
});

app.delete('/api/world/keys/:key', perm('world.edit'), async (req) => {
  const key = String(req.params.key);
  if (!/^[A-Za-z0-9_]{2,60}$/.test(key)) fail(400, 'Clé invalide');
  return { output: await command(`removeGlobalKey ${key}`) };
});

app.post('/api/world/spawn', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const [x, y, z] = await resolvePosition(b);
  let cmd = `spawn ${prefabName(b.prefab)} ${x} ${y} ${z} -count ${int(b.count ?? 1, 'Quantité', 1, 50)} -level ${int(b.level ?? 1, 'Niveau', 1, 10)} -radius ${int(b.radius ?? 3, 'Rayon', 0, 100)}`;
  if (b.tamed) cmd += ' -tamed';
  return { output: await command(cmd) };
});

app.post('/api/world/message', perm('world.message'), async (req) => {
  const text = String(req.body?.text ?? '').replace(/["\r\n]+/g, ' ').trim();
  if (!text || text.length > 300) fail(400, 'Message vide ou trop long (300 caractères max)');
  return { output: await command(`${req.body?.kind === 'center' ? 'showMessage' : 'say'} ${text}`) };
});

app.post('/api/world/save', perm('world.edit'), async () => ({ output: await command('save') }));

// ---------- Maître du jeu ----------

app.get('/api/gm', perm('world.edit'), async (req) => ({
  presets: LOOT_PRESETS,
  bosses: BOSSES,
  hunts: await gm.hunts({ refresh: req.query.refresh === '1' && (await isRunning()) }),
  schedule: gm.schedule(),
}));

app.post('/api/gm/gift', perm('world.edit'), async (req) => {
  const result = await gm.giftAll(req.body);
  req.audit = `Cadeau à tous (${result.players} joueur(s)) : ${result.items.map((i) => `${i.count} × ${i.item}`).join(', ')}`;
  return result;
});

app.post('/api/gm/treasure', perm('world.edit'), async (req) => {
  const hunt = await gm.startTreasure(req.body, req.user.username);
  req.audit = `Chasse au trésor lancée près de ${hunt.origin} (coffre en ${hunt.x}, ${hunt.z})`;
  return hunt;
});

app.delete('/api/gm/treasure/:id', perm('world.edit'), async (req) => {
  const hunt = await gm.cancelTreasure(req.params.id);
  req.audit = `Chasse au trésor annulée (coffre en ${hunt.x}, ${hunt.z})`;
  return hunt;
});

app.post('/api/gm/boss', perm('world.edit'), async (req) => {
  const result = await gm.bossSurprise(req.body);
  req.audit = `Boss surprise : ${result.label} sur ${result.player}`;
  return result;
});

app.post('/api/gm/restart', perm('server.control'), async (req) => {
  const result = gm.scheduleRestart(req.body);
  req.audit = `Redémarrage annoncé programmé pour ${result.at}`;
  return result;
});

app.delete('/api/gm/restart', perm('server.control'), async (req) => {
  req.audit = 'Redémarrage annoncé annulé';
  return gm.cancelRestart();
});

// ---------- Monde vivant ----------

const worldNpc = (key) => {
  const npc = world.npcDetail(String(key));
  if (!npc) fail(404, 'Habitant inconnu');
  return npc;
};

app.get('/api/living', perm('world.view'), async () => world.status());
app.get('/api/living/npcs', perm('world.view'), async () => ({ npcs: world.npcList() }));
app.get('/api/living/npcs/:key', perm('world.view'), async (req) => worldNpc(req.params.key));

app.put('/api/living/npcs/:key', perm('world.edit'), async (req) => {
  worldNpc(req.params.key);
  const b = req.body || {};
  const text = (value, max = 600) => (typeof value === 'string' ? value.replace(/[<>]/g, '').slice(0, max) : undefined);
  const list = (value) => (Array.isArray(value) ? value.map((v) => text(String(v), 80)).filter(Boolean).slice(0, 8) : undefined);
  const traits = b.traits && typeof b.traits === 'object' ? Object.fromEntries(['o', 'c', 'e', 'a', 'n'].map((k) => [k, Math.max(0, Math.min(1, Number(b.traits[k]) || 0))])) : undefined;
  const result = await world.updateNpc(req.params.key, {
    name: text(b.name, 60), speech: text(b.speech), story: text(b.story), secret: text(b.secret), wants: text(b.wants),
    likes: list(b.likes), dislikes: list(b.dislikes), traits, resetMind: !!b.resetMind,
  });
  req.audit = `Habitant modifié : ${result.name}`;
  return result;
});

app.post('/api/living/npcs/:key/simulate', perm('world.edit'), async (req) => {
  worldNpc(req.params.key);
  const text = String(req.body?.text || '').slice(0, 300).trim();
  if (!text) fail(400, 'Message vide');
  return world.simulate(req.params.key, text, String(req.body?.player || 'Panel').slice(0, 30));
});

app.post('/api/living/npcs/:key/speak', perm('world.message'), async (req) => {
  const npc = worldNpc(req.params.key);
  const text = String(req.body?.text || '').slice(0, 300).trim();
  if (!text) fail(400, 'Message vide');
  await world.speak(req.params.key, text, req.body?.mode === 'shout' ? 'shout' : 'say');
  req.audit = `${npc.name} dit : ${text}`;
  return { ok: true };
});

app.get('/api/living/players', perm('world.view'), async () => ({ players: world.playerList() }));
app.get('/api/living/economy', perm('world.view'), async () => ({ shops: world.economySummary() }));
app.get('/api/living/conversations', perm('world.view'), async () => ({ conversations: await world.conversationTail(150) }));
app.get('/api/living/chronicle', perm('world.view'), async () => ({ chronicle: await world.chronicle(80) }));

app.put('/api/living/settings', perm('config.edit'), async (req) => {
  const b = req.body || {};
  const patch = {};
  for (const key of ['enabled', 'barks', 'crier', 'bard', 'sermon', 'chatter']) if (typeof b[key] === 'boolean') patch[key] = b[key];
  if (b.language === 'fr' || b.language === 'en') patch.language = b.language;
  if (Number.isFinite(Number(b.respawnSeconds))) patch.respawnSeconds = Math.max(30, Math.min(3600, Number(b.respawnSeconds)));
  if (b.ai && typeof b.ai === 'object') {
    const a = b.ai;
    patch.ai = {};
    if (typeof a.enabled === 'boolean') patch.ai.enabled = a.enabled;
    if (['ollama', 'openai', 'anthropic'].includes(a.provider)) patch.ai.provider = a.provider;
    for (const key of ['baseUrl', 'model', 'apiKey']) if (typeof a[key] === 'string') patch.ai[key] = a[key].trim().slice(0, 300);
    if (Number.isFinite(Number(a.temperature))) patch.ai.temperature = Math.max(0, Math.min(1.5, Number(a.temperature)));
    if (Number.isFinite(Number(a.maxTokens))) patch.ai.maxTokens = Math.max(40, Math.min(600, Number(a.maxTokens)));
    if (Number.isFinite(Number(a.timeoutSeconds))) patch.ai.timeoutSeconds = Math.max(5, Math.min(180, Number(a.timeoutSeconds)));
    if (Number.isFinite(Number(a.concurrency))) patch.ai.concurrency = Math.max(1, Math.min(8, Number(a.concurrency)));
  }
  req.audit = 'Réglages du monde vivant modifiés';
  return world.updateSettings(patch);
});

app.get('/api/living/ai/models', perm('config.edit'), async () => ({ models: await world.ai.models() }));

// ---------- La Couronne (côté panel) ----------

app.get('/api/living/crown', perm('world.view'), async () => world.crownState());

app.put('/api/living/crown', perm('world.edit'), async (req) => {
  const b = req.body || {};
  if (b.emperor !== undefined) {
    world.crown.emperor = b.emperor ? String(b.emperor) : null;
    world.store.touch();
    req.audit = b.emperor ? `Empereur : ${world.data.players[b.emperor]?.name || b.emperor}` : 'Trône laissé vacant';
  }
  if (Number.isFinite(Number(b.treasury))) {
    world.treasury(Math.round(Number(b.treasury)) - (world.crown.treasury || 0), 'ajustement du panel');
    req.audit = `Trésor impérial : ${world.crown.treasury} pièces`;
  }
  return world.crownState();
});

app.post('/api/living/crown/decree', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const result = await world.issueDecree(String(b.id || ''), { by: b.by || 'la Couronne', rate: Number(b.rate) });
  if (result.error) fail(400, result.error);
  req.audit = `Décret : ${result.text}`;
  return { ...world.crownState(), decree: result.decree, text: result.text };
});

app.post('/api/living/crown/proclaim', perm('world.message'), async (req) => {
  const message = String(req.body?.text || '').replace(/[<>]/g, '').slice(0, 200).trim();
  if (!message) fail(400, 'Message vide');
  await world.proclaim(message, req.body?.by || null);
  req.audit = `Proclamation impériale : ${message}`;
  return world.crownState();
});

app.post('/api/living/crown/pardon', perm('world.edit'), async (req) => {
  const player = world.data.players[String(req.body?.account || '')];
  if (!player) fail(404, 'Joueur inconnu');
  await world.justice.pardon(player, req.body?.by || null);
  req.audit = `Grâce accordée à ${player.name}`;
  return world.crownState();
});

app.post('/api/living/crown/honour', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const result = await world.grantHonour(String(b.account || ''), String(b.honour || ''), b.by || null);
  if (result.error) fail(400, result.error);
  req.audit = `Titre accordé : ${result.title}`;
  return world.crownState();
});

app.post('/api/living/crown/office', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const result = await world.appointOffice(String(b.office || ''), b.account ? String(b.account) : null, b.by || null);
  if (result.error) fail(400, result.error);
  req.audit = `Charge : ${result.title}`;
  return world.crownState();
});

app.post('/api/living/crown/petition/:id', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const result = await world.answerPetition(String(req.params.id), { accept: !!b.accept, answer: b.answer, coins: Number(b.coins) || 0, by: b.by || null });
  if (result.error) fail(400, result.error);
  req.audit = 'Réponse à une doléance';
  return world.crownState();
});

// Lancement d'un événement de la cité à la demande (raid, caravane, fête, prime, trésor, tournoi).
app.post('/api/living/events/:id', perm('world.edit'), async (req) => {
  const id = String(req.params.id);
  if (!['raid', 'caravane', 'fete', 'prime', 'tresor', 'tournoi'].includes(id)) fail(400, 'Événement inconnu');
  const event = await world.triggerEvent(id);
  if (!event) fail(400, 'Le monde ne tourne pas : le serveur de jeu est-il démarré ?');
  req.audit = `Événement lancé : ${event.title}`;
  return { event };
});

// Clé du renfort IA, montrée seulement à qui peut configurer le serveur.
app.get('/api/living/ai/worker-key', perm('config.edit'), async () => ({ key: world.data.workerKey, url: PUBLIC_ADDRESS ? `https://${PUBLIC_ADDRESS}` : '' }));

// Code d'accès au portail pour un joueur, quand il ne peut pas taper !portail lui-même (dépannage).
app.post('/api/living/players/:account/portal-code', perm('world.edit'), async (req) => {
  const player = world.data.players[String(req.params.account)];
  if (!player) fail(404, 'Joueur inconnu');
  req.audit = `Code du portail créé pour ${player.name}`;
  return { code: world.portalCode(player), name: player.name };
});

// ---------- Renfort IA : le PC du joueur vient chercher les répliques à écrire ----------

const workerName = (value) => String(value || 'renfort').replace(/[^w .-]/g, '').slice(0, 40) || 'renfort';

// Attente longue : le renfort reste pendu ici jusqu'à ce qu'un habitant ait besoin de parler.
app.post('/api/ai-worker/next', { config: { worker: true } }, async (req, reply) => {
  const job = await world.ai.worker.take(workerName(req.body?.name), String(req.body?.model || '').slice(0, 60));
  if (!job) return reply.code(204).send();
  return job;
});

app.post('/api/ai-worker/result', { config: { worker: true } }, async (req) => {
  const body = req.body || {};
  const taken = world.ai.worker.deliver(workerName(body.name), String(body.id || ''), { text: body.text, error: body.error });
  return { ok: taken };
});

// ---------- Portail des Élus : site des joueurs, ouvert avec un code donné en jeu ----------

const portalCookie = (req) => ({ path: '/', httpOnly: true, sameSite: 'lax', secure: req.protocol === 'https', maxAge: 60 * 86400 });
const portal = (rateLimit = null) => ({ config: { portal: true, ...(rateLimit ? { rateLimit } : {}) } });

app.post('/api/portal/login', portal({ max: 12, timeWindow: '10 minutes' }), async (req, reply) => {
  const session = world.portalLogin(req.body?.code);
  if (!session) {
    await sleep(600);
    fail(401, 'Code inconnu ou expiré. Tapez !portail en jeu pour en obtenir un nouveau.');
  }
  reply.setCookie(PORTAL_COOKIE, session.token, portalCookie(req));
  return { hero: world.portalHero(session.account) };
});

app.post('/api/portal/logout', portal(), async (req, reply) => {
  world.portalLogout(req.cookies[PORTAL_COOKIE]);
  reply.clearCookie(PORTAL_COOKIE, { path: '/' });
  return { ok: true };
});

app.get('/api/portal/me', portal(), async (req) => {
  await world.voice.health();
  return { hero: world.portalHero(req.portal), voice: world.voice.status(), language: world.lang };
});

app.get('/api/portal/city', portal(), async () => world.portalCity());

// Ce que le téléphone interroge en continu : position du joueur et habitants à portée de voix.
app.get('/api/portal/live', portal({ max: 240, timeWindow: '1 minute' }), async (req) => world.portalLive(req.portal));

// Un repère posé depuis le téléphone apparaît sur la carte du joueur, en jeu.
app.post('/api/portal/ping', portal({ max: 30, timeWindow: '5 minutes' }), async (req) => {
  const x = Number(req.body?.x);
  const z = Number(req.body?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) fail(400, 'Point invalide');
  const y = (await world.groundAt(x, z)) ?? 30;
  await world.rconText(`ping ${Math.round(x)} ${Math.round(y)} ${Math.round(z)}`);
  return { ok: true };
});

// Plan schématique de la cité (murs, portes, lieux), pour la carte du téléphone.
app.get('/api/portal/map', portal(), async () => world.portalMap() || fail(503, 'La ville n’est pas encore générée.'));

app.get('/api/portal/npcs', portal(), async (req) => ({ npcs: world.portalNpcs(req.portal) }));

app.get('/api/portal/npcs/:key', portal(), async (req) => {
  const npc = world.portalNpc(req.portal, String(req.params.key));
  if (!npc) fail(404, 'Habitant inconnu');
  return npc;
});

app.post('/api/portal/npcs/:key/talk', portal({ max: 20, timeWindow: '1 minute' }), async (req) => {
  const text = String(req.body?.text || '').replace(/[<>]/g, '').slice(0, 300).trim();
  if (!text) fail(400, 'Message vide');
  const result = await world.portalTalk(req.portal, String(req.params.key), text);
  if (!result) fail(404, 'Habitant inconnu');
  return result;
});

// La Couronne vue du portail : tout le monde la lit, seuls l'Empereur et ses officiers agissent.
app.get('/api/portal/crown', portal(), async (req) => world.crownState(req.portal));

app.post('/api/portal/crown/decree', portal({ max: 20, timeWindow: '5 minutes' }), async (req) => {
  const b = req.body || {};
  const player = world.data.players[req.portal];
  const result = await world.issueDecree(String(b.id || ''), { by: player?.name, account: req.portal, rate: Number(b.rate) });
  if (result.error) fail(403, result.error);
  return world.crownState(req.portal);
});

app.post('/api/portal/crown/proclaim', portal({ max: 10, timeWindow: '5 minutes' }), async (req) => {
  if (world.crown.emperor !== req.portal) fail(403, 'Seul l’Empereur proclame.');
  const message = String(req.body?.text || '').replace(/[<>]/g, '').slice(0, 200).trim();
  if (!message) fail(400, 'Message vide');
  await world.proclaim(message, world.data.players[req.portal]?.name);
  return world.crownState(req.portal);
});

app.post('/api/portal/crown/pardon', portal({ max: 20, timeWindow: '5 minutes' }), async (req) => {
  const crown = world.crown;
  const office = world.crownState(req.portal).you?.office;
  if (crown.emperor !== req.portal && office?.id !== 'juge') fail(403, 'Seuls l’Empereur et le juge graçient.');
  const player = world.data.players[String(req.body?.account || '')];
  if (!player) fail(404, 'Sujet inconnu');
  await world.justice.pardon(player, world.data.players[req.portal]?.name);
  return world.crownState(req.portal);
});

app.post('/api/portal/crown/honour', portal({ max: 20, timeWindow: '5 minutes' }), async (req) => {
  if (world.crown.emperor !== req.portal) fail(403, 'Seul l’Empereur accorde les titres.');
  const b = req.body || {};
  const result = await world.grantHonour(String(b.account || ''), String(b.honour || ''), world.data.players[req.portal]?.name);
  if (result.error) fail(400, result.error);
  return world.crownState(req.portal);
});

app.post('/api/portal/crown/office', portal({ max: 20, timeWindow: '5 minutes' }), async (req) => {
  if (world.crown.emperor !== req.portal) fail(403, 'Seul l’Empereur nomme aux charges.');
  const b = req.body || {};
  const result = await world.appointOffice(String(b.office || ''), b.account ? String(b.account) : null, world.data.players[req.portal]?.name);
  if (result.error) fail(400, result.error);
  return world.crownState(req.portal);
});

app.post('/api/portal/crown/petition/:id', portal({ max: 30, timeWindow: '5 minutes' }), async (req) => {
  const b = req.body || {};
  const result = await world.answerPetition(String(req.params.id), { accept: !!b.accept, answer: b.answer, coins: Number(b.coins) || 0, by: world.data.players[req.portal]?.name, account: req.portal });
  if (result.error) fail(400, result.error);
  return world.crownState(req.portal);
});

// Liste des sujets, pour choisir qui adouber ou nommer.
app.get('/api/portal/subjects', portal(), async (req) => {
  if (world.crown.emperor !== req.portal) fail(403, 'Réservé à l’Empereur.');
  return { subjects: world.playerList().map((p) => ({ account: p.account, name: p.name, renown: p.renown, title: p.title })) };
});

// Une maison dans les murs, pour les Élus que la cité reconnaît.
app.post('/api/portal/house', portal({ max: 10, timeWindow: '5 minutes' }), async (req) => {
  const player = world.data.players[req.portal];
  if (!player) fail(404, 'Personnage introuvable');
  const result = await world.claimHouse(player, world.peerOf(req.portal));
  if (result?.error) fail(400, result.error);
  return { house: { x: result.x, z: result.z, since: result.since }, already: !!result.already, hero: world.portalHero(req.portal) };
});

// Voix de l'habitant : synthétisée à la demande, puis gardée en cache.
app.get('/api/portal/audio/:hash', portal({ max: 150, timeWindow: '1 minute' }), async (req, reply) => {
  const audio = await world.voice.audio(String(req.params.hash));
  if (!audio) fail(404, 'Voix indisponible');
  return reply.header('cache-control', 'private, max-age=86400').type(audio.type).send(audio.data);
});

// Dictée : le joueur parle, le serveur transcrit (si la transcription est installée).
app.post('/api/portal/listen', { ...portal({ max: 40, timeWindow: '5 minutes' }), bodyLimit: 4 * 1024 * 1024 }, async (req) => {
  await world.voice.health();
  if (!world.voice.info?.stt) fail(503, "La dictée n'est pas installée sur ce serveur.");
  if (!Buffer.isBuffer(req.body) || !req.body.length) fail(400, 'Enregistrement vide');
  const text = await world.voice.listen(req.body, world.lang);
  return { text: text || '' };
});

// ---------- Arène ----------

app.get('/api/arena', perm('world.view'), async () => ({ state: await arena.state() }));

app.post('/api/arena/build', perm('world.edit'), async (req) => {
  const { player, x, z, exact } = req.body || {};
  const params = player ? { player: String(player) } : { x: Number(x), z: Number(z), exact: exact ? 1 : 0 };
  if (!player && (!Number.isFinite(params.x) || !Number.isFinite(params.z))) fail(400, 'Choisis un joueur ou un point de la carte');
  const result = await arena.command('build', params, { timeout: 60000 });
  req.audit = `Arène construite : ${result.message}`;
  return result;
});

app.post('/api/arena/demolish', perm('world.edit'), async (req) => {
  const result = await arena.command('demolish', {}, { timeout: 60000 });
  req.audit = 'Arène démolie';
  return result;
});

app.post('/api/arena/start', perm('world.edit'), async (req) => {
  const { player, tier } = req.body || {};
  const result = await arena.command('start', { player: player ? String(player) : '', tier: tier ? int(tier, 'Palier', 1, 8) : '' });
  req.audit = `Combat d'arène lancé${player ? ` pour ${player}` : ''}${tier ? ` (palier ${tier})` : ''}`;
  return result;
});

app.post('/api/arena/stop', perm('world.edit'), async (req) => {
  const result = await arena.command('stop');
  req.audit = "Combat d'arène arrêté";
  return result;
});

app.put('/api/arena/settings', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const params = {
    forceTier: b.forceTier === undefined ? '' : int(b.forceTier, 'Palier', 0, 8),
    waves: b.waves === undefined ? '' : int(b.waves, 'Vagues', 3, 30),
    rewardMultiplier: b.rewardMultiplier === undefined ? '' : Math.min(5, Math.max(0.25, Number(b.rewardMultiplier) || 1)),
    cooldown: b.cooldown === undefined ? '' : int(b.cooldown, 'Repos', 0, 3600),
    language: b.language === 'en' || b.language === 'fr' ? b.language : '',
  };
  const result = await arena.command('settings', params);
  req.audit = "Réglages de l'arène modifiés";
  return result;
});

app.delete('/api/arena/records', perm('world.edit'), async (req) => {
  const result = await arena.command('clear-records');
  req.audit = "Classement de l'arène effacé";
  return result;
});

// ---------- Ville ----------

app.get('/api/city', perm('world.view'), async () => city.status());

app.get('/api/city/preview', perm('world.view'), async () => city.preview());

app.post('/api/city/survey', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const result = await city.survey({ player: b.player ? String(b.player) : '', x: b.x, z: b.z, size: String(b.size || ''), search: !!b.search, anchor: !!b.anchor });
  req.audit = `Ville : relevé du terrain (${result.message})`;
  return result;
});

app.post('/api/city/generate', perm('world.edit'), async (req) => {
  const summary = await city.generate(req.body || {});
  req.audit = `Ville : plan « ${summary.options.name} » généré (${summary.pieces} pièces)`;
  return summary;
});

app.post('/api/city/build', perm('world.edit'), async (req) => {
  const result = await city.build({ force: !!req.body?.force });
  req.audit = `Ville : construction lancée (${result.message})`;
  return result;
});

app.post('/api/city/demolish', perm('world.edit'), async (req) => {
  const result = await arena.command('city-demolish', {}, { timeout: 60000 });
  req.audit = `Ville démolie (${result.message})`;
  return result;
});

app.post('/api/city/repair', perm('world.edit'), async (req) => {
  const result = await arena.command('city-repair', {}, { timeout: 30000 });
  req.audit = `Ville réparée (${result.message})`;
  return result;
});

app.post('/api/city/teleport', perm('world.edit'), async (req) => {
  const player = req.body?.player ? String(req.body.player) : '';
  const result = await arena.command('city-teleport', { player });
  req.audit = `Téléportation dans la ville : ${player || 'tous les joueurs'}`;
  return result;
});

app.put('/api/city/settings', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const params = {
    welcome: b.welcome === undefined ? '' : int(b.welcome, 'Accueil', 0, 2),
    autoRepair: b.autoRepair === undefined ? '' : int(b.autoRepair, 'Réparation', 0, 1440),
    spawn: b.spawn === undefined ? '' : b.spawn ? 1 : 0,
    crier: b.crier === undefined ? '' : b.crier ? 1 : 0,
    protect: b.protect === undefined ? '' : b.protect ? 1 : 0,
  };
  const result = await arena.command('city-settings', params);
  req.audit = 'Réglages de la ville modifiés';
  return result;
});

const cityText = (value, label, max = 60) => {
  const s = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (s.length > max) fail(400, `${label} : ${max} caractères au plus`);
  return s;
};

app.post('/api/city/parcel', perm('world.edit'), async (req) => {
  const b = req.body || {};
  const owner = cityText(b.owner, 'Propriétaire', 40);
  const result = await arena.command('city-parcel', { parcel: int(b.id, 'Parcelle', 1, 999), owner: owner || ' ' });
  req.audit = `Ville : ${result.message}`;
  return result;
});

app.put('/api/city/board', perm('world.edit'), async (req) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const params = {};
  for (let i = 0; i < 4; i++) params[`line${i + 1}`] = cityText(lines[i], `Ligne ${i + 1}`) || ' ';
  const result = await arena.command('city-board', params);
  req.audit = 'Ville : tableau des contrats mis à jour';
  return result;
});

app.post('/api/city/proclaim', perm('world.edit'), async (req) => {
  const text = cityText(req.body?.text, 'Proclamation');
  const result = await arena.command('city-proclaim', { text: text || ' ', announce: req.body?.announce === false ? 0 : 1 });
  req.audit = `Ville : proclamation « ${text} »`;
  return result;
});

app.put('/api/city/portal', perm('world.edit'), async (req) => {
  const tag = cityText(req.body?.tag, 'Nom du portail', 40);
  if (!tag) fail(400, 'Nom du portail requis');
  const result = await arena.command('city-portal', { index: int(req.body?.index, 'Portail', 0, 100000), tag });
  req.audit = `Ville : ${result.message}`;
  return result;
});

app.put('/api/city/architects', perm('world.edit'), async (req) => {
  const names = (Array.isArray(req.body?.names) ? req.body.names : []).map((n) => cityText(n, 'Nom', 40).replace(/,/g, ' ')).filter(Boolean);
  const result = await arena.command('city-architects', { names: names.join(',') || ' ' });
  req.audit = `Ville : architectes ${names.join(', ') || 'aucun'}`;
  return result;
});

// ---------- Mods : réglages BepInEx ----------

app.get('/api/modconfig', perm('config.edit'), async () => ({ files: await modConfig.list() }));

app.get('/api/modconfig/:file', perm('config.edit'), async (req) => modConfig.read(req.params.file));

app.put('/api/modconfig/:file', perm('config.edit'), async (req) => {
  const result = await modConfig.write(req.params.file, req.body?.changes);
  req.audit = `Réglages de mod modifiés : ${req.params.file} (${result.changed} valeur(s))${req.body?.restart ? ', avec redémarrage' : ''}`;
  if (req.body?.restart) await controlGame('restart');
  return result;
});

// ---------- Carte en direct ----------

// Les comptes sans « map.spoilers » ne reçoivent que les zones explorées ; un admin peut aussi voir la carte « comme un joueur ».
const spoilers = (req) => UserStore.can(req.user, 'map.spoilers') && req.query.view !== 'explored';

app.get('/api/map/status', perm('map.view'), async (req) => ({ status: await map.status(), spoilers: UserStore.can(req.user, 'map.spoilers') }));

app.get('/api/map/image', perm('map.view'), async (req, reply) => {
  const png = await map.image({ spoilers: spoilers(req) });
  reply.header('Cache-Control', 'private, max-age=30').type('image/png');
  return png;
});

app.get('/api/map/live', perm('map.view'), async (req) => (await map.live({ spoilers: spoilers(req) })) ?? fail(404, 'Données en direct indisponibles : le plugin de carte est-il chargé ?'));

app.get('/api/map/world', perm('map.view'), async (req) => (await map.world({ spoilers: spoilers(req) })) ?? fail(404, 'Données du monde indisponibles : le plugin de carte est-il chargé ?'));

// ---------- Console ----------

app.post('/api/console', perm('console'), async (req) => {
  const cmd = String(req.body?.command ?? '').trim();
  if (!cmd || cmd.length > 1000) fail(400, 'Commande vide');
  try {
    return { output: await rcon.exec(cmd) };
  } catch (err) {
    if (err instanceof RconError) fail(503, `Serveur de jeu injoignable (${err.message})`);
    throw err;
  }
});

// ---------- Mondes & sauvegardes ----------

app.get('/api/worlds', perm('worlds.manage'), async () => {
  const env = await readEnv(GAME_ENV);
  return { active: env.WORLD_NAME, running: await isRunning(), worlds: await worlds.list(), archives: await worlds.archives() };
});

app.post('/api/worlds/activate', perm('worlds.manage'), async (req) => {
  const name = worlds.checkName(req.body?.name);
  await updateEnv(GAME_ENV, { WORLD_NAME: name });
  if (req.body?.restart) await controlGame('restart');
  return { ok: true };
});

app.delete('/api/worlds/:name', perm('worlds.manage'), async (req) => {
  const name = worlds.checkName(req.params.name);
  const env = await readEnv(GAME_ENV);
  if (name === env.WORLD_NAME) fail(409, 'Impossible de supprimer le monde actif : active un autre monde avant.');
  return { archive: await worlds.removeWorld(name) };
});

app.get('/api/worlds/:name/download', perm('worlds.manage'), async (req, reply) => {
  const name = worlds.checkName(req.params.name);
  const stream = await worlds.zipWorld(name);
  reply.header('Content-Type', 'application/zip').header('Content-Disposition', `attachment; filename="${name}.zip"`);
  return reply.send(stream);
});

app.post('/api/worlds/:name/restore', perm('worlds.manage'), async (req) => {
  const name = worlds.checkName(req.params.name);
  const env = await readEnv(GAME_ENV);
  if (name === env.WORLD_NAME && (await isRunning())) fail(409, 'Arrête le serveur avant de restaurer le monde actif.');
  return { safety: await worlds.restoreAutoBackup(name, req.body?.tag) };
});

app.post('/api/worlds/import', perm('worlds.manage'), async (req) => {
  const env = await readEnv(GAME_ENV);
  const running = await isRunning();
  const part = await req.file();
  if (!part) fail(400, 'Aucun fichier reçu');
  const upload = await worlds.receiveUpload(part);
  try {
    const result = await worlds.importWorld(upload, { activeName: env.WORLD_NAME, running });
    req.audit = `Monde importé : ${result.name}`;
    return result;
  } finally {
    await worlds.cleanup([upload]);
  }
});

app.post('/api/archives', perm('worlds.manage'), async () => {
  if (await isRunning()) {
    try {
      await rcon.exec('save');
      await sleep(3000);
    } catch {}
  }
  return { file: await worlds.createArchive('manuel') };
});

app.get('/api/archives/:file/download', perm('worlds.manage'), async (req, reply) => {
  const p = await worlds.archivePath(req.params.file);
  reply.header('Content-Type', 'application/gzip').header('Content-Disposition', `attachment; filename="${path.basename(p)}"`);
  return reply.send(worlds.streamArchive(p));
});

app.post('/api/archives/:file/restore', perm('worlds.manage'), async (req) => {
  if (await isRunning()) fail(409, 'Arrête le serveur avant de restaurer une archive.');
  return { safety: await worlds.restoreArchive(req.params.file) };
});

app.delete('/api/archives/:file', perm('worlds.manage'), async (req) => {
  await worlds.deleteArchive(req.params.file);
  return { ok: true };
});

// ---------- Journaux ----------

app.get('/api/logs', perm('logs.view'), async () => ({ lines: (await sys.readJournal()).slice(-1500) }));

app.get('/api/logs/stream', perm('logs.view'), (req, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write(': ok\n\n');
  const send = (line) => reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
  logClients.add(send);
  const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20000);
  req.raw.on('close', () => {
    clearInterval(ping);
    logClients.delete(send);
  });
});

// ---------- Démarrage ----------

async function startJournal() {
  try {
    for (const line of await sys.readJournal()) P.ingestJournalLine(live, line);
  } catch (err) {
    app.log.error(`Lecture du journal impossible : ${err.message}`);
  }
  const follow = () =>
    sys.followJournal(
      (line) => {
        const before = live.history[0];
        P.ingestJournalLine(live, line);
        // Le monde vivant apprend les morts et les arrivées par le journal du serveur.
        const latest = live.history[0];
        if (latest && latest !== before) world.onJournal(latest).catch(() => {});
        for (const send of logClients) send(line);
      },
      () => setTimeout(follow, 5000),
    );
  follow();
}

// Tâches quotidiennes (mode Docker ; sur un VPS systemd, des timers s'en chargent).
function startDailyTasks() {
  if (runtime.BACKUP_HOUR < 0 && runtime.RESTART_HOUR < 0) return;
  const done = { backup: null, restart: null };
  const tick = async () => {
    const now = new Date();
    const day = now.toDateString();
    if (now.getHours() === runtime.BACKUP_HOUR && done.backup !== day) {
      done.backup = day;
      try {
        if (await isRunning()) {
          await rcon.exec('save').catch(() => {});
          await sleep(3000);
        }
        const file = await worlds.createArchive('worlds');
        await worlds.pruneArchives('worlds-', 14);
        audit.add({ user: 'system', ip: '-', action: `Archive quotidienne : ${file}` });
      } catch (err) {
        app.log.error(`Archive quotidienne en échec : ${err.message}`);
      }
    }
    if (now.getHours() === runtime.RESTART_HOUR && done.restart !== day) {
      done.restart = day;
      try {
        if (!(await isRunning())) return;
        const { online } = P.parsePlayers(await rcon.exec('players'));
        if (online > 0) {
          audit.add({ user: 'system', ip: '-', action: `Redémarrage quotidien reporté : ${online} joueur(s) connecté(s)` });
          return;
        }
        await controlGame('restart');
        audit.add({ user: 'system', ip: '-', action: 'Redémarrage quotidien (mises à jour)' });
      } catch (err) {
        app.log.error(`Redémarrage quotidien en échec : ${err.message}`);
      }
    }
  };
  setInterval(tick, 60 * 1000).unref();
}

app.get('/healthz', { logLevel: 'warn' }, async () => ({ ok: true }));

startDailyTasks();
await app.listen({ host: runtime.HOST, port: Number(runtime.PORT || panelEnv.PANEL_PORT || 4030) });
startJournal();
