import { ResourceSpec } from "resource_fork/write";
import { spriteSheets } from "./art.js";
import { ByteWriter } from "./byte_writer.js";
import { encodeCicn } from "./cicn.js";
import { encodePict, IndexedImage, placeholderImage } from "./pict.js";
import { encodeRled } from "./rled.js";
import {
    barDesc, BOOM, buttonPictSize, CharDef, CHARS, CICN, DIALOG_PICT_SIZES,
    DudeDef, DUDES, FletDef, FLETS, GovtDef, GOVTS, INTF, JunkDef, JUNKS,
    landscapePict, missionBriefDesc, missionOfferDesc, MisnDef, MISNS,
    OutfDef, outfitDesc, outfitPict, OUTFS, PersDef, PERSONS, PICT,
    pilotDesc, RankDef, RANKS, RLED, ROID, ShanDef, ShipDef, shipDesc,
    shipPict, SHIPS, SPIN, SpobDef, SPOBS, STRING_TABLES, SystDef, SYSTS,
    WeapDef, WEAPS,
} from "./universe.js";

/**
 * Turns the universe description into resource bytes. Each writer emits
 * the fields in the order the matching resource parser reads them (see
 * resource_parsers/*.ts, whose field-by-field layout notes are the
 * template) and then pads to the TMPL's total size from
 * docs/tmpl/tmpl_offsets.txt, so a resource is never shorter than the
 * game's own.
 */

const NONE = -1;

function govt(def: GovtDef): number[] {
    return new ByteWriter()
        .int16(-1) // VoiceType: no speech.
        .uint16(def.flags).uint16(def.flags2)
        .int16(def.scanFine).int16(def.crimeTol).int16(def.smugPenalty)
        .int16(def.disabPenalty).int16(def.boardPenalty).int16(def.killPenalty)
        .int16(def.shootPenalty).int16(def.initialRec).int16(def.maxOdds)
        .int16s(4, def.classes, NONE).int16s(4, def.allies, NONE).int16s(4, def.enemies, NONE)
        .int16(def.skillMult).uint16(def.scanMask)
        .string(def.commName, 16).string(def.targetCode, 16)
        .uint64(0n) // Require
        .int16s(4, def.inhJam, 0) // InhJam
        .string(def.mediumName, 64)
        .uint32(def.color).uint32(def.shipColor)
        .int16(def.interface).int16(NONE) // NewsPic
        .padTo(192).toArray();
}

function syst(def: SystDef): number[] {
    return new ByteWriter()
        .int16(def.position[0]).int16(def.position[1])
        .int16s(16, def.links, NONE)
        .int16s(16, def.spobs, NONE)
        .int16s(8, def.dudes.map(d => d.id), NONE)
        .int16s(8, def.dudes.map(d => d.chance), 0)
        .int16(def.avgShips).int16(def.govt)
        .int16(NONE) // Message buoy.
        .int16(def.asteroids).int16(def.interference)
        .int16s(8, def.persons.map(p => p.id), NONE)
        .int16s(8, def.persons.map(p => p.chance), 0)
        .uint32(def.backgroundColor).int16(def.murk).uint16(def.asteroidTypes)
        .string("", 256) // Visibility: always.
        .int16(NONE).int16(0).int16(0) // Reinforcements.
        .padTo(428).toArray();
}

function spob(def: SpobDef): number[] {
    return new ByteWriter()
        .int16(def.position[0]).int16(def.position[1])
        .int16(def.type)
        .uint32(def.flags)
        .int16(0) // Tribute: default.
        .int16(def.techLevel)
        .int16s(3, def.specialTech.slice(0, 3), NONE)
        .int16(def.govt).int16(def.minStatus)
        .int16(NONE) // CustPicID: the standard landscape.
        .int16(def.ambientSound)
        .int16(NONE).int16(0) // Defence dude, count.
        .uint16(def.flags2)
        .int16(0).int16(0) // Animation delay, frame-0 bias.
        .int16s(8, def.hyperlinks, NONE)
        .string("", 255).string("", 255) // OnDominate, OnRelease.
        .int32(def.landingFee)
        .int16(0) // Gravity.
        .int16(NONE) // Weapon.
        .int32(0) // Strength: invulnerable.
        .int16(NONE).int16(0) // DeadType, DeadTime.
        .int16(NONE) // Explosion.
        .string("", 255).string("", 255) // OnDestroy, OnRegen.
        .int16s(5, def.specialTech.slice(3), NONE)
        .padTo(1118).toArray();
}

