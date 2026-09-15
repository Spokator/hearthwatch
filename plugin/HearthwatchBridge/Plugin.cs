using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using BepInEx;
using BepInEx.Configuration;
using HarmonyLib;
using UnityEngine;

namespace HearthwatchBridge
{
    // Exporte pour le panel web Hearthwatch : la carte du monde (générée depuis la graine) et
    // l'état du monde (joueurs, créatures, minerais, portails...) sous forme de fichiers.
    // 100 % serveur : les joueurs n'installent rien.
    [BepInPlugin(Guid, Name, Version)]
    public class Plugin : BaseUnityPlugin
    {
        public const string Guid = "hearthwatch.bridge";
        public const string Name = "Hearthwatch Bridge";
        public const string Version = "1.0.0";

        private enum Category { None, Creature, Ship, Cart, Portal, Tombstone, Ore, Pickable, Build }

        private sealed class Kind
        {
            public Category Category;
            public string Prefab;
            public string Item;
            public bool Boss;
        }

        private static readonly AccessTools.FieldRef<ZDOMan, Dictionary<ZDOID, ZDO>> ObjectsById =
            AccessTools.FieldRefAccess<ZDOMan, Dictionary<ZDOID, ZDO>>("m_objectsByID");

        private static readonly AccessTools.FieldRef<ZoneSystem, HashSet<Vector2s>> GeneratedZones =
            AccessTools.FieldRefAccess<ZoneSystem, HashSet<Vector2s>>("m_generatedZones");

        private static readonly HashSet<string> IgnoredPickables = new HashSet<string> { "Wood", "Stone", "RoundLog", "ElderBark" };

        private ConfigEntry<string> _outputDir;
        private ConfigEntry<int> _mapSize;
        private ConfigEntry<float> _liveInterval;
        private ConfigEntry<float> _worldInterval;
        private ConfigEntry<int> _mapFrameBudgetMs;

        private readonly Dictionary<int, Kind> _kinds = new Dictionary<int, Kind>();
        private string _worldKey;
        private float _nextLive;
        private float _nextWorld;
        private float _liveBackoff;
        private static bool _worldLoadedFromDisk;
        private static bool _rconChecked;

        private void Awake()
        {
            _outputDir = Config.Bind("General", "OutputDirectory", "", "Dossier de sortie. Vide = <savedir>/panelmap");
            _mapSize = Config.Bind("Map", "Size", 2048, "Résolution de la carte générée (pixels de côté, puissance de 2)");
            _mapFrameBudgetMs = Config.Bind("Map", "FrameBudgetMs", 6, "Temps de calcul maximum par image serveur pendant la génération de la carte");
            _liveInterval = Config.Bind("Export", "LiveIntervalSeconds", 2f, "Fréquence d'export des joueurs et créatures");
            _worldInterval = Config.Bind("Export", "WorldIntervalSeconds", 30f, "Fréquence d'export des ressources, portails, lieux et zones explorées");
            Harmony.CreateAndPatchAll(typeof(WorldLoadPatch), Guid);
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

        private static bool WorldReady =>
            ZNet.instance != null && ZNet.instance.IsServer() && ZNet.World != null && ZNetScene.instance != null &&
            ZDOMan.instance != null && ZoneSystem.instance != null && WorldGenerator.instance != null;

        private void Update()
        {
            if (!WorldReady)
            {
                _worldKey = null;
                return;
            }

            var world = ZNet.World;
            var key = world.m_name + "-" + world.m_seed;
            if (key != _worldKey)
            {
                _worldKey = key;
                _kinds.Clear();
                _nextLive = Time.time + 5f;
                _nextWorld = Time.time + 15f;
                Directory.CreateDirectory(OutputDir);
                StartCoroutine(EnsureMap(world.m_name, world.m_seed, key));
                if (!_rconChecked) StartCoroutine(EnsureRcon());
            }

            if (Time.time >= _nextLive)
            {
                var elapsed = Safe("live", ExportLive);
                // Si le scan devient coûteux (très grand monde), on espace les exports.
                _liveBackoff = elapsed > 20 ? Mathf.Min(_liveBackoff + 1f, 8f) : Mathf.Max(_liveBackoff - 0.5f, 0f);
                _nextLive = Time.time + _liveInterval.Value + _liveBackoff;
            }

            if (Time.time >= _nextWorld)
            {
                _nextWorld = Time.time + _worldInterval.Value;
                Safe("world", ExportWorld);
            }
        }

        private long Safe(string label, Action action)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                action();
            }
            catch (Exception ex)
            {
                Logger.LogError($"Export {label} failed: {ex}");
            }
            return sw.ElapsedMilliseconds;
        }

