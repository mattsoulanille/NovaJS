import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Position } from 'nova_ecs/datatypes/position';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { styleForTarget } from '../combat/index.js';
import { GovtComponent, SimulationGameDataResource, SystemIdResource } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { attacksOnSight, NpcComponent } from '../npc/index.js';
import { ControlledByComponent } from '../player/index.js';
import { completeEntity } from '../spawn/index.js';
import { makeShip, ShipDataComponent, TargetComponent } from '../ship/index.js';
import { shipDisposition } from './iff_plugin.js';
import {
    criminalHere, enforcesHere, LocalLaw, localLaw, localLawIn,
} from './local_law.js';
import { LegalRecordsComponent } from './reputation_plugin.js';

/**
 * ============================================================================
 * Reference A14: which legal record makes a ship attack the player
 * ============================================================================
 *
 * docs/reference_experiments.md, "A14" (wave 2) and "A14 wave 5", re-run as
 * NovaJS specs (rulings #376 and #380). The kit's governments and systems are
 * reproduced exactly (scripts/novaref/kits/testkit.mjs a14Resources and the
 * wave-5 one-way-alliance govts): every govt has CrimeTol 10 and MaxOdds
 * 1000 unless named "Hi"; the player sits with a -500 record ("Criminal")
 * in ONE system and never fires; each system spawns warships (AI 3) or
 * interceptors (AI 4) of ONE government.
 *
 * Records are per SYSTEM, in the original and (since ruling #380) in
 * NovaJS, so "-500 in system S" is the record keyed by S's sÿst id, and all
 * 21 cells match the original, c2 included: a criminal in one of the
 * owner's systems is NOT a criminal in its others. (Under #376's per-govt
 * records c2 was the one cell NovaJS got wrong.)
 */

const OWNER = 'nova:370';
const ALLY = 'nova:371';
const UNREL = 'nova:372';
const NOSY = 'nova:373';
const ALLY_HI = 'nova:374';
const NOSY_HI = 'nova:375';
const OWNER_HI = 'nova:376';
const ALLY_LO = 'nova:377';
const G_TO_O = 'nova:365';
const O_TO_G = 'nova:366';
const OWNER2 = 'nova:367';

function govt(id: string, over: Partial<GovtData>): GovtData {
    const data = { ...getDefaultGovtData(), id, maxOdds: 1000, crimeTol: 10,
        ...over };
    data.flags = { ...getDefaultGovtData().flags, ...over.flags };
    return data;
}

const NOSY_FLAGS = { ...getDefaultGovtData().flags,
    attacksPlayerIfCriminal: true }; // gövt Flags 0x0002

/** a14Resources() and wave 5's govt(365..367), field for field. */
const GOVTS: readonly GovtData[] = [
    govt(OWNER, { classes: [70], allies: [71] }),
    govt(ALLY, { classes: [71], allies: [70] }),
    govt(UNREL, { classes: [72] }),
    govt(NOSY, { classes: [75], flags: NOSY_FLAGS }),
    govt(ALLY_HI, { classes: [71], allies: [70], crimeTol: 10000 }),
    govt(NOSY_HI, { classes: [76], flags: NOSY_FLAGS, crimeTol: 10000 }),
    govt(OWNER_HI, { classes: [73], allies: [74], crimeTol: 10000 }),
    govt(ALLY_LO, { classes: [74], allies: [73] }),
    // Wave 5's one-way alliances: GtoO lists the Owner's class, the Owner
    // does not list GtoO's; Owner2 lists OtoG's class, OtoG lists nobody.
    govt(G_TO_O, { classes: [77], allies: [70] }),
    govt(O_TO_G, { classes: [78] }),
    govt(OWNER2, { classes: [79], allies: [78] }),
];
const GOVT_BY_ID = new Map(GOVTS.map(g => [g.id, g] as const));

