import "jasmine";
import { animationPoolKey } from "../../display/animation_graphic_pool.js";
import { getIntegrationGameData } from "../../communication/simulation_test_fixture.js";

// Stock ids these specs pin. The integration fixture parses "Nova Files"
// only (no plug-ins), so every id here is stock data.
const FED_CARRIER = "nova:143";               // "Fed Carrier; Flagship"
const FED_CARRIER_NON_MISSILE = "nova:218";   // the ion-cannon variant
const FED_DESTROYER = "nova:141";             // does have muzzle flashes
const ION_CANNON = "nova:142";
const ION_CANNON_NO_GLOW = "nova:201";
const HEAVY_BLASTER_TURRET = "nova:130";

describe("Fed Carrier weapon-effect overlay", () => {
    // The Fed Carrier's shän (nova:143 and the variant shäns 218-222,
    // all pointing at rlëD nova:1030) defines NO WeapImage: the ship has
    // no muzzle-flash art in the stock data and must therefore render no
    // weapon-firing overlay at all. Nothing in the pipeline may
    // substitute a default sprite for the missing layer.
    for (const id of [FED_CARRIER, FED_CARRIER_NON_MISSILE]) {
        it(`parses ${id} with no weapImage layer and WeapDecay 0`, async () => {
            const gameData = await getIntegrationGameData();
            const { animation } = await gameData.data.Ship.get(id);

            expect(Object.keys(animation.images).sort())
                .toEqual(["baseImage", "glowImage"]);
            expect(animation.images.weapImage).toBeUndefined();
            expect(animation.weapDecay).toEqual(0);
            // Whatever art it does have is real art, never the default
            // placeholder sheet (novadatainterface's `"default"` id).
            for (const image of Object.values(animation.images)) {
                expect(image!.id).not.toEqual("default");
            }
        });

        it(`builds no weapon overlay sprite for ${id}`, async () => {
            const gameData = await getIntegrationGameData();
            const { animation } = await gameData.data.Ship.get(id);

            // AnimationGraphic.build creates one SpriteSheetSprite per
            // image slot the animation declares (and skips undefined
            // ones), so the sprite map is exactly the declared keys. No
            // weapImage sprite means ShipAnimationSystem's
            // `sprites.has('weapImage')` gate can never open, no matter
            // which weapon (the Ion Cannon sets wëap Flags2 0x0200) asks
            // for the firing animation.
            const builtSprites = Object.entries(animation.images)
                .filter(([, image]) => image).map(([name]) => name).sort();
            expect(builtSprites).toEqual(["baseImage", "glowImage"]);
            // The pool must not hand a Fed Destroyer's overlay-bearing
            // graphic to a Fed Carrier.
            expect(animationPoolKey(animation)).not.toContain("weapImage");
        });
    }

    it("still gives the Fed Destroyer its real muzzle-flash overlay", async () => {
        // The counter-example that keeps the specs above honest: the Fed
        // Destroyer family DOES define a WeapImage (rlëD nova:1826, "Fed
        // Destroyer weap glow") with WeapDecay 5.
        const gameData = await getIntegrationGameData();
        const { animation } = await gameData.data.Ship.get(FED_DESTROYER);

        expect(animation.images.weapImage).toBeDefined();
        expect(animation.images.weapImage!.id).toEqual("nova:1826");
        expect(animation.weapDecay).toEqual(5);
        expect(animationPoolKey(animation)).toContain("weapImage");
    });
});

describe("wëap Flags3 0x0010 (fire from the exit point closest to the target)", () => {
    it("is set on the Ion Cannons and nothing else in stock data", async () => {
        // Bible, wëap Flags3: "0x0010 Weapon fires from whatever weapon
        // exit point is closest to the target". Matthew's playtest note
        // ("some beam weapons, like ion cannon") matches the stock data
        // exactly: the two Ion Cannon variants are the only stock
        // weapons carrying the flag.
        const gameData = await getIntegrationGameData();
        const ids = (await gameData.ids).Weapon;

        const flagged: string[] = [];
        for (const id of ids) {
            const weapon = await gameData.data.Weapon.get(id);
            if (weapon.firesFromClosestToTarget) {
                flagged.push(id);
            }
        }
        expect(flagged.sort())
            .toEqual([ION_CANNON, ION_CANNON_NO_GLOW].sort());
    });

    it("leaves ordinary weapons on the round-robin cursor", async () => {
        const gameData = await getIntegrationGameData();
        expect((await gameData.data.Weapon.get(HEAVY_BLASTER_TURRET))
            .firesFromClosestToTarget).toBeFalse();
    });

    it("applies to the beam exit points of the Ion Cannon", async () => {
        const gameData = await getIntegrationGameData();
        const ion = await gameData.data.Weapon.get(ION_CANNON);
        expect(ion.exitType).toEqual("beam");
        expect(ion.type).toEqual("BeamWeaponData");
    });
});
