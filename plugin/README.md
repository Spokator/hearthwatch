# Hearthwatch server plugins

Two server-side BepInEx plugins. Players (consoles included) install nothing.

- **HearthwatchBridge** feeds the live map (below).
- **HearthwatchArena** runs the wave-based fighting arena: it builds a stone arena in the world, watches who stands in the circle, spawns waves scaled to the team's gear and defeated bosses, drops rewards at the centre and keeps a leaderboard. It talks to the panel through `panelmap/arena-state.json` (exported every 2 s) and `panelmap/arena-cmd/*.txt` (commands written by the panel, `key=value` lines). Tables of creatures, gear tiers and rewards live in `HearthwatchArena/Tables.cs`; prefab names are checked at runtime and unknown ones are reported to the panel instead of crashing. Settings: `BepInEx/config/hearthwatch.arena.cfg`.

  The same plugin builds the **city**. The panel generates the plan (`panel/server/city/generator.js`) from two files the plugin writes: `panelmap/pieces.json`, the real size of every building piece (collision and render boxes, snap points, measured from the game's prefabs at startup), and `panelmap/city-survey.json`, the natural ground heights around the chosen spot. The plugin then builds the plan written to `panelmap/city-plan.json` a few milliseconds per frame: it generates unvisited zones, clears vegetation, writes the terrain data of each zone (levelled ground and paint), places the pieces and the arena. Pieces that do not need to be simulated are kept owned by the server, which never simulates anything on a dedicated server: they cannot wear out, collapse or be damaged. The plugin also moves the start location icon (where players without a bed spawn) to the city and can teleport arriving players there.

# HearthwatchBridge

Server-side BepInEx plugin that feeds the Hearthwatch live map.

## What it does

- **World map**: generated once per world from the seed (`WorldGenerator.GetBiome` / `GetBiomeHeight`), spread over several server frames (6 ms per frame by default). Output: `panelmap/<world>-<seed>-2048.map` (biomes, heights, forest mask).
- **`live.json`** every 2 s: players, creatures (stars, tamed, bosses), ships and carts.
- **`world.json`** every 30 s: ores, pickables, portals (tags), tombstones (owners), buildings (32 m cells), world locations and generated zones (used as "explored areas").
- **`map.json`**: map generation status and progress.
- **RCON on new worlds**: ValheimRcon only opens its port when a saved world is loaded. When the world was just created, the bridge starts the ValheimRcon listener itself, so the panel works from the very first boot.

Files are written to `<savedir>/panelmap` (`/data/data/panelmap` in the Docker image). The panel (`panel/server/map.js`) renders the image and hides unexplored areas from accounts without the "spoilers" permission.

## Build

The Docker image builds the plugin automatically. To build it by hand, copy the game assemblies into `plugin/refs/` (they are proprietary and ignored by git):

- from the dedicated server `valheim_server_Data/Managed/`: `assembly_valheim.dll`, `assembly_utils.dll`, `UnityEngine.dll`, `UnityEngine.CoreModule.dll`, `netstandard.dll`
- from BepInExPack Valheim `BepInEx/core/`: `BepInEx.dll`, `0Harmony.dll`

```bash
dotnet build plugin/HearthwatchBridge -c Release
```

## Install on an existing server

Copy `HearthwatchBridge.dll` into `BepInEx/plugins/Hearthwatch/` and restart the server. Settings: `BepInEx/config/hearthwatch.bridge.cfg` (editable from the panel's Mods page).

After a major Valheim update, rebuild against the new game assemblies.
