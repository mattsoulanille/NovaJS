import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { getPluginGameData } from '../communication/simulation_test_fixture.js';
import { acceptOffer, LOCATION_BAR } from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, GOAL_BOARD, GOAL_CHASE_OFF,
    GOAL_DESTROY, GOAL_DISABLE, GOAL_ESCORT, GOAL_NONE, GOAL_OBSERVE,
    GOAL_RESCUE, MissionsComponent, registerShip, shipDied,
} from '../nova_plugin/player/index.js';
import { CargoComponent, makeShip } from '../nova_plugin/ship/index.js';
import { rollOffers } from './mission_offers.js';
import { MissionSession, processEntityLanding } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * ============================================================================
 * ARPIA's opening "Pirate Hunt" missions: the ship goal gates the landing
 * ============================================================================
 *
 * A playtester reported finishing an early ARPIA "destroy the pirates" job
 * by landing at its return stellar without having fought them ("two of
 * them like that, but possibly some other ship in the system defeated
 * them"). The two are arpia:919 "Pirate Hunt I" and arpia:920 "Pirate Hunt
 * II": ShipGoal 0 (destroy), ShipCount 2, ShipSyst -5 ("system adjacent to
 * initial system"), ShipStart 1 (jump in), ShipBehav 0 (attack the
 * player), düde nova:198 Small Pirates / nova:261 Pirates - Advanced, both
 * gövt nova:137 Pirate (class 9). 920 is offered in Earth's bar, so its
 * pirates jump into one of Sol's neighbours: Federation space, patrolled
 * by Federation ships (gövt nova:128 / nova:146 list class 9 among their
 * enemies), and the pirates are xenophobic besides.
 *
 * NovaJS credits a destroy goal for ANY death of a tracked special ship,
 * whoever killed it (MissionShipDeathSystem, mission_ship_plugin.ts; the
 * Bible's ShipGoal 0 reads only "Destroy all the ships"), so a Federation
 * patrol finishing them is a legitimate completion. What must never
 * happen is a completion with the goal unmet: these specs pin that the
 * landing refuses it, for every counting goal, against the real data.
 */

const ARPIA = 'arpia';
const PIRATE_HUNT_II = 'arpia:920';
/** Earth, where Pirate Hunt II is offered (AvailStel 128, the bar). */
const EARTH = 'nova:128';
/** Port Kane in Kania: Pirate Hunt II's ReturnStel. */
const PORT_KANE = 'nova:137';
/** Sol, Earth's system. */
const SOL = 'nova:130';
const PAY = 30000;

describe('ARPIA "Pirate Hunt II": the destroy goal gates completion', () => {
    async function bench() {
        const gameData = await getPluginGameData(ARPIA);
        if (!gameData) {
            return undefined;
        }
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        // Pirate Hunt II's AvailBits is `<hunt I done> & !<hunt II done>`
        // (its OnSuccess sets the second), in the namespaced bits the
        // parser renumbered ARPIA's private ones to.
        const [huntIDone, huntIIDone] = [...universe
            .getMission(PIRATE_HUNT_II)!.availBits.matchAll(/b(\d+)/g)]
            .map(match => Number(match[1]));
        return { gameData, universe, huntIDone, huntIIDone };
    }

    /** A pilot docked at Earth with Pirate Hunt I done, who accepts
     * Pirate Hunt II from the bar. */
    async function accepted(b: NonNullable<Awaited<ReturnType<typeof bench>>>) {
        const entity: Entity =
            makeShip(await b.gameData.data.Ship.get('nova:128'));
        entity.components.set(CreditsComponent, { credits: 1000 });
        entity.components.set(GameDateComponent,
            { day: 1, month: 1, year: 1177 });
        entity.components.set(ControlBitsComponent,
            new Set([b.huntIDone]));
        entity.components.set(MissionsComponent, new Map());
        entity.components.set(CargoComponent, new Map());
        const session = await MissionSession.create(entity, b.gameData,
            b.universe, EARTH);
        const offer = rollOffers(session, b.universe, LOCATION_BAR)
            .find(o => o.data.id === PIRATE_HUNT_II);
        expect(offer).withContext('offered in Earth\'s bar').toBeDefined();
        expect(acceptOffer(session.machinery, offer!, session.outfits)
            .accepted).toBeTrue();
        session.commit();
        const active = entity.components.get(MissionsComponent)!
            .get(PIRATE_HUNT_II)!;
        return { entity, active, objective: active.shipObjective! };
    }

    const credits = (entity: Entity) =>
        entity.components.get(CreditsComponent)!.credits;
    const isActive = (entity: Entity) =>
        entity.components.get(MissionsComponent)!.has(PIRATE_HUNT_II);

    it('freezes a two-pirate destroy goal in a system next to Sol', async () => {
        const b = await bench();
        if (!b) {
            pending('ARPIA plug-in not installed');
            return;
        }
        const { objective } = await accepted(b);
        expect(objective.goal).toBe(GOAL_DESTROY);
        expect(objective.total).toBe(2);
        expect(objective.satisfied).toBe(0);
        expect(objective.dudeId).toBe('nova:261');
        const sol = await b.gameData.data.System.get(SOL);
        expect(sol.links).toContain(objective.systemId!);
    });

    it('stays active at Port Kane while the pirates live (never met, '
        + 'never spawned)', async () => {
            const b = await bench();
            if (!b) {
                pending('ARPIA plug-in not installed');
                return;
            }
            const { entity } = await accepted(b);
            const before = credits(entity);
            const events = await processEntityLanding(entity, b.gameData,
                b.universe, PORT_KANE);
            expect(events.filter(e => e.missionId === PIRATE_HUNT_II)
                .map(e => e.type)).not.toContain('completed');
            expect(isActive(entity)).toBeTrue();
            expect(credits(entity)).toBe(before);
            expect(entity.components.get(ControlBitsComponent)!
                .has(b.huntIIDone)).toBeFalse();
        });

    it('stays active with one of the two pirates dead', async () => {
        const b = await bench();
        if (!b) {
            pending('ARPIA plug-in not installed');
            return;
        }
        const { entity, objective } = await accepted(b);
        registerShip(objective, 'pirate-1');
        registerShip(objective, 'pirate-2');
        shipDied(objective, 'pirate-1');
        await processEntityLanding(entity, b.gameData, b.universe,
            PORT_KANE);
        expect(isActive(entity)).toBeTrue();
    });

    it('completes at Port Kane once both pirates died, whoever killed them',
        async () => {
            const b = await bench();
            if (!b) {
                pending('ARPIA plug-in not installed');
                return;
            }
            const { entity, objective } = await accepted(b);
            // What MissionShipDeathSystem does for any DeathEvent on a
            // tracked ship — it never asks who did the damage (see
            // mission_ship_integration_test's 'completes a destroy goal
            // when the ship dies', whose damager is not the owner).
            registerShip(objective, 'pirate-1');
            registerShip(objective, 'pirate-2');
            shipDied(objective, 'pirate-1');
            shipDied(objective, 'pirate-2');
            expect(objective.complete).toBeTrue();
            const before = credits(entity);
            const events = await processEntityLanding(entity, b.gameData,
                b.universe, PORT_KANE);
            expect(events.filter(e => e.missionId === PIRATE_HUNT_II)
                .map(e => e.type)).toContain('completed');
            expect(isActive(entity)).toBeFalse();
            expect(credits(entity)).toBe(before + PAY);
            expect(entity.components.get(ControlBitsComponent)!
                .has(b.huntIIDone)).toBeTrue();
        });

    // Every goal that counts ships down must be met before the return
    // stellar pays; escort and "no goal" never block (escort fails
    // instead, when a ship is lost).
    for (const [goal, name] of [
        [GOAL_DESTROY, 'destroy'], [GOAL_DISABLE, 'disable'],
        [GOAL_BOARD, 'board'], [GOAL_OBSERVE, 'observe'],
        [GOAL_RESCUE, 'rescue'], [GOAL_CHASE_OFF, 'chase off'],
    ] as const) {
        it(`blocks completion under ShipGoal ${goal} (${name}) until met`,
            async () => {
                const b = await bench();
                if (!b) {
                    pending('ARPIA plug-in not installed');
                    return;
                }
                const { entity, objective } = await accepted(b);
                objective.goal = goal;
                await processEntityLanding(entity, b.gameData, b.universe,
                    PORT_KANE);
                expect(isActive(entity)).withContext('unmet').toBeTrue();
                objective.satisfied = objective.total;
                objective.complete = true;
                await processEntityLanding(entity, b.gameData, b.universe,
                    PORT_KANE);
                expect(isActive(entity)).withContext('met').toBeFalse();
            });
    }

    for (const [goal, name] of [
        [GOAL_NONE, 'none'], [GOAL_ESCORT, 'escort'],
    ] as const) {
        it(`does not block completion under ShipGoal ${goal} (${name})`,
            async () => {
                const b = await bench();
                if (!b) {
                    pending('ARPIA plug-in not installed');
                    return;
                }
                const { entity, objective } = await accepted(b);
                objective.goal = goal;
                await processEntityLanding(entity, b.gameData, b.universe,
                    PORT_KANE);
                expect(isActive(entity)).toBeFalse();
            });
    }
});
