using System;
using System.Collections.Generic;

namespace HearthwatchArena
{
    // Paliers, vagues, récompenses et textes. Tout est en noms de prefabs vanilla, vérifiés au chargement :
    // un nom inconnu (après une mise à jour du jeu) est ignoré et signalé au panel plutôt que de planter.
    internal sealed class Wave
    {
        public string[] Regular;
        public string[] Elite;
        public string Champion;
    }

    internal sealed class Tier
    {
        public int Level;
        public string Name;
        public Wave Pool;
        public (string item, int count)[] Materials;
        public (string item, int count)[] Prize;
    }

    internal static class Tables
    {
        public const int MaxTier = 8;

        public static readonly Tier[] Tiers =
        {
            null,
            new Tier
            {
                Level = 1, Name = "Prairies",
                Pool = new Wave { Regular = new[] { "Greyling", "Neck", "Boar" }, Elite = new[] { "Greydwarf" }, Champion = "Greydwarf_Elite" },
                Materials = new[] { ("LeatherScraps", 6), ("Feathers", 8), ("Amber", 2), ("Honey", 4), ("Flint", 6) },
                Prize = new[] { ("Ruby", 2), ("MeadHealthMinor", 3), ("Coins", 60) },
            },
            new Tier
            {
                Level = 2, Name = "Forêt noire",
                Pool = new Wave { Regular = new[] { "Greydwarf", "Skeleton", "Greydwarf_Shaman" }, Elite = new[] { "Greydwarf_Elite", "Ghost" }, Champion = "Troll" },
                Materials = new[] { ("Copper", 5), ("Tin", 3), ("Resin", 8), ("AmberPearl", 2), ("TrollHide", 2) },
                Prize = new[] { ("Ruby", 3), ("MeadPoisonResist", 2), ("Coins", 120) },
            },
            new Tier
            {
                Level = 3, Name = "Marais",
                Pool = new Wave { Regular = new[] { "Draugr", "Skeleton_Poison", "Blob" }, Elite = new[] { "Draugr_Elite", "BlobElite", "Wraith" }, Champion = "Abomination" },
                Materials = new[] { ("IronScrap", 6), ("Bloodbag", 3), ("Guck", 3), ("Chain", 1), ("Ruby", 1) },
                Prize = new[] { ("MeadHealthMedium", 3), ("IronScrap", 10), ("Coins", 200) },
            },
            new Tier
            {
                Level = 4, Name = "Montagnes",
                Pool = new Wave { Regular = new[] { "Wolf", "Skeleton_Mountains", "Fenring_Cultist" }, Elite = new[] { "Fenring", "Ulv", "Hatchling" }, Champion = "StoneGolem" },
                Materials = new[] { ("Silver", 5), ("Obsidian", 6), ("WolfPelt", 2), ("Crystal", 2), ("DragonTear", 1) },
                Prize = new[] { ("SilverNecklace", 2), ("MeadFrostResist", 2), ("MeadStaminaMedium", 3), ("Coins", 300) },
            },
            new Tier
            {
                Level = 5, Name = "Plaines",
                Pool = new Wave { Regular = new[] { "Goblin", "GoblinArcher", "Deathsquito" }, Elite = new[] { "GoblinShaman", "GoblinBrute" }, Champion = "Lox" },
                Materials = new[] { ("BlackMetalScrap", 6), ("LoxPelt", 2), ("Needle", 4), ("Barley", 6), ("Flax", 6) },
                Prize = new[] { ("LoxPie", 2), ("MeadHealthMajor", 3), ("Coins", 400) },
            },
            new Tier
            {
                Level = 6, Name = "Brumes",
                Pool = new Wave { Regular = new[] { "Seeker", "Tick", "SeekerBrood" }, Elite = new[] { "SeekerBrute" }, Champion = "Gjall" },
                Materials = new[] { ("Eitr", 4), ("Carapace", 6), ("Mandible", 2), ("ScaleHide", 3), ("BlackCore", 1) },
                Prize = new[] { ("MeadEitrMinor", 3), ("Wisp", 4), ("Coins", 500) },
            },
            new Tier
            {
                Level = 7, Name = "Terres cendrées",
                Pool = new Wave { Regular = new[] { "Charred_Twitcher", "Charred_Archer", "Asksvin" }, Elite = new[] { "Charred_Mage", "Morgen", "Volture" }, Champion = "FallenValkyrie" },
                Materials = new[] { ("CharredBone", 6), ("Grausten", 6), ("FlametalOreNew", 3), ("MorgenSinew", 2), ("CharredCogwheel", 1) },
                Prize = new[] { ("MorgenHeart", 1), ("MeadHealthMajor", 4), ("Coins", 600) },
            },
            new Tier
            {
                Level = 8, Name = "Nord profond",
                Pool = new Wave { Regular = new[] { "Skeleton_DeepNorth", "GoblinDeepNorth", "Greydwarf_Frozen", "Frysling" }, Elite = new[] { "Elaking", "Bjorn", "JotunWitch" }, Champion = "JotunWarrior" },
                Materials = new[] { ("MooseHide", 4), ("SealHide", 3), ("MooseSinew", 3), ("ElakingHairBundle", 2), ("BarkaBranch", 3), ("FrostCore", 2) },
                Prize = new[] { ("FeastDeepNorth", 1), ("SpiceDeepNorth", 2), ("Frostwood", 6), ("Coins", 800) },
            },
        };

