#!/usr/bin/env node
// Renfort d'IA de Hearthwatch : fait parler les habitants avec la carte graphique d'une machine de la maison.
//
// Cette machine ne reçoit aucune connexion : elle appelle le panel, demande s'il y a une réplique à écrire, la
// calcule avec Ollama en local, renvoie le résultat, et recommence. Quand elle est éteinte, le serveur retombe
// tout seul sur son propre modèle.
//
//   node worker.mjs --panel https://mon-serveur.fr --key <clé du panel> --model mistral-nemo:12b
//
// Variables d'environnement équivalentes : HW_PANEL, HW_KEY, HW_MODEL, HW_OLLAMA, HW_NAME.
import fs from 'node:fs';
import os from 'node:os';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split(/\s+--/)
    .filter(Boolean)
    .map((part) => part.replace(/^--/, '').split(/\s+/))
    .map(([key, ...rest]) => [key, rest.join(' ')]),
);

const PANEL = (args.panel || process.env.HW_PANEL || '').replace(/\/$/, '');
const KEY = args.key || process.env.HW_KEY || '';
const MODEL = args.model || process.env.HW_MODEL || 'qwen2.5:7b';
const KEEP = args.keepalive || process.env.HW_KEEPALIVE || '30m'; // libère la mémoire de la carte quand personne ne parle
const OLLAMA = (args.ollama || process.env.HW_OLLAMA || 'http://127.0.0.1:11434').replace(/\/$/, '');
const NAME = args.name || process.env.HW_NAME || os.hostname();

if (!PANEL || !KEY) {
  console.error('Usage : node worker.mjs --panel https://mon-serveur.fr --key <clé> [--model mistral-nemo:12b]');
  process.exit(1);
}

// Journal facultatif : Node écrit lui-même dans le fichier (une redirection du terminal empêcherait un second
// renfort de démarrer tant que le premier tourne).
const LOG = args.log || process.env.HW_LOG || '';
if (LOG) {
  const write = (...parts) => {
    try {
      fs.appendFileSync(LOG, `${parts.join(' ')}
`);
    } catch {
      // un journal qui ne s'écrit pas ne doit jamais arrêter le renfort
    }
  };
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...parts) => {
      original(...parts);
      write(...parts);
    };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toLocaleTimeString();
let done = 0;
let ready = false;

// Charge le modèle une première fois : la première réplique d'un joueur ne doit pas attendre le chargement.
async function warm() {
  try {
    const started = Date.now();
    await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, stream: false, keep_alive: KEEP, options: { num_predict: 1 }, messages: [{ role: 'user', content: 'Bonjour' }] }),
    }).then((r) => r.json());
    ready = true;
    console.log(`${stamp()} modèle ${MODEL} chargé en ${Math.round((Date.now() - started) / 1000)} s`);
  } catch (error) {
    console.warn(`${stamp()} Ollama injoignable sur ${OLLAMA} : ${error.message}`);
  }
}

async function run(job) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      keep_alive: KEEP,
      format: job.format || 'json',
      options: job.options || {},
      messages: [{ role: 'system', content: job.system }, ...(job.messages || [])],
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data?.error || `HTTP ${res.status}`);
  return data.message?.content || '';
}

async function loop() {
  let quiet = 0;
  for (;;) {
    try {
      const res = await fetch(`${PANEL}/api/ai-worker/next`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-panel': '1', 'x-worker-key': KEY },
        body: JSON.stringify({ name: NAME, model: MODEL }),
      });
      if (res.status === 403) {
        console.error(`${stamp()} clé refusée par le panel — vérifie --key`);
        await sleep(30000);
        continue;
      }
      if (res.status === 204) {
        quiet = 0;
        continue; // rien à faire : on redemande aussitôt (le panel garde la connexion ouverte)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const job = await res.json();
      const started = Date.now();
      let payload;
      try {
        payload = { id: job.id, name: NAME, text: await run(job) };
      } catch (error) {
        payload = { id: job.id, name: NAME, error: error.message };
      }
      await fetch(`${PANEL}/api/ai-worker/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-panel': '1', 'x-worker-key': KEY },
        body: JSON.stringify(payload),
      });
      done++;
      console.log(`${stamp()} réplique ${done} en ${((Date.now() - started) / 1000).toFixed(1)} s${payload.error ? ` — échec : ${payload.error}` : ''}`);
      quiet = 0;
    } catch (error) {
      quiet = Math.min(quiet + 1, 6);
      console.warn(`${stamp()} panel injoignable (${error.message}) — nouvelle tentative dans ${5 * quiet} s`);
      await sleep(5000 * quiet);
    }
  }
}

console.log(`Renfort « ${NAME} » → ${PANEL} (modèle ${MODEL}, Ollama ${OLLAMA})`);
await warm();
if (!ready) console.log('Le renfort attend quand même : il réessaiera à la première réplique.');
await loop();
