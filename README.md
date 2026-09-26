# Radar Montagne

Carte collaborative de l'état **actuel** des sentiers en Haute-Savoie (boue,
neige, chemin fermé, parking saturé, RAS), signalé en un geste par les
randonneurs, vttistes et skieurs. Complément à Komoot / Strava : pas de tracés
GPX, pas de fonctions sociales.

- Mobile : React Native + Expo · Web : React + Leaflet
- API : Node.js + Express · Base : PostgreSQL + PostGIS · Auth : Supabase
- Données cartographiques : © contributeurs OpenStreetMap (ODbL)

## Conception (à valider avant d'écrire du code)

1. [Architecture du monorepo](docs/01-architecture.md)
2. [Schéma de base de données PostGIS](docs/02-base-de-donnees.md)
