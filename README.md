# GBFS France

Live bike-share availability for France, for AI assistants. An [MCP](https://modelcontextprotocol.io) server that reads the official GBFS feeds listed on [transport.data.gouv.fr](https://transport.data.gouv.fr) and answers "where can I get a bike (or drop one) near here?".

[Version française](README.fr.md)

## Tools

| Tool              | Input                                                                                     | Returns                                                            |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `search_networks` | `query` (city, area or name)                                                              | network ids, plus matching networks that are not supported and why |
| `nearby_stations` | `network_id`, `lat`, `lon`, `limit?`, `need?` (`bikes` / `docks`), `max_distance_meters?` | nearest stations with bikes, e-bikes, free docks and distance      |
| `get_station`     | `network_id`, `station_id`                                                                | one station's live status                                          |

All tools are read-only, return structured content (with output schemas) plus a short text, and credit the data producer on every answer.

Example (live data, Vélo'v Lyon):

```text
> search_networks { "query": "Lyon" }
Vélo'v Lyon [stations-velov-de-la-metropole-de-lyon-disponibilites-temps-reel] (467 stations)
Not supported: Autopartage Citiz Métropole de Lyon (not a bike-share network (carsharing))

> nearby_stations { "network_id": "stations-velov-…", "lat": 45.7578, "lon": 4.832, "limit": 3, "need": "bikes" }
3 station(s) on Vélo'v Lyon.
BELLECOUR / ST EXUPÉRY (128 m): 14 bikes, 2 e-bikes, 25 docks [last report over 30 min ago]
PLACE ANTONIN PONCET (187 m): 17 bikes, 3 e-bikes, 22 docks [last report over 30 min ago]
BELLECOUR / RÉPUBLIQUE (202 m): 12 bikes, 7 e-bikes, 2 docks [last report over 30 min ago]
Data: Métropole de Lyon, Licence Ouverte v2.0 (Etalab), https://transport.data.gouv.fr/datasets/…
```

## Install

Requires Node.js 22 or later. In Claude Desktop (`claude_desktop_config.json`) or any MCP client:

```json
{
  "mcpServers": {
    "gbfs-france": { "command": "npx", "args": ["-y", "gbfs-france-mcp"] }
  }
}
```

Claude Code: `claude mcp add gbfs-france -- npx -y gbfs-france-mcp`.

## Coverage

Docked bike-share networks with an open licence (Licence Ouverte v1/v2, ODbL) and a GBFS 1.x, 2.x or 3.0 feed:

<!-- networks:start -->

60 networks (snapshot 2026-11-02): Altervélo Saint-Pierre La Réunion (CIVIS), AQTA (Auray Quiberon Terre Atlantique), Auch-Vélo’c Grand Auch, Brennus à Vélo Grand Sénonais, C Vélo Clermont-Ferrand, Calivélo communauté d'agglomération du Libournais (La Cali), Cap Cotentin Vélo, Choletbus 2 Roues Cholet, CYCLOlibre Carcassonne, IDEcycle Pau, Impulsyon La Roche Sur Yon, Karu'vélo Pointe-à-Pitre La Guadeloupe, Le Vélo Baulois La Baule-Escoublac, Le Vélo TBM Bordeaux Métropole, Les petites reines Sables d'Olonne Agglomération, LeVélo Marseille, Libélo Valence Romans, Lovélo Rouen, MontenVélo CC Pays du Mont-Blanc (CCPMB), Naolib Micromob', Naolib Nantes Métropole, NemoVélo Nîmes Métropole, Ogalo Saumur, Optymo Belfort, Périvélo Grand Périgueux, R'Houle ports de Piriac-sur-Mer et de La Turballe, Rubis'Vélo Grand Bourg Agglomération, Semo CA Seine-Eure, STAR Rennes, Tanlib Niort, Tarbes Lourdes Pyrénées (TLP), Tempo Vélo Agen, Ti Vélo Pays de Landerneau-Daoulas, V'lille Lille, Vel'in Grand Calais (SITAC), Vélam Amiens, Vélhop Strasbourg Eurométropole, Vélib Paris et communes limitrophes, Vélibéo CA Bassin de Brive, VéliVert Saint-Etienne, Vélo d'Aqui Argelès-sur-mer, Vélo Fluo Grand Est, Vélo Modalis Grand Angoulême, Vélo'Cité Laon, Vélo'v Lyon, VéloCité Besançon, VéloCité Mulhouse, Vélomagg Montpellier Méditerranée Métropole, VéloMoove Bassin de Pompey, Velonecy Grand Annecy, Velopop’ Avignon, VélOstan’lib Nancy, VélôToulouse Toulouse Métropole, VéloZef Brest, VélYcéo Saint-Nazaire, Vernou-en-Sologne (Vernou Vélo), Vertuose Grand Longwy, ViVélo Vichy Communauté, Vivolt agglomération d'Epinal, Zébullo Grand Reims.

<!-- networks:end -->

Not served yet: free-floating operators (Lime, Dott, Pony), scooters, car sharing, and datasets published without a licence. `search_networks` names them with the reason.

## Data and licences

Network list: [transport.data.gouv.fr](https://transport.data.gouv.fr) (national access point). Availability: each operator's GBFS feed, fetched live. Every answer returns the publisher, licence and dataset page, as ODbL and Licence Ouverte require. Station counts are what operators publish: `null` means unknown, stations not reporting for 30 minutes are flagged `outdated`.

## How it works

```text
apps/mcp (stdio)  ->  packages/gbfs-core: createGbfsFrance()
                        catalog.json (committed snapshot, rebuilt weekly)
                        discovery -> adapter v2 (1.x/2.x) | v3 (3.0)
                        feed loader: cache, single-flight, timeout, stale-if-error
                        join station_information x station_status -> StationView
```

Design patterns, by file:

- **Facade**: [`facade.ts`](packages/gbfs-core/src/facade.ts) hides versions, the feed join, caching and errors behind three calls, shared with the future Expo app.
- **Adapter**: [`feeds/v2.ts`](packages/gbfs-core/src/feeds/v2.ts) and [`feeds/v3.ts`](packages/gbfs-core/src/feeds/v3.ts) turn each GBFS version into the same records.
- **Cache-Aside** with **single-flight**: [`fetch/feed-loader.ts`](packages/gbfs-core/src/fetch/feed-loader.ts) caches each feed for its own `ttl` clamped per feed kind (live status 30-60 s), merges concurrent identical requests, serves the last good data up to 10 min when an operator fails, and keeps at most 64 feeds (LRU).
- **Result type**: the facade never throws on data failures; it returns `{ ok: false, error }` with a typed `kind`.

The core has no Node imports and avoids APIs missing on Hermes (React Native), enforced by ESLint.

## Development

```bash
fnm use            # Node 24 from .nvmrc
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm build         # apps/mcp/dist/index.js
pnpm catalog       # rebuild the network snapshot and this list
```

### Maintainer notes

- First npm release by hand (`pnpm --filter gbfs-france-mcp build`, then `npm publish` in `apps/mcp`), then set up npm trusted publishing for `release.yml`. After that, pushing a `vX.Y.Z` tag publishes to npm (with provenance) and to the MCP registry.
- GitHub turns off scheduled workflows after 60 days without activity: merging the weekly catalog PR keeps them running.
- Follow-ups are in [TODOS.md](TODOS.md).

## License

MIT. Data stays under each producer's licence.
