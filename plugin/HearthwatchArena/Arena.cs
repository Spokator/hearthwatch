using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using HarmonyLib;
using UnityEngine;

namespace HearthwatchArena
{
    // L'arène physique : recherche d'un emplacement plat, construction en pierre, démolition.
    internal sealed class ArenaSite
    {
        public Vector3 Center;
        public float Radius = 22f;
        public float FloorY;
        public string CreatedAt;
        public List<ZDOID> Pieces = new List<ZDOID>();

        public bool Inside(Vector3 p, float margin = 0f)
        {
            var dx = p.x - Center.x;
            var dz = p.z - Center.z;
            return dx * dx + dz * dz <= (Radius + margin) * (Radius + margin);
        }

        public void Write(StringBuilder sb)
        {
            sb.Append("{\"x\":").Append(Json.F(Center.x)).Append(",\"y\":").Append(Json.F(Center.y)).Append(",\"z\":").Append(Json.F(Center.z))
              .Append(",\"radius\":").Append(Json.F(Radius)).Append(",\"floorY\":").Append(Json.F(FloorY))
              .Append(",\"createdAt\":").Append(Json.Str(CreatedAt)).Append(",\"pieces\":[");
            var first = true;
            foreach (var id in Pieces)
            {
                Json.Sep(sb, ref first);
                sb.Append(Json.Str(Game.ZdoId(id)));
            }
            sb.Append("]}");
        }

        public static ArenaSite Read(Dictionary<string, object> obj)
        {
            if (obj == null) return null;
            var site = new ArenaSite
            {
                Center = new Vector3((float)Json.Num(obj.TryGetValue("x", out var x) ? x : null), (float)Json.Num(obj.TryGetValue("y", out var y) ? y : null), (float)Json.Num(obj.TryGetValue("z", out var z) ? z : null)),
                Radius = (float)Json.Num(obj.TryGetValue("radius", out var r) ? r : null, 22),
                FloorY = (float)Json.Num(obj.TryGetValue("floorY", out var fy) ? fy : null),
                CreatedAt = Json.Text(obj.TryGetValue("createdAt", out var c) ? c : null),
            };
            var pieces = Json.Arr(obj.TryGetValue("pieces", out var p) ? p : null);
            if (pieces != null)
                foreach (var item in pieces)
                    if (Game.TryZdoId(Json.Text(item), out var id)) site.Pieces.Add(id);
            return site;
        }
    }

    internal static class ArenaBuilder
    {
        private const float Radius = 22f;
        private const float EntranceHalfAngle = 8f; // demi-ouverture de la porte, en degrés (côté est)
        // Le nivellement du jeu est limité à ±8 m par point : au-delà, l'arène finirait dans un trou ou sur un plateau.
        private const float MaxSlope = 15f;

        public static readonly List<string> MissingPrefabs = new List<string>();

        private static readonly AccessTools.FieldRef<ZDOMan, Dictionary<ZDOID, ZDO>> ObjectsById =
            AccessTools.FieldRefAccess<ZDOMan, Dictionary<ZDOID, ZDO>>("m_objectsByID");

        // Cherche autour d'un point (dans un anneau de 20 à 70 m) l'endroit le plus plat, hors eau.
        public static bool FindFlatSpot(Vector3 origin, out Vector3 center, out float floorY)
        {
            center = origin;
            floorY = 0f;
            var bestScore = float.MaxValue;
            var found = false;
            for (var ring = 34f; ring <= 90f; ring += 8f)
            {
                var steps = Mathf.RoundToInt(ring / 4f);
                for (var i = 0; i < steps; i++)
                {
                    var angle = i * Mathf.PI * 2f / steps;
                    var candidate = origin + new Vector3(Mathf.Cos(angle) * ring, 0f, Mathf.Sin(angle) * ring);
                    if (!Score(candidate, out var score, out var y)) continue;
                    if (score < bestScore)
                    {
                        bestScore = score;
                        center = new Vector3(candidate.x, y, candidate.z);
                        floorY = y;
                        found = true;
                    }
                }
                if (found && bestScore < 2f) break;
            }
            return found && bestScore <= MaxSlope;
        }

