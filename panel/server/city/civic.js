// Grands bâtiments de la ville : château, église, armurerie-musée, brasserie, marché couvert, entrepôt de la fonderie,
// arène. Même conventions que buildings.js : repère local dont le +Z est la façade, sol de la ville à LEVEL.
// Chaque bâtiment exporte son emprise : demi-largeur (hw), demi-profondeur (hd) et centre local (ox, oz).

import { DEG } from './layout.js';
import { armToward, foundation, gableRoof, kneeBraces, lampPost, LEVEL, lowFence, planks, railing, ringPut, squareRoof, truss, wallLight } from './buildings.js';
import { Room } from './furniture.js';

const lock = true;

// Rangées de murs le long de X (de x0 à x1, pas de `size`) : `rows` = [[pièce, bas]], `skip(a, bas)` pour les ouvertures.
function wallRun(f, x0, x1, z, size, rows, skip = null, rot = 0) {
  for (let a = x0 + size / 2; a < x1; a += size)
    for (const [piece, y] of rows) if (!skip?.(a, y)) f.put(piece, a, z, y, rot);
}

// Tour de pierre carrée (murs de 1 m, intérieur 8 × 8) à escalier tournant le long des murs jusqu'à une terrasse
// couverte en `top` (F + multiple de 2) ; porte sur la face +Z du repère donné.
export function stairTower(f0, cx, cz, top, { banner = 'piece_banner07' } = {}) {
  const f = f0.sub(cx, cz);
  const F = LEVEL;
  const rows = [];
  for (let y = 0; y < top + 1; y += 2) rows.push(y);
  // Murs : face arrière -Z, droite +X, avant +Z (porte), gauche -X ; chaque face couvre -5..5.
  for (const r of [0, 90, 180, 270]) {
    const g = f.sub(0, 0, r);
    const front = r === 180;
    for (const y of rows) {
      g.put('stone_wall_4x2', -3, -4.5, y, 0);
      if (!front) {
        g.put('stone_wall_4x2', 1, -4.5, y, 0);
        g.put('stone_wall_2x1', 4, -4.5, y, 0);
        g.put('stone_wall_2x1', 4, -4.5, y + 1, 0);
      } else {
        g.put('stone_wall_4x2', 3, -4.5, y, 0);
        for (const h of [y, y + 1]) if (h < F || h > F + 1) g.put('stone_wall_2x1', 0, -4.5, h, 0);
      }
    }
  }
  f.put('wood_door', 0, 4.5, F, 0);
  // Escalier : volées de deux marches le long des murs, paliers aux angles, jusqu'à la terrasse.
  const flights = [
    { steps: [[-1, -3], [1, -3]], rot: 270, landing: [3, -3] },
    { steps: [[3, -1], [3, 1]], rot: 180, landing: [3, 3] },
    { steps: [[1, 3], [-1, 3]], rot: 90, landing: [-3, 3] },
    { steps: [[-3, 1], [-3, -1]], rot: 0, landing: [-3, -3] },
  ];
  let y = F;
  let last = null;
  for (let k = 0; y < F + top - 1; k++) {
    const fl = flights[k % 4];
    fl.steps.forEach(([a, b], i) => f.put('wood_stair', a, b, y + i, fl.rot));
    y += 2;
    if (y < F + top - 1) f.put('wood_floor', fl.landing[0], fl.landing[1], y, 0);
    last = fl;
  }
  // Terrasse : plancher sauf au-dessus de la dernière volée, créneaux, toit sur poteaux.
  for (const a of [-3, -1, 1, 3]) for (const b of [-3, -1, 1, 3]) if (!last.steps.some(([p, q]) => p === a && q === b)) f.put('wood_floor', a, b, y, 0);
  for (const [a, b] of [[-3.8, -3.8], [3.8, -3.8], [3.8, 3.8], [-3.8, 3.8]]) f.put('darkwood_pole4', a, b, y, 0);
  squareRoof(f, 0, 0, 5, y + 4);
  for (const r of [0, 90, 180, 270]) {
    const g = f.sub(0, 0, r);
    for (const a of [-2, 2]) g.put('stone_wall_1x1', a, -4.5, top + 2, 0);
    g.put(banner, 0, -5.12, top - 1.5, 90, { pivot: true });
  }
  f.put('piece_dvergr_lantern', 0, -3.9, F + 2.9, 270, { pivot: true });
  f.put('piece_dvergr_lantern', 0, 5.1, F + 2.8, 90, { pivot: true });
  return y;
}

// ---------- Château ----------

export const castleRect = ({ W, D }) => ({ hw: W / 2 + 11, hd: D / 2 + 4, ox: 0, oz: -(D - 6) / 2 });

