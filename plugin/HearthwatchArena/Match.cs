using System;
using System.Collections.Generic;
using System.Text;
using HarmonyLib;
using UnityEngine;

namespace HearthwatchArena
{
    internal sealed class Settings
    {
        public int ForceTier;            // 0 = automatique
        public int Waves = 10;
        public float RewardMultiplier = 1f;
        public int CooldownSeconds = 60;
    }

    internal sealed class Fighter
    {
        public long PeerId;
        public string Name;
        public int Deaths;
        public bool Dead;
        public bool Left;
        public float OutsideSince = -1f;
        public int GearTier;
    }

    internal sealed class Record
    {
        public string Date;
        public List<string> Names = new List<string>();
        public int Tier;
        public int Wave;
        public int Seconds;
        public int Deaths;
        public string Outcome;
    }

    // Déroulement d'un combat : compte à rebours, vagues, entracte, fin (victoire / défaite / abandon).
    internal sealed class Match
    {
        public enum Phase { Idle, Countdown, Wave, Intermission, Ended }

        private const float CountdownSeconds = 15f;
        private const float IntermissionSeconds = 15f;
        private const float LeaveGraceSeconds = 20f;

        private static readonly AccessTools.FieldRef<ZoneSystem, HashSet<string>> GlobalKeys =
            AccessTools.FieldRefAccess<ZoneSystem, HashSet<string>>("m_globalKeys");

        private static readonly int[] EquipmentSlots =
        {
            ZDOVars.s_rightItem, ZDOVars.s_leftItem, ZDOVars.s_chestItem, ZDOVars.s_legItem, ZDOVars.s_helmetItem, ZDOVars.s_shoulderItem,
        };

        private readonly ArenaSite _site;
        private readonly Settings _settings;
        private readonly Action<Record> _onFinished;
        private readonly Action<string> _log;

        public Phase Current = Phase.Idle;
        public int Tier;
        public int Wave;
        public readonly List<Fighter> Fighters = new List<Fighter>();
        public string Outcome;

        private float _phaseEnds;
        private float _startedAt;
        private int _lastAnnounced = -1;
        private readonly List<ZDOID> _spawned = new List<ZDOID>();
        private readonly Dictionary<string, int> _bank = new Dictionary<string, int>();
        private int _bankCoins;
        private float _cooldownUntil;
        private float _idleHintAt;

        public Match(ArenaSite site, Settings settings, Action<Record> onFinished, Action<string> log)
        {
            _site = site;
            _settings = settings;
            _onFinished = onFinished;
            _log = log;
        }

        public bool Active => Current == Phase.Countdown || Current == Phase.Wave || Current == Phase.Intermission;
        public float SecondsLeft => Mathf.Max(0f, _phaseEnds - Time.time);
        public int ElapsedSeconds => Active ? Mathf.RoundToInt(Time.time - _startedAt) : 0;
        public int Alive => _spawned.Count;

        // ---------- Boucle ----------

        public void Tick()
        {
            switch (Current)
            {
                case Phase.Idle: TickIdle(); break;
                case Phase.Countdown: TickCountdown(); break;
                case Phase.Wave: TickWave(); break;
                case Phase.Intermission: TickIntermission(); break;
                case Phase.Ended:
                    if (Time.time >= _cooldownUntil) Current = Phase.Idle;
                    break;
            }
        }

        private void TickIdle()
        {
            var inside = PeersInside();
            if (inside.Count == 0) return;
            if (Time.time < _cooldownUntil)
            {
                if (Time.time >= _idleHintAt)
                {
                    _idleHintAt = Time.time + 5f;
                    foreach (var peer in inside) Game.Screen(Tables.T("L'arène se repose. Réessayez dans {0} s.", Mathf.CeilToInt(_cooldownUntil - Time.time)), peer.m_uid);
                }
                return;
            }
            Current = Phase.Countdown;
            _phaseEnds = Time.time + CountdownSeconds;
            _lastAnnounced = -1;
            _log("Compte à rebours lancé");
        }

        private void TickCountdown()
        {
            var inside = PeersInside();
            if (inside.Count == 0)
            {
                Current = Phase.Idle;
                _log("Compte à rebours annulé : plus personne dans l'arène");
                return;
            }
            var left = Mathf.CeilToInt(SecondsLeft);
            if (left != _lastAnnounced && (left % 5 == 0 || left <= 3))
            {
                _lastAnnounced = left;
                var tier = ComputeTier(inside);
                foreach (var peer in inside)
                {
                    Game.Screen(Tables.T("L'arène s'éveille… {0} s", left), peer.m_uid);
                    Game.Screen(Tables.T("Palier {0} : {1}", tier, Tables.TierName(tier)), peer.m_uid, center: false);
                }
            }
            if (SecondsLeft > 0f) return;
            Start(inside, ComputeTier(inside));
        }

