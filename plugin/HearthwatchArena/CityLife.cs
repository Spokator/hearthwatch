using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using HarmonyLib;
using UnityEngine;

namespace HearthwatchArena
{
    // La vie de la cité : parcelles des joueurs, protection contre les constructions sauvages, portails impériaux,
    // tableau des contrats, proclamations et crieur à l'entrée des murs.
    internal sealed partial class CityService
    {
        private sealed class Owner
        {
            public string Name;
            public long PlayerId;
        }

        private readonly Dictionary<int, Owner> _owners = new Dictionary<int, Owner>();
        private readonly string[] _board = { "", "", "", "" };
        private string _proclamation = "";
        private readonly Dictionary<int, string> _portalTags = new Dictionary<int, string>();
        private readonly List<Owner> _architects = new List<Owner>();
        private readonly Dictionary<long, string> _names = new Dictionary<long, string>();
        private bool _crier = true;

        private readonly Dictionary<int, ZDO> _byIndex = new Dictionary<int, ZDO>();
        private readonly Dictionary<long, bool> _insideCity = new Dictionary<long, bool>();
        private readonly Dictionary<long, float> _lastCry = new Dictionary<long, float>();
        private float _nextProtect;
        private int _removedTotal;

        private static readonly AccessTools.FieldRef<ZDOMan, Dictionary<ZDOID, ZDO>> AllObjects =
            AccessTools.FieldRefAccess<ZDOMan, Dictionary<ZDOID, ZDO>>("m_objectsByID");

        // ---------- Persistance ----------

        private void LoadLife(Dictionary<string, object> root)
        {
            _owners.Clear();
            _portalTags.Clear();
            _architects.Clear();
            _names.Clear();
            for (var i = 0; i < _board.Length; i++) _board[i] = "";
            _proclamation = "";
            var life = Json.Obj(root.TryGetValue("life", out var l) ? l : null);
            if (life == null) return;
            _crier = !(life.TryGetValue("crier", out var c) && c is bool b && !b);
            _proclamation = Json.Text(life.TryGetValue("proclamation", out var p) ? p : null) ?? "";
            var board = Json.Arr(life.TryGetValue("board", out var bo) ? bo : null);
            if (board != null)
                for (var i = 0; i < _board.Length && i < board.Count; i++) _board[i] = Json.Text(board[i]) ?? "";
            foreach (var item in Json.Arr(life.TryGetValue("parcels", out var pa) ? pa : null) ?? new List<object>())
            {
                var o = Json.Obj(item);
                if (o == null) continue;
                _owners[(int)Json.Num(o.TryGetValue("id", out var id) ? id : null)] = ReadOwner(o);
            }
            foreach (var item in Json.Arr(life.TryGetValue("architects", out var ar) ? ar : null) ?? new List<object>())
            {
                var o = Json.Obj(item);
                if (o != null) _architects.Add(ReadOwner(o));
            }
            var tags = Json.Obj(life.TryGetValue("portals", out var po) ? po : null);
            if (tags != null)
                foreach (var pair in tags)
                    if (int.TryParse(pair.Key, out var index)) _portalTags[index] = Json.Text(pair.Value) ?? "";
            var names = Json.Obj(life.TryGetValue("names", out var na) ? na : null);
            if (names != null)
                foreach (var pair in names)
                    if (long.TryParse(pair.Key, NumberStyles.Integer, CultureInfo.InvariantCulture, out var pid)) _names[pid] = Json.Text(pair.Value) ?? "";
        }

        private static Owner ReadOwner(Dictionary<string, object> o)
        {
            long.TryParse(Json.Text(o.TryGetValue("playerId", out var pid) ? pid : null) ?? "0", NumberStyles.Integer, CultureInfo.InvariantCulture, out var playerId);
            return new Owner { Name = Json.Text(o.TryGetValue("name", out var n) ? n : null) ?? "", PlayerId = playerId };
        }

        private static void WriteOwner(StringBuilder sb, Owner owner) =>
            sb.Append("\"name\":").Append(Json.Str(owner.Name)).Append(",\"playerId\":").Append(Json.Str(owner.PlayerId.ToString(CultureInfo.InvariantCulture)))
              .Append(",\"known\":").Append(owner.PlayerId != 0L ? "true" : "false");

