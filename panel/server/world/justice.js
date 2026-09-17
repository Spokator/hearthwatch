// La justice de Spokaheim : ce qui arrive quand un Élu se conduit mal dans les murs.
//
// Frapper un habitant, en tuer un, vider un coffre de la cité : la garde voit, avertit, puis sévit. L'escalade
// est lente et lisible — avertissement, amende, gardes lâchés aux trousses, pilori, cachot — et l'Empereur peut
// toujours gracier. Rien n'est arbitraire : chaque peine a une durée, une raison publique et une sortie.
import { adjustAffinity, appraise, remember } from './mind.js';
import { pick } from './util.js';

// Gravité des délits : ce que ça coûte, et ce que la garde en pense.
export const CRIMES = {
  coup: {
    fr: 'coups portés à un habitant',
    en: 'striking an inhabitant',
    bounty: 60,
    renown: -8,
    weight: 1,
  },
  meurtre: {
    fr: 'meurtre d’un habitant',
    en: 'murder of an inhabitant',
    bounty: 300,
    renown: -40,
    weight: 4,
  },
  vol: {
    fr: 'vol dans un coffre de la cité',
    en: 'theft from a city chest',
    bounty: 120,
    renown: -15,
    weight: 2,
  },
};

const MINUTE = 60000;

export class Justice {
  constructor(engine) {
    this.engine = engine;
    this.hunts = new Map(); // compte → moment où la garde a été lâchée
  }

  get lang() {
    return this.engine.lang;
  }

  record(player) {
    player.justice = player.justice || { crimes: 0, weight: 0, last: 0, history: [] };
    return player.justice;
  }

  // Un délit constaté : on avertit, on met à prix, et au-delà d'un seuil la garde se met en chasse.
  async offence(player, kind, { npc = null, peer = null } = {}) {
    if (!player || !CRIMES[kind]) return null;
    const lang = this.lang;
    const crime = CRIMES[kind];
    const record = this.record(player);
    record.crimes++;
    record.weight += crime.weight;
    record.last = Date.now();
    record.history = [{ kind, at: Date.now(), day: this.engine.data.day, npc: npc?.key || null }, ...record.history].slice(0, 20);
    player.bounty = (player.bounty || 0) + crime.bounty;
    player.renown = Math.max(0, player.renown + crime.renown);
    player.reputation.garde = (player.reputation.garde || 0) - crime.weight * 5;
    const label = crime[lang] || crime.fr;

    // Les habitants s'en souviennent et s'en méfient.
    for (const other of this.engine.activeNpcs()) {
      adjustAffinity(other, player.account, -6 * crime.weight);
      if (other.faction === 'garde') appraise(other, 'anger', 0.3, lang === 'en' ? `${player.name}: ${label}` : `${player.name} : ${label}`);
    }
    if (npc) remember(npc, lang === 'en' ? `${player.name} attacked me.` : `${player.name} m'a attaqué.`, { importance: 5, about: [player.account], shareable: true });

    const guard = this.nearestGuard(player) || this.engine.npcs.get('hrolf');
    if (record.weight <= 1) {
      // Premier écart : un simple avertissement.
      if (guard && peer)
        await this.engine.say(guard, lang === 'en'
          ? `Easy, ${player.name}. One more and you answer to the captain.`
          : `Doucement, ${player.name}. Encore une et tu auras affaire au capitaine.`, { peers: [peer] });
      return { warning: true, label };
    }

    // Au-delà, le joueur est recherché : amende à payer, et la garde a l'ordre de l'arrêter.
    player.wanted = Date.now() + 30 * MINUTE;
    this.engine.addNews(lang === 'en'
      ? `${player.name} is wanted by the guard: ${label}. Bounty ${player.bounty} coins.`
      : `${player.name} est recherché par la garde : ${label}. Amende ${player.bounty} pièces.`, 4, 'justice', player.account);
    if (guard) await this.engine.shout(guard.key, lang === 'en' ? `Guards! ${player.name} is an outlaw!` : `Gardes ! ${player.name} est hors-la-loi !`);
    if (peer)
      await this.engine.bridge.send('message', {
        peers: [peer],
        text: lang === 'en'
          ? `Wanted: ${label}. Pay ${player.bounty} coins in the castle chest and type !fine, or the guard will take you.`
          : `Recherché : ${label}. Dépose ${player.bounty} pièces dans le coffre du château puis tape !amende, sinon la garde t'emmènera.`,
        corner: false,
      });
    await this.unleash(player);
    if (kind === 'meurtre') await this.arrest(player, kind, peer);
    this.engine.store.touch();
    return { wanted: true, label };
  }

