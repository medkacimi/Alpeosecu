# 01 — Architecture du monorepo

> Statut : **validé le 26/09/2026** (voir « Décisions prises » en fin de document).
> Mis en place : monorepo, base de données (`db/`), import OSM (`tools/osm-import/`), CI.
> Restent à créer : `apps/api`, `apps/web`, `apps/mobile`.

## 1. Vue d'ensemble

```
          ┌──────────────┐      ┌──────────────┐
          │ apps/mobile  │      │  apps/web    │
          │ Expo + RN    │      │ React+Leaflet│
          │ react-native-│      │ (Vite)       │
          │ maps         │      │              │
          └──────┬───────┘      └──────┬───────┘
                 │  HTTPS / JSON (GeoJSON)│
                 │  + JWT Supabase        │
                 └──────────┬─────────────┘
                            ▼
                   ┌──────────────────┐        ┌──────────────────┐
                   │    apps/api      │───────▶│ Expo Push Service│
                   │ Node + Express   │        └──────────────────┘
                   │ (API REST unique)│
                   └───┬──────────┬───┘
       vérifie le JWT  │          │ SQL (pg)
                       ▼          ▼
            ┌──────────────┐  ┌───────────────────────┐
            │ Supabase Auth│  │ PostgreSQL + PostGIS  │
            └──────────────┘  │ schéma "radar"        │
                              └───────────▲───────────┘
                                          │ import périodique (hors requêtes utilisateurs)
                              ┌───────────┴───────────┐
                              │ tools/osm-import      │◀── API Overpass (OSM, ODbL)
                              └───────────────────────┘
```

Principes :

1. **Une seule porte d'entrée vers les données : `apps/api`.** Le mobile et le web
   n'accèdent jamais directement à la base. Ils utilisent Supabase *uniquement*
   pour se connecter (obtenir un JWT), puis envoient ce JWT à notre API.
2. **Overpass n'est jamais appelé par les clients.** Les sentiers sont importés
   dans PostGIS par un script (`tools/osm-import`), lancé à la main ou une fois
   par semaine. Raisons : l'instance publique d'Overpass a une politique d'usage
   raisonnable (limites de requêtes, lenteur), et les requêtes de proximité
   « signalement ↔ sentier » doivent de toute façon se faire en base.
3. **Le code partagé est petit et explicite** (`packages/shared`) : types, liste
   des conditions, validation des requêtes, client HTTP. Pas de logique métier
   cachée côté client.

## 2. Arborescence proposée