        public bool Start(List<ZNetPeer> peers, int tier)
        {
            if (peers.Count == 0) return false;
            Fighters.Clear();
            foreach (var peer in peers)
                Fighters.Add(new Fighter { PeerId = peer.m_uid, Name = peer.m_playerName, GearTier = GearTierOf(peer) });
            Tier = Mathf.Clamp(tier, 1, Tables.MaxTier);
            Wave = 0;
            Outcome = null;
            _bank.Clear();
            _bankCoins = 0;
            _startedAt = Time.time;
            _log($"Combat lancé : palier {Tier}, {Fighters.Count} combattant(s)");
            NextWave();
            return true;
        }

        private void NextWave()
        {
            Wave++;
            Current = Phase.Wave;
            _phaseEnds = Time.time;
            SpawnWave();
            foreach (var f in Fighters)
            {
                if (f.Left) continue;
                Game.Screen(Tables.T("Vague {0} / {1}", Wave, _settings.Waves), f.PeerId);
                if (IsChampionWave(Wave)) Game.Screen(Tables.T("Un champion approche !"), f.PeerId, center: false);
            }
        }

        private void TickWave()
        {
            UpdateFighters();
            if (ActiveFighters() == 0)
            {
                Finish(Fighters.TrueForAll(f => f.Left || !f.Dead) ? "abandon" : "wipe");
                return;
            }
            // Vague terminée quand toutes les créatures ont disparu (mortes) ; celles qui s'échappent sont retirées.
            for (var i = _spawned.Count - 1; i >= 0; i--)
            {
                var zdo = ZDOMan.instance.GetZDO(_spawned[i]);
                if (zdo == null) { _spawned.RemoveAt(i); continue; }
                if (!_site.Inside(zdo.GetPosition(), 12f)) { ZDOMan.instance.DestroyZDO(zdo); _spawned.RemoveAt(i); }
            }
            if (_spawned.Count > 0) return;

            BankWave();
            if (Wave >= _settings.Waves)
            {
                Finish("victory");
                return;
            }
            Current = Phase.Intermission;
            _phaseEnds = Time.time + IntermissionSeconds;
            _lastAnnounced = -1;
            foreach (var f in Fighters)
                if (!f.Left) Game.Screen(Tables.T("Vague {0} terminée !", Wave), f.PeerId);
        }

        private void TickIntermission()
        {
            UpdateFighters();
            if (ActiveFighters() == 0)
            {
                Finish("abandon");
                return;
            }
            var left = Mathf.CeilToInt(SecondsLeft);
            if (left != _lastAnnounced && (left == 10 || left <= 3))
            {
                _lastAnnounced = left;
                foreach (var f in Fighters)
                    if (!f.Left) Game.Screen(Tables.T("Prochaine vague dans {0} s", left), f.PeerId, center: false);
            }
            if (SecondsLeft <= 0f) NextWave();
        }

        // ---------- Combattants ----------

        private List<ZNetPeer> PeersInside()
        {
            var result = new List<ZNetPeer>();
            foreach (var peer in ZNet.instance.GetPeers())
            {
                var zdo = Game.PlayerZdo(peer);
                if (zdo != null && _site.Inside(zdo.GetPosition())) result.Add(peer);
            }
            return result;
        }

