// Analyse des réponses texte de ValheimRcon (formats lus dans le code source du mod).

const num = (s) => (s == null ? null : Number(String(s).replace(',', '.')));
const vec = (s) => (s ? s.trim().split(/\s+/).map(num) : null);

// "Online 2\nRagnar Steam ID:7656... Position: (1 2 3) Zone: (0 0) Player ID:123 HP:25/25 Public position: True Platform name: Ragnar"
export function parsePlayers(text) {
  const lines = String(text).split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const online = Number((lines.shift() || '').match(/^Online (\d+)/)?.[1] ?? 0);
  const players = [];
  for (const line of lines) {
    const m = line.match(/^(.*?) Steam ID:(\S*) Position: \(([^)]*)\) Zone: \(([^)]*)\)(.*)$/);
    if (!m) continue;
    const rest = m[5];
    const hp = rest.match(/ HP:([\d.,-]+)\/([\d.,-]+)/);
    players.push({
      name: m[1],
      id: m[2] || m[1],
      platform: platformOf(m[2]),
      position: vec(m[3]),
      zone: vec(m[4]),
      playerId: rest.match(/ Player ID:(-?\d+)/)?.[1] ?? null,
      hp: hp ? num(hp[1]) : null,
      maxHp: hp ? num(hp[2]) : null,
      platformName: rest.match(/ Platform name: (.*)$/)?.[1] ?? null,
    });
  }
  return { online, players };
}

export function platformOf(id = '') {
  if (/^\d{17}$/.test(id) || /^steam/i.test(id)) return 'Steam';
  if (/xbox/i.test(id)) return 'Xbox';
  if (/ps|playstation/i.test(id)) return 'PlayStation';
  return 'Crossplay';
}

// "-Prefab: X Id: 123:456 Position: (x y z) Zone: (a b) Rotation: (...) Tag: t Container: 3 items ..."
export function parseObjectLine(line = '') {
  const m = line.replace(/^-/, '').match(/^Prefab: (\S+) Id: (\d+:-?\d+) Position: \(([^)]*)\)(.*)$/);
  if (!m) return null;
  const rest = m[4];
  const container = rest.match(/ Container: (<empty>|(\d+) items)/);
  return {
    prefab: m[1],
    id: m[2],
    position: vec(m[3]),
    tag: rest.match(/ Tag: (\S+)/)?.[1] ?? null,
    items: container ? Number(container[2] ?? 0) : null,
    persistent: !rest.includes('[NOT PERSISTENT]'),
    details: rest.replace(/ Zone: \([^)]*\)| Rotation: \([^)]*\)| \[NOT PERSISTENT\]| Container: (<empty>|\d+ items)/g, '').trim(),
  };
}

export function parseObjects(text) {
  const t = String(text);
  if (/^No objects found/.test(t)) return { total: 0, objects: [], truncated: false };
  const total = Number(t.match(/^Found (\d+) objects:/)?.[1] ?? 0);
  const objects = t.split('\n').filter((l) => l.startsWith('-Prefab:')).map(parseObjectLine).filter(Boolean);
  return { total, objects, truncated: objects.length < total };
}

// showContainer : ligne d'info, "Items (n):", puis "[0] Wood Stack: 50 Quality: 1 ..."
export function parseContainer(text) {
  const t = String(text);
  const items = [];
  for (const line of t.split('\n')) {
    const m = line.match(/^\[(\d+)\] (\S+) Stack: (\d+) Quality: (\d+)(.*)$/);
    if (!m) continue;
    items.push({
      index: Number(m[1]),
      name: m[2],
      stack: Number(m[3]),
      quality: Number(m[4]),
      variant: Number(m[5].match(/ Variant: (\d+)/)?.[1] ?? 0),
      crafter: m[5].match(/ Crafter: (.*?) \(-?\d+\)/)?.[1] ?? null,
    });
  }
  return { items, truncated: t.includes('--- message truncated ---') };
}

// "Stats - Online 0 FPS 30.0\nMemory - Mono 169MB, Heap 247MB\nWorld - Day 1, Objects 81, Dead objects 0"
export function parseServerStats(text) {
  const t = String(text);
  return {
    online: num(t.match(/Online (\d+)/)?.[1]),
    fps: num(t.match(/FPS ([\d.,]+)/)?.[1]),
    mono: num(t.match(/Mono (\d+)MB/)?.[1]),
    heap: num(t.match(/Heap (\d+)MB/)?.[1]),
    day: num(t.match(/Day (\d+)/)?.[1]),
    objects: num(t.match(/Objects (\d+)/)?.[1]),
    deadObjects: num(t.match(/Dead objects (\d+)/)?.[1]),
  };
}

export function parseTime(text) {
  const m = String(text).match(/time: ([\d.,]+) sec\. Day: (\d+)/);
  return m ? { seconds: num(m[1]), day: Number(m[2]) } : null;
}

export function parseGlobalKeys(text) {
  return String(text)
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [key, value] = l.split(' : ');
      return { key, value: value ?? null };
    });
}

export function parseEvents(text) {
  const line = String(text).split('\n')[1] || '';
  return line.split(',').map((s) => s.trim()).filter(Boolean);
}

// ---------- Journal : code crossplay, version, connexions ----------

export function createJournalState() {
  return { joinCode: null, version: null, history: [] };
}

export function ingestJournalLine(state, line) {
  const time = line.slice(0, line.indexOf(' '));
  const push = (event) => {
    state.history.unshift({ time, ...event });
    if (state.history.length > 300) state.history.pop();
  };
  let m;
  if (line.includes('Initialize engine version')) state.joinCode = null;
  else if ((m = line.match(/with join code (\d+)/))) state.joinCode = m[1];
  else if ((m = line.match(/Valheim version: (\S+)/))) state.version = m[1];
  else if ((m = line.match(/Got character ZDOID from (.+?) : (-?\d+):/))) push({ type: m[2] === '0' ? 'death' : 'join', name: m[1] });
  else if ((m = line.match(/Closing socket (\S+)/))) push({ type: 'leave', id: m[1] });
  else if ((m = line.match(/Got connection SteamID (\S+)/))) push({ type: 'connect', id: m[1] });
  else if ((m = line.match(/Peer (\S+) has wrong password/))) push({ type: 'badpass', id: m[1] });
  else if (/systemd\[1\]: Started valheim\.service|\[hearthwatch\] Server starting/.test(line)) push({ type: 'start' });
  else if (/systemd\[1\]: Stopped valheim\.service|\[hearthwatch\] Server stopped/.test(line)) push({ type: 'stop' });
}