        private void WriteLife(StringBuilder sb, bool withPlan = false)
        {
            sb.Append("{\"crier\":").Append(_crier ? "true" : "false");
            sb.Append(",\"proclamation\":").Append(Json.Str(_proclamation));
            sb.Append(",\"board\":[");
            for (var i = 0; i < _board.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(Json.Str(_board[i]));
            }
            sb.Append("],\"parcels\":[");
            var first = true;
            if (withPlan)
                foreach (var parcel in _plan.Parcels)
                {
                    Json.Sep(sb, ref first);
                    sb.Append("{\"id\":").Append(parcel.Id).Append(",\"x\":").Append(Json.F(parcel.X)).Append(",\"z\":").Append(Json.F(parcel.Z)).Append(",\"owner\":");
                    if (_owners.TryGetValue(parcel.Id, out var owner)) { sb.Append('{'); WriteOwner(sb, owner); sb.Append('}'); }
                    else sb.Append("null");
                    sb.Append('}');
                }
            else
                foreach (var pair in _owners)
                {
                    Json.Sep(sb, ref first);
                    sb.Append("{\"id\":").Append(pair.Key).Append(',');
                    WriteOwner(sb, pair.Value);
                    sb.Append('}');
                }
            sb.Append("],\"architects\":[");
            first = true;
            foreach (var a in _architects) { Json.Sep(sb, ref first); sb.Append('{'); WriteOwner(sb, a); sb.Append('}'); }
            sb.Append("],\"portals\":");
            if (withPlan)
            {
                sb.Append('[');
                first = true;
                foreach (var portal in _plan.Portals)
                {
                    Json.Sep(sb, ref first);
                    sb.Append("{\"index\":").Append(portal.Piece).Append(",\"tag\":").Append(Json.Str(PortalTag(portal.Piece, portal.Tag))).Append('}');
                }
                sb.Append(']');
                sb.Append(",\"removed\":").Append(_removedTotal);
            }
            else
            {
                sb.Append('{');
                first = true;
                foreach (var pair in _portalTags) { Json.Sep(sb, ref first); sb.Append(Json.Str(pair.Key.ToString(CultureInfo.InvariantCulture))).Append(':').Append(Json.Str(pair.Value)); }
                sb.Append("},\"names\":{");
                first = true;
                foreach (var pair in _names) { Json.Sep(sb, ref first); sb.Append(Json.Str(pair.Key.ToString(CultureInfo.InvariantCulture))).Append(':').Append(Json.Str(pair.Value)); }
                sb.Append('}');
            }
            sb.Append('}');
        }

        // Une nouvelle ville repart de zéro : parcelles libres, panneaux vides. Les joueurs connus sont gardés.
        private void ResetLife()
        {
            _owners.Clear();
            _portalTags.Clear();
            for (var i = 0; i < _board.Length; i++) _board[i] = "";
            _proclamation = "";
        }

        // ---------- Commandes ----------

        private string AssignParcel(Dictionary<string, string> cmd)
        {
            RequireCity();
            if (!cmd.TryGetValue("parcel", out var raw) || !int.TryParse(raw, out var id)) throw new InvalidOperationException("Parcelle manquante");
            if (!_plan.Parcels.Exists(p => p.Id == id)) throw new InvalidOperationException("Parcelle inconnue");
            cmd.TryGetValue("owner", out var name);
            if (string.IsNullOrWhiteSpace(name))
            {
                _owners.Remove(id);
                Save();
                ApplyTexts();
                return $"Parcelle {id} libérée";
            }
            name = name.Trim();
            _owners[id] = new Owner { Name = name, PlayerId = Resolve(name) };
            Save();
            ApplyTexts();
            var peer = Game.FindPeer(name);
            if (peer != null) Game.Screen(Tables.T("L'Empereur vous accorde la parcelle {0} de {1}", id, _plan.Name), peer.m_uid);
            return _owners[id].PlayerId != 0L
                ? $"Parcelle {id} attribuée à {name}"
                : $"Parcelle {id} attribuée à {name} (joueur jamais vu : reconnu à sa prochaine connexion)";
        }

        private string SetBoard(Dictionary<string, string> cmd)
        {
            RequireCity();
            for (var i = 0; i < _board.Length; i++)
                if (cmd.TryGetValue("line" + (i + 1), out var line)) _board[i] = Clip(line);
            Save();
            ApplyTexts();
            return "Tableau des contrats mis à jour";
        }

        private string Proclaim(Dictionary<string, string> cmd)
        {
            RequireCity();
            cmd.TryGetValue("text", out var text);
            _proclamation = Clip(text);
            Save();
            ApplyTexts();
            if (!string.IsNullOrEmpty(_proclamation) && !(cmd.TryGetValue("announce", out var a) && a == "0"))
                Game.Screen(Tables.T("Proclamation de l'Empereur {0} : {1}", _plan.Emperor, _proclamation));
            return string.IsNullOrEmpty(_proclamation) ? "Proclamation retirée" : "Proclamation publiée";
        }

