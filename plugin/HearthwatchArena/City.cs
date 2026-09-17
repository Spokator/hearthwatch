using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using HarmonyLib;
using UnityEngine;

namespace HearthwatchArena
{
    internal sealed class CityPiece
    {
        public string Prefab;
        public Vector3 Position;
        public float Rotation;
        public string Text;
        public bool Tamed;
    }

    internal sealed class Parcel
    {
        public int Id, Sign;
        public float X, Z, HalfW, HalfD, Rot;

        public bool Contains(Vector3 p) =>
            new PaintShape { Type = PaintShape.Rect, A = X, B = Z, C = HalfW, D = HalfD, E = Rot }.Contains(p.x, p.z);
    }

    // Plan de ville produit par le générateur du panel : coordonnées monde, prêtes à poser.
    internal sealed class CityPlan
    {
        public string Name = "";
        public string Emperor = "";
        public bool HasAnchor;
        public float AnchorX, AnchorZ, AnchorRadius;
        public readonly List<Parcel> Parcels = new List<Parcel>();
        public readonly List<(int Piece, string Tag, int Sign)> Portals = new List<(int, string, int)>();
        public readonly List<int> Boards = new List<int>();
        public int Proclamation = -1;
        public string Welcome = "";
        public float X, Z, FloorY, Radius, TerrainRadius, Blend = 10f;
        public readonly List<PaintShape> Paint = new List<PaintShape>();
        public Vector3 Spawn;
        public bool HasArena;
        public float ArenaX, ArenaZ, ArenaEntrance;
        public readonly List<CityPiece> Pieces = new List<CityPiece>();

        public Vector3 Center => new Vector3(X, FloorY, Z);

        public static CityPlan Parse(string text)
        {
            var root = Json.Obj(Json.Parse(text)) ?? throw new InvalidOperationException("Plan de ville illisible");
            var plan = new CityPlan
            {
                Name = Json.Text(Get(root, "name")) ?? "",
                Welcome = Json.Text(Get(root, "welcome")) ?? "",
                Emperor = Json.Text(Get(root, "emperor")) ?? "",
                FloorY = (float)Json.Num(Get(root, "floorY")),
                Radius = (float)Json.Num(Get(root, "radius")),
            };
            var center = Json.Arr(Get(root, "center")) ?? throw new InvalidOperationException("Plan sans centre");
            plan.X = (float)Json.Num(center[0]);
            plan.Z = (float)Json.Num(center[1]);
            var terrain = Json.Obj(Get(root, "terrain"));
            plan.TerrainRadius = (float)Json.Num(Get(terrain, "radius"), plan.Radius + 6f);
            plan.Blend = (float)Json.Num(Get(terrain, "blend"), 10f);
            var paint = Json.Arr(Get(terrain, "paint"));
            if (paint != null)
                foreach (var item in paint)
                {
                    var a = Json.Arr(item);
                    if (a == null || a.Count < 5) continue;
                    plan.Paint.Add(new PaintShape
                    {
                        Kind = (int)Json.Num(a[0]), Type = (int)Json.Num(a[1]),
                        A = F(a, 2), B = F(a, 3), C = F(a, 4), D = F(a, 5), E = F(a, 6),
                    });
                }
            var spawn = Json.Arr(Get(root, "spawn"));
            plan.Spawn = spawn != null && spawn.Count >= 3 ? new Vector3(F(spawn, 0), F(spawn, 1), F(spawn, 2)) : plan.Center;
            var arena = Json.Arr(Get(root, "arena"));
            if (arena != null && arena.Count >= 3)
            {
                plan.HasArena = true;
                plan.ArenaX = F(arena, 0);
                plan.ArenaZ = F(arena, 1);
                plan.ArenaEntrance = F(arena, 2);
            }
            var anchor = Json.Arr(Get(root, "anchor"));
            if (anchor != null && anchor.Count >= 3)
            {
                plan.HasAnchor = true;
                plan.AnchorX = F(anchor, 0);
                plan.AnchorZ = F(anchor, 1);
                plan.AnchorRadius = F(anchor, 2);
            }
            foreach (var item in Json.Arr(Get(root, "parcels")) ?? new List<object>())
            {
                var a = Json.Arr(item);
                if (a == null || a.Count < 7) continue;
                plan.Parcels.Add(new Parcel { Id = (int)F(a, 0), X = F(a, 1), Z = F(a, 2), HalfW = F(a, 3), HalfD = F(a, 4), Rot = F(a, 5), Sign = (int)F(a, 6) });
            }
            foreach (var item in Json.Arr(Get(root, "portals")) ?? new List<object>())
            {
                var a = Json.Arr(item);
                if (a == null || a.Count < 2) continue;
                plan.Portals.Add(((int)F(a, 0), Json.Text(a[1]) ?? "", a.Count > 2 ? (int)F(a, 2) : -1));
            }
            foreach (var item in Json.Arr(Get(root, "boards")) ?? new List<object>()) plan.Boards.Add((int)Json.Num(item, -1));
            plan.Proclamation = (int)Json.Num(Get(root, "proclamation"), -1);
            var pieces = Json.Arr(Get(root, "pieces")) ?? throw new InvalidOperationException("Plan sans pièces");
            foreach (var item in pieces)
            {
                var a = Json.Arr(item);
                if (a == null || a.Count < 5) continue;
                plan.Pieces.Add(new CityPiece
                {
                    Prefab = Json.Text(a[0]),
                    Position = new Vector3(F(a, 1), F(a, 2), F(a, 3)),
                    Rotation = F(a, 4),
                    Text = a.Count > 5 ? Json.Text(a[5]) : null,
                    Tamed = a.Count > 6 && Json.Num(a[6]) > 0,
                });
            }
            return plan;
        }

