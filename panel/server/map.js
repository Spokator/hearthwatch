// Carte en direct : lit les exports du plugin ValheimPanelBridge (data/panelmap),
// rend l'image du monde en PNG et filtre les données hors des zones explorées.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fail } from './errors.js';

const deflate = promisify(zlib.deflate);
const WATER_LEVEL = 30;
const ZONE_SIZE = 64;
const MASKED_RENDER_EVERY_MS = 60 * 1000;

// Index de biome écrits par le plugin -> couleur de base.
const BIOME_COLORS = {
  0: [110, 120, 110],
  1: [132, 170, 86], // Prairies
  2: [112, 98, 78], // Marais
  3: [218, 224, 230], // Montagnes
  4: [58, 98, 52], // Forêt noire
  5: [214, 190, 104], // Plaines
  6: [150, 58, 44], // Terres cendrées
  7: [226, 238, 246], // Grand Nord
  8: [42, 90, 122], // Océan
  9: [104, 88, 128], // Brumes
};
// Seuils de « facteur forêt » en dessous desquels un pixel est boisé (d'après la minimap du jeu).
const FOREST_THRESHOLD = { 1: 1.15, 4: 1.15, 5: 0.8, 9: 1.15 };
const SHALLOW = [74, 136, 168];
const DEEP = [20, 52, 82];
const SAND = [206, 190, 140];
const FOG = [16, 19, 25];

export const zoneKey = (x, z) => `${Math.floor((x + ZONE_SIZE / 2) / ZONE_SIZE)},${Math.floor((z + ZONE_SIZE / 2) / ZONE_SIZE)}`;

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

function crcChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(Buffer.from(type, 'ascii'))) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

async function encodePng(rgb, size) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) rgb.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crcChunk('IHDR', ihdr),
    crcChunk('IDAT', await deflate(raw, { level: 6 })),
    crcChunk('IEND', Buffer.alloc(0)),
  ]);
}

function parseGrid(buf) {
  if (buf.toString('ascii', 0, 4) !== 'VPM1') throw new Error('Fichier de carte invalide');
  const size = buf.readInt32LE(4);
  const pixel = buf.readFloatLE(8);
  const seed = buf.readInt32LE(12);
  const n = size * size;
  let o = 16;
  const biomes = buf.subarray(o, (o += n));
  const heights = new Int16Array(n);
  for (let k = 0; k < n; k++, o += 2) heights[k] = buf.readInt16LE(o);
  const forest = buf.subarray(o, o + n);
  return { size, pixel, seed, biomes, heights, forest };
}

// Rend la carte, nord en haut. `explored` : Set de zones visibles (null = tout).
function renderRgb(grid, explored) {
  const { size, pixel, biomes, heights, forest } = grid;
  const rgb = Buffer.alloc(size * size * 3);
  const half = size / 2;
  const h = (i, j) => heights[clamp(i, 0, size - 1) * size + clamp(j, 0, size - 1)] / 4;

  for (let row = 0; row < size; row++) {
    const i = size - 1 - row;
    const wz = (i - half) * pixel + pixel / 2;
    for (let j = 0; j < size; j++) {
      const k = i * size + j;
      const o = (row * size + j) * 3;
      const wx = (j - half) * pixel + pixel / 2;
      let c;

      if (explored && !explored.has(zoneKey(wx, wz))) {
        c = FOG;
      } else {
        const height = heights[k] / 4;
        if (height < WATER_LEVEL) {
          c = mix(SHALLOW, DEEP, clamp((WATER_LEVEL - height) / 45, 0, 1));
        } else {
          const biome = biomes[k];
          c = BIOME_COLORS[biome] || BIOME_COLORS[0];
          const threshold = FOREST_THRESHOLD[biome];
          if (threshold && forest[k] !== 255 && forest[k] / 50 < threshold) c = mix(c, [24, 52, 30], biome === 4 ? 0.35 : 0.28);
          if (height < WATER_LEVEL + 1.5 && biome !== 3 && biome !== 7) c = mix(c, SAND, 0.55);
          // Ombrage du relief, lumière venant du nord-ouest.
          const slope = (h(i, j + 1) - h(i, j - 1) + (h(i - 1, j) - h(i + 1, j))) / (pixel * 2);
          const shade = clamp(1 + slope * 0.9, 0.62, 1.3);
          c = [c[0] * shade, c[1] * shade, c[2] * shade];
        }
      }
      rgb[o] = clamp(c[0], 0, 255);
      rgb[o + 1] = clamp(c[1], 0, 255);
      rgb[o + 2] = clamp(c[2], 0, 255);
    }
  }
  return rgb;
}

