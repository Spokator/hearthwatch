// Mobilier : placement de meubles dans une pièce sans chevauchement (tailles réelles des pièces du jeu), et intérieurs
// à thème pour les maisons. Une pièce est un rectangle libre d'un repère de bâtiment, au niveau `floor`.

const SIDES = { back: 0, front: 180, left: 90, right: 270 };

export class Room {
  // surface : distance du bord de la pièce au parement de bois (où s'accrochent présentoirs et bannières).
  constructor(f, x0, z0, x1, z1, floor, { random = Math.random, door = null, surface = 0.4 } = {}) {
    Object.assign(this, { f, x0, z0, x1, z1, floor, random, surface });
    this.geo = f.layout.geo;
    this.subs = {};
    this.blocked = [];
    this.hangings = [];
    // Passage dégagé devant la porte.
    if (door) this.block(door[0] - 1, door[1] - 2.4, door[0] + 1, door[1] + 1);
  }

  get width() {
    return this.x1 - this.x0;
  }

  get depth() {
    return this.z1 - this.z0;
  }

  size(name, rot) {
    const g = this.geo[this.subs[name] || name];
    const b = g?.col || g?.vis;
    if (!b) return null;
    const w = b[3] - b[0];
    const d = b[5] - b[2];
    return (((rot % 180) + 180) % 180) === 90 ? [d, w] : [w, d];
  }

  block(x0, z0, x1, z1) {
    this.blocked.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);
  }

  fits(x0, z0, x1, z1) {
    if (x0 < this.x0 - 0.01 || z0 < this.z0 - 0.01 || x1 > this.x1 + 0.01 || z1 > this.z1 + 0.01) return false;
    return !this.blocked.some(([a0, b0, a1, b1]) => x0 < a1 - 0.01 && x1 > a0 + 0.01 && z0 < b1 - 0.01 && z1 > b0 + 0.01);
  }

  // Pose centrée en (x, z) si la place est libre. opts.free : ne réserve pas la place (tapis), opts.margin : dégagement.
  place(name, x, z, rot, opts = {}) {
    const s = this.size(name, rot);
    if (!s) return false;
    const m = opts.margin ?? 0.1;
    const [w, d] = s;
    if (!opts.free && !this.fits(x - w / 2 - m, z - d / 2 - m, x + w / 2 + m, z + d / 2 + m)) return false;
    if (opts.free && (x - w / 2 < this.x0 - 0.3 || x + w / 2 > this.x1 + 0.3 || z - d / 2 < this.z0 - 0.3 || z + d / 2 > this.z1 + 0.3)) return false;
    this.f.put(this.subs[name] || name, x, z, this.floor + (opts.lift || 0), rot, opts.data ? { data: opts.data } : {});
    if (!opts.free) this.block(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
    return { x, z, w, d, rot };
  }

  // Contre un mur, face à la pièce ; `at` (0..1) : position préférée le long du mur, sinon au hasard.
  wall(name, side, at = null, opts = {}) {
    const rot = SIDES[side] + (opts.turn || 0);
    const s = this.size(name, rot);
    if (!s) return false;
    const [w, d] = s;
    const alongX = side === 'back' || side === 'front';
    const lo = (alongX ? this.x0 : this.z0) + (alongX ? w : d) / 2 + 0.1;
    const hi = (alongX ? this.x1 : this.z1) - (alongX ? w : d) / 2 - 0.1;
    if (hi < lo) return false;
    const jitter = at === null ? this.random() : Math.min(1, Math.max(0, at + (this.random() - 0.5) * 0.3));
    const pref = lo + (hi - lo) * jitter;
    const fixed = { back: this.z0 + d / 2 + 0.05, front: this.z1 - d / 2 - 0.05, left: this.x0 + w / 2 + 0.05, right: this.x1 - w / 2 - 0.05 }[side];
    for (let k = 0; k <= 4 * (hi - lo) + 1; k++) {
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
      const p = pref + off;
      if (p < lo - 0.01 || p > hi + 0.01) continue;
      const placed = this.place(name, alongX ? p : fixed, alongX ? fixed : p, rot, { ...opts, margin: 0.05 });
      if (placed) return placed;
    }
    return false;
  }

  // Au centre (ou près d'un point relatif fx, fz de la pièce).
  center(name, rot = 0, opts = {}) {
    const cx = this.x0 + this.width * (opts.fx ?? 0.5);
    const cz = this.z0 + this.depth * (opts.fz ?? 0.5);
    for (let k = 0; k < 60; k++) {
      const ring = Math.ceil(Math.sqrt(k));
      const a = k * 2.4;
      const placed = this.place(name, cx + Math.cos(a) * ring * 0.5, cz + Math.sin(a) * ring * 0.5, rot, opts);
      if (placed) return placed;
    }
    return false;
  }

  // Table et sièges autour.
  dining(table, seat, count, opts = {}) {
    const rot = opts.rot ?? (this.width >= this.depth ? 0 : 90);
    const t = this.center(table, rot, { ...opts, margin: 0.9 });
    if (!t) return false;
    // La réservation avec marge a déjà dégagé les abords : on repose la table sans marge pour y glisser les sièges.
    this.blocked.pop();
    this.block(t.x - t.w / 2, t.z - t.d / 2, t.x + t.w / 2, t.z + t.d / 2);
    const spots = [];
    const long = t.w >= t.d;
    const half = (long ? t.d : t.w) / 2 + 0.45;
    const span = (long ? t.w : t.d) / 2;
    for (const s of [-1, 1])
      for (const u of span > 1.2 ? [-span / 2, span / 2] : [0]) spots.push(long ? [t.x + u, t.z + s * half, s > 0 ? 180 : 0] : [t.x + s * half, t.z + u, s > 0 ? 270 : 90]);
    let n = 0;
    for (const [x, z, r] of spots) {
      if (n >= count) break;
      if (this.place(seat, x, z, r, { margin: 0 })) n++;
    }
    if (opts.food) for (const [i, item] of opts.food.entries()) this.f.put(item, t.x + (i - (opts.food.length - 1) / 2) * 0.6, t.z, this.floor + (opts.top ?? 0.82), this.random() * 360);
    return t;
  }

  // Objet accroché au mur (présentoir, bannière, applique) : pas d'emprise au sol, écarté des autres et de la porte.
  hang(name, side, height, opts = {}) {
    const alongX = side === 'back' || side === 'front';
    const lo = (alongX ? this.x0 : this.z0) + 0.8;
    const hi = (alongX ? this.x1 : this.z1) - 0.8;
    const inset = opts.inset ?? 0.05;
    const w = this.surface;
    const fixed = { back: this.z0 - w + inset, front: this.z1 + w - inset, left: this.x0 - w + inset, right: this.x1 + w - inset }[side];
    for (let k = 0; k < 24; k++) {
      const p = lo + (hi - lo) * this.random();
      if (this.hangings.some(([s, q]) => s === side && Math.abs(q - p) < 1.3)) continue;
      const [x, z] = alongX ? [p, fixed] : [fixed, p];
      this.hangings.push([side, p]);
      this.f.put(this.subs[name] || name, x, z, this.floor + height, SIDES[side] + (opts.turn || 0), { pivot: true, data: opts.data });
      return true;
    }
    return false;
  }
}