        private static object Get(Dictionary<string, object> o, string key) => o != null && o.TryGetValue(key, out var v) ? v : null;
        private static float F(List<object> a, int i) => i < a.Count ? (float)Json.Num(a[i]) : 0f;
    }

    // La ville : construction progressive (sans geler le serveur), réparation des pièces disparues,
    // point d'apparition des nouveaux joueurs et accueil de ceux qui arrivent.
    internal sealed partial class CityService
    {
        public enum Welcome { Off = 0, Newcomers = 1, Always = 2 }

        public static readonly int CityMark = "HearthwatchCity".GetStableHashCode();
        private static readonly int PlayerIdHash = ZDOVars.s_playerID;

        private static readonly AccessTools.FieldRef<ZoneSystem, HashSet<Vector2s>> GeneratedZones =
            AccessTools.FieldRefAccess<ZoneSystem, HashSet<Vector2s>>("m_generatedZones");
        private static readonly AccessTools.FieldRef<ZDOMan, Dictionary<ZDOID, ZDO>> ObjectsById =
            AccessTools.FieldRefAccess<ZDOMan, Dictionary<ZDOID, ZDO>>("m_objectsByID");
        private static readonly MethodInfo SpawnZone = AccessTools.Method(typeof(ZoneSystem), "SpawnZone");
        private static readonly MethodInfo SendLocationIcons = AccessTools.Method(typeof(ZoneSystem), "SendLocationIcons");

        private readonly string _dir;
        private readonly Action<string> _log;
        private readonly Func<Vector3, float, float, string> _buildArena;
        private readonly Func<bool> _demolishCityArena;

        // Ville bâtie (null sinon) et son plan, gardé pour réparer.
        private CityPlan _plan;
        private string _builtAt;
        public static Vector3? Spawn;

        // Réglages
        private Welcome _welcome = Welcome.Newcomers;
        private int _autoRepairMinutes = 15;
        private bool _spawnHere = true;
        private readonly HashSet<long> _visitors = new HashSet<long>();

        // Construction en cours
        private CityPlan _pending;
        private string _phase;
        private int _cursor;
        private int _placed;
        private float _phaseStarted;
        private List<Vector2s> _zones;
        private string _lastError;

        // Recensement
        private float _nextCensus;
        private int _standing;
        private readonly Dictionary<int, float> _missingSince = new Dictionary<int, float>();
        private int _repaired;
        private bool _cityMissingFromSave;

        // Écrit le monde sur disque tout de suite : un arrêt brutal ne doit pas faire perdre une construction.
        private void SaveWorld()
        {
            try
            {
                ZNet.instance.Save(false);
                _log("Monde sauvegardé");
            }
            catch (Exception ex) { _log("Sauvegarde du monde impossible : " + ex.Message); }
        }

        // Accueil
        private readonly Dictionary<long, float> _arrivals = new Dictionary<long, float>();
        private readonly HashSet<long> _greeted = new HashSet<long>();

        public CityService(string dir, Action<string> log, Func<Vector3, float, float, string> buildArena, Func<bool> demolishCityArena)
        {
            _dir = dir;
            _log = log;
            _buildArena = buildArena;
            _demolishCityArena = demolishCityArena;
        }

        private string StateFile => Path.Combine(_dir, "city.json");
        private string BlueprintFile => Path.Combine(_dir, "city-blueprint.json");
        public bool Busy => _pending != null;
        public bool Built => _plan != null;

        // ---------- Persistance ----------