        public static bool Score(Vector3 candidate, out float score, out float floorY)
        {
            score = float.MaxValue;
            floorY = 0f;
            float min = float.MaxValue, max = float.MinValue, sum = 0f;
            var n = 0;
            for (var dx = -Radius - 4f; dx <= Radius + 4f; dx += 2f)
                for (var dz = -Radius - 4f; dz <= Radius + 4f; dz += 2f)
                {
                    if (dx * dx + dz * dz > (Radius + 4f) * (Radius + 4f)) continue;
                    var h = Game.GroundHeight(candidate.x + dx, candidate.z + dz);
                    if (h < ZoneSystem.instance.m_waterLevel + 1.5f) return false;
                    if (h < min) min = h;
                    if (h > max) max = h;
                    sum += h;
                    n++;
                }
            var biome = WorldGenerator.instance.GetBiome(candidate.x, candidate.z);
            if (biome == Heightmap.Biome.Ocean) return false;
            score = max - min;
            floorY = Mathf.Round((sum / n) * 2f) / 2f;
            return true;
        }

        // ---------- Terrain ----------

        private static readonly int TerrainCompilerHash = "_TerrainCompiler".GetStableHashCode();
        public static string LastTerrainMethod = "";
        public static readonly List<(ZDOID id, float until)> PendingOps = new List<(ZDOID, float)>();

