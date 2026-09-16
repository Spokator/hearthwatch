using System;
using System.Collections.Generic;
using System.Text;
using HarmonyLib;
using UnityEngine;

namespace HearthwatchArena
{
    // L'arène physique : recherche d'un emplacement plat, construction en pierre, démolition.
    internal sealed class ArenaSite
    {
        public Vector3 Center;
        public float Radius = 14f;
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
                Radius = (float)Json.Num(obj.TryGetValue("radius", out var r) ? r : null, 14),
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
        private const float Radius = 14f;
        private const float MaxSlope = 1.6f; // écart de hauteur toléré sur toute l'arène (m)

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
            for (var ring = 24f; ring <= 72f; ring += 8f)
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
                if (found && bestScore < 0.5f) break;
            }
            return found && bestScore <= MaxSlope;
        }

        public static bool Score(Vector3 candidate, out float score, out float floorY)
        {
            score = float.MaxValue;
            floorY = 0f;
            float min = float.MaxValue, max = float.MinValue;
            for (var dx = -Radius - 2f; dx <= Radius + 2f; dx += 2f)
                for (var dz = -Radius - 2f; dz <= Radius + 2f; dz += 2f)
                {
                    if (dx * dx + dz * dz > (Radius + 2f) * (Radius + 2f)) continue;
                    var h = Game.GroundHeight(candidate.x + dx, candidate.z + dz);
                    if (h < ZoneSystem.instance.m_waterLevel + 1.5f) return false;
                    if (h < min) min = h;
                    if (h > max) max = h;
                }
            var biome = WorldGenerator.instance.GetBiome(candidate.x, candidate.z);
            if (biome == Heightmap.Biome.Ocean) return false;
            score = max - min;
            floorY = max + 0.05f;
            return true;
        }

        // Construit l'arène : sol de dalles, muraille avec une entrée à l'est, torches, panneau.
        public static ArenaSite Build(Vector3 center, float floorY)
        {
            MissingPrefabs.Clear();
            var site = new ArenaSite { Center = new Vector3(center.x, floorY, center.z), FloorY = floorY, Radius = Radius, CreatedAt = DateTime.UtcNow.ToString("o") };

            ClearSite(site.Center, Radius + 3f);

            // Sol : dalles 2x2 sur toute la surface, chacune posée à sa propre hauteur de sol (jamais en l'air).
            var floor = Prefab("stone_floor_2x2");
            if (floor != null)
                for (var dx = -Radius; dx <= Radius; dx += 2f)
                    for (var dz = -Radius; dz <= Radius; dz += 2f)
                    {
                        if (dx * dx + dz * dz > (Radius + 1f) * (Radius + 1f)) continue;
                        var x = center.x + dx;
                        var z = center.z + dz;
                        var y = Mathf.Max(Game.GroundHeight(x, z) + 0.05f, floorY - 1.0f);
                        Place(site, floor, new Vector3(x, y, z), Quaternion.identity);
                    }

            // Muraille : deux rangées de murs 2x1, entrée de 4 m côté est.
            var wall = Prefab("stone_wall_2x1");
            var pillar = Prefab("stone_pillar");
            var segments = Mathf.RoundToInt(2f * Mathf.PI * Radius / 2f);
            for (var i = 0; i < segments; i++)
            {
                var angle = i * Mathf.PI * 2f / segments;
                if (Mathf.Abs(Mathf.DeltaAngle(angle * Mathf.Rad2Deg, 0f)) < 9f) continue; // entrée
                var x = center.x + Mathf.Cos(angle) * Radius;
                var z = center.z + Mathf.Sin(angle) * Radius;
                var y = Mathf.Max(Game.GroundHeight(x, z) + 0.05f, floorY - 1.0f);
                var rot = Quaternion.LookRotation(new Vector3(center.x - x, 0f, center.z - z));
                if (wall != null)
                {
                    Place(site, wall, new Vector3(x, y, z), rot);
                    Place(site, wall, new Vector3(x, y + 1f, z), rot);
                }
            }
            if (pillar != null)
                foreach (var a in new[] { 9f, -9f })
                {
                    var rad = a * Mathf.Deg2Rad;
                    var x = center.x + Mathf.Cos(rad) * Radius;
                    var z = center.z + Mathf.Sin(rad) * Radius;
                    Place(site, pillar, new Vector3(x, Game.GroundHeight(x, z) + 0.05f, z), Quaternion.identity);
                }

            // Torches sur le pourtour intérieur, vertes à l'entrée.
            var torch = Prefab("piece_groundtorch");
            var torchGreen = Prefab("piece_groundtorch_green") ?? torch;
            for (var i = 0; i < 8; i++)
            {
                var angle = i * Mathf.PI / 4f;
                var x = center.x + Mathf.Cos(angle) * (Radius - 1.5f);
                var z = center.z + Mathf.Sin(angle) * (Radius - 1.5f);
                var prefab = i == 0 ? torchGreen : torch;
                if (prefab != null) Place(site, prefab, new Vector3(x, Game.GroundHeight(x, z) + 0.1f, z), Quaternion.identity);
            }

            // Panneau du maître d'arène devant l'entrée, et bannières.
            var sign = Prefab("sign");
            if (sign != null)
            {
                var pos = new Vector3(center.x + Radius + 3f, 0f, center.z);
                pos.y = Game.GroundHeight(pos.x, pos.z) + 1.2f;
                var zdo = Place(site, sign, pos, Quaternion.LookRotation(Vector3.left));
                zdo?.Set(ZDOVars.s_text, Tables.T("Arène — entrez dans le cercle pour combattre"));
            }
            var banner = Prefab("piece_banner01");
            if (banner != null)
                foreach (var side in new[] { 3f, -3f })
                {
                    var pos = new Vector3(center.x + Radius + 1f, 0f, center.z + side);
                    pos.y = Game.GroundHeight(pos.x, pos.z) + 0.05f;
                    Place(site, banner, pos, Quaternion.LookRotation(Vector3.left));
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
