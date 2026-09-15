// Configuration d'exécution : installation systemd (VPS) ou conteneur Docker (Hearthwatch).
import path from 'node:path';

const env = process.env;

function hour(value, fallback) {
  const n = Number(value === undefined || value === '' ? fallback : value);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : -1;
}

function trustProxy(value) {
  if (value === undefined || value === '') return '127.0.0.1';
  if (/^(1|true|yes)$/i.test(value)) return true;
  if (/^(0|false|no)$/i.test(value)) return false;
  return value;
}

export const MODE = env.HW_MODE === 'docker' ? 'docker' : 'systemd';
export const DATA_DIR = env.HW_DATA_DIR || env.VALHEIM_BASE || '/opt/valheim';
export const HOST = env.HW_HOST || '127.0.0.1';
export const PORT = env.HW_PORT || env.PORT || '';
export const TRUST_PROXY = trustProxy(env.HW_TRUST_PROXY);
export const PUBLIC_ADDRESS = env.PUBLIC_ADDRESS || '';
export const LANGUAGE = env.HW_LANGUAGE === 'en' ? 'en' : 'fr';
export const LOG_FILE = path.join(DATA_DIR, 'logs/valheim.log');

// Sur un VPS systemd, des timers s'en chargent déjà : tâches quotidiennes du panel seulement en Docker.
export const BACKUP_HOUR = MODE === 'docker' ? hour(env.BACKUP_HOUR, 4) : -1;
export const RESTART_HOUR = MODE === 'docker' ? hour(env.RESTART_HOUR, 5) : -1;