/** The kit's sÿsts: id -> owner (null: independent). */
const SYSTEMS: { readonly [id: string]: string | null } = {
    'nova:2110': OWNER, // A14 Own
    'nova:2111': OWNER, // A14 Own2 (another Owner system, no ships)
    'nova:2112': OWNER, // A14 Ally
    'nova:2113': OWNER, // A14 Unrel
    'nova:2114': OWNER, // A14 Nosy
    'nova:2115': OWNER, // A14 AllyHi
    'nova:2116': OWNER, // A14 NosyHi
    'nova:2117': null, // A14 IndepUnrel
    'nova:2118': null, // A14 IndepNosy
    'nova:2119': OWNER_HI, // A14 HiOwnAllyLo
    'nova:2120': OWNER_HI, // A14 HiOwnSelf
    'nova:2121': ALLY, // A14 AllyHome
    'nova:2122': UNREL, // A14 UnrelHome
    'nova:2123': NOSY, // A14 NosyHome
    'nova:2126': OWNER, // A14 UnrelIcpt
    'nova:2127': OWNER, // A14 NosyIcpt
    'nova:2002': OWNER, // A14 GtoO (wave 5)
    'nova:2003': OWNER2, // A14 OtoG (wave 5)
};

interface Cell {
    cell: string;
    /** Where the player is, and whose ships are there. */
    system: string;
    shipGovt: string;
    aiType: 3 | 4;
    /** The system holding the player's -500 record; null: nowhere. */
    criminalIn: string | null;
    /** What the original did (docs/reference_experiments.md). */
    originalAttacked: boolean;
}

const CELLS: readonly Cell[] = [
    { cell: 'c0', system: 'nova:2110', shipGovt: OWNER, aiType: 3,
        criminalIn: null, originalAttacked: false },
    { cell: 'c1', system: 'nova:2110', shipGovt: OWNER, aiType: 3,
        criminalIn: 'nova:2110', originalAttacked: true },
    { cell: 'c2', system: 'nova:2110', shipGovt: OWNER, aiType: 3,
        criminalIn: 'nova:2111', originalAttacked: false },
    { cell: 'c3', system: 'nova:2112', shipGovt: ALLY, aiType: 3,
        criminalIn: 'nova:2112', originalAttacked: true },
    { cell: 'c14', system: 'nova:2112', shipGovt: ALLY, aiType: 3,
        criminalIn: 'nova:2121', originalAttacked: false },
    { cell: 'c4', system: 'nova:2113', shipGovt: UNREL, aiType: 3,
        criminalIn: 'nova:2113', originalAttacked: false },
    { cell: 'c5', system: 'nova:2113', shipGovt: UNREL, aiType: 3,
        criminalIn: 'nova:2122', originalAttacked: false },
    { cell: 'c15', system: 'nova:2126', shipGovt: UNREL, aiType: 4,
        criminalIn: 'nova:2126', originalAttacked: false },
    { cell: 'c16', system: 'nova:2126', shipGovt: UNREL, aiType: 4,
        criminalIn: 'nova:2122', originalAttacked: false },
    { cell: 'c6', system: 'nova:2114', shipGovt: NOSY, aiType: 3,
        criminalIn: 'nova:2114', originalAttacked: true },
    { cell: 'c7', system: 'nova:2114', shipGovt: NOSY, aiType: 3,
        criminalIn: 'nova:2123', originalAttacked: false },
    { cell: 'c18', system: 'nova:2127', shipGovt: NOSY, aiType: 4,
        criminalIn: 'nova:2127', originalAttacked: true },
    { cell: 'c17', system: 'nova:2127', shipGovt: NOSY, aiType: 4,
        criminalIn: 'nova:2123', originalAttacked: false },
    { cell: 'c8', system: 'nova:2115', shipGovt: ALLY_HI, aiType: 3,
        criminalIn: 'nova:2115', originalAttacked: false },
    { cell: 'c9', system: 'nova:2116', shipGovt: NOSY_HI, aiType: 3,
        criminalIn: 'nova:2116', originalAttacked: false },
    { cell: 'c12', system: 'nova:2119', shipGovt: ALLY_LO, aiType: 3,
        criminalIn: 'nova:2119', originalAttacked: true },
    { cell: 'c13', system: 'nova:2120', shipGovt: OWNER_HI, aiType: 3,
        criminalIn: 'nova:2120', originalAttacked: false },
    { cell: 'c10', system: 'nova:2117', shipGovt: UNREL, aiType: 3,
        criminalIn: 'nova:2117', originalAttacked: false },
    { cell: 'c11', system: 'nova:2118', shipGovt: NOSY, aiType: 3,
        criminalIn: 'nova:2118', originalAttacked: true },
    // Wave 5: a one-way alliance enforces, in either direction.
    { cell: 'c19', system: 'nova:2002', shipGovt: G_TO_O, aiType: 3,
        criminalIn: 'nova:2002', originalAttacked: true },
    { cell: 'c20', system: 'nova:2003', shipGovt: O_TO_G, aiType: 3,
        criminalIn: 'nova:2003', originalAttacked: true },
];