        public void Load()
        {
            _plan = null;
            _pending = null;
            Spawn = null;
            _visitors.Clear();
            _missingSince.Clear();
            if (!File.Exists(StateFile)) return;
            var root = Json.Obj(Json.Parse(File.ReadAllText(StateFile, Encoding.UTF8)));
            if (root == null) return;
            var settings = Json.Obj(root.TryGetValue("settings", out var s) ? s : null);
            if (settings != null)
            {
                _welcome = (Welcome)(int)Json.Num(settings.TryGetValue("welcome", out var w) ? w : null, 1);
                _autoRepairMinutes = (int)Json.Num(settings.TryGetValue("autoRepair", out var ar) ? ar : null, 15);
                _spawnHere = !(settings.TryGetValue("spawn", out var sp) && sp is bool b && !b);
            }
            var visitors = Json.Arr(root.TryGetValue("visitors", out var v) ? v : null);
            if (visitors != null)
                foreach (var id in visitors)
                    if (long.TryParse(Json.Text(id), NumberStyles.Integer, CultureInfo.InvariantCulture, out var pid)) _visitors.Add(pid);
            LoadLife(root);
            if (root.TryGetValue("built", out var built) && built is bool isBuilt && isBuilt && File.Exists(BlueprintFile))
            {
                _plan = CityPlan.Parse(File.ReadAllText(BlueprintFile, Encoding.UTF8));
                _builtAt = Json.Text(root.TryGetValue("builtAt", out var at) ? at : null);
                ApplySpawn();
                _log($"City loaded: {_plan.Name} ({_plan.Pieces.Count} pieces)");
            }
        }

        private void Save()
        {
            var sb = new StringBuilder(1024);
            sb.Append("{\"version\":1,\"built\":").Append(_plan != null ? "true" : "false");
            sb.Append(",\"builtAt\":").Append(Json.Str(_builtAt));
            sb.Append(",\"settings\":").Append(SettingsJson());
            sb.Append(",\"visitors\":[");
            var first = true;
            foreach (var id in _visitors) { Json.Sep(sb, ref first); sb.Append(Json.Str(id.ToString(CultureInfo.InvariantCulture))); }
            sb.Append("],\"life\":");
            WriteLife(sb);
            sb.Append('}');
            Files.WriteAtomic(StateFile, sb.ToString());
        }

        private string SettingsJson() =>
            "{\"welcome\":" + (int)_welcome + ",\"autoRepair\":" + _autoRepairMinutes + ",\"spawn\":" + (_spawnHere ? "true" : "false") + ",\"crier\":" + (_crier ? "true" : "false") + "}";

        private void ApplySpawn()
        {
            Spawn = _plan != null && _spawnHere ? _plan.Spawn : (Vector3?)null;
            try { SendLocationIcons?.Invoke(ZoneSystem.instance, new object[] { 0L }); }
            catch (Exception) { /* les clients auront l'icône à leur prochaine connexion */ }
        }

        // ---------- Commandes ----------

        public string Execute(string op, Dictionary<string, string> cmd)
        {
            switch (op)
            {
                case "city-survey": return Survey(cmd);
                case "city-build": return StartBuild(cmd);
                case "city-demolish": return Demolish();
                case "city-repair": return Repair(force: true);
                case "city-teleport": return Teleport(cmd.TryGetValue("player", out var p) ? p : null);
                case "city-parcel": return AssignParcel(cmd);
                case "city-board": return SetBoard(cmd);
                case "city-proclaim": return Proclaim(cmd);
                case "city-portal": return SetPortal(cmd);
                case "city-architects": return SetArchitects(cmd);
                case "city-settings":
                    if (cmd.TryGetValue("crier", out var cr)) _crier = cr == "1" || cr == "true";
                    if (cmd.TryGetValue("welcome", out var w) && int.TryParse(w, out var wv)) _welcome = (Welcome)Mathf.Clamp(wv, 0, 2);
                    if (cmd.TryGetValue("autoRepair", out var ar) && int.TryParse(ar, out var arv)) _autoRepairMinutes = Mathf.Clamp(arv, 0, 1440);
                    if (cmd.TryGetValue("spawn", out var sp)) _spawnHere = sp == "1" || sp == "true";
                    ApplySpawn();
                    Save();
                    return "Réglages de la ville enregistrés";
                default:
                    throw new InvalidOperationException("Commande inconnue : " + op);
            }
        }

