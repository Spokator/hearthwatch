// Bâtiments du générateur de ville, dans le style viking.
//
// Toute la ville repose sur un même niveau de pierre : le sol praticable (rues, places, maisons, ateliers) est à
// LEVEL = 1 m, sur des fondations de pierre. Les étages font 3 m : 1 m de soubassement de pierre et 2 m de bois au
// rez-de-chaussée, 3 m de bois à l'étage ; les portes laissent 2 m de passage. Chaque fonction bâtit dans un repère
// local (voir layout.js) dont le +Z est la façade, tournée vers la rue.

import { DEG, rotate } from './layout.js';

export const LEVEL = 1;
const STOREY = 3;

// ---------- Éléments communs ----------

// Dalles de fondation (1 m) couvrant un rectangle aux bords multiples de 2 : 4×4, complétées en 2×2.
export function foundation(f, x0, z0, x1, z1, bottom = 0, skip = null) {
  const nx = Math.round((x1 - x0) / 2);
  const nz = Math.round((z1 - z0) / 2);
  const used = Array.from({ length: nx }, (_, i) => Array.from({ length: nz }, (_, j) => !!skip?.(x0 + 2 * i + 1, z0 + 2 * j + 1)));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      if (used[i][j]) continue;
      if (i + 1 < nx && j + 1 < nz && !used[i + 1][j] && !used[i][j + 1] && !used[i + 1][j + 1]) {
        f.put('stone_floor', x0 + 2 * i + 2, z0 + 2 * j + 2, bottom, 0);
        used[i][j] = used[i + 1][j] = used[i][j + 1] = used[i + 1][j + 1] = true;
      } else {
        f.put('stone_floor_2x2', x0 + 2 * i + 1, z0 + 2 * j + 1, bottom, 0);
        used[i][j] = true;
      }
    }
}

// Plancher de planches (sur fondation) couvrant un rectangle aux bords multiples de 2.
export function planks(f, x0, z0, x1, z1, bottom) {
  for (let a = x0 + 1; a < x1; a += 2) for (let b = z0 + 1; b < z1; b += 2) f.put('wood_floor', a, b, bottom, 0);
}

// Toit à deux pentes à 45°, faîte selon X, largeur 4, 8 ou 12 (Z), rives à `eave`.
// gables : 'both' | 'neg' | 'pos' | 'none' (pignons fermés aux extrémités -X / +X).
export function gableRoof(f, { width, length, eave, dark = true, gables = 'both', dragons = false, overhang = 0 }) {
  const roof = dark ? 'darkwood_roof_45' : 'wood_roof_45';
  const ridge = dark ? 'darkwood_roof_top_45' : 'wood_roof_top_45';
  const steps = width / 4;
  const w2 = width / 2;
  const l2 = length / 2;
  for (let a = -l2 + 1 - overhang; a < l2 + overhang; a += 2) {
    for (let k = 0; k < steps; k++) {
      f.put(roof, a, w2 - 2 * k, eave + 2 * k, 0, { pivot: true });
      f.put(roof, a, -(w2 - 2 * k), eave + 2 * k, 180, { pivot: true });
    }
    f.put(ridge, a, 0, eave + 2 * steps - 1, 0, { pivot: true });
  }
  const ends = gables === 'both' ? [-l2, l2] : gables === 'neg' ? [-l2] : gables === 'pos' ? [l2] : [];
  for (const a of ends)
    for (let k = 0; k < steps; k++) {
      const edge = w2 - 2 * k - 1;
      for (let c = -edge; c <= edge; c += 2) {
        if (Math.abs(c) === edge) f.put('wood_wall_roof_45', a, c, eave + 2 * k, c < 0 ? 270 : 90, { pivot: true });
        else f.put('woodwall', a, c, eave + 2 * k, 90);
      }
    }
  if (dragons) {
    const peak = eave + 2 * steps;
    if (dragons !== 'neg') f.put('wood_dragon1', l2 + overhang + 0.2, 0, peak - 0.55, 90, { pivot: true });
    if (dragons !== 'pos') f.put('wood_dragon1', -l2 - overhang - 0.2, 0, peak - 0.55, 270, { pivot: true });
  }
  return eave + 2 * steps;
}

// Toit en croupe 4×4 centré sur (cx, cz), rives à `eave`.
export function hipRoof(f, cx, cz, eave, piece = 'darkwood_roof_ocorner_45') {
  for (const [a, b, r] of [[1, 1, 0], [-1, 1, 270], [1, -1, 90], [-1, -1, 180]]) f.put(piece, cx + a, cz + b, eave, r, { pivot: true });
}

// Barrière basse (1 m) de poteaux et de lisses, le long de X entre x0 et x1, avec une lanterne tous les `lamp` poteaux.
export function lowFence(f, x0, x1, z, bottom, { lamp = 3, lampSide = 1, rail = 'darkwood_beam4x4' } = {}) {
  const posts = [];
  for (let a = x0; a <= x1 + 0.01; a += 4) posts.push(a);
  posts.forEach((a, i) => {
    f.put('wood_pole', a, z, bottom, 0);
    if (lamp && i % lamp === 1) f.put('piece_dvergr_lantern', a, z + lampSide * 0.22, bottom + 1.1, lampSide > 0 ? 90 : 270, { pivot: true });
  });
  for (let i = 0; i + 1 < posts.length; i++) f.put(rail, (posts[i] + posts[i + 1]) / 2, z, bottom + 0.55, 0);
}

// Clôture de jardin : piquets et rondins couchés (différente des garde-corps des balcons).
export function gardenFence(f, x0, x1, z, bottom) {
  for (let a = x0; a <= x1 + 0.01; a += 2) f.put('wood_pole', a, z, bottom, 0);
  for (let a = x0 + 1; a < x1; a += 2) f.put('wood_wall_log', a, z, bottom + 0.3, 0);
}

// ---------- Muraille ----------

