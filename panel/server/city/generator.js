// Générateur de ville : produit, à partir du relevé du terrain et des dimensions réelles des pièces du jeu
// (pieces.json, exporté par le plugin), la liste exacte des pièces à poser et leur aperçu.
//
// Repère local : origine au centre de la ville, au niveau du sol nivelé ; x vers l'est, z vers le nord, y vers le haut.
// Rotations en degrés autour de Y, convention Unity : une rotation θ envoie l'axe X local sur (cos θ, -sin θ)
// et l'axe Z local sur (sin θ, cos θ). « Face à » une direction signifie que le +Z local de l'objet la regarde.

const DEG = Math.PI / 180;
export const SIZES = { ville: 80, cite: 100, capitale: 120 };

// Petit générateur pseudo-aléatoire reproductible (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXTS = {
  fr: {
    welcome: (c, e) => `Bienvenue à ${c}, cité de l'Empereur ${e} !`,
    gate: (c) => `${c}`,
    monument: (e) => `${e}, Empereur. Gloire éternelle !`,
    monument2: (c, e) => `${c} fut bâtie à la gloire de ${e}`,
    palace: (e) => `Palais impérial de ${e}`,
    throne: (e) => `Trône de l'Empereur ${e}`,
    forge: 'Forge impériale',
    workshop: 'Atelier des bâtisseurs',
    kitchen: 'Cuisines et brasserie',
    mage: 'Cercle des mages',
    foundry: 'Fonderie et moulins',
    market: (c) => `Marché de ${c}`,
    tavern: (e) => `Taverne de l'Empereur ${e}`,
    arena: 'Arène impériale — entrez dans le cercle',
    north: 'Nord : grand-place et palais',
    east: 'Est : artisans',
    west: 'Ouest : arène',
    beds: 'Lits libres : dormez ici pour renaître en ville',
  },
  en: {
    welcome: (c, e) => `Welcome to ${c}, city of Emperor ${e}!`,
    gate: (c) => `${c}`,
    monument: (e) => `${e}, Emperor. Eternal glory!`,
    monument2: (c, e) => `${c} was raised to the glory of ${e}`,
    palace: (e) => `Imperial palace of ${e}`,
    throne: (e) => `Throne of Emperor ${e}`,
    forge: 'Imperial forge',
    workshop: 'Builders’ workshop',
    kitchen: 'Kitchens and brewery',
    mage: 'Circle of mages',
    foundry: 'Foundry and mills',
    market: (c) => `${c} market`,
    tavern: (e) => `Emperor ${e}'s tavern`,
    arena: 'Imperial arena — step into the circle',
    north: 'North: main square and palace',
    east: 'East: craftsmen',
    west: 'West: arena',
    beds: 'Free beds: sleep here to respawn in town',
  },
};

// ---------- Géométrie ----------

const rotate = (x, z, rot) => {
  const c = Math.cos(rot * DEG);
  const s = Math.sin(rot * DEG);
  return [x * c + z * s, -x * s + z * c];
};

class Layout {
  constructor(geometry, options) {
    this.geo = geometry;
    this.pieces = [];
    this.missing = new Set();
    this.counts = {};
    this.district = 'misc';
    this.options = options;
  }

  box(name) {
    const g = this.geo[name];
    return g?.col || g?.vis || null;
  }

  // Pose une pièce. `bottom` : hauteur du bas de sa boîte de collision (le jeu cale ainsi les pièces sur le sol).
  // opts.pivot : position exacte du pivot (pièces suspendues, toits calés sur leurs points d'accroche).
  // opts.pivotXZ : pivot horizontal, bas de collision vertical (lanternes à potence…).
  put(name, x, z, bottom, rot = 0, opts = {}) {
    const g = this.geo[name];
    if (!g) {
      this.missing.add(name);
      return;
    }
    const b = this.box(name);
    let px = x;
    let pz = z;
    let py = bottom;
    // Créatures, marchands et statues ont leur pivot aux pieds.
    if (!opts.pivot && b && !g.clip && g.category) {
      py = bottom - b[1];
      if (!opts.pivotXZ) {
        const [ox, oz] = rotate((b[0] + b[3]) / 2, (b[2] + b[5]) / 2, rot);
        px = x - ox;
        pz = z - oz;
      }
    }
    const r = ((rot % 360) + 360) % 360;
    this.pieces.push({ name, x: px, y: py, z: pz, rot: r, text: opts.text, tamed: opts.tamed, district: this.district });
    this.counts[this.district] = (this.counts[this.district] || 0) + 1;
  }

  // Repère d'un module (bâtiment) : origine (ox, oz), orienté de `rot`.
  frame(ox, oz, rot) {
    return {
      put: (name, lx, lz, bottom, lrot = 0, opts) => {
        const [dx, dz] = rotate(lx, lz, rot);
        this.put(name, ox + dx, oz + dz, bottom, lrot + rot, opts);
      },
      at: (lx, lz) => {
        const [dx, dz] = rotate(lx, lz, rot);
        return [ox + dx, oz + dz];
      },
    };
  }
}