        // Relevé du terrain autour d'un point : meilleur centre (le moins accidenté) si demandé, hauteurs tous les 2 m,
        // zones jamais explorées, constructions de joueurs et lieux remarquables dans l'emprise.
        private string Survey(Dictionary<string, string> cmd)
        {
            var x = Num(cmd, "x");
            var z = Num(cmd, "z");
            var radius = Mathf.Clamp(Num(cmd, "radius"), 30f, 160f);
            var reach = radius + 12f;
            var water = ZoneSystem.instance.m_waterLevel;
            var anchorJson = "null";
            float? anchorFloor = null;

            var stonesJson = "null";
            if (cmd.TryGetValue("anchor", out var anchorName) && anchorName == "start")
            {
                // Autour des pierres de départ : centre et sol imposés par le lieu du jeu, si le terrain s'y prête.
                // Sinon (mer, falaises), la cité s'installe au meilleur endroit voisin et les pierres restent un sanctuaire hors les murs.
                if (!FindLocation(Game.StartLocation, out var pos, out var locRadius)) throw new InvalidOperationException("Pierres de départ introuvables dans ce monde");
                var bad = BadShare(pos.x, pos.z, reach, pos.y, out _, out _);
                if (bad <= 0.12f || (cmd.TryGetValue("force", out var f) && f == "1"))
                {
                    x = pos.x;
                    z = pos.z;
                    anchorFloor = pos.y;
                    anchorJson = "{\"name\":" + Json.Str(Game.StartLocation) + ",\"x\":" + Json.F(pos.x) + ",\"z\":" + Json.F(pos.z) + ",\"y\":" + Json.F2(pos.y) + ",\"radius\":" + Json.F(locRadius) + ",\"unfit\":" + Json.F2(bad) + "}";
                }
                else
                {
                    if (!BestSite(pos.x, pos.z, reach, water, reach + locRadius + 10f, reach + 300f, out x, out z))
                        throw new InvalidOperationException("Aucun emplacement assez régulier près des pierres de départ");
                    var distance = Mathf.Sqrt((x - pos.x) * (x - pos.x) + (z - pos.z) * (z - pos.z));
                    stonesJson = "{\"x\":" + Json.F(pos.x) + ",\"z\":" + Json.F(pos.z) + ",\"distance\":" + Json.F(distance) + ",\"unfit\":" + Json.F2(bad) + "}";
                }
            }
            else if (cmd.TryGetValue("search", out var search) && search == "1")
            {
                if (!BestSite(x, z, reach, water, 0f, 240f, out x, out z))
                    throw new InvalidOperationException("Aucun emplacement assez régulier dans les environs : essaie ailleurs");
            }

            const float step = 2f;
            var size = Mathf.CeilToInt(2f * reach / step) + 1;
            var ox = x - reach;
            var oz = z - reach;
            var heights = new float[size * size];
            float lo = float.MaxValue, hi = float.MinValue;
            var wetCount = 0;
            for (var i = 0; i < size; i++)
                for (var j = 0; j < size; j++)
                {
                    var h = WorldGenerator.instance.GetHeight(ox + j * step, oz + i * step);
                    heights[i * size + j] = h;
                    var dx = ox + j * step - x;
                    var dz = oz + i * step - z;
                    if (dx * dx + dz * dz > (radius + 6f) * (radius + 6f)) continue;
                    lo = Mathf.Min(lo, h);
                    hi = Mathf.Max(hi, h);
                    if (h < water + 0.5f) wetCount++;
                }
            var floorY = anchorFloor ?? FloorFor(lo, hi, water);

            var zones = ZonesAround(new Vector3(x, 0f, z), reach + 10f);
            var generated = GeneratedZones(ZoneSystem.instance);
            var missing = 0;
            foreach (var zone in zones) if (!generated.Contains(zone)) missing++;

            var playerPieces = 0;
            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
            {
                var p = zdo.GetPosition();
                if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) > reach * reach) continue;
                if (zdo.GetLong(ZDOVars.s_creator) != 0L && zdo.GetInt(CityMark) == 0) playerPieces++;
            }

            var locations = new StringBuilder();
            var firstLoc = true;
            var instances = AccessTools.Field(typeof(ZoneSystem), "m_locationInstances")?.GetValue(ZoneSystem.instance) as System.Collections.IDictionary;
            if (instances != null)
                foreach (var value in instances.Values)
                {
                    var t = value.GetType();
                    var pos = (Vector3)t.GetField("m_position").GetValue(value);
                    if ((pos.x - x) * (pos.x - x) + (pos.z - z) * (pos.z - z) > (reach + 10f) * (reach + 10f)) continue;
                    var loc = t.GetField("m_location").GetValue(value);
                    var prefabRef = loc.GetType().GetField("m_prefab").GetValue(loc);
                    var name = prefabRef?.GetType().GetProperty("Name")?.GetValue(prefabRef) as string ?? "?";
                    Json.Sep(locations, ref firstLoc);
                    locations.Append("{\"name\":").Append(Json.Str(name)).Append(",\"x\":").Append(Json.F(pos.x)).Append(",\"z\":").Append(Json.F(pos.z)).Append('}');
                }

            var sb = new StringBuilder(size * size * 5 + 512);
            sb.Append("{\"time\":").Append(DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            sb.Append(",\"center\":[").Append(Json.F(x)).Append(',').Append(Json.F(z)).Append("],\"radius\":").Append(Json.F(radius));
            sb.Append(",\"anchor\":").Append(anchorJson).Append(",\"stones\":").Append(stonesJson);
            sb.Append(",\"floorY\":").Append(Json.F2(floorY)).Append(",\"min\":").Append(Json.F(lo)).Append(",\"max\":").Append(Json.F(hi));
            sb.Append(",\"water\":").Append(Json.F(water)).Append(",\"wet\":").Append(wetCount);
            sb.Append(",\"biome\":").Append(Json.Str(WorldGenerator.instance.GetBiome(x, z).ToString()));
            sb.Append(",\"zones\":").Append(zones.Count).Append(",\"unexplored\":").Append(missing);
            sb.Append(",\"playerPieces\":").Append(playerPieces);
            sb.Append(",\"locations\":[").Append(locations).Append(']');
            sb.Append(",\"grid\":{\"origin\":[").Append(Json.F(ox)).Append(',').Append(Json.F(oz)).Append("],\"step\":").Append(Json.F(step)).Append(",\"size\":").Append(size).Append(",\"heights\":[");
            for (var i = 0; i < heights.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(Mathf.RoundToInt((heights[i] - floorY) * 10f));
            }
            sb.Append("]}}");
            Files.WriteAtomic(Path.Combine(_dir, "city-survey.json"), sb.ToString());
            return $"Relevé : centre X {x:0} / Z {z:0}, dénivelé {hi - lo:0.0} m";
        }

