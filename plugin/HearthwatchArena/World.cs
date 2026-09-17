using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using HarmonyLib;
using UnityEngine;

namespace HearthwatchArena
{
    // Corps du « monde vivant » : le plugin voit et agit, le panel (cerveau) décide.
    //
    // Événements écrits dans <panelmap>/world/events.jsonl (une ligne JSON par événement) :
    //   chat (un joueur parle), kill (un joueur tue une créature), join/leave, npc-dead, counter (contenu d'un coffre de
    //   remise modifié), petition (texte écrit sur un pupitre), result (réponse à une commande).
    // État complet dans <panelmap>/world/state.json toutes les 2 s : heure du jeu, clés de progression, joueurs, PNJ,
    //   coffres de remise.
    // Commandes lues dans <panelmap>/world/cmd/*.json : npc-sync, say, message, give, counter-take, counter-put, emote.
    //
    // Tout passe par des mécanismes du jeu de base : bulles de chat, nom au survol, point de patrouille de l'IA,
    // messages à l'écran, objets déposés. Les joueurs n'installent rien.
    internal sealed class WorldService
    {
        public static WorldService Instance;

        public static readonly int NpcMark = "HearthwatchNpc".GetStableHashCode();
        public static readonly int CounterMark = "HearthwatchCounter".GetStableHashCode();
        public static readonly int PetitionMark = "HearthwatchPetition".GetStableHashCode();

        private static readonly int SayHash = "Say".GetStableHashCode();
        private static readonly int ChatHash = "ChatMessage".GetStableHashCode();
        private static readonly int DamageHash = "RPC_Damage".GetStableHashCode();

        private static readonly AccessTools.FieldRef<ZDOMan, Dictionary<ZDOID, ZDO>> ObjectsById =
            AccessTools.FieldRefAccess<ZDOMan, Dictionary<ZDOID, ZDO>>("m_objectsByID");

        private readonly string _dir;
        private readonly string _cmdDir;
        private readonly string _eventsPath;
        private readonly Action<string> _log;
        private readonly List<string> _pending = new List<string>();
        private readonly Dictionary<string, float> _recentChat = new Dictionary<string, float>();
        private readonly Dictionary<ZDOID, KeyValuePair<ZDOID, float>> _lastHit = new Dictionary<ZDOID, KeyValuePair<ZDOID, float>>();
        private readonly Dictionary<int, bool> _isCharacter = new Dictionary<int, bool>();
        private readonly Dictionary<int, NpcDef> _npcs = new Dictionary<int, NpcDef>();
        private readonly Dictionary<int, ZDOID> _npcZdos = new Dictionary<int, ZDOID>();
        private readonly Dictionary<int, float> _npcDeadUntil = new Dictionary<int, float>();
        private readonly Dictionary<int, float> _npcHitAt = new Dictionary<int, float>();
        private readonly Dictionary<ZDOID, uint> _counterRevisions = new Dictionary<ZDOID, uint>();
        private readonly Dictionary<ZDOID, string> _petitionTexts = new Dictionary<ZDOID, string>();
        private readonly List<ZDOID> _counters = new List<ZDOID>();
        private readonly List<ZDOID> _petitions = new List<ZDOID>();
        private readonly HashSet<long> _peers = new HashSet<long>();
        private bool _npcsKnown;
        private float _nextState;
        private float _nextCommands;
        private float _nextNpcs;
        private float _nextScan;

        private sealed class NpcDef
        {
            public int Id;
            public string Key;
            public string Prefab;
            public string Hover;
            public Vector3 Target;
            public float Respawn = 120f;
        }

        public WorldService(string panelDir, Action<string> log)
        {
            _dir = Path.Combine(panelDir, "world");
            _cmdDir = Path.Combine(_dir, "cmd");
            _eventsPath = Path.Combine(_dir, "events.jsonl");
            _log = log;
            Directory.CreateDirectory(_cmdDir);
            Instance = this;
        }