// Château impérial : rez-de-chaussée de pierre de 6 m (salle du trône à colonnes de pierre, estrade, trophées des
// grands ennemis, escalier d'honneur), étage de 4 m (grand salon, deux chambres, réserve), immense toit à dragons,
// portique d'entrée, quatre tours accessibles. Repère : façade vers -Z du monde (vers la grand-place) ; en local la
// façade est en z = 0 et le bâtiment s'étend vers -Z.
export function castle(L, x, z, { W, D, throne, palace, trophies = [], texts = {} }) {
  const f = L.frame(x, z, 180);
  const F = LEVEL;
  const G = 6;
  const U = F + G;
  const w2 = W / 2;
  const random = mulberry(W * 31 + D);
  const stairX = w2 - 1.5;

  // Rez-de-chaussée : trois rangs de blocs de pierre, fenêtres au rang du milieu, grande porte.
  const windowBay = (a) => Math.abs(a) % 8 === 6;
  wallRun(f, -w2, w2, 0, 4, [['stone_wall_4x2', F], ['stone_wall_4x2', F + 2], ['stone_wall_4x2', F + 4]], (a, y) => (Math.abs(a) < 3 && y === F) || (windowBay(a) && y === F + 2));
  wallRun(f, -w2, w2, -D, 4, [['stone_wall_4x2', F], ['stone_wall_4x2', F + 2], ['stone_wall_4x2', F + 4]], (a, y) => windowBay(a) && y === F + 2);
  for (const a of [-w2, w2]) {
    const g = f.sub(a, 0, 90);
    wallRun(g, 0, D, 0, 4, [['stone_wall_4x2', F], ['stone_wall_4x2', F + 2], ['stone_wall_4x2', F + 4]], (b, y) => b % 8 === 6 && y === F + 2 && b > 16);
  }
  for (let a = -w2 + 2; a < w2; a += 4) {
    if (windowBay(a)) {
      f.put('Piece_grausten_window_4x2', a, 0, F + 2, 0);
      f.put('Piece_grausten_window_4x2', a, -D, F + 2, 0);
    }
  }
  for (const a of [-w2, w2]) for (let b = 22; b < D; b += 8) f.sub(a, 0, 90).put('Piece_grausten_window_4x2', b, 0, F + 2, 0);
  for (const a of [-1, 1]) f.put('wood_door', a, 0, F, 0);

  // Portique : colonnes de pierre, linteaux, toit à pignon et dragon.
  for (const a of [-5.5, 5.5]) {
    for (const h of [F, F + 2, F + 4]) f.put('stone_pillar', a, 5.5, h, 0);
    f.put('darkwood_beam4x4', a, 3, U - 0.45, 90);
  }
  for (const a of [-4, 0, 4]) f.put('darkwood_beam4x4', a, 5.5, U - 0.45, 0);
  gableRoof(f.sub(0, 3, 90), { width: 12, length: 6, eave: U, gables: 'neg', dragons: 'neg' });
  f.put('sign', 0, 0.62, F + 4.3, 0, { pivot: true, text: palace });
  for (const a of [-3, 3]) f.put('piece_banner02', a, 0.62, F + 5.4, 90, { pivot: true });
  for (const a of [-7.5, 7.5]) f.put('piece_brazierfloor01', a, 7, F, 0);

  // Salle du trône : colonnes de pierre, poutres, tapis, estrade, trône, bannières, trophées.
  for (let b = -6; b > -D + 4; b -= 6)
    for (const a of [-8, 8]) {
      for (const h of [F, F + 2, F + 4]) f.put('stone_pillar', a, b, h, 0);
      f.put('piece_dvergr_lantern', a + (a < 0 ? 0.52 : -0.52), b, F + 4, a < 0 ? 180 : 0, { pivot: true });
    }
  for (let b = -2; b > -D; b -= 4) for (const a of [-8, 8]) f.put('darkwood_beam4x4', a, b, U - 0.45, 90);
  for (let a = -w2 + 2; a < w2; a += 4) for (let b = -6; b > -D + 4; b -= 12) f.put('darkwood_beam4x4', a, b, U - 0.45, 0);
  for (let b = -3.5; b > -D + 10; b -= 3) f.put('jute_carpet_blue', 0, b, F, 0);
  foundation(f, -6, -D + 2, 6, -D + 8, F);
  for (const a of [-3, -1, 1, 3]) f.put('stone_stair', a, -D + 9, F, 0);
  f.put('piece_blackmarble_throne', 0, -D + 4.5, F + 1, 0);
  f.put('rug_Bjorn', 0, -D + 6.5, F + 1, 0);
  for (const a of [-5, 5]) f.put('piece_brazierfloor01', a, -D + 7.3, F + 1, 0);
  f.put('darkwood_pole', 5.3, -D + 9.6, F, 0);
  f.put('sign', 5.3, -D + 9.84, F + 1.4, 0, { pivot: true, text: throne });
  for (const a of [-9, -3, 3, 9]) f.put(a % 6 ? 'piece_banner02' : 'piece_banner07', a, -D + 0.62, F + 5.2, 90, { pivot: true });
  // Trophées des grands ennemis sur les murs de la salle, avec leur nom.
  const spots = [];
  for (const b of [-8, -12, -16, -26, -34]) if (b > -D + 4) spots.push([-w2 + 0.55, b, 90]);
  for (const b of [-26, -34]) if (b > -D + 4) spots.push([w2 - 0.55, b, 270]);
  trophies.slice(0, spots.length).forEach((t, i) => {
    const [a, b, r] = spots[i];
    f.put('itemstand', a, b, F + 2.6, r, { pivot: true, data: { ints: { item: t.name }, lock } });
    f.put('sign', a, b, F + 1.9, r, { pivot: true, text: t.label });
  });
  for (let b = -4; b > -D + 2; b -= 12) for (const a of [-w2 + 0.5, w2 - 0.5]) if (!(a > 0 && b > -18)) wallLight(f, a, b, F + 1.2, a < 0 ? 1 : -1, 0, true);

  // Escalier d'honneur le long du mur droit : six marches jusqu'à l'étage.
  for (let s = 0; s < 6; s++) f.put('wood_stair', stairX, -4 - 2 * s, F + s, 0);
  const hole = (a, b) => a > w2 - 4 && b > -16 && b < -2;

  // Étage : plancher, murs de bois sur la pierre, fenêtres, cloisons, portes.
  planks(f, -w2, -D, w2, 0, U, hole);
  railing(f.sub(w2 - 4, 0, 90), 2, 16, 0, U);
  const upperRows = (g, x0, x1, zz, doors = [], windows = true) => {
    for (let a = x0 + 1; a < x1; a += 2) {
      const door = doors.some((d) => Math.abs(d - a) < 0.1);
      if (door) f.put('wood_door', ...g(a, zz), U, gRot(g));
      else if (Math.abs(a) % 6 === 3 && windows) {
        const [px, pz] = g(a, zz);
        const rot = gRot(g);
        f.sub(px, pz, rot).put('darkwood_decowall', -0.5, 0, U, 0);
        f.sub(px, pz, rot).put('darkwood_decowall', 0.5, 0, U, 0);
      } else f.put('woodwall', ...g(a, zz), U, gRot(g));
      f.put('woodwall', ...g(a, zz), U + 2, gRot(g));
    }
  };
  const alongX = (a, zz) => [a, zz];
  alongX.rot = 0;
  const alongZ = (b, xx) => [xx, -b];
  alongZ.rot = 90;
  const gRot = (g) => g.rot;
  upperRows(alongX, -w2, w2, 0);
  upperRows(alongX, -w2, w2, -D);
  upperRows(alongZ, 0, D, -w2);
  upperRows(alongZ, 0, D, w2);
  upperRows(alongX, -w2, w2, -20, [-9, 1, 9], false);
  upperRows(alongZ, 20, D, -4, [], false);
  upperRows(alongZ, 20, D, 4, [], false);
  for (let a = -w2; a <= w2; a += 4) for (const b of [0, -D]) f.put('wood_pole_log_4', a, b + (b === 0 ? 0.62 : -0.62), U, 0);

  // Toit et fermes.
  const roofFrame = f.sub(0, -D / 2, 90);
  gableRoof(roofFrame, { width: W, length: D, eave: U + 4, gables: 'both', dragons: true, overhang: 1 });
  for (let a = -D / 2 + 4; a < D / 2; a += 8) truss(roofFrame, a, 0, W, U + 4);
  for (const a of [-w2 + 1, w2 - 1]) for (let b = -2; b > -D; b -= 8) f.put('wood_pole_log_4', a < 0 ? -w2 - 0.62 : w2 + 0.62, b, U, 0);

  // Grand salon (avant), chambres et réserve (arrière).
  const salon = new Room(f, -w2 + 0.4, -20 + 0.4, w2 - 0.4, -0.4, U, { random, surface: 0.25 });
  salon.block(w2 - 6, -18, w2, 0);
  salon.center('hearth', 0, { margin: 1.2, fz: 0.5 });
  salon.center('rug_Bjorn', 0, { free: true, fz: 0.25, fx: 0.5 });
  for (const [dx, r] of [[-3.5, 90], [3.5, 270]]) salon.place('piece_moose_throne', salon.x0 + salon.width / 2 + dx, -10, r);
  salon.dining('piece_table_oak', 'piece_bench01', 4, { fx: 0.25, fz: 0.5, food: ['HoneyGlazedChicken', 'MeadTasty', 'Bread'], top: 0.79 });
  salon.dining('piece_table_round', 'piece_chair03', 4, { fx: 0.75, fz: 0.75, food: ['Candle_resin'] });
  salon.wall('piece_chest_warderobe', 'front', 0.1);
  for (const side of ['back', 'left']) salon.hang('piece_banner07', side, 2.9, { turn: 90, inset: 0.3 });
  salon.hang('piece_banner02', 'back', 2.9, { turn: 90, inset: 0.3 });
  for (const [a, b, dx] of [[-w2 + 0.3, -6, 1], [-w2 + 0.3, -15, 1], [0, -19.8, 0]]) wallLight(f, a, b, U - 0.8, dx, dx ? 0 : 1, true);

  const bedroom = (x0, x1, royal) => {
    const room = new Room(f, x0 + 0.4, -D + 0.4, x1 - 0.4, -20 - 0.4, U, { random, surface: 0.25, door: null });
    const doorX = x0 < 0 ? -9 : 9;
    room.block(doorX - 1, -22.8, doorX + 1, -20);
    room.center(royal ? 'rug_Bjorn' : 'rug_fur', 0, { free: true });
    room.wall('piece_bed02', 'back', 0.3);
    if (royal) room.wall('piece_bathtub', 'left', 0.5);
    else room.wall('piece_bed02', 'back', 0.75);
    room.wall('piece_chest_warderobe', 'right', 0.2);
    room.dining('piece_table_round', 'piece_chair02', 2, { fz: 0.7, food: ['Candle_resin'] });
    room.wall('piece_chest', 'front', 0.2);
    room.hang(royal ? 'piece_banner07' : 'piece_banner02', 'back', 2.9, { turn: 90, inset: 0.3 });
    wallLight(f, (x0 + x1) / 2, -D + 0.3, U - 0.8, 0, 1, true);
  };
  bedroom(-w2, -4, true);
  bedroom(4, w2, false);
  const store = new Room(f, -4 + 0.3, -D + 0.4, 4 - 0.3, -20.4, U, { random, surface: 0.15 });
  store.block(0, -22.8, 2, -20);
  for (const [piece, side, at] of [['piece_chest_blackmetal', 'back', 0.2], ['piece_chest_blackmetal', 'back', 0.8], ['piece_chest', 'left', 0.2], ['piece_chest', 'left', 0.5], ['piece_chest_barrel', 'right', 0.1], ['piece_chest_barrel', 'right', 0.2], ['piece_chest_barrel', 'right', 0.3], ['bar_gold_stack', 'left', 0.8], ['bar_silver_stack', 'left', 0.9], ['bar_iron_stack', 'right', 0.6], ['treasure_pile', 'right', 0.85], ['wood_core_stack', 'front', 0.2]])
    store.wall(piece, side, at);
  wallLight(f, 0, -D + 0.3, U - 0.8, 0, 1, true);

  // Tours d'angle accessibles.
  for (const a of [-1, 1]) {
    stairTower(f, a * (w2 + 5.5), -5.5, 20);
    stairTower(f, a * (w2 + 5.5), -D + 4.5, 20);
  }
  return {};
}

// ---------- Église ----------

export const churchRect = { hw: 8, hd: 23, ox: 0, oz: -10 };

