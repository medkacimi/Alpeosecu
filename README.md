# Radar Montagne

Carte collaborative de l'état **actuel** des sentiers en Haute-Savoie (boue,
neige, chemin fermé, parking saturé, RAS), signalé en un geste par les
randonneurs, vttistes et skieurs de fond / rando. Complément à Komoot / Strava :
pas de tracés GPX, pas de fonctions sociales.

- Mobile : React Native + Expo · Web : React + Leaflet
- API : Node.js + Express (Render) · Base : PostgreSQL + PostGIS · Auth : Supabase
- Tout en TypeScript, dans un monorepo npm workspaces
- Données cartographiques : © contributeurs OpenStreetMap (ODbL)

## Documentation

1. [Architecture du monorepo](docs/01-architecture.md) — dont les décisions prises
2. [Schéma de base de données PostGIS](docs/02-base-de-donnees.md)

## État d'avancement

| Élément | Dossier | État |
|---|---|---|
| Code partagé (activités, conditions, zone pilote) | `packages/shared` | ✅ |
| Schéma PostGIS, migrations, données de démo | `db` | ✅ |
| Import des itinéraires et parkings OSM | `tools/osm-import` | ✅ testé sur jeu fictif, pas encore sur Overpass réel |
| CI (types + tests + PostGIS) | `.github/workflows` | ✅ |
| API REST | `apps/api` | ⏳ |
| Web | `apps/web` | ⏳ |
| Mobile | `apps/mobile` | ⏳ |

## Démarrer en local

Prérequis : Node.js 22 (`nvm use`), Docker.

```bash
npm install
cp .env.example .env
docker compose up -d          # PostGIS local (bases radar et radar_test)

npm run db:migrate            # crée le schéma radar
npm run db:seed               # quelques signalements de démonstration

# Itinéraires : jeu d'essai fictif (sans réseau)…
npm run osm:import -- --from-dir tools/osm-import/fixtures
# …ou vraies données OSM (plusieurs minutes, serveur public partagé : ne pas abuser)
npm run osm:import -- --save-dir tools/osm-import/cache
npm run osm:import -- --from-dir tools/osm-import/cache   # rejouer sans re-télécharger
```

Vérifications (les mêmes qu'en CI) :

```bash
npm run typecheck
npm test                      # les tests d'intégration utilisent TEST_DATABASE_URL (base vidée !)
```

Repartir d'une base locale propre : `npm run db:reset` (refuse toute base non locale).