// Tour : fût de pierre plein 4×4, étage de bois ouvert, toit en croupe, bannière. +X local vers l'extérieur.
export function tower(L, x, z, rot, stoneHeight, { banner = 'piece_banner02' } = {}) {
  const f = L.frame(x, z, rot);
  for (let h = 0; h < stoneHeight; h++) f.put('stone_floor', 0, 0, h, 0);
  for (const [a, b] of [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]]) {
    f.put('darkwood_pole', a, b, stoneHeight, 0);
    f.put('wood_pole', a, b, stoneHeight + 2, 0);
  }
  for (const s of [-1, 1]) {
    f.put('wood_wall_half', s, 1.85, stoneHeight, 0);
    f.put('wood_wall_half', s, -1.85, stoneHeight, 0);
    f.put('wood_wall_half', 1.85, s, stoneHeight, 90);
    f.put('wood_wall_half', -1.85, s, stoneHeight, 90);
  }
  hipRoof(f, 0, 0, stoneHeight + 3);
  if (banner) f.put(banner, 2.12, 0, stoneHeight - 0.2, 0, { pivot: true });
  f.put('piece_dvergr_lantern', -2.02, 0, stoneHeight - 0.8, 0, { pivot: true });
}

// Muraille polygonale : soubassement de pierre de 4 m renforcé de contreforts, chemin de ronde en planches porté par
// des poteaux côté ville et couvert d'un auvent de bardeaux, parapet et palissade côté extérieur, tours saillantes
// (le chemin de ronde passe derrière), porteries couvertes à têtes de dragon, escaliers d'accès.
export function rampart(L, R, gates) {
  L.district = 'rampart';
  const N = R < 90 ? 16 : 20;
  const half = 180 / N;
  const side = Math.max(16, Math.round((2 * R * Math.sin(half * DEG)) / 8) * 8);
  const Rv = side / (2 * Math.sin(half * DEG));
  const apothem = Rv * Math.cos(half * DEG);
  const vertices = [];
  for (let k = 0; k < N; k++) {
    const a = (half + k * 2 * half) * DEG;
    vertices.push([Math.cos(a) * Rv, Math.sin(a) * Rv]);
  }
  const gateList = [];
  for (let k = 0; k < N; k++) {
    const [x1, z1] = vertices[k];
    const [x2, z2] = vertices[(k + 1) % N];
    const rot = -Math.atan2(z2 - z1, x2 - x1) / DEG; // X le long du mur, +Z vers la ville
    const mid = Math.round(((k + 1) * 2 * half) % 360);
    const gate = gates.includes(mid);
    const f = L.frame((x1 + x2) / 2, (z1 + z2) / 2, rot);
    let block = 0;
    for (let t = -side / 2 + 2; t < side / 2; t += 4, block++) {
      const opening = gate && Math.abs(t) < 4;
      const nearGate = gate && Math.abs(t) < 9;
      if (!opening) {
        f.put('stone_wall_4x2', t, 0, 0, 0);
        f.put('stone_wall_4x2', t, 0, 2, 0);
        f.put('darkwood_pole4', t, 1.85, 0, 0);
        f.put('wood_pole_log', t - 2, -0.35, 4, 0);
        f.put('wood_pole', t - 2, -0.35, 6, 0);
        f.put('darkwood_pole', t, 1.6, 4, 0);
        if (block % 2 === 0) for (const h of [0, 2]) f.put('stone_pillar', t - 2, -0.9, h, 0);
        if (block % 3 === 1) f.put(block % 2 ? 'piece_banner07' : 'piece_banner02', t, -0.62, 3.6, 90, { pivot: true });
      }
      for (const s of [-1, 1]) {
        f.put('wood_floor', t + s, 1, 4, 0);
        if (opening) f.put('wood_floor', t + s, -1, 4, 0);
        f.put('wood_wall_half', t + s, opening ? -1.85 : -0.35, 4, 0);
        // Auvent au-dessus du chemin de ronde : bardeaux posés de la palissade (7 m) vers la ville (6 m).
        if (!nearGate) f.put('darkwood_roof', t + s, 0.5, 6.05, 0, { pivot: true });
      }
    }
    if (gate) {
      // Porterie : deux tours saillantes, linteaux, galerie couverte au-dessus du passage, marches vers la ville.
      const outward = -mid;
      for (const t of [-6, 6]) {
        const [tx, tz] = f.at(t, -2.5);
        tower(L, tx, tz, outward, 7);
      }
      for (const t of [-2, 2]) for (const b of [-0.4, 0.4, -1.8]) f.put('darkwood_beam4x4', t, b, 3.55, 0);
      const g = L.frame(...f.at(0, 0), rot + 90);
      for (const [a, b] of [[-1.8, -3.8], [1.8, -3.8], [-1.8, 3.8], [1.8, 3.8]]) g.put('darkwood_pole', a, b, 4, 0);
      gableRoof(g, { width: 8, length: 4, eave: 6, gables: 'both', dragons: true });
      for (const t of [-3.2, 3.2]) {
        f.put('piece_banner02', t, -2.05, 5.8, 90, { pivot: true });
        f.put('piece_banner07', t, 2.05, 5.8, 90, { pivot: true });
      }
      // Marches du passage vers le niveau de la ville.
      for (const t of [-3, -1, 1, 3]) f.put('stone_stair', t, 1.5, 0, 180);
      // Escaliers vers le chemin de ronde, de part et d'autre de la porte, loin des tours.
      for (const dir of [-1, 1]) {
        for (let s = 0; s < 4; s++) f.put('wood_stair', dir * (9 + 2 * s), 3, s, dir > 0 ? 270 : 90);
        f.put('wood_floor', dir * 17, 3, 4, 0);
        f.put('wood_floor', dir * 17, 1, 4, 0);
      }
      gateList.push({ angle: mid, x: Math.cos(mid * DEG) * apothem, z: Math.sin(mid * DEG) * apothem });
    }
  }
  // Tours d'angle saillantes : le chemin de ronde passe derrière elles.
  for (const [x, z] of vertices) {
    const r = Math.hypot(x, z);
    tower(L, x * (1 + 2.3 / r), z * (1 + 2.3 / r), -Math.atan2(z, x) / DEG, 6);
  }
  return { apothem, Rv, vertices, gates: gateList, N, half };
}

// ---------- Ateliers ----------

