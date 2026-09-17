using System;
using System.Collections.Generic;
using HarmonyLib;
using UnityEngine;

namespace HearthwatchArena
{
    // Forme de terrain : peinture du sol (pavé, terre…), zone dont la hauteur reste intacte, ou creusement (douves, canal).
    // Formes : cercle, rectangle orienté, segment épais.
    internal struct PaintShape
    {
        public const int Paved = 0, Dirt = 1, Cultivated = 2, ClearVegetation = 3, Reset = 4, KeepHeight = 5, Dig = 6;
        public const int Circle = 0, Rect = 1, Segment = 2;
        // Bord adouci d'un creusement : la berge descend sur cette largeur.
        public const float DigEdge = 2.5f;

        public int Kind, Type;
        public float A, B, C, D, E;
        public float F; // creusement : hauteur absolue du fond

        public static PaintShape MakeCircle(int kind, float x, float z, float r) => new PaintShape { Kind = kind, Type = Circle, A = x, B = z, C = r };

        public bool Contains(float x, float z) => Distance(x, z) <= 0f;

        // Distance signée au bord de la forme (négative à l'intérieur).
        public float Distance(float x, float z)
        {
            switch (Type)
            {
                case Circle:
                    return Mathf.Sqrt((x - A) * (x - A) + (z - B) * (z - B)) - C;
                case Rect:
                {
                    var rad = E * Mathf.Deg2Rad;
                    var dx = x - A;
                    var dz = z - B;
                    // Repère de Unity : une rotation Y de θ envoie l'axe local X sur (cos θ, -sin θ).
                    var lx = dx * Mathf.Cos(rad) - dz * Mathf.Sin(rad);
                    var lz = dx * Mathf.Sin(rad) + dz * Mathf.Cos(rad);
                    return Mathf.Max(Mathf.Abs(lx) - C, Mathf.Abs(lz) - D);
                }
                case Segment:
                {
                    var vx = C - A;
                    var vz = D - B;
                    var len2 = vx * vx + vz * vz;
                    var t = len2 > 0f ? Mathf.Clamp01(((x - A) * vx + (z - B) * vz) / len2) : 0f;
                    var px = A + vx * t - x;
                    var pz = B + vz * t - z;
                    return Mathf.Sqrt(px * px + pz * pz) - E / 2f;
                }
            }
            return float.MaxValue;
        }

        public void Bounds(float margin, out float minX, out float minZ, out float maxX, out float maxZ)
        {
            switch (Type)
            {
                case Circle:
                    minX = A - C - margin; maxX = A + C + margin; minZ = B - C - margin; maxZ = B + C + margin;
                    return;
                case Rect:
                    var r = C + D + margin;
                    minX = A - r; maxX = A + r; minZ = B - r; maxZ = B + r;
                    return;
                default:
                    minX = Mathf.Min(A, C) - E - margin; maxX = Mathf.Max(A, C) + E + margin;
                    minZ = Mathf.Min(B, D) - E - margin; maxZ = Mathf.Max(B, D) + E + margin;
                    return;
            }
        }

        public Color? Mask
        {
            get
            {
                switch (Kind)
                {
                    case Paved: return Heightmap.m_paintMaskPaved;
                    case Dirt: return Heightmap.m_paintMaskDirt;
                    case Cultivated: return Heightmap.m_paintMaskCultivated;
                    case ClearVegetation: return Heightmap.m_paintMaskClearVegetation;
                    default: return null;
                }
            }
        }
    }

    // Un serveur dédié ne garde aucune carte de hauteur (zones fantômes), donc pas de TerrainComp à qui parler.
    // On écrit directement les données de terrain de chaque zone (le tableau que la houe modifie) : décalage
    // de hauteur vers la cible (±8 m max) et peinture. Les clients les appliquent dès réception.
    internal static class Terrain
    {
        private static readonly int CompilerHash = "_TerrainCompiler".GetStableHashCode();
        private static readonly AccessTools.FieldRef<ZDOMan, Dictionary<ZDOID, ZDO>> ObjectsById =
            AccessTools.FieldRefAccess<ZDOMan, Dictionary<ZDOID, ZDO>>("m_objectsByID");

        public const float MaxDelta = 8f;
        public static string LastMethod = "";