function weap(def: WeapDef): number[] {
    const beam = def.beam;
    return new ByteWriter()
        .int16(def.reload).int16(def.duration)
        .int16(def.armorDamage).int16(def.shieldDamage)
        .int16(def.guidance).int16(def.speed).int16(def.ammoType)
        .int16(def.graphic).int16(def.accuracy)
        .int16(NONE) // Sound.
        .int16(def.impact).int16(def.explosion)
        .int16(def.proxRadius).int16(def.blastRadius)
        .uint16(def.flags)
        .int16(0) // Seeker flags.
        .int16(NONE) // Smoke set.
        .int16(0) // Decay.
        .int16(0).int16(0).int16(0).int16(0).uint32(0) // Trail particles.
        .int16(beam?.length ?? 0).int16(beam?.width ?? 0)
        .int16(beam?.falloff ?? 0)
        .uint32(beam?.color ?? 0).uint32(beam?.coronaColor ?? 0)
        .int16(0).int16(NONE).int16(0).int16(0) // Submunition.
        .int16(0) // ProxSafety.
        .uint16(0) // Flags2.
        .int16(0) // Ionization.
        .int16(0).int16(0).int16(0).uint32(0) // Hit particles.
        .int16(0) // Recoil.
        .int16(def.exitType)
        .int16(0).int16(0) // Burst count, reload.
        .int16s(4, [], 0) // Jam vulnerabilities.
        .uint16(0) // Flags3.
        .int16(def.durability).int16(def.turnRate)
        .int16(def.maxAmmo)
        .int16(0).int16(0) // Lightning density, amplitude.
        .uint32(0) // Ionize colour.
        .expect(118).padTo(134).toArray();
}

function outf(def: OutfDef): number[] {
    const [primary, ...secondary] = def.mods;
    const w = new ByteWriter()
        .int16(def.displayWeight).int16(def.mass).int16(def.techLevel)
        .int16(primary[0]).int16(primary[1])
        .int16(def.max).uint16(def.flags).int32(def.cost);
    for (let i = 0; i < 3; i++) {
        const mod = secondary[i];
        w.int16(mod ? mod[0] : 0).int16(mod ? mod[1] : 0);
    }
    return w.uint64(def.contribute ?? 0n).uint64(def.require ?? 0n) // Contribute, Require.
        .string(def.availability ?? "", 255).string(def.onPurchase ?? "", 255)
        .string("", 255) // OnSell.
        .string(def.name, 64).string(def.lcName, 64).string(def.lcPlural, 65)
        .int16(0) // Item class.
        .uint16(0) // Scan mask.
        .int16(def.availableRandom)
        .int16(NONE) // Require bits apply to: every outfitter.
        .padTo(1028).toArray();
}

function ship(def: ShipDef): number[] {
    const weapons = (from: number) => def.weapons.slice(from, from + 4);
    const outfits = (from: number) => def.outfits.slice(from, from + 4);
    return new ByteWriter()
        .int16(def.cargoSpace).int16(def.shield).int16(def.acceleration)
        .int16(def.speed).int16(def.turnRate).int16(def.energy)
        .int16(def.freeSpace).int16(def.armor).int16(def.shieldRecharge)
        .int16s(4, weapons(0).map(w => w.id), NONE)
        .int16s(4, weapons(0).map(w => w.count), 0)
        .int16s(4, weapons(0).map(w => w.ammo), 0)
        .int16(def.maxGuns).int16(def.maxTurrets).int16(def.techLevel)
        .int32(def.cost).int16(def.deathDelay).int16(def.armorRecharge)
        .int16(def.initialExplosion).int16(def.finalExplosion)
        .int16(def.displayOrder).int16(def.mass).int16(def.length)
        .int16(def.inherentAI).int16(def.crew).int16(def.strength)
        .int16(def.inherentGovt).uint16(def.flags)
        .int16(0) // Escape pods.
        .int16s(4, outfits(0).map(o => o.id), NONE)
        .int16s(4, outfits(0).map(o => o.count), 0)
        .int16(def.energyRecharge).int16(def.skillVariation).uint16(def.flags2)
        .uint64(0n) // Contribute.
        .string("", 255).string(def.appearOn ?? "", 255).string("", 256) // Availability, AppearOn, OnPurchase.
        .int16(def.deionize).int16(def.ionization)
        .int16(NONE) // Key carried.
        .int16s(4, outfits(4).map(o => o.id), NONE)
        .int16s(4, outfits(4).map(o => o.count), 0)
        .uint64(0n) // Require.
        .int16(def.buyRandom).int16(def.hireRandom)
        .zeros(0x44)
        .string("", 255).string("", 255) // OnCapture, OnRetire.
        .string(def.shortName, 64).string(def.commName, 32)
        .string(def.longName, 128).string("", 32) // Movie file.
        .int16s(4, weapons(4).map(w => w.id), NONE)
        .int16s(4, weapons(4).map(w => w.count), 0)
        .int16s(4, weapons(4).map(w => w.ammo), 0)
        .string(def.subtitle, 64)
        .uint16(0) // Flags3.
        .int16(NONE).int32(0).int32(0) // Escort upgrade ship, cost, sell value.
        .int16(def.escortType)
        .expect(1844).padTo(1860).toArray();
}

