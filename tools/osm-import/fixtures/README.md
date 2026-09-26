# Jeu d'essai Overpass (FICTIF)

Ces fichiers imitent le format des réponses Overpass (`out geom` / `out center`)
mais **ne sont pas de vraies données OSM** : identifiants et tracés sont inventés.
Ils servent aux tests automatiques et à travailler sans réseau :

```
npm run osm:import -- --from-dir tools/osm-import/fixtures
```

Cas couverts : itinéraire rando normal, itinéraire VTT qui sort de la zone
(doit être découpé), piste de ski de fond (way), « superroute » sans géométrie
(ignorée), itinéraire vélo de route (activité non couverte, ignorée),
itinéraire hors Haute-Savoie (écarté), parkings proche / éloigné / privé.