// Église en bois debout : nef de 12 × 24 m (soubassement de pierre, murs de planches debout, poteaux et fermes
// apparentes), chœur, clocher-porche de pierre surmonté d'un beffroi de bois à toits étagés et dragons. Intérieur :
// entrée dégagée, bancs de part et d'autre de l'allée, estrade du prêtre (1 m) aux trois quarts de la nef avec autel,
// chœur à l'arrière. Repère : porte sur +Z (z = 8), nef vers -Z.
export function church(L, x, z, rot, { name, subtitle }) {
  const f = L.frame(x, z, rot);
  const F = LEVEL;
  const H = F + 5;
  const random = mulberry(97);
  // Nef.
  for (const a of [-6, 6]) {
    const g = f.sub(a, 0, 90);
    for (let b = 1; b < 24; b += 2) {
      g.put('stone_wall_2x1', b, 0, F, 0);
      g.put('stave_wall_2x2', b, 0, F + 1, 0);
      if (b % 6 === 5) {
        g.put('darkwood_decowall', b - 0.5, 0, F + 3, 0);
        g.put('darkwood_decowall', b + 0.5, 0, F + 3, 0);
      } else g.put('stave_wall_2x2', b, 0, F + 3, 0);
    }
  }
  for (let a = -5; a <= 5; a += 2) {
    const open = Math.abs(a) < 2;
    if (!open) {
      f.put('stone_wall_2x1', a, 0, F, 0);
      f.put('stave_wall_2x2', a, 0, F + 1, 0);
    }
    f.put('stave_wall_2x2', a, 0, F + 3, 0);
    // Mur du fond ouvert sur le chœur.
    if (Math.abs(a) > 4) {
      f.put('stone_wall_2x1', a, -24, F, 0);
      f.put('stave_wall_2x2', a, -24, F + 1, 0);
    }
    f.put('stave_wall_2x2', a, -24, F + 3, 0);
  }
  // Chœur.
  for (const a of [-4, 4]) {
    const g = f.sub(a, -24, 90);
    for (let b = 1; b < 8; b += 2) {
      g.put('stone_wall_2x1', b, 0, F, 0);
      g.put('stave_wall_2x2', b, 0, F + 1, 0);
      g.put('stave_wall_2x2', b, 0, F + 3, 0);
    }
  }
  for (let a = -3; a <= 3; a += 2) {
    f.put('stone_wall_2x1', a, -32, F, 0);
    f.put('stave_wall_2x2', a, -32, F + 1, 0);
    f.put('stave_wall_2x2', a, -32, F + 3, 0);
  }
  // Toits, fermes et poteaux.
  const nave = f.sub(0, -12, 90);
  gableRoof(nave, { width: 12, length: 24, eave: H, gables: 'both', dragons: true, overhang: 1 });
  for (let a = -8; a <= 8; a += 4) truss(nave, a, 0, 12, H);
  gableRoof(f.sub(0, -28, 90), { width: 8, length: 8, eave: H, gables: 'pos', dragons: 'pos' });
  for (let b = -4; b > -24; b -= 4)
    for (const a of [-5.45, 5.45]) {
      f.put('stave_pole_4m', a, b, F + 1, 0);
      kneeBraces(f, a, b, H - 0.45, true);
    }

  // Clocher-porche : 8 × 8, pierre jusqu'à 9 m, porte, fenêtres.
  const tf = f.sub(0, 4);
  for (const r of [0, 90, 270, 180]) {
    if (r === 0) continue; // le mur arrière est la façade de la nef
    const g = tf.sub(0, 0, r);
    for (let y = 0; y < 9; y++)
      for (const a of [-3, -1, 1, 3]) {
        const door = r === 180 && Math.abs(a) === 1 && y >= F && y < F + 2;
        const doorTop = r === 180 && Math.abs(a) === 1 && y === F + 2;
        const win = r !== 180 && Math.abs(a) === 1 && (y === 6 || y === 7);
        if (door || win) continue;
        if (doorTop) g.put('stone_wall_2x1', a, -4, y, 0);
        else g.put('stone_wall_2x1', a, -4, y, 0);
      }
    if (r !== 180) g.put('Piece_grausten_window_2x2', 0, -4, 6, 0);
  }
  tf.put('wood_door', 0, 4, F, 0);
  // Beffroi : plancher, poteaux, garde-corps, arcs, lanterne suspendue, toit à pans, flèche et dragons.
  planks(tf, -2, -2, 2, 2, 9);
  for (const [a, b] of [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]]) tf.put('darkwood_pole4', a, b, 9, 0);
  for (const r of [0, 90, 180, 270]) {
    const g = tf.sub(0, 0, r);
    g.put('wood_wall_half', 0, -1.85, 9, 0);
    g.put('darkwood_beam4x4', 0, -1.85, 12.55, 0);
    g.put('wood_dragon1', 0, -2.6, 12.6, 180, { pivot: true });
  }
  tf.put('piece_brazierceiling01', 0, 0, 10.9, 0);
  // Toit en jupe autour du beffroi, puis toit du beffroi et flèche.
  for (const [a, b, r] of [[1, 1, 0], [-1, 1, 270], [1, -1, 90], [-1, -1, 180]]) tf.put('darkwood_roof_ocorner_45', a * 3, b * 3, 9, r, { pivot: true });
  for (const t of [-1, 1]) {
    tf.put('darkwood_roof_45', t, 3, 10, 0, { pivot: true });
    tf.put('darkwood_roof_45', t, -3, 10, 180, { pivot: true });
    tf.put('darkwood_roof_45', 3, t, 10, 90, { pivot: true });
    tf.put('darkwood_roof_45', -3, t, 10, 270, { pivot: true });
  }
  const spire = squareRoof(tf, 0, 0, 2, 13, { finial: false });
  tf.put('wood_pole_log_4', 0, 0, spire, 0);
  tf.put('wood_pole_log', 0, 0, spire + 4, 0);
  tf.put('piece_banner07', 3.95 + 0.17, 0, 7.5, 0, { pivot: true });
  tf.put('piece_banner07', -4.12, 0, 7.5, 0, { pivot: true });

  // Intérieur : tapis d'allée, bancs, estrade, autel, statues, bannières, bougies, lumières.
  for (let b = -2.5; b > -15; b -= 3) f.put('jute_carpet_blue', 0, b, F, 0);
  for (const b of [-7.5, -9.5, -11.5, -13.5]) for (const a of [-3.3, 3.3]) f.put('piece_bench01', a, b, F, 180);
  foundation(f, -4, -22, 4, -16, F);
  for (const a of [-1, 1]) f.put('stone_stair', a, -15, F, 0);
  f.put('piece_blackmarble_table', 0, -19.2, F + 1, 0);
  for (const a of [-0.8, 0, 0.8]) f.put('Candle_resin', a, -19.2, F + 1.82, 0);
  f.put('piece_throne01', 0, -21.2, F + 1, 0);
  f.put('piece_table_runed_small', 3, -17, F + 1, 0);
  for (const a of [-3.4, 3.4]) f.put('piece_brazierfloor01', a, -21.3, F + 1, 0);
  for (const a of [-2, 2]) f.put(a < 0 ? 'StatueFreya' : 'StatueThor', a, -30.5, F, 0);
  f.put('piece_cloth_hanging_door_blue2', 0, -31.35, F + 2.2, 90, { pivot: true });
  for (const a of [-2.5, 2.5]) f.put('Candle_resin', a, -29.5, F, 0);
  for (const a of [-5.6, 5.6]) {
    f.put('piece_banner07', a, -18.5, F + 3.8, 0, { pivot: true });
    f.put('piece_banner02', a, -12, F + 3.8, 0, { pivot: true });
  }
  for (const b of [-6, -14, -22]) for (const a of [-5.5, 5.5]) wallLight(f, a, b, F, a < 0 ? 1 : -1, 0, true);
  for (const a of [-3.3, 3.3]) f.put('piece_pot2', a, -1.2, F, 0);
  void random;
  // Enseigne près du porche.
  f.put('darkwood_pole4', 5.5, 9.5, F, 0);
  f.put('sign', 5.5, 9.74, F + 2.4, 0, { pivot: true, text: name });
  if (subtitle) f.put('sign', 5.5, 9.74, F + 1.7, 0, { pivot: true, text: subtitle });
  for (const a of [-5.5, 5.5]) f.put('piece_groundtorch', a, 12.5, F, 0);
  return {};
}

// ---------- Armurerie ----------

