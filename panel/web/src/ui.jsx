import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleX, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { useT } from './i18n.jsx';

export const cx = (...c) => c.filter(Boolean).join(' ');

export function Card({ title, icon: Icon, actions, children, className, padded = true }) {
  return (
    <section className={cx('rounded-2xl border border-ink-800 bg-ink-900/80 shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset] backdrop-blur', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-100">
            {Icon && <Icon className="size-4 text-ember-400" />}
            {title}
          </h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

const BUTTON = {
  primary: 'bg-ember-500 text-ink-950 hover:bg-ember-400 shadow-[0_0_0_1px_rgb(0_0_0/0.2)_inset]',
  secondary: 'bg-ink-800 text-ink-100 hover:bg-ink-700 border border-ink-700',
  ghost: 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
  danger: 'bg-blood-500/15 text-blood-400 hover:bg-blood-500/25 border border-blood-500/30',
  success: 'bg-moss-500/15 text-moss-400 hover:bg-moss-500/25 border border-moss-500/30',
};

export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, children, className, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={loading || props.disabled}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        BUTTON[variant],
        className,
      )}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : Icon && <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />}
      {children}
    </button>
  );
}

const BADGE = {
  neutral: 'bg-ink-800 text-ink-300 border-ink-700',
  ember: 'bg-ember-500/10 text-ember-300 border-ember-500/30',
  green: 'bg-moss-500/10 text-moss-400 border-moss-500/30',
  red: 'bg-blood-500/10 text-blood-400 border-blood-500/30',
  blue: 'bg-frost-500/10 text-frost-400 border-frost-500/30',
  amber: 'bg-ember-500/10 text-ember-300 border-ember-500/30',
};

export function Badge({ tone = 'neutral', children, className }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium', BADGE[tone], className)}>{children}</span>;
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

export function Input(props) {
  return <input {...props} className={cx('input', props.className)} />;
}

export function Select({ options, className, ...props }) {
  return (
    <select
      {...props}
      className={cx('input appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a93a3' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={cx('flex cursor-pointer items-start justify-between gap-4', disabled && 'opacity-50')}>
      <span>
        <span className="block text-sm text-ink-100">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition', checked ? 'border-ember-500 bg-ember-500' : 'border-ink-600 bg-ink-800')}
      >
        <span className={cx('absolute top-0.5 size-4.5 rounded-full bg-ink-100 shadow transition-all', checked ? 'left-[22px] bg-ink-950' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-850/70 p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-ink-500">
        {label}
        {Icon && <Icon className={cx('size-4', tone || 'text-ink-500')} />}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-ink-100">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

export function Meter({ value, max, tone = 'bg-ember-500', className }) {
  const pct = max ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-ink-800', className)}>
      <div className={cx('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {Icon && <Icon className="size-8 text-ink-600" />}
      <div className="text-sm font-medium text-ink-300">{title}</div>
      {children && <div className="max-w-md text-xs text-ink-500">{children}</div>}
    </div>
  );
}

export function Spinner({ className }) {
  return <LoaderCircle className={cx('size-5 animate-spin text-ink-500', className)} />;
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-blood-500/30 bg-blood-500/10 px-3 py-2 text-sm text-blood-400">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{error.message || String(error)}</span>
    </div>
  );
}

export function Pre({ children, className }) {
  return (
    <pre className={cx('max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950 p-3 font-mono text-xs leading-relaxed text-ink-300', className)}>
      {children}
    </pre>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-ink-700 bg-ink-900 shadow-2xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <header className="flex items-center justify-between border-b border-ink-800 px-5 py-4">
          <h3 className="font-semibold text-ink-100">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100" aria-label={t('Fermer')}>
            <X className="size-4" />
          </button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-ink-800 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------- Notifications & confirmations ----------

const FeedbackContext = createContext(null);

export function FeedbackProvider({ children }) {
  const t = useT();
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const toast = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, message, type }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), type === 'error' ? 7000 : 4000);
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  const close = (result) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cx(
              'pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur',
              item.type === 'error' ? 'border-blood-500/40 bg-ink-900/95 text-blood-400' : 'border-moss-500/30 bg-ink-900/95 text-ink-100',
            )}
          >
            {item.type === 'error' ? <CircleX className="mt-0.5 size-4 shrink-0" /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-moss-400" />}
            <span className="whitespace-pre-wrap break-words">{item.message}</span>
          </div>
        ))}
      </div>
      <Modal
        open={!!confirmState}
        onClose={() => close(false)}
        title={confirmState?.title || t('Confirmer')}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {t('Annuler')}
            </Button>
            <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {confirmState?.confirmLabel || t('Confirmer')}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-300">{confirmState?.message}</p>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  return useContext(FeedbackContext);
}

// Exécute une action async avec notification de succès / erreur.
export function useAction() {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(null);
  const run = useCallback(
    async (key, fn, success) => {
      setBusy(key);
      try {
        const result = await fn();
        if (success) toast(typeof success === 'function' ? success(result) : success);
        return result;
      } catch (err) {
        toast(err.message || String(err), 'error');
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return [run, busy];
}
