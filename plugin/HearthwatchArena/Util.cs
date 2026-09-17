using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEngine;

namespace HearthwatchArena
{
    // Petits outils partagés : JSON minimal, fichiers atomiques, messages en jeu, prefabs.
    internal static class Json
    {
        public static string Str(string value)
        {
            if (value == null) return "null";
            var sb = new StringBuilder(value.Length + 2).Append('"');
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

        public static string F(float value) => Math.Round(value, 1).ToString(CultureInfo.InvariantCulture);
        public static string F2(double value) => Math.Round(value, 2).ToString(CultureInfo.InvariantCulture);

        public static void Sep(StringBuilder sb, ref bool first)
        {
            if (first) first = false;
            else sb.Append(',');
        }

        // Lecteur JSON volontairement simple (objets, tableaux, chaînes, nombres, booléens, null) pour le fichier de persistance.
        public static object Parse(string text)
        {
            var i = 0;
            var value = ParseValue(text, ref i);
            return value;
        }

        private static void SkipWs(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }

        private static object ParseValue(string s, ref int i)
        {
            SkipWs(s, ref i);
            if (i >= s.Length) throw new FormatException("JSON tronqué");
            var c = s[i];
            if (c == '{')
            {
                var obj = new Dictionary<string, object>();
                i++;
                SkipWs(s, ref i);
                if (s[i] == '}') { i++; return obj; }
                while (true)
                {
                    SkipWs(s, ref i);
                    var key = ParseString(s, ref i);
                    SkipWs(s, ref i);
                    if (s[i] != ':') throw new FormatException("':' attendu");
                    i++;
                    obj[key] = ParseValue(s, ref i);
                    SkipWs(s, ref i);
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == '}') { i++; return obj; }
                    throw new FormatException("',' ou '}' attendu");
                }
            }
            if (c == '[')
            {
                var list = new List<object>();
                i++;
                SkipWs(s, ref i);
                if (s[i] == ']') { i++; return list; }
                while (true)
                {
                    list.Add(ParseValue(s, ref i));
                    SkipWs(s, ref i);
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == ']') { i++; return list; }
                    throw new FormatException("',' ou ']' attendu");
                }
            }
            if (c == '"') return ParseString(s, ref i);
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (s.Length - i >= 5 && string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            var start = i;
            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E')) i++;
            return double.Parse(s.Substring(start, i - start), CultureInfo.InvariantCulture);
        }

        private static string ParseString(string s, ref int i)
        {
            if (s[i] != '"') throw new FormatException("chaîne attendue");
            i++;
            var sb = new StringBuilder();
            while (i < s.Length)
            {
                var c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                var e = s[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u': sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16)); i += 4; break;
                    default: sb.Append(e); break;
                }
            }
            throw new FormatException("chaîne non terminée");
        }

        public static Dictionary<string, object> Obj(object value) => value as Dictionary<string, object>;
        public static List<object> Arr(object value) => value as List<object>;
        public static double Num(object value, double def = 0) => value is double d ? d : def;
        public static string Text(object value) => value as string;
    }

    internal static class Files
    {
        public static void WriteAtomic(string path, string content)
        {
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, content, new UTF8Encoding(false));
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        // Fichiers de commande du panel : une ligne "clé=valeur" par ligne.
        public static Dictionary<string, string> ReadKeyValues(string path)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in File.ReadAllLines(path, Encoding.UTF8))
            {
                var line = raw.Trim();
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                result[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            return result;
        }
    }

    internal static class Game
    {
        public static bool WorldReady =>
            ZNet.instance != null && ZNet.instance.IsServer() && ZNet.World != null && ZNetScene.instance != null &&
            ZDOMan.instance != null && ZoneSystem.instance != null && WorldGenerator.instance != null;

        // Message au centre de l'écran (type 2) ou en haut à gauche (type 1), pour tous ou pour un joueur.
        public static void Screen(string text, long peer = 0L, bool center = true)
        {
            if (string.IsNullOrEmpty(text)) return;
            ZRoutedRpc.instance.InvokeRoutedRPC(peer, "ShowMessage", center ? 2 : 1, text);
        }

        public static string PrefabName(int hash)
        {
            var prefab = ZNetScene.instance.GetPrefab(hash);
            return prefab != null ? prefab.name : null;
        }