        private string StartBuild(Dictionary<string, string> cmd)
        {
            if (_pending != null) throw new InvalidOperationException("Une construction est déjà en cours");
            if (_plan != null) throw new InvalidOperationException("Une ville existe déjà : démolis-la d'abord");
            var file = Path.Combine(_dir, "city-plan.json");
            if (!File.Exists(file)) throw new InvalidOperationException("Plan de ville introuvable");
            var plan = CityPlan.Parse(File.ReadAllText(file, Encoding.UTF8));
            if (plan.Pieces.Count == 0) throw new InvalidOperationException("Plan vide");

            var force = cmd.TryGetValue("force", out var f) && f == "1";
            if (!force)
            {
                var reach = plan.TerrainRadius + plan.Blend;
                var blocking = 0;
                foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
                {
                    var p = zdo.GetPosition();
                    if ((p.x - plan.X) * (p.x - plan.X) + (p.z - plan.Z) * (p.z - plan.Z) > reach * reach) continue;
                    if (zdo.GetLong(ZDOVars.s_creator) != 0L && zdo.GetInt(CityMark) == 0) blocking++;
                }
                if (blocking > 0) throw new InvalidOperationException($"{blocking} construction(s) de joueurs dans l'emprise : déplace la ville ou force la construction");
            }

            var missing = new List<string>();
            foreach (var piece in plan.Pieces)
                if (ZNetScene.instance.GetPrefab(piece.Prefab) == null && !missing.Contains(piece.Prefab)) missing.Add(piece.Prefab);
            if (missing.Count > 0) throw new InvalidOperationException("Pièces inconnues du jeu : " + string.Join(", ", missing));

            File.Copy(file, BlueprintFile, true);
            _pending = plan;
            _zones = ZonesAround(plan.Center, plan.TerrainRadius + plan.Blend + 4f);
            _cursor = 0;
            _placed = 0;
            _lastError = null;
            SetPhase("zones");
            _log($"Construction de la ville « {plan.Name} » : {plan.Pieces.Count} pièces");
            Game.Screen(Tables.T("La cité « {0} » sort de terre !", plan.Name));
            return $"Construction lancée : {plan.Pieces.Count} pièces";
        }

        private void SetPhase(string phase)
        {
            _phase = phase;
            _phaseStarted = Time.time;
        }

        public void Update()
        {
            if (_pending != null)
            {
                try { Step(); }
                catch (Exception ex)
                {
                    _lastError = ex.Message;
                    _log("Construction de la ville interrompue : " + ex.Message);
                    UnityEngine.Debug.LogException(ex);
                    // Ce qui a été posé reste retrouvable par sa marque : on l'enregistre pour pouvoir le démolir.
                    _plan = _pending;
                    _builtAt = DateTime.UtcNow.ToString("o");
                    _pending = null;
                    Save();
                }
                return;
            }
            if (_plan == null) return;
            var now = Time.time;
            if (now >= _nextCensus)
            {
                _nextCensus = now + 30f;
                Census();
                // Plus de la moitié des pièces manquent : le monde a sans doute été rechargé depuis une sauvegarde antérieure
                // à la construction. On ne rebâtit pas à l'aveugle : l'admin décide depuis le panel.
                _cityMissingFromSave = _plan.Pieces.Count > 0 && _missingSince.Count > _plan.Pieces.Count / 2;
                if (_autoRepairMinutes > 0 && !_cityMissingFromSave) Repair(force: false);
                ApplyTexts();
            }
            if (now >= _nextProtect)
            {
                _nextProtect = now + 15f;
                Protect();
            }
            Greet();
        }