function shan(def: ShanDef): number[] {
    const w = new ByteWriter();
    const image = (id: number, setCount: boolean) => {
        w.int16(id).int16(NONE); // Sprite, mask.
        if (setCount) {
            w.int16(id === NONE ? 0 : 1);
        }
        w.int16(id === NONE ? 0 : def.size).int16(id === NONE ? 0 : def.size);
    };
    image(def.baseImage, true);
    w.int16(0); // Base transparency.
    image(NONE, true); // Alt image.
    image(def.glowImage, false);
    image(NONE, false); // Running lights.
    image(NONE, false); // Weapon flash.
    w.uint16(0) // Flags.
        .int16(0).int16(0) // AnimDelay, WeapDecay.
        .int16(def.framesPer)
        .int16(NONE).int16s(4, [], 0); // Blink mode and values.
    image(NONE, false); // Shield.
    const exitTypes = [def.gun, def.turret, def.guided, def.beam];
    for (const points of exitTypes) {
        w.int16s(4, points.map(p => p[0]), 0).int16s(4, points.map(p => p[1]), 0);
    }
    w.int16(100).int16(100).int16(100).int16(100); // Up/down compress.
    for (let i = 0; i < exitTypes.length; i++) {
        w.int16s(4, [], 0); // z.
    }
    return w.expect(176).padTo(192).toArray();
}

function dude(def: DudeDef): number[] {
    return new ByteWriter()
        .int16(def.aiType).int16(def.govt).uint16(def.flags)
        .uint16(0) // InfoTypes.
        .int16s(16, def.ships.map(s => s.id), NONE)
        .int16s(16, def.ships.map(s => s.probability), 0)
        .padTo(88).toArray();
}

function flet(def: FletDef): number[] {
    return new ByteWriter()
        .int16(def.leadShip)
        .int16s(4, def.escorts.map(e => e.id), NONE)
        .int16s(4, def.escorts.map(e => e.min), 0)
        .int16s(4, def.escorts.map(e => e.max), 0)
        .int16(def.govt).int16(def.linkSyst)
        .string("", 256) // AppearOn.
        .int16(NONE) // Quote.
        .uint16(0) // Flags.
        .padTo(306).toArray();
}

function misn(def: MisnDef): number[] {
    const briefs = missionBriefDesc(def.id);
    return new ByteWriter()
        .int16(def.availStel).zeros(2).int16(def.availLoc)
        .int16(def.availRecord).int16(def.availRating).int16(def.availRandom)
        .int16(def.travelStel).int16(def.returnStel)
        .int16(def.cargoType).int16(def.cargoQty)
        .int16(def.pickupMode).int16(def.dropoffMode)
        .uint16(0).zeros(2) // Scan mask, unused.
        .int32(def.payVal)
        .int16(def.shipCount).int16(def.shipSyst).int16(def.shipDude)
        .int16(def.shipGoal).int16(def.shipBehav)
        .int16(NONE) // Ship names STR#.
        .int16(def.shipStart).int16(def.compGovt).int16(def.compReward)
        .int16(NONE) // Ship subtitle STR#.
        .int16(briefs) // BriefText.
        .int16(briefs + 2) // QuickBrief.
        .int16(NONE).int16(NONE) // Load/dump cargo text.
        .int16(briefs + 1) // CompText.
        .int16(NONE) // FailText.
        .int16(def.timeLimit).uint16(def.canAbort)
        .int16(NONE) // ShipDoneText.
        .zeros(2)
        .int16(NONE).int16(NONE).int16(NONE) // Aux ships.
        .zeros(2)
        .uint16(def.flags).uint16(def.flags2 ?? 0)
        .zeros(4)
        .int16(NONE) // RefuseText.
        .int16(NONE) // AvailShipType.
        .string(def.availBits, 255).string(def.onAccept, 255)
        .string(def.onRefuse ?? "", 255)
        .string(def.onSuccess, 255).string(def.onFailure, 255)
        .string(def.onAbort, 255)
        .uint64(0n) // Require.
        .int16(0) // DatePostInc.
        .string("", 255) // OnShipDone.
        .string("", 32).string("", 33) // Accept/refuse button captions.
        .int16(def.dispWeight)
        .expect(1954).padTo(1970).toArray();
}

