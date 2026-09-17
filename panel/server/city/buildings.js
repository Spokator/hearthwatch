// Bâtiments du générateur de ville, dans le style viking : éléments communs, muraille, pavillons d'artisans, maisons.
//
// Toute la ville repose sur un dallage de pierre continu (posé par le générateur) : le sol praticable est partout à
// LEVEL = 1 m. Les bâtiments ne posent donc pas de fondation, seulement leurs estrades. Les étages font 3 m (portes de
// 2 m, plafonds à 3 m), les grandes salles davantage. Chaque fonction bâtit dans un repère local (voir layout.js) dont
// le +Z est la façade, tournée vers la rue.

import { DEG } from './layout.js';
import { furnish, Room } from './furniture.js';

export const LEVEL = 1;
export const STOREY = 3;

// Pièces à potence (lanterne naine, lampadaire) : le bras est le long de -X local. Rotation qui le tourne vers (dx, dz).
export const armToward = (dx, dz) => Math.atan2(dz, -dx) / DEG;

// ---------- Éléments communs ----------

// Dalles de pierre (1 m) couvrant un rectangle aux bords multiples de 2 : estrades, comptoirs, socles.
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

// Plancher de planches couvrant un rectangle aux bords multiples de 2.
export function planks(f, x0, z0, x1, z1, bottom, skip = null) {
  for (let a = x0 + 1; a < x1; a += 2) for (let b = z0 + 1; b < z1; b += 2) if (!skip?.(a, b)) f.put('wood_floor', a, b, bottom, 0);
}

// Toit à deux pentes à 45°, faîte selon X, largeur multiple de 4 (Z), rives à `eave` au droit des murs.
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

// Ferme de charpente dans le plan Z (x fixe) : entrait à la hauteur des rives, poinçon et deux arbalétriers.
export function truss(f, x, cz, width, eave) {
  const g = f.sub(x, cz, 90);
  for (let b = -width / 2 + 2; b < width / 2; b += 4) g.put('darkwood_beam4x4', b, 0, eave - 0.45, 0);
  if (width >= 8) {
    g.put('darkwood_pole', 0, 0, eave, 0);
    g.put('wood_beam_45', -1.21, 0, eave + 0.05, 0, { pivot: false });
    g.put('wood_beam_45', 1.21, 0, eave + 0.05, 180, { pivot: false });
  }
}

// Toit en croupe 4×4 centré sur (cx, cz), rives à `eave`.
export function hipRoof(f, cx, cz, eave, piece = 'darkwood_roof_ocorner_45') {
  for (const [a, b, r] of [[1, 1, 0], [-1, 1, 270], [1, -1, 90], [-1, -1, 180]]) f.put(piece, cx + a, cz + b, eave, r, { pivot: true });
}

// Toit pyramidal d'un carré de demi-côté `s` (entier ≥ 2) : rangs de tuiles sur chaque face, angles en croupe.
export function squareRoof(f, cx, cz, s, eave, { dark = true, finial = true } = {}) {
  const tile = dark ? 'darkwood_roof_45' : 'wood_roof_45';
  const corner = dark ? 'darkwood_roof_ocorner_45' : 'wood_roof_ocorner_45';
  let ss = s;
  let y = eave;
  while (ss >= 2) {
    for (const [a, b, r] of [[1, 1, 0], [-1, 1, 270], [1, -1, 90], [-1, -1, 180]]) f.put(corner, cx + a * (ss - 1), cz + b * (ss - 1), y, r, { pivot: true });
    for (let t = -(ss - 2) + 1; t <= ss - 2 - 1 + 0.01; t += 2) {
      f.put(tile, cx + t, cz + ss - 1, y + 1, 0, { pivot: true });
      f.put(tile, cx + t, cz - ss + 1, y + 1, 180, { pivot: true });
      f.put(tile, cx + ss - 1, cz + t, y + 1, 90, { pivot: true });
      f.put(tile, cx - ss + 1, cz + t, y + 1, 270, { pivot: true });
    }
    ss -= 2;
    y += 2;
  }
  if (ss === 1) f.put(dark ? 'darkwood_roof_top_45' : 'wood_roof_top_45', cx, cz, y - 0.4, 0, { pivot: true });
  if (finial) f.put('wood_pole', cx, cz, y + (ss === 1 ? 0.5 : 0), 0);
  return y;
}

// Barrière basse (1 m) de poteaux et de lisses, le long de X entre x0 et x1.
export function lowFence(f, x0, x1, z, bottom) {
  const posts = [];
  for (let a = x0; a <= x1 + 0.01; a += 4) posts.push(a);
  for (const a of posts) f.put('wood_pole', a, z, bottom, 0);
  for (let i = 0; i + 1 < posts.length; i++) f.put('darkwood_beam4x4', (posts[i] + posts[i + 1]) / 2, z, bottom + 0.5, 0);
}