        private void Step()
        {
            var plan = _pending;
            switch (_phase)
            {
                case "zones":
                {
                    // Une zone jamais visitée ferait pousser arbres et rochers dans la ville à sa génération : on la génère avant.
                    var generated = GeneratedZones(ZoneSystem.instance);
                    Vector2s? next = null;
                    foreach (var zone in _zones)
                        if (!generated.Contains(zone)) { next = zone; break; }
                    if (next == null) { SetPhase("clear"); return; }
                    if (Time.time - _phaseStarted > 180f) throw new InvalidOperationException("Génération des zones trop longue");
                    var args = new object[] { next.Value, Enum.Parse(SpawnZone.GetParameters()[1].ParameterType, "Ghost"), null };
                    SpawnZone.Invoke(ZoneSystem.instance, args);
                    return;
                }
                case "clear":
                {
                    var removed = plan.HasAnchor
                        ? ArenaBuilder.ClearSite(plan.Center, plan.TerrainRadius + plan.Blend, new Vector3(plan.AnchorX, 0f, plan.AnchorZ), plan.AnchorRadius)
                        : ArenaBuilder.ClearSite(plan.Center, plan.TerrainRadius + plan.Blend);
                    _log($"Ville : {removed} arbres, rochers et créatures retirés");
                    SetPhase("terrain");
                    return;
                }
                case "terrain":
                    if (!Terrain.Apply(plan.Center, plan.TerrainRadius, plan.Blend, plan.FloorY, plan.Paint))
                        throw new InvalidOperationException("Impossible de niveler le terrain");
                    _log("Ville : terrain nivelé (" + Terrain.LastMethod + ")");
                    SetPhase("pieces");
                    return;
                case "pieces":
                {
                    var clock = Stopwatch.StartNew();
                    while (_cursor < plan.Pieces.Count && clock.ElapsedMilliseconds < 8)
                    {
                        if (PlacePiece(plan, _cursor) != null) _placed++;
                        _cursor++;
                    }
                    if (_cursor >= plan.Pieces.Count) SetPhase("arena");
                    return;
                }
                case "arena":
                    if (plan.HasArena)
                    {
                        var result = _buildArena(new Vector3(plan.ArenaX, plan.FloorY, plan.ArenaZ), plan.FloorY, plan.ArenaEntrance);
                        _log("Ville : " + result);
                    }
                    SetPhase("done");
                    return;
                case "done":
                    _plan = plan;
                    _pending = null;
                    _builtAt = DateTime.UtcNow.ToString("o");
                    _missingSince.Clear();
                    _repaired = 0;
                    _nextCensus = Time.time + 5f;
                    ResetLife();
                    Save();
                    ApplySpawn();
                    _log($"Ville « {plan.Name} » achevée : {_placed} pièces");
                    SaveWorld();
                    Game.Screen(Tables.T("La cité « {0} » est achevée. Gloire à l'Empereur !", plan.Name));
                    return;
            }
        }

        private ZDO PlacePiece(CityPlan plan, int index)
        {
            var piece = plan.Pieces[index];
            var prefab = ZNetScene.instance.GetPrefab(piece.Prefab);
            if (prefab == null) return null;
            var zdo = Game.Spawn(prefab, piece.Position, Quaternion.Euler(0f, piece.Rotation, 0f), 1, piece.Tamed);
            if (zdo == null) return null;
            zdo.Set(CityMark, index + 1);
            if (!string.IsNullOrEmpty(piece.Text)) zdo.Set(ZDOVars.s_text, piece.Text);
            if (Ownership.CanLock(prefab))
            {
                Ownership.Lock(zdo);
                Game.KeepLit(prefab, zdo);
            }
            return zdo;
        }

        // ---------- Recensement et réparation ----------

        private List<ZDO> FindCityObjects(CityPlan plan)
        {
            var result = new List<ZDO>();
            var reach = plan.TerrainRadius + plan.Blend + 10f;
            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
            {
                if (zdo.GetInt(CityMark) == 0) continue;
                var p = zdo.GetPosition();
                if ((p.x - plan.X) * (p.x - plan.X) + (p.z - plan.Z) * (p.z - plan.Z) <= reach * reach) result.Add(zdo);
            }
            return result;
        }

        private void Census()
        {
            var present = new bool[_plan.Pieces.Count];
            _standing = 0;
            _byIndex.Clear();
            foreach (var zdo in FindCityObjects(_plan))
            {
                var index = zdo.GetInt(CityMark) - 1;
                if (index < 0 || index >= present.Length || present[index]) continue;
                present[index] = true;
                _byIndex[index] = zdo;
                _standing++;
            }
            var now = Time.time;
            for (var i = 0; i < present.Length; i++)
            {
                if (present[i]) _missingSince.Remove(i);
                else if (!_missingSince.ContainsKey(i)) _missingSince[i] = now;
            }
        }

        private string Repair(bool force)
        {
            if (_plan == null) throw new InvalidOperationException("Aucune ville");
            if (force) Census();
            var now = Time.time;
            var due = new List<int>();
            foreach (var pair in _missingSince)
                if (force || now - pair.Value >= _autoRepairMinutes * 60f) due.Add(pair.Key);
            var count = 0;
            foreach (var index in due)
            {
                if (PlacePiece(_plan, index) == null) continue;
                _missingSince.Remove(index);
                count++;
            }
            if (count > 0)
            {
                _repaired += count;
                _standing += count;
                _log($"Ville : {count} pièce(s) remise(s) en place");
            }
            return count > 0 ? $"{count} pièce(s) remise(s) en place" : "Rien à réparer : la ville est intacte";
        }

