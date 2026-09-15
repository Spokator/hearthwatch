import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ChevronDown, Crosshair, Eye, EyeOff, Layers, LoaderCircle, Map as MapIcon, Users } from 'lucide-react';
import { useApi } from '../api.js';
import { usePrefabLabels } from '../components.jsx';
import { useT } from '../i18n.jsx';
import { PageHeader } from '../status.jsx';
import { Badge, Button, Card, Empty, cx } from '../ui.jsx';

const ORES = {
  CopperOre: ['Cuivre', '#d0773a'],
  TinOre: ['Étain', '#b8c4cc'],
  IronScrap: ['Fer (ferraille)', '#9a7462'],
  SilverOre: ['Argent', '#eef3f8'],
  Obsidian: ['Obsidienne', '#7c5cc4'],
  Crystal: ['Cristal', '#9fdcff'],
  BlackMetalScrap: ['Métal noir', '#6b7280'],
  Softtissue: ['Tissu mou', '#e08fb8'],
  CopperScrap: ['Cuivre (ferraille)', '#c0703a'],
};
const oreInfo = (item) => ORES[item] || (item.startsWith('Flametal') ? ['Flametal', '#ff6a1a'] : [item, '#eab308']);

const LOCATIONS = [
  [/^Eikthyrnir/, 'boss', 'Autel d’Eikthyr'],
  [/^GDKing/, 'boss', 'L’Ancien'],
  [/^Bonemass/, 'boss', 'Bonemass'],
  [/^Dragonqueen/, 'boss', 'Moder'],
  [/^GoblinKing/, 'boss', 'Yagluth'],
  [/^Mistlands_DvergrBossEntrance/, 'boss', 'La Reine'],
  [/^FaderLocation/, 'boss', 'Fader'],
  [/^StartTemple/, 'boss', 'Pierre de départ'],
  [/^Vendor_BlackForest/, 'trader', 'Haldor (marchand)'],
  [/^Hildir_camp/, 'trader', 'Hildir (marchande)'],
  [/^BogWitch_Camp/, 'trader', 'La sorcière des marais'],
  [/^SunkenCrypt/, 'dungeon', 'Crypte engloutie'],
  [/^Crypt\d/, 'dungeon', 'Crypte'],
  [/^TrollCave/, 'dungeon', 'Grotte de troll'],
  [/^MountainCave/, 'dungeon', 'Caverne gelée'],
  [/^Mistlands_DvergrTownEntrance/, 'dungeon', 'Mine infestée'],
  [/^CharredFortress/, 'dungeon', 'Forteresse carbonisée'],
  [/^MorgenHole/, 'dungeon', 'Trou de Morgen'],
];
const LOCATION_STYLE = { boss: ['💀', 'Boss'], trader: ['💰', 'Marchands'], dungeon: ['🕳️', 'Donjons'] };
const classifyLocation = (prefab) => {
  const hit = LOCATIONS.find(([re]) => re.test(prefab));
  return hit ? { category: hit[1], label: hit[2] } : null;
};

const DEFAULT_LAYERS = { players: true, creatures: true, bosses: true, ores: true, pickables: false, locations: true, portals: true, tombstones: true, builds: true, vehicles: true };

const emojiIcon = (emoji, size = 20) => L.divIcon({ className: 'map-emoji', html: emoji, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const latLng = (x, z) => [z, x];

function loadSettings() {
  try {
    return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem('panel.map.layers') || '{}') };
  } catch {
    return DEFAULT_LAYERS;
  }
}

