// Moteur du monde vivant : relie le corps (plugin), la psyché des habitants, l'économie, les quêtes et l'IA.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AiService, DEFAULT_AI } from './ai.js';
import { Bridge } from './bridge.js';
import { addressee, contextPrompt, fallbackLine, greetingKind, intentsOf, systemPrompt, thinkingLine } from './dialogue.js';
import { BASE_PRICES, buyPrice, economyDay, newEconomy, sellPrice, shortages, SHOPS } from './economy.js';
import { BOSS_KEYS, FACTIONS, titleFor, worldTier } from './lore.js';
import { adjustAffinity, appraise, emotionKey, gossip, learnFact, mood, newMind, relationWith, remember, tickMind, valence } from './mind.js';
import { COUNTERS, dailyOffers, nextChapter, objectivesOf, SAGA, sagaChapter, targetMatches } from './quests.js';
import { ABSENT, ROSTER } from './roster.js';
import { calendar, slotFor } from './schedule.js';
import { JsonLog, JsonStore } from './store.js';
import { bubbles, clamp, clockOf, fold, pick, rng, sleep, stableHash } from './util.js';

const BUBBLE_GAP = 3800;
const MAX_ACTIVE_QUESTS = 5;

export const DEFAULT_SETTINGS = {
  enabled: true,
  language: 'fr',
  respawnSeconds: 240,
  barks: true,
  crier: true,
  bard: true,
  sermon: true,
  chatter: true,
  ai: DEFAULT_AI,
};

export class WorldEngine {
  constructor({ panelDir, dataDir, arena }) {
    this.panelDir = panelDir;
    this.arena = arena;
    this.bridge = new Bridge(panelDir);
    this.store = new JsonStore(path.join(dataDir, 'world.json'), {
      version: 1,
      settings: DEFAULT_SETTINGS,
      npcs: {},
      players: {},
      offers: {},
      economy: newEconomy(),
      flags: {},
      news: [],
      day: null,
      seconds: null,
      overrides: {},
      counters: {},
      arenaRecords: [],
    });
    this.conversationLog = new JsonLog(path.join(dataDir, 'conversations.jsonl'));
    this.chronicleLog = new JsonLog(path.join(dataDir, 'chronicle.jsonl'));
    this.ai = new AiService();
    this.npcs = new Map(); // clé → habitant (fiche + état)
    this.byId = new Map(); // identifiant numérique → clé
    this.spots = [];
    this.conversations = new Map(); // compte joueur → { npc, t, offersShownAt }
    this.cooldowns = new Map();
    this.talking = new Set();
    this.lastSync = 0;
    this.syncDirty = true;
    this.timer = null;
    this.random = rng(Date.now() & 0xffffffff);
    this.planMtime = 0;
    this.itemNames = new Map();
    this.speechQueue = Promise.resolve();
  }

  get data() {
    return this.store.data;
  }

  get settings() {
    return { ...DEFAULT_SETTINGS, ...this.data.settings, ai: { ...DEFAULT_AI, ...(this.data.settings?.ai || {}) } };
  }

  get lang() {
    return this.settings.language === 'en' ? 'en' : 'fr';
  }

  async start() {
    await this.store.load();
    this.data.settings = this.settings;
    this.ai.configure(this.settings.ai);
    this.loadRoster();
    await this.loadPlan();
    await this.loadItems();
    this.bridge.on('event', (event) => this.onEvent(event).catch((error) => console.error('[world] event', event.type, error)));
    this.bridge.start();
    this.timer = setInterval(() => this.tick().catch((error) => console.error('[world] tick', error)), 5000);
    console.log(`[world] ${this.npcs.size} habitants, ${this.spots.length} lieux`);
  }

  stop() {
    clearInterval(this.timer);
    this.bridge.stop();
    return this.store.flush();
  }

  // ---------- Habitants et lieux ----------

  loadRoster() {
    const defs = [...ROSTER, ...ABSENT];
    for (const def of defs) {
      const saved = this.data.npcs[def.key] || {};
      const override = this.data.overrides[def.key] || {};
      const npc = {
        ...def,
        ...override,
        id: stableHash(`npc:${def.key}`),
        mind: saved.mind || seedMind(def),
        memories: saved.memories || [],
        relations: saved.relations || {},
        stats: saved.stats || { talks: 0 },
        deadUntil: saved.deadUntil || 0,
        absent: ABSENT.some((a) => a.key === def.key) && !this.data.flags[`${def.key}_returned`],
        relations_def: (def.relations || []).map((r) => ({ ...r, name: defs.find((d) => d.key === r.key)?.name || r.key })),
        position: null,
        current: { activity: 'idle', place: null, target: null },
      };
      this.npcs.set(def.key, npc);
      this.byId.set(npc.id, def.key);
      this.data.npcs[def.key] = npc; // même objet : l'état vivant est enregistré tel quel
    }
    // Souvenirs de départ : ce que chacun sait de ses proches.
    for (const npc of this.npcs.values())
      if (!npc.memories.length)
        for (const r of npc.relations_def || []) remember(npc, `${r.name} : ${r.note}.`, { importance: 2, about: [r.key] });
  }

  async loadPlan() {
    const file = path.join(this.panelDir, 'city-plan.json');
    try {
      const stat = await fs.stat(file);
      if (stat.mtimeMs === this.planMtime) return;
      const plan = JSON.parse(await fs.readFile(file, 'utf8'));
      this.planMtime = stat.mtimeMs;
      this.spots = plan.spots || [];
      this.assignHomes();
      this.syncDirty = true;
    } catch {
      this.spots = [];
    }
  }

  async loadItems() {
    try {
      const data = JSON.parse(await fs.readFile(path.join(this.panelDir, 'items.json'), 'utf8'));
      for (const item of data.items || []) if (item.fr || item.en) this.itemNames.set(item.name, item);
      this.creatureNames = new Map((data.creatures || []).filter((c) => c.fr || c.en).map((c) => [c.name, c]));
    } catch {
      // le plugin n'a pas encore exporté les objets
    }
  }

  itemName(prefab, count = 1) {
    const item = this.itemNames.get(prefab);
    const name = item?.[this.lang] || item?.fr || prefab;
    return count > 1 ? `${count} × ${name}` : name;
  }

  creatureName(prefab) {
    const c = this.creatureNames?.get(prefab);
    return c?.[this.lang] || c?.fr || prefab;
  }

  assignHomes() {
    const homes = this.spots.filter((s) => s.kind === 'home');
    const groups = [...new Set([...this.npcs.values()].map((n) => n.home))].filter((h) => h !== 'castle' && h !== 'church-door');
    this.homeOf = new Map();
    groups.sort().forEach((group, i) => {
      if (homes.length) this.homeOf.set(group, homes[i % homes.length]);
    });
  }

  spotsOf(kind, place = null) {
    return this.spots.filter((s) => s.kind === kind && (place === null || s.place === place));
  }

  // Lieu concret (coordonnées) d'un habitant pour une activité donnée.
  resolvePlace(npc, place, allocated) {
    const h = Math.abs(npc.id);
    const take = (list) => {
      if (!list.length) return null;
      for (let i = 0; i < list.length; i++) {
        const spot = list[(h + i) % list.length];
        const key = `${spot.x},${spot.z}`;
        if (!allocated.has(key)) {
          allocated.add(key);
          return spot;
        }
      }
      return list[h % list.length];
    };
    const workSpot = () => {
      if (npc.placeKind === 'guard') return take(this.spotsOf('guard', npc.place));
      if (npc.placeKind === 'outskirts') return take(this.spotsOf('outskirts', npc.place));
      if (npc.place === 'garden') return take(this.spotsOf('garden')) || take(this.spotsOf('plaza'));
      if (npc.place === 'plaza') return take(this.spotsOf('plaza'));
      return this.spotsOf('work', npc.place)[0] || this.spotsOf('rest', npc.place)[0] || null;
    };
    let spot = null;
    switch (place) {
      case 'work':
        spot = workSpot();
        break;
      case 'home':
        if (npc.home === 'castle') spot = this.spotsOf('rest', 'castle-salon')[0];
        else if (npc.home === 'church-door') spot = this.spotsOf('work', 'church-door')[0];
        else spot = this.homeOf?.get(npc.home);
        break;
      case 'tavern':
        spot = take(this.spotsOf('seat', 'brasserie')) || this.spotsOf('work', 'brasserie-bar')[0];
        break;
      case 'church':
        spot = take(this.spotsOf('seat', 'church'));
        break;
      case 'plaza':
        spot = take(this.spotsOf('plaza'));
        break;
      case 'market':
        spot = this.spotsOf('work', 'market-food')[0] || take(this.spotsOf('plaza'));
        break;
      case 'castle-salon':
        spot = this.spotsOf('rest', 'castle-salon')[0];
        break;
      case 'garden':
        spot = take(this.spotsOf('garden')) || take(this.spotsOf('plaza'));
        break;
      case 'walls':
        spot = take(this.spotsOf('guard'));
        break;
      default:
        spot = null;
    }
    spot = spot || workSpot() || this.spotsOf('plaza')[0];
    if (!spot) return null;
    // Petit décalage propre à chacun pour ne pas s'empiler.
    const jitter = ((h % 7) - 3) * 0.25;
    return [spot.x + jitter, spot.y, spot.z + (((h >> 3) % 7) - 3) * 0.25];
  }

