using System;
using System.Collections.Generic;
using System.Linq;
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
        public float Entrance;      // direction de la porte, en degrés (rotation Y de Unity : 0 = +X, 90 = -Z)
        public bool InCity;         // bâtie avec la ville : le sol appartient à la ville
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
              .Append(",\"entrance\":").Append(Json.F(Entrance)).Append(",\"inCity\":").Append(InCity ? "true" : "false")
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
                Entrance = (float)Json.Num(obj.TryGetValue("entrance", out var en) ? en : null),
                InCity = obj.TryGetValue("inCity", out var ic) && ic is bool b && b,
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
        public const float Radius = 22f;
        // Le nivellement du jeu est limité à ±8 m par point : au-delà, l'arène finirait dans un trou ou sur un plateau.
        private const float MaxSlope = 15f;

        public static readonly List<string> MissingPrefabs = new List<string>();
        // Marque posée sur chaque pièce construite : les identifiants d'objets changent au rechargement du monde,
        // c'est elle qui permet de retrouver l'arène ensuite.
        private static readonly int ArenaMark = "HearthwatchArena".GetStableHashCode();
        private static readonly HashSet<int> LegacyPrefabs = new HashSet<int>(new[]
        {
            "stone_floor_2x2", "stone_wall_2x1", "stone_pillar", "piece_groundtorch", "piece_groundtorch_green", "sign", "piece_banner01",
        }.Select(n => n.GetStableHashCode()));

        private static readonly AccessTools.FieldRef<ZDOMan, Dictionary<ZDOID, ZDO>> ObjectsById =
            AccessTools.FieldRefAccess<ZDOMan, Dictionary<ZDOID, ZDO>>("m_objectsByID");

        public static string LastTerrainMethod => Terrain.LastMethod;

        // Cherche autour d'un point (dans un anneau de 34 à 90 m) l'endroit le plus plat, hors eau.
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
            float min = float.MaxValue, max = float.MinValue;
            for (var dx = -Radius - 4f; dx <= Radius + 4f; dx += 2f)
                for (var dz = -Radius - 4f; dz <= Radius + 4f; dz += 2f)
                {
                    if (dx * dx + dz * dz > (Radius + 4f) * (Radius + 4f)) continue;
                    var h = Game.GroundHeight(candidate.x + dx, candidate.z + dz);
                    if (h < ZoneSystem.instance.m_waterLevel + 1.5f) return false;
                    if (h < min) min = h;
                    if (h > max) max = h;
                }
            var biome = WorldGenerator.instance.GetBiome(candidate.x, candidate.z);
            if (biome == Heightmap.Biome.Ocean) return false;
            score = max - min;
            floorY = Mathf.Round(((min + max) / 2f) * 2f) / 2f;
            return true;
        }

        // Construit le colisée dans son propre repère (porte vers +X local), tourné ensuite de `entrance` degrés :
        // muraille de 6 m crénelée, gradins, huit tours de marbre noir à brasero, porte couverte d'arcades et de tentures,
        // allée de torches et trône du maître d'arène dehors. Chaque pièce de construction est posée par le bas de sa
        // boîte de collision, les objets plantés (torches) et suspendus (bannières) par leur pivot, comme le fait le jeu.
        public static ArenaSite Build(Vector3 center, float floorY, float entrance = 0f, bool inCity = false)
        {
            MissingPrefabs.Clear();
            var site = new ArenaSite
            {
                Center = new Vector3(center.x, floorY, center.z), FloorY = floorY, Radius = Radius, Entrance = entrance, InCity = inCity,
                CreatedAt = DateTime.UtcNow.ToString("o"),
            };

            ClearSite(site.Center, Radius + 24f);
            var floor = new[] { PaintShape.MakeCircle(PaintShape.Paved, center.x, center.z, Radius + 3f) };
            if (!Terrain.Apply(site.Center, Radius + 4f, 8f, floorY, floor))
                throw new InvalidOperationException("Impossible de niveler le terrain : prefab _TerrainCompiler introuvable");

            var cos = Mathf.Cos(entrance * Mathf.Deg2Rad);
            var sin = Mathf.Sin(entrance * Mathf.Deg2Rad);
            // Local (x, z) → monde, avec la convention de Quaternion.Euler(0, θ, 0).
            Vector3 World(float lx, float lz) => new Vector3(center.x + lx * cos + lz * sin, floorY, center.z - lx * sin + lz * cos);
            void Put(string name, float lx, float lz, float bottom, float rot, bool pivot = false, string text = null)
            {
                var prefab = Prefab(name);
                if (prefab != null) PlaceBottom(site, prefab, World(lx, lz), floorY + bottom, rot + entrance, pivot, text);
            }
            // Angle polaire local (0 = porte, sens de +X vers +Z) ; la pièce a son axe Z local tourné vers l'extérieur.
            void Ring(string name, float deg, float r, float bottom, float along = 0f, bool pivot = false, float extraRot = 0f)
            {
                var a = deg * Mathf.Deg2Rad;
                Put(name, Mathf.Cos(a) * r - Mathf.Sin(a) * along, Mathf.Sin(a) * r + Mathf.Cos(a) * along, bottom, 90f - deg + extraRot, pivot);
            }

            // Muraille : trois rangées de blocs 4×2 (6 m), deux merlons par bloc, gradins un bloc sur deux.
            const float wallR = Radius + 0.5f;
            var segments = Mathf.CeilToInt(2f * Mathf.PI * wallR / 3.8f);
            var step = 360f / segments;
            const float gateHalf = 8f;
            var firstKept = float.MaxValue;
            for (var i = 0; i < segments; i++)
            {
                var deg = i * step;
                var off = Mathf.Abs(Mathf.DeltaAngle(deg, 0f));
                if (off < gateHalf + step / 2f) continue;
                firstKept = Mathf.Min(firstKept, off);
                for (var row = 0; row < 3; row++) Ring("stone_wall_4x2", deg, wallR, row * 2f);
                Ring("stone_wall_1x1", deg, wallR, 6f, -1.5f);
                Ring("stone_wall_1x1", deg, wallR, 6f, 0.5f);
                if (i % 2 == 0) Ring("stone_stair", deg, Radius - 1f, 0f, 0f, false, 180f);
            }

            // Tours de marbre noir (2×2×10 m) à brasero, adossées à l'extérieur, tous les 45° et de part et d'autre de la porte.
            void Tower(float deg)
            {
                for (var h = 0; h < 5; h++) Ring("blackmarble_2x2x2", deg, Radius + 2f, h * 2f);
                Ring("piece_brazierfloor01", deg, Radius + 2f, 10f);
            }
            for (var k = 1; k < 8; k++) Tower(k * 45f);
            Tower(firstKept + step * 0.8f);
            Tower(-(firstKept + step * 0.8f));

            // Porte : linteau crénelé au-dessus de l'ouverture, arcades dessous, tentures rouges des deux côtés.
            var endAngle = firstKept - 2f / wallR * Mathf.Rad2Deg;
            var gateWidth = 2f * wallR * Mathf.Sin(endAngle * Mathf.Deg2Rad);
            var span = Mathf.Max(2, Mathf.CeilToInt(gateWidth / 4f));
            for (var s = 0; s < span; s++)
            {
                var along = -gateWidth / 2f + 2f + s * (gateWidth - 4f) / (span - 1);
                Put("stone_wall_4x2", wallR, along, 4f, 90f);
                Put("stone_wall_1x1", wallR, along - 1.5f, 6f, 90f);
                Put("stone_wall_1x1", wallR, along + 0.5f, 6f, 90f);
            }
            for (var a = -gateWidth / 2f + 1f; a <= gateWidth / 2f - 1f + 0.01f; a += 2f)
                Put("stone_arch", wallR, a, 3f, 90f);
            foreach (var along in new[] { -2.4f, 2.4f })
            {
                Put("piece_banner02", wallR + 0.62f, along, 5.8f, 0f, true);
                Put("piece_banner02", wallR - 0.62f, along, 5.8f, 180f, true);
            }

            // Bannières accrochées à la face intérieure de la muraille, entre les tours (sauf côté porte).
            for (var k = 1; k < 7; k++)
            {
                var deg = 22.5f + k * 45f;
                var a = deg * Mathf.Deg2Rad;
                Put("piece_banner07", Mathf.Cos(a) * (Radius - 0.12f), Mathf.Sin(a) * (Radius - 0.12f), 5.8f, 180f - deg, true);
            }

            // Intérieur : lanternes naines tournées vers le centre, quatre torches bleues autour du cercle central.
            for (var k = 0; k < 8; k++) Ring("piece_dvergr_lantern_pole", 22.5f + k * 45f, Radius - 3.5f, 0f, 0f, false, -90f);
            for (var k = 0; k < 4; k++) Ring("piece_groundtorch_blue", 45f + k * 90f, 5f, 0f);

            // Dehors : braseros de part et d'autre de la porte, allée de torches, trône du maître d'arène et son panneau.
            // Dans une ville, c'est le générateur de la ville qui aménage les abords.
            if (inCity) return site;
            foreach (var side in new[] { 1f, -1f })
            {
                Put("piece_brazierfloor01", Radius + 4f, side * 6f, 0f, 0f);
                for (var d = 8f; d <= 18f; d += 5f) Put("piece_groundtorch", Radius + d, side * 4f, 0f, 0f);
            }
            Put("piece_blackmarble_throne", Radius + 11f, 9f, 0f, 180f);
            Put("stone_pillar", Radius + 8f, 6.5f, 0f, 0f);
            Put("sign", Radius + 8f, 5.95f, 1.2f, 180f, true, Tables.T("Arène — entrez dans le cercle pour combattre"));

            return site;
        }

        // Pose une pièce : `bottom` est la hauteur du bas de sa boîte de collision (ou de son pivot si `pivot`),
        // la position horizontale celle du centre de cette boîte.
        private static void PlaceBottom(ArenaSite site, GameObject prefab, Vector3 at, float bottom, float rotY, bool pivot, string text)
        {
            var rot = Quaternion.Euler(0f, rotY, 0f);
            var pos = new Vector3(at.x, bottom, at.z);
            if (!pivot && !Geometry.Clips(prefab) && Geometry.TryColliderBox(prefab, out var min, out var max))
            {
                var offset = rot * new Vector3((min.x + max.x) / 2f, 0f, (min.z + max.z) / 2f);
                pos = new Vector3(at.x - offset.x, bottom - min.y, at.z - offset.z);
            }
            var zdo = Place(site, prefab, pos, rot);
            if (zdo != null && text != null) zdo.Set(ZDOVars.s_text, text);
        }

        // Retrouve les pièces de l'arène dans le monde : par marque, sinon (arène d'une version antérieure) par type dans son emprise.
        public static List<ZDO> FindPieces(ArenaSite site)
        {
            var marked = new List<ZDO>();
            var legacy = new List<ZDO>();
            var reach = site.Radius + 30f;
            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
            {
                var p = zdo.GetPosition();
                var dx = p.x - site.Center.x;
                var dz = p.z - site.Center.z;
                if (dx * dx + dz * dz > reach * reach) continue;
                if (zdo.GetInt(ArenaMark) == 1) marked.Add(zdo);
                else if (LegacyPrefabs.Contains(zdo.GetPrefab()) && dx * dx + dz * dz <= (site.Radius + 6f) * (site.Radius + 6f)) legacy.Add(zdo);
            }
            return marked.Count > 0 ? marked : legacy;
        }

        // Pièces encore debout, par type.
        public static Dictionary<string, int> Census(ArenaSite site)
        {
            var result = new Dictionary<string, int>();
            foreach (var zdo in FindPieces(site))
            {
                var name = Game.PrefabName(zdo.GetPrefab()) ?? "?";
                result.TryGetValue(name, out var n);
                result[name] = n + 1;
            }
            return result;
        }

        // Pièces marquées « arène » qui n'appartiennent pas à l'arène actuelle.
        public static int RemoveLeftovers(ArenaSite site)
        {
            var doomed = new List<ZDO>();
            var reach = site != null ? site.Radius + 30f : 0f;
            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
            {
                if (zdo.GetInt(ArenaMark) != 1) continue;
                if (site != null)
                {
                    var p = zdo.GetPosition();
                    var dx = p.x - site.Center.x;
                    var dz = p.z - site.Center.z;
                    if (dx * dx + dz * dz <= reach * reach) continue;
                }
                doomed.Add(zdo);
            }
            foreach (var zdo in doomed) Game.Destroy(zdo);
            return doomed.Count;
        }

        public static void Relink(ArenaSite site)
        {
            site.Pieces.Clear();
            foreach (var zdo in FindPieces(site)) site.Pieces.Add(zdo.m_uid);
        }

        public static int Demolish(ArenaSite site)
        {
            var removed = 0;
            foreach (var zdo in FindPieces(site))
            {
                Game.Destroy(zdo);
                removed++;
            }
            site.Pieces.Clear();
            // Une arène bâtie dans la ville laisse le sol de la ville tel quel.
            if (!site.InCity)
                try { Terrain.Apply(site.Center, site.Radius + 4f, 8f, site.FloorY, null, restore: true); }
                catch (Exception) { /* le terrain reste pavé : sans gravité */ }
            return removed;
        }

        // Retire arbres, rochers, buissons, cueillettes, objets au sol et créatures sauvages (jamais les constructions ni les joueurs).
        public static int ClearSite(Vector3 center, float radius, Vector3? keep = null, float keepRadius = 0f)
        {
            var doomed = new List<ZDO>();
            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
            {
                var p = zdo.GetPosition();
                var dx = p.x - center.x;
                var dz = p.z - center.z;
                if (dx * dx + dz * dz > radius * radius) continue;
                if (keep.HasValue && (p.x - keep.Value.x) * (p.x - keep.Value.x) + (p.z - keep.Value.z) * (p.z - keep.Value.z) <= keepRadius * keepRadius) continue;
                var prefab = ZNetScene.instance.GetPrefab(zdo.GetPrefab());
                if (prefab == null || prefab.GetComponent<Piece>() != null || prefab.GetComponent<Player>() != null) continue;
                if (zdo.GetInt(CityService.CityMark) != 0 || zdo.GetInt(ArenaMark) != 0) continue; // gardes et animaux de la ville
                var wild = prefab.GetComponent<TreeBase>() != null || prefab.GetComponent<TreeLog>() != null || prefab.GetComponent<MineRock>() != null ||
                           prefab.GetComponent<MineRock5>() != null || prefab.GetComponent<Destructible>() != null || prefab.GetComponent<Pickable>() != null ||
                           prefab.GetComponent<ItemDrop>() != null || (prefab.GetComponent<Character>() != null && !zdo.GetBool(ZDOVars.s_tamed));
                if (wild) doomed.Add(zdo);
            }
            foreach (var zdo in doomed) Game.Destroy(zdo);
            return doomed.Count;
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
            zdo.Set(ArenaMark, 1);
            if (Ownership.CanLock(prefab))
            {
                Ownership.Lock(zdo);
                Game.KeepLit(prefab, zdo);
            }
            site.Pieces.Add(zdo.m_uid);
            return zdo;
        }
    }
}