export class MapService {
  constructor(dir) {
    this.dir = dir;
    this.json = new Map();
    this.grid = null;
    this.images = new Map();
    this.rendering = new Map();
  }

  async #readJson(name) {
    const file = path.join(this.dir, name);
    const cached = this.json.get(name);
    try {
      const st = await fs.stat(file);
      if (cached && cached.mtime === st.mtimeMs) return cached.data;
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      this.json.set(name, { mtime: st.mtimeMs, data });
      return data;
    } catch {
      // Fichier en cours de remplacement ou absent : on garde la dernière version lue.
      return cached?.data ?? null;
    }
  }

  status() {
    return this.#readJson('map.json');
  }

  async #zones() {
    const world = await this.#readJson('world.json');
    const zones = new Set();
    const flat = world?.zones || [];
    for (let i = 0; i + 1 < flat.length; i += 2) zones.add(`${flat[i]},${flat[i + 1]}`);
    return zones;
  }

  async #loadGrid(status) {
    const file = path.join(this.dir, path.basename(status.file));
    const st = await fs.stat(file).catch(() => fail(404, 'Carte introuvable'));
    if (this.grid?.file !== file || this.grid.mtime !== st.mtimeMs) {
      this.grid = { file, mtime: st.mtimeMs, data: parseGrid(await fs.readFile(file)) };
      this.images.clear();
    }
    return this.grid.data;
  }

  // PNG complet (spoilers) ou masqué aux zones explorées.
  async image({ spoilers }) {
    const status = await this.status();
    if (!status?.done) fail(404, 'La carte est en cours de génération');
    const grid = await this.#loadGrid(status);
    const variant = spoilers ? 'full' : 'explored';
    const current = this.images.get(variant);
    if (current && (spoilers || Date.now() - current.at < MASKED_RENDER_EVERY_MS)) return current.png;

    if (!this.rendering.has(variant)) {
      this.rendering.set(
        variant,
        (async () => {
          const explored = spoilers ? null : await this.#zones();
          const png = await encodePng(renderRgb(grid, explored), grid.size);
          this.images.set(variant, { png, at: Date.now() });
          return png;
        })().finally(() => this.rendering.delete(variant)),
      );
    }
    return current ? current.png : this.rendering.get(variant);
  }

  async live({ spoilers }) {
    const data = await this.#readJson('live.json');
    if (!data) return null;
    if (spoilers) return data;
    const zones = await this.#zones();
    return { ...data, creatures: data.creatures.filter(([, x, z]) => zones.has(zoneKey(x, z))), vehicles: data.vehicles.filter((v) => zones.has(zoneKey(v.x, v.z))) };
  }

  async world({ spoilers }) {
    const data = await this.#readJson('world.json');
    if (!data) return null;
    const { zones: flatZones, ...rest } = data;
    if (spoilers) return { ...rest, zones: flatZones };
    const zones = await this.#zones();
    const seen = (x, z) => zones.has(zoneKey(x, z));
    return {
      ...rest,
      resources: rest.resources.filter(([, x, z]) => seen(x, z)),
      portals: rest.portals.filter((p) => seen(p.x, p.z)),
      tombstones: rest.tombstones.filter((t) => seen(t.x, t.z)),
      builds: rest.builds.filter(([cx, cz]) => seen(cx * 32 + 16, cz * 32 + 16)),
      locations: rest.locations.filter(([, x, z, placed]) => placed && seen(x, z)),
      zones: null,
    };
  }

  // Altitude approximative du terrain d'origine (utile pour poser un coffre au sol).
  async groundHeight(x, z) {
    const status = await this.status();
    if (!status?.done) return null;
    const { size, pixel, heights } = await this.#loadGrid(status);
    const j = clamp(Math.floor(x / pixel + size / 2), 0, size - 1);
    const i = clamp(Math.floor(z / pixel + size / 2), 0, size - 1);
    return heights[i * size + j] / 4;
  }
}