// Pavillon d'artisans sur plate-forme de pierre : poteaux, poutres, mur de fond, toit à dragons, façade ouverte (+Z).
export function hall(L, x, z, rot, length, { back = true, dark = true, sign } = {}) {
  const f = L.frame(x, z, rot);
  const B = LEVEL;
  const H = B + 4;
  foundation(f, -length / 2 - 2, -4, length / 2 + 2, 6, 0);
  for (let a = -length / 2; a <= length / 2 + 0.01; a += 4) for (const b of [-3.8, 3.8]) f.put('darkwood_pole4', a, b, B, 0);
  for (let a = -length / 2 + 2; a < length / 2; a += 4) for (const b of [-3.8, 3.8]) f.put('darkwood_beam4x4', a, b, H - 0.45, 0);
  for (const a of [-length / 2, length / 2]) for (const b of [-2, 2]) f.put('darkwood_beam4x4', a, b, H - 0.45, 90);
  if (back) for (let a = -length / 2 + 1; a < length / 2; a += 2) {
    f.put('stone_wall_2x1', a, -3.6, B, 0);
    f.put('woodwall', a, -3.6, B + 1, 0);
    f.put('wood_wall_half', a, -3.6, B + 3, 0);
  }
  gableRoof(f, { width: 8, length, eave: H, dark, gables: 'none', dragons: true });
  for (const a of [-length / 2, length / 2]) f.put('piece_dvergr_lantern', a + (a < 0 ? 0.2 : -0.2), 3.99, B + 3, 90, { pivot: true });
  f.put('wood_stack', -length / 2 - 1, 4.8, B, 0);
  if (sign) {
    f.put('darkwood_pole4', length / 2 + 1.2, 5.3, B, 0);
    f.put('sign', length / 2 + 1.2, 5.54, B + 2.2, 0, { pivot: true, text: sign });
  }
  return f;
}

export const hallRect = (length) => ({ hw: length / 2 + 2, hd: 5 });

// ---------- Maisons ----------

// Plans au sol : rectangles (x0, z0, x1, z1, étages) dans le repère de la maison, façade sur +Z (z = 4 pour une
// maison de 8 m de profondeur). Le premier rectangle porte la porte ; les ailes partent vers l'arrière.
export const HOUSE_PLANS = [
  { key: 'longhouse', rects: [[-8, -4, 8, 4, 1]], extra: {} },
  { key: 'twostorey', rects: [[-6, -4, 6, 4, 2]], extra: { balcony: true } },
  { key: 'lshape', rects: [[-6, -4, 6, 4, 1], [-6, -10, 2, -4, 1]], extra: {} },
  { key: 'tshape', rects: [[-8, -4, 8, 4, 1], [-4, -10, 4, -4, 1]], extra: {} },
  { key: 'stonehouse', rects: [[-6, -4, 6, 4, 2]], extra: { stone: true } },
  { key: 'shed', rects: [[-6, -4, 6, 4, 1]], extra: { shed: true } },
  { key: 'garden', rects: [[-6, -4, 6, 4, 1]], extra: { garden: 8 } },
];

// Emprise d'un plan : le long de la rue (X) et en profondeur (Z), abords compris.
export function houseFootprint(plan) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  for (const [a, b, c] of plan.rects) {
    x0 = Math.min(x0, a);
    x1 = Math.max(x1, c);
    z0 = Math.min(z0, b);
  }
  if (plan.extra.shed) x1 += 4;
  if (plan.extra.garden) x1 += plan.extra.garden;
  return { x0, x1, z0, z1: 4 + 2 };
}

// Aménagements intérieurs : peu de meubles, différents d'une maison à l'autre.
const INTERIORS = [
  { key: 'famille', items: [['piece_bed02', 'backLeft', 90], ['piece_table_round', 'centerLeft', 0], ['piece_chair03', 'centerLeftChair', 90], ['piece_chest_wood', 'backRight', 0]] },
  { key: 'chasseur', items: [['rug_wolf', 'center', 90], ['piece_bed02', 'backLeft', 90], ['wood_stack', 'frontRight', 0], ['piece_chest_wood', 'backRight', 0]] },
  { key: 'ancien', items: [['piece_throne01', 'backRight', 0], ['rug_fur', 'center', 90], ['piece_bench01', 'frontLeft', 180]] },
  { key: 'marchand', items: [['piece_chest_wood', 'backLeft', 0], ['piece_chest_wood', 'backRight', 0], ['piece_table', 'centerLeft', 90], ['rug_deer', 'center', 0]] },
  { key: 'guerrier', items: [['piece_bed02', 'backLeft', 90], ['rug_deer', 'center', 0], ['itemstand', 'backWall', 0, { ints: { item: 'SwordIron' }, lock: true }], ['itemstand', 'backWall2', 0, { ints: { item: 'ShieldBanded' }, lock: true }]] },
  { key: 'artisan', items: [['piece_table_runed', 'backRight', 0], ['wood_stack', 'frontLeft', 0], ['stone_pile', 'frontRight', 0]] },
  { key: 'brasseur', items: [['fermenter', 'backRight', 180], ['piece_table_round', 'centerLeft', 0], ['piece_chair03', 'centerLeftChair', 90], ['piece_chest_barrel', 'frontRight', 0]] },
  { key: 'erudit', items: [['piece_table', 'backRight', 0], ['piece_chair02', 'backRightChair', 180], ['jute_carpet', 'center', 0]] },
];