function rank(def: RankDef): number[] {
    return new ByteWriter()
        .int16(def.weight).int16(def.affilGovt).int16(def.priceMod)
        .int32(def.salary).int32(def.salaryCap)
        .uint64(0n) // Contribute.
        .uint16(def.flags)
        .string(def.convName, 64).string(def.convShortName, 64)
        .expect(152).toArray();
}

function char(def: CharDef): number[] {
    return new ByteWriter()
        .int32(def.startingCredits).int16(def.startingShip)
        .int16s(4, def.startingSystems, NONE)
        .int16s(4, def.govtStatuses.map(g => g.govt), NONE)
        .int16s(4, def.govtStatuses.map(g => g.status), 0)
        .int16(def.combatRating)
        .int16s(4, [], NONE).int16s(4, [], 0) // Intro pictures, delays.
        .int16(def.introDesc)
        .string("", 256) // OnStart.
        .uint16(0x0001) // Flags: the default pilot.
        .int16(def.date.day).int16(def.date.month).int16(def.date.year)
        .string("", 16).string("", 16) // Date prefix, suffix.
        .zeros(16)
        .expect(362).toArray();
}

/** A përs (ResForge's 400-byte template, EVN Bible pp. 47-49). */
function pers(def: PersDef): number[] {
    const weapons = def.weapons.slice(0, 4);
    return new ByteWriter()
        .int16(def.linkSystem).int16(def.govt)
        .int16(def.aiType).int16(def.aggression).int16(def.cowardice)
        .int16(def.ship)
        .int16s(4, weapons.map(w => w.id), NONE)
        .int16s(4, weapons.map(w => w.count), 0)
        .int16s(4, weapons.map(w => w.ammo), 0)
        .int32(def.credits).int16(def.shieldMod)
        .int16(NONE) // HailPict: the ship's own picture.
        .int16(def.commQuote).int16(def.hailQuote)
        .int16(def.linkMission)
        .uint16(def.flags)
        .string(def.activeOn, 256)
        .int16(def.grantClass).int16(def.grantCount).int16(def.grantChance)
        .string(def.subtitle, 64)
        .uint32(def.color)
        .uint16(0) // Flags2: starts fuelled.
        .expect(384).padTo(400).toArray();
}

/** A jünk (676 bytes, EVN Bible p. 31). */
function junk(def: JunkDef): number[] {
    return new ByteWriter()
        .int16s(8, def.soldAt, NONE).int16s(8, def.boughtAt, NONE)
        .int16(def.basePrice).uint16(def.flags).uint16(def.scanMask)
        .string(def.lcName, 64).string(def.abbrev, 64)
        .string(def.buyOn, 255).string(def.sellOn, 255)
        .expect(676).toArray();
}

/** A dësc: the text, then its PICT, movie name and flags. */
function desc(text: string, graphic = NONE): number[] {
    return new ByteWriter().cstring(text).int16(graphic).string("", 32)
        .uint16(0).toArray();
}

function strn(strings: string[]): number[] {
    const w = new ByteWriter().uint16(strings.length);
    for (const s of strings) {
        w.pstring(s);
    }
    return w.toArray();
}

function boom(): number[] {
    return new ByteWriter()
        .int16(100) // Animation rate: 30 frames a second.
        .int16(NONE) // Sound.
        .int16(BOOM.burst - 128) // Graphic: spïn 400 + n.
        .expect(6).toArray();
}

function spin(spriteId: number, width: number, height: number, frames: number): number[] {
    return new ByteWriter()
        .int16(spriteId).int16(NONE) // Sprite, mask.
        .int16(width).int16(height)
        .int16(Math.min(frames, 10)).int16(Math.ceil(frames / 10)) // Tiles.
        .expect(12).toArray();
}