  nearestGuard(player) {
    const position = player.position;
    if (!position) return this.engine.activeNpcs().find((n) => n.faction === 'garde') || null;
    return this.engine
      .activeNpcs()
      .filter((n) => n.faction === 'garde' && n.position)
      .map((n) => ({ n, d: Math.hypot(n.position.x - position.x, n.position.z - position.z) }))
      .sort((a, b) => a.d - b.d)[0]?.n || null;
  }

  // La garde est lâchée : les gardes cessent d'être pacifiques et convergent vers le hors-la-loi.
  async unleash(player) {
    this.hunts.set(player.account, Date.now());
    const until = Date.now() + 10 * MINUTE;
    for (const npc of this.engine.activeNpcs()) {
      if (npc.faction !== 'garde') continue;
      await this.engine.bridge.send('npc-mood', { npc: npc.id, tamed: false, aggravated: true });
      if (player.position) npc.override = { target: [player.position.x, player.position.y, player.position.z], until, activity: 'guard' };
    }
    this.engine.syncDirty = true;
  }

  // La garde se calme : chacun retourne à son poste.
  async calm() {
    for (const npc of this.engine.activeNpcs()) {
      if (npc.faction !== 'garde') continue;
      await this.engine.bridge.send('npc-mood', { npc: npc.id, tamed: true, aggravated: false });
      npc.override = null;
    }
    this.engine.syncDirty = true;
  }

  // Le pilori sur la grand-place, ou les geôles du château pour les crimes de sang.
  place(kind) {
    const engine = this.engine;
    const plaza = engine.spotsOf('plaza')[0] || engine.spotsOf('work', 'plaza-crier')[0];
    const castle = engine.spotsOf('work', 'castle')[0] || engine.spotsOf('rest', 'castle-salon')[0] || plaza;
    const spot = kind === 'meurtre' ? castle : plaza;
    return spot ? { x: spot.x, y: spot.y, z: spot.z } : null;
  }

  async arrest(player, kind, peer = null) {
    const lang = this.lang;
    const at = this.place(kind);
    if (!at) return null;
    const minutes = kind === 'meurtre' ? 5 : 2;
    player.jail = { until: Date.now() + minutes * MINUTE, kind, at, since: Date.now() };
    const target = peer || this.engine.peerOf(player.account);
    if (target) {
      await this.engine.bridge.send('teleport', { peer: target, position: [at.x, at.y + 0.5, at.z] });
      await this.engine.bridge.send('message', {
        peers: [target],
        text: kind === 'meurtre'
          ? lang === 'en' ? `Arrested for murder. ${minutes} minutes in the castle gaol.` : `Arrêté pour meurtre. ${minutes} minutes dans les geôles du château.`
          : lang === 'en' ? `Taken to the pillory for ${minutes} minutes. The city is watching.` : `Conduit au pilori pour ${minutes} minutes. La cité te regarde.`,
        corner: false,
      });
    }
    const crier = this.engine.npcs.get('arne');
    if (crier)
      await this.engine.shout('arne', kind === 'meurtre'
        ? lang === 'en' ? `${player.name} is thrown in the gaol!` : `${player.name} est jeté aux geôles !`
        : lang === 'en' ? `${player.name} stands at the pillory! Let all see it.` : `${player.name} est au pilori ! Que chacun le voie.`);
    this.engine.addNews(lang === 'en' ? `${player.name} was arrested by the guard.` : `${player.name} a été arrêté par la garde.`, 4, 'justice', player.account);
    this.engine.store.touch();
    return player.jail;
  }

