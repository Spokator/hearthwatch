// Intelligence artificielle des habitants : fournisseurs interchangeables et file d'attente.
//
// - ollama : modèle local (par défaut qwen2.5:3b sur le serveur), gratuit, lent sur processeur ;
// - openai : toute API compatible OpenAI (OpenAI, Mistral, OpenRouter, LM Studio, vLLM, un Ollama distant…) ;
// - anthropic : Claude ;
// - renfort : une machine à part (voir worker.js) qui vient chercher le travail — le PC du joueur, avec son GPU.
// Une seule génération à la fois par défaut (processeur partagé avec le jeu) ; les conversations passent avant les
// tâches de fond (chronique, rumeurs).

import { WorkerPool } from './worker.js';

export const DEFAULT_AI = {
  enabled: true,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:3b',
  apiKey: '',
  temperature: 0.8,
  maxTokens: 120,
  timeoutSeconds: 90,
  keepAlive: '24h',
  concurrency: 1,
  language: 'fr',
  // Secours : utilisé quand le principal ne répond pas (machine éteinte, quota, panne réseau).
  fallback: { enabled: false, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: '', apiKey: '', timeoutSeconds: 90, maxTokens: 120 },
};

// Après un échec du principal, on ne le rappelle qu'au bout d'une minute : inutile de faire attendre chaque joueur.
const RETRY_PRIMARY = 60000;

// Taille de contexte fixe : la changer d'un appel à l'autre forcerait Ollama à recharger le modèle.
const NUM_CTX = 3072;

