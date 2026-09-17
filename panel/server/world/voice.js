// Voix des habitants : client du service local (Piper pour parler, Whisper pour écouter).
//
// Le service vit à part (deploy/install-voice.sh) : ici on choisit quelle voix va à quel habitant, on garde en
// cache les répliques déjà dites et on transcrit ce que le joueur dicte depuis le portail. Sans service installé,
// tout se dégrade proprement : le portail reste en texte.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Genre des voix à locuteur unique (les voix multi-locuteurs sont classées par hauteur à l'installation).
const VOICE_GENDER = {
  'fr_FR-siwis-medium': ['f'],
  'fr_FR-tom-medium': ['m'],
  'fr_FR-gilles-low': ['m'],
  'fr_FR-upmc-medium': ['f', 'm'], // 0 = Jessica, 1 = Pierre
  'en_GB-jenny_dioco-medium': ['f'],
  'en_US-ryan-medium': ['m'],
  'en_GB-alan-medium': ['m'],
  'en_US-amy-medium': ['f'],
};

const CACHE_MAX = 400 * 1024 * 1024;
const MAX_TEXT = 500;

export class VoiceService {
  constructor({ baseUrl = process.env.VOICE_URL || '', key = process.env.VOICE_KEY || '', cacheDir, log = console.warn } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.key = key;
    this.cacheDir = cacheDir;
    this.log = log;
    this.info = null;
    this.checkedAt = 0;
    this.pending = new Map(); // empreinte -> { npc, text, voice } en attente de synthèse
    this.assignments = new Map();
    this.cacheBytes = 0;
  }

  get enabled() {
    return !!this.baseUrl;
  }

  get ready() {
    return !!this.info?.tts;
  }

  headers(extra = {}) {
    return { ...(this.key ? { 'x-voice-key': this.key } : {}), ...extra };
  }

