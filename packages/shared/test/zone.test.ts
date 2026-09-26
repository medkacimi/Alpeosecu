import { describe, expect, it } from "vitest";
import { isInPilotZone } from "../src";

describe("isInPilotZone", () => {
  it("accepte Annecy et Chamonix", () => {
    expect(isInPilotZone(6.1294, 45.8992)).toBe(true);
    expect(isInPilotZone(6.8694, 45.9237)).toBe(true);
  });

  it("refuse Lyon et Grenoble", () => {
    expect(isInPilotZone(4.8357, 45.764)).toBe(false);
    expect(isInPilotZone(5.7245, 45.1885)).toBe(false);
  });
});