        // Un serveur dédié ne garde aucune carte de hauteur (zones fantômes), donc pas de TerrainComp à qui parler.
        // On écrit directement les données de terrain de chaque zone (le tableau que la houe modifie) : décalage
        // de hauteur vers la cible (±8 m max) et peinture pavée. Les clients les appliquent dès réception.
        public static bool Flatten(Vector3 center, float radius, float height, bool restore = false)
        {
            var zonePrefab = ZoneSystem.instance.m_zonePrefab;
            var hm = zonePrefab != null ? zonePrefab.GetComponentInChildren<Heightmap>(true) : null;
            var width = hm != null ? hm.m_width : 64;
            var scale = hm != null ? hm.m_scale : 1f;
            var pitch = width + 1;
            var half = width * scale / 2f;
            var blend = 8f; // pente douce entre l'arène et le terrain naturel

            var zones = new HashSet<Vector2s>();
            for (var dx = -radius - blend; dx <= radius + blend; dx += 8f)
                for (var dz = -radius - blend; dz <= radius + blend; dz += 8f)
                    zones.Add(ZoneSystem.GetZone(center + new Vector3(dx, 0f, dz)));

            var touched = 0;
            foreach (var zone in zones)
            {
                var zonePos = ZoneSystem.GetZonePos(zone);
                var comp = FindOrCreateCompiler(zone, zonePos);
                if (comp == null) continue;

                var modifiedHeight = new bool[pitch * pitch];
                var levelDelta = new float[pitch * pitch];
                var smoothDelta = new float[pitch * pitch];
                var modifiedPaint = new bool[pitch * pitch];
                var paintMask = new Color[pitch * pitch];
                var operations = 0;
                var existing = comp.GetByteArray(ZDOVars.s_TCData);
                if (existing != null)
                {
                    try
                    {
                        var pkg = new ZPackage(Utils.Decompress(existing));
                        pkg.ReadInt();
                        operations = pkg.ReadInt();
                        pkg.ReadVector3();
                        pkg.ReadSingle();
                        var n = pkg.ReadInt();
                        if (n == modifiedHeight.Length)
                        {
                            for (var i = 0; i < n; i++)
                            {
                                modifiedHeight[i] = pkg.ReadBool();
                                if (modifiedHeight[i]) { levelDelta[i] = pkg.ReadSingle(); smoothDelta[i] = pkg.ReadSingle(); }
                            }
                            var m = pkg.ReadInt();
                            if (m == modifiedPaint.Length)
                                for (var i = 0; i < m; i++)
                                {
                                    modifiedPaint[i] = pkg.ReadBool();
                                    if (modifiedPaint[i]) paintMask[i] = new Color(pkg.ReadSingle(), pkg.ReadSingle(), pkg.ReadSingle(), pkg.ReadSingle());
                                }
                        }
                    }
                    catch (Exception) { /* données illisibles : on repart de zéro pour cette zone */ }
                }

                var changed = 0;
                for (var i = 0; i < pitch; i++)
                    for (var j = 0; j < pitch; j++)
                    {
                        var wx = zonePos.x - half + j * scale;
                        var wz = zonePos.z - half + i * scale;
                        var dist = Mathf.Sqrt((wx - center.x) * (wx - center.x) + (wz - center.z) * (wz - center.z));
                        if (dist > radius + blend) continue;
                        var idx = i * pitch + j;
                        if (restore)
                        {
                            modifiedHeight[idx] = false;
                            levelDelta[idx] = 0f;
                            smoothDelta[idx] = 0f;
                            modifiedPaint[idx] = false;
                            changed++;
                            continue;
                        }
                        var baseHeight = WorldGenerator.instance.GetHeight(wx, wz);
                        var weight = dist <= radius ? 1f : 1f - (dist - radius) / blend;
                        modifiedHeight[idx] = true;
                        levelDelta[idx] = Mathf.Clamp((height - baseHeight) * weight, -8f, 8f);
                        smoothDelta[idx] = 0f;
                        if (dist <= radius)
                        {
                            modifiedPaint[idx] = true;
                            paintMask[idx] = Heightmap.m_paintMaskPaved;
                        }
                        changed++;
                    }
                if (changed == 0) continue;

                var outPkg = new ZPackage();
                outPkg.Write(1);
                outPkg.Write(operations + 1);
                outPkg.Write(center);
                outPkg.Write(radius);
                outPkg.Write(modifiedHeight.Length);
                for (var i = 0; i < modifiedHeight.Length; i++)
                {
                    outPkg.Write(modifiedHeight[i]);
                    if (modifiedHeight[i]) { outPkg.Write(levelDelta[i]); outPkg.Write(smoothDelta[i]); }
                }
                outPkg.Write(modifiedPaint.Length);
                for (var i = 0; i < modifiedPaint.Length; i++)
                {
                    outPkg.Write(modifiedPaint[i]);
                    if (modifiedPaint[i]) { outPkg.Write(paintMask[i].r); outPkg.Write(paintMask[i].g); outPkg.Write(paintMask[i].b); outPkg.Write(paintMask[i].a); }
                }
                comp.SetOwner(ZDOMan.GetSessionID());
                comp.Set(ZDOVars.s_TCData, Utils.Compress(outPkg.GetArray()));
                touched++;
            }
            LastTerrainMethod = $"terrain data, {touched} zone(s)";
            return touched > 0;
        }

        private static ZDO FindOrCreateCompiler(Vector2s zone, Vector3 zonePos)
        {
            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
                if (zdo.GetPrefab() == TerrainCompilerHash && ZoneSystem.GetZone(zdo.GetPosition()) == zone) return zdo;
            var prefab = ZNetScene.instance.GetPrefab(TerrainCompilerHash);
            if (prefab == null) return null;
            var created = Game.Spawn(prefab, zonePos, Quaternion.identity);
            if (created != null) created.Persistent = true;
            return created;
        }

        public static void CleanupOps()
        {
            for (var i = PendingOps.Count - 1; i >= 0; i--)
            {
                if (Time.time < PendingOps[i].until) continue;
                Game.Destroy(PendingOps[i].id);
                PendingOps.RemoveAt(i);
            }
        }

