import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activitiesFromTags, toParking, toTrail } from "../src/convert";
import type { OverpassResponse } from "../src/overpass";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8")) as OverpassResponse;

describe("activitiesFromTags", () => {
  it("reconnaît rando, VTT et ski", () => {
    expect(activitiesFromTags({ route: "hiking" })).toEqual(["hiking"]);
    expect(activitiesFromTags({ route: "foot" })).toEqual(["hiking"]);
    expect(activitiesFromTags({ route: "mtb" })).toEqual(["mtb"]);
    expect(activitiesFromTags({ "piste:type": "skitour" })).toEqual(["ski"]);
  });

  it("cumule les activités d'un même itinéraire", () => {
    expect(activitiesFromTags({ route: "hiking", "piste:type": "nordic" })).toEqual(["hiking", "ski"]);
  });

  it("ignore le ski alpin et le vélo de route", () => {
    expect(activitiesFromTags({ "piste:type": "downhill" })).toEqual([]);
    expect(activitiesFromTags({ route: "bicycle" })).toEqual([]);
  });
});

describe("toTrail", () => {
  const trails = load("trails").elements.map(toTrail);

  it("garde les itinéraires couverts ayant une géométrie", () => {
    const kept = trails.filter((t) => t !== null).map((t) => t.osmId);
    // 9000004 = superroute sans géométrie, 9000005 = vélo de route
    // 9000006 (hors zone) est gardé ici : c'est la base qui l'écarte.
    expect(kept).toEqual([9000001, 9000002, 9000003, 9000006]);
  });

  it("assemble les chemins d'une relation en MultiLineString [lon, lat]", () => {
    const semnoz = trails[0]!;
    expect(semnoz.geometry.coordinates).toEqual([
      [[6.09, 45.8], [6.095, 45.805]],
      [[6.095, 45.805], [6.1, 45.81]],
    ]);
    expect(semnoz.difficulty).toBe("hiking");
  });
});

describe("toParking", () => {
  const parkings = load("parkings").elements.map(toParking);

  it("utilise le centre des parkings surfaciques", () => {
    expect(parkings[1]).toMatchObject({ lon: 6.3346, lat: 45.9689 });
  });

  it("ignore une capacité non numérique", () => {
    expect(parkings[0]?.capacity).toBe(40);
    expect(parkings[1]?.capacity).toBeNull();
  });

  it("ignore les parkings privés", () => {
    expect(parkings[3]).toBeNull();
  });
});