        private string Demolish()
        {
            if (_pending != null) throw new InvalidOperationException("Construction en cours : attends qu'elle se termine");
            if (_plan == null) throw new InvalidOperationException("Aucune ville");
            var removed = 0;
            foreach (var zdo in FindCityObjects(_plan))
            {
                Game.Destroy(zdo);
                removed++;
            }
            var arena = _demolishCityArena();
            try { Terrain.Apply(_plan.Center, _plan.TerrainRadius, _plan.Blend, _plan.FloorY, null, restore: true); }
            catch (Exception) { /* le sol reste nivelé : sans gravité */ }
            var name = _plan.Name;
            _plan = null;
            _missingSince.Clear();
            Save();
            ApplySpawn();
            _log($"Ville « {name} » démolie ({removed} pièces{(arena ? ", arène comprise" : "")})");
            SaveWorld();
            return $"Ville démolie : {removed} pièces retirées";
        }

        // ---------- Accueil ----------

        private string Teleport(string player)
        {
            if (_plan == null) throw new InvalidOperationException("Aucune ville");
            var count = 0;
            foreach (var peer in ZNet.instance.GetPeers())
            {
                if (!string.IsNullOrEmpty(player) && !string.Equals(peer.m_playerName, player, StringComparison.OrdinalIgnoreCase)) continue;
                var zdo = Game.PlayerZdo(peer);
                if (zdo == null) continue;
                SendToSpawn(zdo, peer);
                count++;
            }
            if (count == 0) throw new InvalidOperationException(string.IsNullOrEmpty(player) ? "Personne en ligne" : "Joueur introuvable");
            return $"{count} joueur(s) téléporté(s) dans la ville";
        }

        private void SendToSpawn(ZDO zdo, ZNetPeer peer)
        {
            var offset = UnityEngine.Random.insideUnitCircle * 2f;
            var target = _plan.Spawn + new Vector3(offset.x, 0.5f, offset.y);
            ZRoutedRpc.instance.InvokeRoutedRPC(zdo.GetOwner(), zdo.m_uid, "RPC_TeleportTo", target, Quaternion.identity, true);
        }

        private void Greet()
        {
            if (ZNet.instance == null) return;
            var now = Time.time;
            var online = new HashSet<long>();
            foreach (var peer in ZNet.instance.GetPeers())
            {
                online.Add(peer.m_uid);
                var zdo = Game.PlayerZdo(peer);
                if (zdo == null) continue;
                Cry(peer, zdo, now);
                if (_greeted.Contains(peer.m_uid)) continue;
                // Laisser le personnage apparaître et le monde se charger avant d'agir.
                if (!_arrivals.TryGetValue(peer.m_uid, out var seen)) { _arrivals[peer.m_uid] = now; continue; }
                if (now - seen < 6f) continue;
                _greeted.Add(peer.m_uid);

                var playerId = zdo.GetLong(PlayerIdHash);
                Remember(playerId, peer.m_playerName);
                var newcomer = playerId != 0L && !_visitors.Contains(playerId);
                if (playerId != 0L && _visitors.Add(playerId)) Save();

                var message = string.IsNullOrEmpty(_plan.Welcome) ? Tables.T("Bienvenue à {0} !", _plan.Name) : _plan.Welcome;
                var go = _welcome == Welcome.Always || (_welcome == Welcome.Newcomers && newcomer);
                var far = (zdo.GetPosition() - _plan.Spawn).sqrMagnitude > 40f * 40f;
                if (go && far) SendToSpawn(zdo, peer);
                if (go || newcomer) Game.Screen(message, peer.m_uid);
            }
            // Oublier les joueurs partis : à leur retour, ils seront de nouveau accueillis.
            foreach (var uid in new List<long>(_greeted)) if (!online.Contains(uid)) _greeted.Remove(uid);
            foreach (var uid in new List<long>(_arrivals.Keys)) if (!online.Contains(uid)) _arrivals.Remove(uid);
            foreach (var uid in new List<long>(_insideCity.Keys)) if (!online.Contains(uid)) _insideCity.Remove(uid);
        }

        // ---------- Export ----------

        public void Write(StringBuilder sb)
        {
            var plan = _plan ?? _pending;
            sb.Append("{\"built\":").Append(_plan != null ? "true" : "false");
            sb.Append(",\"settings\":").Append(SettingsJson());
            sb.Append(",\"visitors\":").Append(_visitors.Count);
            if (plan != null)
            {
                sb.Append(",\"name\":").Append(Json.Str(plan.Name));
                sb.Append(",\"center\":[").Append(Json.F(plan.X)).Append(',').Append(Json.F(plan.Z)).Append(']');
                sb.Append(",\"floorY\":").Append(Json.F(plan.FloorY)).Append(",\"radius\":").Append(Json.F(plan.Radius));
                sb.Append(",\"spawn\":[").Append(Json.F(plan.Spawn.x)).Append(',').Append(Json.F(plan.Spawn.y)).Append(',').Append(Json.F(plan.Spawn.z)).Append(']');
                sb.Append(",\"total\":").Append(plan.Pieces.Count);
                sb.Append(",\"builtAt\":").Append(Json.Str(_builtAt));
            }
            if (_plan != null)
                sb.Append(",\"standing\":").Append(_standing).Append(",\"missing\":").Append(_missingSince.Count).Append(",\"repaired\":").Append(_repaired);
            if (_pending != null)
                sb.Append(",\"building\":{\"phase\":").Append(Json.Str(_phase)).Append(",\"placed\":").Append(_cursor)
                  .Append(",\"zonesLeft\":").Append(ZonesLeft()).Append('}');
            if (_lastError != null) sb.Append(",\"error\":").Append(Json.Str(_lastError));
            if (_cityMissingFromSave) sb.Append(",\"notInSave\":true");
            if (_plan != null)
            {
                sb.Append(",\"emperor\":").Append(Json.Str(_plan.Emperor));
                sb.Append(",\"life\":");
                WriteLife(sb, withPlan: true);
            }
            sb.Append('}');
        }