// Maison viking : fondation de pierre (le sol est au niveau des rues), soubassement de pierre et murs de bois,
// poteaux d'angle en rondins, fenêtres à claire-voie, porte de 2 m avec seuil vers la rue, toit(s) à dragons,
// étage avec escalier et balcon, appentis ou jardin selon le plan, intérieur propre à la maison.
export function vikingHouse(L, x, z, rot, plan, random, interiorIndex) {
  const f = L.frame(x, z, rot);
  const F = LEVEL;
  const dark = random() < 0.5;
  const cells = new Map(); // "i,j" -> étages ; cellule de 2 m dont le coin bas est (2i, 2j)
  const key = (i, j) => `${i},${j}`;
  for (const [x0, z0, x1, z1, storeys] of plan.rects)
    for (let a = x0; a < x1; a += 2) for (let b = z0; b < z1; b += 2) cells.set(key(a / 2, b / 2), Math.max(storeys, cells.get(key(a / 2, b / 2)) || 0));
  const main = plan.rects[0];
  const storeysMain = main[4];
  const stairCells = storeysMain > 1 ? new Set([key(main[0] / 2, main[1] / 2), key(main[0] / 2 + 1, main[1] / 2), key(main[0] / 2 + 2, main[1] / 2)]) : new Set();

  // Fondations (plus le porche d'une maison à étage).
  for (const [x0, z0, x1, z1] of plan.rects) foundation(f, x0, z0, x1, z1, 0);
  if (plan.extra.balcony) foundation(f, main[0], 4, main[2], 6, 0);

  // Porte : milieu de la façade.
  const doorX = Math.round((main[0] + main[2]) / 4) * 2 + 1 - (random() < 0.5 ? 2 : 0);
  const upperDoorX = doorX;

  // Murs : chaque arête extérieure de cellule, par étage.
  const window = (s) => random() < (s === 0 ? 0.18 : 0.3);
  const edges = [];
  for (const [k, storeys] of cells) {
    const [i, j] = k.split(',').map(Number);
    const cx = 2 * i + 1;
    const cz = 2 * j + 1;
    for (const [di, dj, ex, ez, wr] of [[0, 1, cx, cz + 1, 0], [0, -1, cx, cz - 1, 0], [1, 0, cx + 1, cz, 90], [-1, 0, cx - 1, cz, 90]]) {
      const neighbour = cells.get(key(i + di, j + dj)) || 0;
      for (let s = 0; s < storeys; s++) if (neighbour <= s) edges.push({ x: ex, z: ez, rot: wr, s, front: dj === 1 });
    }
  }
  for (const e of edges) {
    const y = F + STOREY * e.s;
    const isDoor = e.front && e.x === doorX && e.z === main[3] && e.s === 0;
    const isUpperDoor = plan.extra.balcony && e.front && e.x === upperDoorX && e.z === main[3] && e.s === 1;
    if (isDoor || isUpperDoor) {
      f.put('wood_door', e.x, e.z, y, 0);
      f.put('wood_wall_half', e.x, e.z, y + 2, e.rot);
      continue;
    }
    if (e.s === 0) {
      f.put('stone_wall_2x1', e.x, e.z, y, e.rot);
      if (plan.extra.stone) {
        f.put('stone_wall_2x1', e.x, e.z, y + 1, e.rot);
        f.put('stone_wall_2x1', e.x, e.z, y + 2, e.rot);
      } else if (window(0)) {
        const [dx, dz] = e.rot ? [0, 0.5] : [0.5, 0];
        f.put('darkwood_decowall', e.x - dx, e.z - dz, y + 1, e.rot);
        f.put('darkwood_decowall', e.x + dx, e.z + dz, y + 1, e.rot);
      } else f.put('woodwall', e.x, e.z, y + 1, e.rot);
    } else if (window(1)) {
      const [dx, dz] = e.rot ? [0, 0.5] : [0.5, 0];
      f.put('darkwood_decowall', e.x - dx, e.z - dz, y, e.rot);
      f.put('darkwood_decowall', e.x + dx, e.z + dz, y, e.rot);
      f.put('wood_wall_half', e.x, e.z, y + 2, e.rot);
    } else {
      f.put('woodwall', e.x, e.z, y, e.rot);
      f.put('wood_wall_half', e.x, e.z, y + 2, e.rot);
    }
  }
  // Poteaux d'angle en rondins.
  const vertexDirs = new Map();
  for (const e of edges.filter((e) => e.s === 0)) {
    const ends = e.rot ? [[e.x, e.z - 1], [e.x, e.z + 1]] : [[e.x - 1, e.z], [e.x + 1, e.z]];
    for (const [vx, vz] of ends) {
      const k = `${vx},${vz}`;
      const d = vertexDirs.get(k) || new Set();
      d.add(e.rot);
      vertexDirs.set(k, d);
    }
  }
  for (const [k, dirs] of vertexDirs) {
    if (dirs.size < 2) continue;
    const [vx, vz] = k.split(',').map(Number);
    const storeys = Math.max(...[[-1, -1], [-1, 0], [0, -1], [0, 0]].map(([a, b]) => cells.get(key(Math.floor(vx / 2) + a, Math.floor(vz / 2) + b)) || 0));
    for (let s = 0; s < storeys; s++) {
      f.put('wood_pole_log', vx, vz, F + STOREY * s + (s === 0 ? 1 : 0), 0);
      if (s > 0) f.put('wood_pole', vx, vz, F + STOREY * s + 2, 0);
    }
  }

  // Plancher de l'étage et escalier le long du mur arrière.
  if (storeysMain > 1) {
    for (const [k, storeys] of cells) {
      if (storeys < 2 || stairCells.has(k)) continue;
      const [i, j] = k.split(',').map(Number);
      f.put('wood_floor', 2 * i + 1, 2 * j + 1, F + STOREY, 0);
    }
    for (let s = 0; s < 3; s++) f.put('wood_stair', main[0] + 1 + 2 * s, main[1] + 1.5, F + s, 270);
  }

  // Toits : un par rectangle, faîte le long de son plus grand côté ; les ailes sans pignon côté bâtiment principal.
  plan.rects.forEach(([x0, z0, x1, z1, storeys], idx) => {
    const eave = F + STOREY * storeys;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    if (idx === 0) gableRoof(L.frame(...f.at(cx, cz), rot), { width: z1 - z0, length: x1 - x0, eave, dark, dragons: true, gables: 'both' });
    else gableRoof(L.frame(...f.at(cx, cz), rot + 90), { width: x1 - x0, length: z1 - z0, eave, dark, dragons: 'pos', gables: 'pos' });
  });

  // Entrée : seuil de planches vers la rue, montants, lanterne.
  if (!plan.extra.balcony) foundation(f, doorX - 1, main[3], doorX + 1, main[3] + 2, 0);
  f.put('wood_floor', doorX, main[3] + 1, F, 0);
  for (const s of [-1.2, 1.2]) f.put('wood_pole_log', doorX + s, main[3] + 0.25, F, 0);
  f.put('piece_dvergr_lantern', doorX + 1.9, main[3] + 0.16, F + 1.9, 90, { pivot: true });

  // Balcon d'étage (seul endroit à garde-corps de planches), porté par des poteaux.
  if (plan.extra.balcony) {
    planks(f, main[0], 4, main[2], 6, F + STOREY);
    for (let a = main[0] + 1.35; a < main[2] - 1; a += 2.7) f.put('wood_fence', a, 5.95, F + STOREY + 0.1, 0);
    for (const a of [main[0] + 0.2, main[2] - 0.2]) {
      f.put('darkwood_pole4', a, 5.8, F, 0);
      f.put('wood_fence', a, 5, F + STOREY + 0.1, 90);
    }
  }
  // Appentis ouvert sur le côté : bois de chauffage et outils.
  if (plan.extra.shed) {
    const sx = main[2];
    foundation(f, sx, -4, sx + 4, 4, 0);
    for (const b of [-3.8, 3.8]) f.put('darkwood_pole', sx + 3.8, b, F, 0);
    for (const b of [-3, -1, 1, 3]) f.put('wood_roof', sx + 2.5, b, F + 2, 90, { pivot: true });
    f.put('wood_stack', sx + 2, -2, F, 90);
    f.put('wood_stack', sx + 2, 1.5, F, 90);
  }
  // Jardin clôturé au niveau du sol.
  if (plan.extra.garden) {
    const g0 = main[2] + 0.5;
    const g1 = main[2] + plan.extra.garden;
    gardenFence(f, g0, g1, 3.8, 0);
    gardenFence(f, g0, g1, -3.8, 0);
    gardenFence(L.frame(...f.at(g1, 0), rot + 90), -3.8, 3.8, 0, 0);
    f.put('piece_beehive', g1 - 1.2, -2.6, 0, 180);
    f.put('piece_logbench01', g0 + 2, -3, 0, 0);
  }

  // Intérieur du rez-de-chaussée (rectangle principal) et chambres à l'étage.
  const [ix0, iz0, ix1, iz1] = main;
  const inset = plan.extra.stone ? 0.55 : 0.2; // parement intérieur du mur à hauteur d'objet
  const slots = {
    backLeft: [ix0 + 2.3, iz0 + 1.8],
    backRight: [ix1 - 1.4, iz0 + 1.2],
    backRightChair: [ix1 - 1.4, iz0 + 2.2],
    frontLeft: [ix0 + 1.6, iz1 - 1.4],
    frontRight: [ix1 - 1.4, iz1 - 1.4],
    center: [(ix0 + ix1) / 2 + 1, 0],
    centerLeft: [ix0 + 2.6, 0.8],
    centerLeftChair: [ix0 + 1.1, 0.8],
    backWall: [(ix0 + ix1) / 2 - 1, iz0 + inset],
    backWall2: [(ix0 + ix1) / 2 + 1, iz0 + inset],
  };
  const interior = INTERIORS[interiorIndex % INTERIORS.length];
  const upstairs = storeysMain > 1;
  for (const [name, slot, r, data] of interior.items) {
    if (upstairs && (slot === 'backLeft' || slot === 'centerLeft' || slot === 'centerLeftChair')) continue;
    const [sx, sz] = slots[slot];
    if (name === 'itemstand') f.put(name, sx, sz, F + 1.6, r, { pivot: true, data });
    else f.put(name, sx, sz, F, r);
  }
  f.put('piece_dvergr_lantern', (ix0 + ix1) / 2, iz0 + inset - 0.04, F + 2.2, 90, { pivot: true });
  if (upstairs) {
    const y = F + STOREY;
    f.put('piece_bed02', ix1 - 2.1, iz0 + 1.6, y, 90);
    f.put('piece_chest_wood', ix1 - 1.2, iz1 - 0.8, y, 180);
    f.put(random() < 0.5 ? 'rug_fur' : 'rug_deer', (ix0 + ix1) / 2 + 1, 1, y, 90);
    f.put('piece_dvergr_lantern', (ix0 + ix1) / 2 + 2, iz0 + 0.2, y + 2.2, 90, { pivot: true });
  }
  return { door: f.at(doorX, main[3] + 2) };
}

