// Tous les parkings de Haute-Savoie. Seuls ceux proches d'un itinéraire
// importé sont conservés en base (filtrage fait en SQL, voir src/store.ts).
[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="6"]["ref:INSEE"="74"]->.zone;
nwr["amenity"="parking"](area.zone);
out center tags;
