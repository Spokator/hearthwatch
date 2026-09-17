using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;

namespace HearthwatchArena
{
    // Relevé des dimensions réelles de chaque pièce de construction (boîte englobante des collisions et du rendu,
    // points d'accroche), exporté pour le générateur de ville du panel : il place ainsi chaque pièce au centimètre,
    // quel que soit l'endroit où le jeu a mis son pivot.
    internal static class Geometry
    {
        private static readonly string[] Extras = { "Haldor", "Hildir", "BogWitch", "Dverger", "Lox", "Hen", "Wolf", "Boar", "StatueCorgi", "StatueDeer", "StatueEvil", "StatueHare", "StatueSeed", "StatueThor", "StatueFreya" };

        public static void Dump(string path)
        {
            var sb = new StringBuilder(512 * 1024);
            sb.Append("{\"version\":1,\"game\":").Append(Json.Str(global::Version.GetVersionString())).Append(",\"pieces\":{");
            var first = true;
            var seen = new HashSet<string>();
            foreach (var prefab in ZNetScene.instance.m_prefabs)
            {
                if (prefab == null) continue;
                var isExtra = Array.IndexOf(Extras, prefab.name) >= 0;
                if (prefab.GetComponent<Piece>() == null && !isExtra) continue;
                if (!seen.Add(prefab.name)) continue;
                try
                {
                    var entry = Describe(prefab);
                    if (entry == null) continue;
                    Json.Sep(sb, ref first);
                    sb.Append(Json.Str(prefab.name)).Append(':').Append(entry);
                }
                catch (Exception) { /* prefab exotique : ignoré */ }
            }
            sb.Append("}}");
            Files.WriteAtomic(path, sb.ToString());
        }

        // Objets du jeu que l'on peut exposer : armes, boucliers, armures, capes, outils, trophées. `craftable` : l'objet
        // a une recette (les armes de monstres et objets de test n'en ont pas).
        public static void DumpItems(string path)
        {
            if (ObjectDB.instance == null) return;
            var crafted = new HashSet<string>();
            foreach (var recipe in ObjectDB.instance.m_recipes)
                if (recipe != null && recipe.m_item != null && recipe.m_enabled) crafted.Add(recipe.m_item.gameObject.name);
            var sb = new StringBuilder(64 * 1024);
            sb.Append("{\"version\":1,\"items\":[");
            var first = true;
            foreach (var go in ObjectDB.instance.m_items)
            {
                var drop = go != null ? go.GetComponent<ItemDrop>() : null;
                if (drop == null) continue;
                var shared = drop.m_itemData.m_shared;
                switch (shared.m_itemType)
                {
                    case ItemDrop.ItemData.ItemType.OneHandedWeapon:
                    case ItemDrop.ItemData.ItemType.TwoHandedWeapon:
                    case ItemDrop.ItemData.ItemType.TwoHandedWeaponLeft:
                    case ItemDrop.ItemData.ItemType.Bow:
                    case ItemDrop.ItemData.ItemType.Shield:
                    case ItemDrop.ItemData.ItemType.Helmet:
                    case ItemDrop.ItemData.ItemType.Chest:
                    case ItemDrop.ItemData.ItemType.Legs:
                    case ItemDrop.ItemData.ItemType.Shoulder:
                    case ItemDrop.ItemData.ItemType.Tool:
                    case ItemDrop.ItemData.ItemType.Torch:
                    case ItemDrop.ItemData.ItemType.Trophy:
                    case ItemDrop.ItemData.ItemType.Utility:
                        break;
                    default:
                        continue;
                }
                Json.Sep(sb, ref first);
                sb.Append("{\"name\":").Append(Json.Str(go.name))
                  .Append(",\"type\":").Append(Json.Str(shared.m_itemType.ToString()))
                  .Append(",\"skill\":").Append(Json.Str(shared.m_skillType.ToString()))
                  .Append(",\"set\":").Append(Json.Str(shared.m_setName ?? ""))
                  .Append(",\"label\":").Append(Json.Str(shared.m_name))
                  .Append(",\"craftable\":").Append(crafted.Contains(go.name) ? "true" : "false")
                  .Append('}');
            }
            sb.Append("]}");
            Files.WriteAtomic(path, sb.ToString());
        }

