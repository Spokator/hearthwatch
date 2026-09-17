// Bâtiments du générateur de ville, dans le style viking : fondations de pierre, murs et poteaux de bois,
// toits à 45° à têtes de dragon, tours de pierre coiffées de bois. Chaque fonction bâtit dans un repère local
// (voir layout.js) : +Z est la façade, tournée vers la rue.

import { DEG } from './layout.js';

// Dalle de fondation (1 m de haut) couvrant un rectangle aux bords multiples de 2 : dalles 4×4, complétées en 2×2.
export function foundation(f, x0, z0, x1, z1, bottom = 0) {
  const nx = Math.round((x1 - x0) / 2);
  const nz = Math.round((z1 - z0) / 2);
  const used = Array.from({ length: nx }, () => new Array(nz).fill(false));
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

// Toit à deux pentes à 45° : faîte selon X, largeur 4, 8 ou 12 (Z), rives sur ±width/2 à la hauteur `eave`.
// Pignons fermés (triangles et panneaux) ou ouverts, têtes de dragon aux extrémités du faîte.
export function gableRoof(f, { width, length, eave, dark = true, gables = true, dragons = false, overhang = 0 }) {
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
  if (gables)
    for (const a of [-l2, l2])
      for (let k = 0; k < steps; k++) {
        const edge = w2 - 2 * k - 1;
        for (let c = -edge; c <= edge; c += 2) {
          if (Math.abs(c) === edge) f.put('wood_wall_roof_45', a, c, eave + 2 * k, c < 0 ? 270 : 90, { pivot: true });
          else f.put('woodwall', a, c, eave + 2 * k, 90);
        }
      }
  if (dragons) {
    const peak = eave + 2 * steps;
    f.put('wood_dragon1', l2 + overhang + 0.2, 0, peak - 0.55, 90, { pivot: true });
    f.put('wood_dragon1', -l2 - overhang - 0.2, 0, peak - 0.55, 270, { pivot: true });
  }
  return eave + 2 * steps;
}

// Toit en croupe 4×4 (quatre angles sortants) centré sur (cx, cz), rives à `eave`, sommet 2 m plus haut.
export function hipRoof(f, cx, cz, eave, piece = 'darkwood_roof_ocorner_45') {
  for (const [a, b, r] of [[1, 1, 0], [-1, 1, 270], [1, -1, 90], [-1, -1, 180]]) f.put(piece, cx + a, cz + b, eave, r, { pivot: true });
}

// Tour : fût de pierre plein 4×4, étage de bois ouvert (poteaux, garde-corps), toit en croupe, bannière côté extérieur.
// Le +X local de la tour pointe vers l'extérieur de la ville.
export function tower(L, x, z, rot, stoneHeight, { banner = 'piece_banner02' } = {}) {
  const f = L.frame(x, z, rot);
  for (let h = 0; h < stoneHeight; h++) f.put('stone_floor', 0, 0, h, 0);
  for (const [a, b] of [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]]) f.put('darkwood_pole', a, b, stoneHeight, 0);
  for (const s of [-1, 1]) {
    f.put('wood_wall_half', s, 1.85, stoneHeight, 0);
    f.put('wood_wall_half', s, -1.85, stoneHeight, 0);
    f.put('wood_wall_half', 1.85, s, stoneHeight, 90);
    f.put('wood_wall_half', -1.85, s, stoneHeight, 90);
  }
  hipRoof(f, 0, 0, stoneHeight + 2);
  if (banner) f.put(banner, 2.12, 0, stoneHeight - 0.2, 0, { pivot: true });
}

