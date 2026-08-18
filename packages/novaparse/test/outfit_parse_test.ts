import "jasmine";
import { OutfResource } from "../src/resource_parsers/outf_resource.js";
import { OutfitParse } from "../src/parsers/outfit_parse.js";

function fakeOutf(functions: Array<[string, number | boolean]>): OutfResource {
    return {
        globalID: "nova:128",
        name: "Test Outfit",
        prefix: "nova",
        functions,
        mass: 5,
        cost: 100,
        displayWeight: 1,
        max: 1,
        pictID: 0,
        descID: 0,
        availability: "",
        onPurchase: "",
        onSell: "",
        contribute: 0n,
        require: 0n,
        flags: 0,
        idSpace: { PICT: {}, dësc: {}, wëap: {}, oütf: {} },
    } as unknown as OutfResource;
}

describe("OutfitParse", () => {
    it("parses the hyperspace dist mod into jumpDistanceMod", async () => {
        const outfit = await OutfitParse(
            fakeOutf([["hyperspace dist mod", -300]]), () => { });
        expect(outfit.physics.jumpDistanceMod).toEqual(-300);
    });

    it("parses fast jump into canJumpWithoutSlowing", async () => {
        const outfit = await OutfitParse(
            fakeOutf([["fast jump", true]]), () => { });
        expect(outfit.physics.canJumpWithoutSlowing).toEqual(true);
    });

    it("parses the inertial damper into inertialess", async () => {
        const outfit = await OutfitParse(
            fakeOutf([["inertial damper", true]]), () => { });
        expect(outfit.physics.inertialess).toEqual(true);
    });

    it("omits jump properties from outfits without them", async () => {
        const outfit = await OutfitParse(fakeOutf([["shield", 55]]), () => { });
        expect(outfit.physics.jumpDistanceMod).toBeUndefined();
        expect(outfit.physics.canJumpWithoutSlowing).toBeUndefined();
        expect(outfit.physics.shield).toEqual(55);
    });

    it("negates the murk modifier ModVal into murkClear", async () => {
        // A Sensor Boost (nova:203) carries murk modifier -3, which the Bible
        // defines as adding -3 to system murkiness, i.e. clearing 3 murk.
        const outfit = await OutfitParse(
            fakeOutf([["murk modifier", -3]]), () => { });
        expect(outfit.murkClear).toEqual(3);
    });

    it("passes the interference mod ModVal through as a reduction", async () => {
        const outfit = await OutfitParse(
            fakeOutf([["interference mod", 20]]), () => { });
        expect(outfit.interferenceReduction).toEqual(20);
    });

    it("sums murk and interference across mod pairs", async () => {
        const outfit = await OutfitParse(fakeOutf([
            ["murk modifier", -3], ["murk modifier", -2],
            ["interference mod", 20], ["interference mod", 5],
        ]), () => { });
        expect(outfit.murkClear).toEqual(5);
        expect(outfit.interferenceReduction).toEqual(25);
    });

    it("parses IFF into the iff flag", async () => {
        const outfit = await OutfitParse(fakeOutf([["IFF", true]]), () => { });
        expect(outfit.iff).toBe(true);
    });

    it("parses auto refuel and multi-jump", async () => {
        const outfit = await OutfitParse(fakeOutf([
            ["auto refuel", true], ["multi-jump", 10],
        ]), () => { });
        expect(outfit.autoRefuel).toBe(true);
        expect(outfit.multiJump).toEqual(10);
    });

    it("parses the stubbed passive ModTypes into typed fields", async () => {
        const outfit = await OutfitParse(fakeOutf([
            ["density scanner", true], ["map", 3], ["marines", 25],
            ["repair system", true], ["escape pod", true],
            ["auto eject", true], ["clean legal record", -1],
            ["iff scrambler", 5], ["reinforcement inhibitor", -1],
            ["paint", 0x1234], ["bomb", -1], ["nonlethal bomb", 200],
        ]), () => { });
        expect(outfit.densityScanner).toBe(true);
        expect(outfit.map).toEqual(3);
        expect(outfit.marines).toEqual(25);
        expect(outfit.repairSystem).toBe(true);
        expect(outfit.escapePod).toBe(true);
        expect(outfit.autoEject).toBe(true);
        expect(outfit.cleanLegalRecord).toEqual(-1);
        expect(outfit.iffScramblerClass).toEqual(5);
        expect(outfit.reinforcementInhibitorClass).toEqual(-1);
        expect(outfit.paintColor).toEqual(0x1234);
        expect(outfit.bomb).toEqual(-1);
        expect(outfit.nonlethalBomb).toEqual(200);
    });

    it("leaves passive fields at their defaults for unrelated outfits", async () => {
        const outfit = await OutfitParse(fakeOutf([["shield", 55]]), () => { });
        expect(outfit.murkClear).toEqual(0);
        expect(outfit.interferenceReduction).toEqual(0);
        expect(outfit.iff).toBe(false);
        expect(outfit.autoRefuel).toBe(false);
        expect(outfit.multiJump).toEqual(0);
        expect(outfit.map).toBeNull();
        expect(outfit.iffScramblerClass).toBeNull();
    });

    it("carries the WRITING plug-in through as writerPrefix", async () => {
        // A plug-in's override of a stock oütf keeps the stock id (and so
        // prefix "nova"), which is why the writer has to travel separately:
        // it is the namespace a bare Oxxx in the resource's own Availability
        // is scoped to. See BaseData.writerPrefix.
        const override = await OutfitParse({
            ...fakeOutf([["shield", 10]]), writerPrefixIfSet: "extra-outfits",
        } as unknown as OutfResource, () => { });
        expect(override.prefix).toEqual("nova");
        expect(override.writerPrefix).toEqual("extra-outfits");

        // A hand-made resource never had one set; it is its own prefix.
        const plain = await OutfitParse(fakeOutf([["shield", 10]]), () => { });
        expect(plain.writerPrefix).toEqual("nova");
    });

    describe("outfitter visibility fields", () => {
        /** fakeOutf with an explicit TechLevel and Flags word. */
        function techOutf(techLevel: number, flags: number): OutfResource {
            return {
                ...fakeOutf([["shield", 10]]), techLevel, flags,
            } as unknown as OutfResource;
        }

        it("carries TechLevel through to the outfit data", async () => {
            const outfit = await OutfitParse(techOutf(7, 0), () => { });
            expect(outfit.techLevel).toEqual(7);
        });

        it("keeps the absurd TechLevels that mark SpecialTech-only items",
            async () => {
                // The Bible's own example of the pattern (~:2772): an item
                // given a huge TechLevel appears only where a stellar names
                // that exact value in a SpecialTech slot.
                const outfit = await OutfitParse(techOutf(15000, 0), () => { });
                expect(outfit.techLevel).toEqual(15000);
            });

        it("carries BuyRandom through as buyRandom", async () => {
            // The oütf's "Available Random" word. Zero is the data's marker
            // for an item that is never put on sale (see the outfitter's
            // neverOnSale); everything else is a percentage NovaJS reads as
            // simply "offered".
            for (const availableRandom of [0, 55, 100]) {
                const outfit = await OutfitParse({
                    ...techOutf(7, 0), availableRandom,
                } as unknown as OutfResource, () => { });
                expect(outfit.buyRandom).toEqual(availableRandom);
            }
        });

        it("decodes the four outfitter visibility flags", async () => {
            const outfit = await OutfitParse(
                techOutf(1, 0x0100 | 0x0800 | 0x1000 | 0x4000), () => { });
            expect(outfit.hideUnlessRequirementsMet).toBe(true);
            expect(outfit.sellAnywhere).toBe(true);
            expect(outfit.excludesEqualDisplayWeight).toBe(true);
            expect(outfit.hideUnlessAvailable).toBe(true);
        });

        it("leaves the visibility flags false when unset", async () => {
            const outfit = await OutfitParse(techOutf(1, 0), () => { });
            expect(outfit.hideUnlessRequirementsMet).toBe(false);
            expect(outfit.sellAnywhere).toBe(false);
            expect(outfit.excludesEqualDisplayWeight).toBe(false);
            expect(outfit.hideUnlessAvailable).toBe(false);
        });

        it("decodes each visibility flag independently", async () => {
            // Guards against a copy-paste mixup between the four bits: each
            // one alone must light up only its own field.
            const only = async (flag: number) =>
                await OutfitParse(techOutf(1, flag), () => { });

            const hideReq = await only(0x0100);
            expect(hideReq.hideUnlessRequirementsMet).toBe(true);
            expect(hideReq.sellAnywhere).toBe(false);
            expect(hideReq.excludesEqualDisplayWeight).toBe(false);
            expect(hideReq.hideUnlessAvailable).toBe(false);

            const sellAnywhere = await only(0x0800);
            expect(sellAnywhere.sellAnywhere).toBe(true);
            expect(sellAnywhere.hideUnlessRequirementsMet).toBe(false);
            expect(sellAnywhere.excludesEqualDisplayWeight).toBe(false);

            const excludes = await only(0x1000);
            expect(excludes.excludesEqualDisplayWeight).toBe(true);
            expect(excludes.sellAnywhere).toBe(false);
            expect(excludes.hideUnlessAvailable).toBe(false);

            const hideUnavail = await only(0x4000);
            expect(hideUnavail.hideUnlessAvailable).toBe(true);
            expect(hideUnavail.excludesEqualDisplayWeight).toBe(false);
            expect(hideUnavail.hideUnlessRequirementsMet).toBe(false);
        });

        it("does not confuse the visibility flags with cantSell (0x0008)",
            async () => {
                const outfit = await OutfitParse(techOutf(1, 0x0008), () => { });
                expect(outfit.cantSell).toBe(true);
                expect(outfit.sellAnywhere).toBe(false);
                expect(outfit.hideUnlessRequirementsMet).toBe(false);
            });

        it("decodes the persistent flag (0x0004)", async () => {
            // "This item stays with you when you trade ships"
            // (EVN Bible ~:1962); read by spaceport/shipyard_rules.ts.
            const outfit = await OutfitParse(techOutf(1, 0x0004), () => { });
            expect(outfit.persistent).toBe(true);
        });

        it("leaves persistent false when unset", async () => {
            const outfit = await OutfitParse(techOutf(1, 0), () => { });
            expect(outfit.persistent).toBe(false);
        });

        it("does not confuse persistent with its neighbouring bits",
            async () => {
                // 0x0004 sits between turret (0x0002) and cantSell
                // (0x0008), the two easiest bits to fat-finger it into.
                const persistent = await OutfitParse(
                    techOutf(1, 0x0004), () => { });
                expect(persistent.persistent).toBe(true);
                expect(persistent.turret).toBe(false);
                expect(persistent.cantSell).toBe(false);
                expect(persistent.fixedGun).toBe(false);

                const turret = await OutfitParse(techOutf(1, 0x0002), () => { });
                expect(turret.turret).toBe(true);
                expect(turret.persistent).toBe(false);

                const cantSell = await OutfitParse(techOutf(1, 0x0008), () => { });
                expect(cantSell.cantSell).toBe(true);
                expect(cantSell.persistent).toBe(false);
            });

        it("decodes persistent alongside the hardpoint flags", async () => {
            // The stock Vell-os beams are exactly this combination: a
            // persistent, unsellable fixed gun (e.g. oütf 221).
            const outfit = await OutfitParse(
                techOutf(1, 0x0001 | 0x0004 | 0x0008), () => { });
            expect(outfit.fixedGun).toBe(true);
            expect(outfit.persistent).toBe(true);
            expect(outfit.cantSell).toBe(true);
            expect(outfit.turret).toBe(false);
        });
    });
});
