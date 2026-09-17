// Vie collective de la cité : raids nocturnes, caravanes, fêtes, primes de chasse et deuils.
//
// Un événement est une petite histoire qui se joue toute seule : elle s'annonce (crieur, bandeau), dure un
// moment, réagit à ce que font les joueurs, puis se conclut — en récompense ou en mauvaise nouvelle. Les
// créatures sont invoquées par la console du serveur (RCON), donc rien à installer côté joueur.
import { clamp, pick } from './util.js';

// Ce qui rôde autour de la cité selon l'avancement du monde (les Réprouvés déjà vaincus).
export const RAID_WAVES = [
  { tier: 0, prefabs: ['Greyling', 'Boar'], count: [4, 6], level: 1, name: { fr: 'des greylings', en: 'greylings' } },
  { tier: 1, prefabs: ['Greydwarf', 'Greyling'], count: [5, 8], level: 1, name: { fr: 'une bande de greydwarfs', en: 'a greydwarf pack' } },
  { tier: 2, prefabs: ['Greydwarf_Elite', 'Greydwarf_Shaman'], count: [4, 6], level: 2, name: { fr: 'des greydwarfs anciens', en: 'elder greydwarves' } },
  { tier: 3, prefabs: ['Draugr', 'Draugr_Elite'], count: [5, 7], level: 2, name: { fr: 'des draugrs sortis des marais', en: 'draugr from the swamps' } },
  { tier: 4, prefabs: ['Wolf', 'Fenring'], count: [5, 7], level: 2, name: { fr: 'une meute descendue des montagnes', en: 'a pack from the mountains' } },
  { tier: 5, prefabs: ['Goblin', 'GoblinBrute'], count: [6, 9], level: 2, name: { fr: 'un raid de fulings', en: 'a fuling raid' } },
  { tier: 6, prefabs: ['Seeker', 'SeekerBrute'], count: [4, 6], level: 2, name: { fr: 'des chercheurs venus des brumes', en: 'seekers from the mist' } },
  { tier: 7, prefabs: ['Charred_Melee', 'Charred_Archer'], count: [5, 8], level: 2, name: { fr: 'des calcinés des Terres cendrées', en: 'the charred of the Ashlands' } },
];

// Bêtes mises à prix : une créature marquée, plus forte que la normale, quelque part autour de la cité.
export const BOUNTIES = [
  { tier: 0, prefab: 'Boar', level: 3, fr: 'un sanglier balafré', en: 'a scarred boar', coins: 60 },
  { tier: 1, prefab: 'Troll', level: 1, fr: 'un troll solitaire', en: 'a lone troll', coins: 120 },
  { tier: 2, prefab: 'Troll', level: 2, fr: 'un troll des cavernes', en: 'a cave troll', coins: 180 },
  { tier: 3, prefab: 'Draugr_Elite', level: 3, fr: 'un seigneur draugr', en: 'a draugr lord', coins: 220 },
  { tier: 4, prefab: 'Fenring', level: 3, fr: 'un fenring hurlant', en: 'a howling fenring', coins: 280 },
  { tier: 5, prefab: 'GoblinBrute', level: 3, fr: 'une brute fuling', en: 'a fuling brute', coins: 340 },
  { tier: 6, prefab: 'SeekerBrute', level: 2, fr: 'un chercheur colossal', en: 'a colossal seeker', coins: 420 },
  { tier: 7, prefab: 'Charred_Twitcher', level: 3, fr: 'un calciné enragé', en: 'a raging charred', coins: 500 },
];

// Butin d'un coffre au trésor, selon l'avancement du monde.
export const TREASURES = [
  { tier: 0, items: [['Coins', 120], ['Amber', 3], ['CookedMeat', 5]] },
  { tier: 1, items: [['Coins', 200], ['Amber', 5], ['Bronze', 5], ['MeadHealthMinor', 2]] },
  { tier: 2, items: [['Coins', 300], ['AmberPearl', 3], ['Iron', 5], ['MeadStaminaMinor', 3]] },
  { tier: 3, items: [['Coins', 450], ['Ruby', 3], ['Silver', 4], ['MeadPoisonResist', 2]] },
  { tier: 4, items: [['Coins', 600], ['Ruby', 5], ['Silver', 8], ['MeadFrostResist', 2]] },
  { tier: 5, items: [['Coins', 800], ['Coins', 200], ['BlackMetal', 6], ['MeadStaminaLingering', 2]] },
  { tier: 6, items: [['Coins', 1000], ['Eitr', 10], ['BlackMetal', 10], ['MeadHealthMedium', 3]] },
  { tier: 7, items: [['Coins', 1400], ['Eitr', 20], ['FlametalNew', 6], ['MeadHealthMedium', 4]] },
];

