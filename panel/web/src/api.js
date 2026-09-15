import { useCallback, useEffect, useRef, useState } from 'react';
import { currentLanguage } from './i18n.jsx';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Panel': '1',
      'X-Panel-Lang': currentLanguage(),
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    window.dispatchEvent(new Event('panel:unauthorized'));
  }
  if (!res.ok) throw new ApiError(res.status, (isJson && data?.error) || res.statusText);
  return data;
}

// Charge une ressource, avec rafraîchissement optionnel toutes les `interval` ms.
export function useApi(path, { interval, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!path || !enabled) return;
    try {
      const data = await api(path);
      if (alive.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, [path, enabled]);

  useEffect(() => {
    alive.current = true;
    setState((s) => ({ ...s, loading: true }));
    reload();
    if (!interval) return () => (alive.current = false);
    const id = setInterval(() => document.visibilityState === 'visible' && reload(), interval);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [reload, interval]);

  return { ...state, reload };
}

const french = () => currentLanguage() === 'fr';
export const locale = () => (french() ? 'fr-FR' : 'en-GB');

export function formatBytes(n) {
  if (n == null) return '—';
  const u = french() ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function formatDuration(seconds) {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const day = french() ? 'j' : 'd';
  if (d) return `${d} ${day} ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
}

export function formatNumber(value) {
  return value == null ? '—' : Number(value).toLocaleString(locale());
}
