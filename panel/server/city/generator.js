// Générateur de ville : à partir du relevé du terrain, des dimensions réelles des pièces du jeu (pieces.json) et de
// la liste de ses objets (items.json), produit la liste exacte des pièces à poser, les formes de terrain et l'aperçu.
// Repère et conventions : voir layout.js ; style et niveaux : voir buildings.js.

import {
  armory,
  armoryContents,
  armoryRect,
  brasserie,
  brasserieRect,
  castle,
  foundation,
  hall,
  hallRect,
  HOUSE_PLANS,
  houseFootprint,
  LEVEL,
  lowFence,
  rampart,
  vikingHouse,
} from './buildings.js';
import { DEG, Layout, rng, rotate, round, segmentDistance, Space, TerrainGrid } from './layout.js';

export const SIZES = { ville: 80, cite: 100, capitale: 120 };

const PAVED = 0;
const DIRT = 1;
const KEEP = 5;
const DIG = 6;

const TEXTS = {
  fr: {
    welcome: (c, e) => `Bienvenue à ${c}, cité de l'Empereur ${e} !`,
    monument: (e) => `${e}, Empereur. Gloire éternelle !`,
    monument2: (c, e) => `${c} fut bâtie à la gloire de ${e}`,
    palace: (e) => `Château impérial de ${e}`,
    throne: (e) => `Trône de l'Empereur ${e}`,
    forge: 'Forge impériale',
    workshop: 'Atelier des bâtisseurs',
    kitchen: 'Cuisines et fumoir',
    mage: 'Cercle des mages',
    foundry: 'Fonderie et moulins',
    market: (c) => `Marché de ${c}`,
    brasserie: (c) => `Grande Brasserie de ${c}`,
    brasserie2: 'Hydromel, bière et chansons',
    armory: 'Armurerie impériale',
    armory2: 'Toutes les armes et armures du royaume',
    arena: 'Arène impériale — entrez dans le cercle',
    north: 'Nord : grand-place et château',
    east: 'Est : artisans',
    west: 'Ouest : arène',
    gate: (c) => `${c}`,
    portals: 'Place des portails',
    portal: (tag) => `Portail : ${tag}`,
    portalHelp: 'Nommez un portail pareil pour venir ici',
    board: 'Tableau des contrats',
    boardEmpty: '—',
    proclamations: 'Proclamations impériales',
    proclamationEmpty: 'Gloire à l’Empereur',
    stones: (d, dir) => `Pierres sacrées : ${d} m ${dir}`,
    dirs: ['à l’est', 'au nord-est', 'au nord', 'au nord-ouest', 'à l’ouest', 'au sud-ouest', 'au sud', 'au sud-est'],
    tags: ['Prairies', 'Forêt noire', 'Marais', 'Montagnes', 'Plaines', 'Brumes', 'Cendres', 'Nord'],
  },
  en: {
    welcome: (c, e) => `Welcome to ${c}, city of Emperor ${e}!`,
    monument: (e) => `${e}, Emperor. Eternal glory!`,
    monument2: (c, e) => `${c} was raised to the glory of ${e}`,
    palace: (e) => `Imperial castle of ${e}`,
    throne: (e) => `Throne of Emperor ${e}`,
    forge: 'Imperial forge',
    workshop: 'Builders’ workshop',
    kitchen: 'Kitchens and smokehouse',
    mage: 'Circle of mages',
    foundry: 'Foundry and mills',
    market: (c) => `${c} market`,
    brasserie: (c) => `Great mead hall of ${c}`,
    brasserie2: 'Mead, ale and songs',
    armory: 'Imperial armory',
    armory2: 'Every weapon and armor of the realm',
    arena: 'Imperial arena — step into the circle',
    north: 'North: main square and castle',
    east: 'East: craftsmen',
    west: 'West: arena',
    gate: (c) => `${c}`,
    portals: 'Portal square',
    portal: (tag) => `Portal: ${tag}`,
    portalHelp: 'Name a portal the same to come here',
    board: 'Contract board',
    boardEmpty: '—',
    proclamations: 'Imperial proclamations',
    proclamationEmpty: 'Glory to the Emperor',
    stones: (d, dir) => `Sacred stones: ${d} m ${dir}`,
    dirs: ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'],
    tags: ['Meadows', 'Black Forest', 'Swamp', 'Mountains', 'Plains', 'Mistlands', 'Ashlands', 'Deep North'],
  },
};