        // ---------- RCON ----------

        // ValheimRcon ouvre son port depuis ZNet.LoadWorld, qui n'est pas appelé quand le monde
        // vient d'être créé : sans ça, le panel reste sans RCON jusqu'au premier redémarrage.
        [HarmonyPatch(typeof(ZNet), "LoadWorld")]
        private static class WorldLoadPatch
        {
            private static void Finalizer() => _worldLoadedFromDisk = true;
        }

        private IEnumerator EnsureRcon()
        {
            _rconChecked = true;
            yield return new WaitForSeconds(5f);
            if (_worldLoadedFromDisk) yield break;
            try
            {
                var proxy = AccessTools.TypeByName("ValheimRcon.RconProxy");
                var instance = proxy == null ? null : AccessTools.Property(proxy, "Instance")?.GetValue(null, null);
                if (instance == null) yield break;
                AccessTools.Method(proxy, "Startup").Invoke(instance, null);
                Logger.LogInfo("New world: started the ValheimRcon listener");
            }
            catch (Exception ex)
            {
                Logger.LogWarning($"Could not start ValheimRcon for a new world: {ex}");
            }
        }

        // ---------- Carte ----------

        private IEnumerator EnsureMap(string worldName, int seed, string key)
        {
            var size = Mathf.ClosestPowerOfTwo(Mathf.Clamp(_mapSize.Value, 256, 4096));
            var pixel = 21000f / size;
            var fileName = SafeName(worldName) + "-" + seed + "-" + size + ".map";
            var path = Path.Combine(OutputDir, fileName);

            if (File.Exists(path))
            {
                WriteMapStatus(worldName, seed, size, pixel, fileName, 1f, true);
                yield break;
            }

            Logger.LogInfo($"Generating {size}x{size} map for {worldName} (seed {seed})");
            var total = Stopwatch.StartNew();
            var frame = Stopwatch.StartNew();
            var n = size * size;
            var biomes = new byte[n];
            var heights = new short[n];
            var forest = new byte[n];
            var generator = WorldGenerator.instance;
            var half = size / 2;
            var lastStatus = 0f;

            for (var i = 0; i < size; i++)
            {
                if (_worldKey != key) yield break;
                var wy = (i - half) * pixel + pixel / 2f;
                for (var j = 0; j < size; j++)
                {
                    var wx = (j - half) * pixel + pixel / 2f;
                    var biome = generator.GetBiome(wx, wy);
                    var height = generator.GetBiomeHeight(biome, wx, wy, out _);
                    var k = i * size + j;
                    biomes[k] = BiomeIndex(biome);
                    heights[k] = (short)Mathf.Clamp(Mathf.RoundToInt(height * 4f), short.MinValue, short.MaxValue);
                    if (biome == Heightmap.Biome.Meadows || biome == Heightmap.Biome.BlackForest || biome == Heightmap.Biome.Plains || biome == Heightmap.Biome.Mistlands)
                        forest[k] = (byte)Mathf.Clamp(Mathf.RoundToInt(WorldGenerator.GetForestFactor(new Vector3(wx, 0f, wy)) * 50f), 0, 255);
                    else
                        forest[k] = 255;
                }

                if (frame.ElapsedMilliseconds >= _mapFrameBudgetMs.Value)
                {
                    var progress = (i + 1f) / size;
                    if (progress - lastStatus >= 0.02f)
                    {
                        WriteMapStatus(worldName, seed, size, pixel, fileName, progress, false);
                        lastStatus = progress;
                    }
                    yield return null;
                    frame.Restart();
                }
            }

            var tmp = path + ".tmp";
            using (var writer = new BinaryWriter(File.Create(tmp)))
            {
                writer.Write(Encoding.ASCII.GetBytes("VPM1"));
                writer.Write(size);
                writer.Write(pixel);
                writer.Write(seed);
                writer.Write(biomes);
                foreach (var h in heights) writer.Write(h);
                writer.Write(forest);
            }
            ReplaceFile(tmp, path);
            WriteMapStatus(worldName, seed, size, pixel, fileName, 1f, true);
            Logger.LogInfo($"Map generated in {total.Elapsed.TotalSeconds:0.0} s: {path}");
        }

