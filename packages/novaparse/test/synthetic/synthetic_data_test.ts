import "jasmine";
import * as fs from "fs";
import { PNG } from "pngjs";
import { NovaParse } from "../../src/nova_parse.js";
import { NovaIDs } from "novadatainterface/nova_ids";
import { NovaDataType } from "novadatainterface/nova_data_interface";
import {
    buildSyntheticDataSet, SYNTHETIC_DATA_ROOT, syntheticNdatPath,
} from "../../src/synthetic/data_set.js";
import { buildSyntheticResources } from "../../src/synthetic/resources.js";
import { SPRITE_GEOMETRY } from "../../src/synthetic/art.js";
import {
    AVAIL_LOC, BITS, CHARS, CLOAK_MODVAL, DIALOG_PICT_SIZES, DUDES, FLETS, GOVTS,
    JUNKS, MISNS, OUTFS, PERSONS, RANKS, RLED, SHIPS, sid, SPOBS, STRN, SYNTHETIC,
    SYST, SYSTS, VEIL_MODVAL, WEAPS,
} from "../../src/synthetic/universe.js";

/**
 * The synthetic data set (src/synthetic): the checked-in .ndat must be
 * what the generator produces today, and the generator's output must
 * parse — strictly, with nothing missing — into the scenario universe.ts
 * describes. universe.ts is the oracle: every value asserted below is
 * read from it, not retyped.
 */
