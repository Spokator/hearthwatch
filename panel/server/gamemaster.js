// Outils « maître du jeu » : cadeaux, chasses au trésor, boss surprise, redémarrage annoncé.
// Tout passe par ValheimRcon : rien à installer chez les joueurs.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { fail } from './errors.js';
import { LANGUAGE } from './runtime.js';

export const LOOT_PRESETS = {
  prairies: { label: 'Prairies (débutant)', items: [['Coins', 100], ['ArrowFlint', 40], ['CookedMeat', 10], ['Honey', 10], ['Amber', 2]] },
  bronze: { label: 'Âge du bronze', items: [['Coins', 250], ['Bronze', 20], ['ArrowBronze', 50], ['MeadHealthMinor', 5], ['AmberPearl', 3]] },
  fer: { label: 'Âge du fer', items: [['Coins', 500], ['Iron', 20], ['ArrowIron', 50], ['MeadHealthMedium', 5], ['Ruby', 3]] },
  argent: { label: 'Âge de l’argent', items: [['Coins', 800], ['Silver', 20], ['ArrowObsidian', 50], ['MeadStaminaMedium', 5], ['SilverNecklace', 2]] },
  richesses: { label: 'Pure richesse', items: [['Coins', 999], ['Coins', 999], ['Ruby', 5], ['AmberPearl', 5], ['SilverNecklace', 3]] },
};

export const BOSSES = {
  Eikthyr: 'Eikthyr',
  gd_king: 'L’Ancien',
  Bonemass: 'Bonemass',
  Dragon: 'Moder',
  GoblinKing: 'Yagluth',
  SeekerQueen: 'La Reine',
  Fader: 'Fader',
  Troll: 'Troll',
  StoneGolem: 'Golem de pierre',
  Abomination: 'Abomination',
  FallenValkyrie: 'Valkyrie déchue',
  Morgen: 'Morgen',
  Lox: 'Lox',
};

// Textes affichés dans le jeu, dans la langue du serveur (HW_LANGUAGE).
const GAME_TEXT_EN = {
  'Les dieux vous envoient un cadeau !': 'The gods send you a gift!',
  'Un trésor a été caché quelque part...': 'A treasure has been hidden somewhere...',
  'Le trésor est marqué sur votre carte !': 'The treasure is marked on your map!',
  'Le trésor se trouve à environ {distance} m {direction} de {name}.': 'The treasure lies about {distance} m {direction} of {name}.',
  '{label} arrive dans {n} secondes !': '{label} arrives in {n} seconds!',
  '{label} arrive dans 5 secondes...': '{label} arrives in 5 seconds...',
  '{label} surgit !': '{label} appears!',
  '{label} est là !': '{label} is here!',
  'Redémarrage du serveur dans {n} minutes{reason}': 'Server restart in {n} minutes{reason}',
  'Redémarrage du serveur dans 1 minute{reason}': 'Server restart in 1 minute{reason}',
  'Redémarrage du serveur dans 5 minutes': 'Server restart in 5 minutes',
  'Redémarrage du serveur dans 1 minute, mettez-vous à l’abri !': 'Server restart in 1 minute, get to safety!',
  'Redémarrage dans 30 secondes': 'Restart in 30 seconds',
  'Redémarrage dans 10 secondes...': 'Restart in 10 seconds...',
  'Redémarrage annulé': 'Restart cancelled',
  'à l’est': 'east',
  'au nord-est': 'north-east',
  'au nord': 'north',
  'au nord-ouest': 'north-west',
  'à l’ouest': 'west',
  'au sud-ouest': 'south-west',
  'au sud': 'south',
  'au sud-est': 'south-east',
  'L’Ancien': 'The Elder',
  'La Reine': 'The Queen',
  'Golem de pierre': 'Stone golem',
  'Valkyrie déchue': 'Fallen valkyrie',
};

function gameText(text, vars = {}) {
  const template = LANGUAGE === 'fr' ? text : (GAME_TEXT_EN[text] ?? text);
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));
}