  // Chaque tour : on garde les condamnés à leur place, on libère ceux qui ont purgé, on calme la garde.
  async tick(state) {
    const lang = this.lang;
    let hunted = false;
    for (const p of state.players || []) {
      const player = this.engine.player(p);
      const jail = player.jail;
      if (jail && Date.now() < jail.until) {
        // Sortir du pilori ne suffit pas : la garde vous y ramène.
        if (Math.hypot(p.x - jail.at.x, p.z - jail.at.z) > 8)
          await this.engine.bridge.send('teleport', { peer: p.peer, position: [jail.at.x, jail.at.y + 0.5, jail.at.z] });
        continue;
      }
      if (jail) {
        player.jail = null;
        player.wanted = 0;
        player.bounty = 0;
        this.record(player).weight = 0;
        await this.engine.bridge.send('message', {
          peers: [p.peer],
          text: lang === 'en' ? 'Your sentence is served. Spokaheim forgives — this time.' : 'Ta peine est purgée. Spokaheim pardonne — pour cette fois.',
          corner: true,
        });
        const priest = this.engine.npcs.get('dagny');
        if (priest) await this.engine.say(priest, lang === 'en' ? 'Go, and keep the peace.' : 'Va, et tiens-toi tranquille.', { peers: [p.peer] });
        this.engine.store.touch();
        continue;
      }
      // Recherché : un garde tout près l'emmène.
      if (player.wanted > Date.now()) {
        hunted = true;
        const guard = this.nearestGuard(player);
        if (guard?.position && Math.hypot(guard.position.x - p.x, guard.position.z - p.z) < 6) {
          await this.engine.say(guard, lang === 'en' ? `You are coming with me.` : `Tu viens avec moi.`, { peers: [p.peer] });
          await this.arrest(player, this.record(player).weight >= 4 ? 'meurtre' : 'coup', p.peer);
        } else if (player.position) {
          for (const npc of this.engine.activeNpcs())
            if (npc.faction === 'garde') npc.override = { target: [p.x, p.y, p.z], until: Date.now() + 2 * MINUTE, activity: 'guard' };
        }
      }
    }
    // Plus personne à poursuivre : la garde retrouve son calme.
    if (!hunted && this.hunts.size) {
      const stillWanted = Object.values(this.engine.data.players).some((p) => p.wanted > Date.now());
      if (!stillWanted) {
        this.hunts.clear();
        await this.calm();
      }
    }
  }

  // Grâce impériale : la peine tombe, la garde se calme, la cité l'apprend.
  async pardon(player, by = null) {
    const lang = this.lang;
    if (!player) return null;
    player.wanted = 0;
    player.bounty = 0;
    player.jail = null;
    this.record(player).weight = 0;
    this.hunts.delete(player.account);
    await this.calm();
    this.engine.addNews(lang === 'en' ? `${by || 'The Crown'} pardoned ${player.name}.` : `${by || 'La Couronne'} a gracié ${player.name}.`, 3, 'justice', player.account);
    await this.engine.shout('arne', lang === 'en' ? `${player.name} is pardoned!` : `${player.name} est gracié !`);
    this.engine.store.touch();
    return true;
  }

  // Ce que la cité sait des hors-la-loi, pour le panel et le portail.
  status() {
    const lang = this.lang;
    return Object.values(this.engine.data.players)
      .filter((p) => p.wanted > Date.now() || p.jail || (p.justice?.crimes || 0) > 0)
      .map((p) => ({
        account: p.account,
        name: p.name,
        wanted: p.wanted > Date.now(),
        bounty: p.bounty || 0,
        jail: p.jail ? { until: p.jail.until, kind: p.jail.kind === 'meurtre' ? (lang === 'en' ? 'gaol' : 'cachot') : lang === 'en' ? 'pillory' : 'pilori' } : null,
        crimes: p.justice?.crimes || 0,
      }));
  }
}

// Petite phrase de garde, quand il faut rappeler la loi sans crier.
export function guardLine(lang = 'fr') {
  return pick(
    lang === 'en'
      ? ['Keep your blade sheathed inside the walls.', 'We watch, stranger.', 'No trouble here.']
      : ['Garde ta lame au fourreau dans les murs.', 'On te surveille, étranger.', 'Pas d’histoires ici.'],
  );
}
