import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { UUID } from 'nova_ecs/arg_types';
import { System } from 'nova_ecs/system';
import { BoardedComponent, plunderSpent } from './boarding_component.js';
import { DisabledComponent } from './disabled_component.js';
import { completeEntity } from './entity_data_loader.js';
import { GovtComponent } from './govt_component.js';
import { ArmorComponent } from './health_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { MissionShipComponent } from './mission_ship_plugin.js';
import { InitiateJumpEvent } from './jump_plugin.js';
import {
    NpcComponent, npcPlunderCredits, NPC_PLUNDER_CREDIT_FRACTION,
    NPC_PLUNDER_CREDIT_MINIMUM, NPC_PLUNDER_TAKES_FROM_PLAYERS,
    PlayerPlunderedEvent,
} from './npc_ai_plugin.js';
import { BRIBE_FRACTION_LARGE, BRIBE_MINIMUM, bribeAmount } from './hail.js';
import { ActiveMission, CreditsComponent, MissionsComponent } from './player_state_plugin.js';
import { playerPlunderedMessage } from '../display/status_bar_content.js';
import { ControlledByComponent } from './ship_control.js';
import { Stat } from './stat.js';

/**
 * ============================================================================
 * "Some other pirate got here first": NPC plunder-boarding
 * ============================================================================
 *
 * EVN Bible, gövt Flags 0x1000 (unofficial-corrections edition):
 * "Warships will plunder non-mission, trader-type enemies (including the
 * player) before destroying them". That one sentence is the whole
 * original specification, so these specs pin BOTH the behaviour and the
 * judgment calls it forced (npc_ai_plugin's NPC_PLUNDER_* tunables):
 * warships are AIType 3, trader-type victims are AITypes 1-2, mission
 * ships are exempt, and this engine additionally requires the victim to
 * be a disabled hulk because that is what boarding means here.
 *
 * The NPC takes nothing material. What it does is SPEND the hulk's one
 * plunder (Matthew's one-plunder-per-life-segment ruling), which is what
 * denies it to the player — the gate's refusal is pinned in
 * boarding_plugin_test ("tells the player the ship has already been
 * boarded", stock STR# 2002 index 125).
 */

const WARSHIP_SHIP = 'test:warship';
const TRADER_SHIP = 'test:trader';
const PIRATE_GOVT = 'test:pirates';
const TRADER_GOVT = 'test:traders';
const PIRATE = 'npc:pirate';
const SECOND_PIRATE = 'npc:pirate2';
const HULK = 'npc:hulk';

function govt(id: string, overrides: Partial<GovtData>): GovtData {
    return { ...getDefaultGovtData(), id, ...overrides };
}

interface HulkOptions {
    /** Its NPC brain's AIType; 1 and 2 are the flag's "trader-type". */
    aiType?: number;
    /** Give it a government at all (an ungoverned hulk is nobody's
     * enemy). */
    governed?: boolean;
    /** Tag it as a mission special ship (the flag's "non-mission"). */
    missionShip?: boolean;
    /** Mark it as flown by a peer (ControlledByComponent). */
    controlled?: boolean;
    /** Give it a purse, as a player's ship has. */
    credits?: number;
    /** Leave it flying instead of disabling it. */
    disabled?: boolean;
    /** Make the pirate govt xenophobic (gövt Flags1 0x0001, "warships
     * attack everyone except allies") — how a real pirate govt comes to
     * regard a GOVERNMENTLESS ship, i.e. a player, as an enemy. */
    xenophobicPirate?: boolean;
    /** Pre-spend its plunder record, as if somebody boarded it first. */
    alreadyBoarded?: string;
}

/**
 * A pirate warship and a disabled trader hulk, close enough that the
 * warship can reach it. Both distances are well inside
 * NPC_PLUNDER_SEEK_RANGE.
 */
