// Renfort d'IA : une machine à part (un PC avec carte graphique) vient chercher le travail de dialogue.
//
// Le serveur n'appelle jamais le PC : c'est le PC qui se connecte au panel, demande s'il y a une réplique à
// écrire, la calcule chez lui et renvoie le résultat. Rien à ouvrir sur la box du joueur, et quand le PC est
// éteint les habitants retombent simplement sur le modèle du serveur.
import crypto from 'node:crypto';

const JOB_TIMEOUT = 60000; // au-delà, on considère que le renfort a lâché et on bascule sur le secours
const ALIVE = 90000; // un renfort est « connecté » s'il s'est manifesté dans ce délai

export class WorkerPool {
  constructor() {
    this.queue = [];
    this.jobs = new Map();
    this.waiters = [];
    this.workers = new Map(); // nom → { lastSeen, model, done, totalMs }
  }

  get connected() {
    return [...this.workers.values()].some((w) => Date.now() - w.lastSeen < ALIVE);
  }

  status() {
    const list = [...this.workers.entries()].map(([name, w]) => ({
      name,
      model: w.model,
      done: w.done,
      averageMs: w.done ? Math.round(w.totalMs / w.done) : 0,
      online: Date.now() - w.lastSeen < ALIVE,
      lastSeen: w.lastSeen,
    }));
    return { connected: this.connected, waiting: this.queue.length, workers: list };
  }

  // Dépose une demande et attend la réponse du renfort.
  submit(payload, timeoutMs = JOB_TIMEOUT) {
    if (!this.connected) return Promise.reject(new Error('aucun renfort IA connecté'));
    const id = crypto.randomBytes(8).toString('hex');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.jobs.delete(id);
        this.queue = this.queue.filter((x) => x !== id);
        reject(new Error('le renfort IA n’a pas répondu à temps'));
      }, timeoutMs);
      this.jobs.set(id, { payload, resolve, reject, timer, at: Date.now() });
      this.queue.push(id);
      const waiter = this.waiters.shift();
      if (waiter) waiter();
    });
  }

  // Appelé par le renfort : « as-tu du travail ? ». Attend jusqu'à `waitMs` avant de répondre « rien ».
  async take(name, model, waitMs = 25000) {
    const worker = this.workers.get(name) || { done: 0, totalMs: 0 };
    worker.lastSeen = Date.now();
    worker.model = model || worker.model;
    this.workers.set(name, worker);
    if (!this.queue.length) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== wake);
          resolve();
        }, waitMs);
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        this.waiters.push(wake);
      });
    }
    const id = this.queue.shift();
    if (!id || !this.jobs.has(id)) return null;
    const job = this.jobs.get(id);
    job.takenAt = Date.now();
    return { id, ...job.payload };
  }

  // Appelé par le renfort quand la réplique est prête (ou qu'elle a échoué).
  deliver(name, id, { text, error }) {
    const job = this.jobs.get(id);
    if (!job) return false;
    clearTimeout(job.timer);
    this.jobs.delete(id);
    const worker = this.workers.get(name);
    if (worker) {
      worker.lastSeen = Date.now();
      if (!error) {
        worker.done++;
        worker.totalMs += Date.now() - (job.takenAt || job.at);
      }
    }
    if (error) job.reject(new Error(String(error).slice(0, 200)));
    else job.resolve(String(text || ''));
    return true;
  }
}