function roid(): number[] {
    return new ByteWriter()
        .int16(60) // Strength.
        .int16(50) // Spin rate.
        .int16(NONE) // Yield: nothing.
        .int16(0) // Yield quantity.
        .int16(6).uint32(0x00806040) // Particles.
        .int16(NONE).int16(NONE) // Fragment types.
        .int16(0) // Fragment count.
        .int16(NONE) // Explosion.
        .int16(40) // Mass.
        .padTo(40).toArray();
}

function intf(): number[] {
    const w = new ByteWriter().uint32(0x00ffffff).uint32(0x00888888);
    const rect = (top: number, left: number, bottom: number, right: number) =>
        w.int16(top).int16(left).int16(bottom).int16(right);
    rect(8, 8, 184, 184); // Radar.
    w.uint32(0x00ffffff).uint32(0x00888888);
    rect(200, 8, 212, 184); // Shield.
    w.uint32(0x0040a0ff);
    rect(216, 8, 228, 184); // Armour.
    w.uint32(0x00a0a080);
    rect(232, 8, 244, 184); // Fuel.
    w.uint32(0x0060c040).uint32(0x00305020);
    rect(256, 8, 300, 184); // Navigation.
    rect(304, 8, 360, 184); // Weapons.
    rect(364, 8, 470, 184); // Target.
    rect(474, 8, 520, 184); // Cargo.
    w.string("Geneva", 64).int16(12).int16(10).int16(PICT.statusBar);
    return w.expect(166).toArray();
}

/** Status bar / landscape / ship / outfit / dialog PICTs: sizes and colours. */
function pictImage(id: number, width: number, height: number): IndexedImage {
    // A colour per id, so pictures differ; deterministic in the id.
    const hue = (id * 2654435761) >>> 0;
    const fill = ((hue >>> 8) & 0x7f7f7f) | 0x202020;
    const border = 0xf0f0f0;
    return placeholderImage(width, height, fill, border);
}

function cicnImage(id: number): { image: IndexedImage, mask: boolean[] } {
    // A 12x12 diamond mark; the viewed mark hollow, the active one solid.
    const size = 12;
    const indices: number[] = [];
    const mask: boolean[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const distance = Math.abs(2 * x + 1 - size) + Math.abs(2 * y + 1 - size);
            const inside = distance <= size;
            const hollow = id === CICN.missionMarkViewed && distance <= size - 6;
            mask.push(inside && !hollow);
            indices.push(inside ? 1 : 0);
        }
    }
    return {
        image: { width: size, height: size, palette: [0x000000, 0xffc020], indices },
        mask,
    };
}

/**
 * Every resource of the synthetic scenario, in a fixed order. The order
 * decides the byte layout of the resource fork (write.ts keeps input
 * order), so it is part of what makes generation reproducible.
 */