async function plunderWorld(options: HulkOptions & {
    /** Set the pirate govt's gövt Flags 0x1000 bit. */
    plunders?: boolean;
    /** Give the pirate a warship AI (3) or something else. */
    boarderAiType?: number;
    /** A second pirate, mirrored across the hulk. */
    secondPirate?: boolean;
} = {}) {
    const gameData = new MockGameData();
    for (const id of [WARSHIP_SHIP, TRADER_SHIP]) {
        gameData.data.Ship.map.set(id, { ...getDefaultShipData(), id });
    }
    gameData.data.Govt.map.set(PIRATE_GOVT, govt(PIRATE_GOVT, {
        classes: [5], enemies: [1],
        flags: {
            ...getDefaultGovtData().flags,
            plundersBeforeDestroying: options.plunders ?? true,
            xenophobic: options.xenophobicPirate ?? false,
        },
    }));
    gameData.data.Govt.map.set(TRADER_GOVT,
        govt(TRADER_GOVT, { classes: [1], enemies: [5] }));
    const world = await makeSystem('test:system', gameData);

    async function addShip(uuid: string, shipId: string,
        position: Position, setup: (ship: Entity) => void) {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position, rotation: new Angle(0),
            turnBack: false, turning: 0, velocity: new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    /**
     * Really disables a ship: DisabledComponent is re-derived from armor
     * every tick (ShipDisableSystem), so a hulk has to actually be shot
     * below its threshold and kept there (recharge off).
     */
    function disable(ship: Entity) {
        const physics = gameData.data.Ship.map.get(TRADER_SHIP)!.physics;
        const armor = ship.components.get(ArmorComponent) ?? new Stat({
            current: physics.armor, max: physics.armor, min: 0, recharge: 0,
        });
        armor.current = armor.max * 0.05;
        armor.recharge = 0;
        ship.components.set(ArmorComponent, armor);
        ship.components.set(DisabledComponent, { repairAt: null });
    }

    const hulk = await addShip(HULK, TRADER_SHIP, new Position(600, 0),
        ship => {
            ship.components.set(NpcComponent,
                { aiType: options.aiType ?? 1 });
            if (options.governed ?? true) {
                ship.components.set(GovtComponent, { id: TRADER_GOVT });
            }
            if (options.missionShip) {
                ship.components.set(MissionShipComponent,
                    { mission: 'test:mission', owner: 'some player' });
            }
            if (options.controlled) {
                ship.components.set(ControlledByComponent,
                    { peerId: 'some peer' });
            }
            if (options.alreadyBoarded) {
                ship.components.set(BoardedComponent, {
                    boarder: options.alreadyBoarded, plundered: true,
                });
            }
            if (options.credits !== undefined) {
                ship.components.set(CreditsComponent,
                    { credits: options.credits });
            }
        });
    if (options.disabled ?? true) {
        disable(hulk);
    }

    const setUpPirate = (ship: Entity) => {
        ship.components.set(NpcComponent,
            { aiType: options.boarderAiType ?? 3 });
        ship.components.set(GovtComponent, { id: PIRATE_GOVT });
    };
    const pirate = await addShip(PIRATE, WARSHIP_SHIP,
        new Position(0, 0), setUpPirate);
    if (options.secondPirate) {
        await addShip(SECOND_PIRATE, WARSHIP_SHIP,
            new Position(1200, 0), setUpPirate);
    }
    world.step();
    return { world, gameData, pirate, hulk };
}

/** Steps until the hulk's plunder record is spent, or `maxSteps` pass. */
function runUntilBoarded(world: World, maxSteps = 2000): boolean {
    for (let i = 0; i < maxSteps; i++) {
        world.step();
        if (plunderSpent(world.entities.get(HULK)
            ?.components.get(BoardedComponent))) {
            return true;
        }
    }
    return false;
}

describe('NPC plunder-boarding (gövt Flags 0x1000)', () => {
    it('sends a pirate warship over to a disabled enemy trader',
        async () => {
            const { world, pirate, hulk } = await plunderWorld();
            // It commits to the approach on its very first think.
            expect(pirate.components.get(NpcComponent)?.mode).toEqual('board');
            expect(pirate.components.get(NpcComponent)?.boardTarget)
                .toEqual(HULK);

            expect(runUntilBoarded(world)).toBeTrue();
            const boarded = hulk.components.get(BoardedComponent)!;
            expect(boarded.plundered).toBeTrue();
            expect(boarded.boarder).toEqual(PIRATE);
            // The approach is over; it goes back to ordinary business
            // rather than orbiting a hulk it has already stripped.
            expect(pirate.components.get(NpcComponent)?.mode)
                .not.toEqual('board');
            expect(pirate.components.get(NpcComponent)?.boardTarget)
                .toBeUndefined();
        });

    it('never shoots the hulk: a disabled ship is not a hostile',
        async () => {
            // The plunder run must not be a rebranded attack run — the
            // decision system still drops disabled ships as targets.
            const { world, pirate } = await plunderWorld();
            expect(runUntilBoarded(world)).toBeTrue();
            expect(pirate.components.get(NpcComponent)?.mode)
                .not.toEqual('attack');
        });

    it('leaves the hulk alone without the govt flag', async () => {
        const { world, pirate } = await plunderWorld({ plunders: false });
        expect(pirate.components.get(NpcComponent)?.mode)
            .not.toEqual('board');
        expect(runUntilBoarded(world, 400)).toBeFalse();
    });

    it('is a WARSHIP behaviour: a trader-AI pirate does not board',
        async () => {
            // "Warships will plunder ..." — AIType 3 only. AIType 4, the
            // interceptor, is the Bible's piracy POLICE, so it is left out
            // of NPC_PLUNDER_BOARDER_AI_TYPES on purpose.
            for (const boarderAiType of [1, 2, 4]) {
                const { world, pirate } =
                    await plunderWorld({ boarderAiType });
                expect(pirate.components.get(NpcComponent)?.mode)
                    .withContext(`AIType ${boarderAiType}`)
                    .not.toEqual('board');
                expect(runUntilBoarded(world, 300))
                    .withContext(`AIType ${boarderAiType}`).toBeFalse();
            }
        });

    it('only plunders TRADER-TYPE victims (AITypes 1-2)', async () => {
        // The Bible spells "trader-type" as "Freighters (i.e. AiTypes 1
        // and 2)" everywhere else it needs the idea.
        const trader = await plunderWorld({ aiType: 2 });
        expect(trader.pirate.components.get(NpcComponent)?.mode)
            .toEqual('board');
        const warship = await plunderWorld({ aiType: 3 });
        expect(warship.pirate.components.get(NpcComponent)?.mode)
            .not.toEqual('board');
        expect(runUntilBoarded(warship.world, 300)).toBeFalse();
    });

    it('spares mission special ships ("non-mission")', async () => {
        const { world, pirate } = await plunderWorld({ missionShip: true });
        expect(pirate.components.get(NpcComponent)?.mode)
            .not.toEqual('board');
        expect(runUntilBoarded(world, 400)).toBeFalse();
    });

    it('boards a ship somebody is flying (NPC_PLUNDER_TAKES_FROM_PLAYERS)',
        async () => {
            // The corrected Bible text says the flag includes the player,
            // and Matthew's ruling agrees. What they TAKE off a player is
            // the suite at the bottom of this file.
            expect(NPC_PLUNDER_TAKES_FROM_PLAYERS).toBeTrue();
            const { world, pirate } = await plunderWorld({ controlled: true });
            expect(pirate.components.get(NpcComponent)?.mode).toEqual('board');
            expect(runUntilBoarded(world)).toBeTrue();
        });

    it('spares a neutral hulk it has no quarrel with', async () => {
        const { world, pirate } = await plunderWorld({ governed: false });
        expect(pirate.components.get(NpcComponent)?.mode)
            .not.toEqual('board');
        expect(runUntilBoarded(world, 400)).toBeFalse();
    });

    it('gives up its approach when the player boarded first', async () => {
        // The converse of the denial: the record is one shared fact, so
        // whoever writes it first turns the other away.
        const { world, pirate, hulk } = await plunderWorld();
        expect(pirate.components.get(NpcComponent)?.mode).toEqual('board');

        // The player gets there first, mid-approach.
        hulk.components.set(BoardedComponent,
            { boarder: 'the player', plundered: true });
        for (let i = 0; i < 200
            && pirate.components.get(NpcComponent)?.mode === 'board'; i++) {
            world.step();
        }
        expect(pirate.components.get(NpcComponent)?.mode)
            .not.toEqual('board');
        expect(pirate.components.get(NpcComponent)?.boardTarget)
            .toBeUndefined();
        // And the player's claim is not overwritten.
        expect(hulk.components.get(BoardedComponent)?.boarder)
            .toEqual('the player');
    });

    it('never sets out for a hulk that is already spent', async () => {
        const { world, pirate } = await plunderWorld(
            { alreadyBoarded: 'somebody else' });
        expect(pirate.components.get(NpcComponent)?.mode)
            .not.toEqual('board');
        expect(runUntilBoarded(world, 300)).toBeTrue(); // still spent
    });

    it('resolves two pirates racing for one hulk by uuid, not by luck',
        async () => {
            // The claim is settled by a single uuid-sorted sweep
            // (NpcPlunderBoardSystem), because a per-entity system would
            // visit the two warships in ENTITY-MAP order — which differs
            // between a peer that built its map by insertion and one
            // restored from a wire snapshot. Whoever wins, exactly one
            // claim is recorded and it is the same one everywhere.
            const { world, hulk } = await plunderWorld({ secondPirate: true });
            expect(runUntilBoarded(world)).toBeTrue();
            const boarder = hulk.components.get(BoardedComponent)!.boarder;
            expect([PIRATE, SECOND_PIRATE]).toContain(boarder);
            // The loser has stood down rather than sitting on 'board'
            // forever waiting for a prize that is gone.
            for (let i = 0; i < 200; i++) {
                world.step();
            }
            for (const uuid of [PIRATE, SECOND_PIRATE]) {
                expect(world.entities.get(uuid)?.components
                    .get(NpcComponent)?.mode)
                    .withContext(uuid).not.toEqual('board');
            }
            // And the claim never changed hands afterwards.
            expect(hulk.components.get(BoardedComponent)?.boarder)
                .toEqual(boarder);
        });
});

/**
 * ============================================================================
 * Pirates plunder a disabled PLAYER (gövt Flags 0x1000, "including the
 * player")
 * ============================================================================
 *
 * Matthew's ruling: a disabled player is boarded exactly like a hulk, and
 * the pirates take a cut of their cash — a cut that MUST COST MORE THAN
 * BRIBING THE SAME SHIP OFF, or the bribe would be strictly dominated and
 * nobody would ever pay one.
 */
describe('pirates plundering a disabled player', () => {
    /**
     * A realistic player victim: no government of its own (nothing gives
     * a player ship one), flown by a peer, carrying a purse — and a
     * XENOPHOBIC pirate govt, gövt Flags1 0x0001 "warships attack everyone
     * except allies", which is how a real pirate government comes to
     * regard a governmentless ship as an enemy in the first place.
     */
    const playerWorld = (extra: Parameters<typeof plunderWorld>[0] = {}) =>
        plunderWorld({
            controlled: true, governed: false, xenophobicPirate: true,
            credits: 20_000, ...extra,
        });

    it('costs more than buying them off, at every purse and both bribe '
        + 'tiers', () => {
            // The relation the two functions must never drift out of. The
            // fraction and floor are both pegged above the bribe's, and
            // the floor is literally derived from BRIBE_MINIMUM.
            expect(NPC_PLUNDER_CREDIT_FRACTION)
                .toBeGreaterThan(BRIBE_FRACTION_LARGE);
            expect(NPC_PLUNDER_CREDIT_MINIMUM)
                .toBeGreaterThan(BRIBE_MINIMUM);

            for (const purse of [0, 1, 4, 99, 499, 500, 501, 999, 1000, 1001,
                1999, 2000, 2001, 5_000, 12_345, 100_000, 9_999_999]) {
                const plunder = npcPlunderCredits(purse);
                for (const larger of [false, true]) {
                    const bribe = bribeAmount(purse, larger);
                    expect(plunder)
                        .withContext(`purse ${purse}, larger ${larger}`)
                        .toBeGreaterThanOrEqual(bribe);
                    // Strictly more, EXCEPT when the bribe is already
                    // taking the player's whole purse — nobody can take
                    // more than everything.
                    if (bribe < purse) {
                        expect(plunder)
                            .withContext(`purse ${purse}, larger ${larger}`)
                            .toBeGreaterThan(bribe);
                    }
                }
            }
        });

    it('never takes more than the player has', () => {
        expect(npcPlunderCredits(0)).toEqual(0);
        expect(npcPlunderCredits(300)).toEqual(300);
        expect(npcPlunderCredits(-5)).toEqual(0);
    });

    it('takes the fraction once the purse clears the floor', () => {
        expect(npcPlunderCredits(100_000))
            .toEqual(100_000 * NPC_PLUNDER_CREDIT_FRACTION);
        // ...and the floor below that.
        expect(npcPlunderCredits(1_500)).toEqual(NPC_PLUNDER_CREDIT_MINIMUM);
    });

    it('is a pure function of synced credits, with no roll', () => {
        // A random cut would have to agree on its draw count with every
        // other NPC decision roll on every peer.
        expect(npcPlunderCredits(12_345)).toEqual(npcPlunderCredits(12_345));
    });

    it('boards a disabled player and takes the cut, exactly once',
        async () => {
            const { world, pirate, hulk } = await playerWorld();
            expect(pirate.components.get(NpcComponent)?.mode).toEqual('board');

            expect(runUntilBoarded(world)).toBeTrue();
            expect(hulk.components.get(CreditsComponent)!.credits)
                .toEqual(20_000 - npcPlunderCredits(20_000));
            expect(hulk.components.get(BoardedComponent)?.boarder)
                .toEqual(PIRATE);

            // EXACTLY ONCE: the durable record is what stops the same
            // pirate — or the next one — coming back for seconds.
            const after = hulk.components.get(CreditsComponent)!.credits;
            for (let i = 0; i < 300; i++) {
                world.step();
            }
            expect(hulk.components.get(CreditsComponent)!.credits)
                .toEqual(after);
        });

    it('tells the player what happened', async () => {
        // The boarding is over in the tick it happens — no dialog opens —
        // so the event is the only feedback there is.
        const { world, hulk } = await playerWorld();
        const taken: number[] = [];
        world.addSystem(new System({
            name: 'CollectPlundered',
            events: [PlayerPlunderedEvent],
            args: [PlayerPlunderedEvent, UUID] as const,
            step({ credits }, uuid) {
                if (uuid === HULK) {
                    taken.push(credits);
                }
            },
        }));
        expect(runUntilBoarded(world)).toBeTrue();
        expect(taken).toEqual([npcPlunderCredits(20_000)]);
        expect(playerPlunderedMessage(taken[0])).toContain('stolen!');
        expect(hulk.components.get(CreditsComponent)!.credits)
            .toEqual(20_000 - taken[0]);
    });

    /**
     * mïsn Flags 0x8000 "Mission will fail if player is boarded by
     * pirates" (EVN Bible) — the Pirate Offshoot string nova:719-726.
     * The plunder-boarding above IS that piracy (#106).
     */
    it('fails the owner\'s 0x8000-flagged missions when pirates board '
        + 'them, and only those', async () => {
            const { world, hulk } = await playerWorld();
            const active = (id: string, flagged: boolean): ActiveMission => ({
                id, acceptedDay: 0, acceptedAt: 'test:planet',
                travelPlanet: null, returnPlanet: null, cargoType: -1,
                cargoQty: 0, cargoLoaded: false, travelDone: false,
                deadlineDay: null,
                ...(flagged ? { failIfBoardedByPirates: true } : {}),
            });
            hulk.components.set(MissionsComponent, new Map([
                ['test:courier', active('test:courier', true)],
                ['test:tour', active('test:tour', false)],
            ]));
            expect(runUntilBoarded(world)).toBeTrue();
            const missions = hulk.components.get(MissionsComponent)!;
            expect(missions.get('test:courier')?.failed).toBeTrue();
            expect(missions.get('test:tour')?.failed).toBeUndefined();
        });

    it('will not touch a player who is still flying', async () => {
        // The disabled-first rule is this engine's, not the Bible's, and
        // it applies to the player exactly as it does to a hulk.
        const { world, pirate } = await playerWorld({ disabled: false });
        expect(pirate.components.get(NpcComponent)?.mode).not.toEqual('board');
        expect(runUntilBoarded(world, 400)).toBeFalse();
    });

    it('lets the player become plunderable again after a jump', async () => {
        // The player's record resets on the same life-segment boundaries a
        // hulk's does (clearPlunderRecord), so being robbed once is not a
        // permanent immunity either.
        const { world, hulk } = await playerWorld();
        expect(runUntilBoarded(world)).toBeTrue();
        expect(plunderSpent(hulk.components.get(BoardedComponent))).toBeTrue();

        world.emit(InitiateJumpEvent, { to: 'test:elsewhere' }, [HULK]);
        world.step();
        expect(plunderSpent(hulk.components.get(BoardedComponent)))
            .toBeFalse();
    });
});