// Muraille polygonale : soubassement de pierre de 4 m, chemin de ronde en planches sur poteaux côté ville,
// parapet et palissade de rondins côté extérieur, tours d'angle, portes couvertes à têtes de dragon.
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
    const rot = -Math.atan2(z2 - z1, x2 - x1) / DEG; // X le long du mur, +Z vers l'intérieur
    const mid = Math.round(((k + 1) * 2 * half) % 360);
    const gate = gates.includes(mid);
    const f = L.frame((x1 + x2) / 2, (z1 + z2) / 2, rot);
    for (let t = -side / 2 + 2; t < side / 2; t += 4) {
      const opening = gate && Math.abs(t) < 4;
      if (!opening) {
        f.put('stone_wall_4x2', t, 0, 0, 0);
        f.put('stone_wall_4x2', t, 0, 2, 0);
        f.put('darkwood_pole4', t, 1.85, 0, 0);
      }
      for (const s of [-1, 1]) {
        f.put('wood_floor', t + s, 1, 4, 0);
        if (opening) f.put('wood_floor', t + s, -1, 4, 0);
        f.put('wood_wall_half', t + s, opening ? -1.85 : -0.35, 4, 0);
      }
      if (!opening) f.put('wood_pole_log', t - 2, -0.35, 4, 0);
    }
    if (gate) {
      // Porterie : tours de 7 m, linteaux de bois, galerie au-dessus du passage, toit à têtes de dragon, escaliers vers le chemin de ronde.
      const outward = -mid;
      for (const t of [-6, 6]) {
        const [tx, tz] = f.at(t, 0);
        tower(L, tx, tz, outward, 7);
      }
      for (const t of [-2, 2]) for (const b of [-0.4, 0.4, -1.8]) f.put('darkwood_beam4x4', t, b, 3.55, 0);
      const g = L.frame(...f.at(0, 0), rot + 90);
      for (const [a, b] of [[-1.8, -3.8], [1.8, -3.8], [-1.8, 3.8], [1.8, 3.8]]) g.put('darkwood_pole', a, b, 4, 0);
      gableRoof(g, { width: 8, length: 4, eave: 6, gables: true, dragons: true });
      for (const t of [-3.2, 3.2]) {
        f.put('piece_banner02', t, -2.05, 5.8, 90, { pivot: true });
        f.put('piece_banner07', t, 2.05, 5.8, 90, { pivot: true });
      }
      for (const dir of [-1, 1])
        for (let s = 0; s < 4; s++) f.put('wood_stair', dir * (13 - 2 * s), 3, s, dir > 0 ? 90 : 270);
      for (const dir of [-1, 1]) f.put('wood_floor', dir * 5, 3, 4, 0);
      gateList.push({ angle: mid, x: Math.cos(mid * DEG) * apothem, z: Math.sin(mid * DEG) * apothem });
    }
  }
  for (const [x, z] of vertices) tower(L, x, z, -Math.atan2(z, x) / DEG, 6);
  return { apothem, Rv, vertices, gates: gateList, N, half };
}

// Pavillon d'artisans : poteaux, poutres, mur de fond, toit à deux pentes et têtes de dragon, façade ouverte vers +Z.
export function hall(L, x, z, rot, length, { back = true, dark = true, sign } = {}) {
  const f = L.frame(x, z, rot);
  const H = 4;
  for (let a = -length / 2; a <= length / 2 + 0.01; a += 4) for (const b of [-3.8, 3.8]) f.put('darkwood_pole4', a, b, 0, 0);
  for (let a = -length / 2 + 2; a < length / 2; a += 4) for (const b of [-3.8, 3.8]) f.put('darkwood_beam4x4', a, b, H - 0.45, 0);
  for (const a of [-length / 2, length / 2]) for (const b of [-2, 2]) f.put('darkwood_beam4x4', a, b, H - 0.45, 90);
  if (back) for (let a = -length / 2 + 1; a < length / 2; a += 2) for (const row of [0, 2]) f.put('woodwall', a, -3.6, row, 0);
  gableRoof(f, { width: 8, length, eave: H, dark, gables: false, dragons: true });
  for (const a of [-length / 2, length / 2]) f.put('piece_dvergr_lantern', a + (a < 0 ? 0.2 : -0.2), 3.99, 3, 90, { pivot: true });
  f.put('wood_stack', -length / 2 - 1.5, -2, 0, 0);
  if (sign) {
    f.put('darkwood_pole4', length / 2 + 1.5, 5.5, 0, 0);
    f.put('sign', length / 2 + 1.5, 5.74, 2.2, 0, { pivot: true, text: sign });
  }
  return f;
}

