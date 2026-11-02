# GBFS France

La disponibilité des vélos en libre-service en France, en direct, pour les assistants IA. Un serveur [MCP](https://modelcontextprotocol.io) qui lit les flux GBFS officiels référencés sur [transport.data.gouv.fr](https://transport.data.gouv.fr) et répond à « où trouver un vélo (ou le déposer) près d'ici ? ».

[English version](README.md)

## Outils

| Outil             | Entrée                                                                                    | Renvoie                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `search_networks` | `query` (ville, territoire ou nom)                                                        | les identifiants de réseau, et les réseaux trouvés mais non pris en charge, avec la raison |
| `nearby_stations` | `network_id`, `lat`, `lon`, `limit?`, `need?` (`bikes` / `docks`), `max_distance_meters?` | les stations les plus proches : vélos, VAE, places libres et distance                      |
| `get_station`     | `network_id`, `station_id`                                                                | l'état en direct d'une station                                                             |

Tous les outils sont en lecture seule, renvoient un contenu structuré (avec schéma de sortie) et un court texte, et citent le producteur des données dans chaque réponse.

Exemple (données réelles, Vélo'v Lyon) :

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

Les réponses des outils sont en anglais ; l'assistant les reformule dans la langue de l'utilisateur.

## Installation

Node.js 22 ou plus. Dans Claude Desktop (`claude_desktop_config.json`) ou tout client MCP :

```json
{
  "mcpServers": {
    "gbfs-france": { "command": "npx", "args": ["-y", "gbfs-france-mcp"] }
  }
}
```

Claude Code : `claude mcp add gbfs-france -- npx -y gbfs-france-mcp`.

## Couverture

Réseaux de vélos en station sous licence ouverte (Licence Ouverte v1/v2, ODbL) avec un flux GBFS 1.x, 2.x ou 3.0 :

<!-- networks:start -->

60 networks (snapshot 2026-11-02): Altervélo Saint-Pierre La Réunion (CIVIS), AQTA (Auray Quiberon Terre Atlantique), Auch-Vélo’c Grand Auch, Brennus à Vélo Grand Sénonais, C Vélo Clermont-Ferrand, Calivélo communauté d'agglomération du Libournais (La Cali), Cap Cotentin Vélo, Choletbus 2 Roues Cholet, CYCLOlibre Carcassonne, IDEcycle Pau, Impulsyon La Roche Sur Yon, Karu'vélo Pointe-à-Pitre La Guadeloupe, Le Vélo Baulois La Baule-Escoublac, Le Vélo TBM Bordeaux Métropole, Les petites reines Sables d'Olonne Agglomération, LeVélo Marseille, Libélo Valence Romans, Lovélo Rouen, MontenVélo CC Pays du Mont-Blanc (CCPMB), Naolib Micromob', Naolib Nantes Métropole, NemoVélo Nîmes Métropole, Ogalo Saumur, Optymo Belfort, Périvélo Grand Périgueux, R'Houle ports de Piriac-sur-Mer et de La Turballe, Rubis'Vélo Grand Bourg Agglomération, Semo CA Seine-Eure, STAR Rennes, Tanlib Niort, Tarbes Lourdes Pyrénées (TLP), Tempo Vélo Agen, Ti Vélo Pays de Landerneau-Daoulas, V'lille Lille, Vel'in Grand Calais (SITAC), Vélam Amiens, Vélhop Strasbourg Eurométropole, Vélib Paris et communes limitrophes, Vélibéo CA Bassin de Brive, VéliVert Saint-Etienne, Vélo d'Aqui Argelès-sur-mer, Vélo Fluo Grand Est, Vélo Modalis Grand Angoulême, Vélo'Cité Laon, Vélo'v Lyon, VéloCité Besançon, VéloCité Mulhouse, Vélomagg Montpellier Méditerranée Métropole, VéloMoove Bassin de Pompey, Velonecy Grand Annecy, Velopop’ Avignon, VélOstan’lib Nancy, VélôToulouse Toulouse Métropole, VéloZef Brest, VélYcéo Saint-Nazaire, Vernou-en-Sologne (Vernou Vélo), Vertuose Grand Longwy, ViVélo Vichy Communauté, Vivolt agglomération d'Epinal, Zébullo Grand Reims.

<!-- networks:end -->

Pas encore servis : les opérateurs en free-floating (Lime, Dott, Pony), les trottinettes, l'autopartage et les jeux de données publiés sans licence. `search_networks` les cite avec la raison.

## Données et licences

Liste des réseaux : [transport.data.gouv.fr](https://transport.data.gouv.fr) (point d'accès national). Disponibilités : le flux GBFS de chaque opérateur, lu en direct. Chaque réponse indique le producteur, la licence et la page du jeu de données, comme l'exigent l'ODbL et la Licence Ouverte. Les compteurs sont ceux publiés par les opérateurs : `null` signifie inconnu, et une station sans remontée depuis 30 minutes est marquée `outdated`.

## Fonctionnement

```text
apps/mcp (stdio)  ->  packages/gbfs-core : createGbfsFrance()
                        catalog.json (instantané versionné, reconstruit chaque semaine)
                        découverte -> adaptateur v2 (1.x/2.x) | v3 (3.0)
                        chargement des flux : cache, single-flight, timeout, stale-if-error
                        jointure station_information x station_status -> StationView
```

Design patterns, par fichier :

- **Façade** : [`facade.ts`](packages/gbfs-core/src/facade.ts) cache les versions, la jointure des flux, le cache et les erreurs derrière trois appels, partagés avec la future app Expo.
- **Adaptateur** : [`feeds/v2.ts`](packages/gbfs-core/src/feeds/v2.ts) et [`feeds/v3.ts`](packages/gbfs-core/src/feeds/v3.ts) ramènent chaque version de GBFS aux mêmes enregistrements.
- **Cache-Aside** avec **single-flight** : [`fetch/feed-loader.ts`](packages/gbfs-core/src/fetch/feed-loader.ts) garde chaque flux le temps de son `ttl`, borné selon le type de flux (statut en direct : 30 à 60 s), fusionne les requêtes identiques simultanées, ressert les dernières données valides jusqu'à 10 min si un opérateur tombe, et garde au plus 64 flux (LRU).
- **Type Result** : la façade ne lève jamais d'exception sur un problème de données ; elle renvoie `{ ok: false, error }` avec un `kind` typé.

Le cœur n'importe aucun module Node et évite les API absentes de Hermes (React Native), ce que vérifie ESLint.

## Développement

```bash
fnm use            # Node 24 via .nvmrc
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm build         # apps/mcp/dist/index.js
pnpm catalog       # reconstruit l'instantané des réseaux et cette liste
```

### Notes de maintenance

- Première publication npm à la main (`pnpm --filter gbfs-france-mcp build`, puis `npm publish` dans `apps/mcp`), puis configuration du trusted publishing npm pour `release.yml`. Ensuite, pousser un tag `vX.Y.Z` publie sur npm (avec provenance) et sur le registre MCP.
- GitHub désactive les workflows planifiés après 60 jours sans activité : fusionner la PR hebdomadaire du catalogue les garde actifs.
- Les suites prévues sont dans [TODOS.md](TODOS.md).

## Licence

MIT. Les données restent sous la licence de chaque producteur.
