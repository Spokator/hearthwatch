// Outils de placement du générateur de ville.
//
// Repère local : origine au centre de la ville, au niveau du sol nivelé ; x vers l'est, z vers le nord, y vers le haut.
// Rotations en degrés autour de Y, convention Unity : une rotation θ envoie l'axe X local sur (cos θ, -sin θ)
// et l'axe Z local sur (sin θ, cos θ). « Face à » une direction signifie que le +Z local de l'objet la regarde.

export const DEG = Math.PI / 180;

export const rotate = (x, z, rot) => {
  const c = Math.cos(rot * DEG);
  const s = Math.sin(rot * DEG);
  return [x * c + z * s, -x * s + z * c];
};

export const round = (v) => Math.round(v * 1000) / 1000;

// Petit générateur pseudo-aléatoire reproductible (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Distance d'un point à un segment.
export function segmentDistance(px, pz, x1, z1, x2, z2) {
  const vx = x2 - x1;
  const vz = z2 - z1;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * vx + (pz - z1) * vz) / len2)) : 0;
  return Math.hypot(x1 + vx * t - px, z1 + vz * t - pz);
}

export class Layout {
  constructor(geometry) {
    this.geo = geometry;
    this.pieces = [];
    this.missing = new Set();
    this.counts = {};
    this.district = 'misc';
  }

  // Pose une pièce ; renvoie son index dans le plan.
  // `bottom` : hauteur du bas de sa boîte de collision (le jeu cale ainsi les pièces sur ce qui est dessous).
  // opts.pivot : position exacte du pivot (pièces suspendues, toits calés sur leurs points d'accroche).
  // opts.pivotXZ : pivot horizontal, bas de collision vertical (lanternes à potence…).
  // Créatures, marchands et statues ont leur pivot aux pieds ; les objets plantés (torches, tapis) aussi.
  put(name, x, z, bottom, rot = 0, opts = {}) {
    const g = this.geo[name];
    if (!g) {
      this.missing.add(name);
      return -1;
    }
    const b = g.col || g.vis;
    const building = /^Building/.test(g.category || '');
    const pivot = opts.pivot || !b || !g.category || (g.clip && !building);
    let px = x;
    let pz = z;
    let py = bottom;
    if (!pivot) {
      py = bottom - b[1];
      if (!opts.pivotXZ) {
        const [ox, oz] = rotate((b[0] + b[3]) / 2, (b[2] + b[5]) / 2, rot);
        px = x - ox;
        pz = z - oz;
      }
    }
    const r = ((rot % 360) + 360) % 360;
    this.pieces.push({ name, x: px, y: py, z: pz, rot: r, text: opts.text, data: opts.data, district: this.district });
    this.counts[this.district] = (this.counts[this.district] || 0) + 1;
    return this.pieces.length - 1;
  }

  // Repère d'un module : origine (ox, oz), orienté de `rot`.
  frame(ox, oz, rot) {
    return {
      rot,
      put: (name, lx, lz, bottom, lrot = 0, opts) => {
        const [dx, dz] = rotate(lx, lz, rot);
        return this.put(name, ox + dx, oz + dz, bottom, lrot + rot, opts);
      },
      at: (lx, lz) => {
        const [dx, dz] = rotate(lx, lz, rot);
        return [ox + dx, oz + dz];
      },
    };
  }
}

// Occupation du sol : rectangles orientés et cercles réservés, rayon utile de la ville.
export class Space {
  constructor(radius, terrain) {
    this.radius = radius;
    this.terrain = terrain;
    this.rects = [];
    this.circles = [];
  }

  static corners(r) {
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
  static overlap(a, b) {
    const axes = [];
    for (const r of [a, b]) {
      const c = Math.cos(r.rot * DEG);
      const s = Math.sin(r.rot * DEG);
      axes.push([c, -s], [s, c]);
    }
    const ca = Space.corners(a);
    const cb = Space.corners(b);
    for (const [ax, az] of axes) {
      const pa = ca.map(([x, z]) => x * ax + z * az);
      const pb = cb.map(([x, z]) => x * ax + z * az);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
    return true;
  }

  fits(rect, margin = 0, { terrain = true, radius = this.radius } = {}) {
    const grown = { ...rect, hw: rect.hw + margin, hd: rect.hd + margin };
    for (const [x, z] of Space.corners(rect)) if (Math.hypot(x, z) > radius) return false;
    for (const other of this.rects) if (Space.overlap(grown, other)) return false;
    for (const c of this.circles) {
      const [lx, lz] = rotate(c.x - rect.cx, c.z - rect.cz, -rect.rot);
      const nx = Math.max(-grown.hw, Math.min(grown.hw, lx));
      const nz = Math.max(-grown.hd, Math.min(grown.hd, lz));
      if (Math.hypot(lx - nx, lz - nz) < c.r) return false;
    }
    return !terrain || this.terrain.flat(rect);
  }

  reserve(rect) {
    this.rects.push(rect);
    return rect;
  }

  reserveCircle(x, z, r) {
    this.circles.push({ x, z, r });
  }
}

// Le relevé donne les hauteurs naturelles (dm, relatives au sol visé) tous les 2 m. Le nivellement du jeu étant limité
// à ±8 m, un bâtiment n'est posé que là où le sol nivelé est réellement à la bonne hauteur.
export class TerrainGrid {
  constructor(survey) {
    this.grid = survey?.grid;
    this.center = survey?.center || [0, 0];
    this.floorY = survey?.floorY ?? 0;
    this.water = survey?.water ?? 30;
  }

  // Hauteur naturelle relative au sol de la ville (null hors du relevé).
  natural(x, z) {
    const g = this.grid;
    if (!g) return 0;
    const i = Math.round((this.center[1] + z - g.origin[1]) / g.step);
    const j = Math.round((this.center[0] + x - g.origin[0]) / g.step);
    if (i < 0 || j < 0 || i >= g.size || j >= g.size) return null;
    return g.heights[i * g.size + j] / 10;
  }

  deviation(x, z) {
    const h = this.natural(x, z);
    if (h === null) return 99;
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