export function buildSyntheticResources(): ResourceSpec[] {
    const out: ResourceSpec[] = [];
    const add = (type: string, id: number, name: string, data: number[]) =>
        out.push({ type, id, name, data });

    for (const def of GOVTS) add("gövt", def.id, def.name, govt(def));
    for (const def of SYSTS) add("sÿst", def.id, def.name, syst(def));
    for (const def of SPOBS) {
        add("spöb", def.id, def.name, spob(def));
        add("dësc", def.id, `${def.name} landing`, desc(def.landingDesc));
        if (def.barDesc !== undefined) {
            add("dësc", barDesc(def.id), `${def.name} bar`,
                desc(def.barDesc, PICT.barScene));
        }
    }
    for (const def of WEAPS) add("wëap", def.id, def.name, weap(def));
    for (const def of OUTFS) {
        add("oütf", def.id, def.name, outf(def));
        add("dësc", outfitDesc(def.id), def.name, desc(def.desc));
    }
    for (const def of SHIPS) {
        add("shïp", def.id, def.name, ship(def));
        add("shän", def.id, def.name, shan(def.animation));
        add("dësc", shipDesc(def.id), def.name, desc(def.desc, def.infoPict));
        add("dësc", pilotDesc(def.id), `${def.name} pilot`, desc(def.pilotDesc));
    }
    for (const def of DUDES) add("düde", def.id, def.name, dude(def));
    for (const def of FLETS) add("flët", def.id, def.name, flet(def));
    for (const def of MISNS) {
        add("mïsn", def.id, def.name, misn(def));
        add("dësc", missionOfferDesc(def.id), `${def.name} offer`, desc(def.offerText));
        const briefs = missionBriefDesc(def.id);
        add("dësc", briefs, `${def.name} briefing`, desc(def.briefText));
        add("dësc", briefs + 1, `${def.name} completion`, desc(def.compText));
        add("dësc", briefs + 2, `${def.name} quick brief`, desc(def.quickBrief));
    }
    for (const def of RANKS) add("ränk", def.id, def.name, rank(def));
    for (const def of CHARS) {
        add("chär", def.id, def.name, char(def));
        add("dësc", def.introDesc, `${def.name} intro`, desc(def.introText));
    }
    for (const def of PERSONS) add("përs", def.id, def.name, pers(def));
    for (const def of JUNKS) add("jünk", def.id, def.name, junk(def));
    for (const table of STRING_TABLES) add("STR#", table.id, table.name, strn(table.strings));

    add("bööm", BOOM.burst, "Burst", boom());
    add("röid", ROID.shoal, "Shoal rock", roid());
    add("ïntf", INTF.standard, "Standard", intf());

    const sheets = spriteSheets();
    const sheetGeometry = (rled: number) => {
        const frames = sheets.get(rled)!;
        return { width: frames[0].width, height: frames[0].height, frames: frames.length };
    };
    const spins: Array<[spin: number, rled: number, name: string]> = [
        [SPIN.burst, RLED.burst, "Burst"],
        [SPIN.shoal, RLED.shoal, "Shoal rock"],
        [SPIN.planet, RLED.planet, "Planet"],
        [SPIN.moon, RLED.moon, "Moon"],
        [SPIN.gate, RLED.gate, "Gate"],
        [SPIN.station, RLED.station, "Station"],
        [SPIN.bolt, RLED.bolt, "Bolt"],
        [SPIN.missile, RLED.missile, "Missile"],
    ];
    for (const [spinId, rledId, name] of spins) {
        const g = sheetGeometry(rledId);
        add("spïn", spinId, name, spin(rledId, g.width, g.height, g.frames));
    }
    const sheetNames: { [rled: number]: string } = {
        [RLED.skiff]: "Wren Skiff", [RLED.corsair]: "Gannet Corsair",
        [RLED.corsairGlow]: "Gannet Corsair glow", [RLED.warden]: "Heron Warden",
        [RLED.planet]: "Planet", [RLED.moon]: "Moon", [RLED.gate]: "Gate",
        [RLED.station]: "Station", [RLED.bolt]: "Bolt", [RLED.missile]: "Missile",
        [RLED.burst]: "Burst", [RLED.shoal]: "Shoal rock",
    };
    for (const rledId of [...sheets.keys()].sort((a, b) => a - b)) {
        add("rlëD", rledId, sheetNames[rledId], encodeRled(sheets.get(rledId)!));
    }

    const picts: Array<[id: number, name: string, width: number, height: number]> = [
        [PICT.statusBar, "Status bar", 48, 160],
        [PICT.shipInfo, "Wren Skiff info", 120, 80],
        [PICT.barScene, "The Ferrule", 80, 60],
        [PICT.news, "News", 64, 48],
        ...SHIPS.map((s): [number, string, number, number] =>
            [shipPict(s.id), s.name, 48, 48]),
        ...SHIPS.map((s): [number, string, number, number] =>
            [PICT.hudTarget(s.id), `${s.name} target`, 32, 16]),
        ...OUTFS.map((o): [number, string, number, number] =>
            [outfitPict(o.id), o.name, 32, 32]),
        ...[...new Set(SPOBS.map(s => s.type))].map((type): [number, string, number, number] =>
            [landscapePict(type), `Landscape ${type}`, 96, 64]),
        ...PICT.buttons.map((id, i): [number, string, number, number] =>
            [id, `Button ${i}`, ...buttonPictSize(i)]),
        ...PICT.dialogs.map((id, i): [number, string, number, number] =>
            [id, `Dialog ${i}`, ...(DIALOG_PICT_SIZES[id] ?? [64, 48])]),
    ];
    for (const [id, name, width, height] of picts.sort((a, b) => a[0] - b[0])) {
        add("PICT", id, name, encodePict(pictImage(id, width, height)));
    }

    for (const [id, name] of [[CICN.missionMarkActive, "Mission mark"],
        [CICN.missionMarkViewed, "Mission mark viewed"]] as const) {
        const { image, mask } = cicnImage(id);
        add("cicn", id, name, encodeCicn(image, mask));
    }
    return out;
}