// Lampadaire (3,4 m) : la lanterne pend au-dessus du passage, tournée vers (dx, dz).
export function lampPost(f, x, z, bottom, dx, dz) {
  return f.put('piece_dvergr_lantern_pole', x, z, bottom, armToward(dx, dz), { pivotXZ: true });
}

// Éclairage mural d'une pièce : (x, z) sur le parement, (dx, dz) vers la pièce. Lanterne naine sous un haut plafond,
// applique sinon ; toujours au-dessus de 2 m pour ne gêner personne.
export function wallLight(f, x, z, floor, dx, dz, tall = false) {
  if (tall) return f.put('piece_dvergr_lantern', x, z, floor + 2.95, armToward(dx, dz), { pivot: true });
  return f.put('piece_walltorch', x + dx * 0.25, z + dz * 0.25, floor + 2.05, armToward(dx, dz));
}

// Contrefiches (liens à 45°) de part et d'autre d'un poteau en (x, z), sous une poutre à `top`, dans le plan du mur.
export function kneeBraces(f, x, z, top, alongZ = false) {
  const g = f.sub(x, z, alongZ ? 90 : 0);
  g.put('wood_beam_45', -1.21, 0, top - 1.21, 0, { pivot: true });
  g.put('wood_beam_45', 1.21, 0, top - 1.21, 180, { pivot: true });
}

// Liens à 26° de part et d'autre d'un poteau de façade en (x, z), sous la sablière à `top` (1,5 m de haut).
export function facadeBraces(f, x, z, top) {
  const g = f.sub(x, z, 0);
  g.put('wood_beam_26', -1.14, 0, top - 1.54, 0);
  g.put('wood_beam_26', 1.14, 0, top - 1.54, 180);
}

// Clôture de jardin : piquets et rondins couchés (différente des garde-corps des balcons).
export function gardenFence(f, x0, x1, z, bottom) {
  for (let a = x0; a <= x1 + 0.01; a += 2) f.put('wood_pole', a, z, bottom, 0);
  for (let a = x0 + 1; a < x1; a += 2) f.put('wood_wall_log', a, z, bottom + 0.3, 0);
}

// Garde-corps d'escalier ou de trémie : poteaux et main courante, sans les planches des balcons.
export function railing(f, x0, x1, z, bottom) {
  for (let a = x0; a <= x1 + 0.01; a += 2) f.put('wood_pole', a, z, bottom, 0);
  for (let a = x0 + 1; a < x1; a += 2) f.put('darkwood_beam', a, z, bottom + 0.55, 0);
}