// ---------- Grande brasserie ----------

export function brasserie(L, x, z, rot, { name, subtitle, board, boardEmpty }) {
  const f = L.frame(x, z, rot);
  const W = 12;
  const Ln = 24;
  const w2 = W / 2;
  const l2 = Ln / 2;
  const F = LEVEL;
  const H = F + 4;
  const door = 1;
  const boards = [];

  foundation(f, -l2, -w2, l2, w2 + 3, 0);
  for (let a = -l2 + 1; a < l2; a += 2)
    for (const b of [w2, -w2]) {
      if (a === door) {
        f.put('wood_door', door, b, F, b > 0 ? 0 : 180);
        f.put('woodwall', a, b, F + 2, 0);
        continue;
      }
      f.put('stone_wall_2x1', a, b, F, 0);
      f.put(Math.abs(a) % 4 === 3 ? 'darkwood_decowall' : 'woodwall', Math.abs(a) % 4 === 3 ? a - 0.5 : a, b, F + 1, 0);
      if (Math.abs(a) % 4 === 3) f.put('darkwood_decowall', a + 0.5, b, F + 1, 0);
      f.put('wood_wall_half', a, b, F + 3, 0);
    }
  for (const a of [-l2, l2])
    for (let b = -w2 + 1; b < w2; b += 2) {
      f.put('stone_wall_2x1', a, b, F, 90);
      f.put('woodwall', a, b, F + 1, 90);
      f.put('wood_wall_half', a, b, F + 3, 90);
    }
  for (let a = -l2; a <= l2; a += 4) for (const b of [-w2 - 0.2, w2 + 0.2]) if (Math.abs(a - door) > 1.5) f.put('wood_pole_log_4', a, b, F, 0);
  gableRoof(f, { width: W, length: Ln, eave: H, dark: true, gables: 'none', dragons: true, overhang: 1 });

  // Porche couvert, enseigne, lanternes.
  for (const s of [-1, 1]) {
    f.put('wood_roof', door + s, w2 + 1, H - 1.2, 0, { pivot: true });
    f.put('wood_pole_log_4', door + s * 1.8, w2 + 2.2, F, 0);
  }
  f.put('sign', door + 1.8, w2 + 2.44, F + 2.3, 0, { pivot: true, text: name });
  f.put('sign', door + 1.8, w2 + 2.44, F + 1.6, 0, { pivot: true, text: subtitle });
  for (const a of [-6, 6]) f.put('piece_dvergr_lantern', a, w2 + 0.36, F + 2.6, 90, { pivot: true });

  // Tableau des contrats devant la façade.
  for (const a of [-9, -5]) f.put('darkwood_pole4', a, w2 + 2.5, F, 0);
  f.put('darkwood_beam4x4', -7, w2 + 2.5, F + 3.6, 0);
  f.put('sign', -7, w2 + 2.74, F + 3.1, 0, { pivot: true, text: board });
  for (const [a, h] of [[-8, 2.4], [-6, 2.4], [-8, 1.6], [-6, 1.6]]) boards.push(f.put('sign', a, w2 + 2.55, F + h, 0, { pivot: true, text: boardEmpty }));

  // Salle : deux âtres, tables et bancs, allée de fourrures.
  for (const a of [-6, 6]) {
    f.put('hearth', a, 0, F, 0);
    for (const s of [-1, 1]) {
      f.put('piece_table_oak', a, s * 3.7, F, 0);
      for (const d of [-2.2, 2.2]) {
        f.put('piece_bench01', a + d, s * 2.3, F, s > 0 ? 180 : 0);
        f.put('piece_bench01', a + d, s * 5.1, F, s > 0 ? 0 : 180);
      }
    }
  }
  f.put('rug_fur', 0, 0, F, 90);
  for (const b of [-2.46, 0, 2.46]) f.put('piece_table', 10.3, b, F, 90);
  f.put('piece_MeadCauldron', 11.3, 0, F, 0);
  for (const b of [-4.6, 4.6]) f.put('fermenter', 11, b, F, 270);
  for (const b of [-2.3, 2.3]) f.put('piece_chest_barrel', 11.3, b, F, 0);
  f.put('piece_throne02', -11.2, 0, F, 90);
  for (const b of [-3.9, 3.9]) f.put('piece_table_round', -10.6, b, F, 0);
  [-9, -3, 3, 9].forEach((a, i) => {
    f.put(i % 2 ? 'piece_banner07' : 'piece_banner02', a, w2 - 0.25, F + 3.8, 90, { pivot: true });
    f.put(i % 2 ? 'piece_banner02' : 'piece_banner07', a, -w2 + 0.25, F + 3.8, 90, { pivot: true });
  });
  return boards;
}

