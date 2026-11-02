# GBFS France

Serveur [MCP](https://modelcontextprotocol.io) pour la disponibilité en direct des vélos en libre-service en France, à partir des flux GBFS référencés sur [transport.data.gouv.fr](https://transport.data.gouv.fr). [English](README.md)

## Outils

Lecture seule, sortie structurée et court texte (en anglais), producteur des données cité dans chaque réponse.

- `search_networks(query)` : identifiants de réseau pour une ville, un territoire ou un nom, et réseaux non pris en charge avec la raison.
- `nearby_stations(network_id, lat, lon, limit?, need?: bikes|docks, max_distance_meters?)` : stations les plus proches, avec vélos, VAE, places libres.
- `get_station(network_id, station_id)` : état en direct d'une station.

```text
> nearby_stations { "network_id": "stations-velov-…", "lat": 45.7578, "lon": 4.832, "limit": 2 }
2 station(s) on Vélo'v Lyon.
BELLECOUR / ST EXUPÉRY (128 m): 4 bikes (0 e-bikes), 36 docks
PLACE ANTONIN PONCET (187 m): 7 bikes (0 e-bikes), 32 docks
Note: every station listed last reported 91 min to 7 h ago; counts are from the operator’s latest feed and may miss recent changes.
Data: Métropole de Lyon, Licence Ouverte v2.0 (Etalab), https://transport.data.gouv.fr/datasets/…
```

## Installation

Node.js 22+. Claude Code : `claude mcp add gbfs-france -- npx -y gbfs-france-mcp`. Autres clients MCP :

```json
{ "mcpServers": { "gbfs-france": { "command": "npx", "args": ["-y", "gbfs-france-mcp"] } } }
```

## Couverture

Réseaux en station sous licence ouverte (Licence Ouverte, ODbL) avec un flux GBFS 1.x à 3.0. Free-floating, trottinettes, autopartage et jeux sans licence ne sont pas servis.

<!-- networks:start -->

60 networks (snapshot 2026-11-02): Altervélo Saint-Pierre La Réunion (CIVIS), AQTA (Auray Quiberon Terre Atlantique), Auch-Vélo’c Grand Auch, Brennus à Vélo Grand Sénonais, C Vélo Clermont-Ferrand, Calivélo communauté d'agglomération du Libournais (La Cali), Cap Cotentin Vélo, Choletbus 2 Roues Cholet, CYCLOlibre Carcassonne, IDEcycle Pau, Impulsyon La Roche Sur Yon, Karu'vélo Pointe-à-Pitre La Guadeloupe, Le Vélo Baulois La Baule-Escoublac, Le Vélo TBM Bordeaux Métropole, Les petites reines Sables d'Olonne Agglomération, LeVélo Marseille, Libélo Valence Romans, Lovélo Rouen, MontenVélo CC Pays du Mont-Blanc (CCPMB), Naolib Micromob', Naolib Nantes Métropole, NemoVélo Nîmes Métropole, Ogalo Saumur, Optymo Belfort, Périvélo Grand Périgueux, R'Houle ports de Piriac-sur-Mer et de La Turballe, Rubis'Vélo Grand Bourg Agglomération, Semo CA Seine-Eure, STAR Rennes, Tanlib Niort, Tarbes Lourdes Pyrénées (TLP), Tempo Vélo Agen, Ti Vélo Pays de Landerneau-Daoulas, V'lille Lille, Vel'in Grand Calais (SITAC), Vélam Amiens, Vélhop Strasbourg Eurométropole, Vélib Paris et communes limitrophes, Vélibéo CA Bassin de Brive, VéliVert Saint-Etienne, Vélo d'Aqui Argelès-sur-mer, Vélo Fluo Grand Est, Vélo Modalis Grand Angoulême, Vélo'Cité Laon, Vélo'v Lyon, VéloCité Besançon, VéloCité Mulhouse, Vélomagg Montpellier Méditerranée Métropole, VéloMoove Bassin de Pompey, Velonecy Grand Annecy, Velopop’ Avignon, VélOstan’lib Nancy, VélôToulouse Toulouse Métropole, VéloZef Brest, VélYcéo Saint-Nazaire, Vernou-en-Sologne (Vernou Vélo), Vertuose Grand Longwy, ViVélo Vichy Communauté, Vivolt agglomération d'Epinal, Zébullo Grand Reims.

<!-- networks:end -->

## Conception

`apps/mcp` (stdio) appelle `packages/gbfs-core`, sans import Node (compatible Hermes, pour une future app Expo) :

- **Façade** [`facade.ts`](packages/gbfs-core/src/facade.ts) : trois appels qui cachent catalogue, versions, jointure, cache et erreurs.
- **Adaptateur** [`feeds/v2.ts`](packages/gbfs-core/src/feeds/v2.ts), [`v3.ts`](packages/gbfs-core/src/feeds/v3.ts) : un par version GBFS, mêmes enregistrements.
- **Cache-Aside + single-flight** [`feed-loader.ts`](packages/gbfs-core/src/fetch/feed-loader.ts) : ttl borné, stale-if-error 10 min, LRU 64.
- **Type Result** : `{ ok: false, error }` au lieu d'une exception.

## Développement

```bash
fnm use && pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm catalog   # reconstruit l'instantané et les listes
```

Publication : pousser un tag `vX.Y.Z` (npm avec provenance, puis registre MCP). Fusionner la PR hebdomadaire du catalogue pour que GitHub garde les workflows planifiés. Suites : [TODOS.md](TODOS.md).

MIT. Les données restent sous la licence de chaque producteur.
