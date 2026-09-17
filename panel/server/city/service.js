// Ville : relevé du terrain et construction par le plugin HearthwatchArena, plan généré ici.
// Fichiers dans data/panelmap : pieces.json (dimensions des pièces, exporté par le plugin), city-survey.json (relevé),
// city-plan.json (plan à bâtir, écrit ici), city-preview.json (aperçu du dernier plan).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fail } from '../errors.js';
import { generateCity, SIZES } from './generator.js';
import { segmentDistance } from './layout.js';

export class CityService {
  constructor(dir, arena) {
    this.dir = dir;
    this.arena = arena;
    this.geometryCache = null;
  }

  file(name) {
    return path.join(this.dir, name);
  }

  async readJson(name) {
    try {
      return JSON.parse(await fs.readFile(this.file(name), 'utf8'));
    } catch {
      return null;
    }
  }

  async writeJson(name, data) {
    const target = this.file(name);
    const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.rename(tmp, target);
  }

  async geometry() {
    const target = this.file('pieces.json');
    let stat;
    try {
      stat = await fs.stat(target);
    } catch {
      fail(503, "Dimensions des pièces introuvables : le plugin doit avoir démarré au moins une fois avec la version 0.2");
    }
    if (this.geometryCache?.mtime !== stat.mtimeMs) {
      const data = JSON.parse(await fs.readFile(target, 'utf8'));
      this.geometryCache = { mtime: stat.mtimeMs, pieces: data.pieces, game: data.game };
    }
    return this.geometryCache;
  }

  async status() {
    const state = await this.arena.state();
    const survey = await this.readJson('city-survey.json');
    const preview = await this.readJson('city-preview.json');
    return {
      plugin: state ? { stale: state.stale, version: state.plugin } : null,
      city: state?.city ?? null,
      survey: survey ? summarize(survey) : null,
      plan: preview?.summary ?? null,
      sizes: SIZES,
    };
  }

  async survey({ player, x, z, size, search, anchor }) {
    const radius = SIZES[size];
    if (!radius) fail(400, 'Taille de ville inconnue');
    // Marge : douves, promenade et recherche d'eau pour le canal jusqu'à 110 m des remparts.
    const params = { radius, margin: 130, search: search ? 1 : 0 };
    if (anchor) {
      Object.assign(params, { anchor: 'start', x: 0, z: 0, search: 0 });
    } else if (player) {
      const state = await this.arena.state();
      const live = await this.readJson('live.json');
      const hit = live?.players?.find((p) => p.name?.toLowerCase() === String(player).toLowerCase());
      if (!hit) fail(404, 'Position du joueur inconnue (déconnecté ?)');
      params.x = Math.round(hit.x);
      params.z = Math.round(hit.z);
      if (!state) fail(503, "Le plugin ne répond pas");
    } else {
      params.x = Math.round(Number(x));
      params.z = Math.round(Number(z));
      if (!Number.isFinite(params.x) || !Number.isFinite(params.z)) fail(400, 'Choisis un joueur ou des coordonnées');
    }
    const result = await this.arena.command('city-survey', params, { timeout: 30000 });
    const survey = await this.readJson('city-survey.json');
    if (!survey) fail(500, 'Relevé introuvable');
    survey.size = size;
    await this.writeJson('city-survey.json', survey);
    await fs.rm(this.file('city-preview.json'), { force: true });
    return { message: result.message, survey: summarize(survey) };
  }

  async generate(options) {
    const survey = await this.readJson('city-survey.json');
    if (!survey) fail(409, "Relève d'abord le terrain");
    const { pieces, game } = await this.geometry();
    const o = sanitize(options, survey.size);
    // Objets du jeu pour l'armurerie (exportés par le plugin ; sans eux, pas d'armurerie).
    const items = (await this.readJson('items.json'))?.items ?? [];
    const { plan, preview, info } = generateCity({ geometry: pieces, survey, options: o, items });
    if (info.missing.length) fail(500, `Pièces absentes de cette version du jeu : ${info.missing.join(', ')}`);
    await this.writeJson('city-plan.json', plan);
    const summary = {
      ...info,
      reserved: undefined,
      options: o,
      center: plan.center,
      floorY: plan.floorY,
      spawn: plan.spawn,
      game,
      generatedAt: new Date().toISOString(),
    };
    await this.writeJson('city-preview.json', { summary, preview, terrain: terrainPreview(survey, plan) });
    return summary;
  }

  async preview() {
    const data = await this.readJson('city-preview.json');
    if (!data) fail(404, 'Aucun plan généré');
    return data;
  }

  async build({ force }) {
    const plan = await this.readJson('city-plan.json');
    if (!plan) fail(409, "Génère d'abord un plan");
    return this.arena.command('city-build', { force: force ? 1 : 0 }, { timeout: 30000 });
  }
}

function sanitize(options = {}, size) {
  const text = (value, fallback, max = 40) => {
    const s = String(value ?? '').replace(/[\r\n<>]+/g, ' ').trim().slice(0, max);
    return s || fallback;
  };
  const seed = Number.parseInt(options.seed, 10);
  return {
    name: text(options.name, 'Spokaheim'),
    emperor: text(options.emperor, 'Spoka'),
    size: SIZES[size] ? size : 'cite',
    seed: Number.isFinite(seed) ? Math.abs(seed) % 1000000 : 1,
    language: options.language === 'en' ? 'en' : 'fr',
    arena: options.arena !== false,
    houses: options.houses !== false,
    guards: options.guards !== false,
  };
}

function summarize(survey) {
  const { grid, ...rest } = survey;
  return rest;
}

// Sol après nivellement, tous les 4 m, pour l'aperçu 3D (hauteurs relatives au sol de la ville).
function terrainPreview(survey, plan) {
  const g = survey.grid;
  const every = 2;
  const size = Math.floor((g.size - 1) / every) + 1;
  const heights = [];
  const reach = plan.terrain.radius + plan.terrain.blend;
  for (let i = 0; i < size; i++)
    for (let j = 0; j < size; j++) {
      const raw = g.heights[i * every * g.size + j * every] / 10;
      const wx = g.origin[0] + j * every * g.step;
      const wz = g.origin[1] + i * every * g.step;
      const d = Math.hypot(wx - plan.center[0], wz - plan.center[1]);
      const weight = d <= plan.terrain.radius ? 1 : Math.max(0, 1 - (d - plan.terrain.radius) / plan.terrain.blend);
      let target = d <= reach ? raw * (1 - weight) : raw;
      for (const [kind, type, x1, z1, x2, z2, width, bottom] of plan.terrain.paint) {
        if (kind !== 6 || type !== 2) continue;
        const dist = segmentDistance(wx, wz, x1, z1, x2, z2) - width / 2;
        if (dist >= 2.5) continue;
        const w = dist <= 0 ? 1 : 1 - dist / 2.5;
        target = target + (Math.min(target, bottom - plan.floorY) - target) * w;
      }
      const delta = Math.max(-8, Math.min(8, target - raw));
      heights.push(Math.round((raw + delta) * 10) / 10);
    }
  return { origin: [g.origin[0] - plan.center[0], g.origin[1] - plan.center[1]], step: g.step * every, size, heights, water: survey.water - plan.floorY };
}