// Pièces disposées en cercle autour de (0, 0) du repère : `a` en degrés, +Z de la pièce tourné vers le centre ;
// `along` décale le long de la tangente.
export function ringPut(f, name, r, a, bottom, opts = {}) {
  const rad = a * DEG;
  const along = opts.along || 0;
  const x = Math.cos(rad) * r - Math.sin(rad) * along;
  const z = Math.sin(rad) * r + Math.cos(rad) * along;
  return f.put(name, x, z, bottom, -90 - a + (opts.turn || 0), opts);
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
// des poteaux côté ville et couvert d'un auvent de bardeaux (2,5 m de passage), parapet et palissade côté extérieur,
// tours saillantes, porteries couvertes à têtes de dragon, escaliers d'accès depuis le niveau de la ville.
// Les marches des portes s'arrêtent sur une ligne paire du repère de la ville, pour que le dallage les rejoigne.
export function rampart(L, R, gates) {
  L.district = 'rampart';
  const N = R < 90 ? 16 : 20;
  const half = 180 / N;
  const side = Math.max(16, Math.round((2 * R * Math.sin(half * DEG)) / 8) * 8);
  const Rv = side / (2 * Math.sin(half * DEG));
  const apothem = Rv * Math.cos(half * DEG);
  const gateEdge = 2 * Math.floor((apothem - 2.5) / 2);
  const stairTop = apothem - gateEdge; // distance au mur du haut des marches, entre 2,5 et 4,5 m
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
        // Poteaux côté ville juste au bord du chemin de ronde (2 m de passage), sauf au-dessus des escaliers.
        const nearStairs = gate && Math.abs(t) > 7 && Math.abs(t) < 17;
        if (!nearStairs) {
          f.put('darkwood_pole4', t, 2.25, 0, 0);
          f.put('darkwood_pole', t, 2.25, 4, 0);
          f.put('wood_pole', t, 2.25, 6, 0);
        }
        f.put('wood_pole_log', t - 2, -0.35, 4, 0);
        f.put('wood_pole_log', t - 2, -0.35, 6, 0);
        if (block % 2 === 0) for (const h of [0, 2]) f.put('stone_pillar', t - 2, -0.9, h, 0);
        if (block % 3 === 1) f.put(block % 2 ? 'piece_banner07' : 'piece_banner02', t, -0.62, 3.6, 90, { pivot: true });
      }
      for (const s of [-1, 1]) {
        f.put('wood_floor', t + s, 1, 4, 0);
        if (opening) f.put('wood_floor', t + s, -1, 4, 0);
        f.put('wood_wall_half', t + s, opening ? -1.85 : -0.35, 4, 0);
        // Auvent au-dessus du chemin de ronde, assez haut pour y marcher (2,5 m sous les bardeaux).
        if (!nearGate) f.put('darkwood_roof', t + s, 1, 6.75, 0, { pivot: true });
      }
    }
    if (gate) {
      // Porterie : deux tours saillantes, linteaux, galerie couverte haute au-dessus du passage, marches vers la ville.
      const outward = -mid;
      for (const t of [-6, 6]) {
        const [tx, tz] = f.at(t, -2.5);
        tower(L, tx, tz, outward, 7);
      }
      for (const t of [-2, 2]) for (const b of [-0.4, 0.4, -1.8]) f.put('darkwood_beam4x4', t, b, 3.55, 0);
      const g = f.sub(0, 0, 90);
      for (const [a, b] of [[-2.25, -3.8], [2.25, -3.8], [-2.25, 3.8], [2.25, 3.8]]) g.put('darkwood_pole4', a, b, 4, 0);
      gableRoof(g, { width: 8, length: 4, eave: 8, gables: 'both', dragons: true });
      for (const t of [-3.2, 3.2]) {
        f.put('piece_banner02', t, -2.05, 6.8, 90, { pivot: true });
        f.put('piece_banner07', t, 2.05, 6.8, 90, { pivot: true });
      }
      // Marches du passage vers le niveau de la ville (le haut des marches à `stairTop` du mur).
      for (const t of [-3, -1, 1, 3]) f.put('stone_stair', t, stairTop - 1, 0, 180);
      // Escaliers vers le chemin de ronde, de part et d'autre de la porte, depuis le dallage de la ville.
      for (const dir of [-1, 1]) {
        for (let s = 0; s < 3; s++) f.put('wood_stair', dir * (9 + 2 * s), 3, LEVEL + s, dir > 0 ? 270 : 90);
        f.put('wood_floor', dir * 15, 3, 4, 0);
        f.put('wood_floor', dir * 15, 1, 4, 0);
      }
      gateList.push({ angle: mid, x: Math.cos(mid * DEG) * apothem, z: Math.sin(mid * DEG) * apothem });
      // Postes de garde : de part et d'autre du passage côté ville, et dehors au bout du pont.
      for (const t of [-4.6, 4.6]) f.spot('guard', t, stairTop + 1.5, LEVEL, { place: `gate${mid}` });
      f.spot('outskirts', 0, -26, 0, { place: `gate${mid}` });
    }
  }
  // Tours d'angle saillantes : le chemin de ronde passe derrière elles.
  for (const [x, z] of vertices) {
    const r = Math.hypot(x, z);
    tower(L, x * (1 + 2.3 / r), z * (1 + 2.3 / r), -Math.atan2(z, x) / DEG, 6);
  }
  return { apothem, Rv, vertices, gates: gateList, N, half, gateEdge };
}

// ---------- Ateliers ----------