```
radar-montagne/
├── apps/
│   ├── api/                      # Backend Node.js + Express
│   │   ├── src/
│   │   │   ├── index.ts          # démarrage du serveur
│   │   │   ├── app.ts            # création de l'app Express (testable sans réseau)
│   │   │   ├── config.ts         # lecture/validation des variables d'environnement
│   │   │   ├── db.ts             # pool PostgreSQL (lib "pg")
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts       # vérifie le JWT Supabase → req.userId
│   │   │   │   ├── rateLimit.ts
│   │   │   │   └── errors.ts
│   │   │   ├── routes/           # 1 fichier = 1 ressource REST
│   │   │   │   ├── trails.ts
│   │   │   │   ├── reports.ts
│   │   │   │   ├── follows.ts
│   │   │   │   └── pushTokens.ts
│   │   │   ├── services/         # logique métier, SQL écrit en clair
│   │   │   │   ├── trailsService.ts
│   │   │   │   ├── reportsService.ts
│   │   │   │   └── notificationsService.ts
│   │   │   └── sql/              # requêtes spatiales longues, commentées
│   │   ├── test/
│   │   └── package.json
│   │
│   ├── web/                      # React + Leaflet (Vite)
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── map/              # MapView, TrailsLayer, ReportsLayer, Attribution
│   │   │   ├── reports/          # ReportSheet (choix rapide de la condition)
│   │   │   ├── auth/             # connexion Supabase
│   │   │   └── hooks/
│   │   └── package.json
│   │
│   └── mobile/                   # Expo (iOS + Android)
│       ├── app/                  # écrans (expo-router)
│       │   ├── _layout.tsx
│       │   ├── index.tsx         # la carte
│       │   ├── login.tsx
│       │   └── followed.tsx      # itinéraires suivis
│       ├── src/
│       │   ├── map/              # MapView, TrailPolylines, ReportMarkers, Attribution
│       │   ├── reports/
│       │   ├── location/         # wrapper autour d'expo-location
│       │   ├── notifications/    # enregistrement du token Expo Push
│       │   └── auth/
│       ├── app.config.ts
│       ├── eas.json
│       └── package.json
│
├── packages/
│   └── shared/                   # importé par api, web ET mobile
│       ├── src/
│       │   ├── conditions.ts     # codes + libellés + pictos des conditions
│       │   ├── activities.ts     # 'hiking' | 'mtb' | 'ski'
│       │   ├── schemas.ts        # validation des entrées/sorties (ex. zod)
│       │   ├── types.ts          # Trail, Report, GeoJSON...
│       │   ├── apiClient.ts      # fetch typé vers apps/api (web + mobile)
│       │   └── zone.ts           # emprise de la zone pilote Haute-Savoie
│       └── package.json
│
├── db/                           # package @radar/db
│   ├── migrations/               # 0001_init.sql, 0002_..., appliquées dans l'ordre
│   ├── seeds/                    # données de démo (faux signalements)
│   └── src/                      # exécuteur de migrations, createPool (réutilisé par l'API)
│
├── tools/
│   └── osm-import/               # package @radar/osm-import : Overpass → PostGIS
│       ├── queries/              # requêtes Overpass QL (*.overpassql, testables sur overpass-turbo)
│       ├── fixtures/             # réponses Overpass FICTIVES pour les tests
│       └── src/                  # convert.ts (pur), overpass.ts (HTTP), store.ts (SQL), cli.ts
│
├── docs/                         # ces documents + décisions (ADR)
├── .github/workflows/ci.yml      # lint + typecheck + tests à chaque PR
├── docker-compose.yml            # PostGIS local (bases radar + radar_test)
├── .env.example                  # liste des variables, sans secrets
├── package.json                  # workspaces npm
├── tsconfig.base.json            # config TypeScript commune
└── README.md
```

### Pourquoi ce découpage

| Choix | Raison | Alternative écartée |
|---|---|---|
| **npm workspaces** | Déjà inclus avec Node, aucun outil de plus à apprendre. | Turborepo / Nx : utiles à grande échelle, surcoût d'apprentissage ici. |
| `apps/*` + `packages/*` | Convention très répandue, facile à retrouver dans la doc d'Expo et de Vite. | Tout à la racine : dépendances mélangées. |
| `packages/shared` **unique** | Un seul endroit pour la liste des conditions et les types. | Plusieurs petits packages : trop de configuration pour une équipe de 2–4. |
| `db/migrations` en **SQL brut** | L'équipe apprend PostGIS directement ; les requêtes spatiales se lisent telles quelles. | ORM (Prisma, TypeORM) : support PostGIS limité ou indirect, cache le SQL qu'on veut justement maîtriser. |
| `routes/` → `services/` | Les routes valident l'entrée et appellent un service ; le SQL est dans les services. Deux couches seulement. | Architecture hexagonale / repositories : trop abstrait pour le périmètre. |
| Vite pour le web | Outil actuellement recommandé par la doc React pour un nouveau projet sans framework. | Create React App : n'est plus maintenu. |
| expo-router pour le mobile | Routage par fichiers, proposé par défaut par `create-expo-app`. | React Navigation configuré à la main : plus de code. |

> ⚠️ À vérifier au moment de l'initialisation : les versions récentes d'Expo
> détectent automatiquement les monorepos pour la configuration de Metro, mais
> je ne suis pas certain de la version exacte à partir de laquelle c'est le cas.
> Suivre le guide officiel « Work with monorepos » de la doc Expo pour la
> version installée.

## 3. API REST (contrat V1)

Toutes les réponses géographiques sont en **GeoJSON** (lisible directement par
Leaflet ; converti en tableaux de coordonnées pour react-native-maps).

