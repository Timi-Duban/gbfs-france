# GBFS France

[MCP](https://modelcontextprotocol.io) server for live bike-share availability in France, from the GBFS feeds listed on [transport.data.gouv.fr](https://transport.data.gouv.fr). [Français](README.fr.md)

## Tools

Read-only, structured output plus short text, data producer credited on every answer.

- `search_networks(query)`: network ids for a city, area or name, plus unsupported matches and why.
- `nearby_stations(network_id, lat, lon, limit?, need?: bikes|docks, max_distance_meters?)`: nearest stations with bikes, e-bikes, free docks.
- `get_station(network_id, station_id)`: one station's live status.

```text
> nearby_stations { "network_id": "stations-velov-…", "lat": 45.7578, "lon": 4.832, "limit": 2 }
2 station(s) on Vélo'v Lyon.
BELLECOUR / ST EXUPÉRY (128 m): 4 bikes (0 e-bikes), 36 docks
PLACE ANTONIN PONCET (187 m): 7 bikes (0 e-bikes), 32 docks
Note: every station listed last reported 91 min to 7 h ago; counts are from the operator’s latest feed and may miss recent changes.
Data: Métropole de Lyon, Licence Ouverte v2.0 (Etalab), https://transport.data.gouv.fr/datasets/…
```

## Install

Node.js 22+. Claude Code: `claude mcp add gbfs-france -- npx -y gbfs-france-mcp`. Other MCP clients:

```json
{ "mcpServers": { "gbfs-france": { "command": "npx", "args": ["-y", "gbfs-france-mcp"] } } }
```

## Coverage

Docked networks with an open licence (Licence Ouverte, ODbL) and a GBFS 1.x-3.0 feed. Free-floating, scooters, car sharing and unlicensed datasets are not served.

<!-- networks:start -->

60 networks (snapshot 2026-11-09): Altervélo Saint-Pierre La Réunion (CIVIS), AQTA (Auray Quiberon Terre Atlantique), Auch-Vélo’c Grand Auch, Brennus à Vélo Grand Sénonais, C Vélo Clermont-Ferrand, Calivélo communauté d'agglomération du Libournais (La Cali), Cap Cotentin Vélo, Choletbus 2 Roues Cholet, CYCLOlibre Carcassonne, IDEcycle Pau, Impulsyon La Roche Sur Yon, Karu'vélo Pointe-à-Pitre La Guadeloupe, Le Vélo Baulois La Baule-Escoublac, Le Vélo TBM Bordeaux Métropole, Les petites reines Sables d'Olonne Agglomération, LeVélo Marseille, Libélo Valence Romans, Lovélo Rouen, MontenVélo CC Pays du Mont-Blanc (CCPMB), Naolib Micromob', Naolib Nantes Métropole, NemoVélo Nîmes Métropole, Ogalo Saumur, Optymo Belfort, Périvélo Grand Périgueux, R'Houle ports de Piriac-sur-Mer et de La Turballe, Rubis'Vélo Grand Bourg Agglomération, Semo CA Seine-Eure, STAR Rennes, Tanlib Niort, Tarbes Lourdes Pyrénées (TLP), Tempo Vélo Agen, Ti Vélo Pays de Landerneau-Daoulas, V'lille Lille, Vel'in Grand Calais (SITAC), Vélam Amiens, Vélhop Strasbourg Eurométropole, Vélib Paris et communes limitrophes, Vélibéo CA Bassin de Brive, VéliVert Saint-Etienne, Vélo d'Aqui Argelès-sur-mer, Vélo Fluo Grand Est, Vélo Modalis Grand Angoulême, Vélo'Cité Laon, Vélo'v Lyon, VéloCité Besançon, VéloCité Mulhouse, Vélomagg Montpellier Méditerranée Métropole, VéloMoove Bassin de Pompey, Velonecy Grand Annecy, Velopop’ Avignon, VélOstan’lib Nancy, VélôToulouse Toulouse Métropole, VéloZef Brest, VélYcéo Saint-Nazaire, Vernou-en-Sologne (Vernou Vélo), Vertuose Grand Longwy, ViVélo Vichy Communauté, Vivolt agglomération d'Epinal, Zébullo Grand Reims.

<!-- networks:end -->

## Design

`apps/mcp` (stdio) calls `packages/gbfs-core`, which has no Node imports (Hermes-safe, for a future Expo app):

- **Facade** [`facade.ts`](packages/gbfs-core/src/facade.ts): three calls hiding catalog, versions, feed join, cache and errors.
- **Adapter** [`feeds/v2.ts`](packages/gbfs-core/src/feeds/v2.ts), [`v3.ts`](packages/gbfs-core/src/feeds/v3.ts): one per GBFS version, same records out.
- **Cache-Aside + single-flight** [`feed-loader.ts`](packages/gbfs-core/src/fetch/feed-loader.ts): clamped ttl, stale-if-error 10 min, LRU 64.
- **Result type**: `{ ok: false, error }` instead of throwing.

## Development

```bash
fnm use && pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm catalog   # rebuild the network snapshot and lists
```

Release: push tag `vX.Y.Z` (npm with provenance, then MCP registry). Merge the weekly catalog PR so GitHub keeps scheduled workflows on. Follow-ups: [TODOS.md](TODOS.md).

MIT. Data stays under each producer's licence.