        // Nivelle un cercle (rayon + fondu) à `height`, applique les peintures, et creuse les formes « Dig » où qu'elles soient.
        // En mode `restore`, rend son état naturel à tout ce que ces mêmes formes ont touché.
        public static bool Apply(Vector3 center, float radius, float blend, float height, IList<PaintShape> paint, bool restore = false)
        {
            var zonePrefab = ZoneSystem.instance.m_zonePrefab;
            var hm = zonePrefab != null ? zonePrefab.GetComponentInChildren<Heightmap>(true) : null;
            var width = hm != null ? hm.m_width : 64;
            var scale = hm != null ? hm.m_scale : 1f;
            var pitch = width + 1;
            var half = width * scale / 2f;

            var digs = new List<PaintShape>();
            if (paint != null)
                foreach (var shape in paint)
                    if (shape.Kind == PaintShape.Dig) digs.Add(shape);

            var zones = new HashSet<Vector2s>();
            void AddArea(float minX, float minZ, float maxX, float maxZ)
            {
                for (var x = minX; x <= maxX + 8f; x += 8f)
                    for (var z = minZ; z <= maxZ + 8f; z += 8f)
                        zones.Add(ZoneSystem.GetZone(new Vector3(Mathf.Min(x, maxX), 0f, Mathf.Min(z, maxZ))));
            }
            var reach = radius + blend + 1f;
            AddArea(center.x - reach, center.z - reach, center.x + reach, center.z + reach);
            foreach (var dig in digs)
            {
                dig.Bounds(PaintShape.DigEdge + 1f, out var minX, out var minZ, out var maxX, out var maxZ);
                AddArea(minX, minZ, maxX, maxZ);
            }

            var compilers = new Dictionary<Vector2s, ZDO>();
            foreach (var zdo in ObjectsById(ZDOMan.instance).Values)
                if (zdo.GetPrefab() == CompilerHash)
                {
                    var zone = ZoneSystem.GetZone(zdo.GetPosition());
                    if (zones.Contains(zone) && !compilers.ContainsKey(zone)) compilers[zone] = zdo;
                }

            var touched = 0;
            foreach (var zone in zones)
            {
                var zonePos = ZoneSystem.GetZonePos(zone);
                if (!compilers.TryGetValue(zone, out var comp))
                {
                    if (restore) continue;
                    var prefab = ZNetScene.instance.GetPrefab(CompilerHash);
                    if (prefab == null) continue;
                    comp = Game.Spawn(prefab, zonePos, Quaternion.identity);
                    if (comp == null) continue;
                    comp.Persistent = true;
                }

                var n = pitch * pitch;
                var modifiedHeight = new bool[n];
                var levelDelta = new float[n];
                var smoothDelta = new float[n];
                var modifiedPaint = new bool[n];
                var paintMask = new Color[n];
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
                        var count = pkg.ReadInt();
                        if (count == n)
                        {
                            for (var i = 0; i < count; i++)
                            {
                                modifiedHeight[i] = pkg.ReadBool();
                                if (modifiedHeight[i]) { levelDelta[i] = pkg.ReadSingle(); smoothDelta[i] = pkg.ReadSingle(); }
                            }
                            var m = pkg.ReadInt();
                            if (m == n)
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
                        var inCircle = dist <= radius + blend;

                        var digWeight = 0f;
                        var digTarget = 0f;
                        foreach (var dig in digs)
                        {
                            var d = dig.Distance(wx, wz);
                            if (d >= PaintShape.DigEdge) continue;
                            var w = d <= 0f ? 1f : 1f - d / PaintShape.DigEdge;
                            if (w > digWeight) { digWeight = w; digTarget = dig.F; }
                        }
                        if (!inCircle && digWeight <= 0f) continue;

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
                        var target = baseHeight;
                        if (inCircle)
                        {
                            var weight = dist <= radius ? 1f : 1f - (dist - radius) / blend;
                            target = baseHeight + (height - baseHeight) * weight;
                        }
                        Color? mask = null;
                        var hit = false;
                        if (paint != null && inCircle)
                            for (var k = 0; k < paint.Count; k++)
                            {
                                var shape = paint[k];
                                if (shape.Kind == PaintShape.Dig || !shape.Contains(wx, wz)) continue;
                                // Un lieu du jeu (les pierres de départ) a déjà nivelé son sol : on n'y ajoute rien.
                                if (shape.Kind == PaintShape.KeepHeight)
                                {
                                    target = baseHeight;
                                    continue;
                                }
                                mask = shape.Mask;
                                hit = true;
                            }
                        if (digWeight > 0f) target = Mathf.Lerp(target, Mathf.Min(target, digTarget), digWeight);

                        var delta = Mathf.Clamp(target - baseHeight, -MaxDelta, MaxDelta);
                        modifiedHeight[idx] = Mathf.Abs(delta) > 0.001f;
                        levelDelta[idx] = modifiedHeight[idx] ? delta : 0f;
                        smoothDelta[idx] = 0f;
                        if (hit)
                        {
                            modifiedPaint[idx] = mask.HasValue;
                            if (mask.HasValue) paintMask[idx] = mask.Value;
                        }
                        changed++;
                    }
                if (changed == 0) continue;

                var outPkg = new ZPackage();
                outPkg.Write(1);
                outPkg.Write(operations + 1);
                outPkg.Write(center);
                outPkg.Write(radius);
                outPkg.Write(n);
                for (var i = 0; i < n; i++)
                {
                    outPkg.Write(modifiedHeight[i]);
                    if (modifiedHeight[i]) { outPkg.Write(levelDelta[i]); outPkg.Write(smoothDelta[i]); }
                }
                outPkg.Write(n);
                for (var i = 0; i < n; i++)
                {
                    outPkg.Write(modifiedPaint[i]);
                    if (modifiedPaint[i]) { outPkg.Write(paintMask[i].r); outPkg.Write(paintMask[i].g); outPkg.Write(paintMask[i].b); outPkg.Write(paintMask[i].a); }
                }
                comp.SetOwner(ZDOMan.GetSessionID());
                comp.Set(ZDOVars.s_TCData, Utils.Compress(outPkg.GetArray()));
                touched++;
            }
            LastMethod = $"terrain data, {touched} zone(s)";
            return touched > 0;
        }
    }
}