const CHEST = 'piece_chest_wood';
const WATER_LEVEL = 30;
const DIRECTIONS = ['à l’est', 'au nord-est', 'au nord', 'au nord-ouest', 'à l’ouest', 'au sud-ouest', 'au sud', 'au sud-est'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GameMaster {
  // helpers : { command, arg, int, prefabName, onlinePlayers, groundHeight, controlGame, log }
  constructor(file, helpers) {
    this.file = file;
    this.h = helpers;
    this.state = { hunts: [] };
    this.restart = null;
    this.bosses = [];
  }

  async load() {
    try {
      this.state = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {}
    this.state.hunts ||= [];
  }

  async #save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  // [{ item, count, quality }] ou un préréglage.
  #items(body) {
    const preset = LOOT_PRESETS[body?.preset];
    const raw = preset ? preset.items.map(([item, count]) => ({ item, count, quality: 1 })) : body?.items;
    if (!Array.isArray(raw) || !raw.length || raw.length > 12) fail(400, 'Choisis entre 1 et 12 objets');
    return raw.map((it) => ({
      item: this.h.prefabName(it.item),
      count: this.h.int(it.count ?? 1, 'Quantité', 1, 9999),
      quality: this.h.int(it.quality ?? 1, 'Qualité', 1, 4),
    }));
  }

  async #player(id) {
    const players = await this.h.onlinePlayers();
    const p = players.find((x) => x.id === id || x.name === id);
    if (!p) fail(404, 'Joueur introuvable (déconnecté ?)');
    return p;
  }

  async #say(text) {
    await this.h.command(`say ${String(text).replace(/["\r\n]+/g, ' ').slice(0, 250)}`);
  }

  async #screen(text) {
    await this.h.command(`showMessage ${String(text).replace(/["\r\n]+/g, ' ').slice(0, 120)}`);
  }

  // ---------- Cadeau à tous ----------

  async giftAll(body) {
    const items = this.#items(body);
    const players = await this.h.onlinePlayers();
    if (!players.length) fail(409, 'Aucun joueur connecté');
    for (const p of players) {
      for (const it of items) await this.h.command(`give ${this.h.arg(p.id)} ${it.item} -count ${it.count} -quality ${it.quality}`);
    }
    await this.#screen(body?.message || gameText('Les dieux vous envoient un cadeau !'));
    return { players: players.length, items };
  }

  // ---------- Chasse au trésor ----------

  async #findSpot(origin, min, max) {
    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = min + Math.random() * (max - min);
      const x = origin.x + Math.cos(angle) * distance;
      const z = origin.z + Math.sin(angle) * distance;
      if (Math.hypot(x, z) > 10000) continue;
      const ground = await this.h.groundHeight(x, z);
      if (ground != null && ground > WATER_LEVEL + 1 && ground < 250) return { x, z, y: ground };
    }
    fail(400, 'Aucun emplacement sur la terre ferme trouvé : réduis la distance ou choisis un autre joueur.');
  }

  async startTreasure(body, actor) {
    const items = this.#items(body);
    const min = this.h.int(body?.minDistance ?? 150, 'Distance minimale', 20, 3000);
    const max = this.h.int(body?.maxDistance ?? 400, 'Distance maximale', min, 5000);
    const hint = ['ping', 'direction', 'none'].includes(body?.hint) ? body.hint : 'direction';
    const origin = await this.#player(body?.player);
    const [ox, oy, oz] = origin.position;
    const spot = await this.#findSpot({ x: ox, z: oz }, min, max);
    const x = Math.round(spot.x);
    const z = Math.round(spot.z);
    const y = Math.round((spot.y + 0.3) * 10) / 10;
    const id = crypto.randomBytes(4).toString('hex');

    const out = await this.h.command(`spawn ${CHEST} ${x} ${y} ${z} -tag tresor_${id}`);
    const chestId = out.match(/Id: (\d+:-?\d+)/)?.[1];
    if (!chestId) fail(500, `Le coffre n'a pas pu être créé : ${out.slice(0, 200)}`);
    await sleep(300);
    for (const it of items) await this.h.command(`addItemToContainer ${chestId} ${it.item} -count ${it.count} -quality ${it.quality} -force`);

    const distance = Math.round(Math.hypot(x - ox, z - oz) / 25) * 25;
    const direction = DIRECTIONS[(Math.round(Math.atan2(z - oz, x - ox) / (Math.PI / 4)) + 8) % 8];
    await this.#screen(gameText('Un trésor a été caché quelque part...'));
    if (hint === 'ping') {
      await this.h.command(`ping ${x} ${y} ${z}`);
      await this.#say(body?.message || gameText('Le trésor est marqué sur votre carte !'));
    } else if (hint === 'direction') {
      await this.#say(body?.message || gameText('Le trésor se trouve à environ {distance} m {direction} de {name}.', { distance, direction: gameText(direction), name: origin.name }));
    } else if (body?.message) {
      await this.#say(body.message);
    }

    const hunt = {
      id,
      chestId,
      x,
      y: Math.round(oy),
      z,
      items,
      hint,
      origin: origin.name,
      distance,
      direction,
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: actor,
    };
    this.state.hunts.unshift(hunt);
    this.state.hunts = this.state.hunts.slice(0, 50);
    await this.#save();
    return hunt;
  }

  // Met à jour l'état des chasses en cours (coffre vidé = trésor trouvé).
  async hunts({ refresh }) {
    if (refresh) {
      let changed = false;
      for (const hunt of this.state.hunts.filter((h) => h.status === 'active')) {
        try {
          const out = await this.h.command(`showContainer ${hunt.chestId}`);
          if (!/^Container is empty/.test(out)) continue;
          Object.assign(hunt, { status: 'found', endedAt: new Date().toISOString() });
          changed = true;
        } catch (err) {
          if (/No object found/.test(err.message)) {
            Object.assign(hunt, { status: 'gone', endedAt: new Date().toISOString() });
            changed = true;
          }
        }
      }
      if (changed) await this.#save();
    }
    return this.state.hunts;
  }

  async cancelTreasure(id) {
    const hunt = this.state.hunts.find((h) => h.id === id) || fail(404, 'Chasse introuvable');
    if (hunt.status !== 'active') fail(409, 'Cette chasse est déjà terminée');
    try {
      await this.h.command(`deleteObjects -id ${hunt.chestId} -force`);
    } catch {}
    Object.assign(hunt, { status: 'cancelled', endedAt: new Date().toISOString() });
    await this.#save();
    return hunt;
  }

  // ---------- Boss surprise ----------

  async bossSurprise(body) {
    const prefab = String(body?.boss ?? '');
    const label = BOSSES[prefab] || fail(400, 'Boss inconnu');
    const gameLabel = gameText(label);
    const countdown = this.h.int(body?.countdown ?? 10, 'Compte à rebours', 0, 120);
    const stars = this.h.int(body?.stars ?? 0, 'Étoiles', 0, 2);
    const count = this.h.int(body?.count ?? 1, 'Nombre', 1, 3);
    const target = await this.#player(body?.player);
    const spawnAt = Date.now() + countdown * 1000;

    const entry = { id: crypto.randomBytes(4).toString('hex'), prefab, label, player: target.name, spawnAt: new Date(spawnAt).toISOString(), timers: [] };
    const run = async () => {
      try {
        const p = await this.#player(target.id).catch(() => target);
        const [x, y, z] = p.position;
        await this.h.command(`spawn ${prefab} ${Math.round(x + 15)} ${Math.round(y + 2)} ${Math.round(z + 15)} -count ${count} -level ${stars + 1} -radius 6`);
        await this.#screen(gameText('{label} est là !', { label: gameLabel }));
      } catch (err) {
        this.h.log(`Boss surprise en échec : ${err.message}`);
      } finally {
        this.bosses = this.bosses.filter((b) => b.id !== entry.id);
      }
    };

    await this.#screen(countdown ? gameText('{label} arrive dans {n} secondes !', { label: gameLabel, n: countdown }) : gameText('{label} surgit !', { label: gameLabel }));
    if (countdown > 5) {
      entry.timers.push(setTimeout(() => this.#screen(gameText('{label} arrive dans 5 secondes...', { label: gameLabel })).catch(() => {}), (countdown - 5) * 1000));
    }
    entry.timers.push(setTimeout(run, countdown * 1000));
    this.bosses.push(entry);
    return { label, player: target.name, spawnAt: entry.spawnAt };
  }

  // ---------- Redémarrage annoncé ----------

  scheduleRestart(body) {
    if (this.restart) fail(409, 'Un redémarrage est déjà programmé');
    const minutes = this.h.int(body?.minutes ?? 5, 'Délai', 1, 60);
    const at = Date.now() + minutes * 60000;
    const timers = [];
    const warn = (secondsLeft, text) => {
      const delay = at - secondsLeft * 1000 - Date.now();
      if (delay >= 0) timers.push(setTimeout(() => this.#screen(text).catch(() => {}), delay));
    };
    const reason = body?.reason ? ` (${String(body.reason).slice(0, 60)})` : '';
    warn(minutes * 60, gameText(minutes > 1 ? 'Redémarrage du serveur dans {n} minutes{reason}' : 'Redémarrage du serveur dans 1 minute{reason}', { n: minutes, reason }));
    if (minutes > 5) warn(300, gameText('Redémarrage du serveur dans 5 minutes'));
    if (minutes > 1) warn(60, gameText('Redémarrage du serveur dans 1 minute, mettez-vous à l’abri !'));
    warn(30, gameText('Redémarrage dans 30 secondes'));
    warn(10, gameText('Redémarrage dans 10 secondes...'));
    timers.push(
      setTimeout(async () => {
        this.restart = null;
        try {
          await this.h.controlGame('restart');
        } catch (err) {
          this.h.log(`Redémarrage programmé en échec : ${err.message}`);
        }
      }, at - Date.now()),
    );
    this.restart = { at: new Date(at).toISOString(), reason: body?.reason || null, timers };
    return { at: this.restart.at };
  }

  async cancelRestart() {
    if (!this.restart) fail(404, 'Aucun redémarrage programmé');
    this.restart.timers.forEach(clearTimeout);
    this.restart = null;
    await this.#screen(gameText('Redémarrage annulé')).catch(() => {});
    return { ok: true };
  }

  schedule() {
    return {
      restart: this.restart ? { at: this.restart.at, reason: this.restart.reason } : null,
      bosses: this.bosses.map(({ timers, ...b }) => b),
    };
  }
}