        private void UpdateFighters()
        {
            foreach (var f in Fighters)
            {
                if (f.Left) continue;
                var peer = ZNet.instance.GetPeer(f.PeerId);
                if (peer == null) { f.Left = true; continue; }
                var zdo = Game.PlayerZdo(peer);
                if (zdo == null)
                {
                    if (!f.Dead)
                    {
                        f.Dead = true;
                        f.Deaths++;
                        var remaining = ActiveFighters() - 1;
                        foreach (var other in Fighters)
                            if (!other.Left && other.PeerId != f.PeerId) Game.Screen(Tables.T("{0} est tombé. Il reste {1} combattant(s).", f.Name, Mathf.Max(remaining, 0)), other.PeerId, center: false);
                    }
                    continue;
                }
                if (f.Dead)
                {
                    // Réapparu : il ne rejoint le combat que s'il revient dans l'arène.
                    if (_site.Inside(zdo.GetPosition())) f.Dead = false;
                    else continue;
                }
                if (_site.Inside(zdo.GetPosition(), 2f))
                {
                    f.OutsideSince = -1f;
                    continue;
                }
                if (f.OutsideSince < 0f) f.OutsideSince = Time.time;
                var away = Time.time - f.OutsideSince;
                if (away >= LeaveGraceSeconds)
                {
                    f.Left = true;
                    _log($"{f.Name} a quitté l'arène");
                }
                else if (Mathf.RoundToInt(away) % 5 == 0)
                    Game.Screen(Tables.T("Reviens dans l'arène ! ({0} s)", Mathf.CeilToInt(LeaveGraceSeconds - away)), f.PeerId);
            }
        }

        private int ActiveFighters()
        {
            var n = 0;
            foreach (var f in Fighters) if (!f.Left && !f.Dead) n++;
            return n;
        }

        private int ComputeTier(List<ZNetPeer> peers)
        {
            if (_settings.ForceTier > 0) return Mathf.Clamp(_settings.ForceTier, 1, Tables.MaxTier);
            var gear = 0;
            foreach (var peer in peers) gear = Mathf.Max(gear, GearTierOf(peer));
            var boss = Tables.BossTier(GlobalKeys(ZoneSystem.instance));
            return Mathf.Clamp(Mathf.Max(gear, boss - 1, 1), 1, Tables.MaxTier);
        }

        private static int GearTierOf(ZNetPeer peer)
        {
            var zdo = Game.PlayerZdo(peer);
            if (zdo == null) return 0;
            var best = 0;
            foreach (var slot in EquipmentSlots)
            {
                var hash = zdo.GetInt(slot);
                if (hash == 0) continue;
                best = Mathf.Max(best, Tables.GearTier(Game.PrefabName(hash)));
            }
            return best;
        }

        // ---------- Vagues ----------

        private static bool IsChampionWave(int wave) => wave % 5 == 0;

        private void SpawnWave()
        {
            _spawned.Clear();
            var tier = Tables.Tiers[Tier];
            var players = Mathf.Max(1, ActiveFighters());
            var count = Mathf.CeilToInt((2f + Wave * 1.2f) * (0.6f + 0.4f * players));
            count = Mathf.Min(count, 24);
            var elites = Wave >= 3 ? Mathf.Max(1, Wave / 3) : 0;
            var champions = IsChampionWave(Wave) ? (Wave >= 10 ? 2 : 1) : 0;

            for (var i = 0; i < count; i++) SpawnOne(Pick(tier.Pool.Regular), StarsFor(Wave, elite: false));
            for (var i = 0; i < elites; i++) SpawnOne(Pick(tier.Pool.Elite), StarsFor(Wave, elite: true));
            for (var i = 0; i < champions; i++) SpawnOne(tier.Pool.Champion, Wave >= 10 ? 2 : 1);
            _log($"Vague {Wave} : {_spawned.Count} créatures (palier {Tier})");
        }

        private int StarsFor(int wave, bool elite)
        {
            var roll = UnityEngine.Random.value;
            if (wave >= 8 && roll < 0.35f) return 3;
            if (wave >= 4 && roll < (elite ? 0.6f : 0.3f)) return 2;
            return 1;
        }

        private static string Pick(string[] pool) => pool[UnityEngine.Random.Range(0, pool.Length)];

        private void SpawnOne(string prefabName, int level)
        {
            var prefab = ZNetScene.instance.GetPrefab(prefabName);
            if (prefab == null)
            {
                if (!ArenaBuilder.MissingPrefabs.Contains(prefabName)) ArenaBuilder.MissingPrefabs.Add(prefabName);
                return;
            }
            var angle = UnityEngine.Random.value * Mathf.PI * 2f;
            var dist = _site.Radius - 3f - UnityEngine.Random.value * 4f;
            var pos = new Vector3(_site.Center.x + Mathf.Cos(angle) * dist, _site.FloorY + 0.5f, _site.Center.z + Mathf.Sin(angle) * dist);
            var zdo = Game.Spawn(prefab, pos, Quaternion.LookRotation(_site.Center - pos), level);
            if (zdo != null) _spawned.Add(zdo.m_uid);
        }

        // ---------- Récompenses ----------