const MINUTE = 60000;

export class EventDirector {
  constructor(engine) {
    this.engine = engine;
  }

  get data() {
    return this.engine.data;
  }

  get lang() {
    return this.engine.lang;
  }

  get current() {
    return this.data.event || null;
  }

  // Résumé pour le panel et le portail.
  status() {
    const event = this.current;
    if (!event) return null;
    return {
      id: event.id,
      title: event.title,
      text: event.text,
      since: event.started,
      until: event.until,
      progress: event.goal ? { done: event.killed || 0, total: event.goal } : null,
    };
  }

  // Appelé à chaque tour du moteur : lance, fait vivre et conclut les événements.
  async tick(state, clock) {
    const event = this.current;
    if (event) {
      if (Date.now() >= event.until) await this.finish(event, state);
      else await this.during(event, state, clock);
      return;
    }
    if (!this.engine.settings.events) return;
    await this.maybeStart(state, clock);
  }

  async maybeStart(state, clock) {
    const players = state.players || [];
    const day = clock.day;
    const since = (key) => day - (this.data.lastEvent?.[key] ?? -99);
    const roll = this.engine.random;
    const night = clock.fraction > 0.78 || clock.fraction < 0.22;
    const calendar = this.engine.calendarOf(day);

    if (calendar.festival && !night && since('fete') >= 1) return this.startFestival(clock);
    if (calendar.market && clock.fraction > 0.24 && clock.fraction < 0.5 && since('caravane') >= 1) return this.startCaravan(clock);
    if (players.length && night && since('raid') >= 2 && roll() < 0.4) return this.startRaid(state, clock);
    if (since('prime') >= 3 && !night && roll() < 0.35) return this.startBounty(clock);
    if (players.length && !night && since('tournoi') >= 4 && roll() < 0.3) return this.startTourney(clock);
    if (players.length && since('tresor') >= 2 && roll() < 0.3) return this.startTreasure(clock);
    return null;
  }

  // Déclenchement à la main depuis le panel (pour une soirée entre amis, ou pour montrer le monde).
  async trigger(id, state, clock) {
    if (this.current) await this.finish(this.current, state);
    switch (id) {
      case 'raid': return this.startRaid(state, clock);
      case 'caravane': return this.startCaravan(clock);
      case 'fete': return this.startFestival(clock);
      case 'prime': return this.startBounty(clock);
      case 'tresor': return this.startTreasure(clock);
      case 'tournoi': return this.startTourney(clock);
      default: return null;
    }
  }

  begin(id, { title, text, minutes = 10, goal = 0, extra = {} }) {
    const day = this.engine.data.day ?? 0;
    this.data.lastEvent = { ...(this.data.lastEvent || {}), [id]: day };
    this.data.event = { id, title, text, started: Date.now(), until: Date.now() + minutes * MINUTE, goal, killed: 0, helpers: {}, ...extra };
    this.engine.addNews(text, 4, `event:${id}`);
    this.engine.syncDirty = true;
    this.engine.store.touch();
    return this.data.event;
  }

  // ---------- Raid ----------

