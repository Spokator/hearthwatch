using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using BepInEx;
using BepInEx.Configuration;
using UnityEngine;

namespace HearthwatchArena
{
    // Arène de combat par vagues, 100 % côté serveur : les joueurs (consoles comprises) n'installent rien.
    // Le panel Hearthwatch pilote le plugin par des fichiers de commande et lit son état exporté.
    [BepInPlugin(Guid, Name, Version)]
    public class Plugin : BaseUnityPlugin
    {
        public const string Guid = "hearthwatch.arena";
        public const string Name = "Hearthwatch Arena";
        public const string Version = "0.1.0";

        private ConfigEntry<string> _outputDir;
        private ConfigEntry<string> _language;
        private ConfigEntry<int> _waves;
        private ConfigEntry<float> _rewardMultiplier;
        private ConfigEntry<int> _cooldown;

        private static readonly HarmonyLib.AccessTools.FieldRef<ZoneSystem, HashSet<Vector2s>> GeneratedZones =
            HarmonyLib.AccessTools.FieldRefAccess<ZoneSystem, HashSet<Vector2s>>("m_generatedZones");

        private readonly Settings _settings = new Settings();
        private ArenaSite _site;
        private Match _match;
        private readonly List<Record> _records = new List<Record>();
        private readonly List<string> _results = new List<string>();
        private readonly List<string> _log = new List<string>();

        private string _worldKey;
        private float _nextTick;
        private float _nextExport;
        private float _nextCommands;
        private bool _dirty;

        private void Awake()
        {
            _outputDir = Config.Bind("General", "OutputDirectory", "", "Dossier d'échange avec le panel. Vide = <savedir>/panelmap");
            _language = Config.Bind("General", "Language", "fr", "Langue des messages en jeu : fr ou en");
            _waves = Config.Bind("Arena", "Waves", 10, "Nombre de vagues pour remporter un combat");
            _rewardMultiplier = Config.Bind("Arena", "RewardMultiplier", 1f, "Multiplicateur des récompenses");
            _cooldown = Config.Bind("Arena", "CooldownSeconds", 60, "Repos de l'arène entre deux combats");
            _language.SettingChanged += (_, __) => Tables.Language = _language.Value == "en" ? "en" : "fr";
            Tables.Language = _language.Value == "en" ? "en" : "fr";
            Logger.LogInfo($"{Name} {Version} loaded");
        }

        private string OutputDir
        {
            get
            {
                if (!string.IsNullOrWhiteSpace(_outputDir.Value)) return _outputDir.Value;
                var args = Environment.GetCommandLineArgs();
                for (var i = 0; i < args.Length - 1; i++)
                    if (args[i] == "-savedir") return Path.Combine(args[i + 1], "panelmap");
                return Path.Combine(Paths.GameRootPath, "panelmap");
            }
        }

        private string DataFile => Path.Combine(OutputDir, "arena.json");
        private string StateFile => Path.Combine(OutputDir, "arena-state.json");
        private string CommandDir => Path.Combine(OutputDir, "arena-cmd");

        private void Update()
        {
            if (!Game.WorldReady)
            {
                _worldKey = null;
                return;
            }
            var key = ZNet.World.m_name + "-" + ZNet.World.m_seed;
            if (key != _worldKey)
            {
                _worldKey = key;
                Directory.CreateDirectory(OutputDir);
                Directory.CreateDirectory(CommandDir);
                Safe("load", Load);
                Safe("prefabs", DumpPrefabs);
            }
            var now = Time.time;
            if (now >= _nextCommands)
            {
                _nextCommands = now + 1f;
                Safe("commands", ProcessCommands);
            }
            if (_match != null && now >= _nextTick)
            {
                _nextTick = now + 0.5f;
                var before = _match.Current;
                Safe("match", _match.Tick);
                if (_match.Current != before) _dirty = true;
            }
            if (now >= _nextExport || _dirty)
            {
                _nextExport = now + 2f;
                _dirty = false;
                Safe("export", ExportState);
            }
        }

        private void Safe(string label, Action action)
        {
            try { action(); }
            catch (Exception ex) { Logger.LogError($"{label} failed: {ex}"); }
        }