// ---------- Occupation du sol ----------

class Space {
  constructor(radius, terrain) {
    this.radius = radius;
    this.terrain = terrain;
    this.rects = []; // {cx, cz, hw, hd, rot}
    this.circles = []; // {x, z, r}
  }

  corners(r) {
    return [
      [-r.hw, -r.hd],
      [r.hw, -r.hd],
      [r.hw, r.hd],
      [-r.hw, r.hd],
    ].map(([a, b]) => {
      const [dx, dz] = rotate(a, b, r.rot);
      return [r.cx + dx, r.cz + dz];
    });
  }

  // Séparation des axes pour deux rectangles orientés.
  static overlap(a, b, space) {
    const axes = [];
    for (const r of [a, b]) {
      const c = Math.cos(r.rot * DEG);
      const s = Math.sin(r.rot * DEG);
      axes.push([c, -s], [s, c]);
    }
    const ca = space.corners(a);
    const cb = space.corners(b);
    for (const [ax, az] of axes) {
      const pa = ca.map(([x, z]) => x * ax + z * az);
      const pb = cb.map(([x, z]) => x * ax + z * az);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
    return true;
  }

  fits(rect, margin = 0) {
    const grown = { ...rect, hw: rect.hw + margin, hd: rect.hd + margin };
    for (const [x, z] of this.corners(rect)) if (Math.hypot(x, z) > this.radius) return false;
    for (const other of this.rects) if (Space.overlap(grown, other, this)) return false;
    for (const c of this.circles) {
      const [lx, lz] = rotate(c.x - rect.cx, c.z - rect.cz, -rect.rot);
      const nx = Math.max(-grown.hw, Math.min(grown.hw, lx));
      const nz = Math.max(-grown.hd, Math.min(grown.hd, lz));
      if (Math.hypot(lx - nx, lz - nz) < c.r) return false;
    }
    return this.terrain.flat(rect);
  }

  reserve(rect) {
    this.rects.push(rect);
  }

  reserveCircle(x, z, r) {
    this.circles.push({ x, z, r });
  }
}

// Le relevé donne les hauteurs naturelles (dm, relatives au sol visé) tous les 2 m. Le nivellement du jeu étant limité
// à ±8 m, un bâtiment n'est posé que là où le sol nivelé est réellement à la bonne hauteur.
class Terrain {
  constructor(survey) {
    this.grid = survey?.grid;
    this.center = survey?.center || [0, 0];
  }

  deviation(x, z) {
    const g = this.grid;
    if (!g) return 0;
    const i = Math.round((this.center[1] + z - g.origin[1]) / g.step);
    const j = Math.round((this.center[0] + x - g.origin[0]) / g.step);
    if (i < 0 || j < 0 || i >= g.size || j >= g.size) return 99;
    const h = g.heights[i * g.size + j] / 10;
    return Math.sign(h) * Math.max(0, Math.abs(h) - 8);
  }

  flat(rect) {
    for (let a = -rect.hw; a <= rect.hw + 0.01; a += 2)
      for (let b = -rect.hd; b <= rect.hd + 0.01; b += 2) {
        const [dx, dz] = rotate(a, b, rect.rot);
        if (Math.abs(this.deviation(rect.cx + dx, rect.cz + dz)) > 0.4) return false;
      }
    return true;
  }
}

// ---------- Modules ----------

// Tour carrée pleine de pierre (4×4), couronnée de merlons et d'un brasero.
function tower(L, x, z, rot, height) {
  const f = L.frame(x, z, rot);
  for (let h = 0; h < height; h++) f.put('stone_floor', 0, 0, h, 0);
  for (const [a, b] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5], [0, -1.5], [1.5, 0], [0, 1.5], [-1.5, 0]]) f.put('stone_wall_1x1', a, b, height, 0);
  f.put('piece_brazierfloor01', 0, 0, height, 0);
}