/** Every cell now matches the original (ruling #380). */
function expectedInNovaJs(cell: Cell): boolean {
    return cell.originalAttacked;
}

/** The -500 record, keyed by the sÿst it was set in. */
function recordsFor(cell: Cell): Map<string, number> {
    return cell.criminalIn === null ? new Map()
        : new Map([[cell.criminalIn, -500]]);
}

function lawFor(systemId: string): LocalLaw {
    return localLaw(systemId, SYSTEMS[systemId], id => GOVT_BY_ID.get(id));
}

describe('reference A14: whose record makes a ship attack (pure rule)', () => {
    it('covers every measured cell', () => {
        expect(CELLS.length).toBe(21);
    });

    for (const cell of CELLS) {
        const expected = expectedInNovaJs(cell);
        it(`${cell.cell}: ${expected ? 'attacks' : 'leaves the player be'}`,
            () => {
                const law = lawFor(cell.system);
                const self = GOVT_BY_ID.get(cell.shipGovt)!;
                const records = recordsFor(cell);
                expect(criminalHere(self, records, law)).toBe(expected);
                // The brain's own predicate (warships and interceptors
                // alike, c15-c18), and the government stance the comm
                // channel reads, say the same.
                expect(attacksOnSight(cell.aiType, self, undefined, records,
                    law)).toBe(expected);
                expect(shipDisposition(self, undefined, records, law)
                    === 'hostile').toBe(expected);
            });
    }

    it('enforcement: owner, an ally in either direction, or nosy', () => {
        const owner = GOVT_BY_ID.get(OWNER)!;
        expect(enforcesHere(owner, owner)).toBeTrue();
        expect(enforcesHere(GOVT_BY_ID.get(ALLY)!, owner)).toBeTrue();
        // One-way, the ally naming the owner (c19) ...
        expect(enforcesHere(GOVT_BY_ID.get(G_TO_O)!, owner)).toBeTrue();
        // ... and the owner naming the ally (c20).
        expect(enforcesHere(GOVT_BY_ID.get(O_TO_G)!,
            GOVT_BY_ID.get(OWNER2)!)).toBeTrue();
        expect(enforcesHere(GOVT_BY_ID.get(UNREL)!, owner)).toBeFalse();
        // Nosy enforces anywhere, independent systems included (c11).
        expect(enforcesHere(GOVT_BY_ID.get(NOSY)!, owner)).toBeTrue();
        expect(enforcesHere(GOVT_BY_ID.get(NOSY)!, undefined)).toBeTrue();
        // Nobody else enforces in an independent system, not even gövt 128,
        // whose record keys "the record in an independent system".
        expect(enforcesHere(GOVT_BY_ID.get(UNREL)!, undefined)).toBeFalse();
        expect(enforcesHere(govt('nova:128', {}), undefined)).toBeFalse();
    });

    it("reads an absent record as the system owner's InitialRec", () => {
        const owner = govt('nova:600', { initialRecord: -50 });
        const law = localLaw('sys:600', 'nova:600', id =>
            id === 'nova:600' ? owner : undefined);
        expect(criminalHere(owner, new Map(), law)).toBeTrue();
        expect(criminalHere(owner, new Map([['sys:600', 0]]), law))
            .toBeFalse();
        // A record under the GOVT's id is no record here any more.
        expect(criminalHere(owner, new Map([['nova:600', 0]]), law))
            .toBeTrue();
    });

    it('localLawIn reads the system owner out of the game data', () => {
        const gameData = new MockGameData();
        for (const g of GOVTS) {
            gameData.data.Govt.map.set(g.id, g);
        }
        gameData.data.System.map.set('nova:2110',
            { ...getDefaultSystemData(), id: 'nova:2110', govt: OWNER });
        // getCached: warm the caches first, as makeSystem's staging does.
        return Promise.all([gameData.data.System.get('nova:2110'),
            gameData.data.Govt.get(OWNER)]).then(() => {
                const law = localLawIn(gameData as never, 'nova:2110');
                expect(law.systemId).toBe('nova:2110');
                expect(law.owner?.id).toBe(OWNER);
                expect(law.recordGovtId).toBe(OWNER);
                const nowhere = localLawIn(gameData as never, undefined);
                expect(nowhere.owner).toBeUndefined();
                expect(nowhere.recordGovtId).toBe('nova:128');
            });
    });
});