export function generateCity({ geometry, survey, options, items = [] }) {
  const o = { name: 'Spokaheim', emperor: 'Spoka', size: 'cite', seed: 1, language: 'fr', arena: true, houses: true, guards: true, ...options };
  const R = SIZES[o.size] || 100;
  const T = TEXTS[o.language === 'en' ? 'en' : 'fr'];
  const random = rng(o.seed);
  const L = new Layout(geometry);
  const terrain = new TerrainGrid(survey);
  const paint = []; // [kind, type, a, b, c, d, e, f] en coordonnées locales (f : hauteur absolue d'un creusement)
  const info = { radius: R, districts: [] };
  const extra = { portals: [], boards: [], proclamation: null };
  const floorY = survey?.floorY ?? 0;
  const water = survey?.water ?? 30;
  const V = LEVEL;

  // ---------- Muraille ----------
  const walls = rampart(L, R, [0, 180, 270]);
  const A = walls.apothem;
  const inner = A - 12;
  const space = new Space(inner, terrain);
  info.apothem = Math.round(A);

  const anchor = survey?.anchor
    ? { x: survey.anchor.x - (survey.center?.[0] ?? 0), z: survey.anchor.z - (survey.center?.[1] ?? 0), radius: Math.min(12, survey.anchor.radius) }
    : null;
  const P = Math.max(Math.round(Math.min(24, Math.max(16, R * 0.2))), anchor ? anchor.radius + 10 : 0);

  const ring = (d) => walls.vertices.map(([x, z]) => [(x * d) / A, (z * d) / A]);
  const edges = (d) => {
    const v = ring(d);
    return v.map((p, k) => [p, v[(k + 1) % v.length]]);
  };
  const isGate = (x, z) => walls.gates.some((g) => Math.abs(((Math.atan2(z, x) / DEG - g.angle + 540) % 360) - 180) < 4);

  // ---------- Douves, canal, promenade, ponts ----------
  L.district = 'moat';
  const moatBottom = water - 2.5;
  const moat = floorY - moatBottom <= 7.8;
  if (moat) {
    for (const [[x1, z1], [x2, z2]] of edges(A + 10)) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const ex = ((x2 - x1) / len) * 4;
      const ez = ((z2 - z1) / len) * 4;
      paint.push([DIG, 2, x1 - ex, z1 - ez, x2 + ex, z2 + ez, 8, moatBottom]);
    }
    info.districts.push('moat');
  }
  let channel = null;
  if (moat && terrain.grid) {
    const g = terrain.grid;
    let best = null;
    for (let i = 0; i < g.size; i += 2)
      for (let j = 0; j < g.size; j += 2) {
        const h = floorY + g.heights[i * g.size + j] / 10;
        if (h > water - 1) continue;
        const x = g.origin[0] + j * g.step - survey.center[0];
        const z = g.origin[1] + i * g.step - survey.center[1];
        const r = Math.hypot(x, z);
        if (r < A + 16 || r > A + 110) continue;
        const sx = (x / r) * (A + 12);
        const sz = (z / r) * (A + 12);
        const len = Math.hypot(x - sx, z - sz);
        if ((best && len >= best.len) || isGate(x, z) || isGate(sx, sz)) continue;
        let ok = true;
        for (let s = 0; s <= len && ok; s += 2) {
          const nat = terrain.natural(sx + ((x - sx) * s) / len, sz + ((z - sz) * s) / len);
          if (nat === null || floorY + nat - moatBottom > 7.8) ok = false;
        }
        if (ok) best = { sx, sz, x, z, len };
      }
    if (best) {
      channel = best;
      const r = Math.hypot(best.x, best.z);
      paint.push([DIG, 2, best.sx, best.sz, best.x + (best.x / r) * 4, best.z + (best.z / r) * 4, 6, moatBottom]);
      info.channel = Math.round(best.len);
    }
  }
  // Promenade au-delà des douves : chemin, barrière basse éclairée côté eau, bancs.
  const promenade = A + 19;
  for (const [[x1, z1], [x2, z2]] of edges(promenade)) paint.push([DIRT, 2, x1, z1, x2, z2, 3.5, 0]);
  for (const [[x1, z1], [x2, z2]] of edges(A + 16.5)) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const f = L.frame(x1, z1, -Math.atan2(z2 - z1, x2 - x1) / DEG);
    let start = null;
    for (let t = 2; t <= len - 2; t += 4) {
      const [x, z] = f.at(t, 0);
      const blocked = isGate(x, z) || (channel && segmentDistance(x, z, channel.sx, channel.sz, channel.x, channel.z) < 5);
      if (!blocked && start === null) start = t;
      if ((blocked || t + 4 > len - 2) && start !== null) {
        const end = blocked ? t - 4 : t;
        if (end > start) lowFence(f, start, end, 0, 0, { lamp: 3, lampSide: -1 });
        start = null;
      }
    }
    const [mx, mz] = f.at(len / 2, -3);
    if (!isGate(mx, mz)) L.put('piece_logbench01', mx, mz, 0, f.rot + 180);
  }
  L.district = 'bridges';
  for (const gate of walls.gates) {
    const f = L.frame(Math.cos(gate.angle * DEG) * (A + 3), Math.sin(gate.angle * DEG) * (A + 3), -gate.angle);
    for (let a = 1; a < 14; a += 2) for (const b of [-1, 1]) f.put('wood_floor', a, b, 0, 0);
    for (const s of [-1, 1]) {
      lowFence(f, 0, 12, s * 1.75, 0.1, { lamp: 2, lampSide: s > 0 ? -1 : 1 });
      for (const a of [2, 12]) f.put('darkwood_pole4', a, s * 2, -4, 0);
    }
    paint.push([PAVED, 2, Math.cos(gate.angle * DEG) * A, Math.sin(gate.angle * DEG) * A, Math.cos(gate.angle * DEG) * (A + 22), Math.sin(gate.angle * DEG) * (A + 22), 4, 0]);
  }
  if (channel) {
    const ang = Math.atan2(channel.z, channel.x);
    const f = L.frame(Math.cos(ang) * promenade, Math.sin(ang) * promenade, -(ang / DEG + 90));
    for (let a = -5; a <= 5; a += 2) f.put('wood_floor', a, 0, 0, 0);
    for (const s of [-1, 1]) lowFence(f, -6, 6, s * 0.8, 0.1, { lamp: 0 });
  }

  // ---------- Grand-place : plate-forme de pierre autour des pierres de départ, monument, proclamations ----------
  L.district = 'plaza';
  space.reserveCircle(0, 0, P + 2);
  const holeR = anchor ? anchor.radius + 1 : 0;
  {
    const f = L.frame(0, 0, 0);
    const edge = Math.floor(P / 4) * 4;
    foundation(f, -edge, -edge, edge, edge, 0, (x, z) => Math.hypot(x, z) > P + 1 || (anchor && Math.hypot(x - anchor.x, z - anchor.z) < holeR));
    if (anchor)
      for (const [dx, dz, r] of [[0, -1, 0], [0, 1, 180], [1, 0, 270], [-1, 0, 90]])
        f.put('stone_stair', anchor.x + dx * (holeR - 1), anchor.z + dz * (holeR - 1), 0, r);
    if (anchor) paint.push([KEEP, 0, anchor.x, anchor.z, anchor.radius, 0, 0, 0]);
  }
  // Monument : sur sa propre place au nord quand les pierres occupent le centre (sauf petite ville, faute de place).
  const monument = !anchor || R >= 100;
  const mz = anchor && monument ? P + 10 : 0;
  if (anchor && monument) {
    space.reserve({ cx: 0, cz: mz, hw: 8, hd: 8, rot: 0 });
    foundation(L.frame(0, mz, 0), -8, -8, 8, 8, 0);
  }
  if (monument) {
  for (let a = -5; a <= 5; a += 2) for (let b = -5; b <= 5; b += 2) if (Math.abs(a) === 5 || Math.abs(b) === 5) L.put('blackmarble_floor', a, mz + b, V, 0);
  L.put('blackmarble_floor_large', 0, mz, V + 1, 0);
  L.put('blackmarble_column_3', 0, mz, V + 3, 0);
  L.put('piece_EternalPyre', 0, mz, V + 11, 0);
  for (const [a, b, r] of [[-3, -3, 225], [3, -3, 135], [3, 3, 45], [-3, 3, 315]]) L.put('blackmarble_head_big01', a, mz + b, V + 3, r);
  for (const [a, b, r] of [[0, -6.05, 180], [6.05, 0, 90], [0, 6.05, 0], [-6.05, 0, 270]])
    L.put('sign', a, mz + b, V + 0.5, r, { pivot: true, text: r % 180 === 0 ? T.monument(o.emperor) : T.monument2(o.name, o.emperor) });
  }
  for (let k = 0; k < 8; k++) {
    const ang = (22.5 + k * 45) * DEG;
    const x = Math.cos(ang) * (P - 2);
    const z = Math.sin(ang) * (P - 2);
    L.put('darkwood_pole4', x, z, V, 0);
    L.put('darkwood_pole4', x, z, V + 4, 0);
    L.put(k % 2 ? 'piece_banner07' : 'piece_banner02', x + Math.cos(ang) * 0.3, z + Math.sin(ang) * 0.3, V + 7.6, -ang / DEG, { pivot: true });
    L.put('piece_dvergr_lantern', x - Math.cos(ang) * 0.22, z - Math.sin(ang) * 0.22, V + 2.6, -ang / DEG + 180, { pivot: true });
  }
  L.put('darkwood_pole4', 6, -P + 3, V, 0);
  L.put('sign', 6, -P + 2.76, V + 3.1, 180, { pivot: true, text: T.proclamations });
  extra.proclamation = L.put('sign', 6, -P + 2.76, V + 2.4, 180, { pivot: true, text: T.proclamationEmpty });

  // ---------- Château ----------
  L.district = 'palace';
  const castleW = R >= 110 ? 24 : R >= 100 ? 20 : 16;
  const castleD = R >= 110 ? 32 : R >= 100 ? 24 : 20;
  const plazaTop = anchor && monument ? mz + 8 : P;
  const castleZ = plazaTop + 14;
  {
    const top = castleZ + castleD + 8;
    if (top <= inner) {
      castle(L, 0, castleZ, { W: castleW, D: castleD, throne: T.throne(o.emperor), palace: T.palace(o.emperor), emperor: o.emperor });
      space.reserve({ cx: 0, cz: castleZ + castleD / 2, hw: castleW / 2 + 5, hd: castleD / 2 + 7, rot: 0 });
      info.districts.push('palace');
    }
  }

  // ---------- Arène (au sol, bâtie par le plugin) ----------
  let arena = null;
  if (o.arena) {
    const minD = P + 27;
    const maxD = A - 12 - 25;
    if (maxD >= minD) {
      const d = Math.min(maxD, Math.max(minD, P + 36));
      const ax = -d * Math.SQRT1_2;
      const az = -d * Math.SQRT1_2;
      if (terrain.flat({ cx: ax, cz: az, hw: 22, hd: 22, rot: 0 })) {
        arena = { x: ax, z: az, entrance: -45 };
        space.reserveCircle(ax, az, 25);
        info.districts.push('arena');
      }
    }
  }

  // ---------- Place d'accueil ----------
  L.district = 'welcome';
  const spawnZ = -A + 20;
  {
    const f = L.frame(0, spawnZ, 0);
    foundation(f, -8, -8, 8, 8, 0);
    space.reserve({ cx: 0, cz: spawnZ, hw: 8, hd: 8, rot: 0 });
    f.put('darkwood_pole4', 3.5, 3.5, V, 0);
    f.put('sign', 3.5, 3.26, V + 2.6, 180, { pivot: true, text: T.welcome(o.name, o.emperor) });
    f.put('sign', 3.5, 3.26, V + 1.8, 180, { pivot: true, text: T.north });
    f.put('sign', 3.74, 3.5, V + 2.2, 90, { pivot: true, text: T.east });
    f.put('sign', 3.26, 3.5, V + 2.2, 270, { pivot: true, text: arena ? T.west : T.gate(o.name) });
    if (survey?.stones) {
      const dx = survey.stones.x - (survey.center?.[0] ?? 0);
      const dz = survey.stones.z - (survey.center?.[1] ?? 0);
      const octant = ((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8;
      f.put('sign', 3.26, 3.5, V + 1.5, 270, { pivot: true, text: T.stones(Math.round(Math.hypot(dx, dz)), T.dirs[octant]) });
    }
    for (const [a, b] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) f.put('piece_groundtorch', a, b, V, 0);
  }
  const spawn = [0, V + 0.2, spawnZ];

  // ---------- Rues : planchers sur fondations de pierre ----------
  const streets = [];
  const addStreet = (x1, z1, x2, z2, w, { kind, check = false }) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 6) return null;
    const rot = -Math.atan2(z2 - z1, x2 - x1) / DEG;
    const rect = { cx: (x1 + x2) / 2, cz: (z1 + z2) / 2, hw: len / 2, hd: w / 2 + 0.2, rot };
    if (check && !space.fits({ ...rect, hw: Math.max(1, rect.hw - rect.hd - 1) }, 0, { terrain: false, radius: A })) return null;
    space.reserve(rect);
    const ux = (x2 - x1) / len;
    const uz = (z2 - z1) / len;
    const street = { x1, z1, x2, z2, w, len, rot, ux, uz, nx: -uz, nz: ux, kind };
    streets.push(street);
    // Plancher : dalles de pierre dessous, planches dessus.
    const f = L.frame(x1, z1, rot);
    const tiles = Math.max(1, Math.round(len / 4));
    const start = (len - tiles * 4) / 2;
    for (let k = 0; k < tiles; k++) {
      const t = start + k * 4;
      if (w === 4) f.put('stone_floor', t + 2, 0, 0, 0);
      else {
        f.put('stone_floor', t + 2, -1, 0, 0);
        f.put('stone_floor_2x2', t + 1, 2, 0, 0);
        f.put('stone_floor_2x2', t + 3, 2, 0, 0);
      }
      for (const a of [t + 1, t + 3]) for (let b = -w / 2 + 1; b < w / 2; b += 2) f.put('wood_floor', a, b, V, 0);
    }
    return street;
  };

  L.district = 'streets';
  // Rues ouvertes en premier là où rien n'est réservé : anneau intermédiaire, ruelles diagonales.
  const M = Math.round((P + 8 + inner) / 2);
  for (let k = 0; k < 16; k++) {
    const a1 = (k * 22.5 + 11.25) * DEG;
    const a2 = ((k + 1) * 22.5 + 11.25) * DEG;
    addStreet(Math.cos(a1) * M, Math.sin(a1) * M, Math.cos(a2) * M, Math.sin(a2) * M, 4, { kind: 'ring', check: true });
  }
  // Rue du rempart : second anneau, maisons côté ville, barrière éclairée côté muraille.
  const W2 = inner - 3;
  if (W2 - M > 30)
    for (let k = 0; k < 16; k++) {
      const a1 = (k * 22.5 + 11.25) * DEG;
      const a2 = ((k + 1) * 22.5 + 11.25) * DEG;
      addStreet(Math.cos(a1) * W2, Math.sin(a1) * W2, Math.cos(a2) * W2, Math.sin(a2) * W2, 4, { kind: 'ring', check: true });
    }
  for (const ang of [45, 135, 225, 315]) {
    const c = Math.cos(ang * DEG);
    const s = Math.sin(ang * DEG);
    addStreet(c * (P + 3), s * (P + 3), c * (M - 2.5), s * (M - 2.5), 4, { kind: 'lane', check: true });
    const wallRoad = W2 - M > 30;
    const outer = addStreet(c * (M + 2.5), s * (M + 2.5), c * (wallRoad ? W2 - 2.5 : A - 12), s * (wallRoad ? W2 - 2.5 : A - 12), 4, { kind: 'lane', check: true });
    if (outer && !wallRoad) {
      // Marches vers le sol au pied de la muraille.
      const f = L.frame(outer.x2, outer.z2, outer.rot);
      for (const b of [-1, 1]) f.put('stone_stair', 1, b, 0, 90);
    }
  }
  // Avenues vers les portes et vers le château.
  addStreet(0, -A + 2.5, 0, spawnZ - 8, 6, { kind: 'avenue' });
  addStreet(0, spawnZ + 8, 0, -P, 6, { kind: 'avenue' });
  addStreet(A - 2.5, 0, P, 0, 6, { kind: 'avenue' });
  addStreet(-A + 2.5, 0, -P, 0, 6, { kind: 'avenue' });
  if (info.districts.includes('palace')) addStreet(0, plazaTop, 0, castleZ - 6, 6, { kind: 'avenue' });
  // Chemin de l'arène : plancher depuis la grand-place, marches pour descendre au niveau de l'arène.
  if (arena) {
    const gx = arena.x + Math.SQRT1_2 * 26;
    const gz = arena.z + Math.SQRT1_2 * 26;
    const s = addStreet(-(P + 1) * Math.SQRT1_2, -(P + 1) * Math.SQRT1_2, gx, gz, 4, { kind: 'arena' });
    if (s) {
      const f = L.frame(gx, gz, s.rot);
      for (const b of [-1, 1]) f.put('stone_stair', 1, b, 0, 90);
      L.put('darkwood_pole4', gx + 2.5, gz - 2.5, 0, 0);
      L.put('sign', gx + 2.2, gz - 2.2, 2.4, 225, { pivot: true, text: T.arena });
    }
  }

  // ---------- Quartiers (sur plates-formes de pierre) ----------
  const place = (size, pt, rotations, margin = 1) => {
    const tries = [];
    for (let x = -inner; x <= inner; x += 2) for (let z = -inner; z <= inner; z += 2) tries.push([x, z, Math.hypot(x - pt[0], z - pt[1])]);
    tries.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of tries)
      for (const rot of rotations) {
        const r = { ...size, cx: x, cz: z, rot };
        if (space.fits(r, margin)) return space.reserve(r);
      }
    return null;
  };
  const facing = (x, z) => Math.round(Math.atan2(-x, -z) / DEG / 90) * 90;
  const face = (pt) => [facing(pt[0], pt[1])];
  const turns = (pt) => [0, 90, 180, 270].map((d) => (facing(pt[0], pt[1]) + d + 360) % 360);
  const Q = Math.max(P + 18, inner * 0.55);
  const platform = (r) => {
    const f = L.frame(r.cx, r.cz, r.rot);
    const hw = Math.floor(r.hw / 2) * 2;
    const hd = Math.floor(r.hd / 2) * 2;
    foundation(f, -hw, -hd, hw, hd, 0);
    return f;
  };

  // Armurerie.
  if (items.length) {
    const r = place(armoryRect, [Q * 0.55, Q * 0.1], turns([Q * 0.55, Q * 0.1]));
    if (r) {
      L.district = 'armory';
      const result = armory(L, r.cx, r.cz, r.rot, { contents: armoryContents(items, geometry), name: T.armory, subtitle: T.armory2 });
      info.armory = result;
      info.districts.push('armory');
    }
  }
  // Grande brasserie.
  {
    const r = place(brasserieRect, [-Q * 0.55, -Q * 0.35], turns([-Q * 0.55, -Q * 0.35]));
    if (r) {
      L.district = 'brasserie';
      extra.boards.push(...brasserie(L, r.cx, r.cz, r.rot, { name: T.brasserie(o.name), subtitle: T.brasserie2, board: T.board, boardEmpty: T.boardEmpty }));
      info.districts.push('brasserie');
    }
  }
  // Place des portails.
  {
    const r = place({ hw: 14, hd: 10 }, [-Q * 0.2, -Q * 0.75], [0, 90]);
    if (r) {
      L.district = 'portals';
      const f = platform(r);
      T.tags.forEach((tag, k) => {
        const back = k < 4;
        const x = -9 + (k % 4) * 6;
        const idx = f.put('portal_wood', x, back ? -6 : 6, V, back ? 0 : 180);
        const pz = back ? -3.2 : 3.2;
        f.put('wood_pole2', x + 2.6, pz, V, 0);
        const sign = f.put('sign', x + 2.6, back ? pz + 0.24 : pz - 0.24, V + 1.5, back ? 0 : 180, { pivot: true, text: T.portal(tag) });
        extra.portals.push([idx, tag, sign]);
      });
      f.put('darkwood_pole4', 0, 0, V, 0);
      for (const [b, rr] of [[0.24, 0], [-0.24, 180]]) {
        f.put('sign', 0, b, V + 3, rr, { pivot: true, text: T.portals });
        f.put('sign', 0, b, V + 2.3, rr, { pivot: true, text: T.portalHelp });
      }
      for (const [a, b] of [[-12, -8], [12, -8], [-12, 8], [12, 8]]) f.put('piece_groundtorch_blue', a, b, V, 0);
      info.districts.push('portals');
    }
  }
  // Marché.
  {
    const r = place({ hw: 12, hd: 12 }, [Q * 0.6, -Q * 0.8], [0]);
    if (r) {
      L.district = 'market';
      const f = platform(r);
      const stall = (lx, lz, rot, npc) => {
        const s = L.frame(...f.at(lx, lz), rot);
        for (const [a, b] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) s.put('darkwood_pole4', a, b, V, 0);
        for (const a of [-1, 1]) {
          s.put('wood_roof_45', a, 2, V + 4, 0, { pivot: true });
          s.put('wood_roof_45', a, -2, V + 4, 180, { pivot: true });
          s.put('wood_roof_top_45', a, 0, V + 5, 0, { pivot: true });
        }
        s.put('jute_carpet_blue', 0, 0, V, 0);
        s.put(npc, 0, -0.6, V, 0);
        s.put('piece_table', 0, 1.9, V, 0);
        s.put('piece_banner07', 1.9, 2.05, V + 3.8, 0, { pivot: true });
        s.put('piece_chest_barrel', -2.6, -1, V, 0);
      };
      stall(-6, 6, 180, 'Haldor');
      stall(6, 6, 180, 'Hildir');
      const bog = L.frame(...f.at(0, -6), 0);
      bog.put('rug_wolf', 0, 0, V, 0);
      bog.put('BogWitch', 0, -1, V, 0);
      f.put('piece_barber', -9, -9, V, 45);
      f.put('piece_cartographytable', 9, -9, V, 315);
      f.put('darkwood_pole4', 0, 10.5, V, 0);
      f.put('sign', 0, 10.26, V + 2.4, 180, { pivot: true, text: T.market(o.name) });
      for (const [a, b] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) f.put('piece_dvergr_lantern_pole', a, b, V, 45, { pivotXZ: true });
      info.districts.push('market');
    }
  }
  // Fonderie.
  {
    const r = place({ hw: 16, hd: 10 }, [Q * 0.9, -Q * 0.35], [0, 90]);
    if (r) {
      L.district = 'foundry';
      const f = platform(r);
      f.put('smelter', -12, -4, V, 0);
      f.put('charcoal_kiln', -6.5, -4, V, 0);
      f.put('blastfurnace', -1, -4, V, 0);
      f.put('eitrrefinery', 5, -4, V, 0);
      f.put('windmill', 11.5, -3, V, 0);
      f.put('piece_spinningwheel', -12, 4, V, 180);
      f.put('piece_FrostKiln', -5, 3.5, V, 180);
      f.put('piece_FrostFoundry', 2, 4.5, V, 180);
      f.put('incinerator', 6.5, 5, V, 180);
      for (const a of [10, 12, 14]) f.put('piece_beehive', a, 6.5, V, 180);
      lowFence(f, -16, 16, -9.6, V, { lamp: 2, lampSide: 1 });
      f.put('darkwood_pole4', 0, 9, V, 0);
      f.put('sign', 0, 9.24, V + 2.2, 0, { pivot: true, text: T.foundry });
      info.districts.push('foundry');
    }
  }
  // Pavillons d'artisans.
  const halls = [
    { key: 'forge', length: 16, pt: [Q * 0.8, Q * 0.5], sign: T.forge, fill: (f) => {
      f.put('forge', -4, -1, V, 0);
      f.put('forge_ext1', -5.8, -1, V, 0);
      f.put('forge_ext2', -2.2, -1.5, V, 0);
      f.put('forge_ext3', -4, 1.2, V, 0);
      f.put('forge_ext4', -6.2, 1.2, V, 0);
      f.put('forge_ext5', -2.2, 1.2, V, 0);
      f.put('forge_ext6', -4, -3.35, V + 1.4, 0);
      f.put('blackforge', 4, -1, V, 0);
      f.put('blackforge_ext1', 1.6, 1.2, V, 0);
      f.put('blackforge_ext2_vise', 6.6, -1, V, 0);
      f.put('blackforge_ext3_metalcutter', 4, 1.4, V, 0);
      f.put('blackforge_ext4_gemcutter', 6.4, 1.4, V, 0);
      f.put('blackforge_ext5_apron', 4, -3.4, V + 1.2, 0, { pivotXZ: true });
    } },
    { key: 'workshop', length: 16, pt: [Q * 0.3, Q * 0.9], sign: T.workshop, fill: (f) => {
      f.put('piece_workbench', -5, -1.5, V, 0);
      f.put('piece_workbench_ext1', -7, 1.2, V, 0);
      f.put('piece_workbench_ext2', -5, 1.4, V, 0);
      f.put('piece_workbench_ext3', -2.5, 1.4, V, 0);
      f.put('piece_workbench_ext4', -5, -3.35, V + 1.4, 0);
      f.put('piece_stonecutter', 0.5, -1.5, V, 0);
      f.put('piece_artisanstation', 5, -1.5, V, 0);
      f.put('artisan_ext1', 5, 1.4, V, 0);
    } },
    { key: 'kitchen', length: 20, pt: [-Q * 0.45, Q * 0.85], sign: T.kitchen, fill: (f) => {
      f.put('fire_pit', -7, -1, V, 0);
      f.put('piece_cauldron', -7, -1, V, 0);
      f.put('cauldron_ext1_spice', -7, -3.35, V + 1.2, 0);
      f.put('cauldron_ext3_butchertable', -4.6, -1.2, V, 0);
      f.put('cauldron_ext4_pots', -9, -3.43, V + 1.4, 0, { pivotXZ: true });
      f.put('cauldron_ext5_mortarandpestle', -4.6, 1.2, V, 0);
      f.put('cauldron_ext6_rollingpins', -5, -3.3, V + 1.5, 0);
      f.put('cauldron_ext7_smoker', -8.6, 1.4, V, 0);
      f.put('fire_pit', -1.5, -1, V, 0);
      f.put('piece_MeadCauldron', -1.5, -1, V, 0);
      f.put('piece_preptable', 2, -2.2, V, 0);
      f.put('piece_oven', 6, -2, V, 0);
      f.put('fire_pit', 2, 1.8, V, 0);
      f.put('piece_cookingstation', 2, 1.8, V, 0);
      f.put('fermenter', 8.2, 1.6, V, 180);
      f.put('fermenter', 5.8, 1.6, V, 180);
    } },
    { key: 'mage', length: 8, pt: [-Q * 0.85, Q * 0.45], sign: T.mage, dark: false, fill: (f) => {
      f.put('piece_magetable', -0.5, -1.2, V, 0);
      f.put('piece_magetable_ext', 2.6, 0.8, V, 0);
      f.put('piece_magetable_ext2', -2.8, 1.4, V, 0);
      f.put('piece_magetable_ext3', 2.2, -3.35, V + 1.4, 0);
      f.put('piece_magetable_ext4', 0.5, 2, V, 180);
    } },
  ];
  for (const h of halls) {
    const size = hallRect(h.length);
    const r = place(size, h.pt, [...face(h.pt), (face(h.pt)[0] + 90) % 360, (face(h.pt)[0] + 270) % 360]);
    if (!r) continue;
    L.district = 'crafts';
    // Le repère du pavillon est décalé : la plate-forme va de z = -4 à z = 6.
    const [ox, oz] = rotate(0, -1, r.rot);
    h.fill(hall(L, r.cx + ox, r.cz + oz, r.rot, h.length, { sign: h.sign, dark: h.dark !== false }));
    info.districts.push(h.key);
  }

  // ---------- Maisons le long des rues ----------
  let houses = 0;
  const maxHouses = { ville: 14, cite: 22, capitale: 32 }[o.size] || 22;
  let lastPlan = null;
  let interior = Math.floor(random() * 8);
  if (o.houses) {
    L.district = 'houses';
    const order = ['avenue', 'ring', 'lane'];
    for (const kind of order)
      for (const st of streets.filter((s) => s.kind === kind))
        for (const side of [1, -1]) {
          let t = 3;
          while (t < st.len - 3 && houses < maxHouses) {
            let plan = HOUSE_PLANS[Math.floor(random() * HOUSE_PLANS.length)];
            if (plan === lastPlan) plan = HOUSE_PLANS[(HOUSE_PLANS.indexOf(plan) + 1) % HOUSE_PLANS.length];
            const fp = houseFootprint(plan);
            const along = fp.x1 - fp.x0;
            if (t + along > st.len - 3) break;
            // Repère de la maison : +Z vers la rue, seuil (z = 6) au bord du plancher de la rue.
            const rot = Math.atan2(-side * st.nx, -side * st.nz) / DEG;
            const t0 = side > 0 ? t + fp.x1 : t - fp.x0;
            const offset = st.w / 2 + 6;
            const hx = st.x1 + st.ux * t0 + st.nx * side * offset;
            const hz = st.z1 + st.uz * t0 + st.nz * side * offset;
            const [cxl, czl] = rotate((fp.x0 + fp.x1) / 2, (fp.z0 - 1 + 5.8) / 2, rot);
            const rect = { cx: hx + cxl, cz: hz + czl, hw: along / 2 + 1, hd: (5.8 - (fp.z0 - 1)) / 2, rot };
            if (!space.fits(rect, 0)) {
              t += 2;
              continue;
            }
            space.reserve(rect);
            vikingHouse(L, hx, hz, rot, plan, random, interior++);
            paint.push([DIRT, 1, rect.cx, rect.cz, rect.hw, rect.hd, rot, 0]);
            lastPlan = plan;
            houses++;
            t += along + 3 + random() * 3;
          }
        }
    info.districts.push('houses');
  }
  info.houses = houses;

  // ---------- Barrières basses éclairées le long des rues, là où elles bordent un terrain vide ----------
  L.district = 'fences';
  for (const st of streets) {
    const f = L.frame(st.x1, st.z1, st.rot);
    for (const side of [1, -1]) {
      const z = side * (st.w / 2 - 0.25);
      let run = null;
      let end = null;
      const flush = () => {
        if (run !== null && end - run >= 4) lowFence(f, run, end, z, V, { lamp: 2, lampSide: -side });
        run = null;
      };
      for (let t = 2; t + 4 <= st.len - 2; t += 4) {
        const [bx, bz] = f.at(t + 2, side * (st.w / 2 + 1.8));
        const free = space.fits({ cx: bx, cz: bz, hw: 2, hd: 1.4, rot: st.rot }, 0, { terrain: false, radius: A - 6 });
        if (!free) {
          flush();
          continue;
        }
        if (run === null) run = t;
        end = t + 4;
      }
      flush();
    }
  }

  // Gardes nains autour de la grand-place et devant le château.
  if (o.guards) {
    L.district = 'guards';
    for (const [a, b] of [[P - 3, 4], [-P + 3, 4], [4, -P + 3], [-4, castleZ - 3], [4, castleZ - 3]]) L.put('Dverger', a, b, V, 0);
  }

  // ---------- Sortie ----------
  const [cx, cz] = survey?.center || [0, 0];
  const pieces = L.pieces.map((p) => {
    const row = [p.name, round(cx + p.x), round(floorY + p.y), round(cz + p.z), round(p.rot)];
    if (p.data) row.push({ ...p.data, ...(p.text ? { text: p.text } : {}) });
    else if (p.text) row.push(p.text);
    return row;
  });
  const worldPaint = paint.map(([kind, type, a, b, c, d, e, f]) => {
    if (type === 0) return [kind, type, round(cx + a), round(cz + b), c, 0, 0, f];
    if (type === 1) return [kind, type, round(cx + a), round(cz + b), c, d, e, f];
    return [kind, type, round(cx + a), round(cz + b), round(cx + c), round(cz + d), e, f];
  });
  const plateau = walls.Rv * ((A + 23) / A);

  const plan = {
    version: 3,
    name: o.name,
    emperor: o.emperor,
    welcome: T.welcome(o.name, o.emperor),
    seed: o.seed,
    size: o.size,
    center: [round(cx), round(cz)],
    floorY,
    radius: R,
    terrain: { radius: Math.ceil(plateau), blend: 12, paint: worldPaint },
    spawn: [round(cx + spawn[0]), round(floorY + spawn[1]), round(cz + spawn[2])],
    arena: arena ? [round(cx + arena.x), round(cz + arena.z), arena.entrance] : null,
    anchor: anchor ? [round(cx + anchor.x), round(cz + anchor.z), anchor.radius] : null,
    parcels: [],
    portals: extra.portals,
    boards: extra.boards,
    proclamation: extra.proclamation,
    pieces,
  };

  info.moat = moat;
  info.streets = streets.reduce((acc, s) => ({ ...acc, [s.kind]: (acc[s.kind] || 0) + 1 }), {});
  info.reserved = { rects: space.rects.map((r) => [r.cx, r.cz, r.hw, r.hd, r.rot].map(round)), circles: space.circles.map((c) => [c.x, c.z, c.r].map(round)) };
  return {
    plan,
    preview: preview(L, geometry, arena),
    info: { ...info, pieces: pieces.length, byDistrict: L.counts, missing: [...L.missing], arena: !!arena },
    layout: L,
  };
}

// Aperçu : boîtes visuelles en coordonnées locales [x, y, z, sx, sy, sz, rot, couleur].
const COLORS = { Stone: 0, Marble: 1, Ashstone: 2, Wood: 3, HardWood: 4, Iron: 5, crafting: 6, npc: 7, deco: 8, roof: 9 };
function preview(L, geometry, arena) {
  const boxes = [];
  for (const p of L.pieces) {
    const g = geometry[p.name];
    const b = g?.vis || g?.col;
    if (!b) continue;
    const [ox, oz] = rotate((b[0] + b[3]) / 2, (b[2] + b[5]) / 2, p.rot);
    let color = COLORS[g.material] ?? COLORS.deco;
    if (/roof/.test(p.name)) color = COLORS.roof;
    if (g.category === 'Crafting') color = COLORS.crafting;
    if (!g.category) color = COLORS.npc;
    boxes.push([round(p.x + ox), round(p.y + (b[1] + b[4]) / 2), round(p.z + oz), round(b[3] - b[0]), round(b[4] - b[1]), round(b[5] - b[2]), p.rot, color]);
  }
  return { boxes, arena: arena ? { x: arena.x, z: arena.z, radius: 22 } : null };
}