        private string SetPortal(Dictionary<string, string> cmd)
        {
            RequireCity();
            if (!cmd.TryGetValue("index", out var raw) || !int.TryParse(raw, out var index) || !_plan.Portals.Exists(p => p.Piece == index))
                throw new InvalidOperationException("Portail inconnu");
            cmd.TryGetValue("tag", out var tag);
            tag = (tag ?? "").Trim();
            if (tag.Length == 0 || tag.Length > 40) throw new InvalidOperationException("Nom de portail invalide");
            _portalTags[index] = tag;
            Save();
            ApplyTexts();
            return $"Portail renommé « {tag} »";
        }

        private string SetArchitects(Dictionary<string, string> cmd)
        {
            RequireCity();
            _architects.Clear();
            cmd.TryGetValue("names", out var raw);
            foreach (var part in (raw ?? "").Split(','))
            {
                var name = part.Trim();
                if (name.Length > 0) _architects.Add(new Owner { Name = name, PlayerId = Resolve(name) });
            }
            Save();
            return _architects.Count == 0 ? "Plus aucun architecte" : $"{_architects.Count} architecte(s) autorisé(s)";
        }

        private void RequireCity()
        {
            if (_plan == null) throw new InvalidOperationException("Aucune ville");
        }

        private static string Clip(string text)
        {
            text = (text ?? "").Replace('\r', ' ').Replace('\n', ' ').Trim();
            return text.Length > 60 ? text.Substring(0, 60) : text;
        }

        // ---------- Joueurs ----------

        private long Resolve(string name)
        {
            foreach (var peer in ZNet.instance.GetPeers())
                if (string.Equals(peer.m_playerName, name, StringComparison.OrdinalIgnoreCase))
                {
                    var zdo = Game.PlayerZdo(peer);
                    var id = zdo?.GetLong(PlayerIdHash) ?? 0L;
                    if (id != 0L) return id;
                }
            foreach (var pair in _names)
                if (string.Equals(pair.Value, name, StringComparison.OrdinalIgnoreCase)) return pair.Key;
            return 0L;
        }

        private void Remember(long playerId, string name)
        {
            if (playerId == 0L || string.IsNullOrEmpty(name)) return;
            var changed = !_names.TryGetValue(playerId, out var known) || known != name;
            _names[playerId] = name;
            foreach (var owner in _owners.Values)
                if (owner.PlayerId == 0L && string.Equals(owner.Name, name, StringComparison.OrdinalIgnoreCase)) { owner.PlayerId = playerId; changed = true; }
            foreach (var owner in _architects)
                if (owner.PlayerId == 0L && string.Equals(owner.Name, name, StringComparison.OrdinalIgnoreCase)) { owner.PlayerId = playerId; changed = true; }
            if (changed) Save();
        }

        private ZNetPeer PeerOf(long playerId)
        {
            foreach (var peer in ZNet.instance.GetPeers())
            {
                var zdo = Game.PlayerZdo(peer);
                if (zdo != null && zdo.GetLong(PlayerIdHash) == playerId) return peer;
            }
            return null;
        }

        // Crieur : un message discret quand on franchit les murs de la cité.
        private void Cry(ZNetPeer peer, ZDO zdo, float now)
        {
            if (!_crier) return;
            var p = zdo.GetPosition();
            var inside = (p.x - _plan.X) * (p.x - _plan.X) + (p.z - _plan.Z) * (p.z - _plan.Z) <= _plan.Radius * _plan.Radius;
            if (!_insideCity.TryGetValue(peer.m_uid, out var before))
            {
                _insideCity[peer.m_uid] = inside;
                return;
            }
            if (before == inside) return;
            _insideCity[peer.m_uid] = inside;
            if (_lastCry.TryGetValue(peer.m_uid, out var last) && now - last < 20f) return;
            _lastCry[peer.m_uid] = now;
            Game.Screen(inside
                ? Tables.T("Vous entrez dans {0}, cité de l'Empereur {1}", _plan.Name, _plan.Emperor)
                : Tables.T("Vous quittez {0}. Bonne route, aventurier !", _plan.Name), peer.m_uid, center: false);
        }

        // ---------- Panneaux et portails ----------

        private string PortalTag(int index, string fallback) => _portalTags.TryGetValue(index, out var tag) && tag.Length > 0 ? tag : fallback;