// Époque (biome) des objets d'après les matériaux de leur recette.
const MATERIAL_TIER = {
  Wood: 0, Stone: 0, Flint: 0, LeatherScraps: 0, DeerHide: 0, BoneFragments: 0, Resin: 0, HardAntler: 0, Feathers: 0, TrophyDeer: 0, Coal: 0,
  Bronze: 1, Copper: 1, Tin: 1, RoundLog: 1, FineWood: 1, TrollHide: 1, GreydwarfEye: 1, TrophySkeleton: 1, SurtlingCore: 1, BjornHide: 1, BjornPaw: 1, TrophyBjorn: 1,
  Iron: 2, ElderBark: 2, Root: 2, Guck: 2, Chitin: 2, WrithanRoots: 2, TrophyDraugrElite: 2, Chain: 2,
  Silver: 3, WolfPelt: 3, WolfFang: 3, WolfClaw: 3, WolfHairBundle: 3, Crystal: 3, FreezeGland: 3, TrophyHatchling: 3, TrophyCultist: 3, Obsidian: 3, SerpentScale: 3, YmirRemains: 3, ScytheHandle: 3, TrophyWolf: 3,
  BlackMetal: 4, LinenThread: 4, LoxPelt: 4, Needle: 4, UndeadBjornRibcage: 4, TrophyBjornUndead: 4,
  Carapace: 5, Eitr: 5, ScaleHide: 5, Mandible: 5, YggdrasilWood: 5, Bilebag: 5, GiantBloodSack: 5, Wisp: 5,
  FlametalNew: 6, AskHide: 6, CharredBone: 6, MorgenSinew: 6, MorgenHeart: 6, Blackwood: 6, BonemawSerpentTooth: 6, GemstoneRed: 6, GemstoneBlue: 6, GemstoneGreen: 6, CelestialFeather: 6, ProustitePowder: 6, SulfurStone: 6, TrophyFrostTroll: 6, FaderEmber: 6,
  Gold: 7, MooseHide: 7, MooseSinew: 7, NornThread: 7, SealHide: 7, ElakingHairBundle: 7, Leatherstraps: 7, Frostwood: 7, BarkaBranch: 7, OrbThunderBlood: 7, OrbFrostFire: 7, TrophyMoose: 7, TrophyJotunWitch: 7,
};
export const TIERS = {
  fr: ['Prairies', 'Forêt noire', 'Marais', 'Montagnes', 'Plaines', 'Brumes', 'Terres cendrées', 'Nord profond'],
  en: ['Meadows', 'Black Forest', 'Swamp', 'Mountains', 'Plains', 'Mistlands', 'Ashlands', 'Deep North'],
};

function itemTier(item, byName) {
  let tier = -1;
  for (const res of item.resources || []) {
    if (/^Mold/.test(res)) tier = Math.max(tier, 7);
    else if (MATERIAL_TIER[res] !== undefined) tier = Math.max(tier, MATERIAL_TIER[res]);
    else if (byName.has(res) && res !== item.name) tier = Math.max(tier, itemTier(byName.get(res), byName));
  }
  if (tier < 0) tier = item.station === 'blackforge' ? 5 : item.station === 'piece_magetable' ? 5 : item.station === 'forge' ? 1 : 0;
  return tier;
}

// Ensembles d'armure, avec leur nom.
const ARMOR_SETS = [
  [['Haillons', 'Rags'], 'ArmorRagsChest', 'ArmorRagsLegs'],
  [['Cuir', 'Leather'], 'ArmorLeatherChest', 'ArmorLeatherLegs', 'HelmetLeather', 'CapeDeerHide'],
  [['Cuir de troll', 'Troll leather'], 'ArmorTrollLeatherChest', 'ArmorTrollLeatherLegs', 'HelmetTrollLeather', 'CapeTrollHide'],
  [['Bronze', 'Bronze'], 'ArmorBronzeChest', 'ArmorBronzeLegs', 'HelmetBronze'],
  [["Ours (berserkir)", 'Bear (berserkir)'], 'ArmorBerserkerChest', 'ArmorBerserkerLegs', 'HelmetBerserkerHood'],
  [["Odin", 'Oden'], 'HelmetOdin', 'CapeOdin'],
  [['Racines', 'Root'], 'ArmorRootChest', 'ArmorRootLegs', 'HelmetRoot'],
  [['Fer', 'Iron'], 'ArmorIronChest', 'ArmorIronLegs', 'HelmetIron'],
  [['Loup', 'Wolf'], 'ArmorWolfChest', 'ArmorWolfLegs', 'HelmetDrake', 'CapeWolf'],
  [['Fenris', 'Fenris'], 'ArmorFenringChest', 'ArmorFenringLegs', 'HelmetFenring'],
  [['Rembourrée', 'Padded'], 'ArmorPaddedCuirass', 'ArmorPaddedGreaves', 'HelmetPadded', 'CapeLinen'],
  [['Lox', 'Lox'], 'ArmorLoxChest', 'ArmorLoxLegs', 'HelmetLox', 'CapeLox'],
  [['Ours maudit', 'Vilebone'], 'ArmorBerserkerUndeadChest', 'ArmorBerserkerUndeadLegs', 'HelmetBerserkerUndead'],
  [['Carapace', 'Carapace'], 'ArmorCarapaceChest', 'ArmorCarapaceLegs', 'HelmetCarapace', 'CapeFeather'],
  [["Eitr tissé", 'Eitr-weave'], 'ArmorMageChest', 'ArmorMageLegs', 'HelmetMage'],
  [['Flametal', 'Flametal'], 'ArmorFlametalChest', 'ArmorFlametalLegs', 'HelmetFlametal', 'CapeAsh'],
  [["Ask", 'Ask'], 'ArmorAshlandsMediumChest', 'ArmorAshlandsMediumlegs', 'HelmetAshlandsMediumHood', 'CapeAsksvin'],
  [['Embla', 'Embla'], 'ArmorMageChest_Ashlands', 'ArmorMageLegs_Ashlands', 'HelmetMage_Ashlands'],
  [['Protecteur', 'Protector'], 'ArmorDeepNorthHeavyChest', 'ArmorDeepNorthHeavylegs', 'HelmetDNHeavy', 'CapeDeepNorth'],
  [["Orateur", 'Caller'], 'ArmorDeepNorthMageChest', 'ArmorDeepNorthMagelegs', 'HelmetDNMage', 'CapeDeepNorthMage'],
  [['Avant-garde', 'Vanguard'], 'ArmorDeepNorthMediumChest', 'ArmorDeepNorthMediumlegs', 'HelmetDNMediumHood'],
];
const EXCLUDED = /^(Bomb|Tankard|Snowball|GrapplingHook|Torch|Lantern)/;
const WEAPON_ORDER = ['OneHandedWeapon', 'TwoHandedWeapon', 'TwoHandedWeaponLeft', 'Bow', 'Tool'];

// Contenu de l'armurerie par époque : mannequins (ensembles), boucliers et pièces isolées, armes.
export function armoryContents(items, geometry, language = 'fr') {
  const lang = language === 'en' ? 'en' : 'fr';
  const byName = new Map(items.map((i) => [i.name, i]));
  const known = new Map(items.filter((i) => i.craftable).map((i) => [i.name, i]));
  const label = (i) => i[lang] || i.fr || i.en || i.name;
  const slots = geometry.ArmorStand_Male?.armorSlots || [];
  const slotFor = (type, used) => slots.findIndex((types, idx) => !used.has(idx) && types.includes(type));
  const tiers = Array.from({ length: 8 }, () => ({ mannequins: [], ground: [], weapons: [] }));
  const inSets = new Set();
  for (const [names, ...set] of ARMOR_SETS) {
    const ints = {};
    const used = new Set();
    let tier = 0;
    for (const name of set) {
      const item = known.get(name);
      if (!item) continue;
      const idx = slotFor(item.type, used);
      if (idx < 0) continue;
      used.add(idx);
      ints[`${idx}_item`] = name;
      inSets.add(name);
      tier = Math.max(tier, itemTier(item, byName));
    }
    if (Object.keys(ints).length) tiers[tier].mannequins.push({ ints, label: names[lang === 'en' ? 1 : 0] });
  }
  const sorted = [...known.values()].filter((i) => !inSets.has(i.name) && !EXCLUDED.test(i.name));
  for (const item of sorted) {
    const entry = { name: item.name, label: label(item), type: item.type, skill: item.skill };
    const tier = tiers[itemTier(item, byName)];
    if (item.type === 'Shield' || item.type === 'Helmet' || item.type === 'Shoulder' || item.type === 'Chest' || item.type === 'Legs') {
      if (item.type === 'Shield' || item.type === 'Helmet') tier.ground.push(entry);
    } else if (WEAPON_ORDER.includes(item.type)) tier.weapons.push(entry);
  }
  for (const t of tiers) {
    t.ground.sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
    t.weapons.sort((a, b) => WEAPON_ORDER.indexOf(a.type) - WEAPON_ORDER.indexOf(b.type) || a.skill.localeCompare(b.skill) || a.label.localeCompare(b.label));
  }
  const trophies = items.filter((i) => /^Trophy(Eikthyr|TheElder|Bonemass|DragonQueen|GoblinKing|SeekerQueen|Fader)$/.test(i.name))
    .sort((a, b) => BOSSES.indexOf(a.name) - BOSSES.indexOf(b.name))
    .map((i) => ({ name: i.name, label: label(i) }));
  return { tiers, trophies, tierNames: TIERS[lang] };
}
const BOSSES = ['TrophyEikthyr', 'TrophyTheElder', 'TrophyBonemass', 'TrophyDragonQueen', 'TrophyGoblinKing', 'TrophySeekerQueen', 'TrophyFader'];

export const armoryRect = { hw: 23, hd: 15, ox: 0, oz: 6 };