| Méthode | Route | Auth | Rôle |
|---|---|---|---|
| GET | `/health` | — | Supervision |
| GET | `/trails?bbox=minLon,minLat,maxLon,maxLat&activity=hiking&zoom=13` | — | Sentiers visibles à l'écran (géométrie simplifiée selon le zoom) |
| GET | `/trails/:id` | — | Détail d'un sentier + signalements actifs dessus |
| GET | `/reports?bbox=…` | — | Signalements **actifs** dans l'emprise |
| POST | `/reports` | ✅ | Créer un signalement `{ condition, lon, lat, locationSource, accuracyM?, activity? }` |
| DELETE | `/reports/:id` | ✅ (auteur) | Retirer son propre signalement |
| GET | `/me/follows` | ✅ | Itinéraires suivis |
| PUT / DELETE | `/me/follows/:trailId` | ✅ | Suivre / ne plus suivre |
| PUT | `/me/push-tokens` | ✅ | Enregistrer le token Expo Push de l'appareil |

Règles côté API :

- **Horodatage et expiration calculés par le serveur**, jamais envoyés par le client.
- Refus d'un point hors de l'emprise Haute-Savoie (validation dans `shared/zone.ts`
  + contrôle SQL).
- Rattachement automatique au sentier le plus proche (≤ 50 m) et, pour
  `parking_busy`, au parking le plus proche (≤ 150 m). Seuils à ajuster en test terrain.
- Limitation simple anti-abus : par exemple 10 signalements / heure / compte
  (`express-rate-limit`), et refus d'un doublon « même auteur, même type, < 100 m,
  < 30 min ». Pas de modération manuelle en V1.
- `bbox` trop grande ou zoom trop faible → on ne renvoie pas les sentiers
  (le client affiche « zoomez pour voir les sentiers »). Cela protège les
  performances, surtout sur mobile où chaque sentier est une `Polyline`.

## 4. Flux principaux

**Signaler (mobile)**
1. Appui long sur la carte (ou bouton « Signaler ici » centré sur la position GPS).
2. Feuille avec 5 gros boutons : Boue · Neige · Fermé · Parking saturé · RAS.
3. Un appui = `POST /reports`. Position (tap ou GPS + précision) envoyée ;
   l'heure est posée par le serveur. Si l'utilisateur n'est pas connecté, on
   ouvre l'écran de connexion puis on renvoie le signalement.

**Notifier les suiveurs** (après chaque `POST /reports`, en tâche asynchrone dans
le même processus — pas de file de messages en V1)
1. SQL : utilisateurs qui suivent un sentier situé à ≤ 200 m du signalement,
   hors auteur, pas encore notifiés pour ce signalement.
2. Envoi groupé via Expo Push Service (lib `expo-server-sdk`).
3. Écriture dans `notifications_sent`. Les tokens invalides renvoyés par Expo
   sont supprimés.

**Importer les sentiers** (`tools/osm-import`, hebdomadaire ou manuel)
1. Requêtes Overpass limitées à la Haute-Savoie : zone administrative
   `admin_level=6` + `ref:INSEE=74` (voir `tools/osm-import/queries/`).
   ⚠️ Pas encore testées contre le vrai serveur Overpass : à valider sur
   overpass-turbo avant le premier import réel.
2. Découpage des itinéraires à l'emprise de la zone (un GR peut sortir du
   département), puis upsert dans `trails` / `parkings` sur `(osm_type, osm_id)`,
   le tout dans une seule transaction.
3. Suppression des itinéraires disparus d'OSM et des parkings à plus de 500 m
   d'un itinéraire. Garde-fou : import refusé s'il contient moins de la moitié
   des itinéraires déjà en base (réponse Overpass probablement tronquée).
4. Tags OSM retenus :
   - rando : relations `route=hiking` / `route=foot` ;
   - VTT : relations `route=mtb` ;
   - ski : voies ou relations `piste:type=nordic|skitour` (pas de ski alpin) ;
   - parkings : `amenity=parking`, hors `access=private|no`.

## 5. Cartographie, attribution et licences

- **Attribution OSM obligatoire** sur les deux clients, visible en permanence
  sur la carte : « © contributeurs OpenStreetMap » avec lien vers
  `https://www.openstreetmap.org/copyright`. Un composant `Attribution` par client.
