// Intelligence artificielle des habitants : fournisseurs interchangeables et file d'attente.
//
// - ollama : modèle local (par défaut qwen2.5:3b sur le serveur), gratuit, lent sur processeur ;
// - openai : toute API compatible OpenAI (OpenAI, Mistral, OpenRouter, LM Studio, vLLM, un Ollama distant…) ;
// - anthropic : Claude.
// Une seule génération à la fois par défaut (processeur partagé avec le jeu) ; les conversations passent avant les
// tâches de fond (chronique, rumeurs).

export const DEFAULT_AI = {
  enabled: true,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:3b',
  apiKey: '',
  temperature: 0.8,
  maxTokens: 160,
  timeoutSeconds: 45,
  concurrency: 1,
  language: 'fr',
};

export class AiService {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_AI, ...settings };
    this.queue = [];
    this.running = 0;
    this.stats = { requests: 0, failures: 0, totalMs: 0, lastError: null, lastMs: 0, queued: 0 };
  }

  configure(settings) {
    this.settings = { ...this.settings, ...settings };
  }

  get available() {
    return this.settings.enabled && !!this.settings.model;
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
          this.running--;
          this.pump();
        });
    }
  }

  async call({ system, messages, schema, maxTokens }) {
    const s = this.settings;
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
          keep_alive: '30m',
          format: schema || 'json',
          options: { temperature: s.temperature, num_predict: tokens, num_ctx: 3072 },
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