        private static byte BiomeIndex(Heightmap.Biome biome)
        {
            switch (biome)
            {
                case Heightmap.Biome.Meadows: return 1;
                case Heightmap.Biome.Swamp: return 2;
                case Heightmap.Biome.Mountain: return 3;
                case Heightmap.Biome.BlackForest: return 4;
                case Heightmap.Biome.Plains: return 5;
                case Heightmap.Biome.AshLands: return 6;
                case Heightmap.Biome.DeepNorth: return 7;
                case Heightmap.Biome.Ocean: return 8;
                case Heightmap.Biome.Mistlands: return 9;
                default: return 0;
            }
        }

        private void WriteMapStatus(string world, int seed, int size, float pixel, string file, float progress, bool done)
        {
            var sb = new StringBuilder();
            sb.Append("{\"world\":").Append(Str(world))
              .Append(",\"seed\":").Append(seed)
              .Append(",\"size\":").Append(size)
              .Append(",\"pixelSize\":").Append(F(pixel, 4))
              .Append(",\"file\":").Append(Str(file))
              .Append(",\"progress\":").Append(F(progress, 3))
              .Append(",\"done\":").Append(done ? "true" : "false")
              .Append(",\"plugin\":").Append(Str(Version))
              .Append('}');
            WriteText("map.json", sb.ToString());
        }

        // ---------- Classification des prefabs ----------

        private Kind KindOf(int hash)
        {
            if (_kinds.TryGetValue(hash, out var kind)) return kind;
            kind = new Kind { Category = Category.None };
            var prefab = ZNetScene.instance.GetPrefab(hash);
            if (prefab != null)
            {
                kind.Prefab = prefab.name;
                Character character;
                if (prefab.GetComponent<Player>() != null)
                {
                }
                else if ((character = prefab.GetComponent<Character>()) != null)
                {
                    kind.Category = Category.Creature;
                    kind.Boss = character.m_boss;
                }
                else if (prefab.GetComponent<Ship>() != null) kind.Category = Category.Ship;
                else if (prefab.GetComponent<Vagon>() != null) kind.Category = Category.Cart;
                else if (prefab.GetComponent<TeleportWorld>() != null) kind.Category = Category.Portal;
                else if (prefab.GetComponent<TombStone>() != null) kind.Category = Category.Tombstone;
                else if ((kind.Item = OreDrop(prefab)) != null) kind.Category = Category.Ore;
                else if (prefab.GetComponent<Pickable>() is Pickable pickable && pickable.m_itemPrefab != null && !IgnoredPickables.Contains(pickable.m_itemPrefab.name))
                {
                    kind.Category = Category.Pickable;
                    kind.Item = pickable.m_itemPrefab.name;
                }
                else if (prefab.GetComponent<Piece>() != null && prefab.GetComponent<WearNTear>() != null) kind.Category = Category.Build;
            }
            _kinds[hash] = kind;
            return kind;
        }

        private static string OreDrop(GameObject prefab)
        {
            var table = prefab.GetComponent<MineRock5>()?.m_dropItems
                        ?? prefab.GetComponent<MineRock>()?.m_dropItems
                        ?? (prefab.GetComponent<Destructible>() != null ? prefab.GetComponent<DropOnDestroyed>()?.m_dropWhenDestroyed : null);
            if (table?.m_drops == null) return null;
            foreach (var drop in table.m_drops)
            {
                var name = drop.m_item != null ? drop.m_item.name : null;
                if (name != null && IsOre(name)) return name;
            }
            return null;
        }

        private static bool IsOre(string item) =>
            item.EndsWith("Ore", StringComparison.Ordinal) || item.EndsWith("Scrap", StringComparison.Ordinal) ||
            item == "Obsidian" || item == "Crystal" || item == "Softtissue" || item.StartsWith("Flametal", StringComparison.Ordinal);

        // ---------- Exports ----------