export class AiService {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_AI, ...settings };
    this.queue = [];
    this.running = 0;
    this.stats = { requests: 0, failures: 0, totalMs: 0, lastError: null, lastMs: 0, queued: 0, fallbacks: 0, primaryDown: false, provider: null };
    this.downUntil = 0;
    this.worker = new WorkerPool();
  }

  configure(settings) {
    this.settings = { ...this.settings, ...settings, fallback: { ...DEFAULT_AI.fallback, ...this.settings.fallback, ...(settings.fallback || {}) } };
    this.downUntil = 0;
    this.stats.primaryDown = false;
  }

  // Réglages du secours, complétés par ceux du principal (créativité, longueur des réponses).
  get fallbackConfig() {
    const f = this.settings.fallback;
    if (!f?.enabled || !f.model) return null;
    return {
      ...this.settings,
      provider: f.provider || 'ollama',
      baseUrl: f.baseUrl || '',
      model: f.model,
      apiKey: f.apiKey || '',
      timeoutSeconds: f.timeoutSeconds || this.settings.timeoutSeconds,
      maxTokens: f.maxTokens || this.settings.maxTokens,
    };
  }

  get available() {
    if (!this.settings.enabled) return false;
    if (this.settings.provider === 'worker') return this.worker.connected || !!this.fallbackConfig;
    return !!this.settings.model;
  }

  get busy() {
    return this.running + this.queue.length;
  }

  // Demande une réponse JSON. priority : 0 = conversation, 1 = réaction, 2 = fond. Rejette si l'IA est coupée.
  complete({ system, messages, schema = null, priority = 0, maxTokens = null }) {
    if (!this.available) return Promise.reject(new Error('IA désactivée'));
    return new Promise((resolve, reject) => {
      this.queue.push({ system, messages, schema, priority, maxTokens, resolve, reject, queuedAt: Date.now() });
      this.queue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
      // Les tâches de fond trop anciennes sont abandonnées.
      this.queue = this.queue.filter((job) => job.priority < 2 || Date.now() - job.queuedAt < 120000 || (job.reject(new Error('abandonné')), false));
      this.stats.queued = this.queue.length;
      this.pump();
    });
  }

  pump() {
    while (this.running < Math.max(1, this.settings.concurrency) && this.queue.length) {
      const job = this.queue.shift();
      this.stats.queued = this.queue.length;
      this.running++;
      const started = Date.now();
      this.call(job)
        .then((text) => {
          this.stats.requests++;
          this.stats.lastMs = Date.now() - started;
          this.stats.totalMs += this.stats.lastMs;
          job.resolve(parseJson(text));
        })
        .catch((error) => {
          this.stats.failures++;
          this.stats.lastError = `${new Date().toISOString()} ${error.message}`;
          job.reject(error);
        })
        .finally(() => {
          this.lastUsed = Date.now();
          this.running--;
          this.pump();
        });
    }
  }

  // Essaie le principal, puis le secours. Le principal est mis de côté une minute après un échec.
  async call(job) {
    const fallback = this.fallbackConfig;
    let failure = null;
    if (!fallback || Date.now() >= this.downUntil) {
      try {
        const answer = await this.callWith(this.settings, job);
        this.downUntil = 0;
        this.stats.primaryDown = false;
        this.stats.provider = `${this.settings.provider}:${this.settings.model}`;
        return answer;
      } catch (error) {
        failure = error;
        if (!fallback) throw error;
        this.downUntil = Date.now() + RETRY_PRIMARY;
        this.stats.primaryDown = true;
        this.stats.lastError = `${new Date().toISOString()} principal (${this.settings.model}) : ${error.message}`;
      }
    }
    try {
      const answer = await this.callWith(fallback, job);
      this.stats.fallbacks++;
      this.stats.provider = `${fallback.provider}:${fallback.model}`;
      return answer;
    } catch (error) {
      throw failure || error;
    }
  }

  async callWith(s, { system, messages, schema, maxTokens }) {
    if (s.provider === 'worker') {
      if (!this.worker.connected) throw new Error('aucun renfort IA connecté');
      return this.worker.submit(
        { system, messages, format: schema || 'json', options: { temperature: s.temperature, num_predict: maxTokens || s.maxTokens, num_ctx: NUM_CTX } },
        s.timeoutSeconds * 1000,
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), s.timeoutSeconds * 1000);
    const tokens = maxTokens || s.maxTokens;
    try {
      if (s.provider === 'anthropic') {
        const res = await fetch(`${s.baseUrl || 'https://api.anthropic.com'}/v1/messages`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: s.model, max_tokens: tokens, temperature: s.temperature, system: `${system}\n\nRéponds uniquement par un objet JSON valide.`, messages }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
        return (data.content || []).map((c) => c.text || '').join('');
      }
      if (s.provider === 'openai') {
        const base = (s.baseUrl || 'https://api.openai.com').replace(/\/$/, '');
        const res = await fetch(`${base}${base.endsWith('/v1') ? '' : '/v1'}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', ...(s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}) },
          body: JSON.stringify({ model: s.model, temperature: s.temperature, max_tokens: tokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, ...messages] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
        return data.choices?.[0]?.message?.content || '';
      }
      // Ollama
      const res = await fetch(`${(s.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: s.model,
          stream: false,
          keep_alive: s.keepAlive || '24h',
          format: schema || 'json',
          options: { temperature: s.temperature, num_predict: tokens, num_ctx: NUM_CTX },
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data?.error || `HTTP ${res.status}`);
      return data.message?.content || '';
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`délai dépassé (${s.timeoutSeconds} s)`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // Ollama : charge le modèle et précalcule la partie commune des prompts, pour que la première réplique après un
  // démarrage ne paie pas la lecture du monde entier. Sans effet sur les API distantes (déjà rapides).
  async warm(system) {
    const fallback = this.fallbackConfig;
    // Si le principal est distant, c'est le secours local qu'il faut préparer.
    const s = this.settings.provider === 'ollama' && (this.settings.baseUrl || '').includes('127.0.0.1') ? this.settings : fallback?.provider === 'ollama' ? fallback : this.settings;
    if (!this.available || s.provider !== 'ollama' || this.busy) return false;
    this.warmTriedAt = Date.now();
    this.running++;
    try {
      const res = await fetch(`${(s.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        signal: AbortSignal.timeout(Math.max(120, s.timeoutSeconds * 2) * 1000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: s.model,
          stream: false,
          keep_alive: s.keepAlive || '24h',
          format: 'json',
          options: { temperature: s.temperature, num_predict: 1, num_ctx: NUM_CTX },
          messages: [{ role: 'system', content: system }],
        }),
      });
      await res.json();
      this.warmedAt = Date.now();
      return res.ok;
    } catch {
      return false;
    } finally {
      this.running--;
      this.pump();
    }
  }

  // Liste des modèles disponibles (Ollama) pour la page de réglages.
  async models() {
    const s = this.settings;
    try {
      if (s.provider === 'ollama') {
        const res = await fetch(`${(s.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        return (data.models || []).map((m) => m.name);
      }
      if (s.provider === 'openai') {
        const base = (s.baseUrl || 'https://api.openai.com').replace(/\/$/, '');
        const res = await fetch(`${base}${base.endsWith('/v1') ? '' : '/v1'}/models`, {
          headers: s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {},
          signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        return (data.data || []).map((m) => m.id);
      }
    } catch {
      return [];
    }
    return [];
  }
}

// Les petits modèles entourent parfois leur JSON de texte : on extrait le premier objet complet.
export function parseJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        // tombe plus bas
      }
    }
  }
  return { say: raw.replace(/[{}"]/g, '').slice(0, 300) };
}
