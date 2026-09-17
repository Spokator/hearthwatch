// Petits éléments communs au portail des joueurs.
export const cx = (...c) => c.filter(Boolean).join(' ');

// Bandeau runique : sépare les sections sans alourdir la page.
export function Rune({ className }) {
  return (
    <div className={cx('flex items-center gap-2 text-ember-700/70', className)} aria-hidden>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-ember-700/40" />
      <span className="font-serif text-xs tracking-[0.4em]">ᛉ ᛚ ᛞ</span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-ember-700/40" />
    </div>
  );
}

export function Card({ title, right, children, className }) {
  return (
    <section className={cx('rounded-xl border border-ink-800 bg-ink-900/70 p-4 shadow-lg shadow-black/30', className)}>
      {(title || right) && (
        <header className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h3 className="font-serif text-base text-ink-100">{title}</h3>}
          {right && <span className="text-xs text-ink-500">{right}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Bar({ value, max, tone = 'ember' }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tones = { ember: 'bg-ember-500', moss: 'bg-moss-500', frost: 'bg-frost-500' };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
      <div className={cx('h-full rounded-full transition-[width]', tones[tone] || tones.ember)} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Tag({ children, tone = 'ink' }) {
  const tones = {
    ink: 'border-ink-700 text-ink-300',
    ember: 'border-ember-600/50 text-ember-300',
    moss: 'border-moss-500/50 text-moss-400',
    blood: 'border-blood-500/50 text-blood-400',
  };
  return <span className={cx('rounded-full border px-2 py-0.5 text-[0.7rem]', tones[tone] || tones.ink)}>{children}</span>;
}