        private static readonly Dictionary<string, Box> ColliderCache = new Dictionary<string, Box>();

        // Boîte des collisions dans le repère du prefab (celle qui compte pour poser une pièce sur une autre).
        public static bool TryColliderBox(GameObject prefab, out Vector3 min, out Vector3 max)
        {
            if (!ColliderCache.TryGetValue(prefab.name, out var box))
            {
                Measure(prefab, out box, out _);
                ColliderCache[prefab.name] = box;
            }
            min = box.Min;
            max = box.Max;
            return box.Valid;
        }

        // Pièce que le jeu pose par son pivot, enfoncée dans le sol (torches, piquets…) plutôt que par le bas de ses collisions.
        public static bool Clips(GameObject prefab)
        {
            var piece = prefab.GetComponent<Piece>();
            return piece != null && (piece.m_groundPiece || piece.m_clipGround || piece.m_clipEverything);
        }

        private static string Describe(GameObject prefab)
        {
            Measure(prefab, out var col, out var vis);
            return Format(prefab, col, vis);
        }

        private static void Measure(GameObject prefab, out Box col, out Box vis)
        {
            var root = prefab.transform.worldToLocalMatrix;
            col = Empty();
            foreach (var c in prefab.GetComponentsInChildren<Collider>(true))
            {
                if (c.isTrigger || !c.enabled || !Active(c.transform, prefab.transform)) continue;
                var m = root * c.transform.localToWorldMatrix;
                switch (c)
                {
                    case BoxCollider b: Add(ref col, m, b.center, b.size); break;
                    case SphereCollider s: Add(ref col, m, s.center, Vector3.one * s.radius * 2f); break;
                    case CapsuleCollider k:
                    {
                        var size = Vector3.one * k.radius * 2f;
                        size[k.direction] = Mathf.Max(k.height, k.radius * 2f);
                        Add(ref col, m, k.center, size);
                        break;
                    }
                    case MeshCollider mc when mc.sharedMesh != null: Add(ref col, m, mc.sharedMesh.bounds.center, mc.sharedMesh.bounds.size); break;
                }
            }
            vis = Empty();
            foreach (var mf in prefab.GetComponentsInChildren<MeshFilter>(true))
            {
                if (mf.sharedMesh == null) continue;
                var r = mf.GetComponent<MeshRenderer>();
                if (r == null || !r.enabled || !Active(mf.transform, prefab.transform)) continue;
                var m = root * mf.transform.localToWorldMatrix;
                Add(ref vis, m, mf.sharedMesh.bounds.center, mf.sharedMesh.bounds.size);
            }
            foreach (var smr in prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (smr.sharedMesh == null || !smr.enabled || !Active(smr.transform, prefab.transform)) continue;
                var m = root * smr.transform.localToWorldMatrix;
                Add(ref vis, m, smr.sharedMesh.bounds.center, smr.sharedMesh.bounds.size);
            }
        }