export default function MapPage() {
  const t = useT();
  const { data: statusData, reload: reloadStatus } = useApi('/map/status', { interval: 10000 });
  const status = statusData?.status;
  const canSpoil = statusData?.spoilers;
  const ready = !!status?.done;

  const [explored, setExplored] = useState(true);
  const view = canSpoil && !explored ? 'full' : 'explored';
  const query = `?view=${view}`;

  const live = useApi(ready ? `/map/live${query}` : null, { interval: 2000, enabled: ready });
  const world = useApi(ready ? `/map/world${query}` : null, { interval: 30000, enabled: ready });
  const labels = usePrefabLabels();

  const [layers, setLayers] = useState(loadSettings);
  // Les donjons se comptent par centaines en vue complète : masqués par défaut.
  const [hiddenTypes, setHiddenTypes] = useState(() => new Set(['loc:dungeon']));
  const [panelOpen, setPanelOpen] = useState(true);
  const [cursor, setCursor] = useState(null);

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const groups = useRef({});
  const imageRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('panel.map.layers', JSON.stringify(layers));
    } catch {}
  }, [layers]);

  // Création de la carte.
  useEffect(() => {
    if (!ready || mapRef.current || !mapEl.current) return;
    const extent = (status.size * status.pixelSize) / 2;
    const map = L.map(mapEl.current, { crs: L.CRS.Simple, minZoom: -5, maxZoom: 3, zoomSnap: 0.25, preferCanvas: true, attributionControl: false });
    map.fitBounds([
      [-extent, -extent],
      [extent, extent],
    ]);
    map.on('mousemove', (e) => setCursor({ x: Math.round(e.latlng.lng), z: Math.round(e.latlng.lat) }));
    map.on('mouseout', () => setCursor(null));
    for (const name of Object.keys(DEFAULT_LAYERS)) groups.current[name] = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      imageRef.current = null;
    };
  }, [ready, status?.size, status?.pixelSize]);

  // Image du monde (rechargée régulièrement pour suivre l'exploration).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const extent = (status.size * status.pixelSize) / 2;
    const load = () => {
      const url = `/api/map/image${query}&t=${Math.floor(Date.now() / 60000)}`;
      if (imageRef.current) imageRef.current.setUrl(url);
      else
        imageRef.current = L.imageOverlay(url, [
          [-extent, -extent],
          [extent, extent],
        ])
          .addTo(map)
          .bringToBack();
    };
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [ready, query, status?.size, status?.pixelSize]);

  // Couches du monde : ressources, lieux, portails, tombes, constructions.
  useEffect(() => {
    const g = groups.current;
    const data = world.data;
    if (!mapRef.current || !data) return;
    for (const key of ['ores', 'pickables', 'locations', 'portals', 'tombstones', 'builds']) g[key].clearLayers();

    data.resources.forEach(([type, x, z]) => {
      const info = data.resourceTypes[type];
      if (!info || hiddenTypes.has(`${info.kind}:${info.item}`)) return;
      if (info.kind === 'ore') {
        if (!layers.ores) return;
        const [label, color] = oreInfo(info.item);
        L.circleMarker(latLng(x, z), { radius: 4, color: '#111', weight: 1, fillColor: color, fillOpacity: 0.95 })
          .bindTooltip(t(label), { className: 'map-tip' })
          .addTo(g.ores);
      } else if (layers.pickables) {
        L.circleMarker(latLng(x, z), { radius: 2.5, stroke: false, fillColor: '#f472b6', fillOpacity: 0.85 })
          .bindTooltip(labels.get(info.item) || info.item, { className: 'map-tip' })
          .addTo(g.pickables);
      }
    });

    if (layers.locations) {
      data.locations.forEach(([prefab, x, z]) => {
        const info = classifyLocation(prefab);
        if (!info || hiddenTypes.has(`loc:${info.category}`)) return;
        L.marker(latLng(x, z), { icon: emojiIcon(LOCATION_STYLE[info.category][0], 22) })
          .bindTooltip(t(info.label), { className: 'map-tip' })
          .addTo(g.locations);
      });
    }
    if (layers.portals) {
      data.portals.forEach((p) =>
        L.marker(latLng(p.x, p.z), { icon: emojiIcon('🌀') })
          .bindTooltip(p.tag ? t('Portail « {tag} »', { tag: p.tag }) : t('Portail sans nom'), { className: 'map-tip' })
          .addTo(g.portals),
      );
    }
    if (layers.tombstones) {
      data.tombstones.forEach((stone) =>
        L.marker(latLng(stone.x, stone.z), { icon: emojiIcon('🪦') })
          .bindTooltip(t('Tombe de {name}', { name: stone.owner || '?' }), { className: 'map-tip' })
          .addTo(g.tombstones),
      );
    }
    if (layers.builds) {
      data.builds.forEach(([cx, cz, count]) =>
        L.rectangle(
          [
            [cz * 32, cx * 32],
            [cz * 32 + 32, cx * 32 + 32],
          ],
          { stroke: false, fillColor: '#f0b458', fillOpacity: Math.min(0.25 + count / 60, 0.8), interactive: false },
        ).addTo(g.builds),
      );
    }
  }, [world.data, layers, hiddenTypes, labels, t]);

  // Couches en direct : joueurs, créatures, véhicules.
  useEffect(() => {
    const g = groups.current;
    const data = live.data;
    if (!mapRef.current || !data) return;
    for (const key of ['players', 'creatures', 'bosses', 'vehicles']) g[key].clearLayers();

    data.creatures.forEach(([type, x, z, level, tamed]) => {
      const info = data.creatureTypes[type];
      if (!info) return;
      const boss = info.boss;
      if (boss ? !layers.bosses : !layers.creatures || hiddenTypes.has(`creature:${info.name}`)) return;
      const stars = level > 1 ? ` ${'★'.repeat(level - 1)}` : '';
      const label = `${labels.get(info.name) || info.name}${stars}${tamed ? t(' (apprivoisé)') : ''}`;
      L.circleMarker(latLng(x, z), {
        radius: boss ? 8 : level > 1 ? 4.5 : 3.5,
        color: '#000',
        weight: 1,
        fillColor: boss ? '#ef4444' : tamed ? '#4ade80' : level > 1 ? '#fb923c' : '#fca5a5',
        fillOpacity: 0.95,
      })
        .bindTooltip(label, { className: 'map-tip' })
        .addTo(boss ? g.bosses : g.creatures);
    });

    if (layers.vehicles) {
      data.vehicles.forEach((v) =>
        L.marker(latLng(v.x, v.z), { icon: emojiIcon(/cart/i.test(v.prefab) ? '🛒' : '⛵') })
          .bindTooltip(labels.get(v.prefab) || v.prefab, { className: 'map-tip' })
          .addTo(g.vehicles),
      );
    }
    if (layers.players) {
      data.players.forEach((p) => {
        L.circleMarker(latLng(p.x, p.z), { radius: 7, color: '#0b0d10', weight: 2, fillColor: '#38bdf8', fillOpacity: 1 })
          .bindTooltip(p.name, { permanent: true, direction: 'top', offset: [0, -8], className: 'map-label' })
          .addTo(g.players);
      });
    }
  }, [live.data, layers, hiddenTypes, labels, t]);

  const counts = useMemo(() => {
    const w = world.data;
    const l = live.data;
    const c = {
      players: l?.players.length ?? 0,
      creatures: 0,
      bosses: 0,
      vehicles: l?.vehicles.length ?? 0,
      ores: 0,
      pickables: 0,
      locations: 0,
      portals: w?.portals.length ?? 0,
      tombstones: w?.tombstones.length ?? 0,
      builds: w?.builds.length ?? 0,
    };
    l?.creatures.forEach(([type]) => (l.creatureTypes[type]?.boss ? c.bosses++ : c.creatures++));
    w?.resources.forEach(([type]) => (w.resourceTypes[type]?.kind === 'ore' ? c.ores++ : c.pickables++));
    w?.locations.forEach(([p]) => classifyLocation(p) && c.locations++);
    return c;
  }, [world.data, live.data]);

  // Sous-types pour filtrer finement (minerais, cueillettes).
  const subTypes = useMemo(() => {
    const w = world.data;
    if (!w) return { ores: [], pickables: [] };
    const tally = new Map();
    w.resources.forEach(([type]) => tally.set(type, (tally.get(type) || 0) + 1));
    const list = [...tally.entries()].map(([type, n]) => ({ ...w.resourceTypes[type], n }));
    return {
      ores: list.filter((r) => r.kind === 'ore').sort((a, b) => b.n - a.n),
      pickables: list.filter((r) => r.kind === 'pickable').sort((a, b) => b.n - a.n),
    };
  }, [world.data]);

  const toggle = (key) => setLayers((l) => ({ ...l, [key]: !l[key] }));
  const toggleType = (key) =>
    setHiddenTypes((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const focus = (p) => mapRef.current?.flyTo(latLng(p.x, p.z), 1, { duration: 0.8 });

  if (!statusData) return null;

  return (
    <>
      <PageHeader
        title={t('Carte en direct')}
        description={t(canSpoil ? 'Vue complète du monde. Les autres rôles ne voient que les zones explorées.' : 'Les zones explorées par les joueurs, en temps réel.')}
        actions={
          canSpoil &&
          ready && (
            <Button icon={explored ? Eye : EyeOff} onClick={() => setExplored((v) => !v)}>
              {t(explored ? 'Vue joueurs (zones explorées)' : 'Vue complète (spoilers)')}
            </Button>
          )
        }
      />

      {!status ? (
        <Card>
          <Empty icon={MapIcon} title={t('Plugin de carte non détecté')}>
            {t("Le plugin HearthwatchBridge n'a encore rien exporté. Il doit être installé sur le serveur, qui doit avoir redémarré depuis.")}
          </Empty>
        </Card>
      ) : !ready ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <LoaderCircle className="size-8 animate-spin text-ember-400" />
            <div className="text-sm text-ink-200">{t('Génération de la carte du monde « {name} »…', { name: status.world })}</div>
            <div className="h-2 w-64 overflow-hidden rounded-full bg-ink-800">
              <div className="h-full bg-ember-500 transition-all" style={{ width: `${Math.round(status.progress * 100)}%` }} />
            </div>
            <div className="text-xs text-ink-500">{t('{p} % — le serveur reste jouable pendant le calcul.', { p: Math.round(status.progress * 100) })}</div>
            <Button size="sm" variant="ghost" onClick={reloadStatus}>
              {t('Actualiser')}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-ink-800">
          <div ref={mapEl} className="h-[calc(100vh-13rem)] min-h-[28rem] w-full" />

          {cursor && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-md bg-ink-950/85 px-2 py-1 font-mono text-xs text-ink-300">
              X {cursor.x} · Z {cursor.z}
            </div>
          )}

          <div className="absolute right-3 top-3 z-[500] w-64 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-ink-700 bg-ink-900/95 shadow-2xl backdrop-blur">
            <button onClick={() => setPanelOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-ink-100">
              <span className="flex items-center gap-2">
                <Layers className="size-4 text-ember-400" /> {t('Couches')}
              </span>
              <ChevronDown className={cx('size-4 transition', panelOpen && 'rotate-180')} />
            </button>
            {panelOpen && (
              <div className="max-h-[calc(100vh-20rem)] space-y-3 overflow-y-auto border-t border-ink-800 px-3 py-3">
                <LayerToggle label={t('Joueurs')} color="#38bdf8" count={counts.players} checked={layers.players} onChange={() => toggle('players')} />
                <LayerToggle label={t('Boss')} color="#ef4444" count={counts.bosses} checked={layers.bosses} onChange={() => toggle('bosses')} />
                <LayerToggle label={t('Créatures')} color="#fca5a5" count={counts.creatures} checked={layers.creatures} onChange={() => toggle('creatures')} />
                <LayerToggle label={t('Minerais')} color="#d0773a" count={counts.ores} checked={layers.ores} onChange={() => toggle('ores')}>
                  {subTypes.ores.map((o) => {
                    const [label, color] = oreInfo(o.item);
                    return <SubToggle key={o.item} label={t(label)} color={color} count={o.n} checked={!hiddenTypes.has(`ore:${o.item}`)} onChange={() => toggleType(`ore:${o.item}`)} />;
                  })}
                </LayerToggle>
                <LayerToggle label={t('Cueillettes')} color="#f472b6" count={counts.pickables} checked={layers.pickables} onChange={() => toggle('pickables')}>
                  {subTypes.pickables.map((p) => (
                    <SubToggle
                      key={p.item}
                      label={labels.get(p.item) || p.item}
                      color="#f472b6"
                      count={p.n}
                      checked={!hiddenTypes.has(`pickable:${p.item}`)}
                      onChange={() => toggleType(`pickable:${p.item}`)}
                    />
                  ))}
                </LayerToggle>
                <LayerToggle label={t('Lieux')} emoji="💀" count={counts.locations} checked={layers.locations} onChange={() => toggle('locations')}>
                  {Object.entries(LOCATION_STYLE).map(([key, [emoji, label]]) => (
                    <SubToggle key={key} label={`${emoji} ${t(label)}`} checked={!hiddenTypes.has(`loc:${key}`)} onChange={() => toggleType(`loc:${key}`)} />
                  ))}
                </LayerToggle>
                <LayerToggle label={t('Portails')} emoji="🌀" count={counts.portals} checked={layers.portals} onChange={() => toggle('portals')} />
                <LayerToggle label={t('Tombes')} emoji="🪦" count={counts.tombstones} checked={layers.tombstones} onChange={() => toggle('tombstones')} />
                <LayerToggle label={t('Bateaux & chariots')} emoji="⛵" count={counts.vehicles} checked={layers.vehicles} onChange={() => toggle('vehicles')} />
                <LayerToggle label={t('Constructions')} color="#f0b458" count={counts.builds} checked={layers.builds} onChange={() => toggle('builds')} />

                {live.data?.players.length > 0 && (
                  <div className="border-t border-ink-800 pt-3">
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-ink-500">
                      <Users className="size-3.5" /> {t('Aller à')}
                    </div>
                    <div className="space-y-1">
                      {live.data.players.map((p) => (
                        <button key={p.id || p.name} onClick={() => focus(p)} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-ink-200 hover:bg-ink-800">
                          <span className="truncate">{p.name}</span>
                          <Crosshair className="size-3.5 text-ink-500" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {view === 'full' && (
            <div className="pointer-events-none absolute left-14 top-3 z-[500]">
              <Badge tone="red">{t('Vue complète : spoilers visibles')}</Badge>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function LayerToggle({ label, color, emoji, count, checked, onChange, children }) {
  return (
    <div>
      <label className="flex cursor-pointer items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <input type="checkbox" checked={checked} onChange={onChange} className="accent-ember-500" />
          {emoji ? <span className="text-sm leading-none">{emoji}</span> : <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />}
          <span className="truncate text-ink-200">{label}</span>
        </span>
        <span className="text-xs tabular-nums text-ink-500">{count}</span>
      </label>
      {checked && children && <div className="ml-6 mt-1.5 space-y-1">{children}</div>}
    </div>
  );
}

function SubToggle({ label, color, count, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
      <span className="flex min-w-0 items-center gap-1.5">
        <input type="checkbox" checked={checked} onChange={onChange} className="accent-ember-500" />
        {color && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />}
        <span className="truncate text-ink-300">{label}</span>
      </span>
      {count != null && <span className="tabular-nums text-ink-600">{count}</span>}
    </label>
  );
}