  async startRaid(state, clock) {
    const tier = this.engine.tier;
    const wave = [...RAID_WAVES].reverse().find((w) => w.tier <= tier) || RAID_WAVES[0];
    const guarded = this.data.flags?.projet_garde ? 0.65 : 1;
    const count = Math.max(3, Math.round(clamp(wave.count[0] + this.engine.random() * (wave.count[1] - wave.count[0]), 3, 12) * guarded));
    const gate = pick(this.engine.spotsOf('outskirts'), this.engine.random) || pick(this.engine.spotsOf('guard'), this.engine.random);
    if (!gate) return null;
    // Les bêtes arrivent juste devant la porte : ce sol-là est connu et plat, elles ne tombent ni ne s'enterrent.
    const plan = this.engine.plan;
    const angle = Math.atan2(gate.z - (plan?.center?.[1] ?? 0), gate.x - (plan?.center?.[0] ?? 0));
    const at = { x: Math.round(gate.x + Math.cos(angle) * 6), y: Math.round(gate.y + 2), z: Math.round(gate.z + Math.sin(angle) * 6) };
    const groundAtGate = await this.engine.groundAt(at.x, at.z);
    if (groundAtGate != null) at.y = Math.round(groundAtGate + 1);
    const lang = this.lang;
    const name = wave.name[lang] || wave.name.fr;
    const text = lang === 'en' ? `Horns on the walls: ${name} are coming for Spokaheim!` : `Les cors sonnent sur les remparts : ${name} marchent sur Spokaheim !`;
    const event = this.begin('raid', {
      title: lang === 'en' ? 'Raid on the city' : 'Raid sur la cité',
      text,
      minutes: 8,
      goal: count,
      extra: { prefabs: wave.prefabs, gate: { x: gate.x, y: gate.y, z: gate.z } },
    });
    for (const [index, prefab] of wave.prefabs.entries()) {
      const share = index === 0 ? Math.ceil(count * 0.6) : Math.max(1, Math.floor(count * 0.4));
      await this.engine.spawn(prefab, at, { count: share, level: wave.level, radius: 12 });
    }
    await this.engine.bridge.send('message', { text, corner: false });
    await this.engine.shout('arne', text);
    this.rally(event);
    return event;
  }

  // Les gardes quittent leur poste et se massent à la porte menacée.
  rally(event) {
    if (!event.gate) return;
    const until = event.until;
    for (const npc of this.engine.activeNpcs()) {
      if (npc.faction !== 'garde') continue;
      npc.override = { target: [event.gate.x, event.gate.y, event.gate.z], until, activity: 'guard' };
    }
    this.engine.syncDirty = true;
  }

  async during(event, state) {
    if (event.id === 'raid') {
      if (event.goal && event.killed >= event.goal) await this.finish(event, state);
      return;
    }
    // Trésor : le premier qui arrive sur place a trouvé la cachette.
    if (event.id === 'tresor' && event.at && !event.claimed) {
      for (const p of state.players || []) {
        if (Math.hypot(p.x - event.at.x, p.z - event.at.z) > 14) continue;
        const player = this.engine.player(p);
        event.claimed = player.account;
        const lang = this.lang;
        await this.engine.reward(player, p.peer, { renown: 25, faction: 'peuple', label: lang === 'en' ? 'Treasure found' : 'Trésor découvert' });
        this.engine.addNews(lang === 'en' ? `${player.name} found the hidden chest.` : `${player.name} a trouvé le coffre caché.`, 3, 'tresor', player.account);
        await this.engine.shout('solveig', lang === 'en' ? `${player.name} found the chest! The mead is on the house tonight.` : `${player.name} a trouvé le coffre ! L'hydromel est offert ce soir.`);
        event.until = Math.min(event.until, Date.now() + MINUTE);
        this.engine.store.touch();
        break;
      }
    }
  }

  // Compte les bêtes du raid abattues et retient qui a aidé.
  onKill(event, player) {
    const current = this.current;
    if (!current || current.id !== 'raid') return;
    if (!current.prefabs?.some((p) => String(event.prefab || '').startsWith(p))) return;
    current.killed = (current.killed || 0) + 1;
    if (player) current.helpers[player.account] = (current.helpers[player.account] || 0) + 1;
    this.engine.store.touch();
  }

  // ---------- Caravane, fête, prime ----------

  async startCaravan(clock) {
    const lang = this.lang;
    const economy = this.data.economy;
    for (const shop of Object.values(economy.shops)) {
      for (const item of Object.keys(shop.stock)) shop.stock[item] = (shop.stock[item] || 0) + 4;
      shop.gold += 150;
    }
    this.data.priceBonus = { until: Date.now() + 30 * MINUTE, factor: 0.9 };
    const text = lang === 'en'
      ? 'A caravan of traders has reached the portal square: full stalls and softer prices until nightfall.'
      : 'Une caravane de marchands est arrivée sur la place des portails : étals pleins et prix adoucis jusqu’au soir.';
    const event = this.begin('caravane', { title: lang === 'en' ? 'The caravan' : 'La caravane', text, minutes: 30 });
    await this.engine.shout('arne', text);
    return event;
  }