// Armurerie-musée : grande salle de 44 × 16 m sur deux niveaux de 5 m, huit salles d'exposition (une par époque,
// dans l'ordre du voyage) séparées par des cloisons de pierre, mannequins en armure et présentoirs muraux, chacun avec
// sa pancarte ; salle des trophées au bout, escalier à l'autre bout ; accueil en avancée sur l'avant.
export function armory(L, x, z, rot, { contents, name, subtitle, texts }) {
  const f = L.frame(x, z, rot);
  const F = LEVEL;
  const U = F + 5;
  const random = mulberry(211);
  const placed = { stands: 0, mannequins: 0 };

  // Rez-de-chaussée de pierre (5 m), ouverture sur l'accueil.
  const rows = [['stone_wall_4x2', F], ['stone_wall_4x2', F + 2]];
  wallRun(f, -22, 22, 8, 4, rows, (a) => Math.abs(a) < 3);
  wallRun(f, -22, 22, -8, 4, rows);
  for (let a = -21; a < 22; a += 2) for (const b of [-8, 8]) f.put('stone_wall_2x1', a, b, F + 4, 0);
  f.put('darkwood_beam4x4', 0, 8, F + 3.55, 0);
  for (const a of [-22, 22]) {
    const g = f.sub(a, 0, 90);
    wallRun(g, -8, 8, 0, 4, rows);
    for (let b = -7; b < 8; b += 2) g.put('stone_wall_2x1', b, 0, F + 4, 0);
  }
  // Étage de bois (5 m), fenêtres, poteaux et contrefiches extérieurs.
  for (let a = -21; a < 22; a += 2)
    for (const b of [-8, 8]) {
      if (Math.abs(a) % 8 === 5) {
        f.put('wood_wall_half', a, b, U, 0);
        f.put('darkwood_decowall', a - 0.5, b, U + 1, 0);
        f.put('darkwood_decowall', a + 0.5, b, U + 1, 0);
        f.put('wood_wall_half', a, b, U + 3, 0);
      } else {
        f.put('woodwall', a, b, U, 0);
        f.put('woodwall', a, b, U + 2, 0);
      }
      f.put('wood_wall_half', a, b, U + 4, 0);
    }
  for (const a of [-22, 22])
    for (let b = -7; b < 8; b += 2) {
      const g = f.sub(a, 0, 90);
      g.put('woodwall', b, 0, U, 0);
      g.put('woodwall', b, 0, U + 2, 0);
      g.put('wood_wall_half', b, 0, U + 4, 0);
    }
  for (let a = -20; a <= 20; a += 8) for (const b of [-8.62, 8.62]) f.put('wood_pole_log_4', a, b, U, 0);
  gableRoof(f, { width: 16, length: 44, eave: U + 5, gables: 'both', dragons: true, overhang: 1 });
  for (let a = -20; a <= 20; a += 8) truss(f, a, 0, 16, U + 5);

  // Plancher de l'étage, escalier au bout est, garde-corps.
  planks(f, -22, -8, 22, 8, U, (a, b) => a > 18 && b < 4);
  for (let s = 0; s < 5; s++) f.put('wood_stair', 20, -5 + 2 * s, F + s, 180);
  railing(f.sub(18, 0, 90), -4, 8, 0, U);
  for (let b = -2; b < 8; b += 4) f.put('darkwood_beam4x4', 18, b, U - 0.45, 90);

  // Salles d'exposition : quatre de chaque côté de l'allée centrale (z de -2 à 2).
  const bays = [
    { tier: 0, side: -1, x0: -18, x1: -9 },
    { tier: 1, side: -1, x0: -9, x1: 0 },
    { tier: 2, side: -1, x0: 0, x1: 9 },
    { tier: 3, side: -1, x0: 9, x1: 18 },
    { tier: 4, side: 1, x0: 9, x1: 18 },
    { tier: 5, side: 1, x0: 2, x1: 9 },
    { tier: 6, side: 1, x0: -9, x1: -2 },
    { tier: 7, side: 1, x0: -18, x1: -9 },
  ];
  const partitions = new Set();
  for (const bay of bays) {
    partitions.add(`${bay.x0},${bay.side}`);
    partitions.add(`${bay.x1},${bay.side}`);
  }
  for (const key of partitions) {
    const [p, side] = key.split(',').map(Number);
    for (const floor of [F, U]) {
      const g = f.sub(p, 0, 90);
      for (const y of [floor, floor + 2]) {
        g.put('Piece_grausten_wall_4x2', -side * 5.5, 0, y, 0);
        g.put('Piece_grausten_wall_1x2', -side * 3, 0, y, 0);
      }
      f.put('darkwood_pole4', p, side * 2.25, floor, 0);
      f.put('piece_dvergr_lantern', p, side * 2.5, floor + 3.6, side > 0 ? 270 : 90, { pivot: true });
    }
  }
  // Couloir d'entrée : le passage entre l'accueil et l'allée reste libre (x de -2 à 2).
  const tierNames = contents.tierNames;
  for (const bay of bays) {
    const t = contents.tiers[bay.tier];
    const cx = (bay.x0 + bay.x1) / 2;
    const facing = bay.side < 0 ? 0 : 180;
    const back = bay.side * 7.5;
    // Emplacements muraux par niveau : fond de la salle, puis cloisons.
    const spotsFor = (floor, heights, wallFace) => {
      const spots = [];
      for (const h of heights) {
        for (let a = bay.x0 + 1.1; a <= bay.x1 - 1.1 + 0.01; a += 1.3) spots.push([a, bay.side * wallFace - bay.side * 0.05, floor + h, facing]);
        for (let b = 3.9; b <= 7; b += 1.3) {
          spots.push([bay.x0 + 0.25, bay.side * b, floor + h, 90]);
          spots.push([bay.x1 - 0.25, bay.side * b, floor + h, 270]);
        }
      }
      return spots;
    };
    const ground = spotsFor(F, [2.9, 4.3], 7.5);
    const upper = spotsFor(U, [1.5, 2.9, 4.3], 7.85);
    const groundItems = [...t.ground];
    const upperItems = [...t.weapons];
    while (upperItems.length > upper.length) groundItems.push(upperItems.pop());
    while (groundItems.length > ground.length) upperItems.push(groundItems.pop());
    const show = (list, spots) => list.slice(0, spots.length).forEach((item, i) => {
      const [a, b, y, r] = spots[i];
      f.put('itemstand', a, b, y, r, { pivot: true, data: { ints: { item: item.name }, lock } });
      f.put('sign', a, b, y - 0.62, r, { pivot: true, text: item.label });
      placed.stands++;
    });
    show(groundItems, ground);
    show(upperItems, upper);
    // Mannequins au milieu de la salle, face à l'allée, chacun avec sa pancarte sur un piquet.
    const n = t.mannequins.length;
    t.mannequins.slice(0, 4).forEach((m, i) => {
      const a = cx + (i - (Math.min(n, 4) - 1) / 2) * 2.1;
      f.put('ArmorStand_Male', a, bay.side * 5.3, F, facing, { data: { ints: m.ints, lock } });
      f.put('wood_pole', a, bay.side * 3.5, F, 0);
      f.put('sign', a, bay.side * 3.5 - bay.side * 0.24, F + 0.75, facing, { pivot: true, text: m.label });
      placed.mannequins++;
    });
    // Enseigne de la salle, suspendue à une poutre au-dessus de l'entrée, sur les deux niveaux.
    for (const floor of [F, U]) {
      f.put('darkwood_beam4x4', cx, bay.side * 2.7, floor + 4.1, 0);
      f.put('sign', cx, bay.side * 2.7 - bay.side * 0.25, floor + 3.7, facing, { pivot: true, text: tierNames[bay.tier] });
    }
    f.put('rug_straw', cx, bay.side * 5.3, F, 90);
  }

  // Salle des trophées (bout ouest) : trophées des grands ennemis sur le mur, braseros.
  contents.trophies.forEach((t, i) => {
    const b = -6 + i * 2;
    f.put('itemstand', -21.45, b, F + 2.4, 90, { pivot: true, data: { ints: { item: t.name }, lock } });
    f.put('sign', -21.45, b, F + 1.75, 90, { pivot: true, text: t.label });
  });
  for (const b of [-6.5, 6.5]) f.put('piece_brazierfloor01', -19.8, b, F, 0);
  f.put('jute_carpet_blue', -20, 0, F, 0);
  f.put('piece_banner07', -21.4, 0, U + 4.3, 0, { pivot: true });
  for (const a of [-13.5, -4.5, 4.5, 13.5]) for (const floor of [F, U]) f.put('piece_brazierceiling01', a, 0, floor + 2.9, 0);

  // Accueil : avancée de 16 × 10 m sur l'avant, bureau, sièges, table, bannières.
  for (const a of [-8, 8]) {
    const g = f.sub(a, 8, 90);
    for (let b = -9; b < 0; b += 2) {
      g.put('stone_wall_2x1', b, 0, F, 0);
      if (b === -5) {
        g.put('darkwood_decowall', b - 0.5, 0, F + 1, 0);
        g.put('darkwood_decowall', b + 0.5, 0, F + 1, 0);
      } else g.put('woodwall', b, 0, F + 1, 0);
      g.put('wood_wall_half', b, 0, F + 3, 0);
    }
  }
  for (let a = -7; a <= 7; a += 2) {
    if (Math.abs(a) === 1) {
      f.put('wood_door', a, 18, F, 0);
      f.put('wood_wall_half', a, 18, F + 2, 0);
      f.put('wood_wall_half', a, 18, F + 3, 0);
      continue;
    }
    f.put('stone_wall_2x1', a, 18, F, 0);
    if (Math.abs(a) === 5) {
      f.put('darkwood_decowall', a - 0.5, 18, F + 1, 0);
      f.put('darkwood_decowall', a + 0.5, 18, F + 1, 0);
    } else f.put('woodwall', a, 18, F + 1, 0);
    f.put('wood_wall_half', a, 18, F + 3, 0);
  }
  const annexRoof = f.sub(0, 13, 90);
  gableRoof(annexRoof, { width: 16, length: 10, eave: F + 4, gables: 'neg', dragons: 'neg', overhang: 1 });
  for (const a of [-3, 1]) truss(annexRoof, a, 0, 16, F + 4);
  const hall = new Room(f, -7.45, 8.55, 7.45, 17.45, F, { random, surface: 0.4, door: [0, 17.45] });
  hall.block(-2.2, 8.5, 2.2, 11);
  hall.place('piece_table_runed', 0, 13.6, 180);
  hall.place('piece_chair03', 0, 12.3, 0);
  f.put('Candle_resin', -1.3, 13.6, F + 0.79, 0);
  f.put('sign', 0.9, 13.6, F + 0.8, 180, { pivot: false, text: subtitle });
  hall.wall('piece_bench01', 'left', 0.7);
  hall.wall('piece_bench01', 'right', 0.7);
  hall.dining('piece_table_round', 'piece_chair02', 2, { fx: 0.15, fz: 0.25 });
  hall.wall('piece_pot2', 'front', 0.05);
  hall.wall('piece_pot2', 'front', 0.95);
  hall.center('jute_carpet_blue', 0, { free: true, fz: 0.55 });
  for (const a of [-5, 5]) f.put('itemstand', a, 8.55, F + 2.4, 180, { pivot: true, data: { ints: { item: a < 0 ? 'ShieldBronzeBuckler' : 'ShieldBanded' }, lock } });
  for (const a of [-7.35, 7.35]) {
    f.put('piece_banner07', a, 13, F + 3.6, 0, { pivot: true });
    wallLight(f, a, 10, F, a < 0 ? 1 : -1, 0);
  }
  f.put('sign', 0, 8.55, F + 4.5, 180, { pivot: true, text: texts?.halls || name });
  // Dehors : enseigne, cible et mannequin d'entraînement, lampadaires.
  f.put('darkwood_pole4', 4.5, 20, F, 0);
  f.put('sign', 4.5, 20.24, F + 2.5, 0, { pivot: true, text: name });
  f.put('piece_ArcheryTarget', -12, 17, F + 1, 180);
  f.put('piece_TrainingDummy', 12, 17, F, 180);
  for (const a of [-9.5, 9.5]) lampPost(f, a, 20, F, 0, -1);
  return placed;
}