/**
 * The same cells in a LIVE world: makeSystem builds the kit's system, the
 * real NPC brain (NpcDecisionSystem) runs, and the warship either goes for
 * the player or does not. The target brackets (styleForTarget) must say
 * the same, so what the player sees is what the ship does.
 */
describe('reference A14 in a live world: the brain and the brackets', () => {
    async function run(cell: Cell): Promise<World> {
        const gameData = new MockGameData();
        gameData.data.Ship.map.set('test:ship',
            { ...getDefaultShipData(), id: 'test:ship' });
        for (const g of GOVTS) {
            gameData.data.Govt.map.set(g.id, g);
        }
        for (const [id, owner] of Object.entries(SYSTEMS)) {
            gameData.data.System.map.set(id,
                { ...getDefaultSystemData(), id, govt: owner });
        }
        const world = await makeSystem(cell.system, gameData, undefined,
            { npcs: false });
        const template = makeShip(gameData.data.Ship.map.get('test:ship')!);
        const rest = template.components.get(MovementStateComponent)!;
        const addShip = async (uuid: string, x: number,
            configure: (ship: Entity) => void) => {
            const ship = makeShip(gameData.data.Ship.map.get('test:ship')!);
            ship.components.set(MovementStateComponent, {
                ...rest, position: new Position(x, 0), accelerating: 0,
            });
            configure(ship);
            await completeEntity(world, ship);
            world.entities.set(uuid, ship);
        };
        await addShip('player', 0, ship => {
            ship.components.set(ControlledByComponent, { peerId: 'peer' });
            ship.components.set(LegalRecordsComponent, recordsFor(cell));
        });
        await addShip('warship', 600, ship => {
            ship.components.set(GovtComponent, { id: cell.shipGovt });
            ship.components.set(NpcComponent, { aiType: cell.aiType });
        });
        // Strong enough that MaxOdds lets it engage (a zero-strength hull
        // never likes its odds; the kit's MaxOdds is 1000 anyway).
        const warship = world.entities.get('warship')!;
        warship.components.set(ShipDataComponent, {
            ...warship.components.get(ShipDataComponent)!, strength: 1000,
        });
        // Long enough for every NPC to have thought at least once.
        const until = world.resources.get(TimeResource)!.time + 1500;
        while (world.resources.get(TimeResource)!.time < until) {
            world.step();
        }
        return world;
    }

    for (const cell of CELLS) {
        const expected = expectedInNovaJs(cell);
        it(`${cell.cell}: the ${cell.aiType === 4 ? 'interceptor' : 'warship'}`
            + ` ${expected ? 'attacks and is red' : 'holds off and is not red'}`,
            async () => {
                const world = await run(cell);
                const warship = world.entities.get('warship')!;
                const attacking = warship.components.get(NpcComponent)!.mode
                    === 'attack'
                    && warship.components.get(TargetComponent)?.target
                    === 'player';
                expect(attacking).withContext('the NPC brain')
                    .toBe(expected);
                const style = styleForTarget('warship', warship, 'player',
                    world.entities.get('player')!,
                    world.resources.get(SimulationGameDataResource)!,
                    u => world.entities.get(u),
                    world.resources.get(TimeResource)!.time,
                    world.resources.get(SystemIdResource));
                expect(style === 'hostile').withContext('the brackets')
                    .toBe(expected);
            });
    }
});