  async startFestival(clock) {
    const lang = this.lang;
    const text = lang === 'en'
      ? 'The mead festival begins! Free horns at the Great Mead Hall, and Leif is already tuning his lute.'
      : 'La fête de l’hydromel commence ! Cornes offertes à la Grande Brasserie, et Leif accorde déjà son luth.';
    const event = this.begin('fete', { title: lang === 'en' ? 'Mead festival' : 'Fête de l’hydromel', text, minutes: 25 });
    await this.engine.shout('arne', text);
    for (const p of this.engine.onlinePlayers()) {
      await this.engine.bridge.send('give', { peer: p.peer, items: [['MeadTasty', 2]] });
      await this.engine.bridge.send('message', { peers: [p.peer], text: lang === 'en' ? 'Solveig hands you two horns of mead.' : 'Solveig te tend deux cornes d’hydromel.', corner: true });
    }
    return event;
  }

  async startBounty(clock) {
    const tier = this.engine.tier;
    const bounty = [...BOUNTIES].reverse().find((b) => b.tier <= tier) || BOUNTIES[0];
    const plan = this.engine.plan;
    const center = plan?.center || [0, 0];
    const angle = this.engine.random() * Math.PI * 2;
    const distance = 180 + this.engine.random() * 120;
    const at = { x: Math.round(center[0] + Math.cos(angle) * distance), y: Math.round((plan?.spawn?.[1] ?? 30) + 25), z: Math.round(center[1] + Math.sin(angle) * distance) };
    // Si la carte du monde est là, la bête est posée sur le sol plutôt que lâchée du ciel.
    const ground = await this.engine.groundAt(at.x, at.z);
    if (ground != null) at.y = Math.round(ground + 1);
    const lang = this.lang;
    const beast = bounty[lang] || bounty.fr;
    const heading = compass(angle, lang);
    const text = lang === 'en'
      ? `A bounty is posted: ${beast} prowls ${heading} of the walls. ${bounty.coins} coins to whoever brings it down.`
      : `Une prime est affichée : ${beast} rôde ${heading} des murs. ${bounty.coins} pièces à qui l’abattra.`;
    const event = this.begin('prime', {
      title: lang === 'en' ? 'Bounty' : 'Prime de chasse',
      text,
      minutes: 45,
      extra: { prefab: bounty.prefab, coins: bounty.coins, at },
    });
    await this.engine.spawn(bounty.prefab, at, { count: 1, level: bounty.level, radius: 4 });
    await this.engine.shout('ivar', text);
    return event;
  }

  // Trésor : un coffre bien réel, caché sur la terre ferme, et une indication de direction.
  async startTreasure() {
    const engine = this.engine;
    const center = engine.plan?.center || [0, 0];
    let spot = null;
    for (let i = 0; i < 40 && !spot; i++) {
      const angle = engine.random() * Math.PI * 2;
      const distance = 200 + engine.random() * 400;
      const x = Math.round(center[0] + Math.cos(angle) * distance);
      const z = Math.round(center[1] + Math.sin(angle) * distance);
      const y = await engine.groundAt(x, z);
      if (y != null && y > 31 && y < 250) spot = { x, y: Math.round((y + 0.3) * 10) / 10, z, angle, distance };
    }
    if (!spot) return null;
    const loot = [...TREASURES].reverse().find((t) => t.tier <= engine.tier) || TREASURES[0];
    const out = await engine.rconText(`spawn piece_chest_wood ${spot.x} ${spot.y} ${spot.z} -tag tresor_cite`);
    const chestId = String(out || '').match(/Id: (\d+:-?\d+)/)?.[1];
    if (chestId) {
      for (const [item, count] of loot.items) await engine.rconText(`addItemToContainer ${chestId} ${item} -count ${count} -quality 1 -force`);
    }
    const lang = this.lang;
    const heading = compass(spot.angle, lang);
    const steps = Math.round(spot.distance / 25) * 25;
    const text = lang === 'en'
      ? `An old map has surfaced at the mead hall: a chest lies about ${steps} m ${heading} of the city.`
      : `Une vieille carte a refait surface à la brasserie : un coffre dort à environ ${steps} m ${heading} de la cité.`;
    const event = this.begin('tresor', {
      title: lang === 'en' ? 'Treasure map' : 'Carte au trésor',
      text,
      minutes: 60,
      extra: { at: { x: spot.x, y: spot.y, z: spot.z }, chestId },
    });
    await this.engine.shout('solveig', text);
    return event;
  }

