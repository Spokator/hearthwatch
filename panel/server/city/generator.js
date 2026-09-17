// Générateur de ville : à partir du relevé du terrain et des dimensions réelles des pièces du jeu (pieces.json,
// exporté par le plugin), produit la liste exacte des pièces à poser, les formes de terrain et l'aperçu.
// Repère et conventions : voir layout.js.

import { brasserie, brasserieRect, hall, hallRect, HOUSE_TYPES, houseLot, rampart, tower, vikingHouse } from './buildings.js';
import { DEG, Layout, rng, rotate, round, segmentDistance, Space, TerrainGrid } from './layout.js';

export const SIZES = { ville: 80, cite: 100, capitale: 120 };

const PAVED = 0;
const DIRT = 1;
const CULTIVATED = 2;
const KEEP = 5;
const DIG = 6;

const TEXTS = {
  fr: {
    welcome: (c, e) => `Bienvenue à ${c}, cité de l'Empereur ${e} !`,
    monument: (e) => `${e}, Empereur. Gloire éternelle !`,
    monument2: (c, e) => `${c} fut bâtie à la gloire de ${e}`,
    palace: (e) => `Palais impérial de ${e}`,
    throne: (e) => `Trône de l'Empereur ${e}`,
    forge: 'Forge impériale',
    workshop: 'Atelier des bâtisseurs',
    kitchen: 'Cuisines et fumoir',
    mage: 'Cercle des mages',
    foundry: 'Fonderie et moulins',
    market: (c) => `Marché de ${c}`,
    brasserie: (c) => `Grande Brasserie de ${c}`,
    brasserie2: 'Hydromel, bière et chansons',
    arena: 'Arène impériale — entrez dans le cercle',
    north: 'Nord : grand-place et palais',
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
    promenade: 'Promenade des douves',
    stones: (d, dir) => `Pierres sacrées : ${d} m ${dir}`,
    dirs: ['à l’est', 'au nord-est', 'au nord', 'au nord-ouest', 'à l’ouest', 'au sud-ouest', 'au sud', 'au sud-est'],
    tags: ['Prairies', 'Forêt noire', 'Marais', 'Montagnes', 'Plaines', 'Brumes', 'Cendres', 'Nord'],
  },
  en: {
    welcome: (c, e) => `Welcome to ${c}, city of Emperor ${e}!`,
    monument: (e) => `${e}, Emperor. Eternal glory!`,
    monument2: (c, e) => `${c} was raised to the glory of ${e}`,
    palace: (e) => `Imperial palace of ${e}`,
    throne: (e) => `Throne of Emperor ${e}`,
    forge: 'Imperial forge',
    workshop: 'Builders’ workshop',
    kitchen: 'Kitchens and smokehouse',
    mage: 'Circle of mages',
    foundry: 'Foundry and mills',
    market: (c) => `${c} market`,
    brasserie: (c) => `Great mead hall of ${c}`,
    brasserie2: 'Mead, ale and songs',
    arena: 'Imperial arena — step into the circle',
    north: 'North: main square and palace',
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
    promenade: 'Moat promenade',
    stones: (d, dir) => `Sacred stones: ${d} m ${dir}`,
    dirs: ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'],
    tags: ['Meadows', 'Black Forest', 'Swamp', 'Mountains', 'Plains', 'Mistlands', 'Ashlands', 'Deep North'],
  },
};

