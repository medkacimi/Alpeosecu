// Itinéraires de Haute-Savoie : randonnée, VTT, ski de fond et ski de randonnée.
// Astuce : copier-coller cette requête sur https://overpass-turbo.eu pour la visualiser.
[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="6"]["ref:INSEE"="74"]->.zone;
(
  relation["route"~"^(hiking|foot|mtb)$"](area.zone);
  relation["piste:type"~"^(nordic|skitour)$"](area.zone);
  way["piste:type"~"^(nordic|skitour)$"](area.zone);
);
out geom;