export const brasserieRect = { hw: 14, hd: 11 };

// ---------- Château ----------

// Château impérial : plate-forme de pierre, rez-de-chaussée de pierre sombre de 5 m (salle du trône), étage de bois
// avec quatre chambres desservies par un escalier, grand toit à dragons, tours d'angle, colonnade, bannières.
// Repère : façade vers -Z (vers la grand-place), origine au milieu de la façade.
export function castle(L, x, z, { W, D, throne, palace, emperor }) {
  const f = L.frame(x, z, 180);
  const F = LEVEL;
  const G = 5; // hauteur du rez-de-chaussée
  const U = F + G; // niveau de l'étage
  const w2 = W / 2;
  // Plate-forme et parvis.
  foundation(f, -w2 - 4, -D, w2 + 4, 6, 0);
  // Murs du rez-de-chaussée (façade en z = 0, fond en z = -D).
  const stone = 'Piece_grausten_wall_4x2';
  for (let a = -w2 + 2; a < w2; a += 4) {
    const doorway = Math.abs(a) < 3;
    for (const [row, h] of [[0, F], [1, F + 2]]) {
      if (!(doorway && row === 0)) f.put(stone, a, 0, h, 0);
      f.put(stone, a, -D, h, 0);
    }
    f.put('stone_wall_2x1', a - 1, 0, F + 4, 0);
    f.put('stone_wall_2x1', a + 1, 0, F + 4, 0);
    f.put('stone_wall_2x1', a - 1, -D, F + 4, 0);
    f.put('stone_wall_2x1', a + 1, -D, F + 4, 0);
  }
  for (let b = -2; b > -D; b -= 4)
    for (const a of [-w2, w2]) {
      f.put(stone, a, b, F, 90);
      f.put(stone, a, b, F + 2, 90);
      f.put('stone_wall_2x1', a, b - 1, F + 4, 90);
      f.put('stone_wall_2x1', a, b + 1, F + 4, 90);
    }
  // Grandes portes et colonnade du parvis.
  for (const a of [-1, 1]) f.put('wood_door', a * 1.0, 0, F, 0);
  for (const a of [-w2 + 2, -6, 6, w2 - 2]) f.put('blackmarble_column_3', a, 3, F, 0);
  for (let a = -w2 + 2; a < w2; a += 4) f.put('stone_floor', a, 2, F + 8, 0);
  // Étage : plancher (sauf trémie d'escalier), cloisons des chambres avec portes, murs de bois, fenêtres.
  const stairX = w2 - 3;
  for (let a = -w2 + 1; a < w2; a += 2)
    for (let b = -D + 1; b < 0; b += 2) if (!(Math.abs(a - stairX) < 1.5 && b > -12 && b < -2)) f.put('wood_floor', a, b, U, 0);
  for (let s = 0; s < 5; s++) f.put('wood_stair', stairX, -3 - 2 * s, F + s, 0);
  for (let a = -w2 + 1; a < w2; a += 2)
    for (const b of [0, -D]) {
      const win = Math.abs(a) % 6 === 3;
      if (win) {
        f.put('darkwood_decowall', a - 0.5, b, U, 0);
        f.put('darkwood_decowall', a + 0.5, b, U, 0);
      } else f.put('woodwall', a, b, U, 0);
      f.put('wood_wall_half', a, b, U + 2, 0);
    }
  for (let b = -1; b > -D; b -= 2)
    for (const a of [-w2, w2]) {
      f.put('woodwall', a, b, U, 90);
      f.put('wood_wall_half', a, b, U + 2, 90);
    }
  // Couloir central (x de -2 à 2) et quatre chambres de part et d'autre.
  const roomDepth = D / 2;
  for (const side of [-1, 1]) {
    for (let b = -1; b > -D; b -= 2) {
      const doorHere = b === -roomDepth / 2 - 1 || b === -roomDepth - roomDepth / 2 - 1;
      if (doorHere) {
        f.put('wood_door', side * 2, b, U, 90);
        f.put('wood_wall_half', side * 2, b, U + 2, 90);
      } else {
        f.put('woodwall', side * 2, b, U, 90);
        f.put('wood_wall_half', side * 2, b, U + 2, 90);
      }
    }
    for (let a = side * 3; Math.abs(a) < w2; a += side * 2) {
      if (side > 0 && Math.abs(a - stairX) < 1.5) continue;
      f.put('woodwall', a, -roomDepth, U, 0);
      f.put('wood_wall_half', a, -roomDepth, U + 2, 0);
    }
    for (const b of [-roomDepth / 2, -roomDepth - roomDepth / 2]) {
      const rx = side * (w2 / 2 + 1);
      if (side > 0 && b > -12) {
        f.put('rug_fur', rx - 2, b, U, 0);
        continue;
      }
      f.put('piece_bed02', rx + side * 2, b + 1.5, U, side > 0 ? 270 : 90);
      f.put('piece_chest_wood', rx + side * 3.4, b - 2.5, U, side > 0 ? 270 : 90);
      f.put(b > -D / 2 ? 'rug_deer' : 'rug_fur', rx, b, U, 0);
      f.put('piece_chair03', rx - side * 2, b - 2.5, U, side > 0 ? 90 : 270);
      f.put('piece_dvergr_lantern', side * (w2 - 0.2), b, U + 2.2, side > 0 ? 0 : 180, { pivot: true });
    }
  }
  // Toit et tours.
  gableRoof(L.frame(...f.at(0, -D / 2), 90), { width: W, length: D, eave: U + 3, dark: true, gables: 'both', dragons: true, overhang: 1 });
  for (const [a, b] of [[-w2, 0], [w2, 0], [-w2, -D], [w2, -D]]) tower(L, ...f.at(a, b), a < 0 ? 0 : 180, 12, { banner: 'piece_banner07' });
  // Salle du trône : tapis, estrade, trône, colonnes, bannières, lanternes.
  for (let b = -3; b > -D + 5; b -= 3) f.put('jute_carpet_blue', 0, b, F, 0);
  for (let a = -3; a <= 3; a += 2) for (const b of [-D + 3, -D + 5]) f.put('blackmarble_floor', a, b, F, 0);
  f.put('piece_blackmarble_throne', 0, -D + 3.5, F + 1, 0);
  f.put('sign', 0, -D + 5.95, F + 0.5, 0, { pivot: true, text: throne });
  for (const a of [-6, 6]) for (let b = -5; b > -D + 6; b -= 6) {
    f.put('blackmarble_column_2', a, b, F, 0);
    for (let h = 1; h < 5; h++) f.put('blackmarble_column_2', a, b, F + h, 0);
  }
  for (const a of [-9, -3, 3, 9]) f.put(a % 6 ? 'piece_banner02' : 'piece_banner07', a, -D + 0.6, F + 4.6, 90, { pivot: true });
  for (let b = -6; b > -D + 2; b -= 8) for (const a of [-1, 1]) f.put('piece_dvergr_lantern', a * (w2 - 0.24), b, F + 3, a > 0 ? 0 : 180, { pivot: true });
  f.put('sign', 0, 0.6, F + 4.5, 0, { pivot: true, text: palace });
  for (const a of [-4, 4]) f.put('piece_banner02', a, 0.62, F + 4.8, 90, { pivot: true });
  return { rect: { cx: 0, cz: -D / 2 + 1, hw: w2 + 5, hd: D / 2 + 8 } };
}

