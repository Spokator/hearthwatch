# syntax=docker/dockerfile:1

# ---- 1. Game reference assemblies, only used to compile the map plugin (never shipped) ----
FROM debian:trixie-slim AS game-refs
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl lib32gcc-s1 unzip \
 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /steamcmd /server /refs \
 && curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar -xz -C /steamcmd \
 && for attempt in 1 2 3; do \
      /steamcmd/steamcmd.sh +force_install_dir /server +login anonymous +app_update 896660 validate +quit \
      && [ -f /server/valheim_server_Data/Managed/assembly_valheim.dll ] && break; \
      sleep 5; \
    done \
 && cd /server/valheim_server_Data/Managed \
 && cp assembly_valheim.dll assembly_utils.dll UnityEngine.dll UnityEngine.CoreModule.dll UnityEngine.PhysicsModule.dll netstandard.dll /refs/
ARG BEPINEX_VERSION=5.4.2350
RUN curl -fsSL -A "Mozilla/5.0 (compatible; Hearthwatch)" -o /tmp/bepinex.zip \
      "https://thunderstore.io/package/download/denikson/BepInExPack_Valheim/${BEPINEX_VERSION}/" \
 && unzip -q /tmp/bepinex.zip -d /tmp/bepinex \
 && cp /tmp/bepinex/BepInExPack_Valheim/BepInEx/core/BepInEx.dll /tmp/bepinex/BepInExPack_Valheim/BepInEx/core/0Harmony.dll /refs/

# ---- 2. Server-side plugins (map bridge + arena) ----
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS plugin
COPY plugin/HearthwatchBridge /src/HearthwatchBridge
COPY plugin/HearthwatchArena /src/HearthwatchArena
COPY --from=game-refs /refs /refs
RUN dotnet build /src/HearthwatchBridge -c Release -p:ValheimRefs=/refs -o /out \
 && dotnet build /src/HearthwatchArena -c Release -p:ValheimRefs=/refs -o /out

# ---- 3. Web panel ----
FROM node:22-trixie-slim AS panel
WORKDIR /app
COPY panel/package.json panel/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY panel/ ./
RUN npm run build && npm prune --omit=dev

# ---- 4. Runtime image ----
FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl jq unzip perl procps tini supervisor tzdata \
      lib32gcc-s1 lib32stdc++6 libatomic1 libpulse0 libpulse-mainloop-glib0 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=panel /usr/local/bin/node /usr/local/bin/node
RUN useradd --create-home --uid 1000 --shell /bin/bash valheim \
 && mkdir -p /data /opt/hearthwatch \
 && chown valheim:valheim /data

COPY --from=panel /app/dist /opt/hearthwatch/panel/dist
COPY --from=panel /app/server /opt/hearthwatch/panel/server
COPY --from=panel /app/node_modules /opt/hearthwatch/panel/node_modules
COPY --from=panel /app/package.json /opt/hearthwatch/panel/package.json
COPY --from=plugin /out/HearthwatchBridge.dll /out/HearthwatchArena.dll /opt/hearthwatch/plugin/
COPY docker/supervisord.conf docker/mods.json /opt/hearthwatch/
COPY --chmod=755 docker/scripts /opt/hearthwatch/scripts

ENV HW_MODE=docker \
    HW_DATA_DIR=/data \
    HW_HOST=0.0.0.0 \
    HW_PORT=8080 \
    HW_TRUST_PROXY=true \
    NODE_ENV=production

USER valheim
VOLUME /data
EXPOSE 2456-2457/udp 8080/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["tini", "--", "/opt/hearthwatch/scripts/entrypoint.sh"]