        private static string Format(GameObject prefab, Box col, Box vis)
        {
            var sb = new StringBuilder(256);
            sb.Append('{');
            AppendBox(sb, "col", col);
            sb.Append(',');
            AppendBox(sb, "vis", vis);

            sb.Append(",\"snap\":[");
            var first = true;
            foreach (Transform child in prefab.GetComponentsInChildren<Transform>(true))
            {
                if (child == prefab.transform || !child.CompareTag("snappoint")) continue;
                Json.Sep(sb, ref first);
                var p = prefab.transform.InverseTransformPoint(child.position);
                sb.Append('[').Append(F(p.x)).Append(',').Append(F(p.y)).Append(',').Append(F(p.z)).Append(']');
            }
            sb.Append(']');

            var piece = prefab.GetComponent<Piece>();
            if (piece != null)
            {
                sb.Append(",\"name\":").Append(Json.Str(piece.m_name));
                sb.Append(",\"category\":").Append(Json.Str(piece.m_category.ToString()));
                if (piece.m_comfort > 0) sb.Append(",\"comfort\":").Append(piece.m_comfort);
                if (piece.m_craftingStation != null) sb.Append(",\"needs\":").Append(Json.Str(piece.m_craftingStation.name));
                if (piece.m_groundOnly) sb.Append(",\"groundOnly\":true");
                if (piece.m_notOnFloor) sb.Append(",\"notOnFloor\":true");
                if (Clips(prefab)) sb.Append(",\"clip\":true");
            }
            var station = prefab.GetComponent<CraftingStation>();
            if (station != null) sb.Append(",\"station\":").Append(Json.Str(station.m_name)).Append(",\"roof\":").Append(station.m_craftRequireRoof ? "true" : "false").Append(",\"fire\":").Append(station.m_craftRequireFire ? "true" : "false");
            var ext = prefab.GetComponent<StationExtension>();
            if (ext != null && ext.m_craftingStation != null)
                sb.Append(",\"extends\":").Append(Json.Str(ext.m_craftingStation.name)).Append(",\"extDistance\":").Append(F(ext.m_maxStationDistance));
            var wnt = prefab.GetComponent<WearNTear>();
            if (wnt != null) sb.Append(",\"material\":").Append(Json.Str(wnt.m_materialType.ToString()));
            if (prefab.GetComponent<Smelter>() != null) sb.Append(",\"smelter\":true");
            if (prefab.GetComponentInChildren<Fireplace>(true) != null) sb.Append(",\"fire\":true");
            if (prefab.GetComponent<Trader>() != null) sb.Append(",\"trader\":true");
            if (prefab.GetComponent<Character>() != null) sb.Append(",\"creature\":true");
            var stand = prefab.GetComponentInChildren<ItemStand>(true);
            if (stand != null)
            {
                sb.Append(",\"itemStand\":[");
                var firstType = true;
                foreach (var type in stand.m_supportedTypes) { Json.Sep(sb, ref firstType); sb.Append(Json.Str(type.ToString())); }
                sb.Append(']');
            }
            var armor = prefab.GetComponentInChildren<ArmorStand>(true);
            if (armor != null)
            {
                sb.Append(",\"armorSlots\":[");
                var firstSlot = true;
                foreach (var slot in armor.m_slots)
                {
                    Json.Sep(sb, ref firstSlot);
                    sb.Append('[');
                    var firstType = true;
                    foreach (var type in slot.m_supportedTypes) { Json.Sep(sb, ref firstType); sb.Append(Json.Str(type.ToString())); }
                    sb.Append(']');
                }
                sb.Append(']');
            }
            sb.Append(",\"lock\":").Append(Ownership.CanLock(prefab) ? "true" : "false");
            sb.Append('}');
            return sb.ToString();
        }

        // Un enfant désactivé dans le prefab (feu éteint, variante, LOD caché) ne compte pas.
        private static bool Active(Transform t, Transform root)
        {
            for (; t != null; t = t.parent)
            {
                if (!t.gameObject.activeSelf) return false;
                if (t == root) break;
            }
            return true;
        }

        private struct Box { public Vector3 Min, Max; public bool Valid; }

        private static Box Empty() => new Box { Min = Vector3.one * float.MaxValue, Max = Vector3.one * float.MinValue };

        private static void Add(ref Box box, Matrix4x4 m, Vector3 center, Vector3 size)
        {
            var h = size * 0.5f;
            for (var i = 0; i < 8; i++)
            {
                var corner = center + new Vector3((i & 1) == 0 ? -h.x : h.x, (i & 2) == 0 ? -h.y : h.y, (i & 4) == 0 ? -h.z : h.z);
                var p = m.MultiplyPoint3x4(corner);
                box.Min = Vector3.Min(box.Min, p);
                box.Max = Vector3.Max(box.Max, p);
            }
            box.Valid = true;
        }

        private static void AppendBox(StringBuilder sb, string key, Box box)
        {
            sb.Append(Json.Str(key)).Append(':');
            if (!box.Valid) { sb.Append("null"); return; }
            sb.Append('[').Append(F(box.Min.x)).Append(',').Append(F(box.Min.y)).Append(',').Append(F(box.Min.z)).Append(',')
              .Append(F(box.Max.x)).Append(',').Append(F(box.Max.y)).Append(',').Append(F(box.Max.z)).Append(']');
        }

        private static string F(float v) => Math.Round(v, 3).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
}