        private void Log(string message)
        {
            Logger.LogInfo(message);
            _log.Add(DateTime.UtcNow.ToString("HH:mm:ss") + " " + message);
            if (_log.Count > 40) _log.RemoveAt(0);
            _dirty = true;
        }

        // ---------- Commandes du panel ----------

        private void ProcessCommands()
        {
            var files = Directory.GetFiles(CommandDir, "*.txt");
            if (files.Length == 0) return;
            Array.Sort(files, StringComparer.Ordinal);
            foreach (var file in files)
            {
                Dictionary<string, string> cmd;
                try { cmd = Files.ReadKeyValues(file); }
                catch (Exception ex) { Logger.LogWarning($"Unreadable command {file}: {ex.Message}"); File.Delete(file); continue; }
                File.Delete(file);
                var id = cmd.TryGetValue("id", out var cid) ? cid : Path.GetFileNameWithoutExtension(file);
                cmd.TryGetValue("op", out var op);
                string message;
                var ok = true;
                try { message = Execute(op ?? "", cmd); }
                catch (Exception ex) { ok = false; message = ex.Message; Logger.LogWarning($"Command {op} failed: {ex}"); }
                _results.Add("{\"id\":" + Json.Str(id) + ",\"op\":" + Json.Str(op) + ",\"ok\":" + (ok ? "true" : "false") + ",\"message\":" + Json.Str(message) + ",\"time\":" + DateTimeOffset.UtcNow.ToUnixTimeSeconds() + "}");
                if (_results.Count > 20) _results.RemoveAt(0);
                _dirty = true;
            }
        }