// Pavillon d'artisans : poteaux, sablières et contrefiches, mur de fond, fermes apparentes, toit à dragons, façade
// ouverte (+Z).
export function hall(L, x, z, rot, length, { back = true, dark = true, sign, key } = {}) {
  const f = L.frame(x, z, rot);
  if (key) {
    f.spot('work', 0, 1.8, LEVEL, { place: key });
    f.put('piece_chest_wood', length / 2 - 1.3, -2.6, LEVEL, 0, { data: { ints: { HearthwatchCounter: key }, lock: false } });
    f.spot('counter', length / 2 - 1.3, -1.9, LEVEL, { place: key });
  }
  const B = LEVEL;
  const H = B + 4;
  for (let a = -length / 2; a <= length / 2 + 0.01; a += 4)
    for (const b of [-3.8, 3.8]) {
      f.put('darkwood_pole4', a, b, B, 0);
      if (Math.abs(a) < length / 2 - 0.01) kneeBraces(f, a, b, H - 0.45);
    }
  for (let a = -length / 2 + 2; a < length / 2; a += 4) for (const b of [-3.8, 3.8]) f.put('darkwood_beam4x4', a, b, H - 0.45, 0);
  for (let a = -length / 2; a <= length / 2 + 0.01; a += 4) truss(f, a, 0, 8, H);
  if (back) for (let a = -length / 2 + 1; a < length / 2; a += 2) {
    f.put('stone_wall_2x1', a, -3.6, B, 0);
    f.put('woodwall', a, -3.6, B + 1, 0);
    f.put('wood_wall_half', a, -3.6, B + 3, 0);
  }
  gableRoof(f, { width: 8, length, eave: H, dark, gables: 'none', dragons: true });
  for (const a of [-length / 2, length / 2]) f.put('piece_dvergr_lantern', a + (a < 0 ? 0.2 : -0.2), 3.99, B + 3.3, 90, { pivot: true });
  f.put('wood_stack', -length / 2 - 1, 4.8, B, 0);
  if (sign) {
    f.put('darkwood_pole4', length / 2 + 1.2, 5.3, B, 0);
    f.put('sign', length / 2 + 1.2, 5.54, B + 2.2, 0, { pivot: true, text: sign });
  }
  return f;
}

export const hallRect = (length) => ({ hw: length / 2 + 2, hd: 5 });

// ---------- Maisons ----------

// Plans au sol : rectangles (x0, z0, x1, z1, étages) dans le repère de la maison, façade du premier sur +Z. Les
// largeurs de toit (profondeur du corps principal, largeur des ailes) sont des multiples de 4.
// Chaque plan n'est bâti qu'une fois par ville (tant qu'il en reste).
export const HOUSE_PLANS = [
  { key: 'longhouse', rects: [[-8, -4, 8, 4, 1]], extra: { hearth: true } },
  { key: 'longhouse20', rects: [[-10, -4, 10, 4, 1]], extra: { hearth: true } },
  { key: 'grandlonghouse', rects: [[-10, -6, 10, 6, 1]], extra: { hearth: true } },
  { key: 'squarehall', rects: [[-6, -6, 6, 6, 1]], extra: { hearth: true } },
  { key: 'balcony', rects: [[-6, -4, 6, 4, 2]], extra: { balcony: true } },
  { key: 'balcony16', rects: [[-8, -4, 8, 4, 2]], extra: { balcony: true } },
  { key: 'balconygarden', rects: [[-6, -4, 6, 4, 2]], extra: { balcony: true, garden: 8 } },
  { key: 'twostorey', rects: [[-8, -4, 8, 4, 2]], extra: {} },
  { key: 'twostorey12', rects: [[-6, -6, 6, 6, 2]], extra: {} },
  { key: 'lshape', rects: [[-6, -4, 6, 4, 1], [-6, -12, 2, -4, 1]], extra: {} },
  { key: 'lshapeRight', rects: [[-6, -4, 6, 4, 1], [-2, -12, 6, -4, 1]], extra: {} },
  { key: 'lshapeTall', rects: [[-8, -4, 4, 4, 2], [-4, -12, 4, -4, 1]], extra: {} },
  { key: 'lshapeLong', rects: [[-10, -4, 6, 4, 1], [2, -12, 6, -4, 1]], extra: { hearth: true } },
  { key: 'lshapeStone', rects: [[-6, -4, 6, 4, 2], [-6, -12, 2, -4, 1]], extra: { stone: true } },
  { key: 'tshape', rects: [[-8, -4, 8, 4, 1], [-4, -12, 4, -4, 1]], extra: {} },
  { key: 'tshapeTall', rects: [[-8, -4, 8, 4, 2], [-4, -12, 4, -4, 1]], extra: {} },
  { key: 'ushape', rects: [[-8, -4, 8, 4, 1], [-8, -12, -4, -4, 1], [4, -12, 8, -4, 1]], extra: {} },
  { key: 'ushapeWide', rects: [[-10, -4, 10, 4, 1], [-10, -10, -6, -4, 1], [6, -10, 10, -4, 1]], extra: { hearth: true } },
  { key: 'stonehouse', rects: [[-6, -4, 6, 4, 2]], extra: { stone: true } },
  { key: 'stonelong', rects: [[-8, -4, 8, 4, 1]], extra: { stone: true, hearth: true } },
  { key: 'tower', rects: [[-4, -4, 6, 4, 3]], extra: {} },
  { key: 'stonetower', rects: [[-4, -4, 6, 4, 3]], extra: { stone: true } },
  { key: 'shed', rects: [[-6, -4, 6, 4, 1]], extra: { shed: true } },
  { key: 'shedlong', rects: [[-8, -4, 8, 4, 1]], extra: { shed: true, hearth: true } },
  { key: 'garden', rects: [[-6, -4, 6, 4, 1]], extra: { garden: 8 } },
  { key: 'gardenlarge', rects: [[-8, -4, 4, 4, 1]], extra: { garden: 12 } },
  { key: 'round', round: { apothem: 5 }, extra: {} },
  { key: 'cottage', rects: [[-6, -4, 6, 4, 1]], extra: {} },
  { key: 'cottageStone', rects: [[-6, -4, 6, 4, 1]], extra: { stone: true, hearth: true } },
  { key: 'lshapeSmall', rects: [[-6, -4, 6, 4, 1], [2, -8, 6, -4, 1]], extra: {} },
  { key: 'tshapeSmall', rects: [[-6, -4, 6, 4, 1], [-2, -8, 2, -4, 1]], extra: { hearth: true } },
  { key: 'balconyStone', rects: [[-6, -4, 6, 4, 2]], extra: { balcony: true, stone: true } },
  { key: 'shedStone', rects: [[-6, -4, 6, 4, 1]], extra: { shed: true, stone: true } },
  { key: 'roundlarge', round: { apothem: 7.24 }, extra: {} },
];