        // Construit le colisée : terrain nivelé et pavé, muraille de 4 m couronnée d'arches, huit tours à brasero,
        // porte monumentale à l'est avec allée de torches, lanternes et bannières à l'intérieur, trône du maître dehors.
        public static ArenaSite Build(Vector3 center, float floorY)
        {
            MissingPrefabs.Clear();
            var site = new ArenaSite { Center = new Vector3(center.x, floorY, center.z), FloorY = floorY, Radius = Radius, CreatedAt = DateTime.UtcNow.ToString("o") };

            ClearSite(site.Center, Radius + 10f);
            if (!Flatten(site.Center, Radius + 4f, floorY))
                throw new InvalidOperationException("Impossible de niveler le terrain : prefab _TerrainCompiler introuvable");

            var y = floorY + 0.05f;
            var flat = new Vector3(center.x, y, center.z);
            Vector3 At(float deg, float r, float h = 0f) => new Vector3(center.x + Mathf.Cos(deg * Mathf.Deg2Rad) * r, y + h, center.z + Mathf.Sin(deg * Mathf.Deg2Rad) * r);
            Quaternion Face(Vector3 pos, bool inward)
            {
                var dir = inward ? flat - pos : pos - flat;
                dir.y = 0f;
                return Quaternion.LookRotation(dir.normalized);
            }
            bool InEntrance(float deg) => Mathf.Abs(Mathf.DeltaAngle(deg, 0f)) < EntranceHalfAngle;

            // Muraille : deux rangées de blocs 4x2 (4 m de haut), arches en créneaux un segment sur deux.
            var wall = Prefab("stone_wall_4x2");
            var arch = Prefab("stone_arch");
            var segments = Mathf.RoundToInt(2f * Mathf.PI * Radius / 4f);
            for (var i = 0; i < segments; i++)
            {
                var deg = i * 360f / segments;
                if (InEntrance(deg)) continue;
                var pos = At(deg, Radius);
                var rot = Face(pos, true);
                if (wall != null)
                {
                    Place(site, wall, pos, rot);
                    Place(site, wall, pos + Vector3.up * 2f, rot);
                }
                if (arch != null && i % 2 == 0) Place(site, arch, pos + Vector3.up * 4f, rot);
            }

            // Tours : trois piliers empilés et un brasero au sommet, tous les 45° (sauf la porte).
            var pillar = Prefab("stone_pillar");
            var brazier = Prefab("piece_brazierfloor01");
            void Tower(Vector3 basePos)
            {
                if (pillar == null) return;
                for (var h = 0f; h < 6f; h += 2f) Place(site, pillar, basePos + Vector3.up * h, Quaternion.identity);
                if (brazier != null) Place(site, brazier, basePos + Vector3.up * 6f, Quaternion.identity);
            }
            for (var k = 1; k < 8; k++) Tower(At(k * 45f, Radius + 1.3f));

            // Porte monumentale : deux tours encadrant l'ouverture, bannières rouges, braseros au sol.
            var bannerRed = Prefab("piece_banner02");
            foreach (var side in new[] { EntranceHalfAngle + 2f, -(EntranceHalfAngle + 2f) })
            {
                Tower(At(side, Radius + 0.6f));
                var bannerPos = At(side, Radius + 3f);
                if (bannerRed != null) Place(site, bannerRed, bannerPos, Face(bannerPos, false));
            }
            if (brazier != null)
                foreach (var dz in new[] { 5f, -5f })
                    Place(site, brazier, new Vector3(center.x + Radius + 5f, y, center.z + dz), Quaternion.identity);

            // Allée de torches vers la porte.
            var torch = Prefab("piece_groundtorch");
            if (torch != null)
                for (var d = 8f; d <= 20f; d += 4f)
                    foreach (var dz in new[] { 3f, -3f })
                        Place(site, torch, new Vector3(center.x + Radius + d, y, center.z + dz), Quaternion.identity);

            // Intérieur : lanternes dvergr entre les tours, torches bleues autour du centre, bannières sur la muraille.
            var lantern = Prefab("piece_dvergr_lantern_pole");
            if (lantern != null)
                for (var k = 0; k < 8; k++) Place(site, lantern, At(22.5f + k * 45f, Radius - 2.5f), Quaternion.identity);
            var blue = Prefab("piece_groundtorch_blue") ?? torch;
            if (blue != null)
                for (var k = 0; k < 4; k++) Place(site, blue, At(45f + k * 90f, 5f), Quaternion.identity);
            var banner = Prefab("piece_banner07");
            if (banner != null)
                for (var k = 1; k < 8; k += 2)
                {
                    var pos = At(k * 45f, Radius - 0.8f, 2.6f);
                    Place(site, banner, pos, Face(pos, true));
                }

            // Le maître d'arène : trône de marbre noir, panneau et coffre, à côté de l'allée.
            var throne = Prefab("piece_blackmarble_throne");
            var sign = Prefab("sign");
            var chest = Prefab("piece_chest_blackmetal");
            var seat = new Vector3(center.x + Radius + 12f, y, center.z + 9f);
            if (throne != null) Place(site, throne, seat, Face(seat, true));
            if (sign != null)
            {
                var signPos = new Vector3(center.x + Radius + 10f, y + 1.2f, center.z + 8f);
                var zdo = Place(site, sign, signPos, Face(signPos, true));
                zdo?.Set(ZDOVars.s_text, Tables.T("Arène — entrez dans le cercle pour combattre"));
            }
            if (chest != null) Place(site, chest, seat + new Vector3(0f, 0f, 2.5f), Face(seat, true));
            if (bannerRed != null)
                foreach (var dz in new[] { 7f, 11f })
                {
                    var pos = new Vector3(center.x + Radius + 14f, y, center.z + dz);
                    Place(site, bannerRed, pos, Face(pos, true));
                }

            return site;
        }