        public void Update()
        {
            var now = Time.time;
            if (now >= _nextScan)
            {
                _nextScan = now + 15f;
                Scan();
            }
            if (now >= _nextCommands)
            {
                _nextCommands = now + 0.5f;
                ProcessCommands();
            }
            if (now >= _nextNpcs)
            {
                _nextNpcs = now + 3f;
                MaintainNpcs();
                WatchContainers();
            }
            if (now >= _nextState)
            {
                _nextState = now + 2f;
                WatchPeers();
                ExportState();
                ForgetOldHits(now);
            }
            Flush();
        }

        // ---------- Événements ----------

        private void Emit(string type, StringBuilder fields)
        {
            var line = new StringBuilder(128)
                .Append("{\"t\":").Append(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
                .Append(",\"type\":").Append(Json.Str(type));
            if (fields != null && fields.Length > 0) line.Append(',').Append(fields);
            _pending.Add(line.Append('}').ToString());
        }

        private void Flush()
        {
            if (_pending.Count == 0) return;
            try
            {
                var info = new FileInfo(_eventsPath);
                if (info.Exists && info.Length > 4 * 1024 * 1024)
                {
                    var old = Path.Combine(_dir, "events.1.jsonl");
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(_eventsPath, old);
                }
                File.AppendAllText(_eventsPath, string.Join("\n", _pending) + "\n", new UTF8Encoding(false));
                _pending.Clear();
            }
            catch (IOException)
            {
                // Le panel lit peut-être le fichier : on réessaie à la prochaine image.
            }
        }

        private static StringBuilder PlayerFields(ZNetPeer peer)
        {
            var sb = new StringBuilder();
            sb.Append("\"player\":").Append(Json.Str(peer.m_playerName))
              .Append(",\"peer\":").Append(peer.m_uid.ToString(CultureInfo.InvariantCulture))
              .Append(",\"account\":").Append(Json.Str(Account(peer)));
            return sb;
        }

        private static string Account(ZNetPeer peer)
        {
            try { return peer.m_socket?.GetHostName() ?? ""; }
            catch (Exception) { return ""; }
        }

        private static void Pos(StringBuilder sb, Vector3 p)
        {
            sb.Append(",\"x\":").Append(Json.F(p.x)).Append(",\"y\":").Append(Json.F(p.y)).Append(",\"z\":").Append(Json.F(p.z));
        }

        // Appelé pour chaque message routé qui transite par le serveur (voir RoutedPatch).
        public void OnRouted(ZPackage pkg)
        {
            var array = pkg.GetArray();
            if (array == null || array.Length < 44) return;
            var hash = BitConverter.ToInt32(array, 36);
            if (hash != SayHash && hash != ChatHash && hash != DamageHash) return;
            var data = new ZRoutedRpc.RoutedRPCData();
            data.Deserialize(new ZPackage(array));
            var p = data.m_parameters;
            p.SetPos(0);
            if (hash == DamageHash)
            {
                var hit = new HitData();
                hit.Deserialize(ref p);
                if (!hit.m_attacker.IsNone() && !data.m_targetZDO.IsNone())
                {
                    _lastHit[data.m_targetZDO] = new KeyValuePair<ZDOID, float>(hit.m_attacker, Time.time);
                    // Un joueur frappe un habitant : la ville réagit (au plus une fois toutes les 5 s par habitant).
                    var target = ZDOMan.instance.GetZDO(data.m_targetZDO);
                    var npcId = target != null ? target.GetInt(NpcMark) : 0;
                    if (npcId != 0 && (!_npcHitAt.TryGetValue(npcId, out var last) || Time.time - last > 5f))
                        foreach (var attacker in ZNet.instance.GetPeers())
                            if (attacker.m_characterID == hit.m_attacker)
                            {
                                _npcHitAt[npcId] = Time.time;
                                var fields = PlayerFields(attacker);
                                fields.Append(",\"npc\":").Append(npcId.ToString(CultureInfo.InvariantCulture));
                                Emit("npc-hit", fields);
                            }
                }
                return;
            }
            Vector3 position;
            int type;
            if (hash == ChatHash)
            {
                position = p.ReadVector3();
                type = p.ReadInt();
            }
            else
            {
                type = p.ReadInt();
                position = Vector3.zero;
            }
            p.ReadString(); // nom affiché
            p.ReadString(); // identifiant de plateforme
            var text = p.ReadString();
            if (type == 3 || string.IsNullOrWhiteSpace(text)) return; // ping
            var peer = ZNet.instance.GetPeer(data.m_senderPeerID);
            if (peer == null) return;
            var key = peer.m_uid + "|" + text;
            if (_recentChat.TryGetValue(key, out var seen) && Time.time - seen < 3f) return;
            _recentChat[key] = Time.time;
            if (_recentChat.Count > 200) _recentChat.Clear();
            var zdo = Game.PlayerZdo(peer);
            if (zdo != null) position = zdo.GetPosition();
            var sb = PlayerFields(peer);
            sb.Append(",\"mode\":").Append(Json.Str(type == 2 ? "shout" : type == 0 ? "whisper" : "say"))
              .Append(",\"text\":").Append(Json.Str(text.Length > 400 ? text.Substring(0, 400) : text));
            Pos(sb, position);
            Emit("chat", sb);
        }

        public void OnDestroyed(ZDOID uid)
        {
            var zdo = ZDOMan.instance.GetZDO(uid);
            if (zdo == null) return;
            var npc = zdo.GetInt(NpcMark);
            if (npc != 0)
            {
                _npcZdos.Remove(npc);
                if (_npcs.TryGetValue(npc, out var def)) _npcDeadUntil[npc] = Time.time + def.Respawn;
                var sb = new StringBuilder().Append("\"npc\":").Append(npc.ToString(CultureInfo.InvariantCulture));
                if (_npcs.TryGetValue(npc, out var d)) sb.Append(",\"key\":").Append(Json.Str(d.Key));
                var killer = KillerOf(uid);
                if (killer != null) sb.Append(",\"killer\":").Append(Json.Str(killer.m_playerName));
                Pos(sb, zdo.GetPosition());
                Emit("npc-dead", sb);
                return;
            }
            if (!IsCharacter(zdo.GetPrefab())) return;
            var player = KillerOf(uid);
            if (player == null) return;
            var fields = PlayerFields(player);
            fields.Append(",\"prefab\":").Append(Json.Str(Game.PrefabName(zdo.GetPrefab())))
                  .Append(",\"level\":").Append(zdo.GetInt(ZDOVars.s_level, 1).ToString(CultureInfo.InvariantCulture));
            Pos(fields, zdo.GetPosition());
            Emit("kill", fields);
        }

        private ZNetPeer KillerOf(ZDOID target)
        {
            if (!_lastHit.TryGetValue(target, out var hit) || Time.time - hit.Value > 60f) return null;
            _lastHit.Remove(target);
            foreach (var peer in ZNet.instance.GetPeers())
                if (peer.m_characterID == hit.Key) return peer;
            return null;
        }

        private bool IsCharacter(int prefabHash)
        {
            if (_isCharacter.TryGetValue(prefabHash, out var known)) return known;
            var prefab = ZNetScene.instance.GetPrefab(prefabHash);
            var result = prefab != null && prefab.GetComponent<Character>() != null && prefab.GetComponent<Player>() == null;
            _isCharacter[prefabHash] = result;
            return result;
        }

        private void ForgetOldHits(float now)
        {
            if (_lastHit.Count < 500) return;
            var stale = new List<ZDOID>();
            foreach (var pair in _lastHit) if (now - pair.Value.Value > 60f) stale.Add(pair.Key);
            foreach (var id in stale) _lastHit.Remove(id);
        }

        private void WatchPeers()
        {
            var current = new HashSet<long>();
            foreach (var peer in ZNet.instance.GetPeers())
            {
                if (peer.m_characterID.IsNone()) continue;
                current.Add(peer.m_uid);
                if (!_peers.Contains(peer.m_uid)) Emit("join", PlayerFields(peer));
            }
            foreach (var uid in _peers)
                if (!current.Contains(uid))
                    Emit("leave", new StringBuilder().Append("\"peer\":").Append(uid.ToString(CultureInfo.InvariantCulture)));
            _peers.Clear();
            _peers.UnionWith(current);
        }

        // ---------- PNJ ----------

        // Retrouve les PNJ, coffres de remise et pupitres marqués (au chargement, puis toutes les 15 s).
        private void Scan()
        {
            _npcZdos.Clear();
            _counters.Clear();
            _petitions.Clear();
            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
            {
                var npc = zdo.GetInt(NpcMark);
                if (npc != 0)
                {
                    if (_npcZdos.ContainsKey(npc)) Game.Destroy(zdo); // doublon
                    else _npcZdos[npc] = zdo.m_uid;
                    continue;
                }
                if (zdo.GetInt(CounterMark) != 0) _counters.Add(zdo.m_uid);
                if (zdo.GetInt(PetitionMark) != 0) _petitions.Add(zdo.m_uid);
            }
        }

        private void MaintainNpcs()
        {
            if (!_npcsKnown) return;
            // PNJ retirés du registre.
            foreach (var pair in new List<KeyValuePair<int, ZDOID>>(_npcZdos))
                if (!_npcs.ContainsKey(pair.Key))
                {
                    Game.Destroy(pair.Value);
                    _npcZdos.Remove(pair.Key);
                }
            var players = new List<Vector3>();
            foreach (var peer in ZNet.instance.GetPeers())
            {
                var pz = Game.PlayerZdo(peer);
                if (pz != null) players.Add(pz.GetPosition());
            }
            foreach (var def in _npcs.Values)
            {
                ZDO zdo = null;
                if (_npcZdos.TryGetValue(def.Id, out var id)) zdo = ZDOMan.instance.GetZDO(id);
                if (zdo == null)
                {
                    if (_npcDeadUntil.TryGetValue(def.Id, out var until) && Time.time < until) continue;
                    var prefab = ZNetScene.instance.GetPrefab(def.Prefab);
                    if (prefab == null) continue;
                    zdo = Game.Spawn(prefab, def.Target + Vector3.up * 0.2f, Quaternion.Euler(0f, UnityEngine.Random.Range(0f, 360f), 0f));
                    zdo.Set(NpcMark, def.Id);
                    zdo.Set(ZDOVars.s_spawnPoint, def.Target);
                    _npcZdos[def.Id] = zdo.m_uid;
                    _npcDeadUntil.Remove(def.Id);
                }
                if (zdo.GetString(ZDOVars.s_overrideHoverName) != def.Hover) zdo.Set(ZDOVars.s_overrideHoverName, def.Hover);
                var patrol = zdo.GetVec3(ZDOVars.s_patrolPoint, Vector3.zero);
                if (!zdo.GetBool(ZDOVars.s_patrol) || (patrol - def.Target).sqrMagnitude > 0.25f)
                {
                    zdo.Set(ZDOVars.s_patrolPoint, def.Target);
                    zdo.Set(ZDOVars.s_patrol, true);
                }
                // Sans joueur à proximité personne ne simule le PNJ : il « arrive » directement à destination, pour que
                // les routines continuent même dans les quartiers vides.
                var here = zdo.GetPosition();
                var watched = false;
                foreach (var p in players)
                    if ((p - here).sqrMagnitude < 90f * 90f || (p - def.Target).sqrMagnitude < 90f * 90f) watched = true;
                if (!watched && (here - def.Target).sqrMagnitude > 9f)
                {
                    if (!zdo.IsOwner()) zdo.SetOwner(ZDOMan.GetSessionID());
                    zdo.SetPosition(def.Target);
                }
            }
        }

        // ---------- Coffres de remise et pupitres ----------

        private void WatchContainers()
        {
            foreach (var id in _counters)
            {
                var zdo = ZDOMan.instance.GetZDO(id);
                if (zdo == null) continue;
                var revision = zdo.DataRevision;
                if (_counterRevisions.TryGetValue(id, out var known) && known == revision) continue;
                _counterRevisions[id] = revision;
                var sb = new StringBuilder();
                sb.Append("\"counter\":").Append(zdo.GetInt(CounterMark).ToString(CultureInfo.InvariantCulture))
                  .Append(",\"zdo\":").Append(Json.Str(Game.ZdoId(id)));
                AppendOpener(sb, zdo);
                sb.Append(",\"items\":");
                AppendItems(sb, LoadInventory(zdo));
                Emit("counter", sb);
            }
            foreach (var id in _petitions)
            {
                var zdo = ZDOMan.instance.GetZDO(id);
                if (zdo == null) continue;
                var text = zdo.GetString(ZDOVars.s_text);
                if (_petitionTexts.TryGetValue(id, out var known) && known == text) continue;
                var first = !_petitionTexts.ContainsKey(id);
                _petitionTexts[id] = text;
                if (first || string.IsNullOrWhiteSpace(text)) continue;
                var sb = new StringBuilder();
                sb.Append("\"petition\":").Append(zdo.GetInt(PetitionMark).ToString(CultureInfo.InvariantCulture))
                  .Append(",\"text\":").Append(Json.Str(text))
                  .Append(",\"author\":").Append(Json.Str(zdo.GetString(ZDOVars.s_author)))
                  .Append(",\"authorName\":").Append(Json.Str(zdo.GetString(ZDOVars.s_authorDisplayName)));
                Pos(sb, zdo.GetPosition());
                Emit("petition", sb);
            }
        }

        private static void AppendOpener(StringBuilder sb, ZDO zdo)
        {
            var owner = zdo.GetOwner();
            foreach (var peer in ZNet.instance.GetPeers())
                if (peer.m_uid == owner)
                {
                    sb.Append(",\"player\":").Append(Json.Str(peer.m_playerName)).Append(",\"account\":").Append(Json.Str(Account(peer)));
                    return;
                }
        }

        private static Inventory LoadInventory(ZDO zdo)
        {
            var prefab = ZNetScene.instance.GetPrefab(zdo.GetPrefab());
            var container = prefab != null ? prefab.GetComponent<Container>() : null;
            var inventory = new Inventory("counter", null, container != null ? container.m_width : 8, container != null ? container.m_height : 4);
            var bytes = zdo.GetByteArray(ZDOVars.s_items);
            if (bytes != null && bytes.Length > 0) inventory.Load(new ZPackage(bytes));
            return inventory;
        }

        private static void SaveInventory(ZDO zdo, Inventory inventory)
        {
            var pkg = new ZPackage();
            inventory.Save(pkg);
            if (!zdo.IsOwner()) zdo.SetOwner(ZDOMan.GetSessionID());
            zdo.Set(ZDOVars.s_items, pkg.GetArray());
        }

        private static void AppendItems(StringBuilder sb, Inventory inventory)
        {
            sb.Append('[');
            var first = true;
            foreach (var item in inventory.GetAllItems())
            {
                if (item?.m_dropPrefab == null) continue;
                Json.Sep(sb, ref first);
                sb.Append('[').Append(Json.Str(item.m_dropPrefab.name)).Append(',').Append(item.m_stack).Append(',').Append(item.m_quality).Append(']');
            }
            sb.Append(']');
        }

        private ZDO FindCounter(int counter)
        {
            foreach (var id in _counters)
            {
                var zdo = ZDOMan.instance.GetZDO(id);
                if (zdo != null && zdo.GetInt(CounterMark) == counter) return zdo;
            }
            return null;
        }

        // ---------- Commandes ----------

        private void ProcessCommands()
        {
            string[] files;
            try { files = Directory.GetFiles(_cmdDir, "*.json"); }
            catch (IOException) { return; }
            if (files.Length == 0) return;
            Array.Sort(files, StringComparer.Ordinal);
            foreach (var file in files)
            {
                Dictionary<string, object> cmd = null;
                string text;
                try
                {
                    text = File.ReadAllText(file, Encoding.UTF8);
                    File.Delete(file);
                }
                catch (IOException)
                {
                    continue; // encore en cours d'écriture
                }
                string id = null;
                string op = null;
                var ok = true;
                string message;
                try
                {
                    cmd = Json.Obj(Json.Parse(text)) ?? throw new FormatException("objet attendu");
                    id = Json.Text(Get(cmd, "id"));
                    op = Json.Text(Get(cmd, "op")) ?? "";
                    message = Execute(op, cmd);
                }
                catch (Exception ex)
                {
                    ok = false;
                    message = ex.Message;
                    _log($"World command {op} failed: {ex.Message}");
                }
                if (id == null) continue;
                var sb = new StringBuilder();
                sb.Append("\"id\":").Append(Json.Str(id)).Append(",\"op\":").Append(Json.Str(op))
                  .Append(",\"ok\":").Append(ok ? "true" : "false").Append(",\"message\":").Append(Json.Str(message));
                Emit("result", sb);
            }
        }

        private static object Get(Dictionary<string, object> o, string key) => o != null && o.TryGetValue(key, out var v) ? v : null;

        private static float Num(Dictionary<string, object> o, string key, float def = 0f) => (float)Json.Num(Get(o, key), def);

        private static Vector3 Vec(object value)
        {
            var a = Json.Arr(value);
            if (a == null || a.Count < 3) throw new FormatException("position [x, y, z] attendue");
            return new Vector3((float)Json.Num(a[0]), (float)Json.Num(a[1]), (float)Json.Num(a[2]));
        }

        private string Execute(string op, Dictionary<string, object> cmd)
        {
            switch (op)
            {
                case "npc-sync":
                {
                    _npcs.Clear();
                    foreach (var entry in Json.Arr(Get(cmd, "npcs")) ?? new List<object>())
                    {
                        var o = Json.Obj(entry);
                        if (o == null) continue;
                        var def = new NpcDef
                        {
                            Id = (int)Json.Num(Get(o, "id")),
                            Key = Json.Text(Get(o, "key")),
                            Prefab = Json.Text(Get(o, "prefab")) ?? "Dverger",
                            Hover = Json.Text(Get(o, "hover")) ?? "",
                            Target = Vec(Get(o, "target")),
                            Respawn = Num(o, "respawn", 120f),
                        };
                        if (def.Id != 0) _npcs[def.Id] = def;
                    }
                    _npcsKnown = true;
                    MaintainNpcs();
                    return $"{_npcs.Count} PNJ";
                }
                case "say":
                {
                    var text = Json.Text(Get(cmd, "text")) ?? "";
                    var name = Json.Text(Get(cmd, "name")) ?? "";
                    var mode = Json.Text(Get(cmd, "mode")) ?? "say";
                    Vector3 position;
                    var npc = (int)Json.Num(Get(cmd, "npc"));
                    if (npc != 0)
                    {
                        if (!_npcZdos.TryGetValue(npc, out var zid) || ZDOMan.instance.GetZDO(zid) == null) throw new InvalidOperationException("PNJ absent");
                        position = ZDOMan.instance.GetZDO(zid).GetPosition() + Vector3.up * 2.1f;
                    }
                    else position = Vec(Get(cmd, "position"));
                    var type = mode == "shout" ? 2 : mode == "whisper" ? 0 : 1;
                    var range = Num(cmd, "range", type == 2 ? 120f : 25f);
                    var user = new SpeakerInfo { Name = name };
                    var targets = Json.Arr(Get(cmd, "peers"));
                    var sent = 0;
                    foreach (var peer in ZNet.instance.GetPeers())
                    {
                        if (targets != null && !targets.Exists(t => (long)Json.Num(t) == peer.m_uid)) continue;
                        var pz = Game.PlayerZdo(peer);
                        if (pz == null) continue;
                        if (targets == null && (pz.GetPosition() - position).sqrMagnitude > range * range) continue;
                        ZRoutedRpc.instance.InvokeRoutedRPC(peer.m_uid, "ChatMessage", position, type, user, text);
                        sent++;
                    }
                    return $"{sent} destinataire(s)";
                }
                case "message":
                {
                    var text = Json.Text(Get(cmd, "text")) ?? "";
                    var center = !(Get(cmd, "corner") is bool c && c);
                    var peers = Json.Arr(Get(cmd, "peers"));
                    if (peers == null)
                    {
                        Game.Screen(text, 0L, center);
                        return "tous";
                    }
                    foreach (var p in peers) Game.Screen(text, (long)Json.Num(p), center);
                    return $"{peers.Count} joueur(s)";
                }
                case "give":
                {
                    var peer = ZNet.instance.GetPeer((long)Json.Num(Get(cmd, "peer"))) ?? Game.FindPeer(Json.Text(Get(cmd, "player")))
                               ?? throw new InvalidOperationException("Joueur absent");
                    var pz = Game.PlayerZdo(peer) ?? throw new InvalidOperationException("Joueur sans personnage");
                    var given = 0;
                    foreach (var entry in Json.Arr(Get(cmd, "items")) ?? new List<object>())
                    {
                        var a = Json.Arr(entry);
                        if (a == null || a.Count < 2) continue;
                        var prefab = ZNetScene.instance.GetPrefab(Json.Text(a[0]));
                        if (prefab == null) continue;
                        Game.DropItems(prefab, (int)Json.Num(a[1]), a.Count > 2 ? (int)Json.Num(a[2], 1) : 1, pz.GetPosition());
                        given++;
                    }
                    return $"{given} objet(s) déposé(s)";
                }
                case "counter-take":
                case "counter-put":
                {
                    var zdo = FindCounter((int)Json.Num(Get(cmd, "counter"))) ?? throw new InvalidOperationException("Coffre introuvable");
                    if (zdo.GetInt(ZDOVars.s_inUse) == 1) throw new InvalidOperationException("Coffre ouvert");
                    var inventory = LoadInventory(zdo);
                    var entries = Json.Arr(Get(cmd, "items")) ?? new List<object>();
                    if (op == "counter-take")
                    {
                        // Tout ou rien : on vérifie d'abord que tout y est.
                        foreach (var entry in entries)
                        {
                            var a = Json.Arr(entry);
                            var drop = ZNetScene.instance.GetPrefab(Json.Text(a[0]))?.GetComponent<ItemDrop>() ?? throw new InvalidOperationException("Objet inconnu : " + Json.Text(a[0]));
                            if (inventory.CountItems(drop.m_itemData.m_shared.m_name) < (int)Json.Num(a[1])) throw new InvalidOperationException("Il manque " + Json.Text(a[0]));
                        }
                        foreach (var entry in entries)
                        {
                            var a = Json.Arr(entry);
                            var drop = ZNetScene.instance.GetPrefab(Json.Text(a[0])).GetComponent<ItemDrop>();
                            inventory.RemoveItem(drop.m_itemData.m_shared.m_name, (int)Json.Num(a[1]));
                        }
                    }
                    else
                    {
                        foreach (var entry in entries)
                        {
                            var a = Json.Arr(entry);
                            var prefab = ZNetScene.instance.GetPrefab(Json.Text(a[0]));
                            var drop = prefab != null ? prefab.GetComponent<ItemDrop>() : null;
                            if (drop == null) continue;
                            var item = drop.m_itemData.Clone();
                            item.m_dropPrefab = prefab;
                            item.m_stack = Mathf.Max(1, (int)Json.Num(a[1]));
                            item.m_quality = a.Count > 2 ? Mathf.Clamp((int)Json.Num(a[2], 1), 1, 4) : 1;
                            if (item.m_shared.m_useDurability) item.m_durability = item.GetMaxDurability();
                            if (!inventory.AddItem(item)) throw new InvalidOperationException("Coffre plein");
                        }
                    }
                    SaveInventory(zdo, inventory);
                    _counterRevisions[zdo.m_uid] = zdo.DataRevision;
                    return "ok";
                }
                default:
                    throw new InvalidOperationException("Commande inconnue : " + op);
            }
        }

        // ---------- État ----------

        private void ExportState()
        {
            var sb = new StringBuilder(4096);
            sb.Append("{\"time\":").Append(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            var env = EnvMan.instance;
            var seconds = ZNet.instance.GetTimeSeconds();
            sb.Append(",\"game\":{\"seconds\":").Append(Json.F2(seconds));
            // Le serveur ne fait pas avancer EnvMan : fraction du jour recalculée depuis l'horloge du monde (0 = minuit).
            var length = env != null && env.m_dayLengthSec > 0 ? env.m_dayLengthSec : 1800L;
            sb.Append(",\"day\":").Append((long)(seconds / length)).Append(",\"fraction\":").Append(Json.F2(seconds % length / length))
              .Append(",\"dayLength\":").Append(length);
            sb.Append('}');
            sb.Append(",\"keys\":[");
            var first = true;
            foreach (var key in ZoneSystem.instance.GetGlobalKeys())
            {
                Json.Sep(sb, ref first);
                sb.Append(Json.Str(key));
            }
            sb.Append("],\"players\":[");
            first = true;
            foreach (var peer in ZNet.instance.GetPeers())
            {
                var zdo = Game.PlayerZdo(peer);
                if (zdo == null) continue;
                Json.Sep(sb, ref first);
                sb.Append('{').Append(PlayerFields(peer));
                Pos(sb, zdo.GetPosition());
                sb.Append(",\"biome\":").Append(Json.Str(WorldGenerator.instance.GetBiome(zdo.GetPosition()).ToString()));
                sb.Append('}');
            }
            sb.Append("],\"npcs\":[");
            first = true;
            foreach (var pair in _npcZdos)
            {
                var zdo = ZDOMan.instance.GetZDO(pair.Value);
                if (zdo == null) continue;
                Json.Sep(sb, ref first);
                sb.Append("{\"id\":").Append(pair.Key.ToString(CultureInfo.InvariantCulture)).Append(",\"zdo\":").Append(Json.Str(Game.ZdoId(pair.Value)));
                Pos(sb, zdo.GetPosition());
                sb.Append('}');
            }
            sb.Append("],\"counters\":").Append(_counters.Count).Append(",\"petitions\":").Append(_petitions.Count).Append('}');
            Files.WriteAtomic(Path.Combine(_dir, "state.json"), sb.ToString());
        }
    }

    // Identité d'un PNJ dans un message de chat (même format réseau que UserInfo : nom, puis identifiant de plateforme).
    internal sealed class SpeakerInfo : ISerializableParameter
    {
        public string Name;

        public void Serialize(ref ZPackage pkg)
        {
            pkg.Write(Name ?? "");
            pkg.Write("Steam_0");
        }

        public void Deserialize(ref ZPackage pkg)
        {
            Name = pkg.ReadString();
            pkg.ReadString();
        }
    }

    [HarmonyPatch(typeof(ZRoutedRpc), "RPC_RoutedRPC")]
    internal static class RoutedPatch
    {
        private static void Prefix(ZPackage pkg)
        {
            var world = WorldService.Instance;
            if (world == null || ZNet.instance == null || !ZNet.instance.IsServer()) return;
            try { world.OnRouted(pkg); }
            catch (Exception)
            {
                // Un message inattendu ne doit jamais bloquer le routage du jeu.
            }
        }
    }

    [HarmonyPatch(typeof(ZDOMan), "HandleDestroyedZDO")]
    internal static class DestroyedPatch
    {
        private static void Prefix(ZDOID uid)
        {
            var world = WorldService.Instance;
            if (world == null || ZNet.instance == null || !ZNet.instance.IsServer()) return;
            try { world.OnDestroyed(uid); }
            catch (Exception)
            {
            }
        }
    }
}