  // État du service, revérifié au plus une fois par minute (il peut être installé après le panel).
  async health(force = false) {
    if (!this.enabled) return null;
    if (!force && this.info && Date.now() - this.checkedAt < 60000) return this.info;
    this.checkedAt = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/health`, { headers: this.headers(), signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.info = await res.json();
      this.assignments.clear();
    } catch (error) {
      if (this.info) this.log(`[voice] service injoignable : ${error.message}`);
      this.info = null;
    }
    return this.info;
  }

  status() {
    return {
      enabled: this.enabled,
      ready: this.ready,
      speech: !!this.info?.tts,
      listen: !!this.info?.stt,
      model: this.info?.model || null,
      voices: (this.info?.voices || []).length,
    };
  }

  // Deux réserves de voix, une par genre : d'abord les voix dédiées, puis les locuteurs des voix multiples,
  // classés du plus grave au plus aigu pour que deux habitants voisins ne se ressemblent pas.
  pools(lang) {
    const info = this.info;
    if (!info) return { m: [], f: [] };
    const pools = { m: [], f: [] };
    const wanted = (voice) => !voice.lang || voice.lang === lang;
    for (const voice of info.voices.filter(wanted)) {
      if (voice.speakers > 1) continue;
      const genders = VOICE_GENDER[voice.name] || ['m'];
      genders.forEach((gender, speaker) => pools[gender]?.push({ voice: voice.name, speaker }));
    }
    for (const voice of info.voices.filter(wanted)) {
      if (voice.speakers <= 1) continue;
      const entries = (info.speakers || {})[voice.name] || [];
      for (const gender of ['m', 'f']) {
        const same = entries.filter((e) => e.gender === gender).sort((a, b) => a.pitch - b.pitch);
        for (const entry of same) pools[gender].push({ voice: voice.name, speaker: entry.speaker });
      }
    }
    return pools;
  }

  // Voix d'un habitant : stable d'un redémarrage à l'autre, réglée sur son âge et modifiable depuis le panel.
  voiceOf(npc, order = [], lang = 'fr') {
    if (!this.ready) return null;
    const cacheKey = `${lang}:${npc.key}`;
    if (this.assignments.has(cacheKey)) return this.assignments.get(cacheKey);
    const pools = this.pools(lang);
    const gender = npc.gender === 'f' ? 'f' : 'm';
    const pool = pools[gender].length ? pools[gender] : [...pools.m, ...pools.f];
    if (!pool.length) return null;
    const age = Number(npc.age) || 40;
    const jitter = (parseInt(crypto.createHash('sha1').update(npc.key).digest('hex').slice(0, 4), 16) % 100) / 100;
    // `order` est la liste des habitants du même genre : chacun prend une voix différente de la réserve.
    const rank = order.indexOf(npc.key);
    const index = (rank >= 0 ? rank : Math.round(jitter * 100)) % pool.length;
    const base = npc.voice && typeof npc.voice === 'object' ? npc.voice : pool[index];
    const spec = {
      voice: base.voice,
      speaker: base.speaker || 0,
      length: Number(base.length) || Math.min(1.25, Math.max(0.85, 0.97 + (age - 45) / 350 + (jitter - 0.5) * 0.12)),
      noise: 0.667,
      noiseW: 0.75 + (jitter - 0.5) * 0.2,
    };
    this.assignments.set(cacheKey, spec);
    return spec;
  }

  // Ce qui est dit à voix haute : sans les gestes entre astérisques ni les crochets de listes.
  static speakable(text) {
    return String(text || '')
      .replace(/\*[^*]*\*/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[«»"]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TEXT);
  }

  // Annonce une réplique à dire : renvoie l'adresse de l'audio, synthétisé seulement si le joueur l'écoute.
  offer(npc, text, lang = 'fr', order = []) {
    const spoken = VoiceService.speakable(text);
    if (!spoken || !this.ready) return null;
    const spec = this.voiceOf(npc, order, lang);
    if (!spec) return null;
    const hash = crypto.createHash('sha1').update(`${spec.voice}|${spec.speaker}|${spec.length.toFixed(3)}|${spoken}`).digest('hex');
    if (!this.pending.has(hash)) this.pending.set(hash, { ...spec, text: spoken });
    if (this.pending.size > 500) this.pending.delete(this.pending.keys().next().value);
    return hash;
  }

  cachePath(hash, type = 'audio/mpeg') {
    return path.join(this.cacheDir, `${hash}.${type === 'audio/wav' ? 'wav' : 'mp3'}`);
  }

  // Audio d'une réplique annoncée plus tôt (fichier en cache, sinon synthèse à la demande).
  async audio(hash) {
    if (!/^[0-9a-f]{40}$/.test(hash)) return null;
    for (const type of ['audio/mpeg', 'audio/wav']) {
      const cached = await fs.readFile(this.cachePath(hash, type)).catch(() => null);
      if (cached) return { data: cached, type };
    }
    const spec = this.pending.get(hash);
    if (!spec || !this.ready) return null;
    const res = await fetch(`${this.baseUrl}/tts`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ ...spec, format: 'mp3' }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      this.log(`[voice] synthèse refusée : HTTP ${res.status}`);
      return null;
    }
    const type = res.headers.get('content-type')?.includes('wav') ? 'audio/wav' : 'audio/mpeg';
    const audio = Buffer.from(await res.arrayBuffer());
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(this.cachePath(hash, type), audio);
      this.cacheBytes += audio.length;
      if (this.cacheBytes > CACHE_MAX) await this.prune();
    } catch (error) {
      this.log(`[voice] cache : ${error.message}`);
    }
    return { data: audio, type };
  }

  // Le cache garde les répliques les plus récentes : on jette la moitié la plus ancienne quand il déborde.
  async prune() {
    this.cacheBytes = 0;
    const files = [];
    for (const name of await fs.readdir(this.cacheDir).catch(() => [])) {
      if (!name.endsWith('.mp3') && !name.endsWith('.wav')) continue;
      const file = path.join(this.cacheDir, name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat) files.push({ file, time: stat.mtimeMs, size: stat.size });
    }
    files.sort((a, b) => b.time - a.time);
    let kept = 0;
    for (const entry of files) {
      kept += entry.size;
      if (kept > CACHE_MAX / 2) await fs.rm(entry.file, { force: true });
      else this.cacheBytes += entry.size;
    }
  }

  // Transcription de ce que le joueur a dicté depuis le portail.
  async listen(audio, lang = 'fr') {
    if (!this.info?.stt) return null;
    const res = await fetch(`${this.baseUrl}/stt?lang=${encodeURIComponent(lang)}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/octet-stream' }),
      body: audio,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`transcription refusée (HTTP ${res.status})`);
    const data = await res.json();
    return String(data.text || '').slice(0, 400);
  }
}