function rampart(L, space, R, gates) {
  L.district = 'rampart';
  const N = R < 70 ? 12 : R < 100 ? 16 : 20;
  const half = 180 / N;
  const side = Math.max(16, Math.round((2 * R * Math.sin(half * DEG)) / 8) * 8);
  const Rv = side / (2 * Math.sin(half * DEG));
  const apothem = Rv * Math.cos(half * DEG);
  const vertices = [];
  for (let k = 0; k < N; k++) {
    const a = (half + k * 2 * half) * DEG;
    vertices.push([Math.cos(a) * Rv, Math.sin(a) * Rv]);
  }
  const gateInfo = [];
  for (let k = 0; k < N; k++) {
    const [x1, z1] = vertices[k];
    const [x2, z2] = vertices[(k + 1) % N];
    const ux = (x2 - x1) / side;
    const uz = (z2 - z1) / side;
    const rot = -Math.atan2(uz, ux) / DEG;
    const mid = Math.round(((k + 1) * 2 * half) % 360);
    const gate = gates.includes(mid);
    const f = L.frame((x1 + x2) / 2, (z1 + z2) / 2, rot);
    for (let t = -side / 2 + 2; t < side / 2; t += 4) {
      if (gate && Math.abs(t) < 4) continue;
      for (let row = 0; row < 3; row++) f.put('stone_wall_4x2', t, 0, row * 2, 0);
      f.put('stone_wall_1x1', t - 1.5, 0, 6, 0);
      f.put('stone_wall_1x1', t + 0.5, 0, 6, 0);
    }
    if (gate) {
      // Porte monumentale : deux tours de 10 m, linteau crénelé, arcades, tentures des deux côtés.
      const [tx1, tz1] = f.at(-6, 0);
      const [tx2, tz2] = f.at(6, 0);
      tower(L, tx1, tz1, rot, 10);
      tower(L, tx2, tz2, rot, 10);
      for (const t of [-2, 2]) {
        f.put('stone_wall_4x2', t, 0, 5, 0);
        f.put('stone_wall_1x1', t - 1.5, 0, 7, 0);
        f.put('stone_wall_1x1', t + 0.5, 0, 7, 0);
      }
      for (const t of [-3, -1, 1, 3]) f.put('stone_arch', t, 0, 4, 0);
      for (const t of [-2.5, 2.5]) {
        f.put('piece_banner02', t, 0.62, 6.8, 90, { pivot: true });
        f.put('piece_banner02', t, -0.62, 6.8, 90, { pivot: true });
      }
      const inward = [-Math.cos(mid * DEG), -Math.sin(mid * DEG)];
      gateInfo.push({ angle: mid, x: Math.cos(mid * DEG) * apothem, z: Math.sin(mid * DEG) * apothem, inward, rot });
    }
  }
  for (const [x, z] of vertices) tower(L, x, z, -Math.atan2(z, x) / DEG, 8);
  return { apothem, Rv, gates: gateInfo, vertices };
}

// Pavillon à charpente (poteaux, poutres, toit à deux pentes), mur plein à l'arrière pour les extensions murales.
// Largeur 8 (z local de -4 à 4), longueur L (multiple de 4, x local), façade ouverte vers +Z.
function hall(L, x, z, rot, length, { back = true, roof = 'darkwood_roof_45', ridge = 'darkwood_roof_top_45', sign } = {}) {
  const f = L.frame(x, z, rot);
  const H = 4;
  for (let a = -length / 2; a <= length / 2 + 0.01; a += 4)
    for (const b of [-3.8, 3.8]) f.put('darkwood_pole4', a, b, 0, 0);
  for (let a = -length / 2 + 2; a < length / 2; a += 4)
    for (const b of [-3.8, 3.8]) f.put('darkwood_beam4x4', a, b, H - 0.45, 0);
  for (const a of [-length / 2, length / 2])
    for (const b of [-2, 2]) f.put('darkwood_beam4x4', a, b, H - 0.45, 90);
  if (back) for (let a = -length / 2 + 1; a < length / 2; a += 2) for (const row of [1, 3]) f.put('woodwall', a, -3.6, row - 1, 0);
  for (let a = -length / 2 + 1; a < length / 2; a += 2) {
    f.put(roof, a, 4, H, 0, { pivot: true });
    f.put(roof, a, 2, H + 2, 0, { pivot: true });
    f.put(roof, a, -4, H, 180, { pivot: true });
    f.put(roof, a, -2, H + 2, 180, { pivot: true });
    f.put(ridge, a, 0, H + 3, 0, { pivot: true });
  }
  if (sign) {
    f.put('darkwood_pole4', length / 2 + 1.5, 5.5, 0, 0);
    f.put('sign', length / 2 + 1.5, 5.74, 2.2, 0, { pivot: true, text: sign });
  }
  return f;
}

function hallRect(x, z, rot, length) {
  return { cx: x, cz: z, hw: length / 2 + 2.5, hd: 6, rot };
}