        private void ExportLive()
        {
            var sb = new StringBuilder(8192);
            sb.Append("{\"time\":").Append(DateTimeOffset.UtcNow.ToUnixTimeSeconds())
              .Append(",\"world\":").Append(Str(ZNet.World.m_name))
              .Append(",\"players\":[");

            var first = true;
            foreach (var peer in ZNet.instance.GetPeers())
            {
                var zdo = ZDOMan.instance.GetZDO(peer.m_characterID);
                var pos = zdo != null ? zdo.GetPosition() : peer.m_refPos;
                Sep(sb, ref first);
                sb.Append("{\"name\":").Append(Str(peer.m_playerName))
                  .Append(",\"id\":").Append(Str(HostName(peer)))
                  .Append(",\"x\":").Append(F(pos.x)).Append(",\"y\":").Append(F(pos.y)).Append(",\"z\":").Append(F(pos.z));
                if (zdo != null)
                    sb.Append(",\"hp\":").Append(F(zdo.GetFloat(ZDOVars.s_health))).Append(",\"maxHp\":").Append(F(zdo.GetFloat(ZDOVars.s_maxHealth)));
                sb.Append('}');
            }
            sb.Append(']');

            var types = new Dictionary<string, int>();
            var typeList = new StringBuilder();
            var creatures = new StringBuilder();
            var vehicles = new StringBuilder();
            bool firstCreature = true, firstVehicle = true, firstType = true;

            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
            {
                var kind = KindOf(zdo.GetPrefab());
                if (kind.Category == Category.Creature)
                {
                    if (!types.TryGetValue(kind.Prefab, out var t))
                    {
                        t = types.Count;
                        types[kind.Prefab] = t;
                        Sep(typeList, ref firstType);
                        typeList.Append("{\"name\":").Append(Str(kind.Prefab)).Append(",\"boss\":").Append(kind.Boss ? "true" : "false").Append('}');
                    }
                    var p = zdo.GetPosition();
                    Sep(creatures, ref firstCreature);
                    creatures.Append('[').Append(t).Append(',').Append(F(p.x)).Append(',').Append(F(p.z))
                             .Append(',').Append(zdo.GetInt(ZDOVars.s_level, 1)).Append(',').Append(zdo.GetBool(ZDOVars.s_tamed) ? 1 : 0).Append(']');
                }
                else if (kind.Category == Category.Ship || kind.Category == Category.Cart)
                {
                    var p = zdo.GetPosition();
                    Sep(vehicles, ref firstVehicle);
                    vehicles.Append("{\"prefab\":").Append(Str(kind.Prefab)).Append(",\"x\":").Append(F(p.x)).Append(",\"z\":").Append(F(p.z)).Append('}');
                }
            }

            sb.Append(",\"creatureTypes\":[").Append(typeList).Append(']')
              .Append(",\"creatures\":[").Append(creatures).Append(']')
              .Append(",\"vehicles\":[").Append(vehicles).Append("]}");
            WriteText("live.json", sb.ToString());
        }