        private int ZonesLeft()
        {
            if (_zones == null) return 0;
            var generated = GeneratedZones(ZoneSystem.instance);
            var n = 0;
            foreach (var zone in _zones) if (!generated.Contains(zone)) n++;
            return n;
        }

        private static List<Vector2s> ZonesAround(Vector3 center, float reach)
        {
            var set = new HashSet<Vector2s>();
            for (var dx = -reach; dx <= reach + 32f; dx += 32f)
                for (var dz = -reach; dz <= reach + 32f; dz += 32f)
                    set.Add(ZoneSystem.GetZone(center + new Vector3(Mathf.Min(dx, reach), 0f, Mathf.Min(dz, reach))));
            return new List<Vector2s>(set);
        }

        // Part du terrain que le jeu ne pourra pas amener au niveau du sol (écart de plus de 8 m), échantillonné tous les 12 m.
        private static float BadShare(float cx, float cz, float reach, float? floorY, out float floor, out float range)
        {
            var samples = new List<float>(512);
            float min = float.MaxValue, max = float.MinValue;
            for (var dx = -reach; dx <= reach; dx += 12f)
                for (var dz = -reach; dz <= reach; dz += 12f)
                {
                    if (dx * dx + dz * dz > reach * reach) continue;
                    var h = WorldGenerator.instance.GetHeight(cx + dx, cz + dz);
                    samples.Add(h);
                    min = Mathf.Min(min, h);
                    max = Mathf.Max(max, h);
                }
            floor = floorY ?? FloorFor(min, max, ZoneSystem.instance.m_waterLevel);
            range = max - min;
            var bad = 0;
            foreach (var h in samples) if (Mathf.Abs(h - floor) > Terrain.MaxDelta) bad++;
            return samples.Count == 0 ? 1f : (float)bad / samples.Count;
        }

        // Meilleur centre dans un anneau autour d'un point : le moins de terrain hors de portée du nivellement,
        // puis le moins accidenté, sans trop s'éloigner.
        private static bool BestSite(float x, float z, float reach, float water, float minRing, float maxRing, out float bx, out float bz)
        {
            var best = float.MaxValue;
            bx = x;
            bz = z;
            for (var ring = minRing; ring <= maxRing; ring += 20f)
            {
                var steps = ring < 1f ? 1 : Mathf.RoundToInt(2f * Mathf.PI * ring / 20f);
                for (var i = 0; i < steps; i++)
                {
                    var a = i * Mathf.PI * 2f / steps;
                    var cx = x + Mathf.Cos(a) * ring;
                    var cz = z + Mathf.Sin(a) * ring;
                    var bad = BadShare(cx, cz, reach, null, out _, out var range);
                    if (bad > 0.2f) continue;
                    var score = bad * 1000f + range + ring * 0.02f;
                    if (score < best) { best = score; bx = cx; bz = cz; }
                }
            }
            return best < float.MaxValue;
        }

        // Sol visé : à mi-hauteur du terrain, mais toujours au sec.
        private static float FloorFor(float min, float max, float water) =>
            Mathf.Max(Mathf.Round((min + max) / 2f * 2f) / 2f, Mathf.Ceil(water + 2f));

        private static float Num(Dictionary<string, string> cmd, string key)
        {
            if (!cmd.TryGetValue(key, out var raw) || !float.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var v))
                throw new InvalidOperationException("Paramètre manquant : " + key);
            return v;
        }

        // Les joueurs sans lit apparaissent à la « pierre de départ » que le serveur leur indique : on la déplace dans la ville.
        [HarmonyPatch(typeof(ZoneSystem), nameof(ZoneSystem.GetLocationIcons))]
        private static class SpawnIconPatch
        {
            private static void Postfix(ZoneSystem __instance, Dictionary<Vector3, string> icons)
            {
                if (Spawn == null || !ZNet.instance.IsServer()) return;
                var start = Game.StartLocation;
                foreach (var key in new List<Vector3>(icons.Keys))
                    if (icons[key] == start) icons.Remove(key);
                icons[Spawn.Value] = start;
            }
        }
    }
}