  hoverOf(npc) {
    const m = mood(npc, this.lang);
    return `${npc.name} — ${npc.title[this.lang]} (${m.label})`;
  }

  activeNpcs() {
    return [...this.npcs.values()].filter((n) => !n.absent);
  }

  async syncNpcs(force = false) {
    if (!this.bridge.online || !this.settings.enabled || !this.spots.length) return;
    if (!force && !this.syncDirty && Date.now() - this.lastSync < 30000) return;
    const npcs = this.activeNpcs()
      .filter((n) => n.current.target)
      .map((n) => ({ id: n.id, key: n.key, prefab: n.body, hover: this.hoverOf(n), target: n.current.target, respawn: this.settings.respawnSeconds }));
    await this.bridge.send('npc-sync', { npcs });
    this.lastSync = Date.now();
    this.syncDirty = false;
  }

  // ---------- Boucle ----------

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.step();
    } finally {
      this.ticking = false;
    }
  }

  async step() {
    await this.loadPlan();
    const state = this.bridge.state;
    if (!state?.game) return;
    const game = state.game;
    const clock = clockOf(game);
    const previous = this.data.seconds;
    const hours = previous === null ? 0 : clamp(((game.seconds - previous) / (game.dayLength || 1800)) * 24, 0, 3);
    this.data.seconds = game.seconds;
    if (this.data.day !== game.day) {
      const first = this.data.day === null;
      this.data.day = game.day;
      await this.newDay(state, first);
    }
    // Positions connues.
    for (const n of state.npcs || []) {
      const key = this.byId.get(n.id);
      if (key) this.npcs.get(key).position = { x: n.x, y: n.y, z: n.z };
    }
    // Routines et psyché.
    const allocated = new Set();
    for (const npc of this.activeNpcs()) {
      const slot = slotFor(npc, clock.fraction, game.day);
      const target = this.resolvePlace(npc, slot.place, allocated);
      const hoverBefore = this.hoverOf(npc);
      npc.mind.activity = slot.activity === 'sermon' || slot.activity === 'preach' ? 'pray' : slot.activity;
      if (hours > 0) tickMind(npc, hours);
      if (target && (!npc.current.target || Math.hypot(target[0] - npc.current.target[0], target[2] - npc.current.target[2]) > 1)) this.syncDirty = true;
      npc.current = { activity: slot.activity, place: slot.place, target };
      if (this.hoverOf(npc) !== hoverBefore) this.syncDirty = true;
    }
    await this.syncNpcs();
    // Joueurs : présence, exploration.
    for (const p of state.players || []) {
      const player = this.player(p);
      player.lastSeen = Date.now();
      player.position = { x: p.x, y: p.y, z: p.z, biome: p.biome };
      if (p.biome) await this.progress(player, { type: 'visit', biome: p.biome }, p.peer);
    }
    await this.checkArena();
    if (hours > 0) this.hourly(hours, clock);
    await this.ambient(state, clock);
    this.store.touch();
  }

  player(p) {
    const account = p.account || p.player;
    const players = this.data.players;
    if (!players[account]) {
      players[account] = { account, name: p.player, firstSeen: Date.now(), lastSeen: Date.now(), renown: 0, reputation: {}, quests: [], saga: { done: [], chapter: null, step: 0, progress: 0 }, stats: { kills: {}, delivered: 0, talks: 0, quests: 0 }, wanted: 0, bounty: 0 };
    }
    const player = players[account];
    if (p.player) player.name = p.player;
    if (p.peer) player.peer = p.peer;
    return player;
  }

  playerByPeer(peer) {
    return Object.values(this.data.players).find((p) => String(p.peer) === String(peer));
  }

  onlinePlayers() {
    return (this.bridge.state?.players || []).map((p) => ({ ...p, record: this.player(p) }));
  }

  async newDay(state, first) {
    const tier = worldTier(state.keys);
    if (!first) economyDay(this.data.economy);
    const day = state.game.day;
    // Contrats du jour.
    for (const npc of this.activeNpcs()) {
      if (!npc.contracts) continue;
      const shopKey = npc.shop;
      this.data.offers[npc.key] = dailyOffers(npc, {
        tier,
        day,
        random: rng(`${npc.key}-${day}`),
        shortages: shopKey ? shortages(this.data.economy, shopKey) : [],
        valid: (c) => (c.items || []).every(([item]) => this.itemNames.size === 0 || this.itemNames.has(item)),
      });
    }
    // Contrats expirés (5 jours).
    for (const player of Object.values(this.data.players))
      player.quests = player.quests.filter((q) => q.state === 'done' || day - (q.day ?? day) <= 5 || (q.state === 'ready'));
    const cal = calendar(day);
    if (cal.holy) this.addNews(this.lang === 'en' ? 'A holy day: sermon at dawn in the church.' : 'Jour sacré : sermon à l’aube à l’église.', 2, 'calendar');
    if (cal.market) this.addNews(this.lang === 'en' ? 'Market day in the covered market!' : 'Jour du marché sous la halle couverte !', 2, 'calendar');
    if (cal.festival) this.addNews(this.lang === 'en' ? 'Mead festival tonight at the Great Mead Hall!' : 'Fête de l’hydromel ce soir à la Grande Brasserie !', 3, 'calendar');
    if (!first) this.writeChronicle(day - 1).catch(() => {});
  }

  hourly(hours, clock) {
    // Rumeurs entre habitants réunis au même endroit.
    const byPlace = new Map();
    for (const npc of this.activeNpcs()) {
      if (npc.current.activity === 'sleep') continue;
      const key = npc.current.place === 'work' ? `work:${npc.place}` : npc.current.place;
      if (!byPlace.has(key)) byPlace.set(key, []);
      byPlace.get(key).push(npc);
    }
    for (const group of byPlace.values()) {
      if (group.length < 2 || this.random() > hours * 0.8) continue;
      const teller = pick(group, this.random);
      const listener = pick(group.filter((n) => n !== teller), this.random);
      if (listener) {
        gossip(teller, listener, this.random);
        listener.mind.needs.social = clamp(listener.mind.needs.social + 0.1, 0, 1);
      }
    }
    void clock;
  }

  // ---------- Événements du jeu ----------

  async onEvent(event) {
    switch (event.type) {
      case 'chat':
        return this.onChat(event);
      case 'kill':
        return this.onKill(event);
      case 'join':
        return this.onJoin(event);
      case 'npc-dead':
        return this.onNpcDead(event);
      case 'npc-hit':
        return this.onNpcHit(event);
      case 'counter':
        return this.onCounter(event);
      case 'petition':
        return this.onPetition(event);
      default:
        return null;
    }
  }

  async onJoin(event) {
    const player = this.player(event);
    const title = titleFor(player.renown, this.lang);
    await sleep(8000);
    const text = this.lang === 'en'
      ? `Welcome to Spokaheim, ${player.name} (${title}). Talk to the inhabitants in chat, type !help for commands.`
      : `Bienvenue à Spokaheim, ${player.name} (${title}). Parlez aux habitants dans le chat, tapez !aide pour les commandes.`;
    await this.bridge.send('message', { peers: [event.peer], text, corner: true });
    if (!player.saga.done.length && !player.saga.chapter) this.startChapter(player, 'prologue');
  }

  async onChat(event) {
    const player = this.player(event);
    const text = String(event.text || '').trim();
    if (text.startsWith('!')) return this.command(player, event, text);
    if (!this.settings.enabled) return null;
    const candidates = this.activeNpcs().filter((n) => n.position && !(n.deadUntil > Date.now()));
    const npc = addressee(text, { ...event, account: player.account }, candidates, this.conversations);
    if (!npc) return null;
    return this.converse(npc, player, event, text);
  }

  // Conversation : mécanique d'abord (quêtes, commerce), puis réplique de l'IA (ou de secours).
  async converse(npc, player, event, text) {
    if (this.talking.has(npc.key)) {
      await this.say(npc, this.lang === 'en' ? '*raises a hand* One at a time!' : '*lève la main* Un à la fois !', { peers: [event.peer] });
      return null;
    }
    this.talking.add(npc.key);
    try {
      const lang = this.lang;
      const intents = intentsOf(text);
      const rel = relationWith(npc, player.account);
      const facts = [];
      const extra = []; // lignes mécaniques ajoutées après la réplique (listes, prix…)
      const convo = this.conversations.get(player.account) || {};
      this.conversations.set(player.account, { ...convo, npc: npc.key, t: Date.now() });
      rel.talks++;
      rel.lastTalk = Date.now();
      player.stats.talks++;
      npc.mind.needs.social = clamp(npc.mind.needs.social + 0.05, 0, 1);

      if (!player.saga.chapter && !player.saga.done.length) this.startChapter(player, 'prologue');
      // Saga : étape « parler à cet habitant ».
      const sagaFact = await this.sagaTalk(player, npc, event.peer);
      if (sagaFact) facts.push(sagaFact);
      // Contrats prêts à rendre (chasse, exploration, arène) ou livraisons déposées.
      for (const fact of await this.turnInReady(player, npc, event.peer, intents.turnIn)) facts.push(fact);

      const offers = this.data.offers[npc.key] || [];
      if (intents.accept && offers.length && (convo.offersShownAt && Date.now() - convo.offersShownAt < 300000 || intents.number)) {
        const offer = offers[(intents.number || 1) - 1];
        const result = offer ? this.acceptOffer(player, offer) : null;
        facts.push(result || (lang === 'en' ? 'the speaker accepted a job that does not exist' : "l'interlocuteur accepte un travail qui n'existe pas"));
      } else if (intents.contracts) {
        if (offers.length) {
          extra.push(...offers.map((o, i) => `[${i + 1}] ${o.title} — ${this.describeOffer(o)} (${o.coins} ${lang === 'en' ? 'coins' : 'pièces'})`));
          extra.push(lang === 'en' ? 'Say "I accept 1" (or 2) to take the job.' : 'Dis « j’accepte 1 » (ou 2) pour prendre le travail.');
          this.conversations.set(player.account, { npc: npc.key, t: Date.now(), offersShownAt: Date.now() });
          facts.push(lang === 'en' ? `you describe the work you offer: ${offers.map((o) => o.title).join(', ')}` : `tu présentes le travail que tu proposes : ${offers.map((o) => o.title).join(', ')}`);
        } else facts.push(lang === 'en' ? 'you have no work to offer today' : "tu n'as pas de travail à proposer aujourd'hui");
      }
      if (npc.shop && (intents.prices || intents.buy || intents.sell)) {
        for (const fact of await this.trade(npc, player, event, text, intents, extra)) facts.push(fact);
      }
      if (intents.gift) {
        const fact = await this.receiveGift(npc, player);
        if (fact) facts.push(fact);
      }
      if (intents.rumor) {
        const memory = pick((npc.memories || []).filter((m) => m.shareable), this.random) || pick(this.data.news.slice(-6), this.random);
        facts.push(memory ? `${lang === 'en' ? 'share this rumour' : 'raconte cette rumeur'} : ${memory.text}` : lang === 'en' ? 'you know no rumour' : 'tu ne connais aucune rumeur');
      }
      if (intents.insult) {
        appraise(npc, 'anger', 0.35, `${player.name} ${lang === 'en' ? 'insulted me' : "m'a insulté"}`);
        adjustAffinity(npc, player.account, -8);
        remember(npc, `${player.name} ${lang === 'en' ? 'insulted me' : "m'a insulté"}.`, { importance: 3, about: [player.account], shareable: true });
      }
      if (intents.compliment) {
        appraise(npc, 'joy', 0.2, `${player.name} ${lang === 'en' ? 'was kind to me' : 'a été aimable avec moi'}`);
        adjustAffinity(npc, player.account, 2);
      }

      // Réplique.
      let reply = null;
      let emotion = null;
      const renownTitle = titleFor(player.renown, lang);
      if (this.ai.available && this.ai.busy < 4) {
        const system = systemPrompt(npc, lang);
        const history = (rel.history || []).slice(-6);
        const context = contextPrompt({
          npc,
          player: { ...player, wanted: player.wanted > Date.now() },
          rel,
          clock: clockOf(this.bridge.state?.game),
          facts,
          news: this.data.news.slice(-3).map((n) => n.text),
          offers,
          activeQuests: player.quests.filter((q) => q.giver === npc.key && q.state !== 'done').map((q) => `${q.title} (${this.questProgress(q)})`),
          lang,
          renownTitle,
        });
        const messages = [...history, { role: 'user', content: `${context}\n\n${player.name} : ${text}` }];
        let answered = false;
        const filler = setTimeout(() => {
          if (!answered) this.say(npc, thinkingLine(lang), { quick: true }).catch(() => {});
        }, 2500);
        try {
          const result = await this.ai.complete({ system, messages, priority: 0 });
          answered = true;
          reply = String(result.say || '').trim();
          emotion = emotionKey(result.emotion);
          const delta = clamp(Math.round(Number(result.affinity) || 0), -5, 5);
          if (delta) adjustAffinity(npc, player.account, delta);
          if (result.remember) learnFact(npc, player.account, result.remember);
        } catch (error) {
          answered = true;
          console.warn('[world] ai', error.message);
        } finally {
          clearTimeout(filler);
        }
        if (reply) {
          rel.history = [...history, { role: 'user', content: `${player.name} : ${text}` }, { role: 'assistant', content: JSON.stringify({ say: reply }) }].slice(-8);
        }
      }
      if (!reply) {
        const kind = intents.insult ? 'insult' : intents.compliment ? 'compliment' : intents.farewell ? 'farewell' : intents.whoAreYou ? 'who' : intents.greet || rel.talks <= 1 ? greetingKind(npc) : intents.rumor && !facts.length ? 'rumorNone' : intents.contracts && !(this.data.offers[npc.key] || []).length ? 'noWork' : 'default';
        reply = facts.length && kind === 'default' ? '' : fallbackLine(kind, { npc, player, lang });
        // Sans IA, les faits mécaniques sont dits tels quels.
        if (facts.length) reply = `${reply} ${facts.map((f) => capitalize(f)).join('. ')}.`.trim();
      }
      if (emotion) appraise(npc, emotion, 0.12, null);
      await this.say(npc, reply, {});
      for (const line of extra) await this.say(npc, line, { peers: [event.peer] });
      this.syncDirty = true;
      this.conversationLog.append({ t: Date.now(), npc: npc.key, player: player.name, account: player.account, text, reply, facts, mood: mood(npc, lang).label, ai: this.ai.available });
      return reply;
    } finally {
      this.talking.delete(npc.key);
    }
  }

  // Fait parler un habitant : bulles au-dessus de sa tête (joueurs proches, ou destinataires donnés).
  say(npc, text, { peers = null, mode = 'say', quick = false } = {}) {
    const parts = bubbles(text);
    const job = async () => {
      for (const [i, part] of parts.entries()) {
        await this.bridge.send('say', { npc: npc.id, name: npc.name.split(' ')[0], text: part, mode, ...(peers ? { peers } : {}) });
        if (!quick && i < parts.length - 1) await sleep(BUBBLE_GAP);
      }
      if (!quick && parts.length) await sleep(1200);
    };
    const run = this.speechQueue.then(job, job);
    this.speechQueue = run.catch(() => {});
    return run;
  }

  // Message privé (bulle et ligne de chat) pour un joueur : réponses aux commandes.
  async whisper(event, text) {
    for (const part of bubbles(text, 150)) {
      await this.bridge.send('say', { position: [event.x, (event.y || 0) + 2, event.z], name: this.lang === 'en' ? 'Journal' : 'Journal', text: part, mode: 'say', peers: [event.peer] });
      await sleep(400);
    }
  }

  // ---------- Quêtes ----------

  describeOffer(o) {
    const lang = this.lang;
    if (o.kind === 'deliver') return `${lang === 'en' ? 'bring' : 'apporter'} ${o.items.map(([i, c]) => this.itemName(i, c)).join(', ')}`;
    if (o.kind === 'kill') return `${lang === 'en' ? 'slay' : 'abattre'} ${o.count} × ${this.creatureName(o.targets[0])}`;
    if (o.kind === 'visit') return `${lang === 'en' ? 'go to' : 'se rendre :'} ${o.biome}`;
    if (o.kind === 'arena') return lang === 'en' ? 'win an arena fight' : "gagner un combat d'arène";
    return '';
  }

  questProgress(q) {
    return q.objectives.map((o) => `${Math.min(o.progress, o.count)}/${o.count}`).join(', ');
  }

  acceptOffer(player, offer) {
    const lang = this.lang;
    if (player.quests.some((q) => q.offer === offer.id)) return lang === 'en' ? `the speaker already has the job "${offer.title}"` : `l'interlocuteur a déjà le travail « ${offer.title} »`;
    if (player.quests.filter((q) => q.state !== 'done').length >= MAX_ACTIVE_QUESTS) return lang === 'en' ? 'the speaker already has too many jobs (5 maximum)' : "l'interlocuteur a déjà trop de travaux en cours (5 au maximum)";
    player.quests.push({ id: `${offer.id}-${player.account}`, offer: offer.id, giver: offer.giver, title: offer.title, kind: offer.kind, objectives: objectivesOf(offer), coins: offer.coins, faction: offer.faction, rumor: offer.rumor, state: 'active', day: this.data.day, accepted: Date.now() });
    return lang === 'en' ? `the speaker accepted the job "${offer.title}"` : `l'interlocuteur accepte le travail « ${offer.title} » (${this.describeOffer(offer)})`;
  }

  startChapter(player, id) {
    const chapter = sagaChapter(id);
    if (!chapter) return;
    player.saga.chapter = id;
    player.saga.step = 0;
    player.saga.progress = 0;
  }

  sagaStep(player) {
    const chapter = sagaChapter(player.saga.chapter);
    return chapter ? chapter.steps[player.saga.step] : null;
  }

  async advanceSaga(player, peer) {
    const chapter = sagaChapter(player.saga.chapter);
    const step = chapter.steps[player.saga.step];
    if (step?.flag) this.setFlag(step.flag, player);
    player.saga.step++;
    player.saga.progress = 0;
    const lang = this.lang;
    if (player.saga.step >= chapter.steps.length) {
      player.saga.done.push(chapter.id);
      player.saga.chapter = null;
      await this.reward(player, peer, { coins: chapter.reward.coins, renown: chapter.reward.renown, faction: chapter.reward.faction, label: chapter.title });
      this.addNews(lang === 'en' ? `${player.name} completed the saga chapter "${chapter.title}".` : `${player.name} a accompli le chapitre « ${chapter.title} » de la saga.`, 4, 'saga', player.account);
      const next = nextChapter(player.saga.done);
      if (next) {
        this.startChapter(player, next.id);
        if (peer) await this.bridge.send('message', { peers: [peer], text: `${lang === 'en' ? 'New chapter' : 'Nouveau chapitre'} : ${next.title} — ${next.steps[0].text}` });
      }
    } else if (peer) {
      await this.bridge.send('message', { peers: [peer], text: `${chapter.title} : ${chapter.steps[player.saga.step].text}`, corner: true });
    }
  }

  async sagaTalk(player, npc, peer) {
    const step = this.sagaStep(player);
    if (!step || step.type !== 'talk' || step.npc !== npc.key) return null;
    const chapter = sagaChapter(player.saga.chapter);
    await this.advanceSaga(player, peer);
    const lang = this.lang;
    return lang === 'en'
      ? `story event for the saga "${chapter.title}": the speaker came to you for "${step.text}"; play this scene and point them to the next step`
      : `scène de la saga « ${chapter.title} » : l'interlocuteur vient te voir pour « ${step.text} » ; joue la scène et oriente-le vers la suite${this.sagaStep(player) ? ` (${this.sagaStep(player).text})` : ''}`;
  }

  // Progression générique : kill (prefab), visit (biome), arena.
  async progress(player, event, peer) {
    const matches = (o) =>
      (o.type === 'kill' && event.type === 'kill' && targetMatches(o.targets, event.prefab)) ||
      (o.type === 'visit' && event.type === 'visit' && o.biome === event.biome) ||
      (o.type === 'arena' && event.type === 'arena');
    for (const quest of player.quests) {
      if (quest.state !== 'active') continue;
      let changed = false;
      for (const o of quest.objectives) {
        if (o.progress >= o.count || !matches(o)) continue;
        o.progress++;
        changed = true;
      }
      if (changed && quest.objectives.every((o) => o.type === 'deliver' || o.progress >= o.count) && quest.objectives.every((o) => o.type !== 'deliver')) {
        quest.state = 'ready';
        const giver = this.npcs.get(quest.giver);
        if (peer) await this.bridge.send('message', { peers: [peer], text: `${quest.title} : ${this.lang === 'en' ? 'done! Return to' : 'terminé ! Retourne voir'} ${giver?.name || quest.giver}.`, corner: true });
      }
    }
    const step = this.sagaStep(player);
    if (step && step.type === event.type && ((step.type === 'kill' && targetMatches(step.targets, event.prefab)) || (step.type === 'visit' && step.biome === event.biome))) {
      player.saga.progress++;
      if (player.saga.progress >= (step.count || 1)) await this.advanceSaga(player, peer);
    }
  }

  async turnInReady(player, npc, peer, wantsDelivery) {
    const facts = [];
    const lang = this.lang;
    for (const quest of player.quests.filter((q) => q.giver === npc.key && q.state === 'ready')) {
      await this.completeQuest(player, quest, peer);
      facts.push(lang === 'en' ? `the speaker completed your job "${quest.title}" and received ${quest.coins} coins` : `l'interlocuteur a terminé ton travail « ${quest.title} » et reçoit ${quest.coins} pièces`);
    }
    const deliveries = player.quests.filter((q) => q.giver === npc.key && q.state === 'active' && q.objectives.some((o) => o.type === 'deliver'));
    const step = this.sagaStep(player);
    const sagaDelivery = step?.type === 'deliver' && step.npc === npc.key;
    if ((deliveries.length || sagaDelivery) && wantsDelivery) {
      const counterKey = COUNTERS[npc.key];
      const counter = this.data.counters[stableHash(counterKey)];
      for (const quest of deliveries) {
        const need = quest.objectives.filter((o) => o.type === 'deliver').map((o) => [o.item, o.count]);
        if (await this.takeFromCounter(counterKey, counter, need)) {
          await this.completeQuest(player, quest, peer);
          facts.push(lang === 'en' ? `the speaker delivered ${need.map(([i, c]) => this.itemName(i, c)).join(', ')} for "${quest.title}" and received ${quest.coins} coins` : `l'interlocuteur a livré ${need.map(([i, c]) => this.itemName(i, c)).join(', ')} pour « ${quest.title} » et reçoit ${quest.coins} pièces`);
        } else {
          facts.push(lang === 'en' ? `the speaker wants to deliver for "${quest.title}" but the items are not in your chest nearby: ${need.map(([i, c]) => this.itemName(i, c)).join(', ')}` : `l'interlocuteur veut livrer pour « ${quest.title} » mais les objets ne sont pas dans ton coffre de remise : ${need.map(([i, c]) => this.itemName(i, c)).join(', ')}`);
        }
      }
      if (sagaDelivery && (await this.takeFromCounter(counterKey, counter, step.items))) {
        facts.push(lang === 'en' ? `the speaker brought ${step.items.map(([i, c]) => this.itemName(i, c)).join(', ')} for the saga` : `l'interlocuteur a apporté ${step.items.map(([i, c]) => this.itemName(i, c)).join(', ')} pour la saga`);
        await this.advanceSaga(player, peer);
      }
    }
    return facts;
  }

  async takeFromCounter(counterKey, counter, items) {
    if (!counter) return false;
    const have = new Map();
    for (const [item, count] of counter.items) have.set(item, (have.get(item) || 0) + count);
    if (!items.every(([item, count]) => (have.get(item) || 0) >= count)) return false;
    const result = await this.bridge.send('counter-take', { counter: stableHash(counterKey), items }, { wait: true });
    return !!result?.ok;
  }

  async completeQuest(player, quest, peer) {
    quest.state = 'done';
    quest.completed = Date.now();
    player.stats.quests++;
    const giver = this.npcs.get(quest.giver);
    const renown = Math.round(quest.coins / 3);
    await this.reward(player, peer, { coins: quest.coins, renown, faction: quest.faction, label: quest.title });
    if (giver) {
      appraise(giver, 'gratitude', 0.3, `${player.name} ${this.lang === 'en' ? 'finished my job' : 'a fini mon travail'}`);
      adjustAffinity(giver, player.account, 8);
      remember(giver, `${player.name} ${this.lang === 'en' ? 'completed' : 'a accompli'} « ${quest.title} ».`, { importance: 3, about: [player.account], shareable: true });
      // Les livraisons nourrissent la production de la ville.
      const shopKey = giver.shop || { forge: 'foundry', brewery: 'tavern', farm: 'bakery', fish: 'kitchen' }[giver.contracts];
      if (shopKey && this.data.economy.shops[shopKey])
        for (const o of quest.objectives.filter((x) => x.type === 'deliver')) {
          const supply = this.data.economy.shops[shopKey].supply;
          supply[o.item] = (supply[o.item] || 0) + o.count;
        }
      if (quest.rumor) {
        const secret = pick(this.activeNpcs(), this.random);
        if (secret && peer) await this.say(giver, `${this.lang === 'en' ? 'Listen… they say' : 'Écoute… on raconte que'} ${secret.secret.charAt(0).toLowerCase()}${secret.secret.slice(1)}`, { peers: [peer] });
      }
    }
  }

  async reward(player, peer, { coins = 0, renown = 0, faction = null, items = [], label = '' }) {
    player.renown += renown;
    if (faction) player.reputation[faction] = (player.reputation[faction] || 0) + renown;
    const before = titleFor(player.renown - renown, this.lang);
    const after = titleFor(player.renown, this.lang);
    const gifts = [...items];
    if (coins > 0) gifts.push(['Coins', coins]);
    if (gifts.length && peer) await this.bridge.send('give', { peer, items: gifts });
    if (peer) {
      await this.bridge.send('message', { peers: [peer], text: `${label} : +${coins} ${this.lang === 'en' ? 'coins' : 'pièces'}, +${renown} ${this.lang === 'en' ? 'renown' : 'renommée'}` });
      if (before !== after) {
        await this.bridge.send('message', { peers: [peer], text: `${this.lang === 'en' ? 'New title' : 'Nouveau titre'} : ${after} !` });
        this.addNews(`${player.name} ${this.lang === 'en' ? 'is now' : 'est désormais'} ${after}.`, 4, 'title', player.account);
      }
    }
  }

  // ---------- Commerce ----------

  shopOf(npc) {
    return npc.shop && SHOPS[npc.shop] ? npc.shop : null;
  }

  findItem(shopKey, text) {
    const t = fold(text);
    let best = null;
    for (const item of Object.keys(SHOPS[shopKey].sells)) {
      const names = [item, this.itemNames.get(item)?.fr, this.itemNames.get(item)?.en].filter(Boolean).map(fold);
      for (const name of names) {
        const words = name.split(/\s+/).filter((w) => w.length > 3);
        const score = t.includes(name) ? 10 : words.filter((w) => t.includes(w)).length;
        if (score > 0 && (!best || score > best.score)) best = { item, score };
      }
    }
    return best?.item || null;
  }

  async trade(npc, player, event, text, intents, extra) {
    const lang = this.lang;
    const shopKey = this.shopOf(npc);
    if (!shopKey) return [];
    const economy = this.data.economy;
    const opts = { valence: valence(npc), affinity: relationWith(npc, player.account).affinity };
    const facts = [];
    const counterKey = COUNTERS[npc.key];
    const counter = this.data.counters[stableHash(counterKey)];
    if (intents.prices || (intents.buy && !this.findItem(shopKey, text))) {
      const list = Object.keys(SHOPS[shopKey].sells)
        .filter((item) => (economy.shops[shopKey].stock[item] || 0) >= 1)
        .map((item) => `${this.itemName(item)} ${sellPrice(economy, shopKey, item, opts)}`);
      extra.push(`${lang === 'en' ? 'For sale' : 'À vendre'} : ${list.join(' · ') || (lang === 'en' ? 'nothing today' : "rien aujourd'hui")}`);
      extra.push(lang === 'en' ? 'Put the coins in my chest, then say "I buy 2 <item>".' : 'Dépose les pièces dans mon coffre, puis dis « j’achète 2 <objet> ».');
      facts.push(lang === 'en' ? `you show your goods; the price list is written just after your line, do not quote any price yourself` : `tu présentes tes marchandises ; la liste des prix s'affiche juste après ta réplique, ne cite toi-même aucun prix`);
    }
    if (intents.buy) {
      const item = this.findItem(shopKey, text);
      if (item) {
        const count = clamp(intents.number || 1, 1, 50);
        const stock = Math.floor(economy.shops[shopKey].stock[item] || 0);
        const price = sellPrice(economy, shopKey, item, opts) * count;
        const coins = (counter?.items || []).filter(([i]) => i === 'Coins').reduce((s, [, c]) => s + c, 0);
        if (stock < count) facts.push(lang === 'en' ? `you only have ${stock} ${this.itemName(item)} left` : `il ne te reste que ${stock} ${this.itemName(item)}`);
        else if (coins < price) facts.push(lang === 'en' ? `the speaker wants ${count} ${this.itemName(item)} for ${price} coins but has only put ${coins} coins in your chest` : `l'interlocuteur veut ${this.itemName(item, count)} pour ${price} pièces mais n'a mis que ${coins} pièces dans ton coffre`);
        else {
          const took = await this.bridge.send('counter-take', { counter: stableHash(counterKey), items: [['Coins', price]] }, { wait: true });
          const put = took?.ok ? await this.bridge.send('counter-put', { counter: stableHash(counterKey), items: [[item, count]] }, { wait: true }) : null;
          if (put?.ok) {
            economy.shops[shopKey].stock[item] -= count;
            economy.shops[shopKey].gold += price;
            economy.shops[shopKey].sold += price;
            adjustAffinity(npc, player.account, 1);
            appraise(npc, 'joy', 0.1, lang === 'en' ? 'a good sale' : 'une bonne vente');
            facts.push(lang === 'en' ? `sale done: ${count} ${this.itemName(item)} for ${price} coins, now in your chest` : `vente conclue : ${this.itemName(item, count)} pour ${price} pièces, déposés dans ton coffre`);
          } else facts.push(lang === 'en' ? 'the chest is open or full, the sale failed' : 'le coffre est ouvert ou plein, la vente échoue');
        }
      }
    }
    if (intents.sell) {
      const offer = [];
      let total = 0;
      for (const [item, count] of counter?.items || []) {
        if (item === 'Coins') continue;
        const price = buyPrice(economy, shopKey, item, opts);
        if (!price) continue;
        offer.push([item, count, price * count]);
        total += price * count;
      }
      const cash = economy.shops[shopKey].gold;
      if (!offer.length) facts.push(lang === 'en' ? 'there is nothing you want to buy in your chest' : "il n'y a rien que tu veuilles acheter dans ton coffre");
      else if (total > cash) facts.push(lang === 'en' ? `you cannot afford it (${total} coins, you have ${Math.floor(cash)})` : `tu n'as pas les moyens (${total} pièces, tu n'en as que ${Math.floor(cash)})`);
      else {
        const took = await this.bridge.send('counter-take', { counter: stableHash(counterKey), items: offer.map(([i, c]) => [i, c]) }, { wait: true });
        const paid = took?.ok ? await this.bridge.send('counter-put', { counter: stableHash(counterKey), items: [['Coins', total]] }, { wait: true }) : null;
        if (paid?.ok) {
          economy.shops[shopKey].gold -= total;
          economy.shops[shopKey].bought += total;
          for (const [item, count] of offer) economy.shops[shopKey].supply[item] = (economy.shops[shopKey].supply[item] || 0) + count;
          facts.push(lang === 'en' ? `you bought ${offer.map(([i, c]) => `${c} ${this.itemName(i)}`).join(', ')} for ${total} coins, put in your chest` : `tu as acheté ${offer.map(([i, c]) => this.itemName(i, c)).join(', ')} pour ${total} pièces, posées dans ton coffre`);
        } else facts.push(lang === 'en' ? 'the chest is open, the deal failed' : 'le coffre est ouvert, le marché échoue');
      }
    }
    return facts;
  }

  async receiveGift(npc, player) {
    const lang = this.lang;
    const counterKey = COUNTERS[npc.key];
    const counter = this.data.counters[stableHash(counterKey)];
    const items = (counter?.items || []).filter(([, , , owner]) => true).slice(0, 4);
    if (!items.length || counter.account !== player.account) return null;
    const took = await this.bridge.send('counter-take', { counter: stableHash(counterKey), items: items.map(([i, c]) => [i, c]) }, { wait: true });
    if (!took?.ok) return null;
    const value = items.reduce((s, [i, c]) => s + (BASE_PRICES[i] || 5) * c, 0);
    const liked = items.some(([i]) => npc.likes.some((l) => fold(l).includes(fold(this.itemName(i)).split(' ')[0])));
    const delta = clamp(Math.round(value / 20) + (liked ? 6 : 0), 1, 20);
    adjustAffinity(npc, player.account, delta);
    appraise(npc, 'gratitude', clamp(delta / 25, 0.1, 0.6), `${player.name} ${lang === 'en' ? 'gave me a gift' : "m'a fait un cadeau"}`);
    remember(npc, `${player.name} ${lang === 'en' ? 'gave me' : "m'a offert"} ${items.map(([i, c]) => this.itemName(i, c)).join(', ')}.`, { importance: 3, about: [player.account], shareable: true });
    return lang === 'en' ? `the speaker gave you a gift: ${items.map(([i, c]) => this.itemName(i, c)).join(', ')}` : `l'interlocuteur t'offre un cadeau : ${items.map(([i, c]) => this.itemName(i, c)).join(', ')}`;
  }

  // ---------- Autres événements ----------

  async onCounter(event) {
    const opener = event.account ? this.data.players[event.account] : null;
    this.data.counters[event.counter] = { items: event.items || [], player: event.player, account: event.account, t: Date.now() };
    if (!opener) return;
    // Livraison automatique : le joueur dépose exactement ce qu'un contrat demande dans le coffre du donneur.
    const counterKey = Object.values(COUNTERS).find((k) => stableHash(k) === event.counter);
    if (!counterKey) return;
    const givers = Object.entries(COUNTERS).filter(([, k]) => k === counterKey).map(([npcKey]) => npcKey);
    const peer = opener.peer;
    for (const npcKey of givers) {
      const npc = this.npcs.get(npcKey);
      const facts = await this.turnInReady(opener, npc, peer, true);
      if (facts.length && npc && !npc.absent) {
        const line = this.lang === 'en' ? `Ah, ${opener.name}! Thank you, everything is here.` : `Ah, ${opener.name} ! Merci, tout y est.`;
        await this.say(npc, line, {});
      }
    }
  }

  async onKill(event) {
    const player = this.player(event);
    player.stats.kills[event.prefab] = (player.stats.kills[event.prefab] || 0) + 1;
    const boss = BOSS_KEYS.find((b) => b.prefab === event.prefab);
    const credited = [player];
    if (boss) {
      // Les boss comptent pour tous les joueurs présents au combat.
      for (const p of this.onlinePlayers()) if (p.record !== player && Math.hypot(p.x - event.x, p.z - event.z) < 80) credited.push(p.record);
      const names = credited.map((p) => p.name).join(', ');
      const text = this.lang === 'en' ? `${names} slew ${boss.en}!` : `${names} a abattu ${boss.fr} !`;
      this.addNews(text, 5, 'boss');
      for (const npc of this.activeNpcs()) {
        appraise(npc, 'joy', 0.35, text);
        remember(npc, text, { importance: 5, about: credited.map((p) => p.account), shareable: true });
        for (const p of credited) adjustAffinity(npc, p.account, 6);
      }
      for (const p of credited) {
        await this.reward(p, p.peer, { coins: 50 * boss.tier, renown: 60 * boss.tier, faction: 'couronne', label: text });
      }
    }
    for (const p of credited) await this.progress(p, { type: 'kill', prefab: event.prefab }, p.peer);
  }

  async onNpcHit(event) {
    const key = this.byId.get(event.npc);
    const npc = key && this.npcs.get(key);
    if (!npc || !event.account) return;
    const player = this.player(event);
    appraise(npc, 'fear', 0.3, `${player.name} ${this.lang === 'en' ? 'attacked me' : "m'a attaqué"}`);
    appraise(npc, 'anger', 0.3, null);
    adjustAffinity(npc, player.account, -15);
    await this.say(npc, pick(this.lang === 'en' ? ['Guards! GUARDS!', 'Have you lost your mind?!', 'Stop that!'] : ['À la garde ! À LA GARDE !', 'Tu as perdu la tête ?!', 'Arrête ça tout de suite !'], this.random), { mode: 'shout' });
  }

  async onNpcDead(event) {
    const key = this.byId.get(event.npc);
    const npc = key && this.npcs.get(key);
    if (!npc) return;
    npc.deadUntil = Date.now() + this.settings.respawnSeconds * 1000;
    const lang = this.lang;
    const killer = event.killer ? Object.values(this.data.players).find((p) => p.name === event.killer) : null;
    const text = killer
      ? lang === 'en' ? `${killer.name} murdered ${npc.name}!` : `${killer.name} a assassiné ${npc.name} !`
      : lang === 'en' ? `${npc.name} was killed near the city.` : `${npc.name} a été tué près de la ville.`;
    this.addNews(text, 5, 'death');
    for (const other of this.activeNpcs()) {
      if (other === npc) continue;
      const close = (other.relations_def || []).some((r) => r.key === npc.key);
      appraise(other, 'sadness', close ? 0.6 : 0.2, text);
      if (killer) {
        appraise(other, 'anger', close ? 0.5 : 0.25, text);
        adjustAffinity(other, killer.account, close ? -40 : -15);
      }
      remember(other, text, { importance: close ? 5 : 3, about: killer ? [killer.account] : [], shareable: true });
    }
    if (killer) {
      killer.wanted = Date.now() + 3 * 3600000;
      killer.bounty = (killer.bounty || 0) + 150;
      const hrolf = this.npcs.get('hrolf');
      if (hrolf) await this.say(hrolf, lang === 'en' ? `By Thor's beard! ${killer.name} is wanted for murder!` : `Par la barbe de Thor ! ${killer.name} est recherché pour meurtre !`, { mode: 'shout' });
      if (killer.peer) await this.bridge.send('message', { peers: [killer.peer], text: lang === 'en' ? 'You are wanted by the guard. Pay a 150 coin fine at the castle (!fine).' : 'Vous êtes recherché par la garde. Payez une amende de 150 pièces au château (!amende).' });
    }
  }

  async onPetition(event) {
    const lang = this.lang;
    const text = String(event.text || '').trim();
    const author = event.authorName || (lang === 'en' ? 'someone' : "quelqu'un");
    this.addNews(lang === 'en' ? `${author} wrote on the petition lectern: "${text}"` : `${author} a écrit au pupitre des doléances : « ${text} »`, 2, 'petition');
    const crier = this.npcs.get('arne');
    if (!crier) return;
    let reply = lang === 'en' ? `Hear ye! A petition from ${author}: ${text}. The Crown shall consider it!` : `Oyez ! Doléance de ${author} : ${text}. La Couronne en sera saisie !`;
    if (this.ai.available) {
      try {
        const result = await this.ai.complete({
          system: systemPrompt(this.npcs.get('ingrid'), lang),
          messages: [{ role: 'user', content: lang === 'en' ? `A citizen named ${author} wrote on the public petition lectern: "${text}". Answer publicly as the Chancellor in 1 or 2 sentences.` : `Un habitant nommé ${author} a écrit sur le pupitre des doléances : « ${text} ». Réponds publiquement en tant que chancelière, en 1 ou 2 phrases.` }],
          priority: 1,
        });
        if (result.say) reply = `${lang === 'en' ? 'Hear ye! The Chancellor answers' : 'Oyez ! La chancelière répond à'} ${author} : ${result.say}`;
      } catch {
        // réponse de secours
      }
    }
    await this.say(crier, reply, { mode: 'shout' });
  }

  async checkArena() {
    const state = await this.arena?.state?.().catch(() => null);
    const records = state?.records || [];
    const known = new Set(this.data.arenaRecords || []);
    for (const record of records) {
      const id = `${record.time || record.date || ''}-${(record.names || []).join(',')}-${record.wave || ''}`;
      if (known.has(id)) continue;
      known.add(id);
      if (this.data.arenaRecords.length === 0 && records.length > 1) continue; // premier passage : historique
      if (record.outcome && !/win|victoire|won/i.test(record.outcome)) continue;
      for (const name of record.names || []) {
        const p = Object.values(this.data.players).find((x) => x.name === name);
        if (p) await this.progress(p, { type: 'arena' }, p.peer);
      }
      if ((record.names || []).length) this.addNews(`${record.names.join(', ')} ${this.lang === 'en' ? 'triumphed in the arena' : "ont triomphé dans l'arène"} !`, 3, 'arena');
    }
    this.data.arenaRecords = [...known].slice(-200);
  }

  setFlag(flag, player) {
    this.data.flags[flag] = { t: Date.now(), by: player?.account };
    if (flag === 'eirik_returned') {
      const eirik = this.npcs.get('eirik');
      if (eirik) {
        eirik.absent = false;
        this.syncDirty = true;
        const bjorn = this.npcs.get('bjorn');
        if (bjorn) {
          appraise(bjorn, 'joy', 0.9, this.lang === 'en' ? 'Eirik came home' : 'Eirik est rentré');
          adjustAffinity(bjorn, player.account, 40);
        }
        const astrid = this.npcs.get('astrid');
        if (astrid) appraise(astrid, 'joy', 0.9, this.lang === 'en' ? 'Eirik came home' : 'Eirik est rentré');
        this.addNews(this.lang === 'en' ? `Eirik Martelfer is back in Spokaheim thanks to ${player.name}!` : `Eirik Martelfer est de retour à Spokaheim grâce à ${player.name} !`, 5, 'saga');
      }
    }
    if (flag === 'emperor_healed') {
      for (const npc of this.activeNpcs()) appraise(npc, 'joy', 0.8, this.lang === 'en' ? 'the Emperor is healed' : "l'Empereur est guéri");
      this.addNews(this.lang === 'en' ? 'The Emperor is healed! Spokaheim celebrates.' : "L'Empereur est guéri ! Spokaheim est en fête.", 5, 'saga');
    }
  }

  addNews(text, importance = 2, kind = 'misc', account = null) {
    const entry = { t: Date.now(), day: this.data.day, text, importance, kind, account, announced: false };
    this.data.news.push(entry);
    if (this.data.news.length > 80) this.data.news.splice(0, this.data.news.length - 80);
    this.chronicleLog.append(entry);
    if (importance >= 3) for (const npc of this.activeNpcs()) if (this.random() < 0.3) remember(npc, text, { importance: importance - 1, shareable: true });
  }

  // ---------- Vie ambiante ----------

  async ambient(state, clock) {
    const players = state.players || [];
    if (!players.length || !this.settings.enabled) return;
    const now = Date.now();
    const lang = this.lang;
    const cool = (key, ms) => {
      if ((this.cooldowns.get(key) || 0) > now) return false;
      this.cooldowns.set(key, now + ms);
      return true;
    };
    const near = (npc, p, d) => npc.position && Math.hypot(npc.position.x - p.x, npc.position.z - p.z) < d;
    // Salutations quand un joueur passe près d'un habitant.
    if (this.settings.barks)
      for (const p of players) {
        const player = this.player(p);
        const npc = this.activeNpcs().find((n) => near(n, p, 6) && n.current.activity !== 'sleep' && !this.talking.has(n.key));
        if (!npc || !cool(`bark:${npc.key}:${player.account}`, 6 * 60000) || !cool(`bark:${npc.key}`, 40000)) continue;
        const rel = relationWith(npc, player.account);
        let line;
        if (player.wanted > now && npc.faction === 'garde') line = lang === 'en' ? `Halt, ${player.name}! You are wanted. Pay your fine at the castle.` : `Halte, ${player.name} ! Tu es recherché. Paie ton amende au château.`;
        else if (rel.affinity < -25) line = pick(lang === 'en' ? ['*glares at you*', 'You again…', 'Keep walking.'] : ['*te lance un regard noir*', 'Encore toi…', 'Passe ton chemin.'], this.random);
        else if (npc.faction === 'garde' && npc.current.activity === 'guard') line = pick(lang === 'en' ? [`Stay safe out there, ${player.name}.`, 'All quiet on the walls.', `Hail, ${titleFor(player.renown, lang)}.`] : [`Sois prudent dehors, ${player.name}.`, 'Rien à signaler sur les remparts.', `Salut à toi, ${titleFor(player.renown, lang)}.`], this.random);
        else if (npc.shop && npc.current.activity === 'work') line = pick(lang === 'en' ? ['Fresh goods today! Ask me my prices.', 'Come, come, take a look!'] : ['Marchandises fraîches aujourd’hui ! Demande-moi mes prix.', 'Approche, approche, jette un œil !'], this.random);
        else if ((this.data.offers[npc.key] || []).length && npc.current.activity === 'work' && this.random() < 0.5) line = lang === 'en' ? `${player.name}! I could use a hand, ask me about work.` : `${player.name} ! J'aurais besoin d'un coup de main, demande-moi du travail.`;
        else line = fallbackLine(greetingKind(npc), { npc, player, lang });
        this.say(npc, line, { peers: [p.peer] }).catch(() => {});
      }
    // Crieur public : annonce les nouvelles aux joueurs proches de la grand-place.
    const crier = this.npcs.get('arne');
    if (this.settings.crier && crier?.position && crier.current.activity === 'work' && players.some((p) => near(crier, p, 45)) && cool('crier', 100000)) {
      const news = this.data.news.filter((n) => !n.announced && n.importance >= 2).slice(-1)[0];
      if (news) {
        news.announced = true;
        this.say(crier, `${lang === 'en' ? 'Hear ye, hear ye!' : 'Oyez, oyez !'} ${news.text}`, { mode: 'shout' }).catch(() => {});
      }
    }
    // Sermon de l'aube les jours sacrés.
    const priest = this.npcs.get('dagny');
    if (this.settings.sermon && priest?.position && calendar(clock.day).holy && clock.fraction > 0.24 && clock.fraction < 0.3 && players.some((p) => near(priest, p, 40)) && cool(`sermon:${clock.day}`, 3600000)) {
      const lines = lang === 'en'
        ? ['Children of Spokaheim, the dawn rises again!', 'Odin has sent us his Chosen, and the Forsaken tremble.', 'Honour your oaths, share your bread, and the gods will not forget you.']
        : ['Enfants de Spokaheim, l’aube se lève encore !', 'Odin nous a envoyé ses Élus, et les Réprouvés tremblent.', 'Honorez vos serments, partagez votre pain, et les dieux ne vous oublieront pas.'];
      for (const line of lines) this.say(priest, line, { mode: 'shout' }).catch(() => {});
    }
    // Le barde chante à la brasserie le soir.
    const bard = this.npcs.get('leif');
    if (this.settings.bard && bard?.position && bard.current.activity === 'work' && players.some((p) => near(bard, p, 25)) && cool('bard', 6 * 60000)) {
      this.sing(bard).catch(() => {});
    }
    // Bavardages entre habitants réunis, quand un joueur est là pour les entendre.
    if (this.settings.chatter && cool('chatter', 75000)) {
      const awake = this.activeNpcs().filter((n) => n.position && n.current.activity !== 'sleep' && !this.talking.has(n.key));
      for (const a of awake) {
        const b = awake.find((x) => x !== a && Math.hypot(x.position.x - a.position.x, x.position.z - a.position.z) < 5);
        if (!b || !players.some((p) => near(a, p, 18))) continue;
        this.chatter(a, b).catch(() => {});
        break;
      }
    }
  }

  async sing(bard) {
    const lang = this.lang;
    const deed = this.data.news.filter((n) => n.importance >= 3).slice(-1)[0];
    let verse = null;
    if (this.ai.available && this.ai.busy === 0 && deed) {
      try {
        const result = await this.ai.complete({
          system: systemPrompt(bard, lang),
          messages: [{ role: 'user', content: lang === 'en' ? `Sing 4 very short rhyming verses (under 40 words total) about: ${deed.text}` : `Chante 4 vers très courts et rimés (moins de 40 mots au total) sur : ${deed.text}` }],
          priority: 2,
          maxTokens: 120,
        });
        verse = result.say;
      } catch {
        verse = null;
      }
    }
    verse = verse || pick(lang === 'en'
      ? ['♪ Raise your horns to Spokaheim, where the mead flows bright! ♪', '♪ The Chosen ride at dawn, the Forsaken flee the light! ♪']
      : ['♪ Levez vos cornes pour Spokaheim, où coule l’hydromel ! ♪', '♪ Les Élus partent à l’aube, et tremblent les Réprouvés du ciel ! ♪'], this.random);
    await this.say(bard, verse, { mode: 'say' });
  }

  async chatter(a, b) {
    const lang = this.lang;
    const relation = (a.relations_def || []).find((r) => r.key === b.key);
    const shared = gossip(a, b, this.random);
    let lines;
    if (shared) lines = [[a, `${lang === 'en' ? 'Did you hear?' : 'Tu as entendu ?'} ${shared.text}`], [b, pick(lang === 'en' ? ['No way!', 'By Odin…', 'I knew it.'] : ['Sans blague !', 'Par Odin…', 'Je le savais.'], this.random)]];
    else if (relation && /rival/.test(relation.type)) lines = [[a, pick(lang === 'en' ? [`Still here, ${b.name.split(' ')[0]}?`, 'Look who it is.'] : [`Encore là, ${b.name.split(' ')[0]} ?`, 'Tiens, regardez qui voilà.'], this.random)], [b, pick(lang === 'en' ? ['Mind your own business.', 'Ha. Charming as ever.'] : ['Occupe-toi de tes affaires.', 'Ha. Toujours aussi aimable.'], this.random)]];
    else lines = [[a, pick(lang === 'en' ? ['Long day, eh?', 'Did you see the Chosen today?', 'Mead tonight?'] : ['Longue journée, hein ?', 'Tu as vu les Élus aujourd’hui ?', 'Un hydromel ce soir ?'], this.random)], [b, pick(lang === 'en' ? ['Aye.', 'Too long.', 'Why not!'] : ['Ouais.', 'Bien trop longue.', 'Pourquoi pas !'], this.random)]];
    for (const [npc, line] of lines) await this.say(npc, line, {});
  }

  // Chronique du jour (IA en tâche de fond, sinon liste des nouvelles) : affichée sur le panneau des proclamations.
  async writeChronicle(day) {
    const items = this.data.news.filter((n) => n.day === day).map((n) => n.text);
    if (!items.length) return;
    let text = items.slice(-3).join(' ');
    if (this.ai.available) {
      try {
        const result = await this.ai.complete({
          system: systemPrompt(this.npcs.get('arne'), this.lang),
          messages: [{ role: 'user', content: this.lang === 'en' ? `Write the day's town chronicle in 2 short sentences from these events: ${items.join(' ; ')}` : `Écris la chronique du jour de la ville en 2 phrases courtes à partir de ces événements : ${items.join(' ; ')}` }],
          priority: 2,
          maxTokens: 140,
        });
        if (result.say) text = result.say;
      } catch {
        // liste brute
      }
    }
    this.chronicleLog.append({ t: Date.now(), day, kind: 'chronicle', text });
    this.data.lastChronicle = { day, text };
    await this.arena?.command?.('city-proclaim', { text: text.slice(0, 240), announce: 0 }).catch(() => {});
  }

  // ---------- Commandes du chat ----------

  async command(player, event, text) {
    const lang = this.lang;
    const [rawName, ...args] = text.slice(1).trim().split(/\s+/);
    const name = fold(rawName);
    const nearest = this.activeNpcs()
      .filter((n) => n.position)
      .map((n) => ({ n, d: Math.hypot(n.position.x - event.x, n.position.z - event.z) }))
      .sort((a, b) => a.d - b.d)[0];
    const close = nearest && nearest.d < 8 ? nearest.n : null;
    const reply = (t) => this.whisper(event, t);
    switch (name) {
      case 'aide':
      case 'help':
        return reply(lang === 'en'
          ? 'Talk to inhabitants in chat (walk up to them or start with their name). Commands: !journal, !saga, !work, !accept N, !turnin, !prices, !buy N item, !sell, !renown, !who, !rumours, !time, !fine'
          : 'Parlez aux habitants dans le chat (approchez-vous ou commencez par leur prénom). Commandes : !journal, !saga, !contrats, !accepter N, !rendre, !prix, !acheter N objet, !vendre, !renommee, !qui, !rumeurs, !heure, !amende');
      case 'journal':
      case 'quetes':
      case 'quests': {
        const active = player.quests.filter((q) => q.state !== 'done');
        if (!active.length) return reply(lang === 'en' ? 'No job in progress. Ask the inhabitants for work.' : 'Aucun travail en cours. Demandez du travail aux habitants.');
        return reply(active.map((q) => `${q.title} (${this.npcs.get(q.giver)?.name.split(' ')[0]}) : ${q.state === 'ready' ? (lang === 'en' ? 'done, return to the giver' : 'terminé, retournez voir le donneur') : this.questProgress(q)}`).join(' | '));
      }
      case 'saga': {
        const step = this.sagaStep(player);
        const chapter = sagaChapter(player.saga.chapter);
        if (!chapter) return reply(lang === 'en' ? `Chapters completed: ${player.saga.done.length}/${SAGA.length}.` : `Chapitres accomplis : ${player.saga.done.length}/${SAGA.length}.`);
        return reply(`${chapter.title} — ${step.text}${step.count > 1 ? ` (${player.saga.progress}/${step.count})` : ''}`);
      }
      case 'contrats':
      case 'work':
      case 'travail': {
        if (!close) return reply(lang === 'en' ? 'Walk up to an inhabitant first.' : "Approchez-vous d'abord d'un habitant.");
        const offers = this.data.offers[close.key] || [];
        this.conversations.set(player.account, { npc: close.key, t: Date.now(), offersShownAt: Date.now() });
        return reply(offers.length ? offers.map((o, i) => `[${i + 1}] ${o.title} — ${this.describeOffer(o)} (${o.coins})`).join(' | ') : `${close.name} : ${lang === 'en' ? 'no work today.' : "pas de travail aujourd'hui."}`);
      }
      case 'accepter':
      case 'accept': {
        const convo = this.conversations.get(player.account);
        const giver = convo && this.npcs.get(convo.npc);
        const offer = giver && (this.data.offers[giver.key] || [])[Math.max(0, Number(args[0] || 1) - 1)];
        if (!offer) return reply(lang === 'en' ? 'Use !work next to an inhabitant first.' : "Utilisez d'abord !contrats près d'un habitant.");
        return reply(this.acceptOffer(player, offer));
      }
      case 'abandonner':
      case 'abandon': {
        const active = player.quests.filter((q) => q.state !== 'done');
        const quest = active[Math.max(0, Number(args[0] || 1) - 1)];
        if (!quest) return reply(lang === 'en' ? 'No such job.' : 'Ce travail n’existe pas.');
        player.quests = player.quests.filter((q) => q !== quest);
        const giver = this.npcs.get(quest.giver);
        if (giver) adjustAffinity(giver, player.account, -4);
        return reply(`${lang === 'en' ? 'Abandoned' : 'Abandonné'} : ${quest.title}`);
      }
      case 'rendre':
      case 'turnin': {
        if (!close) return reply(lang === 'en' ? 'Walk up to the giver first.' : "Approchez-vous d'abord du donneur.");
        const facts = await this.turnInReady(player, close, event.peer, true);
        return reply(facts.length ? facts.join(' | ') : lang === 'en' ? 'Nothing to turn in here.' : 'Rien à rendre ici.');
      }
      case 'prix':
      case 'prices':
      case 'acheter':
      case 'buy':
      case 'vendre':
      case 'sell': {
        if (!close || !this.shopOf(close)) return reply(lang === 'en' ? 'Walk up to a merchant first.' : "Approchez-vous d'abord d'un marchand.");
        const extra = [];
        const intents = { prices: ['prix', 'prices'].includes(name), buy: ['acheter', 'buy'].includes(name), sell: ['vendre', 'sell'].includes(name), number: Number(args.find((a) => /^\d+$/.test(a))) || null };
        const facts = await this.trade(close, player, event, args.join(' '), intents, extra);
        return reply([...extra, ...facts].join(' | '));
      }
      case 'renommee':
      case 'reputation':
      case 'renown':
        return reply(`${titleFor(player.renown, lang)} — ${player.renown} ${lang === 'en' ? 'renown' : 'renommée'} | ${Object.entries(player.reputation).map(([f, v]) => `${FACTIONS[f]?.[lang] || f} ${v}`).join(', ') || '—'}`);
      case 'qui':
      case 'who': {
        if (!close) return reply(lang === 'en' ? 'Nobody nearby.' : 'Personne à proximité.');
        const m = mood(close, lang);
        return reply(`${close.name}, ${close.title[lang]} — ${m.label}${m.cause ? ` (${m.cause})` : ''}. ${close.story}`);
      }
      case 'rumeurs':
      case 'rumours':
      case 'news':
        return reply(this.data.news.slice(-4).map((n) => n.text).join(' | ') || (lang === 'en' ? 'No news.' : 'Aucune nouvelle.'));
      case 'heure':
      case 'time': {
        const clock = clockOf(this.bridge.state?.game);
        const cal = calendar(clock.day);
        return reply(`${lang === 'en' ? 'Day' : 'Jour'} ${clock.day}, ${clock.label}${cal.holy ? (lang === 'en' ? ' — holy day' : ' — jour sacré') : ''}${cal.market ? (lang === 'en' ? ' — market day' : ' — jour du marché') : ''}${cal.festival ? (lang === 'en' ? ' — mead festival' : ' — fête de l’hydromel') : ''}`);
      }
      case 'amende':
      case 'fine': {
        if (!(player.wanted > Date.now())) return reply(lang === 'en' ? 'You are not wanted.' : "Vous n'êtes pas recherché.");
        const counter = this.data.counters[stableHash('castle')];
        if (await this.takeFromCounter('castle', counter, [['Coins', player.bounty || 150]])) {
          player.wanted = 0;
          player.bounty = 0;
          return reply(lang === 'en' ? 'Fine paid. The guard lets it go… this time.' : "Amende payée. La garde passe l'éponge… pour cette fois.");
        }
        return reply(lang === 'en' ? `Put ${player.bounty || 150} coins in the castle chest, then type !fine.` : `Déposez ${player.bounty || 150} pièces dans le coffre du château, puis tapez !amende.`);
      }
      default:
        return null;
    }
  }

  // ---------- API du panel ----------

  status() {
    const state = this.bridge.state;
    return {
      online: this.bridge.online,
      settings: { ...this.settings, ai: { ...this.settings.ai, apiKey: this.settings.ai.apiKey ? '••••' : '' } },
      clock: state?.game ? { ...clockOf(state.game), calendar: calendar(state.game.day) } : null,
      tier: worldTier(state?.keys || []),
      keys: state?.keys || [],
      npcs: this.npcs.size,
      spots: this.spots.length,
      players: (state?.players || []).length,
      ai: { available: this.ai.available, ...this.ai.stats, busy: this.ai.busy },
      news: this.data.news.slice(-12).reverse(),
      chronicle: this.data.lastChronicle || null,
    };
  }

  npcList() {
    return [...this.npcs.values()].map((npc) => {
      const m = mood(npc, this.lang);
      return {
        key: npc.key,
        name: npc.name,
        title: npc.title[this.lang],
        faction: npc.faction,
        body: npc.body,
        absent: npc.absent,
        dead: npc.deadUntil > Date.now(),
        mood: m,
        needs: npc.mind.needs,
        emotions: npc.mind.emotions,
        activity: npc.current.activity,
        place: npc.current.place,
        position: npc.position,
        offers: (this.data.offers[npc.key] || []).length,
        shop: npc.shop || null,
        relations: Object.keys(npc.relations || {}).length,
      };
    });
  }

  npcDetail(key) {
    const npc = this.npcs.get(key);
    if (!npc) return null;
    const { relations_def: relationsDef, ...rest } = npc;
    return {
      ...rest,
      relationsDef,
      mood: mood(npc, this.lang),
      offers: this.data.offers[key] || [],
      relations: Object.entries(npc.relations || {}).map(([account, r]) => ({ account, name: this.data.players[account]?.name || account, ...r, history: undefined })),
    };
  }

  playerList() {
    return Object.values(this.data.players).map((p) => ({
      account: p.account,
      name: p.name,
      title: titleFor(p.renown, this.lang),
      renown: p.renown,
      reputation: p.reputation,
      quests: p.quests.filter((q) => q.state !== 'done').length,
      done: p.stats.quests,
      saga: { done: p.saga.done.length, chapter: sagaChapter(p.saga.chapter)?.title || null, step: this.sagaStep(p)?.text || null },
      wanted: p.wanted > Date.now(),
      lastSeen: p.lastSeen,
      online: (this.bridge.state?.players || []).some((x) => (x.account || x.player) === p.account),
    }));
  }

  economySummary() {
    const economy = this.data.economy;
    return Object.entries(SHOPS).map(([key, shop]) => ({
      key,
      owner: [...this.npcs.values()].find((n) => n.shop === key)?.name || key,
      gold: Math.floor(economy.shops[key].gold),
      sold: economy.shops[key].sold,
      bought: economy.shops[key].bought,
      goods: Object.keys(shop.sells).map((item) => ({ item, name: this.itemName(item), stock: Math.floor(economy.shops[key].stock[item] || 0), target: shop.sells[item], price: sellPrice(economy, key, item) })),
      supply: Object.entries(economy.shops[key].supply).filter(([, v]) => v >= 1).map(([item, v]) => ({ item, name: this.itemName(item), amount: Math.floor(v) })),
    }));
  }

  async updateSettings(patch) {
    const current = this.settings;
    const ai = { ...current.ai, ...(patch.ai || {}) };
    if (patch.ai && patch.ai.apiKey === '••••') ai.apiKey = current.ai.apiKey;
    this.data.settings = { ...current, ...patch, ai };
    this.ai.configure(ai);
    this.syncDirty = true;
    await this.store.flush();
    return this.status();
  }

  async updateNpc(key, patch) {
    const npc = this.npcs.get(key);
    if (!npc) return null;
    const allowed = ['name', 'speech', 'story', 'secret', 'wants', 'likes', 'dislikes', 'body', 'traits', 'title'];
    const override = this.data.overrides[key] || {};
    for (const field of allowed) if (patch[field] !== undefined) override[field] = npc[field] = patch[field];
    this.data.overrides[key] = override;
    if (patch.resetMind) {
      npc.mind = newMind(npc.traits);
      npc.memories = [];
      npc.relations = {};
    }
    this.syncDirty = true;
    this.store.touch();
    return this.npcDetail(key);
  }

  // Test du dialogue sans le jeu : un faux joueur parle à un habitant ; renvoie la réplique produite.
  async simulate(key, text, playerName = 'Testeur') {
    const npc = this.npcs.get(key);
    if (!npc) return null;
    const player = this.player({ account: `panel:${playerName}`, player: playerName });
    const original = this.say.bind(this);
    const lines = [];
    this.say = async (who, line) => {
      lines.push({ npc: who.name, text: line });
    };
    try {
      await this.converse(npc, player, { peer: 0, x: 0, y: 0, z: 0 }, text);
    } finally {
      this.say = original;
    }
    return { lines, mood: mood(npc, this.lang), affinity: relationWith(npc, player.account).affinity };
  }

  async speak(key, text, mode = 'say') {
    const npc = this.npcs.get(key);
    if (!npc) return null;
    await this.say(npc, text, { mode });
    return true;
  }

  async conversationTail(count = 100) {
    return this.conversationLog.tail(count);
  }

  async chronicle(count = 60) {
    return this.chronicleLog.tail(count);
  }
}

// Humeur de départ : les soucis secrets des habitants se lisent dès le premier jour.
function seedMind(def) {
  const mind = newMind(def.traits);
  const initial = def.initialMood || {};
  for (const [emotion, value] of Object.entries(initial)) if (emotion in mind.emotions) mind.emotions[emotion] = value;
  if (initial.cause) {
    const main = Object.entries(initial).filter(([k]) => k in mind.emotions).sort((a, b) => b[1] - a[1])[0];
    if (main) mind.cause = { emotion: main[0], text: initial.cause, t: Date.now() };
  }
  return mind;
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