// ---------- Grande brasserie ----------

export const brasserieRect = { hw: 17, hd: 12.5, ox: 0, oz: 1.5 };

// Brasserie : salle de 32 × 20 m, 5 m sous charpente apparente ; comptoir au centre du fond avec tabourets, étagères
// de bouteilles et tonneaux derrière ; galerie de brassage à l'ouest (cuves posées sur un socle de pierre de 1 m, muret,
// plafond de planches sur poteaux) ; distillerie et foyer à l'est ; quatre grandes tables ; lustres et guirlandes.
export function brasserie(L, x, z, rot, { name, subtitle, board, boardEmpty }) {
  const f = L.frame(x, z, rot);
  const F = LEVEL;
  const H = F + 5;
  const boards = [];

  for (let a = -15; a < 16; a += 2)
    for (const b of [-10, 10]) {
      const door = b > 0 && Math.abs(a) === 1;
      if (door) {
        f.put('wood_door', a, b, F, 0);
        f.put('wood_wall_half', a, b, F + 2, 0);
      } else {
        f.put('stone_wall_2x1', a, b, F, 0);
        if (Math.abs(a) % 6 === 3) {
          f.put('darkwood_decowall', a - 0.5, b, F + 1, 0);
          f.put('darkwood_decowall', a + 0.5, b, F + 1, 0);
        } else f.put('woodwall', a, b, F + 1, 0);
      }
      f.put('woodwall', a, b, F + 3, 0);
    }
  for (const a of [-16, 16]) {
    const g = f.sub(a, 0, 90);
    for (let b = -9; b < 10; b += 2) {
      g.put('stone_wall_2x1', b, 0, F, 0);
      g.put('woodwall', b, 0, F + 1, 0);
      g.put('woodwall', b, 0, F + 3, 0);
    }
  }
  for (let a = -16; a <= 16; a += 4) for (const b of [-10.62, 10.62]) if (Math.abs(a) > 2) f.put('wood_pole_log_4', a, b, F + 1, 0);
  gableRoof(f, { width: 20, length: 32, eave: H, dark: true, gables: 'both', dragons: true, overhang: 1 });
  for (let a = -12; a <= 12; a += 8) truss(f, a, 0, 20, H);

  // Porche, enseignes, tableau des contrats.
  for (const s of [-1, 1]) {
    f.put('wood_roof', s, 11, H - 1.5, 0, { pivot: true });
    f.put('wood_pole_log_4', s * 1.8, 12.2, F, 0);
  }
  f.put('sign', 2.3, 12.44, F + 2.4, 0, { pivot: true, text: name });
  f.put('sign', 2.3, 12.44, F + 1.7, 0, { pivot: true, text: subtitle });
  for (const a of [-7, 7]) f.put('piece_dvergr_lantern', a, 10.36, F + 3.2, 90, { pivot: true });
  for (const a of [-10, -6]) f.put('darkwood_pole4', a, 12.5, F, 0);
  f.put('darkwood_beam4x4', -8, 12.5, F + 3.6, 0);
  f.put('sign', -8, 12.74, F + 3.1, 0, { pivot: true, text: board });
  for (const [a, h] of [[-9, 2.4], [-7, 2.4], [-9, 1.6], [-7, 1.6]]) boards.push(f.put('sign', a, 12.55, F + h, 0, { pivot: true, text: boardEmpty }));

  // Comptoir : socle de pierre et plateau de planches, tabourets, boissons.
  for (let a = -5; a <= 5; a += 2) f.put('stone_wall_2x1', a, -4, F, 0);
  for (let a = -5.5; a <= 5.5; a += 1) f.put('wood_floor_1x1', a, -4, F + 1, 0);
  for (const a of [-4.5, -2, 0.5, 3]) f.put('piece_chair', a, -2.9, F, 180);
  for (const [a, drink] of [[-4, 'MeadTasty'], [-1.5, 'MeadHealthMinor'], [1.5, 'MeadStaminaMinor'], [4, 'MeadTasty']]) f.put(drink, a, -4.1, F + 1.1, 0);
  // Étagères du fond : poteaux, tablettes, bouteilles et pots ; tonneaux dessous.
  for (const a of [-6, -2, 2, 6]) f.put('darkwood_pole4', a, -9.2, F, 0);
  const bottles = ['MeadTasty', 'MeadHealthMinor', 'MeadStaminaMinor', 'MeadPoisonResist', 'MeadFrostResist', 'MeadHasty', 'MeadStrength', 'MeadSwimmer'];
  let k = 0;
  for (const h of [1.4, 2.2, 3.0])
    for (let a = -5.5; a <= 5.5; a += 1) {
      f.put('wood_ledge', a, -9.2, F + h, 0);
      if (Math.abs(a) > 0.6) f.put(h === 3.0 && Math.abs(a) % 2 === 1.5 ? 'piece_pot3' : bottles[k++ % bottles.length], a, -9.2, F + h + 0.04, 0);
    }
  for (const a of [-4.5, -3.5, 3.5, 4.5]) f.put('piece_chest_barrel', a, -8.9, F, 0);

  // Galerie de brassage (ouest) : socle de pierre de 1 m, cuves, murets, plafond sur poteaux, escalier.
  foundation(f, -15.5, -8, -11.5, 8, F);
  for (const b of [-6, -2, 2, 6]) f.put('fermenter', -13.6, b, F + 1, 90);
  for (const b of [-4, 4]) f.put('wood_wall_quarter', -11.7, b, F + 1, 90);
  for (const b of [-7.5, -0.5, 7.5]) f.put('darkwood_pole4', -11.7, b, F + 1, 0);
  for (const b of [-6, -2, 2, 6]) f.put('darkwood_beam4x4', -11.7, b, F + 3.45, 90);
  planks(f, -16, -8, -12, 8, F + 3.9);
  f.put('stone_stair', -10.5, 0, F, 90);
  f.put('sign', -11.3, 0, F + 2.8, 90, { pivot: true, text: subtitle });
  // Distillerie et foyer (est).
  f.put('fire_pit', 13, -7, F, 0);
  f.put('piece_MeadCauldron', 13, -7, F, 0);
  f.put('fire_pit', 9.5, -7.8, F, 0);
  f.put('piece_cauldron', 9.5, -7.8, F, 0);
  f.put('piece_preptable', 13, -9.35, F, 0);
  for (const b of [-4, -3.1]) f.put('piece_chest_barrel', 15.3, b, F, 0);
  f.put('hearth', 12.5, 4.5, F, 0);
  f.put('piece_moose_throne', 15.2, 4.5, F, 270);
  f.put('rug_fur', 12.5, 0.8, F, 90);
  for (const b of [7.8, 1.2]) f.put('piece_logbench01', 12.5, b, F, b > 4 ? 180 : 0);

  // Tables et bancs, nourriture.
  const foods = [['Bread', 'MeadTasty'], ['FishAndBread', 'MeadTasty'], ['HoneyGlazedChicken', 'MeadHealthMinor'], ['LoxPie', 'MeadTasty']];
  [[-5, 1.5], [5, 1.5], [-5, 6.5], [5, 6.5]].forEach(([a, b], i) => {
    f.put('piece_table_oak', a, b, F, 0);
    for (const s of [-1, 1]) for (const d of [-1.5, 1.5]) f.put('piece_bench01', a + d, b + s * 1.3, F, s > 0 ? 180 : 0);
    foods[i].forEach((food, j) => f.put(food, a - 1 + j * 2, b, F + 0.79, 0));
    f.put('Candle_resin', a + 2.6, b, F + 0.79, 0);
  });
  // Lustres, guirlandes, bannières, lumières murales.
  for (const a of [-5, 5]) for (const b of [1.5, 6.5]) f.put('piece_brazierceiling01', a, b, F + 2.9, 0);
  for (const a of [-12, -4, 4, 12]) f.put('piece_CelebrationGarland', a, 9.62, F + 3.6, 0, { pivot: true });
  for (const a of [-10, 9, 14]) f.put('piece_banner07', a, -9.62, F + 3.8, 90, { pivot: true });
  for (const a of [-8, 8]) wallLight(f, a, 9.85, F, 0, -1, true);
  for (const b of [-5, 5]) wallLight(f, 15.85, b, F, -1, 0, true);
  return boards;
}

