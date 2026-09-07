import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { PlayerEscortComponent, CreditsComponent } from '../nova_plugin/player/index.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/index.js';
import { CarriedEscort } from '../spaceport/landed_escorts.js';
import { ClientStateSlot, LiveSystem, requestLaunch } from './client_state.js';
import { runDockingFrame } from './docking.js';
import { FleetLedger } from './fleet_ledger.js';
import type { ClientRuntime } from './runtime.js';

/**
 * ============================================================================
 * THE DOCKING FRAME AND THE ESCORT DEALS: nothing settles, nothing lifts
 * off, until the spaceport has resolved its Leave
 * ============================================================================
 *
 * Ruling #249: the escort deals the player queued over the comm channel
 * settle in the SPACEPORT'S Leave, which shows the player a report and
 * resolves its show() — and so LeaveSpaceportEvent, and so `launching`
 * — only once that report is closed. The client's docking frame used to
 * settle them itself on every docked frame at a shipyard; it no longer
 * touches them at all. These specs pin the client half of the ordering:
 *
 *   - a frame that runs while the player is landed (the report is up, or
 *     they are still shopping) inserts nothing and settles nothing, at a
 *     shipyard or anywhere else;
 *   - the insertion records are built only once `launching` is set, i.e.
 *     after the spaceport resolved — player first, then the roster.
 *
 * The spaceport half (the report is shown before show() resolves, and
 * the settlement lands on the hull that lifts off) is in
 * spaceport/landed_seams_integration_test.ts.
 */
describe('the docking frame while landed (ruling #249)', () => {
    const SYSTEM = 'nova:128';
    const PLANET = 'nova:128';
    const PLAYER = 'player-uuid';
    const HULL = 'nova:128';
    const ESCORT_SHIP = 'nova:130';

    function movement() {
        return {
            accelerating: 0, position: new Position(0, 0),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        };
    }

    function gameData(): MockGameData {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET, {
            ...getDefaultPlanetData(), id: PLANET, name: 'Shipyard World',
            flags: { ...getDefaultPlanetData().flags, hasShipyard: true },
        });
        const escortHull: ShipData = {
            ...getDefaultShipData(), id: ESCORT_SHIP, price: 100_000,
            escortSellValue: 40_000,
        };
        data.data.Ship.map.set(HULL, { ...getDefaultShipData(), id: HULL });
        data.data.Ship.map.set(ESCORT_SHIP, escortHull);
        return data;
    }

    /**
     * A client docked at a shipyard with one captured escort on the
     * landed roster and a sale queued against it, over a bridge that
     * records every insertion.
     */
    function bench() {
        const inserted: string[] = [];
        const bridge = {
            addEntity: async (uuid: string) => { inserted.push(uuid); },
            removeEntity: async () => undefined,
        };
        const world = new World('display');
        const live = { systemId: SYSTEM, world, bridge } as unknown as LiveSystem;
        const data = gameData();
        const player = new Entity('player')
            .addComponent(ShipComponent, { id: HULL })
            .addComponent(CreditsComponent, { credits: 1_000 })
            .addComponent(MovementStateComponent, movement());
        const escort: CarriedEscort = {
            player: PLAYER, uuid: 'escort-1',
            entity: new Entity('escort')
                .addComponent(ShipComponent, { id: ESCORT_SHIP })
                .addComponent(ShipDataComponent, data.data.Ship.map.get(ESCORT_SHIP)!)
                .addComponent(MovementStateComponent, movement())
                .addComponent(PlayerEscortComponent, {
                    player: PLAYER, parent: PLAYER, provenance: 'captured',
                    pendingSale: true,
                }),
        };
        const fleet = new FleetLedger();
        fleet.landed.push(escort);
        const state = new ClientStateSlot({
            kind: 'landed', system: live,
            ship: { uuid: PLAYER, entity: player, planetId: PLANET },
        });
        const runtime = {
            state, fleet, gameData: data, communicator: { uuid: 'peer-1' },
        } as unknown as ClientRuntime;
        return { runtime, live, inserted, player, escort, fleet, state };
    }

    it('inserts nothing and settles nothing while the player is landed — '
        + 'even at a shipyard, even with a deal queued', async () => {
            const { runtime, live, inserted, player, escort, fleet, state }
                = bench();
            for (let frame = 0; frame < 3; frame++) {
                await runDockingFrame(runtime, live);
            }
            expect(inserted).toEqual([]);
            expect(state.state.kind).toBe('landed');
            // The deal is still queued, the escort still on the roster,
            // and not a credit has moved: settlement is the spaceport's
            // Leave, not the frame loop's.
            expect(fleet.landed).toEqual([escort]);
            expect(escort.entity.components.get(PlayerEscortComponent)!
                .pendingSale).toBeTrue();
            expect(player.components.get(CreditsComponent)!.credits)
                .toBe(1_000);
        });

    it('builds the insertion records only once the spaceport has resolved '
        + 'its Leave (`launching` set): player first, then the roster',
        async () => {
            const { runtime, live, inserted, player, fleet, state } = bench();
            // The spaceport's show() resolved (the report was closed):
            // LeaveSpaceportEvent -> requestLaunch.
            state.apply(s => requestLaunch(s, player));
            await runDockingFrame(runtime, live);
            expect(inserted.length).toBe(2);
            expect(inserted[0]).toBe(PLAYER);
            expect(state.state.kind).toBe('inSpace');
            expect(fleet.landed).toEqual([]);
        });
});