const lock = true;
const armor = (...names) => ({ ints: Object.fromEntries(names.map(([slot, item]) => [`${slot}_item`, item])), lock });
const stand = (item) => ({ ints: { item }, lock });

// Intérieurs : un séjour (rez-de-chaussée), une chambre, une réserve. Peu de meubles, différents d'une maison à l'autre.
const THEMES = [
  {
    key: 'famille',
    living: (r) => {
      r.center('rug_deer', 0, { free: true });
      r.dining('piece_table_round', 'piece_chair03', 4, { food: ['Bread'] });
      r.wall('piece_chest_wood', 'left');
      r.wall('piece_logbench01', 'back');
      r.wall('piece_pot1', 'right', 0.05);
    },
    sleep: (r) => {
      r.wall('piece_bed02', 'back', 0.25);
      r.wall('bed', 'right', 0.3);
      r.center('rug_hare', 0, { free: true, fz: 0.7 });
      r.wall('piece_chest_private', 'front', 0.2);
    },
  },
  {
    key: 'chasseur',
    living: (r) => {
      r.center('rug_wolf', 0, { free: true });
      r.wall('ArmorStand_Male', 'right', 0.3, { data: armor([0, 'ArmorLeatherChest'], [1, 'ArmorLeatherLegs'], [2, 'HelmetLeather'], [7, 'CapeDeerHide'], [4, 'Bow']) });
      r.hang('itemstand', 'back', 1.7, { data: stand('SpearFlint') });
      r.hang('itemstand', 'back', 1.7, { data: stand('KnifeFlint') });
      r.wall('piece_bench01', 'back');
      r.wall('wood_stack', 'left', 0.8);
      r.wall('bone_stack', 'front', 0.1);
    },
    sleep: (r) => {
      r.wall('bed', 'back', 0.2);
      r.center('rug_fur', 0, { free: true });
      r.wall('piece_chest', 'right');
    },
  },
  {
    key: 'ancien',
    living: (r) => {
      r.center('rug_fur', 90, { free: true });
      r.wall('piece_throne01', 'back', 0.5);
      r.wall('piece_bench01', 'left');
      r.wall('piece_bench01', 'right');
      r.center('piece_table_runed_small', 0, { fz: 0.4 });
      r.wall('piece_pot2', 'front', 0.95);
      r.hang('piece_banner05', 'back', 2.6, { turn: 90, inset: 0.3 });
    },
    sleep: (r) => {
      r.wall('piece_bed02', 'back', 0.3);
      r.wall('piece_chest_warderobe', 'right', 0.2);
      r.wall('piece_chair02', 'left', 0.7);
    },
  },
  {
    key: 'marchand',
    living: (r) => {
      r.center('rug_deer', 0, { free: true });
      r.wall('piece_chest', 'back', 0.15);
      r.wall('piece_chest_blackmetal', 'back', 0.85);
      r.wall('piece_chest_barrel', 'left', 0.15);
      r.wall('piece_chest_barrel', 'left', 0.35);
      r.dining('piece_table', 'piece_chair02', 2, { food: ['Candle_resin'] });
      r.wall('treasure_pile', 'right', 0.2);
    },
    sleep: (r) => {
      r.wall('piece_bed02', 'back', 0.7);
      r.wall('piece_chest_warderobe', 'left', 0.3);
      r.center('jute_carpet', 0, { free: true });
    },
  },
  {
    key: 'guerrier',
    living: (r) => {
      r.center('rug_wolf', 90, { free: true });
      r.wall('ArmorStand_Male', 'back', 0.2, { data: armor([0, 'ArmorIronChest'], [1, 'ArmorIronLegs'], [2, 'HelmetIron'], [6, 'ShieldBanded'], [4, 'SwordIron']) });
      r.hang('itemstand', 'left', 1.7, { data: stand('AxeIron') });
      r.hang('itemstand', 'right', 1.7, { data: stand('ShieldIronTower') });
      r.wall('piece_bench01', 'front', 0.2);
      r.wall('piece_chest_wood', 'back', 0.8);
    },
    sleep: (r) => {
      r.wall('piece_bed02', 'back', 0.2);
      r.wall('piece_chest', 'right', 0.8);
      r.center('rug_straw', 0, { free: true });
    },
  },
  {
    key: 'artisan',
    living: (r) => {
      r.wall('piece_table_runed', 'back', 0.5);
      r.wall('piece_preptable', 'left', 0.5);
      r.wall('wood_fine_stack', 'right', 0.8);
      r.wall('stone_pile', 'front', 0.1);
      r.wall('piece_chest_barrel', 'right', 0.2);
      r.center('piece_chair', 0, { fz: 0.35 });
    },
    sleep: (r) => {
      r.wall('bed', 'back', 0.2);
      r.wall('piece_chest_wood', 'left', 0.5);
      r.center('rug_straw', 0, { free: true });
    },
  },
  {
    key: 'brasseur',
    living: (r) => {
      r.center('rug_straw', 90, { free: true });
      r.wall('fermenter', 'back', 0.85);
      r.wall('piece_chest_barrel', 'left', 0.1);
      r.wall('piece_chest_barrel', 'left', 0.25);
      r.wall('piece_chest_barrel', 'left', 0.4);
      r.dining('piece_table', 'piece_chair', 3, { food: ['MeadTasty', 'MeadHealthMinor'] });
    },
    sleep: (r) => {
      r.wall('bed', 'right', 0.3);
      r.wall('piece_chest_wood', 'back', 0.5);
      r.center('rug_deer', 0, { free: true });
    },
  },
  {
    key: 'erudit',
    living: (r) => {
      r.center('jute_carpet', 0, { free: true });
      r.dining('piece_table', 'piece_chair02', 1, { food: ['Candle_resin', 'Candle_resin'] });
      r.wall('piece_chest_warderobe', 'right', 0.2);
      r.wall('piece_bench_runed', 'back', 0.5);
      r.wall('piece_Lavalantern', 'left', 0.9);
      r.hang('piece_banner03', 'left', 2.6, { turn: 90, inset: 0.3 });
    },
    sleep: (r) => {
      r.wall('piece_bed02', 'back', 0.6);
      r.wall('piece_table_runed_small', 'left', 0.3);
      r.wall('piece_chair02', 'left', 0.7);
    },
  },
  {
    key: 'pecheur',
    living: (r) => {
      r.center('rug_seal', 0, { free: true });
      r.dining('piece_table_round', 'piece_chair', 3, { food: ['FishAndBread'] });
      r.wall('piece_chest_barrel', 'right', 0.1);
      r.wall('piece_chest_barrel', 'right', 0.3);
      r.wall('piece_logbench01', 'back', 0.5);
      r.hang('itemstand', 'left', 1.7, { data: stand('HelmetFishingHat') });
    },
    sleep: (r) => {
      r.wall('bed', 'back', 0.2);
      r.wall('bed', 'back', 0.8);
      r.wall('piece_chest', 'front', 0.5);
    },
  },
  {
    key: 'riche',
    living: (r) => {
      r.center('rug_fur', 0, { free: true });
      r.dining('piece_table_round', 'piece_chair03', 4, { food: ['HoneyGlazedChicken'] });
      r.wall('piece_throne02', 'back', 0.5);
      r.wall('piece_chest_blackmetal', 'left', 0.5);
      r.wall('piece_pot2_red', 'right', 0.05);
      r.wall('piece_pot2_red', 'right', 0.95);
      r.hang('piece_banner02', 'back', 2.6, { turn: 90, inset: 0.3 });
    },
    sleep: (r) => {
      r.wall('piece_bed02', 'back', 0.3);
      r.wall('piece_bathtub', 'right', 0.7);
      r.wall('piece_chest_warderobe', 'left', 0.5);
    },
  },
];

