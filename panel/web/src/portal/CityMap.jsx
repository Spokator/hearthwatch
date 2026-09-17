// La carte de Spokaheim sur le téléphone : les murs, les portes, les lieux, les habitants et toi.
// Toucher un habitant ouvre la conversation ; toucher la carte pose un repère sur ta carte en jeu.
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n.jsx';
import { portalApi } from './api.js';
import { cx } from './ui.jsx';

const SIZE = 320; // côté du dessin, en unités SVG

export default function CityMap({ live, onTalk }) {
  const t = useT();
  const [map, setMap] = useState(null);
  const [pinged, setPinged] = useState(null);

  useEffect(() => {
    portalApi('/map').then(setMap).catch(() => {});
  }, []);

  // Le monde est en mètres autour du centre de la ville : on ramène tout dans le carré du dessin.
  const project = useMemo(() => {
    if (!map) return null;
    const span = (map.radius + 40) * 2;
    return (x, z) => ({
      x: SIZE / 2 + ((x - map.center[0]) / span) * SIZE,
      y: SIZE / 2 - ((z - map.center[1]) / span) * SIZE,
    });
  }, [map]);

  if (!map || !project) return null;
  const wall = (map.radius / ((map.radius + 40) * 2)) * SIZE;
  const me = live?.online && live.position ? project(live.position.x, live.position.z) : null;
  const npcs = (live?.npcs || []).map((npc) => ({ ...npc, ...project(npc.x, npc.z) }));

  const ping = async (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * SIZE;
    const py = ((event.clientY - box.top) / box.height) * SIZE;
    const span = (map.radius + 40) * 2;
    const world = {
      x: Math.round(map.center[0] + ((px - SIZE / 2) / SIZE) * span),
      z: Math.round(map.center[1] - ((py - SIZE / 2) / SIZE) * span),
    };
    setPinged(world);
    await portalApi('/ping', { method: 'POST', body: world }).catch(() => {});
  };

  return (
    <section className="rounded-xl border border-ink-800 bg-ink-900/70 p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="font-serif text-base text-ink-100">{map.name}</h3>
        <span className="text-xs text-ink-500">{t('touche la carte pour la marquer en jeu')}</span>
      </header>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full touch-manipulation" onClick={ping}>
        <defs>
          <radialGradient id="ground">
            <stop offset="0%" stopColor="#1a1f28" />
            <stop offset="100%" stopColor="#0f1217" />
          </radialGradient>
        </defs>
        <rect width={SIZE} height={SIZE} fill="url(#ground)" rx="12" />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={wall} fill="#141820" stroke="#8f5a17" strokeWidth="2" />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={wall * 0.62} fill="none" stroke="#252b36" strokeWidth="1" />
        {map.arena &&
          (() => {
            const at = project(map.arena.x, map.arena.z);
            return <circle cx={at.x} cy={at.y} r={(map.arena.radius / ((map.radius + 40) * 2)) * SIZE} fill="none" stroke="#c47d1f" strokeWidth="1.5" />;
          })()}
        {map.places.map((place) => {
          const at = project(place.x, place.z);
          return (
            <g key={place.key}>
              <circle cx={at.x} cy={at.y} r={place.gate ? 3 : place.major ? 2.6 : 1.6} fill={place.gate ? '#e39b35' : place.major ? '#8a93a3' : '#353d4a'} />
              {place.major && (
                <text x={at.x + 4} y={at.y + 2.5} fontSize="7" fill="#aab2bf">
                  {place.label.replace(/^(le |la |les |l’|the )/i, '')}
                </text>
              )}
            </g>
          );
        })}
        {npcs.map((npc) => (
          <g
            key={npc.key}
            onClick={(event) => {
              event.stopPropagation();
              onTalk(npc.key);
            }}
            className="cursor-pointer"
          >
            <circle cx={npc.x} cy={npc.y} r="3.4" fill={npc.dead ? '#d9534a' : '#7cc38a'} stroke="#0f1217" strokeWidth="0.8" />
          </g>
        ))}
        {pinged &&
          (() => {
            const at = project(pinged.x, pinged.z);
            return <circle cx={at.x} cy={at.y} r="5" fill="none" stroke="#f0b458" strokeWidth="1.5" />;
          })()}
        {me && (
          <g>
            <circle cx={me.x} cy={me.y} r="5" fill="#45a9bf" stroke="#0f1217" strokeWidth="1" />
            <circle cx={me.x} cy={me.y} r="9" fill="none" stroke="#45a9bf" strokeWidth="0.8" opacity="0.5" />
          </g>
        )}
      </svg>
      <p className={cx('mt-2 text-xs', me ? 'text-ink-500' : 'text-ink-600')}>
        {me ? t('Le point bleu, c’est toi. Les verts, les habitants — touche-les pour leur parler.') : t('Connecte-toi pour te voir sur la carte.')}
      </p>
    </section>
  );
}