  // Tournoi : l'arène est ouverte et la gloire compte double pendant une heure.
  async startTourney() {
    const lang = this.lang;
    const text = lang === 'en'
      ? 'Ragna opens the arena: fights are free today and glory counts double until dusk.'
      : 'Ragna ouvre l’arène : les combats sont offerts aujourd’hui et la gloire compte double jusqu’au soir.';
    const event = this.begin('tournoi', { title: lang === 'en' ? 'Arena tourney' : 'Tournoi d’arène', text, minutes: 45 });
    await this.engine.shout('ragna', text);
    return event;
  }

  // La prime est réclamée dès que la bête tombe, où qu'elle soit.
  async onBountyKill(event, player, peer) {
    const current = this.current;
    if (!current || current.id !== 'prime' || current.claimed) return false;
    if (!String(event.prefab || '').startsWith(current.prefab)) return false;
    current.claimed = player?.account || true;
    if (player) {
      await this.engine.reward(player, peer, { coins: current.coins, renown: Math.round(current.coins / 4), faction: 'peuple', label: this.lang === 'en' ? 'Bounty claimed' : 'Prime de chasse' });
      this.engine.addNews(this.lang === 'en' ? `${player.name} claimed the bounty.` : `${player.name} a touché la prime de chasse.`, 3, 'prime', player.account);
    }
    current.until = Math.min(current.until, Date.now() + MINUTE);
    return true;
  }

  // ---------- Fin ----------

  async finish(event, state) {
    const lang = this.lang;
    this.data.event = null;
    for (const npc of this.engine.activeNpcs()) if (npc.override?.until <= Date.now()) npc.override = null;
    if (event.id === 'raid') {
      const won = (event.killed || 0) >= Math.ceil(event.goal * 0.7);
      const helpers = Object.entries(event.helpers || {}).sort((a, b) => b[1] - a[1]);
      if (won) {
        const text = lang === 'en' ? 'The raid is broken. Spokaheim stands, and the guard drinks to the Chosen.' : 'Le raid est brisé. Spokaheim tient debout, et la garde boit à la santé des Élus.';
        this.engine.addNews(text, 4, 'raid');
        await this.engine.shout('hrolf', text);
        for (const [account, kills] of helpers) {
          const player = this.data.players[account];
          if (!player) continue;
          await this.engine.reward(player, this.engine.peerOf(account), {
            coins: 30 + kills * 10,
            renown: 15 + kills * 3,
            faction: 'garde',
            label: lang === 'en' ? 'Defence of the city' : 'Défense de la cité',
          });
        }
      } else {
        const text = lang === 'en' ? 'The beasts wandered off at dawn. The walls bear new scars, and the guard is grim.' : 'Les bêtes se sont dispersées à l’aube. Les murs portent de nouvelles entailles, et la garde fait grise mine.';
        this.engine.addNews(text, 3, 'raid');
        for (const npc of this.engine.activeNpcs()) if (npc.faction === 'garde') this.engine.upset(npc, 'sadness', 0.3, lang === 'en' ? 'the city was raided' : 'la cité a été attaquée');
      }
    }
    if (event.id === 'tresor' && !event.claimed) {
      this.engine.addNews(lang === 'en' ? 'Nobody followed the old map. The chest is still out there.' : 'Personne n’a suivi la vieille carte. Le coffre dort toujours quelque part.', 2, 'tresor');
    }
    if (event.id === 'prime' && !event.claimed) {
      this.engine.addNews(lang === 'en' ? 'The bounty expired: the beast is still out there.' : 'La prime a expiré : la bête court toujours.', 2, 'prime');
    }
    this.engine.syncDirty = true;
    this.engine.store.touch();
  }
}

function compass(angle, lang) {
  const names = lang === 'en'
    ? ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']
    : ['à l’est', 'au sud-est', 'au sud', 'au sud-ouest', 'à l’ouest', 'au nord-ouest', 'au nord', 'au nord-est'];
  const index = Math.round(((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 4)) % 8;
  return names[index];
}