// ---------- Armurerie ----------

const ARMOR_SETS = [
  ['ArmorRagsChest', 'ArmorRagsLegs'],
  ['ArmorLeatherChest', 'ArmorLeatherLegs', 'HelmetLeather', 'CapeDeerHide'],
  ['ArmorTrollLeatherChest', 'ArmorTrollLeatherLegs', 'HelmetTrollLeather', 'CapeTrollHide'],
  ['ArmorBronzeChest', 'ArmorBronzeLegs', 'HelmetBronze'],
  ['ArmorRootChest', 'ArmorRootLegs', 'HelmetRoot'],
  ['ArmorIronChest', 'ArmorIronLegs', 'HelmetIron'],
  ['ArmorWolfChest', 'ArmorWolfLegs', 'HelmetDrake', 'CapeWolf'],
  ['ArmorFenringChest', 'ArmorFenringLegs', 'HelmetFenring'],
  ['ArmorPaddedCuirass', 'ArmorPaddedGreaves', 'HelmetPadded', 'CapeLinen'],
  ['ArmorLoxChest', 'ArmorLoxLegs', 'HelmetLox', 'CapeLox'],
  ['ArmorCarapaceChest', 'ArmorCarapaceLegs', 'HelmetCarapace', 'CapeFeather'],
  ['ArmorMageChest', 'ArmorMageLegs', 'HelmetMage'],
  ['ArmorFlametalChest', 'ArmorFlametalLegs', 'HelmetFlametal', 'CapeAsh'],
  ['ArmorAshlandsMediumChest', 'ArmorAshlandsMediumlegs', 'HelmetAshlandsMediumHood', 'CapeAsksvin'],
  ['ArmorMageChest_Ashlands', 'ArmorMageLegs_Ashlands', 'HelmetMage_Ashlands'],
  ['ArmorBerserkerChest', 'ArmorBerserkerLegs', 'HelmetBerserkerHood'],
  ['ArmorBerserkerUndeadChest', 'ArmorBerserkerUndeadLegs', 'HelmetBerserkerUndead'],
  ['ArmorDeepNorthHeavyChest', 'ArmorDeepNorthHeavylegs', 'HelmetDNHeavy', 'CapeDeepNorth'],
  ['ArmorDeepNorthMageChest', 'ArmorDeepNorthMagelegs', 'HelmetDNMage', 'CapeDeepNorthMage'],
  ['ArmorDeepNorthMediumChest', 'ArmorDeepNorthMediumlegs', 'HelmetDNMediumHood'],
  ['HelmetOdin', 'CapeOdin'],
];
const EXCLUDED = /^(Bomb|Tankard|Snowball|GrapplingHook)/;

// Tri des objets du jeu pour l'armurerie : mannequins (ensembles d'armure) et présentoirs muraux (armes, boucliers,
// casques isolés). Les emplacements des mannequins viennent du relevé des pièces (armorSlots).
export function armoryContents(items, geometry) {
  const known = new Map(items.filter((i) => i.craftable).map((i) => [i.name, i]));
  const slots = geometry.ArmorStand_Male?.armorSlots || [];
  const slotFor = (type, used) => slots.findIndex((types, idx) => !used.has(idx) && types.includes(type));
  const inSets = new Set();
  const mannequins = [];
  for (const set of ARMOR_SETS) {
    const ints = {};
    const used = new Set();
    for (const name of set) {
      const item = known.get(name);
      if (!item) continue;
      const idx = slotFor(item.type, used);
      if (idx < 0) continue;
      used.add(idx);
      ints[`${idx}_item`] = name;
      inSets.add(name);
    }
    if (Object.keys(ints).length) mannequins.push(ints);
  }
  for (const item of known.values()) {
    if (inSets.has(item.name) || !/^(Chest|Legs|Shoulder)$/.test(item.type)) continue;
    const idx = slotFor(item.type, new Set());
    if (idx >= 0) mannequins.push({ [`${idx}_item`]: item.name });
  }
  const order = ['Shield', 'OneHandedWeapon', 'Bow', 'TwoHandedWeaponLeft', 'TwoHandedWeapon', 'Tool', 'Helmet'];
  const wall = [...known.values()]
    .filter((i) => order.includes(i.type) && !inSets.has(i.name) && !EXCLUDED.test(i.name))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.skill.localeCompare(b.skill) || a.name.localeCompare(b.name));
  return { mannequins, wall };
}

