import "jasmine";
import { getDefaultPlanetData, PlanetData } from "novadatainterface/planet_data";
import { TumbleAnimationComponent } from "../core/animation_plugin.js";
import { makePlanet } from "./make_planet.js";
import { PlanetComponent } from "./planet_plugin.js";

function planetData(overrides: Partial<PlanetData>): PlanetData {
    return { ...getDefaultPlanetData(), id: "nova:200", name: "Test", ...overrides };
}

describe("makePlanet", () => {
    it("attaches the PlanetComponent id", () => {
        const planet = makePlanet(planetData({ id: "nova:128" }));
        expect(planet.components.get(PlanetComponent)).toEqual({ id: "nova:128" });
    });

    it("gives a wormhole a continuous tumble at 30 / AnimDelay fps", () => {
        // AnimDelay 2 (30ths of a second) -> 15 fps. Continuous, so the
        // display's TumbleDrawSystem swirls rlëD 2300 instead of pinning
        // frame 0.
        const planet = makePlanet(planetData({
            gate: { kind: "wormhole", destinations: [], emergenceAngle: null },
            animationDelay: 2,
        }));
        expect(planet.components.get(TumbleAnimationComponent))
            .toEqual({ frameRate: 15, phase: 0 });
    });

    it("uses the default frame rate for a wormhole with no AnimDelay", () => {
        const planet = makePlanet(planetData({
            gate: { kind: "wormhole", destinations: [], emergenceAngle: null },
            animationDelay: 0,
        }));
        expect(planet.components.get(TumbleAnimationComponent)?.frameRate)
            .toBe(15);
    });

    it("does NOT tumble an ordinary planet", () => {
        const planet = makePlanet(planetData({ gate: null, animationDelay: 5 }));
        expect(planet.components.has(TumbleAnimationComponent)).toBeFalse();
    });

    it("does NOT tumble a hypergate (its animation is GateAnimationSystem)", () => {
        const planet = makePlanet(planetData({
            gate: { kind: "hypergate", destinations: [], emergenceAngle: null },
            animationDelay: 2,
        }));
        expect(planet.components.has(TumbleAnimationComponent)).toBeFalse();
    });
});