// Maison à colombages : murs de 4 m, toit à deux pentes à 45°, porte en façade (+Z), lit, table, chaise et tapis.
function house(L, x, z, rot, { width, length, stone, dark, bed, tall = false, furnish = true }) {
  const f = L.frame(x, z, rot);
  const H = tall ? 6 : 4;
  const w2 = width / 2;
  const l2 = length / 2;
  const segments = [];
  for (let a = -l2 + 1; a < l2; a += 2) segments.push(a);
  const door = segments[Math.floor(segments.length / 2)];
  // Un mur de 4 m (6 m pour une maison haute) : soubassement de pierre (2 rangs de 1 m) ou colombages, étage en bois ; la porte laisse le bas ouvert.
  const wall = (a, b, wallRot, isDoor) => {
    if (!isDoor) {
      if (stone) {
        f.put('stone_wall_2x1', a, b, 0, wallRot);
        f.put('stone_wall_2x1', a, b, 1, wallRot);
      } else f.put('woodwall', a, b, 0, wallRot);
    }
    f.put('woodwall', a, b, 2, wallRot);
    if (tall) f.put('woodwall', a, b, 4, wallRot);
  };
  for (const a of segments) {
    wall(a, w2, 0, a === door);
    wall(a, -w2, 0, false);
  }
  for (const a of [-l2, l2]) for (let b = -w2 + 1; b < w2; b += 2) wall(a, b, 90, false);
  const roof = dark ? 'darkwood_roof_45' : 'wood_roof_45';
  const ridge = dark ? 'darkwood_roof_top_45' : 'wood_roof_top_45';
  for (let a = -l2 + 1; a < l2; a += 2) {
    if (width === 4) {
      f.put(roof, a, 2, H, 0, { pivot: true });
      f.put(roof, a, -2, H, 180, { pivot: true });
      f.put(ridge, a, 0, H + 1, 0, { pivot: true });
    } else {
      f.put(roof, a, 4, H, 0, { pivot: true });
      f.put(roof, a, 2, H + 2, 0, { pivot: true });
      f.put(roof, a, -4, H, 180, { pivot: true });
      f.put(roof, a, -2, H + 2, 180, { pivot: true });
      f.put(ridge, a, 0, H + 3, 0, { pivot: true });
    }
  }
  for (const a of [-l2, l2]) {
    if (width === 4) {
      f.put('wood_wall_roof_45', a, -1, H, 270, { pivot: true });
      f.put('wood_wall_roof_45', a, 1, H, 90, { pivot: true });
    } else {
      f.put('wood_wall_roof_45', a, -3, H, 270, { pivot: true });
      f.put('wood_wall_roof_45', a, 3, H, 90, { pivot: true });
      f.put('woodwall', a, -1, H, 90);
      f.put('woodwall', a, 1, H, 90);
      f.put('wood_wall_roof_45', a, -1, H + 2, 270, { pivot: true });
      f.put('wood_wall_roof_45', a, 1, H + 2, 90, { pivot: true });
    }
  }
  f.put('wood_door', door, w2, 0, 0);
  if (!furnish) return;
  // Intérieur (sans feu : la fumée s'accumule sous un toit fermé et blesse les joueurs)
  f.put('rug_wolf', 0, 0, 0, 90);
  if (bed && length >= 6) f.put('piece_bed02', -l2 + 1.6, -w2 + 2, 0, 90);
  if (length >= 8) {
    f.put('piece_table', l2 - 2, -w2 + 1.2, 0, 0);
    f.put('piece_chair', l2 - 2, -w2 + 2.3, 0, 180);
  }
}

// ---------- Ville ----------