        private void ApplyTexts()
        {
            if (_plan == null) return;
            foreach (var parcel in _plan.Parcels)
            {
                var text = _owners.TryGetValue(parcel.Id, out var owner)
                    ? Tables.T("Parcelle {0} — {1}", parcel.Id, owner.Name)
                    : Tables.T("Parcelle {0} — libre", parcel.Id);
                SetText(parcel.Sign, ZDOVars.s_text, text);
            }
            for (var i = 0; i < _plan.Boards.Count && i < _board.Length; i++)
                SetText(_plan.Boards[i], ZDOVars.s_text, string.IsNullOrEmpty(_board[i]) ? "—" : _board[i]);
            if (_plan.Proclamation >= 0 && !string.IsNullOrEmpty(_proclamation)) SetText(_plan.Proclamation, ZDOVars.s_text, _proclamation);
            foreach (var portal in _plan.Portals)
            {
                var tag = PortalTag(portal.Piece, portal.Tag);
                // Un joueur peut renommer un portail de la cité : le serveur remet le nom impérial.
                SetText(portal.Piece, ZDOVars.s_tag, tag);
                if (portal.Sign >= 0) SetText(portal.Sign, ZDOVars.s_text, Tables.T("Portail : {0}", tag));
            }
        }

        private void SetText(int index, int key, string text)
        {
            if (index < 0 || !_byIndex.TryGetValue(index, out var zdo) || !zdo.IsValid()) return;
            if (zdo.GetString(key) == text) return;
            if (!zdo.IsOwner()) zdo.SetOwner(ZDOMan.GetSessionID());
            zdo.Set(key, text);
        }

        // ---------- Protection ----------

        // Dans les murs, un joueur ne construit que sur sa parcelle (ou s'il est architecte impérial). Toute autre pièce est
        // retirée, ses matériaux rendus sur place, et son auteur prévenu. Bateaux et chariots ne sont pas concernés.
        private void Protect()
        {
            if (_plan == null) return;
            var reach = _plan.TerrainRadius;
            var doomed = new List<(ZDO zdo, GameObject prefab, long creator)>();
            foreach (var zdo in AllObjects(ZDOMan.instance).Values)
            {
                var p = zdo.GetPosition();
                if ((p.x - _plan.X) * (p.x - _plan.X) + (p.z - _plan.Z) * (p.z - _plan.Z) > reach * reach) continue;
                var creator = zdo.GetLong(ZDOVars.s_creator);
                if (creator == 0L || zdo.GetInt(CityMark) != 0) continue;
                var prefab = ZNetScene.instance.GetPrefab(zdo.GetPrefab());
                if (prefab == null || prefab.GetComponent<Piece>() == null) continue;
                if (prefab.GetComponent<Ship>() != null || prefab.GetComponent<Vagon>() != null) continue;
                if (_architects.Exists(a => a.PlayerId == creator)) continue;
                var parcel = _plan.Parcels.Find(x => x.Contains(p));
                if (parcel != null && _owners.TryGetValue(parcel.Id, out var owner) && owner.PlayerId == creator) continue;
                doomed.Add((zdo, prefab, creator));
            }
            if (doomed.Count == 0) return;

            var warned = new HashSet<long>();
            foreach (var (zdo, prefab, creator) in doomed)
            {
                var position = zdo.GetPosition();
                foreach (var req in prefab.GetComponent<Piece>().m_resources)
                    if (req.m_resItem != null && req.m_recover && req.m_amount > 0)
                        Game.DropItems(req.m_resItem.gameObject, req.m_amount, 1, position + Vector3.up * 0.5f);
                Game.Destroy(zdo);
                if (!warned.Add(creator)) continue;
                var peer = PeerOf(creator);
                if (peer != null)
                    Game.Screen(Tables.T("Construction interdite dans {0} hors de votre parcelle : matériaux rendus", _plan.Name), peer.m_uid);
            }
            _removedTotal += doomed.Count;
            _log($"Ville : {doomed.Count} construction(s) sauvage(s) retirée(s)");
        }

        // ---------- Lieux du jeu ----------

        private static bool FindLocation(string name, out Vector3 position, out float radius)
        {
            position = Vector3.zero;
            radius = 12f;
            var instances = AccessTools.Field(typeof(ZoneSystem), "m_locationInstances")?.GetValue(ZoneSystem.instance) as IDictionary;
            if (instances == null) return false;
            foreach (var value in instances.Values)
            {
                var t = value.GetType();
                var loc = t.GetField("m_location").GetValue(value);
                var prefabRef = loc.GetType().GetField("m_prefab").GetValue(loc);
                var locName = prefabRef?.GetType().GetProperty("Name")?.GetValue(prefabRef) as string;
                if (locName != name) continue;
                position = (Vector3)t.GetField("m_position").GetValue(value);
                var ext = loc.GetType().GetField("m_exteriorRadius")?.GetValue(loc);
                if (ext is float r && r > 0f) radius = r;
                return true;
            }
            return false;
        }
    }
}