        private void ExportWorld()
        {
            var resourceTypes = new Dictionary<string, int>();
            var resourceTypeList = new StringBuilder();
            var resources = new StringBuilder();
            var portals = new StringBuilder();
            var tombstones = new StringBuilder();
            var builds = new Dictionary<long, int>();
            bool firstType = true, firstResource = true, firstPortal = true, firstTomb = true;

            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
            {
                var kind = KindOf(zdo.GetPrefab());
                switch (kind.Category)
                {
                    case Category.Ore:
                    case Category.Pickable:
                    {
                        if (kind.Category == Category.Pickable && zdo.GetBool(ZDOVars.s_picked)) break;
                        var typeKey = (kind.Category == Category.Ore ? "ore:" : "pick:") + kind.Item;
                        if (!resourceTypes.TryGetValue(typeKey, out var t))
                        {
                            t = resourceTypes.Count;
                            resourceTypes[typeKey] = t;
                            Sep(resourceTypeList, ref firstType);
                            resourceTypeList.Append("{\"item\":").Append(Str(kind.Item))
                                            .Append(",\"kind\":").Append(Str(kind.Category == Category.Ore ? "ore" : "pickable")).Append('}');
                        }
                        var p = zdo.GetPosition();
                        Sep(resources, ref firstResource);
                        resources.Append('[').Append(t).Append(',').Append(F(p.x)).Append(',').Append(F(p.z)).Append(']');
                        break;
                    }
                    case Category.Portal:
                    {
                        var p = zdo.GetPosition();
                        Sep(portals, ref firstPortal);
                        portals.Append("{\"tag\":").Append(Str(zdo.GetString(ZDOVars.s_tag))).Append(",\"prefab\":").Append(Str(kind.Prefab))
                               .Append(",\"x\":").Append(F(p.x)).Append(",\"z\":").Append(F(p.z)).Append('}');
                        break;
                    }
                    case Category.Tombstone:
                    {
                        var p = zdo.GetPosition();
                        Sep(tombstones, ref firstTomb);
                        tombstones.Append("{\"owner\":").Append(Str(zdo.GetString(ZDOVars.s_ownerName)))
                                  .Append(",\"x\":").Append(F(p.x)).Append(",\"z\":").Append(F(p.z)).Append('}');
                        break;
                    }
                    case Category.Build:
                    {
                        if (zdo.GetLong(ZDOVars.s_creator) == 0L) break;
                        var p = zdo.GetPosition();
                        var cell = ((long)Mathf.FloorToInt(p.x / 32f) << 32) ^ (uint)Mathf.FloorToInt(p.z / 32f);
                        builds.TryGetValue(cell, out var count);
                        builds[cell] = count + 1;
                        break;
                    }
                }
            }

            var sb = new StringBuilder(64 * 1024);
            sb.Append("{\"time\":").Append(DateTimeOffset.UtcNow.ToUnixTimeSeconds())
              .Append(",\"world\":").Append(Str(ZNet.World.m_name))
              .Append(",\"resourceTypes\":[").Append(resourceTypeList).Append(']')
              .Append(",\"resources\":[").Append(resources).Append(']')
              .Append(",\"portals\":[").Append(portals).Append(']')
              .Append(",\"tombstones\":[").Append(tombstones).Append(']');

            sb.Append(",\"builds\":[");
            var first = true;
            foreach (var entry in builds)
            {
                Sep(sb, ref first);
                sb.Append('[').Append((int)(entry.Key >> 32)).Append(',').Append((int)(uint)entry.Key).Append(',').Append(entry.Value).Append(']');
            }
            sb.Append(']');

            sb.Append(",\"locations\":[");
            first = true;
            foreach (var location in ZoneSystem.instance.m_locationInstances.Values)
            {
                if (location.m_location == null) continue;
                Sep(sb, ref first);
                sb.Append('[').Append(Str(location.m_location.m_prefabName)).Append(',').Append(F(location.m_position.x))
                  .Append(',').Append(F(location.m_position.z)).Append(',').Append(location.m_placed ? 1 : 0).Append(']');
            }
            sb.Append(']');

            sb.Append(",\"zones\":[");
            first = true;
            foreach (var zone in GeneratedZones(ZoneSystem.instance))
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append(zone.x).Append(',').Append(zone.y);
            }
            sb.Append("]}");
            WriteText("world.json", sb.ToString());
        }

        // ---------- Utilitaires ----------

        private static string HostName(ZNetPeer peer)
        {
            try
            {
                return peer.m_rpc.GetSocket().GetHostName();
            }
            catch
            {
                return "";
            }
        }

        private void WriteText(string name, string content)
        {
            var path = Path.Combine(OutputDir, name);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, content, new UTF8Encoding(false));
            ReplaceFile(tmp, path);
        }

        private static void ReplaceFile(string tmp, string path)
        {
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        private static void Sep(StringBuilder sb, ref bool first)
        {
            if (!first) sb.Append(',');
            first = false;
        }

        private static string F(float value, int decimals = 0) =>
            float.IsNaN(value) || float.IsInfinity(value) ? "0" : Math.Round(value, decimals).ToString(CultureInfo.InvariantCulture);

        private static string SafeName(string value)
        {
            var sb = new StringBuilder();
            foreach (var c in value) sb.Append(char.IsLetterOrDigit(c) || c == '-' || c == '_' ? c : '_');
            return sb.ToString();
        }

        private static string Str(string value)
        {
            if (value == null) return "null";
            var sb = new StringBuilder(value.Length + 2);
            sb.Append('"');
            foreach (var c in value)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }
    }
}