        private string Execute(string op, Dictionary<string, string> cmd)
        {
            switch (op)
            {
                case "build":
                {
                    if (_site != null) throw new InvalidOperationException("Une arène existe déjà : démolis-la d'abord");
                    Vector3 origin;
                    if (cmd.TryGetValue("player", out var playerName) && !string.IsNullOrEmpty(playerName))
                    {
                        var peer = Game.FindPeer(playerName) ?? throw new InvalidOperationException("Joueur introuvable (déconnecté ?)");
                        var zdo = Game.PlayerZdo(peer) ?? throw new InvalidOperationException("Joueur sans personnage (mort ?)");
                        origin = zdo.GetPosition();
                    }
                    else
                    {
                        origin = new Vector3(Num(cmd, "x"), 0f, Num(cmd, "z"));
                        // Une zone jamais visitée ferait pousser arbres et rochers dans l'arène à sa première génération.
                        var generated = GeneratedZones(ZoneSystem.instance);
                        foreach (var corner in new[] { origin, origin + new Vector3(16f, 0f, 16f), origin + new Vector3(-16f, 0f, -16f), origin + new Vector3(16f, 0f, -16f), origin + new Vector3(-16f, 0f, 16f) })
                            if (!generated.Contains(ZoneSystem.GetZone(corner)))
                                throw new InvalidOperationException("Zone jamais explorée : un joueur doit d'abord s'y rendre");
                    }
                    Vector3 center;
                    float floorY;
                    if (cmd.TryGetValue("exact", out var exact) && exact == "1")
                    {
                        if (!ArenaBuilder.Score(origin, out var score, out floorY)) throw new InvalidOperationException("Emplacement dans l'eau ou en mer");
                        if (score > 3f) throw new InvalidOperationException($"Terrain trop accidenté ici ({score:0.0} m de dénivelé) : aplanis-le à la houe ou choisis un autre endroit");
                        center = new Vector3(origin.x, floorY, origin.z);
                    }
                    else if (!ArenaBuilder.FindFlatSpot(origin, out center, out floorY))
                        throw new InvalidOperationException("Aucun terrain assez plat à proximité : essaie depuis une prairie ou une plaine");

                    _site = ArenaBuilder.Build(center, floorY);
                    _match = new Match(_site, _settings, OnFinished, Log);
                    Save();
                    Log($"Arène construite en {center.x:0},{center.z:0} ({_site.Pieces.Count} pièces)");
                    var missing = ArenaBuilder.MissingPrefabs.Count > 0 ? " — prefabs inconnus : " + string.Join(", ", ArenaBuilder.MissingPrefabs) : "";
                    return $"Arène construite en X {center.x:0} / Z {center.z:0}, {_site.Pieces.Count} pièces{missing}";
                }
                case "demolish":
                {
                    if (_site == null) throw new InvalidOperationException("Aucune arène");
                    _match?.Abort("démolition");
                    var removed = ArenaBuilder.Demolish(_site);
                    _site = null;
                    _match = null;
                    Save();
                    Log($"Arène démolie ({removed} pièces)");
                    return $"Arène démolie : {removed} pièces retirées";
                }
                case "start":
                {
                    if (_site == null || _match == null) throw new InvalidOperationException("Aucune arène");
                    if (_match.Active) throw new InvalidOperationException("Un combat est déjà en cours");
                    var peers = new List<ZNetPeer>();
                    if (cmd.TryGetValue("player", out var name) && !string.IsNullOrEmpty(name))
                    {
                        var peer = Game.FindPeer(name) ?? throw new InvalidOperationException("Joueur introuvable");
                        var zdo = Game.PlayerZdo(peer) ?? throw new InvalidOperationException("Joueur sans personnage");
                        ZRoutedRpc.instance.InvokeRoutedRPC(zdo.GetOwner(), zdo.m_uid, "RPC_TeleportTo", new Vector3(_site.Center.x, _site.FloorY + 1f, _site.Center.z), Quaternion.identity, true);
                        peers.Add(peer);
                    }
                    else
                    {
                        foreach (var peer in ZNet.instance.GetPeers())
                        {
                            var zdo = Game.PlayerZdo(peer);
                            if (zdo != null && _site.Inside(zdo.GetPosition())) peers.Add(peer);
                        }
                        if (peers.Count == 0) throw new InvalidOperationException("Personne dans l'arène");
                    }
                    var tier = cmd.TryGetValue("tier", out var t) && int.TryParse(t, out var forced) && forced > 0 ? forced : 0;
                    if (tier == 0)
                    {
                        var saved = _settings.ForceTier;
                        _match.Start(peers, saved > 0 ? saved : 1);
                        if (saved == 0) _match.Tier = Mathf.Clamp(Mathf.Max(1, _match.Tier), 1, Tables.MaxTier);
                    }
                    else _match.Start(peers, tier);
                    return $"Combat lancé au palier {_match.Tier} avec {peers.Count} combattant(s)";
                }
                case "stop":
                    if (_match == null || !_match.Active) throw new InvalidOperationException("Aucun combat en cours");
                    _match.Abort("arrêt depuis le panel");
                    return "Combat arrêté";
                case "settings":
                    if (cmd.TryGetValue("forceTier", out var ft) && int.TryParse(ft, out var ftv)) _settings.ForceTier = Mathf.Clamp(ftv, 0, Tables.MaxTier);
                    if (cmd.TryGetValue("waves", out var w) && int.TryParse(w, out var wv)) _settings.Waves = Mathf.Clamp(wv, 3, 30);
                    if (cmd.TryGetValue("rewardMultiplier", out var rm) && float.TryParse(rm, NumberStyles.Float, CultureInfo.InvariantCulture, out var rmv)) _settings.RewardMultiplier = Mathf.Clamp(rmv, 0.25f, 5f);
                    if (cmd.TryGetValue("cooldown", out var cd) && int.TryParse(cd, out var cdv)) _settings.CooldownSeconds = Mathf.Clamp(cdv, 0, 3600);
                    if (cmd.TryGetValue("language", out var lang)) { Tables.Language = lang == "en" ? "en" : "fr"; _language.Value = Tables.Language; }
                    Save();
                    return "Réglages enregistrés";
                case "clear-records":
                    _records.Clear();
                    Save();
                    return "Classement effacé";
                default:
                    throw new InvalidOperationException("Commande inconnue : " + op);
            }
        }

        private static float Num(Dictionary<string, string> cmd, string key)
        {
            if (!cmd.TryGetValue(key, out var raw) || !float.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var v))
                throw new InvalidOperationException("Paramètre manquant : " + key);
            return v;
        }