export function generateCity({ geometry, survey, options }) {
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

  // ---------- Muraille ----------
  const walls = rampart(L, R, [0, 180, 270]);
  const A = walls.apothem;
  const inner = A - 13; // les bâtiments restent en deçà de la rue du rempart
  const space = new Space(inner, terrain);
  info.apothem = Math.round(A);

  const anchor = survey?.anchor
    ? { x: survey.anchor.x - (survey.center?.[0] ?? 0), z: survey.anchor.z - (survey.center?.[1] ?? 0), radius: Math.min(12, survey.anchor.radius) }
    : null;
  const P = Math.max(Math.round(Math.min(24, Math.max(14, R * 0.2))), anchor ? anchor.radius + 10 : 0);
  let palaceD = Math.round(Math.min(32, Math.max(20, R * 0.3)) / 4) * 4;
  const palaceZ = P + 8 + (anchor ? 18 : 0);
  palaceD = Math.max(16, Math.min(palaceD, Math.floor((inner - palaceZ - 2) / 4) * 4));
  const palaceW = palaceD + 4;

  // Polygone parallèle à la muraille, à la distance `d` du centre (apothème).
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
  // Canal vers l'eau la plus proche (mer, lac ou rivière) que le jeu peut creuser.
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
        if (best && len >= best.len) continue;
        if (isGate(x, z) || isGate(sx, sz)) continue;
        let ok = true;
        for (let s = 0; s <= len; s += 2) {
          const px = sx + ((x - sx) * s) / len;
          const pz = sz + ((z - sz) * s) / len;
          const nat = terrain.natural(px, pz);
          if (nat === null || floorY + nat - moatBottom > 7.8) {
            ok = false;
            break;
          }
        }
        if (ok) best = { sx, sz, x, z, len };
      }
    if (best) {
      channel = best;
      paint.push([DIG, 2, best.sx, best.sz, best.x + (best.x / Math.hypot(best.x, best.z)) * 4, best.z + (best.z / Math.hypot(best.x, best.z)) * 4, 6, moatBottom]);
      info.channel = Math.round(best.len);
    }
  }
  // Promenade au-delà des douves : chemin, barrière côté eau, lanternes et bancs.
  const promenade = A + 19;
  for (const [[x1, z1], [x2, z2]] of edges(promenade)) paint.push([DIRT, 2, x1, z1, x2, z2, 3.5, 0]);
  for (const [[x1, z1], [x2, z2]] of edges(A + 16)) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const rot = -Math.atan2(z2 - z1, x2 - x1) / DEG;
    for (let t = 1.35; t < len - 1; t += 2.7) {
      const x = x1 + ((x2 - x1) * t) / len;
      const z = z1 + ((z2 - z1) * t) / len;
      if (isGate(x, z)) continue;
      if (channel && segmentDistance(x, z, channel.sx, channel.sz, channel.x, channel.z) < 5) continue;
      L.put('wood_fence', x, z, 0, rot);
    }
  }
  ring(promenade + 2.5).forEach(([x, z], k) => {
    if (isGate(x, z)) return;
    L.put('piece_dvergr_lantern_pole', x, z, 0, -Math.atan2(z, x) / DEG, { pivotXZ: true });
    if (k % 2 === 0) {
      const [[x1, z1], [x2, z2]] = edges(promenade + 2.3)[k];
      const mx = (x1 + x2) / 2;
      const mz = (z1 + z2) / 2;
      if (!isGate(mx, mz)) L.put('piece_logbench01', mx, mz, 0, -Math.atan2(z2 - z1, x2 - x1) / DEG + 180);
    }
  });
  // Ponts aux portes : tablier de planches, garde-corps, piles, lanternes.
  const bridge = (angle, from, to, width) => {
    const f = L.frame(Math.cos(angle * DEG) * from, Math.sin(angle * DEG) * from, -angle);
    const len = to - from;
    for (let a = 1; a < len; a += 2) for (let b = -width / 2 + 1; b < width / 2; b += 2) f.put('wood_floor', a, b, 0, 0);
    for (let a = 1.35; a < len; a += 2.7) for (const s of [-1, 1]) f.put('wood_fence', a, s * (width / 2 + 0.1), 0.1, 0);
    for (const a of [2, len - 2]) for (const s of [-1, 1]) f.put('darkwood_pole4', a, s * (width / 2 - 0.2), -4, 0);
    return f;
  };
  L.district = 'bridges';
  for (const gate of walls.gates) {
    const f = bridge(gate.angle, A + 3, A + 17, 4);
    for (const s of [-1, 1]) f.put('piece_dvergr_lantern_pole', 15.5, s * 3, 0, s > 0 ? 270 : 90, { pivotXZ: true });
    paint.push([PAVED, 2, Math.cos(gate.angle * DEG) * A, Math.sin(gate.angle * DEG) * A, Math.cos(gate.angle * DEG) * (A + 22), Math.sin(gate.angle * DEG) * (A + 22), 4, 0]);
  }
  if (channel) {
    // Passerelle de la promenade au-dessus du canal.
    const ang = Math.atan2(channel.z, channel.x);
    const cx = Math.cos(ang) * promenade;
    const cz = Math.sin(ang) * promenade;
    const f = L.frame(cx, cz, -(ang / DEG + 90));
    for (let a = -5; a <= 5; a += 2) f.put('wood_floor', a, 0, 0, 0);
    for (let a = -4.65; a < 5; a += 2.7) for (const s of [-1, 1]) f.put('wood_fence', a, s * 1.1, 0.1, 0);
  }

  // ---------- Centre : grand-place, monument, palais, arène, place d'accueil ----------
  L.district = 'plaza';
  paint.push([PAVED, 0, 0, 0, P, 0, 0, 0]);
  if (anchor) paint.push([KEEP, 0, anchor.x, anchor.z, anchor.radius, 0, 0, 0]);
  space.reserveCircle(0, 0, P + 3);
  const mz = anchor ? P + 10 : 0;
  if (anchor) space.reserve({ cx: 0, cz: mz, hw: 8, hd: 8, rot: 0 });
  for (let a = -5; a <= 5; a += 2) for (let b = -5; b <= 5; b += 2) if (Math.abs(a) === 5 || Math.abs(b) === 5) L.put('blackmarble_floor', a, mz + b, 0, 0);
  L.put('blackmarble_floor_large', 0, mz, 1, 0);
  L.put('blackmarble_floor_large', 0, mz, -1, 0);
  L.put('blackmarble_column_3', 0, mz, 3, 0);
  L.put('piece_EternalPyre', 0, mz, 11, 0);
  for (const [a, b, r] of [[-3, -3, 225], [3, -3, 135], [3, 3, 45], [-3, 3, 315]]) L.put('blackmarble_head_big01', a, mz + b, 3, r);
  for (const [a, b, r] of [[0, -6.05, 180], [6.05, 0, 90], [0, 6.05, 0], [-6.05, 0, 270]])
    L.put('sign', a, mz + b, 0.5, r, { pivot: true, text: r % 180 === 0 ? T.monument(o.emperor) : T.monument2(o.name, o.emperor) });
  for (let k = 0; k < 8; k++) {
    const ang = (22.5 + k * 45) * DEG;
    const x = Math.cos(ang) * (P - 2);
    const z = Math.sin(ang) * (P - 2);
    L.put('darkwood_pole4', x, z, 0, 0);
    L.put('darkwood_pole4', x, z, 4, 0);
    L.put(k % 2 ? 'piece_banner07' : 'piece_banner02', x + Math.cos(ang) * 0.3, z + Math.sin(ang) * 0.3, 7.6, -ang / DEG, { pivot: true });
  }
  for (let k = 0; k < 4; k++) {
    const ang = (45 + k * 90) * DEG;
    const d = anchor ? P - 5 : 9;
    L.put('piece_brazierfloor01', Math.cos(ang) * d, Math.sin(ang) * d, 0, 0);
  }
  L.put('darkwood_pole4', 3, -P + 1, 0, 0);
  L.put('sign', 3, -P + 0.76, 3.1, 180, { pivot: true, text: T.proclamations });
  extra.proclamation = L.put('sign', 3, -P + 0.76, 2.4, 180, { pivot: true, text: T.proclamationEmpty });

  // Palais impérial.
  L.district = 'palace';
  {
    const W = palaceW;
    const D = palaceD;
    const z0 = palaceZ;
    space.reserve({ cx: 0, cz: z0 + D / 2, hw: W / 2 + 5, hd: D / 2 + 8, rot: 0 });
    paint.push([PAVED, 1, 0, z0 - 3, W / 2 + 3, 3, 0, 0]);
    for (let a = -W / 2 + 2; a < W / 2; a += 4) for (let b = z0 - 2; b < z0 + D; b += 4) L.put('stone_floor', a, b, 0, 0);
    for (let a = -3; a <= 3; a += 2) L.put('stone_stair', a, z0 - 5, 0, 180);
    const wallPiece = 'Piece_grausten_wall_4x2';
    for (let a = -W / 2 + 2; a < W / 2; a += 4)
      for (let row = 0; row < 4; row++) {
        if (!(Math.abs(a) < 3 && row < 2)) L.put(wallPiece, a, z0, 1 + row * 2, 0);
        L.put(wallPiece, a, z0 + D, 1 + row * 2, 0);
      }
    for (let b = z0 + 2; b < z0 + D; b += 4) for (let row = 0; row < 4; row++) for (const a of [-W / 2, W / 2]) L.put(wallPiece, a, b, 1 + row * 2, 90);
    for (let a = -W / 2 + 2; a < W / 2; a += 4) for (let b = z0 + 2; b < z0 + D; b += 4) L.put('stone_floor', a, b, 9, 0);
    for (let a = -W / 2 + 2.5; a < W / 2 - 2; a += 2) {
      L.put('stone_wall_1x1', a, z0 + 0.5, 10, 0);
      L.put('stone_wall_1x1', a, z0 + D - 0.5, 10, 0);
    }
    for (let b = z0 + 2.5; b < z0 + D - 2; b += 2) {
      L.put('stone_wall_1x1', -W / 2 + 0.5, b, 10, 0);
      L.put('stone_wall_1x1', W / 2 - 0.5, b, 10, 0);
    }
    for (const a of [-9, -5, 5, 9]) L.put('blackmarble_column_3', a, z0 - 3, 1, 0);
    for (let a = -10; a <= 10; a += 4) L.put('stone_floor', a, z0 - 2, 9, 0);
    for (const a of [-2.2, 2.2]) L.put('piece_banner02', a, z0 - 0.35, 8.8, 90, { pivot: true });
    for (const a of [-7, 7]) L.put('piece_banner07', a, z0 - 0.35, 8.8, 90, { pivot: true });
    L.put('sign', 0, z0 - 0.3, 6, 180, { pivot: true, text: T.palace(o.emperor) });
    for (const [a, b] of [[-W / 2, z0], [W / 2, z0], [-W / 2, z0 + D], [W / 2, z0 + D]]) tower(L, a, b, a < 0 ? 180 : 0, 12, { banner: 'piece_banner07' });
    for (let b = z0 + 3; b < z0 + D - 4; b += 3) L.put('jute_carpet_blue', 0, b, 1, 0);
    for (let a = -3; a <= 3; a += 2) L.put('blackmarble_floor', a, z0 + D - 3, 1, 0);
    L.put('piece_blackmarble_throne', 0, z0 + D - 3, 2, 180);
    L.put('sign', 0, z0 + D - 4.05, 1.5, 180, { pivot: true, text: T.throne(o.emperor) });
    for (const b of [z0 + 4, z0 + D - 6]) {
      L.put('piece_dvergr_lantern_pole', -3.5, b, 1, 180, { pivotXZ: true });
      L.put('piece_dvergr_lantern_pole', 3.5, b, 1, 0, { pivotXZ: true });
    }
    for (const a of [-6, 6]) for (let b = z0 + 5; b < z0 + D - 3; b += 6) L.put('blackmarble_column_3', a, b, 1, 0);
    for (const a of [-4, 4]) L.put('piece_banner07', a, z0 + D - 0.35, 8.5, 90, { pivot: true });
    info.districts.push('palace');
  }

  // Arène impériale (bâtie par le plugin) au sud-ouest, porte tournée vers la grand-place.
  let arena = null;
  if (o.arena) {
    const minD = P + 26;
    const maxD = A - 12 - 25;
    if (maxD >= minD) {
      const d = Math.min(maxD, Math.max(minD, P + 30));
      const ax = -d * Math.SQRT1_2;
      const az = -d * Math.SQRT1_2;
      if (terrain.flat({ cx: ax, cz: az, hw: 22, hd: 22, rot: 0 })) {
        arena = { x: ax, z: az, entrance: -45 };
        space.reserveCircle(ax, az, 25);
        L.district = 'arena';
        const [gx, gz] = [ax + Math.SQRT1_2 * 29, az + Math.SQRT1_2 * 29];
        paint.push([PAVED, 2, gx, gz, -P * Math.SQRT1_2, -P * Math.SQRT1_2, 7, 0]);
        L.put('piece_brazierfloor01', gx - 3, gz + 3, 0, 0);
        L.put('piece_brazierfloor01', gx + 3, gz - 3, 0, 0);
        L.put('darkwood_pole4', gx + 2.5, gz + 2.5, 0, 0);
        L.put('sign', gx + 2.2, gz + 2.2, 2.4, 45, { pivot: true, text: T.arena });
        info.districts.push('arena');
      }
    }
  }

  // Place d'accueil derrière la porte sud.
  L.district = 'welcome';
  const spawnZ = -A + 22;
  paint.push([PAVED, 0, 0, spawnZ, 9, 0, 0, 0]);
  space.reserveCircle(0, spawnZ, 10);
  L.put('darkwood_pole4', 3.5, spawnZ + 3.5, 0, 0);
  L.put('sign', 3.5, spawnZ + 3.26, 2.6, 180, { pivot: true, text: T.welcome(o.name, o.emperor) });
  L.put('sign', 3.5, spawnZ + 3.26, 1.8, 180, { pivot: true, text: T.north });
  L.put('sign', 3.74, spawnZ + 3.5, 2.2, 90, { pivot: true, text: T.east });
  L.put('sign', 3.26, spawnZ + 3.5, 2.2, 270, { pivot: true, text: arena ? T.west : T.gate(o.name) });
  for (const [a, b] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) L.put('piece_groundtorch', a, spawnZ + b, 0, 0);
  if (survey?.stones) {
    const dx = survey.stones.x - (survey.center?.[0] ?? 0);
    const dz = survey.stones.z - (survey.center?.[1] ?? 0);
    const octant = ((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    L.put('sign', 3.26, spawnZ + 3.5, 1.5, 270, { pivot: true, text: T.stones(Math.round(Math.hypot(dx, dz)), T.dirs[octant]) });
  }
  const spawn = [0, 0.2, spawnZ];

  // ---------- Rues ----------
  const streets = [];
  const addStreet = (x1, z1, x2, z2, w, { kind, sides = [1, -1], check = false, pave = PAVED }) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 6) return null;
    const rot = -Math.atan2(z2 - z1, x2 - x1) / DEG;
    const rect = { cx: (x1 + x2) / 2, cz: (z1 + z2) / 2, hw: len / 2, hd: w / 2 + 0.5, rot };
    // Contrôle sans les extrémités : deux tronçons consécutifs se touchent forcément à leur jonction.
    if (check && !space.fits({ ...rect, hw: Math.max(1, rect.hw - rect.hd - 1) }, 0, { terrain: false, radius: A })) return null;
    space.reserve(rect);
    paint.push([pave, 2, x1, z1, x2, z2, w, 0]);
    const ux = (x2 - x1) / len;
    const uz = (z2 - z1) / len;
    const street = { x1, z1, x2, z2, w, len, rot, ux, uz, nx: -uz, nz: ux, sides, kind };
    streets.push(street);
    return street;
  };

  // Anneau intermédiaire (16 segments) et ruelles en diagonale, coupés là où un quartier réservé les traverse.
  L.district = 'streets';
  const M = Math.round((P + 6 + inner) / 2);
  for (let k = 0; k < 16; k++) {
    const a1 = (k * 22.5 + 11.25) * DEG;
    const a2 = ((k + 1) * 22.5 + 11.25) * DEG;
    addStreet(Math.cos(a1) * M, Math.sin(a1) * M, Math.cos(a2) * M, Math.sin(a2) * M, 5, { kind: 'ring', check: true });
  }
  for (const ang of [45, 135, 225, 315]) {
    const c = Math.cos(ang * DEG);
    const s = Math.sin(ang * DEG);
    addStreet(c * (P + 4), s * (P + 4), c * (M - 3), s * (M - 3), 4, { kind: 'lane', check: true, pave: DIRT });
    addStreet(c * (M + 3), s * (M + 3), c * (A - 13), s * (A - 13), 4, { kind: 'lane', check: true, pave: DIRT });
  }
  // Avenues vers les portes et vers le palais, bordées de lanternes.
  const avenues = [
    addStreet(0, -A, 0, -P, 9, { kind: 'avenue' }),
    addStreet(A, 0, P, 0, 9, { kind: 'avenue' }),
    addStreet(-A, 0, -P, 0, 9, { kind: 'avenue' }),
    addStreet(0, P, 0, palaceZ - 6, 9, { kind: 'avenue', sides: [] }),
  ];
  for (const av of avenues.slice(0, 3))
    for (let d = 10; d < av.len - 6; d += 12)
      for (const side of [1, -1]) {
        const x = av.x1 + av.ux * d + av.nx * side * 5.6;
        const z = av.z1 + av.uz * d + av.nz * side * 5.6;
        L.put('piece_dvergr_lantern_pole', x, z, 0, av.rot + (side > 0 ? 270 : 90), { pivotXZ: true });
      }
  // Chemin de ronde intérieur : rue pavée au pied de la muraille (les maisons ne la bordent que côté ville).
  for (const [[x1, z1], [x2, z2]] of edges(A - 10)) {
    paint.push([PAVED, 2, x1, z1, x2, z2, 6, 0]);
    const len = Math.hypot(x2 - x1, z2 - z1);
    streets.push({ x1, z1, x2, z2, w: 6, len, rot: -Math.atan2(z2 - z1, x2 - x1) / DEG, ux: (x2 - x1) / len, uz: (z2 - z1) / len, nx: -(z2 - z1) / len, nz: (x2 - x1) / len, sides: [1], kind: 'wallroad' });
  }

  // ---------- Quartiers ----------
  const place = (size, anchorPt, rotations, margin = 2) => {
    const tries = [];
    for (let x = -inner; x <= inner; x += 2) for (let z = -inner; z <= inner; z += 2) tries.push([x, z, Math.hypot(x - anchorPt[0], z - anchorPt[1])]);
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
  const Q = Math.max(P + 18, inner * 0.55);

  // Place des portails.
  {
    const r = place({ hw: 14, hd: 10 }, [-Q * 0.2, -Q * 0.75], [0, 90]);
    if (r) {
      L.district = 'portals';
      const f = L.frame(r.cx, r.cz, r.rot);
      paint.push([PAVED, 1, r.cx, r.cz, 13.5, 9.5, r.rot, 0]);
      T.tags.forEach((tag, k) => {
        const back = k < 4;
        const x = -9 + (k % 4) * 6;
        const idx = f.put('portal_wood', x, back ? -6 : 6, 0, back ? 0 : 180);
        const pz = back ? -3.2 : 3.2;
        f.put('wood_pole2', x + 2.6, pz, 0, 0);
        const sign = f.put('sign', x + 2.6, back ? pz + 0.24 : pz - 0.24, 1.5, back ? 0 : 180, { pivot: true, text: T.portal(tag) });
        extra.portals.push([idx, tag, sign]);
      });
      f.put('darkwood_pole4', 0, 0, 0, 0);
      for (const [b, rr] of [[0.24, 0], [-0.24, 180]]) {
        f.put('sign', 0, b, 3, rr, { pivot: true, text: T.portals });
        f.put('sign', 0, b, 2.3, rr, { pivot: true, text: T.portalHelp });
      }
      for (const [a, b] of [[-13, -9], [13, -9], [-13, 9], [13, 9]]) f.put('piece_groundtorch_blue', a, b, 0, 0);
      info.districts.push('portals');
    }
  }
  // Marché : Haldor, Hildir, la sorcière des marais, barbier, table de cartographie.
  {
    const r = place({ hw: 13, hd: 13 }, [Q * 0.6, -Q * 0.8], [0]);
    if (r) {
      L.district = 'market';
      const f = L.frame(r.cx, r.cz, 0);
      paint.push([PAVED, 1, r.cx, r.cz, 12, 12, 0, 0]);
      const stall = (lx, lz, rot, npc) => {
        const s = L.frame(...f.at(lx, lz), rot);
        for (const [a, b] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) s.put('darkwood_pole4', a, b, 0, 0);
        for (const a of [-1, 1]) {
          s.put('wood_roof_45', a, 2, 4, 0, { pivot: true });
          s.put('wood_roof_45', a, -2, 4, 180, { pivot: true });
          s.put('wood_roof_top_45', a, 0, 5, 0, { pivot: true });
        }
        s.put('jute_carpet_blue', 0, 0, 0, 0);
        s.put(npc, 0, -0.6, 0, 0);
        s.put('piece_table', 0, 1.9, 0, 0);
        s.put('piece_groundtorch', -1.4, -1.3, 0, 0);
        s.put('piece_banner07', 1.9, 2.05, 3.8, 0, { pivot: true });
        s.put('wood_stack', 2.8, -1.2, 0, 90);
      };
      stall(-7, 7, 180, 'Haldor');
      stall(7, 7, 180, 'Hildir');
      const bog = L.frame(...f.at(0, -7), 0);
      bog.put('rug_wolf', 0, 0, 0, 0);
      bog.put('BogWitch', 0, -1, 0, 0);
      for (const [a, b] of [[-3, 1.5], [3, 1.5]]) bog.put('piece_groundtorch_green', a, b, 0, 0);
      f.put('piece_barber', -9, -8, 0, 45);
      f.put('piece_cartographytable', 9, -8, 0, 315);
      f.put('darkwood_pole4', 0, 10, 0, 0);
      f.put('sign', 0, 9.76, 2.4, 180, { pivot: true, text: T.market(o.name) });
      for (const [a, b] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) f.put('piece_dvergr_lantern_pole', a, b, 0, 45, { pivotXZ: true });
      info.districts.push('market');
    }
  }
  // Grande brasserie.
  {
    const r = place(brasserieRect, [-Q * 0.55, -Q * 0.35], [0, 90, 180, 270], 2);
    if (r) {
      L.district = 'brasserie';
      extra.boards.push(...brasserie(L, r.cx, r.cz, r.rot, { name: T.brasserie(o.name), subtitle: T.brasserie2, board: T.board, boardEmpty: T.boardEmpty }));
      paint.push([PAVED, 1, r.cx, r.cz, r.hw, r.hd, r.rot, 0]);
      info.districts.push('brasserie');
    }
  }
  // Fonderie en plein air.
  {
    const r = place({ hw: 15, hd: 9 }, [Q * 0.9, -Q * 0.35], [0, 90]);
    if (r) {
      L.district = 'foundry';
      const f = L.frame(r.cx, r.cz, r.rot);
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot, 0]);
      f.put('smelter', -12, -4, 0, 0);
      f.put('charcoal_kiln', -6.5, -4, 0, 0);
      f.put('blastfurnace', -1, -4, 0, 0);
      f.put('eitrrefinery', 5, -4, 0, 0);
      f.put('windmill', 11.5, -3, 0, 0);
      f.put('piece_spinningwheel', -12, 4, 0, 180);
      f.put('piece_FrostKiln', -5, 3.5, 0, 180);
      f.put('piece_FrostFoundry', 2, 4.5, 0, 180);
      f.put('incinerator', 6.5, 5, 0, 180);
      for (const a of [10, 12, 14]) f.put('piece_beehive', a, 6, 0, 180);
      for (let a = -14; a <= 14; a += 2) f.put('stone_fence', a, -8.5, 0, 0);
      for (const a of [-14.5, 14.5]) f.put('wood_stack', a, 7.5, 0, 0);
      f.put('darkwood_pole4', 0, 8.6, 0, 0);
      f.put('sign', 0, 8.84, 2.2, 0, { pivot: true, text: T.foundry });
      info.districts.push('foundry');
    }
  }
  // Forge.
  {
    const pt = [Q * 0.8, Q * 0.45];
    const r = place(hallRect(16), pt, face(pt));
    if (r) {
      L.district = 'crafts';
      const f = hall(L, r.cx, r.cz, r.rot, 16, { sign: T.forge });
      f.put('forge', -4, -1, 0, 0);
      f.put('forge_ext1', -5.8, -1, 0, 0);
      f.put('forge_ext2', -2.2, -1.5, 0, 0);
      f.put('forge_ext3', -4, 1.2, 0, 0);
      f.put('forge_ext4', -6.2, 1.2, 0, 0);
      f.put('forge_ext5', -2.2, 1.2, 0, 0);
      f.put('forge_ext6', -4, -3.35, 1.4, 0);
      f.put('blackforge', 4, -1, 0, 0);
      f.put('blackforge_ext1', 1.6, 1.2, 0, 0);
      f.put('blackforge_ext2_vise', 6.6, -1, 0, 0);
      f.put('blackforge_ext3_metalcutter', 4, 1.4, 0, 0);
      f.put('blackforge_ext4_gemcutter', 6.4, 1.4, 0, 0);
      f.put('blackforge_ext5_apron', 4, -3.4, 1.2, 0, { pivotXZ: true });
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot, 0]);
      info.districts.push('forge');
    }
  }
  // Atelier.
  {
    const pt = [Q * 0.45, Q * 0.8];
    const r = place(hallRect(16), pt, face(pt));
    if (r) {
      L.district = 'crafts';
      const f = hall(L, r.cx, r.cz, r.rot, 16, { sign: T.workshop });
      f.put('piece_workbench', -5, -1.5, 0, 0);
      f.put('piece_workbench_ext1', -7, 1.2, 0, 0);
      f.put('piece_workbench_ext2', -5, 1.4, 0, 0);
      f.put('piece_workbench_ext3', -2.5, 1.4, 0, 0);
      f.put('piece_workbench_ext4', -5, -3.35, 1.4, 0);
      f.put('piece_stonecutter', 0.5, -1.5, 0, 0);
      f.put('piece_artisanstation', 5, -1.5, 0, 0);
      f.put('artisan_ext1', 5, 1.4, 0, 0);
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot, 0]);
      info.districts.push('workshop');
    }
  }
  // Cuisines.
  {
    const pt = [-Q * 0.45, Q * 0.8];
    const r = place(hallRect(20), pt, face(pt));
    if (r) {
      L.district = 'crafts';
      const f = hall(L, r.cx, r.cz, r.rot, 20, { sign: T.kitchen });
      f.put('fire_pit', -7, -1, 0, 0);
      f.put('piece_cauldron', -7, -1, 0, 0);
      f.put('cauldron_ext1_spice', -7, -3.35, 1.2, 0);
      f.put('cauldron_ext3_butchertable', -4.6, -1.2, 0, 0);
      f.put('cauldron_ext4_pots', -9, -3.43, 1.4, 0, { pivotXZ: true });
      f.put('cauldron_ext5_mortarandpestle', -4.6, 1.2, 0, 0);
      f.put('cauldron_ext6_rollingpins', -5, -3.3, 1.5, 0);
      f.put('cauldron_ext7_smoker', -8.6, 1.4, 0, 0);
      f.put('fire_pit', -1.5, -1, 0, 0);
      f.put('piece_MeadCauldron', -1.5, -1, 0, 0);
      f.put('piece_preptable', 2, -2.2, 0, 0);
      f.put('piece_oven', 6, -2, 0, 0);
      f.put('fire_pit', 2, 1.8, 0, 0);
      f.put('piece_cookingstation', 2, 1.8, 0, 0);
      f.put('fermenter', 8.2, 1.6, 0, 180);
      f.put('fermenter', 5.8, 1.6, 0, 180);
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot, 0]);
      info.districts.push('kitchen');
    }
  }
  // Cercle des mages.
  {
    const pt = [-Q * 0.8, Q * 0.45];
    const r = place(hallRect(8), pt, face(pt));
    if (r) {
      L.district = 'crafts';
      const f = hall(L, r.cx, r.cz, r.rot, 8, { sign: T.mage, dark: false });
      f.put('piece_magetable', -0.5, -1.2, 0, 0);
      f.put('piece_magetable_ext', 2.6, 0.8, 0, 0);
      f.put('piece_magetable_ext2', -2.8, 1.4, 0, 0);
      f.put('piece_magetable_ext3', 2.2, -3.35, 1.4, 0);
      f.put('piece_magetable_ext4', 0.5, 2, 0, 180);
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot, 0]);
      info.districts.push('mage');
    }
  }

  // ---------- Maisons le long des rues ----------
  let houses = 0;
  const maxHouses = { ville: 35, cite: 60, capitale: 90 }[o.size] || 60;
  const pickType = () => {
    const x = random();
    if (x < 0.22) return HOUSE_TYPES.hut;
    if (x < 0.46) return HOUSE_TYPES.house;
    if (x < 0.62) return HOUSE_TYPES.longhouse;
    if (x < 0.78) return HOUSE_TYPES.tall;
    return HOUSE_TYPES.garden;
  };
  if (o.houses) {
    L.district = 'houses';
    const order = ['avenue', 'ring', 'lane', 'wallroad'];
    for (const kind of order)
      for (const st of streets.filter((s) => s.kind === kind))
        for (const side of st.sides) {
          let t = 4;
          while (t < st.len - 4 && houses < maxHouses) {
            const spec = pickType();
            const lot = houseLot(spec);
            if (t + lot.along > st.len - 4) break;
            const along = t + lot.along / 2;
            const offset = st.w / 2 + 1.3 + lot.depth / 2;
            const cx = st.x1 + st.ux * along + st.nx * side * offset;
            const cz = st.z1 + st.uz * along + st.nz * side * offset;
            // Façade (+Z local) tournée vers la rue.
            const rot = Math.atan2(-side * st.nx, -side * st.nz) / DEG;
            const rect = { cx, cz, hw: lot.along / 2 + 0.4, hd: lot.depth / 2 + 0.2, rot };
            if (!space.fits(rect, 0.4)) {
              t += 2;
              continue;
            }
            space.reserve(rect);
            // Centre de la maison : décalé vers l'arrière (marches devant) et à gauche du jardin.
            const [hx, hz] = rotate(-(spec.garden || 0) / 2, -1.1, rot);
            vikingHouse(L, cx + hx, cz + hz, rot, spec, random);
            paint.push([DIRT, 1, cx, cz, rect.hw, rect.hd, rot, 0]);
            if (spec.garden) {
              const [gx, gz] = rotate(lot.along / 2 - spec.garden / 2, -1.1, rot);
              paint.push([CULTIVATED, 1, cx + gx, cz + gz, spec.garden / 2 - 0.3, spec.width / 2, rot, 0]);
            }
            houses++;
            t += lot.along + 1.5 + random() * 2;
          }
        }
    info.districts.push('houses');
  }
  info.houses = houses;

  // ---------- Barrières et lanternes le long des rues qui bordent un terrain vide ----------
  L.district = 'fences';
  for (const st of streets) {
    if (st.kind === 'avenue') continue;
    for (const side of st.sides)
      for (let t = 5; t < st.len - 5; t += 2.7) {
        const off = st.w / 2 + 0.4;
        const fx = st.x1 + st.ux * t + st.nx * side * off;
        const fz = st.z1 + st.uz * t + st.nz * side * off;
        const behind = { cx: fx + st.nx * side * 3, cz: fz + st.nz * side * 3, hw: 1.4, hd: 3, rot: st.rot };
        const fence = { cx: fx, cz: fz, hw: 1.35, hd: 0.25, rot: st.rot };
        if (!space.fits(behind, 0, { terrain: false, radius: A - 8 }) || !space.fits(fence, 0, { terrain: false, radius: A - 8 })) continue;
        space.reserve(fence);
        L.put('wood_fence', fx, fz, 0, st.rot);
      }
  }
  L.district = 'streets';
  for (const st of streets.filter((s) => s.kind === 'ring'))
    for (const side of [1, -1]) {
      const t = st.len / 2;
      const x = st.x1 + st.ux * t + st.nx * side * (st.w / 2 + 0.6);
      const z = st.z1 + st.uz * t + st.nz * side * (st.w / 2 + 0.6);
      const spot = { cx: x, cz: z, hw: 0.4, hd: 0.4, rot: 0 };
      if (!space.fits(spot, 0, { terrain: false })) continue;
      space.reserve(spot);
      L.put('piece_dvergr_lantern_pole', x, z, 0, st.rot + (side > 0 ? 270 : 90), { pivotXZ: true });
    }

  // Gardes nains autour de la grand-place et devant le palais.
  if (o.guards) {
    L.district = 'guards';
    for (const [a, b] of [[P + 2, 3], [-P - 2, 3], [3, -P - 2], [-4, palaceZ - 6], [4, palaceZ - 6]]) L.put('Dverger', a, b, 0, 0);
  }

  // ---------- Sortie : coordonnées monde ----------
  const [cx, cz] = survey?.center || [0, 0];
  const pieces = L.pieces.map((p) => {
    const row = [p.name, round(cx + p.x), round(floorY + p.y), round(cz + p.z), round(p.rot)];
    if (p.text) row.push(p.text);
    return row;
  });
  const worldPaint = paint.map(([kind, type, a, b, c, d, e, f]) => {
    if (type === 0) return [kind, type, round(cx + a), round(cz + b), c, 0, 0, f];
    if (type === 1) return [kind, type, round(cx + a), round(cz + b), c, d, e, f];
    return [kind, type, round(cx + a), round(cz + b), round(cx + c), round(cz + d), e, f];
  });
  const plateau = walls.Rv * ((A + 23) / A);

  const plan = {
    version: 2,
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