describe("the synthetic Nova data set", () => {
    it("is checked in exactly as the generator produces it", () => {
        // A scenario edit without `npm run synthetic-data`, or a
        // generator that stopped being deterministic, fails here.
        const checkedIn = fs.readFileSync(syntheticNdatPath());
        const fresh = Buffer.from(buildSyntheticDataSet());
        expect(checkedIn.length).toEqual(fresh.length);
        expect(checkedIn.equals(fresh))
            .withContext("regenerate with `npm run synthetic-data` in packages/novaparse")
            .toBeTrue();
    });

    it("generates byte-identically twice in one process", () => {
        const a = Buffer.from(buildSyntheticDataSet());
        const b = Buffer.from(buildSyntheticDataSet());
        expect(a.equals(b)).toBeTrue();
    });

    it("never lists one resource twice", () => {
        const seen = new Set<string>();
        for (const { type, id } of buildSyntheticResources()) {
            const key = `${type} ${id}`;
            expect(seen.has(key)).withContext(key).toBeFalse();
            seen.add(key);
        }
    });

    describe("parsed strictly through NovaParse", () => {
        let novaParse: NovaParse;
        let ids: NovaIDs;
        let warnings: string[];
        let missing: string[];

        beforeAll(async () => {
            warnings = [];
            missing = [];
            novaParse = new NovaParse(SYNTHETIC_DATA_ROOT, true,
                { novaFiles: "Nova Files", novaPlugins: "Plug-ins" });
            novaParse.resourceNotFoundFunction = message => {
                missing.push(message);
                throw new Error(message);
            };
            ids = await novaParse.ids;
        });

        it("parses every id of every type with zero not-found reports "
            + "and zero warnings", async () => {
                const warn = spyOn(console, "warn").and.callFake(
                    (...args: unknown[]) => { warnings.push(args.join(" ")); });
                let parsed = 0;
                for (const [type, list] of Object.entries(ids)) {
                    for (const id of list) {
                        await novaParse.data[type as NovaDataType].get(id);
                        parsed++;
                    }
                }
                expect(parsed).toBeGreaterThan(250);
                expect(missing).toEqual([]);
                expect(warnings).toEqual([]);
                warn.and.callThrough();
            }, 60_000);

        it("lists exactly the scenario's systems, stellars, ships, weapons, "
            + "outfits, govts, dudes, fleets, missions, ranks and pilot", () => {
                const sorted = (list: string[]) => [...list].sort();
                expect(sorted(ids.System)).toEqual(sorted(SYSTS.map(s => sid(s.id))));
                expect(sorted(ids.Planet)).toEqual(sorted(SPOBS.map(s => sid(s.id))));
                expect(sorted(ids.Ship)).toEqual(sorted(SHIPS.map(s => sid(s.id))));
                expect(sorted(ids.Weapon)).toEqual(sorted(WEAPS.map(w => sid(w.id))));
                expect(sorted(ids.Outfit)).toEqual(sorted(OUTFS.map(o => sid(o.id))));
                expect(sorted(ids.Govt)).toEqual(sorted(GOVTS.map(g => sid(g.id))));
                expect(sorted(ids.Dude)).toEqual(sorted(DUDES.map(d => sid(d.id))));
                expect(sorted(ids.Fleet)).toEqual(sorted(FLETS.map(f => sid(f.id))));
                expect(sorted(ids.Mission)).toEqual(sorted(MISNS.map(m => sid(m.id))));
                expect(sorted(ids.Rank)).toEqual(sorted(RANKS.map(r => sid(r.id))));
                expect(sorted(ids.Pers)).toEqual(sorted(PERSONS.map(p => sid(p.id))));
                expect(sorted(ids.Junk)).toEqual(sorted(JUNKS.map(j => sid(j.id))));
                expect(ids.PlayerStart).toEqual(CHARS.map(c => sid(c.id)));
                // The fixtures that take "the sorted-first system/ship".
                expect([...ids.System].sort()[0]).toEqual(SYNTHETIC.systems.thessaly);
                expect([...ids.Ship].sort()[0]).toEqual(SYNTHETIC.ships.skiff);
            });

        it("links the systems as declared, closing the one-ended link", async () => {
            for (const def of SYSTS) {
                const system = await novaParse.data.System.get(sid(def.id));
                expect(system.name).toEqual(def.name);
                expect(system.position).toEqual(def.position);
                expect(system.planets).toEqual(def.spobs.map(sid));
                expect(system.avgShips).toEqual(def.avgShips);
                expect(system.govt).toEqual(def.govt >= 128 ? sid(def.govt) : null);
                expect(system.interference).toEqual(def.interference);
                expect(system.murk).toEqual(def.murk);
                expect(system.backgroundColor).toEqual(def.backgroundColor);
                expect(system.dudes).toEqual(def.dudes.filter(d => d.id >= 128)
                    .map(d => ({ id: sid(d.id), weight: d.chance })));
                expect(system.fleets).toEqual(def.dudes.filter(d => d.id <= -128)
                    .map(d => ({ id: sid(-d.id), weight: d.chance })));
                for (const link of def.links) {
                    expect(system.links).toContain(sid(link));
                }
            }
            // Vael Hollow declares no links; Kestrel Drift's link to it is
            // closed from the other end.
            const vael = await novaParse.data.System.get(SYNTHETIC.systems.vael);
            expect(vael.links).toEqual([SYNTHETIC.systems.kestrel]);
            const ossory = await novaParse.data.System.get(SYNTHETIC.systems.ossory);
            expect(ossory.asteroids).toEqual(4);
            expect(ossory.asteroidTypes).toEqual([SYNTHETIC.asteroid]);
        });

        it("has a full-service port, a landable uninhabited moon, a linked "
            + "hypergate pair and a gated station", async () => {
                const port = await novaParse.data.Planet.get(SYNTHETIC.planets.port);
                expect(port.flags).toEqual(jasmine.objectContaining({
                    canLand: true, hasCommodityExchange: true, hasOutfitter: true,
                    hasShipyard: true, hasBar: true, uninhabited: false,
                }));
                expect(port.tradeTiers).toEqual(["low", "med", "high", "med", "low", "high"]);
                expect(port.techLevel).toEqual(5);
                expect(port.govt).toEqual(SYNTHETIC.govts.meridian);
                expect(port.landingDesc).toEqual(SPOBS[0].landingDesc);
                expect(port.barDesc).toEqual(SPOBS[0].barDesc!);
                expect(port.barPict).toEqual(sid(9100));
                expect(port.landingPict).toEqual(sid(10000));
                expect(port.gate).toBeNull();

                const moon = await novaParse.data.Planet.get(SYNTHETIC.planets.moon);
                expect(moon.flags.canLand).toBeTrue();
                expect(moon.flags.uninhabited).toBeTrue();
                expect(moon.govt).toBeNull();

                const kestrel = await novaParse.data.Planet.get(SYNTHETIC.planets.kestrelGate);
                const vael = await novaParse.data.Planet.get(SYNTHETIC.planets.vaelGate);
                expect(kestrel.gate).toEqual({
                    kind: "hypergate", destinations: [SYNTHETIC.planets.vaelGate],
                    emergenceAngle: 90,
                });
                expect(vael.gate).toEqual({
                    kind: "hypergate", destinations: [SYNTHETIC.planets.kestrelGate],
                    emergenceAngle: 270,
                });
                expect(kestrel.animation.images.baseImage.id).toEqual(sid(RLED.gate));

                const refuge = await novaParse.data.Planet.get(SYNTHETIC.planets.refuge);
                expect(refuge.flags.isStation).toBeTrue();
                expect(refuge.flags.uninhabited).toBeFalse();
                expect(refuge.flags.hasOutfitter).toBeTrue();
                expect(refuge.minStatus).toEqual(20);
                expect(refuge.specialTech).toEqual([7]);
                expect(refuge.govt).toEqual(SYNTHETIC.govts.raiders);
                expect(refuge.landingFee).toEqual(250);
            });

        it("gives each ship its sprites, stock loadout and descriptions", async () => {
            for (const def of SHIPS) {
                const ship = await novaParse.data.Ship.get(sid(def.id));
                expect(ship.name).toEqual(def.name);
                expect(ship.shortName).toEqual(def.shortName);
                expect(ship.longName).toEqual(def.longName);
                expect(ship.desc).toEqual(def.desc);
                expect(ship.pilotDesc).toEqual(def.pilotDesc);
                expect(ship.price).toEqual(def.cost);
                expect(ship.techLevel).toEqual(def.techLevel);
                expect(ship.physics.shield).toEqual(def.shield);
                expect(ship.physics.armor).toEqual(def.armor);
                expect(ship.physics.freeCargo).toEqual(def.cargoSpace);
                expect(ship.physics.maxGuns).toEqual(def.maxGuns);
                expect(ship.physics.maxTurrets).toEqual(def.maxTurrets);
                expect(ship.pict).toEqual(sid(def.id - 128 + 5000));
                expect(ship.animation.images.baseImage.id).toEqual(sid(def.animation.baseImage));
                expect(ship.animation.images.baseImage.frames.normal.length)
                    .toEqual(def.animation.framesPer);
                if (def.animation.glowImage >= 0) {
                    expect(ship.animation.images.glowImage?.id)
                        .toEqual(sid(def.animation.glowImage));
                } else {
                    expect(ship.animation.images.glowImage).toBeUndefined();
                }
                expect(ship.finalExplosion).toEqual(SYNTHETIC.explosion);
                expect(ship.inherentGovt)
                    .toEqual(def.inherentGovt >= 128 ? sid(def.inherentGovt) : null);
                // Stock outfits, plus one outfit per weapon (the outfit
                // that provides it) and the ammo outfit for its load.
                for (const { id, count } of def.outfits) {
                    expect(ship.outfits[sid(id)]).withContext(`outfit ${id}`).toEqual(count);
                }
            }
            const warden = await novaParse.data.Ship.get(SYNTHETIC.ships.warden);
            expect(warden.outfits[SYNTHETIC.outfits.beam]).toEqual(1);
            expect(warden.outfits[SYNTHETIC.outfits.turret]).toEqual(1);
            expect(warden.outfits[SYNTHETIC.outfits.pointDefense]).toEqual(1);
            expect(warden.outfits[SYNTHETIC.outfits.skiffBay]).toEqual(1);
            expect(warden.outfits[SYNTHETIC.outfits.skiffFighter]).toEqual(2);
            expect(warden.largeExplosion).toBeTrue();
            expect(warden.infoPict).toBeNull();
            const skiff = await novaParse.data.Ship.get(SYNTHETIC.ships.skiff);
            expect(skiff.infoPict).toEqual(sid(20000));
            expect(skiff.playerFuelRegen).toBeTrue();
            expect(skiff.vulnerableTo).toEqual(["normal", "pointDefense"]);
            const corsair = await novaParse.data.Ship.get(SYNTHETIC.ships.corsair);
            expect(corsair.outfits[SYNTHETIC.outfits.blaster]).toEqual(2);
            expect(corsair.outfits[SYNTHETIC.outfits.launcher]).toEqual(1);
            expect(corsair.outfits[SYNTHETIC.outfits.missileAmmo]).toEqual(8);
        });

        it("has a blaster, a missile with ammo, a beam, a turret, a point "
            + "defence and a bay", async () => {
                const blaster = await novaParse.data.Weapon.get(SYNTHETIC.weapons.blaster);
                expect(blaster.type).toEqual("ProjectileWeaponData");
                expect(blaster.ammoType).toEqual("unlimited");
                expect(blaster.fireGroup).toEqual("primary");
                expect(blaster.exitType).toEqual("gun");
                if (blaster.type === "ProjectileWeaponData") {
                    expect(blaster.guidance).toEqual("unguided");
                    expect(blaster.animation.images.baseImage.id).toEqual(sid(RLED.bolt));
                    expect(blaster.primaryExplosion).toEqual(SYNTHETIC.explosion);
                }

                const missile = await novaParse.data.Weapon.get(SYNTHETIC.weapons.missile);
                expect(missile.type).toEqual("ProjectileWeaponData");
                expect(missile.ammoType).toEqual(["weapon", SYNTHETIC.weapons.missile]);
                expect(missile.fireGroup).toEqual("secondary");
                expect(missile.exitType).toEqual("guided");
                expect(missile.maxAmmo).toEqual(20);
                if (missile.type === "ProjectileWeaponData") {
                    expect(missile.guidance).toEqual("guided");
                    expect(missile.vulnerableTo).toEqual(["pointDefense"]);
                    expect(missile.animation.images.baseImage.frames.normal.length).toEqual(36);
                }

                const beam = await novaParse.data.Weapon.get(SYNTHETIC.weapons.beam);
                expect(beam.type).toEqual("BeamWeaponData");
                if (beam.type === "BeamWeaponData") {
                    expect(beam.guidance).toEqual("beam");
                    expect(beam.beamAnimation.length).toEqual(220);
                    expect(beam.beamAnimation.width).toEqual(2);
                }

                const turret = await novaParse.data.Weapon.get(SYNTHETIC.weapons.turret);
                expect(turret.type === "ProjectileWeaponData" && turret.guidance).toEqual("turret");
                expect(turret.exitType).toEqual("turret");

                const pd = await novaParse.data.Weapon.get(SYNTHETIC.weapons.pointDefense);
                expect(pd.fireGroup).toEqual("pointDefense");
                expect(pd.type === "ProjectileWeaponData" && pd.damageType).toEqual("pointDefense");

                const bay = await novaParse.data.Weapon.get(SYNTHETIC.weapons.skiffBay);
                expect(bay.type).toEqual("BayWeaponData");
                if (bay.type === "BayWeaponData") {
                    expect(bay.shipID).toEqual(SYNTHETIC.ships.skiff);
                }
                expect(bay.ammoType).toEqual(["weapon", SYNTHETIC.weapons.skiffBay]);
            });

        it("has purchasable outfits with pictures, descriptions and a cloak", async () => {
            for (const def of OUTFS) {
                const outfit = await novaParse.data.Outfit.get(sid(def.id));
                expect(outfit.name).toEqual(def.name);
                expect(outfit.desc).toEqual(def.desc);
                expect(outfit.price).toEqual(def.cost);
                expect(outfit.techLevel).toEqual(def.techLevel);
                expect(outfit.max).toEqual(def.max);
                expect(outfit.physics.freeMass).toEqual(def.mass);
                expect(outfit.pict).toEqual(sid(def.id - 128 + 6000));
                expect(outfit.buyRandom).toEqual(def.availableRandom);
            }
            const cloak = await novaParse.data.Outfit.get(SYNTHETIC.outfits.cloak);
            expect(cloak.cloak.isCloak).toBeTrue();
            expect(cloak.cloak.rawModVal).toEqual(CLOAK_MODVAL);
            expect(cloak.cloak.fuelPerSecond).toEqual(2);
            expect(cloak.cloak.hidesFromRadar).toBeTrue();
            const ammo = await novaParse.data.Outfit.get(SYNTHETIC.outfits.missileAmmo);
            expect(ammo.ammoFor).toEqual(SYNTHETIC.weapons.missile);
            const launcher = await novaParse.data.Outfit.get(SYNTHETIC.outfits.launcher);
            expect(launcher.weapons).toEqual({ [SYNTHETIC.weapons.missile]: 1 });
            const shield = await novaParse.data.Outfit.get(SYNTHETIC.outfits.shieldCapacitor);
            expect(shield.physics.shield).toEqual(50);
            const pod = await novaParse.data.Outfit.get(SYNTHETIC.outfits.cargoPod);
            expect(pod.physics.freeCargo).toEqual(10);
            const fighters = await novaParse.data.Outfit.get(SYNTHETIC.outfits.skiffFighter);
            expect(fighters.ammoFor).toEqual(SYNTHETIC.weapons.skiffBay);
        });

        it("has two governments with legal records and greetings", async () => {
            for (const def of GOVTS) {
                const govt = await novaParse.data.Govt.get(sid(def.id));
                expect(govt.name).toEqual(def.name);
                expect(govt.crimeTol).toEqual(def.crimeTol);
                expect(govt.killPenalty).toEqual(def.killPenalty);
                expect(govt.initialRecord).toEqual(def.initialRec);
                expect(govt.classes).toEqual(def.classes);
                expect(govt.enemies).toEqual(def.enemies);
                expect(govt.commGreetings).toEqual(def.greetings);
                expect(govt.statusBar).toEqual(SYNTHETIC.statusBar);
            }
            const raiders = await novaParse.data.Govt.get(SYNTHETIC.govts.raiders);
            expect(raiders.flags.xenophobic).toBeTrue();
            expect(raiders.flags.alwaysAttacksPlayer).toBeTrue();
            const meridian = await novaParse.data.Govt.get(SYNTHETIC.govts.meridian);
            expect(meridian.flags.attacksPlayerIfCriminal).toBeTrue();
            expect(meridian.flags.alwaysAttacksPlayer).toBeFalse();
        });

        it("has dude and fleet tables that resolve to the ships", async () => {
            for (const def of DUDES) {
                const dude = await novaParse.data.Dude.get(sid(def.id));
                expect(dude.aiType).toEqual(def.aiType);
                expect(dude.govt).toEqual(sid(def.govt));
                expect(dude.ships).toEqual(def.ships.map(s => ({ id: sid(s.id), weight: s.probability })));
            }
            const wing = await novaParse.data.Fleet.get(SYNTHETIC.fleets.raiderWing);
            expect(wing.leadShip).toEqual(SYNTHETIC.ships.corsair);
            expect(wing.escorts).toEqual([{ id: SYNTHETIC.ships.corsair, min: 1, max: 2 }]);
            expect(wing.govt).toEqual(SYNTHETIC.govts.raiders);
            expect(wing.linkSyst).toEqual({ type: "any" });
        });

        it("has a mission-computer job with a set string, a bar job and a bounty",
            async () => {
                const courier = await novaParse.data.Mission.get(SYNTHETIC.missions.courier);
                expect(courier.availStelId).toEqual(SYNTHETIC.planets.port);
                expect(courier.availLoc).toEqual(0);
                expect(courier.travelStelId).toEqual(SYNTHETIC.planets.moon);
                expect(courier.returnStel).toEqual(-4);
                expect(courier.cargoType).toEqual(0);
                expect(courier.cargoQty).toEqual(10);
                expect(courier.payVal).toEqual(5000);
                expect(courier.onAccept).toEqual(`b${BITS.courierAccepted}`);
                expect(courier.availBits).toEqual(MISNS[0].availBits);
                expect(courier.offerText).toEqual(MISNS[0].offerText);
                expect(courier.briefText).toEqual(MISNS[0].briefText);
                expect(courier.completionText).toEqual(MISNS[0].compText);
                expect(courier.quickBrief).toEqual(MISNS[0].quickBrief);
                expect(courier.compGovt).toEqual(128);
                expect(courier.canAbort).toBeTrue();

                const survey = await novaParse.data.Mission.get(SYNTHETIC.missions.gateSurvey);
                expect(survey.availLoc).toEqual(1);
                expect(survey.availStel).toEqual(-1);
                expect(survey.travelStelId).toEqual(SYNTHETIC.planets.kestrelGate);

                const bounty = await novaParse.data.Mission.get(SYNTHETIC.missions.bounty);
                expect(bounty.shipCount).toEqual(2);
                expect(bounty.shipSystId).toEqual(SYNTHETIC.systems.kestrel);
                expect(bounty.shipDudeId).toEqual(SYNTHETIC.dudes.raiders);
                expect(bounty.shipGoal).toEqual(0);
            });

        it("has ranks, a default pilot and the standard cargo names", async () => {
            const warrant = await novaParse.data.Rank.get(SYNTHETIC.ranks.warrant);
            expect(warrant.affilGovt).toEqual(SYNTHETIC.govts.meridian);
            expect(warrant.priceMod).toEqual(90);
            expect(warrant.rankFlags.canAlwaysLandOnGovtStellars).toBeTrue();
            expect(warrant.rankFlags.govtShipsWontAttack).toBeFalse();
            const confidant = await novaParse.data.Rank.get(SYNTHETIC.ranks.confidant);
            expect(confidant.rankFlags.govtShipsWontAttack).toBeTrue();

            const start = await novaParse.data.PlayerStart.get(SYNTHETIC.playerStart);
            expect(start.ship).toEqual(SYNTHETIC.ships.skiff);
            expect(start.systems).toEqual([SYNTHETIC.systems.thessaly]);
            expect(start.credits).toEqual(25000);
            expect(start.date).toEqual(CHARS[0].date);
            expect(start.introText).toEqual(CHARS[0].introText);
            expect(start.isDefault).toBeTrue();
            expect(start.cargoNames).toEqual(["Food", "Industrial", "Medical",
                "Luxury Goods", "Metal", "Equipment"]);
            expect(start.govtStatuses).toEqual([{ govt: SYNTHETIC.govts.meridian, status: 0 }]);

            const misc = await novaParse.data.StringTable.get(sid(STRN.misc));
            expect(misc.strings.length).toEqual(360);
            expect(misc.strings[358]).toEqual("Postings");
        });

        it("has persons bound to a system, to anywhere, and to a govt range, "
            + "with quotes, a hail-gated one and two mission carriers", async () => {
                for (const def of PERSONS) {
                    const person = await novaParse.data.Pers.get(sid(def.id));
                    expect(person.name).toEqual(def.name);
                    expect(person.subtitle).toEqual(def.subtitle);
                    expect(person.ship).toEqual(sid(def.ship));
                    expect(person.govt).toEqual(def.govt >= 128 ? sid(def.govt) : null);
                    expect(person.aiType).toEqual(def.aiType);
                    expect(person.activeOn).toEqual(def.activeOn);
                    expect(person.linkMission)
                        .toEqual(def.linkMission >= 128 ? sid(def.linkMission) : null);
                }
                const lask = await novaParse.data.Pers.get(SYNTHETIC.persons.lask);
                expect(lask.linkSyst).toEqual({ type: "system", id: SYNTHETIC.systems.kestrel });
                expect(lask.flags.keepsGrudge).toBeTrue();
                expect(lask.weapons).toEqual([{ id: SYNTHETIC.weapons.missile, count: 1, ammo: 4 }]);
                expect(lask.shieldMod).toEqual(130);
                expect(lask.commQuote).toEqual("You are in Verge water, courier. Turn around.");
                expect(lask.hailQuote).toEqual("<OSN>: The Night-Warden sees you.");
                const pell = await novaParse.data.Pers.get(SYNTHETIC.persons.pell);
                expect(pell.linkSyst).toEqual({ type: "any" });
                expect(pell.flags.hailOnlyWhenLikesPlayer).toBeTrue();
                const vey = await novaParse.data.Pers.get(SYNTHETIC.persons.vey);
                expect(vey.linkSyst)
                    .toEqual({ type: "notGovtSystems", govt: SYNTHETIC.govts.meridian });
                expect(vey.activeOn).toEqual(`!b${BITS.courierDone}`);
                const stranded = await novaParse.data.Pers.get(SYNTHETIC.persons.stranded);
                expect(stranded.flags.replaceWithSpecialShip).toBeTrue();
                expect(stranded.linkMission).toEqual(SYNTHETIC.missions.rescue);
                expect(stranded.hailQuote).toEqual("<OSN>: I need assistance, can you help?");
                const wreck = await novaParse.data.Pers.get(SYNTHETIC.persons.wreck);
                expect(wreck.flags.offerMissionOnBoarding).toBeTrue();
                expect(wreck.govt).toEqual(SYNTHETIC.govts.wrecks);

                // The sÿst Person lists: two in the starting system, an
                // empty one in Vael Hollow.
                const thessaly = await novaParse.data.System.get(SYNTHETIC.systems.thessaly);
                expect(thessaly.persons).toEqual([
                    { id: SYNTHETIC.persons.pell, chance: 30 },
                    { id: SYNTHETIC.persons.stranded, chance: 10 },
                ]);
                const vael = await novaParse.data.System.get(SYNTHETIC.systems.vael);
                expect(vael.persons).toEqual([]);
            });

        it("has two jünk commodities traded between the port and the refuge",
            async () => {
                const resin = await novaParse.data.Junk.get(SYNTHETIC.junk.resin);
                expect(resin.name).toEqual("Amber Resin");
                expect(resin.soldAt).toEqual([SYNTHETIC.planets.port]);
                expect(resin.boughtAt).toEqual([SYNTHETIC.planets.refuge]);
                expect(resin.basePrice).toEqual(800);
                expect(resin.decays).toBeFalse();
                expect(resin.abbrev).toEqual("Resin");
                const alloy = await novaParse.data.Junk.get(SYNTHETIC.junk.alloy);
                expect(alloy.soldAt).toEqual([SYNTHETIC.planets.refuge]);
                expect(alloy.boughtAt)
                    .toEqual([SYNTHETIC.planets.port, SYNTHETIC.planets.coldharbour]);
                expect(alloy.decays).toBeTrue();
                expect(alloy.buyOn).toEqual(`b${BITS.surveyAccepted}`);
                expect(alloy.lcName).toEqual("gate alloy");
            });

        it("has a link-less wormhole pair, a MinStatus-0 world, an unlandable "
            + "giant and a rock beside a gate", async () => {
                for (const id of [SYNTHETIC.planets.ossoryRift, SYNTHETIC.planets.vaelRift]) {
                    const rift = await novaParse.data.Planet.get(id);
                    expect(rift.gate).toEqual({
                        kind: "wormhole", destinations: [], emergenceAngle: null,
                    });
                    expect(rift.flags.canLand).toBeTrue();
                    expect(rift.flags.uninhabited).toBeTrue();
                }
                const ossory = await novaParse.data.System.get(SYNTHETIC.systems.ossory);
                expect(ossory.planets)
                    .toEqual([SYNTHETIC.planets.refuge, SYNTHETIC.planets.ossoryRift]);

                const cold = await novaParse.data.Planet.get(SYNTHETIC.planets.coldharbour);
                expect(cold.minStatus).toEqual(0);
                expect(cold.govt).toEqual(SYNTHETIC.govts.compact);
                expect(cold.flags).toEqual(jasmine.objectContaining({
                    canLand: true, isStation: false, uninhabited: false,
                    hasCommodityExchange: true, hasBar: true, hasOutfitter: false,
                }));
                expect(cold.barDesc).toContain("{G ");
                expect(cold.barDesc).toContain(`{b${BITS.surveyAccepted} `);
                const giant = await novaParse.data.Planet.get(SYNTHETIC.planets.giant);
                expect(giant.flags.canLand).toBeFalse();
                const thessaly = await novaParse.data.System.get(SYNTHETIC.systems.thessaly);
                // The port and the moon are still the first two stellars.
                expect(thessaly.planets.slice(0, 2))
                    .toEqual([SYNTHETIC.planets.port, SYNTHETIC.planets.moon]);
                expect(thessaly.planets.length).toEqual(4);
                const rock = await novaParse.data.Planet.get(SYNTHETIC.planets.kestrelRock);
                expect(rock.flags.canLand).toBeTrue();
                expect(rock.gate).toBeNull();
                const kestrel = await novaParse.data.System.get(SYNTHETIC.systems.kestrel);
                expect(kestrel.planets)
                    .toEqual([SYNTHETIC.planets.kestrelGate, SYNTHETIC.planets.kestrelRock]);
            });

        it("has an allied, bribable, strongly jamming govt and a derelict one",
            async () => {
                const compact = await novaParse.data.Govt.get(SYNTHETIC.govts.compact);
                expect(compact.allies).toEqual([1]);
                expect(compact.enemies).toEqual([]);
                expect(compact.flags.largerBribes).toBeTrue();
                expect(compact.flags.planetsTakeBribes).toBeTrue();
                expect(compact.inhJam).toEqual([50, 50, 35, 20]);
                const raiders = await novaParse.data.Govt.get(SYNTHETIC.govts.raiders);
                expect(raiders.inhJam).toEqual([7, 5, 0, 0]);
                const meridian = await novaParse.data.Govt.get(SYNTHETIC.govts.meridian);
                expect(meridian.inhJam).toEqual([0, 0, 0, 0]);
                expect(meridian.flags.largerBribes).toBeFalse();
                const wrecks = await novaParse.data.Govt.get(SYNTHETIC.govts.wrecks);
                expect(wrecks.flags.startsDisabled).toBeTrue();
                expect(wrecks.allies).toEqual([]);
                expect(wrecks.enemies).toEqual([]);
            });

        it("has the off-traffic hulls, the rule weapons and the flagged outfits",
            async () => {
                const ghost = await novaParse.data.Ship.get(SYNTHETIC.ships.ghost);
                expect(ghost.outfits[SYNTHETIC.outfits.veil]).toEqual(1);
                expect(ghost.outfits[SYNTHETIC.outfits.irBaffler]).toEqual(1);
                expect(ghost.outfits[SYNTHETIC.outfits.radarBaffler]).toEqual(1);
                expect(ghost.vulnerableTo).toEqual(["normal"]);
                expect(ghost.appearOn).toEqual(`b${BITS.surveyAccepted}`);
                const hulk = await novaParse.data.Ship.get(SYNTHETIC.ships.hulk);
                expect(hulk.physics.mass).toEqual(10000);
                expect(hulk.inherentAI).toEqual(2);
                expect(hulk.appearOn).toEqual(`!b${BITS.surveyAccepted}`);
                const mote = await novaParse.data.Ship.get(SYNTHETIC.ships.mote);
                expect(mote.physics.mass).toEqual(10);
                expect(mote.appearOn).toEqual("");
                // No system's traffic carries them.
                for (const def of SYSTS) {
                    const system = await novaParse.data.System.get(sid(def.id));
                    for (const { id } of system.dudes) {
                        const dude = await novaParse.data.Dude.get(id);
                        for (const ship of dude.ships) {
                            expect([SYNTHETIC.ships.ghost, SYNTHETIC.ships.hulk,
                                SYNTHETIC.ships.mote]).not.toContain(ship.id);
                        }
                    }
                }
                const variants = await novaParse.data.Dude.get(SYNTHETIC.dudes.variants);
                expect(variants.ships.map(s => s.id)).toEqual(
                    [SYNTHETIC.ships.ghost, SYNTHETIC.ships.hulk, SYNTHETIC.ships.mote]);

                const arc = await novaParse.data.Weapon.get(SYNTHETIC.weapons.arcTurret);
                expect(arc.type === "BeamWeaponData" && arc.guidance).toEqual("beamTurret");
                const needle = await novaParse.data.Weapon.get(SYNTHETIC.weapons.needleBeam);
                expect(needle.type === "BeamWeaponData" && needle.guidance).toEqual("beam");
                expect(needle.reload).toEqual(0);
                expect(needle.accuracy).toEqual(5);
                const wide = await novaParse.data.Weapon.get(SYNTHETIC.weapons.wideLance);
                // Fifteen frames against the needle's one, whatever the unit.
                if (needle.type === "BeamWeaponData" && wide.type === "BeamWeaponData") {
                    expect(wide.shotDuration).toBeCloseTo(needle.shotDuration * 15, 6);
                } else {
                    fail("the Needle Beam and the Wide Lance are beams");
                }
                const chaser = await novaParse.data.Weapon.get(SYNTHETIC.weapons.bowChaser);
                expect(chaser.type === "ProjectileWeaponData" && chaser.guidance)
                    .toEqual("frontQuadrant");
                const ghostBay = await novaParse.data.Weapon.get(SYNTHETIC.weapons.ghostBay);
                expect(ghostBay.type === "BayWeaponData" && ghostBay.shipID)
                    .toEqual(SYNTHETIC.ships.ghost);

                const veil = await novaParse.data.Outfit.get(SYNTHETIC.outfits.veil);
                expect(veil.cloak.rawModVal).toEqual(VEIL_MODVAL);
                expect(veil.cloak.hidesFromRadar).toBeFalse();
                expect(veil.cloak.shieldPerSecond).toEqual(4);
                expect(veil.cloak.deactivatesWhenHit).toBeTrue();
                const ir = await novaParse.data.Outfit.get(SYNTHETIC.outfits.irBaffler);
                expect(ir.jamming).toEqual([20, 0, 0, 0]);
                const radar = await novaParse.data.Outfit.get(SYNTHETIC.outfits.radarBaffler);
                expect(radar.jamming).toEqual([0, 15, 0, 0]);
                const seal = await novaParse.data.Outfit.get(SYNTHETIC.outfits.warrantSeal);
                expect(BigInt(seal.require)).toEqual(1n << BigInt(BITS.warrantHolder));
                expect(BigInt(seal.contribute)).toEqual(1n << 4n);
                expect(seal.hideUnlessRequirementsMet).toBeTrue();
                const charter = await novaParse.data.Outfit.get(SYNTHETIC.outfits.charter);
                expect(charter.persistent).toBeTrue();
                expect(charter.cantSell).toBeTrue();
                expect(charter.price).toEqual(0);
                const bonded = await novaParse.data.Outfit.get(SYNTHETIC.outfits.bondedCharter);
                expect(bonded.persistent).toBeTrue();
                expect(bonded.cantSell).toBeFalse();
                const refit = await novaParse.data.Outfit.get(SYNTHETIC.outfits.wardenRefit);
                expect(refit.removeAfterPurchase).toBeTrue();
                expect(refit.onPurchase).toEqual(`H${SHIPS[2].id}`);
                const voucher = await novaParse.data.Outfit.get(SYNTHETIC.outfits.dockVoucher);
                expect(voucher.buyRandom).toEqual(0);
            });

        it("has a ship-offered rescue, a boarding salvage, three venue jobs "
            + "and a revocable cover rank", async () => {
                const rescue = await novaParse.data.Mission.get(SYNTHETIC.missions.rescue);
                expect(rescue.availLoc).toEqual(AVAIL_LOC.fromShip);
                expect(rescue.shipGoal).toEqual(5);
                expect(rescue.flags.autoAbort).toBeTrue();
                expect(rescue.flags.remove100FuelOnAutoAbort).toBeTrue();
                expect(rescue.flags.applyPayOnAutoAbort).toBeTrue();
                expect(rescue.flags.invisible).toBeTrue();
                expect(rescue.payVal).toEqual(2000);
                const salvage = await novaParse.data.Mission.get(SYNTHETIC.missions.salvage);
                expect(salvage.availLoc).toEqual(AVAIL_LOC.fromShip);
                const errand = await novaParse.data.Mission.get(SYNTHETIC.missions.outfitterErrand);
                expect(errand.availLoc).toEqual(AVAIL_LOC.outfitter);
                expect(errand.availStelId).toEqual(SYNTHETIC.planets.port);
                expect(errand.cargoQty).toEqual(20);
                expect(errand.onRefuse).toEqual(`b${BITS.errandRefused}`);
                expect(errand.briefText).toEqual("");
                const yard = await novaParse.data.Mission.get(SYNTHETIC.missions.shipyardErrand);
                expect(yard.availLoc).toEqual(AVAIL_LOC.shipyard);
                expect(yard.briefText).toEqual("");
                expect(yard.timeLimit).toEqual(10);
                const trade = await novaParse.data.Mission.get(SYNTHETIC.missions.tradeErrand);
                expect(trade.availLoc).toEqual(AVAIL_LOC.tradeCenter);
                expect(trade.availRating).toEqual(10);
                expect(trade.availBits).toEqual(`b${BITS.tradeErrandOpen}`);
                const cover = await novaParse.data.Rank.get(SYNTHETIC.ranks.cover);
                expect(cover.affilGovt).toEqual(SYNTHETIC.govts.raiders);
                expect(cover.rankFlags.dropIfDestroyGovtOrAllyShip).toBeTrue();
                expect(cover.rankFlags.dropIfCrimeAgainstGovt).toBeTrue();
                expect(cover.rankFlags.govtShipsWontAttack).toBeTrue();
            });

        it("draws the landed-UI frames at the stock sizes", async () => {
            for (const [id, [width, height]] of Object.entries(DIALOG_PICT_SIZES)) {
                const png = PNG.sync.read(Buffer.from(
                    await novaParse.data.PictImage.get(sid(Number(id)))));
                expect([png.width, png.height]).withContext(id).toEqual([width, height]);
            }
            const button = PNG.sync.read(Buffer.from(await novaParse.data.PictImage.get(sid(7501))));
            expect([button.width, button.height]).toEqual([2, 25]);
        });

        it("decodes every sprite sheet at its drawn size and frame count, "
            + "the gate's non-square", async () => {
                for (const [rled, geometry] of Object.entries(SPRITE_GEOMETRY)) {
                    const id = sid(Number(rled));
                    const frames = await novaParse.data.SpriteSheetFrames.get(id);
                    const entries = Object.values(frames.frames);
                    expect(entries.length).withContext(id).toEqual(geometry.frames);
                    expect(entries[0].frame.w).withContext(id).toEqual(geometry.width);
                    expect(entries[0].frame.h).withContext(id).toEqual(geometry.height);
                    const png = PNG.sync.read(Buffer.from(
                        await novaParse.data.SpriteSheetImage.get(id)));
                    expect(png.width).toEqual(Math.min(10, geometry.frames) * geometry.width);
                    expect(png.height).toEqual(Math.ceil(geometry.frames / 10) * geometry.height);
                    const sheet = await novaParse.data.SpriteSheet.get(id);
                    expect(sheet.hulls.length).toEqual(geometry.frames);
                    // Every frame drew something: a traced hull with area.
                    for (const hull of sheet.hulls) {
                        expect(hull.length).toBeGreaterThan(0);
                        expect(hull[0].length).toBeGreaterThanOrEqual(3);
                    }
                }
                expect(SPRITE_GEOMETRY[RLED.gate]).toEqual({ width: 24, height: 32, frames: 1 });
            });

        it("decodes the pictures and icons the display asks for", async () => {
            const statusBar = await novaParse.data.StatusBar.get(SYNTHETIC.statusBar);
            expect(statusBar.image).toEqual(sid(700));
            const png = PNG.sync.read(Buffer.from(await novaParse.data.PictImage.get(sid(700))));
            expect([png.width, png.height]).toEqual([48, 160]);
            const shipPict = PNG.sync.read(Buffer.from(
                await novaParse.data.PictImage.get(sid(5000))));
            expect([shipPict.width, shipPict.height]).toEqual([48, 48]);
            // The placeholder's border pixel and fill pixel differ.
            const at = (x: number, y: number) =>
                [...shipPict.data.slice((y * shipPict.width + x) * 4, (y * shipPict.width + x) * 4 + 3)];
            expect(at(0, 0)).toEqual([0xf0, 0xf0, 0xf0]);
            expect(at(5, 20)).not.toEqual([0xf0, 0xf0, 0xf0]);
            for (const id of [8500, 8502, 8503, 8505, 8510, 8521, 8527, 9000, 7500, 10000]) {
                expect(ids.Pict).toContain(sid(id));
            }
            const mark = PNG.sync.read(Buffer.from(
                await novaParse.data.CicnImage.get(sid(15000))));
            expect([mark.width, mark.height]).toEqual([12, 12]);
            // Opaque in the middle, transparent at the corner.
            expect(mark.data[(6 * 12 + 6) * 4 + 3]).toEqual(255);
            expect(mark.data[3]).toEqual(0);
        });
    });
});

describe("the synthetic scenario's ids", () => {
    it("are the base-data prefix, so a stock-data spec can be re-pointed", () => {
        expect(SYNTHETIC.prefix).toEqual("nova");
        expect(SYNTHETIC.systems.thessaly).toEqual(`nova:${SYST.thessaly}`);
        expect(SYNTHETIC.playerStart).toEqual("nova:128");
    });
});