        public static float GroundHeight(float x, float z)
        {
            if (ZoneSystem.instance.GetGroundHeight(new Vector3(x, 0f, z), out var h)) return h;
            return WorldGenerator.instance.GetHeight(x, z);
        }

        public static string StartLocation => global::Game.instance != null ? global::Game.instance.m_StartLocation : "StartTemple";

        public static ZDO PlayerZdo(ZNetPeer peer) => peer.m_characterID.IsNone() ? null : ZDOMan.instance.GetZDO(peer.m_characterID);

        public static ZNetPeer FindPeer(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            foreach (var peer in ZNet.instance.GetPeers())
                if (string.Equals(peer.m_playerName, name, StringComparison.OrdinalIgnoreCase)) return peer;
            return null;
        }

        public static string ZdoId(ZDOID id) => id.UserID.ToString(CultureInfo.InvariantCulture) + ":" + id.ID.ToString(CultureInfo.InvariantCulture);

        public static bool TryZdoId(string text, out ZDOID id)
        {
            id = ZDOID.None;
            var parts = (text ?? "").Split(':');
            if (parts.Length != 2) return false;
            if (!long.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var user)) return false;
            if (!uint.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) return false;
            id = new ZDOID(user, n);
            return true;
        }

        // Instancie un prefab côté serveur et ne garde que son ZDO (même technique que la commande spawn de ValheimRcon).
        public static ZDO Spawn(GameObject prefab, Vector3 position, Quaternion rotation, int level = 1, bool tamed = false)
        {
            ZNetView.StartGhostInit();
            try
            {
                var obj = UnityEngine.Object.Instantiate(prefab, position, rotation);
                var character = obj.GetComponent<Character>();
                if (character != null && level > 1) character.SetLevel(level);
                var zdo = obj.GetComponent<ZNetView>().GetZDO();
                if (tamed) zdo.Set(ZDOVars.s_tamed, true);
                UnityEngine.Object.Destroy(obj);
                return zdo;
            }
            finally
            {
                ZNetView.FinishGhostInit();
            }
        }

        public static void DropItems(GameObject prefab, int amount, int quality, Vector3 position)
        {
            var drop = prefab.GetComponent<ItemDrop>();
            if (drop == null || amount <= 0) return;
            var max = Mathf.Max(1, drop.m_itemData.m_shared.m_maxStackSize);
            ZNetView.StartGhostInit();
            try
            {
                while (amount > 0)
                {
                    var stack = Mathf.Min(max, amount);
                    var item = drop.m_itemData.Clone();
                    item.m_dropPrefab = prefab;
                    item.m_quality = Mathf.Clamp(quality, 1, 4);
                    if (item.m_shared.m_useDurability) item.m_durability = item.GetMaxDurability();
                    var scatter = UnityEngine.Random.insideUnitCircle * 1.5f;
                    var dropped = ItemDrop.DropItem(item, stack, position + new Vector3(scatter.x, 0.5f, scatter.y), Quaternion.identity);
                    UnityEngine.Object.Destroy(dropped.gameObject);
                    amount -= stack;
                }
            }
            finally
            {
                ZNetView.FinishGhostInit();
            }
        }

        // Un feu verrouillé n'est jamais simulé : plein de combustible, il brûle pour toujours.
        public static void KeepLit(GameObject prefab, ZDO zdo)
        {
            var fire = prefab.GetComponentInChildren<Fireplace>(true);
            if (fire != null) zdo.Set(ZDOVars.s_fuel, Mathf.Max(1f, fire.m_maxFuel));
        }

        public static void Destroy(ZDOID id)
        {
            if (id.IsNone()) return;
            Destroy(ZDOMan.instance.GetZDO(id));
        }

        // Le jeu ignore la destruction d'un objet dont on n'est pas propriétaire (souvent le client d'un joueur proche) :
        // le serveur en reprend d'abord la propriété.
        public static void Destroy(ZDO zdo)
        {
            if (zdo == null) return;
            Ownership.Locked.Remove(zdo.m_uid);
            if (!zdo.IsOwner()) zdo.SetOwner(ZDOMan.GetSessionID());
            ZDOMan.instance.DestroyZDO(zdo);
        }
    }
}
