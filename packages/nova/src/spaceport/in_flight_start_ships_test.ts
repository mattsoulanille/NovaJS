import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { MissionData } from 'novadatainterface/mission_data';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { makeSyntheticGameData } from '../communication/simulation_test_fixture.js';
import {
    buildMissionShipSpawns,
} from '../nova_plugin/missions/index.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    ActiveMission, ControlledByComponent, CreditsComponent, GameDateComponent,
    GOAL_DESTROY, MissionShipComponent, MissionsComponent, PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { advanceEntityDate } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * ============================================================================
 * In-flight `S` starts and ShipSyst -6 ships (R15, wave 40)
 * ============================================================================
 *
 * The original (reference_experiments "In-flight `S` starts (R15), wave
 * 40"): a destroy goal whose OnShipDone is `S1027`, mïsn 1027 having
 * ShipSyst -6 ("whatever system the player is in"). Killing the target
 * put the follower NOWHERE for the 18 s watched; it was on the port after
 * a landing and take-off, and in the next system after a jump.
 *
 * NovaJS gets there by construction: OnShipDone runs at the owner's next
 * DATE ADVANCE (a jump's, before the arrival's spawns; a landing's, before
 * the lift-off's — display/mission_ship_done_plugin.ts "OnShipDone IS
 * STILL DEFERRED"), and a ShipSyst -6 batch is only ever built at a
 * system ENTRY (buildMissionShipSpawns). Nothing builds ships in flight
 * for a mission a set string starts: the in-flight ship-offer accept
 * builds the ACCEPTED mission's ships only (ship_mission_offer_plugin.ts),
 * and the missions its OnAccept `S` starts wait for the next entry too.
 * (One difference the ships do not show: the original has the follow-up
 * ACTIVE from the kill, NovaJS from the date advance.)
 *
 * These pin that chain on the synthetic courier (the goal's mission,
 * OnShipDone rewritten to start the follow-up) and the bounty rewritten
 * to the kit's mïsn 1027 shape: ShipSyst -6, one ship.
 */
describe('an in-flight OnShipDone `S` of a ShipSyst -6 mission (R15, wave 40)',
    () => {
        const COURIER = SYNTHETIC.missions.courier;
        const FOLLOWER = SYNTHETIC.missions.bounty;
        const HERE = SYNTHETIC.systems.thessaly;
        const NEXT = SYNTHETIC.systems.ossory;
        const PLAYER = 'player';
        const PEER = 'a';

        /** The courier, its destroy goal just completed by the kill. */
        function goalDone(): ActiveMission {
            return {
                id: COURIER, acceptedDay: 0, acceptedAt: SYNTHETIC.planets.port,
                travelPlanet: SYNTHETIC.planets.moon,
                returnPlanet: SYNTHETIC.planets.port,
                cargoType: -1, cargoQty: 0, cargoLoaded: false,
                travelDone: false, deadlineDay: null,
                shipObjective: {
                    goal: GOAL_DESTROY, systemId: HERE, shipStart: 0,
                    behavior: -1, dudeId: 'nova:128', total: 1, satisfied: 1,
                    complete: true, failed: false, shipDonePending: true,
                    live: new Map(),
                },
            };
        }

        async function pilot() {
            // A fresh aggregator: the mission data is rewritten below.
            const gameData = makeSyntheticGameData();
            const universe = new MissionUniverse(gameData);
            await universe.load();
            const follower = universe.getMission(FOLLOWER)! as
                { -readonly [K in keyof MissionData]: MissionData[K] };
            follower.shipSyst = -6;
            follower.shipSystId = null;
            follower.shipCount = 1;
            (universe.getMission(COURIER)! as { onShipDone: string })
                .onShipDone = `S${FOLLOWER.split(':')[1]}`;
            const entity = makeShip(await gameData.data.Ship.get(
                SYNTHETIC.ships.skiff));
            entity.components.set(MultiplayerData, { owner: PEER });
            entity.components.set(ControlledByComponent, { peerId: PEER });
            entity.components.set(PlayerShipSelector, undefined);
            entity.components.set(CreditsComponent, { credits: 1000 });
            entity.components.set(GameDateComponent,
                { day: 3, month: 4, year: 1177 });
            entity.components.set(ControlBitsComponent, new Set());
            entity.components.set(ActiveRanksComponent, new Set());
            entity.components.set(MissionsComponent,
                new Map([[COURIER, goalDone()]]));
            return { gameData, universe, entity };
        }

        /** The follow-up's special ships among an entry's spawns. */
        function followers(ships: Entity[]) {
            return ships.filter(ship => {
                const tag = ship.components.get(MissionShipComponent);
                return tag?.mission === FOLLOWER && !tag.aux;
            });
        }

        it('starts nothing in flight: the follow-up waits for the date '
            + 'advance', async () => {
                const { entity } = await pilot();
                // What the kill's tick leaves on the shared state: the
                // pending flag, and no follow-up to build ships for.
                const missions = entity.components.get(MissionsComponent)!;
                expect(missions.get(COURIER)!.shipObjective!.shipDonePending)
                    .toBeTrue();
                expect(missions.has(FOLLOWER)).toBeFalse();
            });

        it('puts the follower in the next system after a jump', async () => {
            const { gameData, universe, entity } = await pilot();
            // The jump's date advance (client/transit.ts) comes before the
            // arrival's spawns (client/system_entry.ts).
            await advanceEntityDate(entity, 1, universe, gameData);
            const missions = entity.components.get(MissionsComponent)!;
            expect(missions.has(FOLLOWER)).toBeTrue();
            // -6: no system frozen; wherever the player enters.
            expect(missions.get(FOLLOWER)!.shipObjective!.systemId).toBeNull();

            const ships = await buildMissionShipSpawns(entity, PLAYER, NEXT,
                gameData, universe, 0, () => 0.5);
            expect(followers(ships).length).toBe(1);
        });

        it('puts the follower back in the same system after a landing and '
            + 'take-off', async () => {
                const { gameData, universe, entity } = await pilot();
                // The landing's date advance, then the lift-off back into
                // the system the kill was in.
                await advanceEntityDate(entity, 1, universe, gameData);
                const ships = await buildMissionShipSpawns(entity, PLAYER,
                    HERE, gameData, universe, 0, () => 0.5);
                expect(followers(ships).length).toBe(1);
            });
    });