        private void OnFinished(Record record)
        {
            _records.Insert(0, record);
            if (_records.Count > 200) _records.RemoveRange(200, _records.Count - 200);
            var best = true;
            foreach (var r in _records)
                if (r != record && (r.Tier > record.Tier || (r.Tier == record.Tier && r.Wave >= record.Wave))) { best = false; break; }
            if (best && record.Wave > 0)
                foreach (var f in _match.Fighters) Game.Screen(Tables.T("Nouveau record : vague {0} au palier {1} !", record.Wave, record.Tier), f.PeerId, center: false);
            Save();
        }

        // ---------- Persistance ----------

        private void Load()
        {
            _site = null;
            _match = null;
            _records.Clear();
            if (!File.Exists(DataFile)) return;
            var root = Json.Obj(Json.Parse(File.ReadAllText(DataFile, Encoding.UTF8)));
            if (root == null) return;
            if (root.TryGetValue("arena", out var arena)) _site = ArenaSite.Read(Json.Obj(arena));
            var settings = Json.Obj(root.TryGetValue("settings", out var s) ? s : null);
            if (settings != null)
            {
                _settings.ForceTier = (int)Json.Num(settings.TryGetValue("forceTier", out var v1) ? v1 : null);
                _settings.Waves = (int)Json.Num(settings.TryGetValue("waves", out var v2) ? v2 : null, 10);
                _settings.RewardMultiplier = (float)Json.Num(settings.TryGetValue("rewardMultiplier", out var v3) ? v3 : null, 1);
                _settings.CooldownSeconds = (int)Json.Num(settings.TryGetValue("cooldown", out var v4) ? v4 : null, 60);
            }
            else
            {
                _settings.Waves = _waves.Value;
                _settings.RewardMultiplier = _rewardMultiplier.Value;
                _settings.CooldownSeconds = _cooldown.Value;
            }
            var records = Json.Arr(root.TryGetValue("records", out var rs) ? rs : null);
            if (records != null)
                foreach (var item in records)
                {
                    var o = Json.Obj(item);
                    if (o == null) continue;
                    var r = new Record
                    {
                        Date = Json.Text(o.TryGetValue("date", out var d) ? d : null),
                        Tier = (int)Json.Num(o.TryGetValue("tier", out var t) ? t : null),
                        Wave = (int)Json.Num(o.TryGetValue("wave", out var w) ? w : null),
                        Seconds = (int)Json.Num(o.TryGetValue("seconds", out var sec) ? sec : null),
                        Deaths = (int)Json.Num(o.TryGetValue("deaths", out var de) ? de : null),
                        Outcome = Json.Text(o.TryGetValue("outcome", out var oc) ? oc : null),
                    };
                    var names = Json.Arr(o.TryGetValue("names", out var n) ? n : null);
                    if (names != null) foreach (var name in names) r.Names.Add(Json.Text(name));
                    _records.Add(r);
                }
            if (_site != null)
            {
                // Les pièces ont pu être détruites par les joueurs : on ne garde que celles qui existent encore.
                _site.Pieces.RemoveAll(id => ZDOMan.instance.GetZDO(id) == null);
                _match = new Match(_site, _settings, OnFinished, Log);
            }
            Logger.LogInfo(_site != null ? $"Arena loaded at {_site.Center.x:0},{_site.Center.z:0} ({_site.Pieces.Count} pieces, {_records.Count} records)" : "No arena yet");
        }

        private void Save()
        {
            var sb = new StringBuilder(4096);
            sb.Append("{\"version\":1,\"arena\":");
            if (_site == null) sb.Append("null");
            else _site.Write(sb);
            sb.Append(",\"settings\":").Append(SettingsJson());
            sb.Append(",\"records\":[");
            var first = true;
            foreach (var r in _records)
            {
                Json.Sep(sb, ref first);
                WriteRecord(sb, r);
            }
            sb.Append("]}");
            Files.WriteAtomic(DataFile, sb.ToString());
            _dirty = true;
        }

