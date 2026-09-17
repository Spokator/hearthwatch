// Accès au portail des joueurs : session séparée de celle du panel (cookie propre, ouvert par un code donné en jeu).
export class PortalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function portalApi(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`/api/portal${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Panel': '1',
      ...(raw ? { 'Content-Type': raw } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const json = res.headers.get('content-type')?.includes('application/json');
  const data = json ? await res.json() : await res.text();
  if (!res.ok) throw new PortalError(res.status, (json && data?.error) || res.statusText);
  return data;
}

export const audioUrl = (hash) => `/api/portal/audio/${hash}`;