- Les sentiers sont une base dérivée d'OSM (ODbL). Si la base dérivée est rendue
  publique, l'ODbL impose des obligations de partage à l'identique sur cette
  base. Je ne suis pas juriste : consultez les « Community Guidelines » de la
  licence publiées par l'OSM Foundation avant la soutenance, notamment sur la
  combinaison sentiers OSM + signalements.
- **Fond de carte :**
  - Web : tuiles raster OSM ou OpenTopoMap (plus lisible en montagne). Les deux
    ont une politique d'usage (attribution, User-Agent, pas d'usage intensif).
    Suffisant pour un pilote étudiant, à reconsidérer si l'app grossit.
  - Mobile : `react-native-maps` utilise Apple Maps sur iOS et Google Maps sur
    Android. Google Maps sur Android demande une **clé API Google Cloud** (compte
    de facturation requis à la création, même si l'usage du SDK mobile est, à ma
    connaissance, gratuit). À vérifier dans la grille tarifaire Google Maps
    Platform actuelle. Alternative sans Google : superposer des tuiles OSM via
    `UrlTile`.

## 6. Déploiement et coûts (contrainte « aucun service payant »)

| Brique | Proposition | Point de vigilance (à vérifier, les offres changent souvent) |
|---|---|---|
| Auth | Supabase (offre gratuite) | Un projet gratuit peut être mis en pause après une période d'inactivité. |
| Base PostGIS | **La base Postgres du même projet Supabase** (PostGIS disponible en extension) | Évite un 2ᵉ fournisseur. Taille limitée sur l'offre gratuite : suffisante pour une seule zone. |
| API | **Render** (offre gratuite) | Le service se met en veille après une période d'inactivité : la 1ʳᵉ requête suivante est lente (souvent plusieurs dizaines de secondes). Acceptable pour le pilote ; prévenir le jury avant la démo. |
| Web | Vercel (offre Hobby) | Offre réservée à un usage non commercial : OK pour un projet étudiant. |
| Mobile | EAS Build (offre gratuite, nombre de builds limité par mois) | **Android uniquement** : APK de test distribué directement. Pas de compte Apple Developer, donc pas de TestFlight. Sur iPhone, l'app peut être testée en développement via Expo Go, à condition de n'utiliser que des modules inclus dans Expo Go (à vérifier pour chaque dépendance). |
| Push | Expo Push Service | Gratuit. **Android seulement** : sur iOS, l'envoi de notifications passe par Apple (APNs), ce qui demande un compte Apple Developer. Sur Android, il faut une *development build* ou l'APK : à ma connaissance, Expo Go ne gère plus les push sur Android avec les SDK récents. |

Environnements : `local` (docker-compose PostGIS + API + Vite + Expo) et `prod`.
Pas d'environnement de préproduction en V1.

## 7. Découpage du travail sur le semestre (indicatif)

| Période | Objectif livrable | Priorité MVP |
|---|---|---|
| Oct. | Monorepo, CI, base + migrations, import Overpass, `GET /trails` | 1 |
| Nov. | Carte web + mobile avec sentiers filtrables, géolocalisation | 1, 2 |
| Déc. | Auth Supabase, `POST /reports`, feuille de signalement | 3, 5 |
| Janv. | Pictogrammes des signalements, expiration, tests terrain | 4 |
| Févr. | Suivi d'itinéraire + notifications push | 6 |
| Mars | Stabilisation, builds EAS, démo, soutenance | — |

## 8. Décisions prises (26/09/2026)

| Question | Décision | Conséquence |
|---|---|---|
| Langage | **TypeScript** partout | `tsconfig.base.json` commun ; tsx / Vite / Metro exécutent le TS directement, `tsc` ne sert qu'à vérifier les types. |
| Hébergement API | **Render** | Voir la mise en veille (section 6). |
| Ski | **Ski de fond et ski de randonnée** (`piste:type=nordic|skitour`) | Pas de pistes de station. |
| iOS | **Pas de compte Apple Developer** | Démo sur APK Android + web. iPhone : tests de développement via Expo Go seulement, sans push. |
| Durées d'expiration | Pas de retour : on garde **48 h** (boue, neige, fermé) et **24 h** (parking, RAS) | Modifiable par un simple `UPDATE radar.condition_types`, sans changer le code. |