// ---------- Marché couvert ----------

export const marketRect = { hw: 13, hd: 10, ox: 0, oz: 0 };

// Halle de 24 × 16 m : piliers de pierre aux angles, poteaux, sablières, fermes, grand toit ; marchands et étals.
export function market(L, x, z, rot, { name }) {
  const f = L.frame(x, z, rot);
  const F = LEVEL;
  const H = F + 6;
  for (let a = -12; a <= 12; a += 4)
    for (const b of [-8, 8]) {
      const corner = Math.abs(a) === 12;
      if (corner) for (const h of [F, F + 2, F + 4]) f.put('stone_pillar', a, b, h, 0);
      else {
        f.put('darkwood_pole4', a, b, F, 0);
        f.put('darkwood_pole', a, b, F + 4, 0);
        kneeBraces(f, a, b, H - 0.45);
      }
    }
  for (const a of [-12, 12]) for (const b of [-4, 0, 4]) {
    f.put('darkwood_pole4', a, b, F, 0);
    f.put('darkwood_pole', a, b, F + 4, 0);
  }
  for (let a = -10; a < 12; a += 4) for (const b of [-8, 8]) f.put('darkwood_beam4x4', a, b, H - 0.45, 0);
  for (const a of [-12, 12]) for (const b of [-6, -2, 2, 6]) f.put('darkwood_beam4x4', a, b, H - 0.45, 90);
  for (let a = -8; a <= 8; a += 4) truss(f, a, 0, 16, H);
  gableRoof(f, { width: 16, length: 24, eave: H, gables: 'both', dragons: true, overhang: 1 });

  // Étals des marchands (fond) : comptoir devant le marchand, tapis, tonneau.
  const stall = (a, npc, rug) => {
    f.put(rug, a, -5.5, F, 0);
    f.put(npc, a, -6, F, 0);
    f.put('piece_table', a, -4.2, F, 0);
    f.put('piece_chest_barrel', a + 2, -6.8, F, 0);
    f.put('piece_banner07', a, -7.8, F + 4.3, 90, { pivot: true });
  };
  stall(-8, 'Haldor', 'rug_deer');
  stall(0, 'Hildir', 'jute_carpet');
  stall(8, 'BogWitch', 'rug_wolf');
  // Étals de marchandises (devant) et services.
  const goods = [['bar_copper_stack', 'bar_tin_stack', 'bar_bronze_stack'], ['piece_pot1', 'piece_pot3_red', 'piece_pot1_red'], ['Bread', 'Carrot', 'Onion', 'Honey']];
  [-6, 0, 6].forEach((a, i) => {
    f.put('piece_table', a, 4.2, F, 0);
    goods[i].forEach((item, j) => f.put(item, a - 0.8 + j * (1.6 / Math.max(1, goods[i].length - 1)), 4.2, F + 0.82, 0));
    f.put('piece_chest_barrel', a + 1.8, 5.6, F, 0);
  });
  f.put('piece_barber', -10.3, 5.5, F, 90);
  f.put('piece_cartographytable', 10, 5.8, F, 180);
  for (const a of [-6, 6]) f.put('piece_brazierceiling01', a, 0, F + 3.4, 0);
  for (const [a, b] of [[-13.5, -9.5], [13.5, -9.5], [-13.5, 9.5], [13.5, 9.5]]) lampPost(f, a, b, F, a < 0 ? 1 : -1, 0);
  f.put('darkwood_pole4', 0, 9.5, F, 0);
  f.put('sign', 0, 9.74, F + 2.4, 0, { pivot: true, text: name });
}

// ---------- Entrepôt de la fonderie ----------

export const warehouseRect = { hw: 28, hd: 11.5, ox: 6, oz: 0 };

