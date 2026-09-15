// Lecture / écriture atomique des fichiers KEY=VALUE (EnvironmentFile systemd).
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readEnv(file) {
  const out = {};
  let text = '';
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

// Refuse les caractères que systemd interpréterait (guillemets, antislash, retours ligne).
export function isSafeEnvValue(value) {
  return typeof value === 'string' && !/[\n\r"'\\]/.test(value) && value === value.trim();
}

export async function writeEnv(file, values, mode = 0o600) {
  for (const [k, v] of Object.entries(values)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(k) || !isSafeEnvValue(String(v))) {
      throw new Error(`Valeur invalide pour ${k}`);
    }
  }
  const body = Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join('');
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, body, { mode });
  await fs.rename(tmp, file);
}

export async function updateEnv(file, patch, mode) {
  const current = await readEnv(file);
  await writeEnv(file, { ...current, ...patch }, mode);
  return { ...current, ...patch };
}