// Emprise d'un plan : le long de la rue (X) et en profondeur (Z) ; z1 : bord du seuil côté rue.
export function houseFootprint(plan) {
  if (plan.round) {
    const rv = plan.round.apothem / Math.cos(22.5 * DEG);
    return { x0: -Math.ceil(rv) - 1, x1: Math.ceil(rv) + 1, z0: 4 - 2 * plan.round.apothem - 1, z1: 6 };
  }
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
  return { x0, x1, z0, z1: plan.rects[0][3] + 2 };
}

// Maison viking : soubassement de pierre et murs de bois (ou pierre sur toute la hauteur), poteaux en rondins,
// fenêtres à claire-voie, porte de 2 m avec seuil, toit(s) à dragons et fermes apparentes, étages avec escalier droit
// le long du mur du fond (départ dégagé, palier, garde-corps), balcon, appentis ou jardin, mobilier selon `theme`.
export function vikingHouse(L, x, z, rot, plan, random, theme) {
  if (plan.round) return roundHouse(L, x, z, rot, plan, random, theme);
  const f = L.frame(x, z, rot);
  const F = LEVEL;
  const dark = random() < 0.5;
  const cells = new Map(); // "i,j" -> étages ; cellule de 2 m dont le coin bas est (2i, 2j)
  const key = (i, j) => `${i},${j}`;
  for (const [x0, z0, x1, z1, storeys] of plan.rects)
    for (let a = x0; a < x1; a += 2) for (let b = z0; b < z1; b += 2) cells.set(key(a / 2, b / 2), Math.max(storeys, cells.get(key(a / 2, b / 2)) || 0));
  const main = plan.rects[0];
  const [mx0, mz0, mx1, mz1, storeysMain] = main;
  const stone = !!plan.extra.stone;

  // Escalier : trois marches le long du mur du fond, départ à 2 m du mur de gauche, palier à droite ; trémie 6 × 4.
  const stairX0 = mx0 + 2;
  const hole = (a, b) => a > stairX0 && a < stairX0 + 6 && b > mz0 && b < mz0 + 4;

  // Porte : milieu de la façade.
  const doorX = Math.round((mx0 + mx1) / 4) * 2 + 1 - (random() < 0.5 ? 2 : 0);

  // Murs : chaque arête extérieure de cellule, par étage.
  const edges = [];
  for (const [k, storeys] of cells) {
    const [i, j] = k.split(',').map(Number);
    const cx = 2 * i + 1;
    const cz = 2 * j + 1;
    for (const [di, dj, ex, ez, wr] of [[0, 1, cx, cz + 1, 0], [0, -1, cx, cz - 1, 0], [1, 0, cx + 1, cz, 90], [-1, 0, cx - 1, cz, 90]]) {
      const neighbour = cells.get(key(i + di, j + dj)) || 0;
      for (let s = 0; s < storeys; s++) if (neighbour <= s) edges.push({ x: ex, z: ez, rot: wr, s, front: dj === 1, back: dj === -1 });
    }
  }
  for (const e of edges) {
    const y = F + STOREY * e.s;
    const isDoor = e.front && e.x === doorX && e.z === mz1 && e.s === 0;
    const isUpperDoor = plan.extra.balcony && e.front && e.x === doorX && e.z === mz1 && e.s === 1;
    if (isDoor || isUpperDoor) {
      f.put('wood_door', e.x, e.z, y, 0);
      f.put('wood_wall_half', e.x, e.z, y + 2, e.rot);
      continue;
    }
    // Pas de fenêtre derrière l'escalier.
    const behindStair = e.back && e.z === mz0 && e.x > stairX0 && e.x < stairX0 + 6;
    const win = !behindStair && random() < (e.s === 0 ? 0.2 : 0.3);
    const [dx, dz] = e.rot ? [0, 0.5] : [0.5, 0];
    if (e.s === 0) {
      f.put('stone_wall_2x1', e.x, e.z, y, e.rot);
      if (stone) {
        f.put('stone_wall_2x1', e.x, e.z, y + 1, e.rot);
        f.put('stone_wall_2x1', e.x, e.z, y + 2, e.rot);
      } else if (win) {
        f.put('darkwood_decowall', e.x - dx, e.z - dz, y + 1, e.rot);
        f.put('darkwood_decowall', e.x + dx, e.z + dz, y + 1, e.rot);
      } else f.put('woodwall', e.x, e.z, y + 1, e.rot);
    } else if (win) {
      f.put('darkwood_decowall', e.x - dx, e.z - dz, y, e.rot);
      f.put('darkwood_decowall', e.x + dx, e.z + dz, y, e.rot);
      f.put('wood_wall_half', e.x, e.z, y + 2, e.rot);
    } else {
      f.put('woodwall', e.x, e.z, y, e.rot);
      f.put('wood_wall_half', e.x, e.z, y + 2, e.rot);
    }
  }

  // Poteaux en rondins aux angles et tous les 4 m.
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
  const storeysAt = (vx, vz) => Math.max(...[[-1, -1], [-1, 0], [0, -1], [0, 0]].map(([a, b]) => cells.get(key(Math.floor(vx / 2) + a, Math.floor(vz / 2) + b)) || 0));
  for (const [k, dirs] of vertexDirs) {
    const [vx, vz] = k.split(',').map(Number);
    const corner = dirs.size >= 2;
    if (!corner && (vx % 4 !== 0 || vz % 4 !== 0)) continue;
    if (!corner && Math.abs(vx - doorX) < 2 && vz === mz1) continue;
    const storeys = storeysAt(vx, vz);
    for (let s = 0; s < storeys; s++) {
      f.put('wood_pole_log', vx, vz, F + STOREY * s + (s === 0 ? 1 : 0), 0);
      if (s > 0) f.put('wood_pole', vx, vz, F + STOREY * s + 2, 0);
    }
  }

  // Contrefiches sous la sablière, sur les façades avant et arrière (hors porte et ailes).
  for (let a = mx0 + 4; a <= mx1 - 4; a += 4) {
    if (Math.abs(a - doorX) >= 3.4) facadeBraces(f, a, mz1 + 0.45, F + 2.9);
    const behind = cells.get(key(a / 2 - 1, mz0 / 2 - 1)) || cells.get(key(a / 2, mz0 / 2 - 1));
    if (!behind) facadeBraces(f, a, mz0 - 0.45, F + 2.9);
  }

  // Charpente : fermes apparentes sous chaque toit (entrait, poinçon, arbalétriers), tous les 4 m.
  plan.rects.forEach(([x0, z0, x1, z1, storeys], idx) => {
    const eave = F + STOREY * storeys;
    if (idx === 0) for (let a = x0 + 4; a <= x1 - 4; a += 4) truss(f, a, (z0 + z1) / 2, z1 - z0, eave);
    else for (let b = z0 + 2; b <= Math.min(z1, mz0) - 2; b += 4) truss(f.sub((x0 + x1) / 2, b, 90), 0, 0, x1 - x0, eave);
  });

  // Planchers d'étage, escaliers, garde-corps autour des trémies.
  for (let s = 1; s < storeysMain; s++) {
    const y = F + STOREY * s;
    for (const [k, storeys] of cells) {
      if (storeys <= s) continue;
      const [i, j] = k.split(',').map(Number);
      const a = 2 * i + 1;
      const b = 2 * j + 1;
      if (hole(a, b)) continue;
      f.put('wood_floor', a, b, y, 0);
    }
    for (let t = 0; t < 3; t++) f.put('wood_stair', stairX0 + 1 + 2 * t, mz0 + 1.5, y - STOREY + t, 270);
    f.put('darkwood_pole', stairX0 + 6.2, mz0 + 2.8, y - 2, 0);
    // Solive sous le palier et garde-corps de la trémie.
    f.put('darkwood_beam', stairX0 + 7, mz0 + 4, y - 0.45, 90);
    railing(f, stairX0, stairX0 + 6, mz0 + 4, y);
    railing(f.sub(stairX0, 0, 90), -(mz0 + 4), -(mz0 + 2.6), 0, y);
  }

  // Toits : un par rectangle, faîte le long de son plus grand côté ; les ailes sans pignon côté bâtiment principal.
  plan.rects.forEach(([x0, z0, x1, z1, storeys], idx) => {
    const eave = F + STOREY * storeys;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    if (idx === 0) gableRoof(f.sub(cx, cz), { width: z1 - z0, length: x1 - x0, eave, dark, dragons: true, gables: 'both' });
    else gableRoof(f.sub(cx, cz, 90), { width: x1 - x0, length: z1 - z0, eave, dark, dragons: 'pos', gables: 'pos' });
  });

  // Entrée : seuil de planches vers la rue, montants, lanterne.
  f.put('wood_floor', doorX, mz1 + 1, F, 0);
  for (const s of [-1.2, 1.2]) f.put('wood_pole_log', doorX + s, mz1 + 0.25, F, 0);
  lampPost(f, doorX + 2.4, mz1 + (plan.extra.balcony ? 2.3 : 1.2), F, -1, 0);

  // Balcon d'étage (seul endroit à garde-corps de planches), porté par des poteaux.
  if (plan.extra.balcony) {
    planks(f, mx0, mz1, mx1, mz1 + 2, F + STOREY);
    for (let a = mx0 + 1.35; a < mx1 - 1; a += 2.7) f.put('wood_fence', a, mz1 + 1.95, F + STOREY + 0.1, 0);
    for (const a of [mx0 + 0.2, mx1 - 0.2]) {
      f.put('darkwood_pole', a, mz1 + 1.8, F, 0);
      f.put('wood_pole', a, mz1 + 1.8, F + 2, 0);
      f.put('wood_fence', a, mz1 + 1, F + STOREY + 0.1, 90);
    }
  }
  // Appentis ouvert sur le côté : bois de chauffage et outils.
  if (plan.extra.shed) {
    const sx = mx1;
    for (const b of [-3.8, 3.8]) f.put('darkwood_pole', sx + 3.8, b, F, 0);
    for (const b of [-3, -1, 1, 3]) f.put('wood_roof', sx + 2.5, b, F + 2, 90, { pivot: true });
    f.put('wood_stack', sx + 2, -2, F, 90);
    f.put('wood_fine_stack', sx + 2, 1.8, F, 0);
  }
  // Jardin clôturé.
  if (plan.extra.garden) {
    const g0 = mx1 + 0.5;
    const g1 = mx1 + plan.extra.garden;
    gardenFence(f, g0, g1, 3.8, F);
    gardenFence(f, g0, g1, -3.8, F);
    gardenFence(f.sub(g1, 0, 90), -3.8, 3.8, 0, F);
    f.put('piece_beehive', g1 - 1.2, -2.6, F, 180);
    f.put('piece_logbench01', g0 + 2, -3, F, 0);
    f.put('piece_pot2', g1 - 1, 2.6, F, 0);
  }

  // Mobilier : rez-de-chaussée du corps principal, ailes, étages.
  const inset = 0.55; // soubassement de pierre de 1 m d'épaisseur au rez-de-chaussée
  const ground = new Room(f, mx0 + inset, mz0 + inset, mx1 - inset, mz1 - inset, F, { random, door: [doorX, mz1 - inset] });
  if (storeysMain > 1) ground.block(stairX0 - 2.2, mz0, stairX0 + 6.4, mz0 + 3);
  const wings = plan.rects.slice(1).map(([x0, z0, x1]) => new Room(f, x0 + inset, z0 + inset, x1 - inset, mz0 - 0.2, F, { random }));
  const uppers = [];
  for (let s = 1; s < storeysMain; s++) {
    const up = new Room(f, mx0 + 0.25, mz0 + 0.25, mx1 - 0.25, mz1 - 0.25, F + STOREY * s, { random, surface: 0.1, door: plan.extra.balcony && s === 1 ? [doorX, mz1 - 0.25] : null });
    up.block(stairX0 - 2.2, mz0, stairX0 + 8.2, mz0 + 4.4);
    uppers.push(up);
  }
  furnish(theme, { ground, wings, uppers, hearth: plan.extra.hearth, big: mx1 - mx0 >= 16 });
  // Logement : un point au milieu du séjour, et autant de places que de lits probables.
  f.spot('home', (mx0 + mx1) / 2, (mz0 + mz1) / 2 + 0.5, F, { beds: 1 + uppers.length + wings.length, plan: plan.key });
  if (plan.extra.garden) f.spot('garden', mx1 + plan.extra.garden / 2, 0, F);
  // Éclairage : appliques dans chaque pièce.
  wallLight(f, (mx0 + mx1) / 2 + 3, mz0 + 0.5, F, 0, 1);
  wallLight(f, mx0 + 0.5, (mz0 + mz1) / 2, F, 1, 0);
  for (let s = 1; s < storeysMain; s++) wallLight(f, mx1 - 0.15, (mz0 + mz1) / 2, F + STOREY * s, -1, 0);
  for (const [x0, z0, x1] of plan.rects.slice(1)) wallLight(f, (x0 + x1) / 2, z0 + 0.5, F, 0, 1);
  return { door: f.at(doorX, mz1 + 2) };
}