export const hallRect = (length) => ({ hw: length / 2 + 2.5, hd: 6 });

// Modèles de maisons : dimensions (largeur selon Z, longueur selon X), étages de murs, jardin.
export const HOUSE_TYPES = {
  hut: { width: 4, length: 6, rows: 1 },
  house: { width: 4, length: 8, rows: 1 },
  longhouse: { width: 8, length: 12, rows: 1 },
  tall: { width: 8, length: 8, rows: 2, balcony: true },
  garden: { width: 4, length: 6, rows: 1, garden: 6 },
};

// Emprise d'une maison le long d'une rue : longueur (le long de la rue) et profondeur (marches et balcon compris).
export const houseLot = (spec) => ({ along: spec.length + (spec.garden || 0), depth: spec.width + 2.4 });

// Maison viking : fondation de pierre de 1 m, murs de planches entre poteaux de rondins, porte encadrée avec marches
// et lanterne, toit à 45° (têtes de dragon sauf pour les cabanes), meubles. Le repère est le centre de la maison.
export function vikingHouse(L, x, z, rot, spec, random) {
  const f = L.frame(x, z, rot);
  const { width, length, rows } = spec;
  const w2 = width / 2;
  const l2 = length / 2;
  const F = 1;
  const H = F + 2 * rows;
  const dark = random() < 0.55;

  foundation(f, -l2, -w2, l2, w2, 0);
  const segments = [];
  for (let a = -l2 + 1; a < l2; a += 2) segments.push(a);
  const door = segments[Math.floor(segments.length / 2)];
  for (let r = 0; r < rows; r++) {
    const y = F + 2 * r;
    for (const a of segments) {
      if (!(r === 0 && a === door)) f.put('woodwall', a, w2, y, 0);
      f.put('woodwall', a, -w2, y, 0);
    }
    for (const a of [-l2, l2]) for (let b = -w2 + 1; b < w2; b += 2) f.put('woodwall', a, b, y, 90);
    for (const [a, b] of [[-l2, -w2], [l2, -w2], [-l2, w2], [l2, w2]]) f.put('wood_pole_log', a, b, y, 0);
    for (let a = -l2 + 4; a < l2; a += 4) for (const b of [-w2, w2]) if (Math.abs(a - door) > 1.2 || b < 0) f.put('wood_pole_log', a, b + Math.sign(b) * 0.2, y, 0);
  }
  gableRoof(f, { width, length, eave: H, dark, gables: true, dragons: spec !== HOUSE_TYPES.hut });

  // Entrée : porte, montants, linteau, marches de pierre, lanterne.
  f.put('wood_door', door, w2, F, 0);
  for (const s of [-1.15, 1.15]) f.put('wood_pole_log', door + s, w2 + 0.25, F, 0);
  f.put('wood_beam', door, w2 + 0.25, F + 1.8, 0);
  f.put('stone_stair', door, w2 + 1, 0, 0);
  f.put('piece_dvergr_lantern', door + 1.8, w2 + 0.16, F + 1.9, 90, { pivot: true });

  // Balcon à l'étage, porté par des poteaux, avec garde-corps.
  if (spec.balcony) {
    for (let a = -l2 + 1; a < l2; a += 2) f.put('wood_floor', a, w2 + 1, F + 2, 0);
    for (let a = -l2 + 1.35; a < l2 - 1; a += 2.7) f.put('wood_fence', a, w2 + 1.95, F + 2.1, 0);
    for (const s of [-1, 1]) {
      f.put('wood_fence', s * (l2 - 0.1), w2 + 1, F + 2.1, 90);
      f.put('darkwood_pole4', s * (l2 - 0.2), w2 + 1.8, 0, 0);
    }
  }

  // Jardin clôturé sur le côté : terre cultivée, ruche, banc, bois empilé, portillon sur la rue.
  if (spec.garden) {
    const g0 = l2;
    const g1 = l2 + spec.garden;
    for (let a = g0 + 1.35; a < g1; a += 2.7) {
      if (Math.abs(a - (g0 + g1) / 2) < 1.5) f.put('wood_fence_gate', a, w2 + 1.2, 0, 0);
      else f.put('wood_fence', a, w2 + 1.2, 0, 0);
      f.put('wood_fence', a, -w2 - 0.3, 0, 0);
    }
    for (let b = -w2 + 1.1; b < w2 + 1; b += 2.7) f.put('wood_fence', g1, b, 0, 90);
    f.put('piece_beehive', g1 - 1, -w2 + 0.8, 0, 180);
    f.put('piece_logbench01', g0 + 2, -w2 + 0.6, 0, 0);
    f.put('wood_stack', g1 - 1.4, w2 - 0.6, 0, 0);
  }

  // Mobilier (sans feu : la fumée s'accumule sous un toit fermé).
  f.put('rug_deer', 0, 0, F, 0);
  f.put('piece_bed02', -l2 + 1.9, -w2 + 1.4, F, 90);
  f.put('piece_chest_wood', l2 - 1, -w2 + 0.55, F, 0);
  f.put('piece_table', l2 - 1.2, w2 - 1.6, F, 90);
  f.put('piece_chair03', l2 - 2.25, w2 - 1.9, F, 90);
  f.put('piece_dvergr_lantern', 0, -w2 + 0.16, F + 1.7, 90, { pivot: true });
  if (width === 8) {
    f.put('piece_table_oak', 0.5, 0.4, F, 0);
    for (const a of [-1.6, 2.6]) {
      f.put('piece_bench01', a, -0.9, F, 180);
      f.put('piece_bench01', a, 1.7, F, 0);
    }
    f.put('piece_chest_wood', -l2 + 0.55, w2 - 1.2, F, 90);
    f.put('wood_stack', -l2 - 1.4, w2 - 1, 0, 0);
  } else if (random() < 0.5) f.put('stone_pile', -l2 - 0.9, w2 - 0.5, 0, 0);
}