export function generateCity({ geometry, survey, options }) {
  const o = {
    name: 'Spokaheim',
    emperor: 'Spoka',
    size: 'cite',
    seed: 1,
    language: 'fr',
    arena: true,
    houses: true,
    guards: true,
    ...options,
  };
  const R = SIZES[o.size] || Number(o.radius) || 100;
  const T = TEXTS[o.language === 'en' ? 'en' : 'fr'];
  const random = rng(o.seed);
  const L = new Layout(geometry, o);
  const terrain = new Terrain(survey);
  const inner = R - 14; // tout bâtiment reste à l'intérieur du chemin de ronde
  const space = new Space(inner, terrain);
  const paint = []; // [kind, type, a, b, c, d, e] en coordonnées locales, converties à la fin
  const PAVED = 0;
  const DIRT = 1;
  const info = { radius: R, districts: [] };

  // Grand-place, avenues et palais : les proportions suivent la taille de la ville.
  const P = Math.round(Math.min(24, Math.max(14, R * 0.2)));
  const palaceD = Math.round(Math.min(32, Math.max(20, R * 0.3)) / 4) * 4;
  const palaceW = palaceD + 4;
  const palaceZ = P + 8;

  const walls = rampart(L, space, R, [0, 180, 270]);
  info.apothem = Math.round(walls.apothem);

  // Chemin de ronde pavé le long des remparts.
  for (let k = 0; k < walls.vertices.length; k++) {
    const [x1, z1] = walls.vertices[k];
    const [x2, z2] = walls.vertices[(k + 1) % walls.vertices.length];
    const s = (walls.apothem - 9) / walls.apothem;
    paint.push([PAVED, 2, x1 * s, z1 * s, x2 * s, z2 * s, 6]);
  }

  // Avenues (sud, est, ouest vers les portes ; nord vers le palais) bordées de lanternes.
  L.district = 'streets';
  const avenues = [
    { from: [0, -walls.apothem], to: [0, -P], axis: 'z' },
    { from: [walls.apothem, 0], to: [P, 0], axis: 'x' },
    { from: [-walls.apothem, 0], to: [-P, 0], axis: 'x' },
    { from: [0, P], to: [0, palaceZ - 6], axis: 'z' },
  ];
  for (const av of avenues) {
    paint.push([PAVED, 2, av.from[0], av.from[1], av.to[0], av.to[1], 9]);
    const len = Math.hypot(av.to[0] - av.from[0], av.to[1] - av.from[1]);
    const cx = (av.from[0] + av.to[0]) / 2;
    const cz = (av.from[1] + av.to[1]) / 2;
    space.reserve({ cx, cz, hw: av.axis === 'x' ? len / 2 : 5, hd: av.axis === 'x' ? 5 : len / 2, rot: 0 });
    for (let d = 8; d < len - 4; d += 12) {
      const t = d / len;
      const x = av.from[0] + (av.to[0] - av.from[0]) * t;
      const z = av.from[1] + (av.to[1] - av.from[1]) * t;
      for (const side of [1, -1]) {
        if (av.axis === 'z') L.put('piece_dvergr_lantern_pole', x + side * 5.6, z, 0, side > 0 ? 0 : 180, { pivotXZ: true });
        else L.put('piece_dvergr_lantern_pole', x, z + side * 5.6, 0, side > 0 ? 270 : 90, { pivotXZ: true });
      }
    }
  }

  // Grand-place et monument à l'Empereur : socle de marbre noir, colonne de 8 m, flamme éternelle, têtes colossales.
  L.district = 'plaza';
  paint.push([PAVED, 0, 0, 0, P, 0, 0]);
  space.reserveCircle(0, 0, P + 3);
  for (let a = -5; a <= 5; a += 2) for (let b = -5; b <= 5; b += 2) if (Math.abs(a) === 5 || Math.abs(b) === 5) L.put('blackmarble_floor', a, b, 0, 0);
  L.put('blackmarble_floor_large', 0, 0, 1, 0);
  L.put('blackmarble_floor_large', 0, 0, -1, 0);
  L.put('blackmarble_column_3', 0, 0, 3, 0);
  L.put('piece_EternalPyre', 0, 0, 11, 0);
  for (const [a, b, r] of [[-3, -3, 225], [3, -3, 135], [3, 3, 45], [-3, 3, 315]]) L.put('blackmarble_head_big01', a, b, 3, r);
  for (const [a, b, r] of [[0, -6.05, 180], [6.05, 0, 90], [0, 6.05, 0], [-6.05, 0, 270]])
    L.put('sign', a, b, 0.5, r, { pivot: true, text: r % 180 === 0 ? T.monument(o.emperor) : T.monument2(o.name, o.emperor) });
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
    L.put('piece_brazierfloor01', Math.cos(ang) * 9, Math.sin(ang) * 9, 0, 0);
  }

  // Palais impérial : plateforme, murs de pierre sombre de 8 m, colonnade, salle du trône, tourelles d'angle.
  L.district = 'palace';
  {
    const W = palaceW;
    const D = palaceD;
    const z0 = palaceZ;
    const zc = z0 + D / 2;
    space.reserve({ cx: 0, cz: zc, hw: W / 2 + 5, hd: D / 2 + 8, rot: 0 });
    paint.push([PAVED, 1, 0, z0 - 3, W / 2 + 3, 3, 0]);
    for (let a = -W / 2 + 2; a < W / 2; a += 4) for (let b = z0 - 4 + 2; b < z0 + D; b += 4) L.put('stone_floor', a, b, 0, 0);
    for (let a = -3; a <= 3; a += 2) L.put('stone_stair', a, z0 - 5, 0, 180);
    // Murs : façade (porte de 4 m au centre), côtés, fond ; quatre rangées de 2 m.
    const wallPiece = 'Piece_grausten_wall_4x2';
    for (let a = -W / 2 + 2; a < W / 2; a += 4)
      for (let row = 0; row < 4; row++) {
        if (!(Math.abs(a) < 3 && row < 2)) L.put(wallPiece, a, z0, 1 + row * 2, 0);
        L.put(wallPiece, a, z0 + D, 1 + row * 2, 0);
      }
    for (let b = z0 + 2; b < z0 + D; b += 4) for (let row = 0; row < 4; row++) for (const a of [-W / 2, W / 2]) L.put(wallPiece, a, b, 1 + row * 2, 90);
    // Toit plat de dalles, créneaux.
    for (let a = -W / 2 + 2; a < W / 2; a += 4) for (let b = z0 + 2; b < z0 + D; b += 4) L.put('stone_floor', a, b, 9, 0);
    for (let a = -W / 2 + 2.5; a < W / 2 - 2; a += 2) {
      L.put('stone_wall_1x1', a, z0 + 0.5, 10, 0);
      L.put('stone_wall_1x1', a, z0 + D - 0.5, 10, 0);
    }
    for (let b = z0 + 2.5; b < z0 + D - 2; b += 2) {
      L.put('stone_wall_1x1', -W / 2 + 0.5, b, 10, 0);
      L.put('stone_wall_1x1', W / 2 - 0.5, b, 10, 0);
    }
    // Colonnade et auvent devant la façade.
    for (const a of [-9, -5, 5, 9]) L.put('blackmarble_column_3', a, z0 - 3, 1, 0);
    for (let a = -10; a <= 10; a += 4) L.put('stone_floor', a, z0 - 2, 9, 0);
    for (const a of [-2.2, 2.2]) L.put('piece_banner02', a, z0 - 0.35, 8.8, 90, { pivot: true });
    L.put('sign', 0, z0 - 0.3, 6, 180, { pivot: true, text: T.palace(o.emperor) });
    // Tourelles d'angle.
    for (const [a, b] of [[-W / 2, z0], [W / 2, z0], [-W / 2, z0 + D], [W / 2, z0 + D]]) tower(L, a, b, 0, 12);
    // Salle du trône.
    for (let b = z0 + 3; b < z0 + D - 4; b += 3) L.put('jute_carpet_blue', 0, b, 1, 0);
    for (let a = -3; a <= 3; a += 2) L.put('blackmarble_floor', a, z0 + D - 3, 1, 0);
    L.put('piece_blackmarble_throne', 0, z0 + D - 3, 2, 180);
    L.put('sign', 0, z0 + D - 4.05, 1.5, 180, { pivot: true, text: T.throne(o.emperor) });
    // Éclairage sans flamme (salle fermée) : lanternes naines tournées vers l'allée centrale.
    for (const b of [z0 + 4, z0 + D - 6]) {
      L.put('piece_dvergr_lantern_pole', -3.5, b, 1, 180, { pivotXZ: true });
      L.put('piece_dvergr_lantern_pole', 3.5, b, 1, 0, { pivotXZ: true });
    }
    for (const a of [-6, 6]) for (let b = z0 + 5; b < z0 + D - 3; b += 6) L.put('blackmarble_column_3', a, b, 1, 0);
    for (const a of [-4, 4]) L.put('piece_banner07', a, z0 + D - 0.35, 8.5, 90, { pivot: true });
    info.districts.push('palace');
  }

  // Arène impériale (bâtie par le plugin) dans le quartier sud-ouest, porte tournée vers la grand-place.
  let arena = null;
  if (o.arena) {
    const minD = P + 26;
    const maxD = walls.apothem - 12 - 25;
    if (maxD >= minD) {
      const d = Math.min(maxD, Math.max(minD, P + 30));
      const ax = -d * Math.SQRT1_2;
      const az = -d * Math.SQRT1_2;
      const circle = { x: ax, z: az, r: 25 };
      if (terrain.flat({ cx: ax, cz: az, hw: 22, hd: 22, rot: 0 })) {
        arena = { x: ax, z: az, entrance: -45 };
        space.reserveCircle(circle.x, circle.z, circle.r);
        L.district = 'arena';
        const [gx, gz] = [ax + Math.SQRT1_2 * 29, az + Math.SQRT1_2 * 29];
        paint.push([PAVED, 2, gx, gz, -P * Math.SQRT1_2, -P * Math.SQRT1_2, 7]);
        L.put('piece_brazierfloor01', gx - 3, gz + 3, 0, 0);
        L.put('piece_brazierfloor01', gx + 3, gz - 3, 0, 0);
        L.put('darkwood_pole4', gx + 2.5, gz + 2.5, 0, 0);
        L.put('sign', gx + 2.2, gz + 2.2, 2.4, 45, { pivot: true, text: T.arena });
        info.districts.push('arena');
      }
    }
  }

  // Place d'accueil derrière la porte sud : point d'apparition, panneaux.
  L.district = 'welcome';
  const spawnZ = -walls.apothem + 20;
  paint.push([PAVED, 0, 0, spawnZ, 9, 0, 0]);
  space.reserveCircle(0, spawnZ, 10);
  L.put('darkwood_pole4', 3.5, spawnZ + 3.5, 0, 0);
  L.put('sign', 3.5, spawnZ + 3.26, 2.6, 180, { pivot: true, text: T.welcome(o.name, o.emperor) });
  L.put('sign', 3.5, spawnZ + 3.26, 1.8, 180, { pivot: true, text: T.north });
  L.put('sign', 3.74, spawnZ + 3.5, 2.2, 90, { pivot: true, text: T.east });
  L.put('sign', 3.26, spawnZ + 3.5, 2.2, 270, { pivot: true, text: arena ? T.west : T.gate(o.name) });
  for (const [a, b] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) L.put('piece_groundtorch', a, spawnZ + b, 0, 0);
  const spawn = [0, 0.2, spawnZ];

  // Placement des quartiers : chaque module cherche la place libre la plus proche de son point d'ancrage.
  const place = (rect, anchor, rotations, margin = 2) => {
    const tries = [];
    for (let x = -inner; x <= inner; x += 2) for (let z = -inner; z <= inner; z += 2) tries.push([x, z, Math.hypot(x - anchor[0], z - anchor[1])]);
    tries.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of tries)
      for (const rot of rotations) {
        const r = { ...rect(x, z, rot), cx: x, cz: z, rot };
        if (space.fits(r, margin)) {
          space.reserve(r);
          return r;
        }
      }
    return null;
  };
  // Façade (+Z local) tournée vers le centre de la ville.
  const facing = (x, z) => {
    const ang = Math.atan2(-x, -z) / DEG;
    return Math.round(ang / 90) * 90;
  };
  const face = (anchor) => [facing(anchor[0], anchor[1])];

  const Q = Math.max(P + 18, inner * 0.55);

  // Marché : étals de Haldor et de Hildir, feu de la sorcière des marais, barbier, table de cartographie.
  {
    const anchor = [Q * 0.6, -Q * 0.8];
    const r = place((x, z, rot) => ({ hw: 13, hd: 13 }), anchor, [0]);
    if (r) {
      L.district = 'market';
      const f = L.frame(r.cx, r.cz, 0);
      paint.push([PAVED, 1, r.cx, r.cz, 12, 12, 0]);
      const stall = (lx, lz, rot, npc, deco) => {
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
        if (deco) s.put(deco, -1.4, -1.3, 0, 0);
        s.put('piece_banner07', 1.9, 2.05, 3.8, 0, { pivot: true });
      };
      stall(-7, 7, 180, 'Haldor', 'piece_groundtorch');
      stall(7, 7, 180, 'Hildir', 'piece_groundtorch');
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
  // Fonderie en plein air : fonderie, four à charbon, haut fourneau, raffinerie d'eitr, moulin, rouet, fours du Nord, oblitérateur, ruches.
  {
    const anchor = [Q * 0.9, -Q * 0.35];
    const r = place((x, z, rot) => ({ hw: 15, hd: 9 }), anchor, [0, 90]);
    if (r) {
      L.district = 'foundry';
      const f = L.frame(r.cx, r.cz, r.rot);
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot]);
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
      f.put('darkwood_pole4', 0, 8.6, 0, 0);
      f.put('sign', 0, 8.84, 2.2, 0, { pivot: true, text: T.foundry });
      info.districts.push('foundry');
    }
  }
  // Forge : forge et ses six améliorations, forge noire et ses cinq améliorations.
  {
    const anchor = [Q * 0.8, Q * 0.45];
    const r = place((x, z, rot) => hallRect(x, z, rot, 16), anchor, face(anchor));
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
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot]);
      info.districts.push('forge');
    }
  }
  // Atelier : établi et ses quatre améliorations, tailleur de pierre, table d'artisan.
  {
    const anchor = [Q * 0.45, Q * 0.8];
    const r = place((x, z, rot) => hallRect(x, z, rot, 16), anchor, face(anchor));
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
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot]);
      info.districts.push('workshop');
    }
  }
  // Cuisines : chaudron et ses améliorations, chaudron à hydromel, table de préparation, four, broches, fermenteurs.
  {
    const anchor = [-Q * 0.45, Q * 0.8];
    const r = place((x, z, rot) => hallRect(x, z, rot, 20), anchor, face(anchor));
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
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot]);
      info.districts.push('kitchen');
    }
  }
  // Cercle des mages : table de galdr et ses quatre améliorations.
  {
    const anchor = [-Q * 0.8, Q * 0.45];
    const r = place((x, z, rot) => hallRect(x, z, rot, 8), anchor, face(anchor));
    if (r) {
      L.district = 'crafts';
      const f = hall(L, r.cx, r.cz, r.rot, 8, { sign: T.mage, roof: 'wood_roof_45', ridge: 'wood_roof_top_45' });
      f.put('piece_magetable', -0.5, -1.2, 0, 0);
      f.put('piece_magetable_ext', 2.6, 0.8, 0, 0);
      f.put('piece_magetable_ext2', -2.8, 1.4, 0, 0);
      f.put('piece_magetable_ext3', 2.2, -3.35, 1.4, 0);
      f.put('piece_magetable_ext4', 0.5, 2, 0, 180);
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot]);
      info.districts.push('mage');
    }
  }
  // Taverne : grande salle, table de chêne, bancs, âtre central, lits pour les voyageurs.
  {
    const anchor = [-Q * 0.3, -Q * 0.85];
    const r = place((x, z, rot) => ({ hw: 9, hd: 6 }), anchor, face(anchor));
    if (r) {
      L.district = 'tavern';
      const f = L.frame(r.cx, r.cz, r.rot);
      house(L, r.cx, r.cz, r.rot, { width: 8, length: 14, stone: true, dark: true, furnish: false });
      f.put('jute_carpet', 2.5, 0, 0, 0);
      f.put('piece_table_oak', 2.5, 0, 0, 0);
      for (const b of [-1.5, 1.5]) for (const a of [0.5, 4.5]) f.put('piece_bench01', a, b, 0, b > 0 ? 0 : 180);
      for (const b of [-2.6, 2.6]) f.put('piece_bed02', -5, b, 0, 90);
      f.put('piece_throne01', 6.3, 0, 0, 270);
      f.put('darkwood_pole4', 3, 5.6, 0, 0);
      f.put('sign', 3, 5.84, 2.4, 0, { pivot: true, text: T.tavern(o.emperor) });
      f.put('sign', 3, 5.84, 1.6, 0, { pivot: true, text: T.beds });
      paint.push([DIRT, 1, r.cx, r.cz, r.hw, r.hd, r.rot]);
      info.districts.push('tavern');
    }
  }

  // Placettes à puits au cœur de chaque quartier : elles structurent les maisons autour d'elles.
  L.district = 'squares';
  for (const ang of [45, 135, 225, 315]) {
    for (const d of [Q * 0.9, Q * 0.6, Q * 1.15]) {
      const x = Math.cos(ang * DEG) * d;
      const z = Math.sin(ang * DEG) * d;
      const rect = { cx: x, cz: z, hw: 5, hd: 5, rot: 0 };
      if (!space.fits(rect, 1)) continue;
      space.reserve(rect);
      paint.push([PAVED, 0, x, z, 5.5, 0, 0]);
      const f = L.frame(x, z, 0);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) f.put('stone_wall_1x1', a, b, 0, 0);
      for (const [a, b] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) f.put('darkwood_pole4', a, b, 0, 0);
      for (const a of [-1, 1]) {
        f.put('wood_roof_45', a, 2, 4, 0, { pivot: true });
        f.put('wood_roof_45', a, -2, 4, 180, { pivot: true });
        f.put('wood_roof_top_45', a, 0, 5, 0, { pivot: true });
      }
      f.put('piece_dvergr_lantern_pole', 4, 4, 0, 225, { pivotXZ: true });
      f.put('piece_logbench01', -3.8, 0, 0, 90);
      break;
    }
  }

  // Maisons : tout l'espace restant, des plus proches du centre aux plus éloignées.
  let houses = 0;
  const maxHouses = { ville: 50, cite: 90, capitale: 130 }[o.size] || 90;
  if (o.houses) {
    L.district = 'houses';
    const slots = [];
    for (let x = -inner; x <= inner; x += 2) for (let z = -inner; z <= inner; z += 2) slots.push([x, z, Math.hypot(x, z) + random() * 6]);
    slots.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of slots) {
      if (houses >= maxHouses) break;
      const width = random() < 0.35 ? 8 : 4;
      const length = width === 8 ? 8 + 2 * Math.floor(random() * 2) * 2 : 6 + 2 * Math.floor(random() * 2);
      const rot = facing(x, z);
      const rect = { cx: x, cz: z, hw: length / 2 + 0.5, hd: width / 2 + 1.2, rot };
      if (!space.fits(rect, 1.1)) continue;
      space.reserve(rect);
      house(L, x, z, rot, { width, length, stone: random() < 0.4, dark: random() < 0.5, bed: random() < 0.5, tall: random() < 0.25 });
      paint.push([DIRT, 1, x, z, rect.hw, rect.hd, rot]);
      houses++;
    }
    info.districts.push('houses');
  }
  info.houses = houses;

  // Gardes nains autour de la grand-place et devant le palais.
  if (o.guards) {
    L.district = 'guards';
    for (const [a, b] of [[P + 2, 3], [-P - 2, 3], [3, -P - 2], [-4, palaceZ - 6], [4, palaceZ - 6]]) L.put('Dverger', a, b, 0, 0);
  }

  // ---------- Sortie : coordonnées monde ----------
  const [cx, cz] = survey?.center || [0, 0];
  const floorY = survey?.floorY ?? 0;
  const pieces = L.pieces.map((p) => {
    const row = [p.name, round(cx + p.x), round(floorY + p.y), round(cz + p.z), round(p.rot)];
    if (p.text || p.tamed) row.push(p.text ?? null);
    if (p.tamed) row.push(1);
    return row;
  });
  const worldPaint = paint.map(([kind, type, a, b, c, d, e]) => {
    if (type === 0) return [kind, type, round(cx + a), round(cz + b), c, 0, 0];
    if (type === 1) return [kind, type, round(cx + a), round(cz + b), c, d, e];
    return [kind, type, round(cx + a), round(cz + b), round(cx + c), round(cz + d), e];
  });

  const plan = {
    version: 1,
    name: o.name,
    emperor: o.emperor,
    welcome: T.welcome(o.name, o.emperor),
    seed: o.seed,
    size: o.size,
    center: [round(cx), round(cz)],
    floorY,
    radius: R,
    terrain: { radius: Math.ceil(walls.Rv + 6), blend: 12, paint: worldPaint },
    spawn: [round(cx + spawn[0]), round(floorY + spawn[1]), round(cz + spawn[2])],
    arena: arena ? [round(cx + arena.x), round(cz + arena.z), arena.entrance] : null,
    pieces,
  };

  info.reserved = { rects: space.rects.map((r) => [r.cx, r.cz, r.hw, r.hd, r.rot].map(round)), circles: space.circles.map((c) => [c.x, c.z, c.r].map(round)) };
  return { plan, preview: preview(L, geometry, arena), info: { ...info, pieces: pieces.length, byDistrict: L.counts, missing: [...L.missing], arena: !!arena } };
}

const round = (v) => Math.round(v * 1000) / 1000;

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
    boxes.push([
      round(p.x + ox),
      round(p.y + (b[1] + b[4]) / 2),
      round(p.z + oz),
      round(b[3] - b[0]),
      round(b[4] - b[1]),
      round(b[5] - b[2]),
      p.rot,
      color,
    ]);
  }
  return { boxes, arena: arena ? { x: arena.x, z: arena.z, radius: 22 } : null };
}
