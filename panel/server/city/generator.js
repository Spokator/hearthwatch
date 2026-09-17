// Générateur de ville : à partir du relevé du terrain, des dimensions réelles des pièces du jeu (pieces.json) et de
// la liste de ses objets (items.json), produit la liste exacte des pièces à poser, les formes de terrain et l'aperçu.
// Repère et conventions : voir layout.js ; style et niveaux : voir buildings.js et civic.js.

import { hall, hallRect, HOUSE_PLANS, houseFootprint, lampPost, LEVEL, lowFence, rampart, vikingHouse } from './buildings.js';
import {
  ARENA,
  arena,
  armory,
  armoryContents,
  armoryRect,
  brasserie,
  brasserieRect,
  castle,
  castleRect,
  church,
  churchRect,
  market,
  marketRect,
  warehouse,
  warehouseRect,
} from './civic.js';
import { THEME_COUNT } from './furniture.js';
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
    foundry: 'Fonderie et entrepôt impérial',
    market: (c) => `Marché couvert de ${c}`,
    brasserie: (c) => `Grande Brasserie de ${c}`,
    brasserie2: 'Hydromel, bière et chansons',
    brewery: 'Cuves de brassage',
    armory: 'Armurerie impériale',
    armory2: 'Toutes les armes et armures du royaume',
    armory3: 'Salles d’exposition : une par terre du voyage',
    church: (c) => `Église de ${c}`,
    church2: 'Que les dieux veillent sur nous',
    arena: 'Arène impériale — entrez dans le cercle',
    north: 'Nord : grand-place et château',
    east: 'Est : armurerie et artisans',
    west: 'Ouest : brasserie et arène',
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
    foundry: 'Imperial foundry and warehouse',
    market: (c) => `${c} covered market`,
    brasserie: (c) => `Great mead hall of ${c}`,
    brasserie2: 'Mead, ale and songs',
    brewery: 'Brewing vats',
    armory: 'Imperial armory',
    armory2: 'Every weapon and armor of the realm',
    armory3: 'Exhibition halls: one per land of the journey',
    church: (c) => `Church of ${c}`,
    church2: 'May the gods watch over us',
    arena: 'Imperial arena — step into the circle',
    north: 'North: main square and castle',
    east: 'East: armory and craftsmen',
    west: 'West: mead hall and arena',
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
  const lang = o.language === 'en' ? 'en' : 'fr';
  const T = TEXTS[lang];
  const random = rng(o.seed);
  const L = new Layout(geometry);
  const terrain = new TerrainGrid(survey);
  const paint = []; // [kind, type, a, b, c, d, e, f] en coordonnées locales (f : hauteur absolue d'un creusement)
  const info = { radius: R, districts: [] };
  const extra = { portals: [], boards: [], proclamation: null };
  const floorY = survey?.floorY ?? 0;
  const water = survey?.water ?? 30;
  const V = LEVEL;
  const contents = items.length ? armoryContents(items, geometry, lang) : null;

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
  // Promenade au-delà des douves : chemin, barrière basse côté eau, lampadaires, bancs.
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
        if (end > start) {
          lowFence(f, start, end, 0, 0);
          for (let a = start + 2; a < end; a += 12) lampPost(f, a, -0.6, 0, 0, -1);
        }
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
      lowFence(f, 0, 12, s * 1.75, 0.1);
      for (const a of [2, 12]) f.put('darkwood_pole4', a, s * 2, -4, 0);
      lampPost(f, 14.5, s * 2.6, 0, 0, -s);
    }
    paint.push([PAVED, 2, Math.cos(gate.angle * DEG) * A, Math.sin(gate.angle * DEG) * A, Math.cos(gate.angle * DEG) * (A + 22), Math.sin(gate.angle * DEG) * (A + 22), 4, 0]);
  }
  if (channel) {
    const ang = Math.atan2(channel.z, channel.x);
    const f = L.frame(Math.cos(ang) * promenade, Math.sin(ang) * promenade, -(ang / DEG + 90));
    for (let a = -5; a <= 5; a += 2) f.put('wood_floor', a, 0, 0, 0);
    for (const s of [-1, 1]) lowFence(f, -6, 6, s * 0.8, 0.1);
  }

  // ---------- Grand-place : pierres de départ dans leur fosse, monument, proclamations ----------
  L.district = 'plaza';
  space.reserveCircle(0, 0, P + 2);
  const holeR = anchor ? anchor.radius + 1 : 0;
  if (anchor) {
    for (const [dx, dz, r] of [[0, -1, 0], [0, 1, 180], [1, 0, 270], [-1, 0, 90]])
      for (const t of [-1, 1]) L.put('stone_stair', anchor.x + dx * (holeR - 1) + dz * t, anchor.z + dz * (holeR - 1) + dx * t, 0, r);
    paint.push([KEEP, 0, anchor.x, anchor.z, anchor.radius, 0, 0, 0]);
  }
  // Monument : sur sa propre place au nord quand les pierres occupent le centre (sauf petite ville, faute de place).
  const monument = !anchor || R >= 100;
  const mz = anchor && monument ? P + 10 : 0;
  if (anchor && monument) space.reserve({ cx: 0, cz: mz, hw: 8, hd: 8, rot: 0 });
  if (monument) {
    for (let a = -5; a <= 5; a += 2) for (let b = -5; b <= 5; b += 2) if (Math.abs(a) === 5 || Math.abs(b) === 5) L.put('blackmarble_floor', a, mz + b, V, 0);
    L.put('blackmarble_floor_large', 0, mz, V + 1, 0);
    L.put('blackmarble_column_3', 0, mz, V + 3, 0);
    L.put('piece_EternalPyre', 0, mz, V + 11, 0);
    for (const [a, b, r] of [[-3, -3, 225], [3, -3, 135], [3, 3, 45], [-3, 3, 315]]) L.put('blackmarble_head_big01', a, mz + b, V + 3, r);
    for (const [a, b, r] of [[0, -6.05, 180], [6.05, 0, 90], [0, 6.05, 0], [-6.05, 0, 270]])
      L.put('sign', a, mz + b, V + 0.5, r, { pivot: true, text: r % 180 === 0 ? T.monument(o.emperor) : T.monument2(o.name, o.emperor) });
    for (const [a, b] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) lampPost(L.frame(0, mz, 0), a, b, V, -Math.sign(a), 0);
  }
  for (let k = 0; k < 8; k++) {
    const ang = (22.5 + k * 45) * DEG;
    const x = Math.cos(ang) * (P - 2);
    const z = Math.sin(ang) * (P - 2);
    L.put('darkwood_pole4', x, z, V, 0);
    L.put('darkwood_pole4', x, z, V + 4, 0);
    L.put(k % 2 ? 'piece_banner07' : 'piece_banner02', x + Math.cos(ang) * 0.3, z + Math.sin(ang) * 0.3, V + 7.6, -ang / DEG, { pivot: true });
    L.put('piece_dvergr_lantern', x - Math.cos(ang) * 0.22, z - Math.sin(ang) * 0.22, V + 3.4, -ang / DEG + 180, { pivot: true });
  }
  L.put('darkwood_pole4', 6, -P + 3, V, 0);
  L.put('sign', 6, -P + 2.76, V + 3.1, 180, { pivot: true, text: T.proclamations });
  extra.proclamation = L.put('sign', 6, -P + 2.76, V + 2.4, 180, { pivot: true, text: T.proclamationEmpty });

  // ---------- Château ----------
  L.district = 'palace';
  const plazaTop = anchor && monument ? mz + 8 : P;
  const castleZ = plazaTop + 12;
  let castleDims = null;
  for (const dims of R >= 110 ? [{ W: 32, D: 40 }, { W: 24, D: 32 }] : R >= 100 ? [{ W: 24, D: 32 }, { W: 20, D: 24 }] : [{ W: 20, D: 24 }]) {
    const cr = castleRect(dims);
    const rect = { cx: 0, cz: castleZ - cr.oz, hw: cr.hw, hd: cr.hd, rot: 0 };
    if (!space.fits(rect, 0, { terrain: false })) continue;
    castleDims = dims;
    space.reserve(rect);
    const trophies = contents?.trophies || [];
    castle(L, 0, castleZ, { ...dims, throne: T.throne(o.emperor), palace: T.palace(o.emperor), trophies });
    info.districts.push('palace');
    break;
  }

  // ---------- Arène : sur l'anneau des rues, au sud-ouest ----------
  const M = Math.round((P + 8 + inner) / 2);
  let arenaSite = null;
  if (o.arena) {
    const a = 225 * DEG;
    for (const d of [M, M - 6, M + 6]) {
      const ax = Math.cos(a) * d;
      const az = Math.sin(a) * d;
      const reach = ARENA.outer + 3;
      if (Math.hypot(ax, az) - reach < P + 2 || Math.hypot(ax, az) + reach > inner + 4) continue;
      if (!terrain.flat({ cx: ax, cz: az, hw: reach, hd: reach, rot: 0 })) continue;
      const rot = Math.atan2(Math.sin(a), -Math.cos(a)) / DEG; // +X local vers le centre de la ville
      L.district = 'arena';
      const { gates } = arena(L, ax, az, rot, { sign: T.arena });
      space.reserveCircle(ax, az, reach);
      arenaSite = { x: ax, z: az, rot, gates };
      info.districts.push('arena');
      break;
    }
  }

  // ---------- Place d'accueil ----------
  L.district = 'welcome';
  const spawnZ = -A + 20;
  {
    const f = L.frame(0, spawnZ, 0);
    space.reserve({ cx: 0, cz: spawnZ, hw: 8, hd: 8, rot: 0 });
    f.put('darkwood_pole4', 3.5, 3.5, V, 0);
    f.put('sign', 3.5, 3.26, V + 2.6, 180, { pivot: true, text: T.welcome(o.name, o.emperor) });
    f.put('sign', 3.5, 3.26, V + 1.8, 180, { pivot: true, text: T.north });
    f.put('sign', 3.74, 3.5, V + 2.2, 90, { pivot: true, text: T.east });
    f.put('sign', 3.26, 3.5, V + 2.2, 270, { pivot: true, text: T.west });
    if (survey?.stones) {
      const dx = survey.stones.x - (survey.center?.[0] ?? 0);
      const dz = survey.stones.z - (survey.center?.[1] ?? 0);
      const octant = ((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8;
      f.put('sign', 3.26, 3.5, V + 1.5, 270, { pivot: true, text: T.stones(Math.round(Math.hypot(dx, dz)), T.dirs[octant]) });
    }
    for (const [a, b] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) lampPost(f, a, b, V, -Math.sign(a), 0);
  }
  const spawn = [0, V + 0.2, spawnZ];

  // ---------- Rues : planchers de bois sur le dallage ----------
  const streets = [];
  const addStreet = (x1, z1, x2, z2, w, { kind, check = false }) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 4) return null;
    const rot = -Math.atan2(z2 - z1, x2 - x1) / DEG;
    const rect = { cx: (x1 + x2) / 2, cz: (z1 + z2) / 2, hw: len / 2, hd: w / 2 + 0.2, rot };
    if (check && !space.fits({ ...rect, hw: Math.max(1, rect.hw - rect.hd - 1) }, 0, { terrain: false, radius: A })) return null;
    space.reserve(rect);
    const ux = (x2 - x1) / len;
    const uz = (z2 - z1) / len;
    const street = { x1, z1, x2, z2, w, len, rot, ux, uz, nx: -uz, nz: ux, kind };
    streets.push(street);
    const f = L.frame(x1, z1, rot);
    const tiles = Math.max(1, Math.round(len / 4));
    const start = (len - tiles * 4) / 2;
    for (let k = 0; k < tiles; k++) {
      const t = start + k * 4;
      for (const a of [t + 1, t + 3]) for (let b = -w / 2 + 1; b < w / 2; b += 2) f.put('wood_floor', a, b, V, 0);
    }
    return street;
  };

  L.district = 'streets';
  const ringStreets = (radius) => {
    for (let k = 0; k < 16; k++) {
      const a1 = (k * 22.5 + 11.25) * DEG;
      const a2 = ((k + 1) * 22.5 + 11.25) * DEG;
      addStreet(Math.cos(a1) * radius, Math.sin(a1) * radius, Math.cos(a2) * radius, Math.sin(a2) * radius, 4, { kind: 'ring', check: true });
    }
  };
  ringStreets(M);
  const W2 = inner - 3;
  const wallRoad = W2 - M > 30;
  for (const ang of [45, 135, 225, 315]) {
    const c = Math.cos(ang * DEG);
    const s = Math.sin(ang * DEG);
    addStreet(c * (P + 3), s * (P + 3), c * (M - 2.5), s * (M - 2.5), 4, { kind: 'lane', check: true });
    addStreet(c * (M + 2.5), s * (M + 2.5), c * (wallRoad ? W2 - 2.5 : A - 12), s * (wallRoad ? W2 - 2.5 : A - 12), 4, { kind: 'lane', check: true });
  }
  // Avenues vers les portes et vers le château.
  addStreet(0, -walls.gateEdge, 0, spawnZ - 8, 6, { kind: "avenue" });
  addStreet(0, spawnZ + 8, 0, -P, 6, { kind: 'avenue' });
  addStreet(walls.gateEdge, 0, P, 0, 6, { kind: 'avenue' });
  addStreet(-walls.gateEdge, 0, -P, 0, 6, { kind: 'avenue' });
  if (castleDims) addStreet(0, plazaTop, 0, castleZ - 7, 6, { kind: 'avenue' });
  // Arène : une rue par porte, vers la grand-place, la rue du rempart et les deux côtés de l'anneau.
  if (arenaSite) {
    const [toCenter, side1, toWall, side2] = arenaSite.gates;
    const d = Math.hypot(toCenter[0], toCenter[1]);
    addStreet(toCenter[0], toCenter[1], (toCenter[0] / d) * (P + 1), (toCenter[1] / d) * (P + 1), 4, { kind: 'arena' });
    const dw = Math.hypot(toWall[0], toWall[1]);
    const end = wallRoad ? W2 - 2.5 : inner;
    if (dw < end) addStreet(toWall[0], toWall[1], (toWall[0] / dw) * end, (toWall[1] / dw) * end, 4, { kind: 'arena' });
    for (const g of [side1, side2]) {
      let best = null;
      for (const st of streets.filter((s) => s.kind === 'ring'))
        for (const [px, pz] of [[st.x1, st.z1], [st.x2, st.z2]]) {
          if (Math.abs(Math.hypot(px, pz) - M) > 1) continue;
          const dist = Math.hypot(px - g[0], pz - g[1]);
          if (!best || dist < best.dist) best = { px, pz, dist };
        }
      if (best && best.dist < 45) addStreet(g[0], g[1], best.px, best.pz, 4, { kind: 'arena' });
    }
  }

  // ---------- Quartiers ----------
  // Emplacement libre le plus proche de `pt`, façade (+Z) tournée vers le centre de la ville (ou dos, ou de côté).
  const place = (size, pt, margin = 1) => {
    const tries = [];
    for (let x = -inner; x <= inner; x += 2) for (let z = -inner; z <= inner; z += 2) tries.push([x, z, Math.hypot(x - pt[0], z - pt[1])]);
    tries.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of tries)
      for (const turn of [0, 180, 90, 270]) {
        const rot = Math.atan2(-x, -z) / DEG + turn;
        const r = { hw: size.hw, hd: size.hd, cx: x, cz: z, rot };
        if (space.fits(r, margin)) {
          space.reserve(r);
          // Origine du repère du bâtiment : le centre de l'emprise est en (ox, oz) de ce repère.
          const [dx, dz] = rotate(size.ox || 0, size.oz || 0, rot);
          return { ...r, x: x - dx, z: z - dz };
        }
      }
    return null;
  };
  const outerBand = wallRoad ? (M + W2) / 2 : (M + inner) / 2;
  const innerBand = (P + M) / 2;
  const polar = (deg, radius) => [Math.cos(deg * DEG) * radius, Math.sin(deg * DEG) * radius];
  const district = (key, rect, pt, build) => {
    const r = place(rect, pt);
    if (!r) return null;
    L.district = key;
    const result = build(r);
    info.districts.push(key);
    return result;
  };

  if (contents) info.armory = district('armory', armoryRect, polar(22.5, outerBand), (r) => armory(L, r.x, r.z, r.rot, { contents, name: T.armory, subtitle: T.armory2, texts: { halls: T.armory3 } }));
  district('foundry', warehouseRect, polar(-22.5, outerBand), (r) => warehouse(L, r.x, r.z, r.rot, { name: T.foundry }));
  district('brasserie', brasserieRect, polar(157.5, outerBand), (r) => extra.boards.push(...brasserie(L, r.x, r.z, r.rot, { name: T.brasserie(o.name), subtitle: T.brasserie2, board: T.board, boardEmpty: T.boardEmpty })));
  // La rue du rempart vient après les grands bâtiments : elle s'interrompt à leur hauteur.
  L.district = 'streets';
  if (wallRoad) ringStreets(W2);
  district('church', churchRect, polar(60, outerBand), (r) => church(L, r.x, r.z, r.rot, { name: T.church(o.name), subtitle: T.church2 }));
  district('market', marketRect, polar(-67.5, outerBand), (r) => market(L, r.x, r.z, r.rot, { name: T.market(o.name) }));
  district('portals', { hw: 14, hd: 10 }, polar(-67.5, innerBand), (r) => {
    const f = L.frame(r.x, r.z, r.rot);
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
    for (const [a, b] of [[-13, -9], [13, -9], [-13, 9], [13, 9]]) lampPost(f, a, b, V, -Math.sign(a), 0);
  });

  // Pavillons d'artisans.
  const halls = [
    { key: 'forge', length: 16, pt: polar(120, outerBand), sign: T.forge, fill: (f) => {
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
    { key: 'workshop', length: 16, pt: polar(22.5, innerBand), sign: T.workshop, fill: (f) => {
      f.put('piece_workbench', -5, -1.5, V, 0);
      f.put('piece_workbench_ext1', -7, 1.2, V, 0);
      f.put('piece_workbench_ext2', -5, 1.4, V, 0);
      f.put('piece_workbench_ext3', -2.5, 1.4, V, 0);
      f.put('piece_workbench_ext4', -5, -3.35, V + 1.4, 0);
      f.put('piece_stonecutter', 0.5, -1.5, V, 0);
      f.put('piece_artisanstation', 5, -1.5, V, 0);
      f.put('artisan_ext1', 5, 1.4, V, 0);
    } },
    { key: 'kitchen', length: 20, pt: polar(157.5, innerBand), sign: T.kitchen, fill: (f) => {
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
    { key: 'mage', length: 8, pt: polar(-22.5, innerBand), sign: T.mage, dark: false, fill: (f) => {
      f.put('piece_magetable', -0.5, -1.2, V, 0);
      f.put('piece_magetable_ext', 2.6, 0.8, V, 0);
      f.put('piece_magetable_ext2', -2.8, 1.4, V, 0);
      f.put('piece_magetable_ext3', 2.2, -3.35, V + 1.4, 0);
      f.put('piece_magetable_ext4', 0.5, 2, V, 180);
    } },
  ];
  for (const h of halls) {
    const size = { ...hallRect(h.length), oz: 1 };
    district(h.key, size, h.pt, (r) => h.fill(hall(L, r.x, r.z, r.rot, h.length, { sign: h.sign, dark: h.dark !== false })));
  }

  // ---------- Maisons le long des rues : plans et intérieurs tous différents ----------
  let houses = 0;
  const maxHouses = { ville: 10, cite: 18, capitale: 24 }[o.size] || 18;
  const doors = [];
  const planOrder = HOUSE_PLANS.map((_, i) => i).sort(() => random() - 0.5);
  const themeOffset = Math.floor(random() * THEME_COUNT);
  // Essaie de bâtir une maison le long d'une rue, à `t` m de son début, en retrait de `setback` m (chemin de planches).
  const tryHouse = (st, side, t, setback) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const plan = HOUSE_PLANS[planOrder[(houses + attempt) % planOrder.length]];
      const fp = houseFootprint(plan);
      const along = fp.x1 - fp.x0;
      if (t + along > st.len - 3) continue;
      // Repère de la maison : +Z vers la rue, seuil (z1) au bord du plancher de la rue (ou du chemin).
      const rot = Math.atan2(-side * st.nx, -side * st.nz) / DEG;
      const t0 = side > 0 ? t + fp.x1 : t - fp.x0;
      const offset = st.w / 2 + fp.z1 + setback;
      const hx = st.x1 + st.ux * t0 + st.nx * side * offset;
      const hz = st.z1 + st.uz * t0 + st.nz * side * offset;
      // Emprise arrêtée 0,3 m avant la rue (des rectangles qui se touchent passeraient pour chevauchants aux arrondis près).
      const [cxl, czl] = rotate((fp.x0 + fp.x1) / 2, (fp.z0 - 1 + fp.z1 - 0.3) / 2, rot);
      const rect = { cx: hx + cxl, cz: hz + czl, hw: along / 2 + 1, hd: (fp.z1 - 0.3 - (fp.z0 - 1)) / 2, rot };
      if (!space.fits(rect, 0)) continue;
      // Le chemin (toute la largeur de la maison) doit être libre jusqu'à la rue.
      let lane = null;
      if (setback > 0) {
        const [lx, lz] = rotate((fp.x0 + fp.x1) / 2, fp.z1 + setback / 2 - 0.1, rot);
        lane = { cx: hx + lx, cz: hz + lz, hw: along / 2, hd: setback / 2 - 0.2, rot };
        if (!space.fits(lane, 0, { terrain: false })) continue;
      }
      space.reserve(rect);
      if (lane) space.reserve(lane);
      // Chaque maison : son plan (en rotation) et un intérieur décalé (13 plans × 10 intérieurs).
      const { door } = vikingHouse(L, hx, hz, rot, plan, random, (houses * 7 + themeOffset) % THEME_COUNT);
      doors.push(door);
      if (setback > 0) {
        const f = L.frame(door[0], door[1], rot);
        for (let d = 1; d < setback; d += 2) f.put('wood_floor', 0, d, V, 0);
        lampPost(f, 1.6, setback - 1, V, -1, 0);
      }
      houses++;
      return along;
    }
    return 0;
  };
  if (o.houses) {
    L.district = 'houses';
    for (const setback of [0, 8, 14])
      for (const kind of ['avenue', 'ring', 'lane', 'arena'])
        for (const st of streets.filter((s) => s.kind === kind))
          for (const side of [1, -1]) {
            let t = 3;
            while (t < st.len - 3 && houses < maxHouses) {
              const along = tryHouse(st, side, t, setback);
              t += along ? along + 3 + random() * 3 : 2;
            }
          }
    info.districts.push('houses');
  }
  info.houses = houses;

  // ---------- Barrières basses le long des rues bordant un terrain libre, lampadaires ----------
  L.district = 'fences';
  for (const st of streets) {
    const f = L.frame(st.x1, st.z1, st.rot);
    const fenced = { 1: [], '-1': [] };
    for (const side of [1, -1]) {
      const z = side * (st.w / 2 - 0.25);
      let run = null;
      let end = null;
      const flush = () => {
        if (run !== null && end - run >= 4) {
          lowFence(f, run, end, z, V);
          fenced[side].push([run, end]);
        }
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
    // Lampadaires tous les 12 m en alternant les côtés, hors carrefours et devant les portes.
    let k = 0;
    for (let t = 4; t <= st.len - 4; t += 12, k++) {
      const side = k % 2 ? 1 : -1;
      const z = side * (st.w / 2 - 0.25);
      const [px, pz] = f.at(t, z);
      if (doors.some(([dx, dz]) => Math.hypot(dx - px, dz - pz) < 3)) continue;
      if (streets.some((other) => other !== st && segmentDistance(px, pz, other.x1, other.z1, other.x2, other.z2) < other.w / 2 + 1.5)) continue;
      lampPost(f, t, z, V, 0, -side);
    }
  }

  // Gardes nains autour de la grand-place et devant le château.
  if (o.guards) {
    L.district = 'guards';
    for (const [a, b] of [[P - 3, 4], [-P + 3, 4], [4, -P + 3], [-4, castleZ - 3], [4, castleZ - 3]]) L.put('Dverger', a, b, V, 0);
  }

  // ---------- Dallage de pierre continu sous toute la ville ----------
  L.district = 'ground';
  {
    const normals = walls.vertices.map((_, k) => {
      const a = (k + 1) * 2 * walls.half * DEG;
      return [Math.cos(a), Math.sin(a)];
    });
    const gateDirs = walls.gates.map((g) => [Math.cos(g.angle * DEG), Math.sin(g.angle * DEG)]);
    const cell = (cx, cz) => {
      for (const [nx, nz] of normals) if (cx * nx + cz * nz > A - 0.4) return false;
      for (const [gx, gz] of gateDirs) if (cx * gx + cz * gz > walls.gateEdge && Math.abs(cx * gz - cz * gx) < 5) return false;
      if (anchor && Math.hypot(cx - anchor.x, cz - anchor.z) < holeR) return false;
      return true;
    };
    const n = Math.ceil(A / 4) + 1;
    for (let i = -n; i < n; i++)
      for (let j = -n; j < n; j++) {
        const x0 = 4 * i;
        const z0 = 4 * j;
        const inside = [[1, 1], [3, 1], [1, 3], [3, 3]].map(([a, b]) => cell(x0 + a, z0 + b));
        if (inside.every(Boolean)) L.put('stone_floor', x0 + 2, z0 + 2, 0, 0);
        else inside.forEach((ok, q) => ok && L.put('stone_floor_2x2', x0 + [1, 3, 1, 3][q], z0 + [1, 1, 3, 3][q], 0, 0));
      }
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
    version: 5,
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
    // Arène : [x, z, orientation, hauteur du sol au-dessus du nivellement, rayon du cercle] ; structure bâtie par la ville.
    arena: arenaSite ? [round(cx + arenaSite.x), round(cz + arenaSite.z), round(arenaSite.rot), V, ARENA.fight] : null,
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
    preview: preview(L, geometry, arenaSite),
    info: { ...info, pieces: pieces.length, byDistrict: L.counts, missing: [...L.missing], arena: !!arenaSite },
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
  return { boxes, arena: arena ? { x: arena.x, z: arena.z, radius: ARENA.outer } : null };
}