// Grande brasserie : longue salle de 12×24 m sur fondation de pierre, murs de 4 m entre poteaux, pignons ouverts
// (la fumée des âtres s'échappe sous le faîte), deux âtres, longues tables et bancs, comptoir, fermenteurs, tonneaux,
// trône du maître des lieux, bannières. Façade (+Z) avec porche, enseigne et tableau des contrats.
export function brasserie(L, x, z, rot, { name, subtitle, board, boardEmpty }) {
  const f = L.frame(x, z, rot);
  const W = 12;
  const Ln = 24;
  const w2 = W / 2;
  const l2 = Ln / 2;
  const F = 1;
  const H = F + 4;
  const door = 1;
  const boards = [];

  foundation(f, -l2, -w2, l2, w2, 0);
  for (const y of [F, F + 2])
    for (let a = -l2 + 1; a < l2; a += 2) {
      if (!(y === F && a === door)) {
        f.put('woodwall', a, w2, y, 0);
        f.put('woodwall', a, -w2, y, 0);
      }
    }
  for (const y of [F, F + 2]) for (const a of [-l2, l2]) for (let b = -w2 + 1; b < w2; b += 2) f.put('woodwall', a, b, y, 90);
  for (let a = -l2; a <= l2; a += 4) for (const b of [-w2 - 0.2, w2 + 0.2]) if (Math.abs(a - door) > 1.5) f.put('wood_pole_log_4', a, b, F, 0);
  gableRoof(f, { width: W, length: Ln, eave: H, dark: true, gables: false, dragons: true, overhang: 1 });

  // Portes (devant et derrière), marches, porche couvert, enseigne, lanternes.
  for (const b of [w2, -w2]) {
    f.put('wood_door', door, b, F, b > 0 ? 0 : 180);
    for (const s of [-1, 1]) f.put('stone_stair', door + s, b + Math.sign(b), 0, b > 0 ? 0 : 180);
  }
  for (const s of [-1, 1]) {
    f.put('wood_roof', door + s, w2 + 1, H - 1.3, 0, { pivot: true });
    f.put('wood_pole_log_4', door + s * 1.8, w2 + 2.2, 0, 0);
  }
  f.put('sign', door + 1.8, w2 + 2.44, 2.6, 0, { pivot: true, text: name });
  f.put('sign', door + 1.8, w2 + 2.44, 1.9, 0, { pivot: true, text: subtitle });
  for (const a of [-6, 6]) f.put('piece_dvergr_lantern', a, w2 + 0.36, F + 2.6, 90, { pivot: true });

  // Tableau des contrats à gauche de l'entrée.
  for (const a of [-9, -5]) f.put('darkwood_pole4', a, w2 + 2.5, 0, 0);
  f.put('darkwood_beam4x4', -7, w2 + 2.5, 3.6, 0);
  f.put('sign', -7, w2 + 2.74, 3.1, 0, { pivot: true, text: board });
  for (const [a, h] of [[-8, 2.4], [-6, 2.4], [-8, 1.6], [-6, 1.6]]) boards.push(f.put('sign', a, w2 + 2.55, h, 0, { pivot: true, text: boardEmpty }));

  // Salle : âtres, longues tables et bancs, tapis dans l'allée.
  for (const a of [-6, 6]) {
    f.put('hearth', a, 0, F, 0);
    for (const s of [-1, 1]) {
      f.put('piece_table_oak', a, s * 3.7, F, 0);
      for (const d of [-2.2, 0, 2.2]) {
        f.put('piece_bench01', a + d, s * 2.3, F, s > 0 ? 180 : 0);
        f.put('piece_bench01', a + d, s * 5.1, F, s > 0 ? 0 : 180);
      }
    }
  }
  for (const a of [-1.5, 1.5]) f.put('rug_fur', a, 0, F, 90);

  // Comptoir, hydromel, fermenteurs et tonneaux au fond.
  for (const b of [-2.46, 0, 2.46]) f.put('piece_table', 10.3, b, F, 90);
  f.put('piece_MeadCauldron', 11.3, 0, F, 0);
  for (const b of [-4.6, 4.6]) f.put('fermenter', 11, b, F, 270);
  for (const b of [-2.3, 2.3]) f.put('piece_chest_barrel', 11.3, b, F, 0);

  // Trône et tables rondes de l'autre côté.
  f.put('piece_throne02', -11.2, 0, F, 90);
  for (const b of [-3.9, 3.9]) {
    f.put('piece_table_round', -10.6, b, F, 0);
    f.put('piece_chair03', -10.6, b - Math.sign(b) * 1.55, F, b > 0 ? 180 : 0);
    f.put('piece_chair03', -10.6, b + Math.sign(b) * 1.55, F, b > 0 ? 0 : 180);
  }

  // Bannières et lanternes sur les longs murs.
  [-9, -3, 3, 9].forEach((a, i) => {
    f.put(i % 2 ? 'piece_banner07' : 'piece_banner02', a, w2 - 0.25, F + 3.8, 90, { pivot: true });
    f.put(i % 2 ? 'piece_banner02' : 'piece_banner07', a, -w2 + 0.25, F + 3.8, 90, { pivot: true });
  });
  for (const a of [-1.5, 1.5]) {
    f.put('piece_dvergr_lantern', a + 3, w2 - 0.16, F + 2.6, 270, { pivot: true });
    f.put('piece_dvergr_lantern', a - 3, -w2 + 0.16, F + 2.6, 90, { pivot: true });
  }
  return boards;
}

export const brasserieRect = { hw: 14, hd: 9.5 };