        // Équipement porté → palier. Vérifié dans l'ordre : le premier motif qui correspond gagne.
        private static readonly (string pattern, int tier)[] Gear =
        {
            ("JotunBane", 6), ("DeepNorth", 8), ("IceSkates", 8), ("IceShoes", 8),
            ("Flametal", 7), ("Ashlands", 7), ("Berserker", 7), ("Niedhogg", 7), ("Slayer", 7), ("Berzerkr", 7), ("Dyrnwyn", 7), ("Gold_", 7), ("Skoll", 7), ("Splitnir", 7), ("Ripper", 7),
            ("Carapace", 6), ("ArmorMage", 6), ("HelmetMage", 6), ("Mistwalker", 6), ("Krom", 6), ("Himminafl", 6), ("SpineSnap", 6), ("Staff", 6), ("Demolisher", 6), ("Eitr", 6),
            ("Padded", 5), ("Blackmetal", 5), ("ArmorLox", 5), ("HelmetLox", 5), ("CapeLox", 5), ("Porcupine", 5),
            ("Wolf", 4), ("Fenring", 4), ("Drake", 4), ("Silver", 4), ("DraugrFang", 4), ("Frostner", 4), ("Crystal", 4),
            ("ArmorIron", 3), ("HelmetIron", 3), ("Iron", 3), ("Root", 3), ("Huntsman", 3), ("Banded", 3), ("Abyssal", 3), ("Chitin", 3),
            ("TrollLeather", 2), ("Bronze", 2), ("FineWood", 2), ("Stagbreaker", 2), ("Copper", 2),
            ("Leather", 1), ("Rags", 1), ("Club", 1), ("AxeStone", 1), ("Flint", 1), ("Wood", 1), ("Torch", 1), ("Bow", 1),
        };

        public static int GearTier(string prefab)
        {
            if (string.IsNullOrEmpty(prefab)) return 0;
            foreach (var (pattern, tier) in Gear)
                if (prefab.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0) return tier;
            return 0;
        }

        // Boss vaincus → palier minimal raisonnable (un cran sous le biome suivant).
        private static readonly (string key, int tier)[] BossKeys =
        {
            ("defeated_fader", 8), ("defeated_queen", 7), ("defeated_goblinking", 6), ("defeated_dragon", 5),
            ("defeated_bonemass", 4), ("defeated_gdking", 3), ("defeated_eikthyr", 2),
        };

        public static int BossTier(HashSet<string> globalKeys)
        {
            if (globalKeys == null) return 1;
            foreach (var (key, tier) in BossKeys)
                if (globalKeys.Contains(key)) return tier;
            return 1;
        }

        public static string TierName(int tier) => tier >= 1 && tier <= MaxTier ? Tiers[tier].Name : "?";

        // ---------- Textes en jeu ----------

        public static string Language = "fr";

        private static readonly Dictionary<string, string> En = new Dictionary<string, string>
        {
            ["L'arène s'éveille… {0} s"] = "The arena awakens… {0} s",
            ["Palier {0} : {1}"] = "Tier {0}: {1}",
            ["Vague {0} / {1}"] = "Wave {0} / {1}",
            ["Vague {0} terminée !"] = "Wave {0} cleared!",
            ["Prochaine vague dans {0} s"] = "Next wave in {0} s",
            ["Un champion approche !"] = "A champion approaches!"
            ,
            ["Victoire ! L'arène est vaincue."] = "Victory! The arena is conquered.",
            ["Défaite… l'arène a gagné."] = "Defeat… the arena has won.",
            ["Combat abandonné."] = "Fight abandoned.",
            ["Reviens dans l'arène ! ({0} s)"] = "Get back in the arena! ({0} s)",
            ["Récompenses déposées au centre de l'arène"] = "Rewards dropped at the arena centre",
            ["Nouveau record : vague {0} au palier {1} !"] = "New record: wave {0} at tier {1}!",
            ["{0} est tombé. Il reste {1} combattant(s)."] = "{0} has fallen. {1} fighter(s) remain.",
            ["L'arène se repose. Réessayez dans {0} s."] = "The arena rests. Try again in {0} s.",
            ["Arène — entrez dans le cercle pour combattre"] = "Arena — step into the circle to fight",
        };

        public static string T(string text, params object[] args)
        {
            if (Language == "en" && En.TryGetValue(text, out var en)) text = en;
            return args == null || args.Length == 0 ? text : string.Format(text, args);
        }
    }
}