        private void BankWave()
        {
            var tier = Tables.Tiers[Tier];
            var players = Mathf.Max(1, Fighters.Count);
            var scale = _settings.RewardMultiplier * (1f + 0.15f * (players - 1));
            _bankCoins += Mathf.RoundToInt((10 * Tier + 6 * Wave) * scale);
            var picks = 1 + Wave / 3;
            for (var i = 0; i < picks; i++)
            {
                var (item, count) = tier.Materials[UnityEngine.Random.Range(0, tier.Materials.Length)];
                Add(item, Mathf.Max(1, Mathf.RoundToInt(count * (0.6f + Wave * 0.12f) * scale)));
            }
            if (IsChampionWave(Wave)) Add("Coins", Mathf.RoundToInt(25 * Tier * scale));
        }

        private void Add(string item, int count)
        {
            _bank.TryGetValue(item, out var have);
            _bank[item] = have + count;
        }

        private void Finish(string outcome)
        {
            Outcome = outcome;
            foreach (var id in _spawned) Game.Destroy(id);
            _spawned.Clear();

            var share = outcome == "victory" ? 1f : outcome == "abandon" ? 0.5f : 0.25f;
            if (outcome == "victory")
                foreach (var (item, count) in Tables.Tiers[Tier].Prize) Add(item, Mathf.RoundToInt(count * _settings.RewardMultiplier));
            Add("Coins", _bankCoins);

            var dropped = 0;
            foreach (var pair in _bank)
            {
                var count = Mathf.FloorToInt(pair.Value * share);
                if (count <= 0) continue;
                var prefab = ZNetScene.instance.GetPrefab(pair.Key);
                if (prefab == null)
                {
                    if (!ArenaBuilder.MissingPrefabs.Contains(pair.Key)) ArenaBuilder.MissingPrefabs.Add(pair.Key);
                    continue;
                }
                Game.DropItems(prefab, count, 1, new Vector3(_site.Center.x, _site.FloorY + 0.3f, _site.Center.z));
                dropped += count;
            }

            var text = outcome == "victory" ? Tables.T("Victoire ! L'arène est vaincue.") : outcome == "abandon" ? Tables.T("Combat abandonné.") : Tables.T("Défaite… l'arène a gagné.");
            foreach (var f in Fighters)
            {
                Game.Screen(text, f.PeerId);
                if (dropped > 0) Game.Screen(Tables.T("Récompenses déposées au centre de l'arène"), f.PeerId, center: false);
            }

            var record = new Record
            {
                Date = DateTime.UtcNow.ToString("o"),
                Tier = Tier,
                Wave = outcome == "victory" ? Wave : Wave - 1,
                Seconds = ElapsedSeconds,
                Outcome = outcome,
            };
            foreach (var f in Fighters) { record.Names.Add(f.Name); record.Deaths += f.Deaths; }
            _log($"Combat terminé : {outcome}, vague {record.Wave}, {dropped} objets déposés");

            Current = Phase.Ended;
            _cooldownUntil = Time.time + _settings.CooldownSeconds;
            _onFinished(record);
        }

        public void Abort(string reason)
        {
            if (!Active) return;
            _log($"Combat interrompu : {reason}");
            Finish("abandon");
        }

        // ---------- Export ----------

        public void Write(StringBuilder sb)
        {
            sb.Append("{\"phase\":").Append(Json.Str(Current.ToString().ToLowerInvariant()))
              .Append(",\"tier\":").Append(Tier).Append(",\"wave\":").Append(Wave).Append(",\"waves\":").Append(_settings.Waves)
              .Append(",\"secondsLeft\":").Append(Json.F(SecondsLeft)).Append(",\"elapsed\":").Append(ElapsedSeconds)
              .Append(",\"alive\":").Append(Alive).Append(",\"outcome\":").Append(Json.Str(Outcome))
              .Append(",\"cooldown\":").Append(Json.F(Mathf.Max(0f, _cooldownUntil - Time.time)))
              .Append(",\"fighters\":[");
            var first = true;
            foreach (var f in Fighters)
            {
                Json.Sep(sb, ref first);
                sb.Append("{\"name\":").Append(Json.Str(f.Name)).Append(",\"dead\":").Append(f.Dead ? "true" : "false")
                  .Append(",\"left\":").Append(f.Left ? "true" : "false").Append(",\"deaths\":").Append(f.Deaths).Append(",\"gearTier\":").Append(f.GearTier).Append('}');
            }
            sb.Append("]}");
        }
    }
}