export const THEME_COUNT = THEMES.length;

// Réserve : coffres, tonneaux et piles.
function store(r) {
  r.wall('piece_chest_wood', 'back', 0.2);
  r.wall('piece_chest_barrel', 'back', 0.6);
  r.wall('wood_stack', 'left', 0.5);
  r.wall('piece_chest', 'right', 0.5);
}

// Aménage une maison : séjour au rez-de-chaussée (foyer au centre pour les longères et maisons rondes), chambre à
// l'étage ou dans une aile, réserve dans la pièce suivante. Sans autre pièce, le lit rejoint le séjour.
// Variantes de meubles par maison : chaque maison tire ses tapis, sièges, tables, coffres, pots, bancs et bannières.
const VARIANTS = [
  ['rug_deer', 'rug_wolf', 'rug_fur', 'rug_straw', 'rug_hare', 'jute_carpet', 'rug_seal'],
  ['piece_chair', 'piece_chair02', 'piece_chair03'],
  ['piece_chest_wood', 'piece_chest'],
  ['piece_pot1', 'piece_pot2', 'piece_pot1_red', 'piece_pot2_red', 'piece_pot3', 'piece_pot3_red'],
  ['piece_bench01', 'piece_logbench01', 'piece_bench_runed'],
  ['piece_banner01', 'piece_banner02', 'piece_banner03', 'piece_banner04', 'piece_banner05', 'piece_banner06', 'piece_banner07', 'piece_banner08', 'piece_banner09', 'piece_banner10', 'piece_banner11'],
  ['piece_table', 'piece_table_round'],
];

export function furnish(index, { ground, wings, uppers, hearth }) {
  const theme = THEMES[index % THEMES.length];
  const subs = {};
  for (const pool of VARIANTS) for (const name of pool) subs[name] = pool[Math.floor(ground.random() * pool.length)];
  for (const room of [ground, ...wings, ...uppers]) room.subs = subs;
  if (hearth) {
    const fire = ground.center('fire_pit', 0, { margin: 0.8 });
    if (fire) ground.wall('wood_stack', 'front', ground.random() < 0.5 ? 0.1 : 0.9);
  }
  theme.living(ground);
  const rooms = [...uppers, ...wings];
  if (rooms.length) {
    theme.sleep(rooms[0]);
    for (const room of rooms.slice(1)) store(room);
  } else {
    // Un seul volume : le lit et un coffre de la chambre y trouvent place s'il en reste.
    const fallback = new Proxy(ground, {
      get: (target, prop) => (prop === 'center' ? () => false : target[prop]),
    });
    theme.sleep(fallback);
  }
}