// Armurerie : deux niveaux de 4 m. Rez-de-chaussée de pierre : allée de mannequins en armure, tables d'exposition,
// râteliers de boucliers ; étage de bois : armes sur présentoirs muraux, classées par type. Présentoirs tenus par le
// serveur : les objets se regardent mais ne s'emportent pas.
export function armory(L, x, z, rot, { contents, name, subtitle }) {
  const f = L.frame(x, z, rot);
  const W = 12;
  const Ln = 28;
  const w2 = W / 2;
  const l2 = Ln / 2;
  const F = LEVEL;
  const U = F + 4;
  const lock = true;

  foundation(f, -l2, -w2, l2, w2 + 3, 0);
  // Rez-de-chaussée en pierre, porte double en façade.
  for (let a = -l2 + 2; a < l2; a += 4) {
    const doorway = Math.abs(a) < 3;
    for (const [row, h] of [[0, F], [1, F + 2]])
      for (const b of [w2, -w2]) {
        if (doorway && b > 0 && row === 0) continue;
        f.put('stone_wall_4x2', a, b, h, 0);
      }
  }
  for (const a of [-1, 1]) f.put('wood_door', a, w2, F, 0);
  for (const a of [-3, 3]) for (const h of [F, F + 1]) f.put('stone_wall_2x1', a, w2, h, 0);
  for (const a of [-l2, l2]) for (let b = -w2 + 2; b < w2; b += 4) for (const h of [F, F + 2]) f.put('stone_wall_4x2', a, b, h, 90);
  // Étage en bois à fenêtres, plancher et escalier.
  for (let a = -l2 + 1; a < l2; a += 2)
    for (const b of [w2, -w2]) {
      if (Math.abs(a) % 8 === 3) {
        f.put('darkwood_decowall', a - 0.5, b, U, 0);
        f.put('darkwood_decowall', a + 0.5, b, U, 0);
      } else f.put('woodwall', a, b, U, 0);
      f.put('woodwall', a, b, U + 2, 0);
    }
  for (const a of [-l2, l2]) for (let b = -w2 + 1; b < w2; b += 2) for (const h of [U, U + 2]) f.put('woodwall', a, b, h, 90);
  for (let a = -l2 + 1; a < l2; a += 2) for (let b = -w2 + 1; b < w2; b += 2) if (!(a > l2 - 10 && a < l2 - 2 && b < -w2 + 2)) f.put('wood_floor', a, b, U, 0);
  for (let s = 0; s < 4; s++) f.put('wood_stair', l2 - 9 + 2 * s, -w2 + 1.5, F + s, 270);
  for (let a = -l2; a <= l2; a += 4) for (const b of [-w2 - 0.2, w2 + 0.2]) if (Math.abs(a) > 2) f.put('wood_pole_log_4', a, b, U, 0);
  gableRoof(f, { width: W, length: Ln, eave: U + 4, dark: true, gables: 'both', dragons: true, overhang: 1 });
  // Enseigne, porche, bannières, cibles et mannequin d'entraînement devant.
  f.put('darkwood_pole4', 3.5, w2 + 2.5, F, 0);
  f.put('sign', 3.5, w2 + 2.74, F + 2.5, 0, { pivot: true, text: name });
  f.put('sign', 3.5, w2 + 2.74, F + 1.8, 0, { pivot: true, text: subtitle });
  for (const a of [-3, 3]) f.put('piece_banner02', a, w2 + 0.62, F + 3.8, 90, { pivot: true });
  f.put('piece_ArcheryTarget', -9, w2 + 2.2, F + 1, 180);
  f.put('piece_TrainingDummy', 9, w2 + 2, F, 180);

  // Mannequins : deux rangées le long de l'allée centrale, face à l'allée.
  const mannequinSpots = [];
  for (let a = -l2 + 3; a <= l2 - 3; a += 2.2) for (const side of [-1, 1]) mannequinSpots.push([a, side * 3, side > 0 ? 180 : 0]);
  contents.mannequins.slice(0, mannequinSpots.length).forEach((ints, i) => {
    const [a, b, r] = mannequinSpots[i];
    f.put('ArmorStand_Male', a, b, F, r, { data: { ints, lock } });
  });
  for (const a of [-l2 + 1.5, l2 - 1.5]) f.put('rug_fur', a, 0, F, 0);

  // Présentoirs muraux : rez-de-chaussée (murs longs, deux rangées) puis étage.
  const wallSpots = [];
  const addWall = (y, rows) => {
    const inset = y === F ? 0.55 : 0.2; // pierre de 1 m au rez-de-chaussée, planches à l'étage
    for (const h of rows) {
      for (let a = -l2 + 1.2; a <= l2 - 1.2; a += 1.3) {
        if (y === F && Math.abs(a) < 3) continue;
        wallSpots.push([a, w2 - inset, y + h, 180]);
        if (a < l2 - 10.5) wallSpots.push([a, -w2 + inset, y + h, 0]);
      }
      for (let b = -w2 + 1.2; b <= w2 - 1.2; b += 1.3) {
        wallSpots.push([-l2 + inset, b, y + h, 90]);
        wallSpots.push([l2 - inset, b, y + h, 270]);
      }
    }
  };
  addWall(U, [1.3, 2.6]);
  addWall(F, [2.2, 3.3]);
  contents.wall.slice(0, wallSpots.length).forEach((item, i) => {
    const [a, b, y, r] = wallSpots[i];
    f.put('itemstand', a, b, y, r, { pivot: true, data: { ints: { item: item.name }, lock } });
  });
  // Lanternes à l'étage.
  for (const a of [-l2 + 4, -2, 6]) {
    f.put('piece_dvergr_lantern', a, w2 - 0.2, U + 3.3, 270, { pivot: true });
    f.put('piece_dvergr_lantern', a, w2 - 0.55, F + 3.6, 270, { pivot: true });
  }
  return { placed: Math.min(contents.wall.length, wallSpots.length), mannequins: Math.min(contents.mannequins.length, mannequinSpots.length) };
}

export const armoryRect = { hw: 15, hd: 10 };