        private string SettingsJson() =>
            "{\"forceTier\":" + _settings.ForceTier + ",\"waves\":" + _settings.Waves + ",\"rewardMultiplier\":" + Json.F2(_settings.RewardMultiplier) +
            ",\"cooldown\":" + _settings.CooldownSeconds + ",\"language\":" + Json.Str(Tables.Language) + "}";

        private static void WriteRecord(StringBuilder sb, Record r)
        {
            sb.Append("{\"date\":").Append(Json.Str(r.Date)).Append(",\"tier\":").Append(r.Tier).Append(",\"wave\":").Append(r.Wave)
              .Append(",\"seconds\":").Append(r.Seconds).Append(",\"deaths\":").Append(r.Deaths).Append(",\"outcome\":").Append(Json.Str(r.Outcome)).Append(",\"names\":[");
            var first = true;
            foreach (var n in r.Names) { Json.Sep(sb, ref first); sb.Append(Json.Str(n)); }
            sb.Append("]}");
        }

        // ---------- État pour le panel ----------

        private void ExportState()
        {
            var sb = new StringBuilder(8192);
            sb.Append("{\"time\":").Append(DateTimeOffset.UtcNow.ToUnixTimeSeconds()).Append(",\"plugin\":").Append(Json.Str(Version));
            sb.Append(",\"arena\":");
            if (_site == null) sb.Append("null");
            else _site.Write(sb);
            sb.Append(",\"settings\":").Append(SettingsJson());
            sb.Append(",\"match\":");
            if (_match == null) sb.Append("null");
            else _match.Write(sb);
            sb.Append(",\"tiers\":[");
            for (var t = 1; t <= Tables.MaxTier; t++)
            {
                if (t > 1) sb.Append(',');
                sb.Append(Json.Str(Tables.Tiers[t].Name));
            }
            sb.Append("],\"players\":[");
            var first = true;
            foreach (var peer in ZNet.instance.GetPeers())
            {
                var zdo = Game.PlayerZdo(peer);
                Json.Sep(sb, ref first);
                var inside = zdo != null && _site != null && _site.Inside(zdo.GetPosition());
                var gear = 0;
                if (zdo != null)
                    foreach (var slot in new[] { ZDOVars.s_rightItem, ZDOVars.s_leftItem, ZDOVars.s_chestItem, ZDOVars.s_legItem, ZDOVars.s_helmetItem, ZDOVars.s_shoulderItem })
                    {
                        var hash = zdo.GetInt(slot);
                        if (hash != 0) gear = Mathf.Max(gear, Tables.GearTier(Game.PrefabName(hash)));
                    }
                sb.Append("{\"name\":").Append(Json.Str(peer.m_playerName)).Append(",\"inside\":").Append(inside ? "true" : "false").Append(",\"gearTier\":").Append(gear).Append('}');
            }
            sb.Append("],\"records\":[");
            first = true;
            var shown = 0;
            foreach (var r in _records)
            {
                if (shown++ >= 50) break;
                Json.Sep(sb, ref first);
                WriteRecord(sb, r);
            }
            sb.Append("],\"missingPrefabs\":[");
            first = true;
            foreach (var m in ArenaBuilder.MissingPrefabs) { Json.Sep(sb, ref first); sb.Append(Json.Str(m)); }
            sb.Append("],\"commands\":[").Append(string.Join(",", _results)).Append("],\"log\":[");
            first = true;
            foreach (var line in _log) { Json.Sep(sb, ref first); sb.Append(Json.Str(line)); }
            sb.Append("]}");
            Files.WriteAtomic(StateFile, sb.ToString());
        }

        // Liste de tous les prefabs du jeu, utile pour ajuster les tables après une mise à jour.
        private void DumpPrefabs()
        {
            var path = Path.Combine(OutputDir, "prefabs.txt");
            if (File.Exists(path) && (DateTime.UtcNow - File.GetLastWriteTimeUtc(path)).TotalDays < 1) return;
            var sb = new StringBuilder(64 * 1024);
            foreach (var prefab in ZNetScene.instance.m_prefabs)
                if (prefab != null) sb.Append(prefab.name).Append('\n');
            Files.WriteAtomic(path, sb.ToString());
        }
    }
}
