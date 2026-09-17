using System;
using System.Collections.Generic;
using HarmonyLib;
using UnityEngine;

namespace HearthwatchArena
{
    // Pièces « verrouillées » : le serveur en garde la propriété.
    //
    // Normalement, le jeu confie chaque objet au client du joueur le plus proche, qui le simule : c'est lui qui calcule
    // la solidité des constructions, et une pièce posée par le serveur (sans le moindre défaut d'alignement toléré)
    // peut s'y effondrer. Un serveur dédié, lui, ne simule jamais rien (sa position de référence est hors du monde) :
    // une pièce qu'il possède ne s'use pas, ne s'effondre pas et ne prend aucun dégât. Parfait pour une ville.
    //
    // Les objets qui ont besoin d'être simulés pour fonctionner (portes, coffres, fours, créatures…) ne sont pas
    // verrouillés : ils restent confiés aux joueurs comme n'importe quelle construction.
    internal static class Ownership
    {
        public static readonly HashSet<ZDOID> Locked = new HashSet<ZDOID>();
        public static readonly int LockMark = "HearthwatchLock".GetStableHashCode();

        private static readonly Type[] NeedsSimulation =
        {
            typeof(Door), typeof(Container), typeof(Bed), typeof(Smelter), typeof(Fermenter), typeof(CookingStation), typeof(Beehive),
            typeof(SapCollector), typeof(ItemStand), typeof(ArmorStand), typeof(TeleportWorld), typeof(Character), typeof(Ship),
            typeof(MapTable), typeof(ShieldGenerator), typeof(Turret), typeof(Incinerator), typeof(Tameable), typeof(Pickable),
            typeof(Plant), typeof(Vagon), typeof(Feast), typeof(Trap),
        };

        private static readonly Dictionary<int, bool> Cache = new Dictionary<int, bool>();

        public static bool CanLock(GameObject prefab)
        {
            if (prefab == null) return false;
            var hash = prefab.name.GetStableHashCode();
            if (Cache.TryGetValue(hash, out var cached)) return cached;
            var ok = true;
            foreach (var type in NeedsSimulation)
                if (prefab.GetComponentInChildren(type, true) != null) { ok = false; break; }
            Cache[hash] = ok;
            return ok;
        }

        public static void Lock(ZDO zdo)
        {
            zdo.Set(LockMark, 1);
            if (zdo.GetOwner() != ZDOMan.GetSessionID()) zdo.SetOwner(ZDOMan.GetSessionID());
            Locked.Add(zdo.m_uid);
        }

        // Au chargement du monde : les identifiants ont changé, on retrouve les pièces verrouillées par leur marque.
        public static void Rebuild(IEnumerable<ZDO> all)
        {
            Locked.Clear();
            foreach (var zdo in all)
                if (zdo.GetInt(LockMark) == 1) Locked.Add(zdo.m_uid);
        }

        private static readonly Func<ZDOMan, Vector3, long, bool> IsInPeerActiveArea =
            AccessTools.MethodDelegate<Func<ZDOMan, Vector3, long, bool>>(AccessTools.Method(typeof(ZDOMan), "IsInPeerActiveArea"));

        private static readonly List<ZDO> Near = new List<ZDO>();

        // Copie de ZDOMan.ReleaseNearbyZDOS (Valheim 1.0) qui saute les pièces verrouillées et les rend au serveur.
        [HarmonyPatch(typeof(ZDOMan), "ReleaseNearbyZDOS")]
        private static class ReleasePatch
        {
            private static bool Prefix(ZDOMan __instance, Vector3 refPosition, long uid)
            {
                if (Locked.Count == 0) return true;
                var server = ZDOMan.GetSessionID();
                var zone = ZoneSystem.GetZone(refPosition);
                var synced = ZNet.instance.GetSyncedSimulationDistance();
                Near.Clear();
                __instance.FindSectorObjects(zone, new SimulationDistance(synced.NearSimulationDistance, 0, synced.IsClassic), Near);
                foreach (var zdo in Near)
                {
                    if (!zdo.Persistent) continue;
                    if (Locked.Contains(zdo.m_uid))
                    {
                        if (zdo.GetOwner() != server) zdo.SetOwner(server);
                        continue;
                    }
                    var position = zdo.GetPosition();
                    if (zdo.GetOwner() == uid)
                    {
                        if (!ZNetScene.InActiveArea(position, zone)) zdo.SetOwner(0L);
                    }
                    else if ((!zdo.HasOwner() || !IsInPeerActiveArea(__instance, position, zdo.GetOwner())) && ZNetScene.InActiveArea(position, zone))
                    {
                        zdo.SetOwner(uid);
                    }
                }
                Near.Clear();
                return false;
            }
        }
    }
}