        public static int Demolish(ArenaSite site)
        {
            var removed = 0;
            foreach (var id in site.Pieces)
            {
                if (ZDOMan.instance.GetZDO(id) == null) continue;
                Game.Destroy(id);
                removed++;
            }
            site.Pieces.Clear();
            try { Flatten(site.Center, site.Radius + 4f, site.FloorY, restore: true); }
            catch (Exception) { /* le terrain reste pavé : sans gravité */ }
            return removed;
        }

        // Retire arbres, rochers, buissons, cueillettes et créatures sauvages de l'emplacement (jamais les constructions ni les joueurs).
        private static void ClearSite(Vector3 center, float radius)
        {
            var doomed = new List<ZDO>();
            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
            {
                var p = zdo.GetPosition();
                var dx = p.x - center.x;
                var dz = p.z - center.z;
                if (dx * dx + dz * dz > radius * radius) continue;
                var prefab = ZNetScene.instance.GetPrefab(zdo.GetPrefab());
                if (prefab == null || prefab.GetComponent<Piece>() != null || prefab.GetComponent<Player>() != null) continue;
                var wild = prefab.GetComponent<TreeBase>() != null || prefab.GetComponent<TreeLog>() != null || prefab.GetComponent<MineRock>() != null ||
                           prefab.GetComponent<MineRock5>() != null || prefab.GetComponent<Destructible>() != null || prefab.GetComponent<Pickable>() != null ||
                           (prefab.GetComponent<Character>() != null && !zdo.GetBool(ZDOVars.s_tamed));
                if (wild) doomed.Add(zdo);
            }
            foreach (var zdo in doomed) ZDOMan.instance.DestroyZDO(zdo);
        }

        private static GameObject Prefab(string name)
        {
            var prefab = ZNetScene.instance.GetPrefab(name);
            if (prefab == null && !MissingPrefabs.Contains(name)) MissingPrefabs.Add(name);
            return prefab;
        }

        private static ZDO Place(ArenaSite site, GameObject prefab, Vector3 position, Quaternion rotation)
        {
            var zdo = Game.Spawn(prefab, position, rotation);
            if (zdo == null) return null;
            site.Pieces.Add(zdo.m_uid);
            return zdo;
        }
    }
}