// Maison ronde (octogonale) : soubassement de pierre, murs de bois entre poteaux en rondins, toit conique à huit pans,
// foyer central. Centre en (0, -1) du repère : la façade (porte) est à z = 4.
function roundHouse(L, x, z, rot, plan, random, theme) {
  const ap = plan.round.apothem;
  const f = L.frame(x, z, rot).sub(0, 4 - ap);
  const F = LEVEL;
  const Rv = ap / Math.cos(22.5 * DEG);
  const dark = random() < 0.5;
  const per = Math.round((2 * ap * Math.tan(22.5 * DEG)) / 2); // pans de mur de 2 m par face
  const alongs = Array.from({ length: per }, (_, i) => -(per - 1) + 2 * i);
  const doorX = per - 1; // porte : premier pan de la face +Z (le long de la tangente, x = -along)
  for (let k = 0; k < 8; k++) {
    const a = k * 45; // direction de la face (0 = +X, 90 = +Z : la porte)
    for (const t of alongs) {
      if (a === 90 && t === alongs[0]) {
        ringPut(f, 'wood_door', ap, a, F, { along: t });
        ringPut(f, 'wood_wall_half', ap, a, F + 2, { along: t });
        continue;
      }
      ringPut(f, 'stone_wall_2x1', ap, a, F, { along: t });
      if (a % 90 !== 0 && t === alongs[alongs.length - 1] && random() < 0.5) {
        ringPut(f, 'darkwood_decowall', ap, a, F + 1, { along: t - 0.5 });
        ringPut(f, 'darkwood_decowall', ap, a, F + 1, { along: t + 0.5 });
      } else ringPut(f, 'woodwall', ap, a, F + 1, { along: t });
    }
    const va = (a + 22.5) * DEG;
    f.put('wood_pole_log', Math.cos(va) * Rv, Math.sin(va) * Rv, F + 1, 0);
  }
  // Toit conique : rangs de tuiles sur chaque pan, de la rive (au droit des murs, à 3 m) vers le sommet.
  const tile = dark ? 'darkwood_roof_45' : 'wood_roof_45';
  for (let k = 0; k < 8; k++) {
    const g = f.sub(0, 0, 90 - k * 45); // +Z local vers l'extérieur du pan
    for (let row = 0; ap + 0.6 - 2 * row > 0.8; row++) {
      const d = ap + 0.6 - 2 * row;
      const n = Math.max(1, Math.round((2 * (d + 1) * Math.tan(22.5 * DEG)) / 2));
      for (let i = 0; i < n; i++) g.put(tile, -(n - 1) + i * 2, d, F + STOREY - 0.6 + 2 * row, 0, { pivot: true });
    }
  }
  f.put('wood_pole_log', 0, 0, F + STOREY + ap + 0.4, 0);
  // Charpente : deux entraits croisés et poinçon.
  for (const r of [0, 90]) {
    const g = f.sub(0, 0, r);
    for (const a of [-2, 2]) g.put('darkwood_beam4x4', a, 0, F + STOREY - 0.45, 0);
  }
  f.put('darkwood_pole4', 0, 0, F + STOREY, 0);
  // Seuil, lampadaire.
  f.put('wood_floor', doorX, ap + 1, F, 0);
  lampPost(f, doorX - 2.4, ap + 1.2, F, 1, 0);
  const inner = ap * 0.72;
  const room = new Room(f, -inner, -inner, inner, ap - 0.6, F, { random, surface: ap - inner - 0.15, door: [doorX, ap - 0.6] });
  furnish(theme, { ground: room, wings: [], uppers: [], hearth: true, round: true });
  f.spot('home', 0, 1.5, F, { beds: ap > 6 ? 2 : 1, plan: plan.key });
  wallLight(f, ap - 0.5, 0, F, -1, 0);
  wallLight(f, -ap + 0.5, 0, F, 1, 0);
  return { door: f.at(doorX, ap + 2) };
}