// Entrepôt de 40 × 20 m : 4 m de pierre, 4 m de bois, grand portail ; fours et machines alignés le long du fond,
// rayonnages de lingots et de tonneaux, bacs à minerai, piles de bois ; cour latérale (moulin, incinérateur, ruches).
export function warehouse(L, x, z, rot, { name }) {
  const f = L.frame(x, z, rot);
  const F = LEVEL;
  const H = F + 8;
  const rows = [['stone_wall_4x2', F], ['stone_wall_4x2', F + 2]];
  wallRun(f, -20, 20, 10, 4, rows, (a) => Math.abs(a) < 4);
  wallRun(f, -20, 20, -10, 4, rows);
  for (let a = -19; a < 20; a += 2)
    for (const b of [-10, 10]) {
      const gate = b > 0 && Math.abs(a) < 4;
      if (!gate) f.put(Math.abs(a) % 8 === 3 ? 'woodwall' : 'woodwall', a, b, F + 4, 0);
      f.put('woodwall', a, b, F + 6, 0);
    }
  for (const a of [-20, 20]) {
    const g = f.sub(a, 0, 90);
    wallRun(g, -10, 10, 0, 4, rows, (b) => a > 0 && Math.abs(b) < 3);
    for (let b = -9; b < 10; b += 2) {
      if (!(a > 0 && Math.abs(b) < 3)) g.put('woodwall', b, 0, F + 4, 0);
      g.put('woodwall', b, 0, F + 6, 0);
    }
  }
  for (const a of [-2, 2]) f.put('darkwood_beam4x4', a, 10, F + 5.55, 0);
  f.put('darkwood_beam4x4', 20, 0, F + 5.55, 90);
  for (let a = -20; a <= 20; a += 4) for (const b of [-10.62, 10.62]) if (Math.abs(a) > 4) f.put('wood_pole_log_4', a, b, F + 4, 0);
  gableRoof(f, { width: 20, length: 40, eave: H, gables: 'both', dragons: true, overhang: 1 });
  for (let a = -16; a <= 16; a += 8) truss(f, a, 0, 20, H);
  for (let a = -16; a <= 16; a += 8) for (const b of [-9.6, 9.6]) kneeBraces(f, a, b, H - 0.45);

  // Machines le long du fond (z = -9.5).
  const line = [['charcoal_kiln', 0], ['smelter', 0], ['blastfurnace', 0], ['eitrrefinery', 0], ['piece_FrostFoundry', 0], ['piece_FrostKiln', 90]];
  const geo = f.layout.geo;
  let cursor = -19.2;
  for (const [piece, r] of line) {
    const b = geo[piece]?.col;
    if (!b) continue;
    const w = r % 180 ? b[5] - b[2] : b[3] - b[0];
    const d = r % 180 ? b[3] - b[0] : b[5] - b[2];
    f.put(piece, cursor + w / 2, -9.4 + d / 2, F, r);
    cursor += w + 1.1;
  }
  f.put('piece_spinningwheel', -15, 2.5, F, 90);
  // Rayonnages le long du mur avant, de part et d'autre du portail.
  const bars = ['bar_copper_stack', 'bar_tin_stack', 'bar_bronze_stack', 'bar_iron_stack', 'bar_silver_stack', 'bar_blackmetal_stack', 'bar_flametal_stack', 'bar_ancientmetal_stack'];
  let n = 0;
  for (const [x0, x1] of [[-19, -7], [7, 19]]) {
    for (let a = x0; a <= x1; a += 4) f.put('darkwood_pole4', a, 9.1, F, 0);
    for (const h of [1.2, 2.4, 3.6])
      for (let a = x0 + 0.5; a < x1; a += 1) {
        f.put('wood_ledge', a, 9.1, F + h, 0);
        if (h === 1.2 && Math.round(a - 0.5) % 2 === 0) f.put(bars[n++ % bars.length], a, 9.1, F + h + 0.04, 0);
        if (h === 2.4 && Math.round(a - 0.5) % 3 === 0) f.put('piece_chest_barrel', a, 9.1, F + h + 0.04, 0);
        if (h === 3.6 && Math.round(a - 0.5) % 4 === 1) f.put('piece_pot3', a, 9.1, F + h + 0.04, 90);
      }
    for (let a = x0 + 1; a < x1; a += 3) f.put('piece_chest_wood', a + 0.5, 8.9, F, 180);
  }
  // Bacs à minerai (ouest) et piles de bois (est), établis au centre.
  ['coal_pile', 'flint_pile', 'stone_pile', 'obsidian_pile', 'grausten_pile'].forEach((pile, i) => {
    const b = -1.5 + i * 2.2;
    f.put(pile, -18.6, b, F, 90);
    f.put('wood_wall_log', -17.4, b + 1.1, F + 0.25, 90);
  });
  [['wood_stack', -8], ['wood_fine_stack', -5.4], ['wood_core_stack', 3.6], ['blackwood_stack', 6.2]].forEach(([pile, b]) => f.put(pile, 18.3, b, F + (pile === 'blackwood_stack' ? 0.33 : 0), 0));
  for (const a of [-5, 5]) {
    f.put('piece_table', a, 2, F, 0);
    f.put('piece_chest_blackmetal', a, 4.2, F, 180);
  }
  f.put('piece_preptable', 0, -1.2, F, 0);
  for (const a of [-12, 0, 12]) f.put('piece_brazierceiling01', a, 2, F + 5, 0);
  for (const b of [-5, 5]) wallLight(f, -19.5, b, F, 1, 0, true);

  // Cour latérale : moulin, incinérateur, ruches, barrière, lampadaires.
  f.put('windmill', 26, -5, F, 270);
  f.put('incinerator', 27, 5, F, 270);
  for (const b of [-9, -7.3]) f.put('piece_beehive', 30.2, b, F, 270);
  lowFence(f.sub(20.5, 10.5), 0, 12, 0, F);
  lowFence(f.sub(20.5, -10.5), 0, 12, 0, F);
  lowFence(f.sub(32.5, -10.5, 90), -21, 0, 0, F);
  for (const b of [-10, 10]) lampPost(f, 32, b, F, -1, 0);
  f.put('darkwood_pole4', -6, 11.5, F, 0);
  f.put('sign', -6, 11.74, F + 2.4, 0, { pivot: true, text: name });
}

// ---------- Arène ----------

export const ARENA = { fight: 22, outer: 31.5 };

// Arène viking : mur-podium de pierre de 4 m autour du cercle de combat, trois gradins de bois, mur extérieur de pierre
// et de bois de 8 m avec poteaux et contreforts, auvent circulaire au-dessus des gradins, quatre portes (passage central
// et escaliers vers les gradins de part et d'autre). Les portes sont à 0°, 90°, 180° et 270° du repère.
export function arena(L, x, z, rot, { sign }) {
  const f = L.frame(x, z, rot);
  const F = LEVEL;
  const gates = [0, 90, 180, 270];
  const offGate = (a, r, half) => Math.min(...gates.map((g) => Math.abs(((a - g + 540) % 360) - 180))) * DEG * r;
  const ring = (piece, r, width, bottom, { skip = 3.4, band = null, turn = 0, pivot = false } = {}) => {
    const n = Math.ceil((2 * Math.PI * r) / width);
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) * 360) / n;
      const d = offGate(a, r);
      if (d < skip) continue;
      if (band && d >= band[0] && d < band[1]) continue;
      ringPut(f, piece, r, a, bottom, { turn, pivot });
    }
  };
  // Mur-podium (4 m), garde-corps.
  ring('stone_wall_4x2', 23.5, 3.9, F, { skip: 3.2 });
  ring('stone_wall_4x2', 23.5, 3.9, F + 2, { skip: 3.2 });
  ring('wood_wall_half', 23.2, 2, F + 4, { skip: 3.2 });
  // Gradins, contremarches (les escaliers entre gradins sont dans la bande 3,4-5,4 m de chaque porte).
  ring('wood_floor', 25, 2, F + 4 - 0.1, { skip: 3.2 });
  ring('wood_floor', 27, 2, F + 5 - 0.1, { skip: 3.2, band: [3.2, 5.4] });
  ring('wood_floor', 29, 2, F + 6 - 0.1, { skip: 3.2, band: [3.2, 5.4] });
  ring('wood_wall_half', 26, 2, F + 4, { skip: 3.2, band: [3.2, 5.4] });
  ring('wood_wall_half', 28, 2, F + 5, { skip: 3.2, band: [3.2, 5.4] });
  // Mur extérieur : pierre (4 m) puis bois (4 m), contreforts et poteaux.
  ring('stone_wall_4x2', 30.5, 3.9, F, { skip: 3.2 });
  ring('stone_wall_4x2', 30.5, 3.9, F + 2, { skip: 3.2 });
  ring('woodwall', 30.5, 2, F + 4, { skip: 3.2 });
  ring('woodwall', 30.5, 2, F + 6, { skip: 0 });
  ring('stone_pillar', 31.5, 8, F, { skip: 4 });
  ring('stone_pillar', 31.5, 8, F + 2, { skip: 4 });
  ring('wood_pole_log_4', 31.2, 8, F + 4, { skip: 4 });
  ring('darkwood_pole', 30.2, 6, F + 8, { skip: 0 });
  // Auvent au-dessus du gradin haut (3 m de passage), pente vers l'extérieur.
  ring('darkwood_roof', 29.6, 2, F + 9.2, { skip: 0, turn: 180, pivot: true });
  // Portes : escaliers de part et d'autre du passage, linteaux, bannières, braseros, escaliers entre gradins.
  for (const g of gates) {
    const h = f.sub(0, 0, 0);
    for (const along of [-2.2, 2.2])
      [30, 28, 26, 24].forEach((r, i) => ringPut(h, 'wood_stair', r, g, F + i, { along, turn: 180 }));
    for (const along of [-4.3, 4.3]) {
      ringPut(h, 'wood_stair', 27, g, F + 4, { along });
      ringPut(h, 'wood_stair', 29, g, F + 5, { along });
    }
    for (const along of [-1.6, 1.6]) ringPut(h, 'darkwood_beam4x4', 30.5, g, F + 5.5, { along });
    for (const along of [-3.6, 3.6]) {
      ringPut(h, 'piece_banner02', 31.12, g, F + 6.6, { along, pivot: true, turn: 90 });
      ringPut(h, 'piece_brazierfloor01', 33, g, F, { along });
    }
  }
  // Intérieur : lanternes et bannières sur le podium, torches bleues au centre.
  for (let k = 0; k < 8; k++) {
    const a = 45 + k * 90 / 2 - 22.5;
    const rad = a * DEG;
    f.put('piece_dvergr_lantern', Math.cos(rad) * 22.95, Math.sin(rad) * 22.95, F + 3.3, armToward(-Math.cos(rad), -Math.sin(rad)), { pivot: true });
    ringPut(f, 'piece_banner07', 22.9, a + 11, F + 3.6, { pivot: true, turn: 90 });
  }
  for (let k = 0; k < 4; k++) {
    const rad = (45 + k * 90) * DEG;
    f.put('piece_groundtorch_blue', Math.cos(rad) * 5, Math.sin(rad) * 5, F, 0);
  }
  // Enseigne à la porte 0°.
  f.put('darkwood_pole4', 34.5, -4.2, F, 0);
  f.put('sign', 34.74, -4.2, F + 2.4, 90, { pivot: true, text: sign });
  return { gates: gates.map((g) => f.at(Math.cos(g * DEG) * 33, Math.sin(g * DEG) * 33)) };
}

// Générateur pseudo-aléatoire local (dispositions reproductibles).
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
