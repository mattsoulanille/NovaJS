import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { GovtComponent, SystemIdResource } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { FormationComponent, NpcComponent } from '../npc/index.js';
import { ControlledByComponent } from '../player/index.js';
import {
    FiringGroupComponent, makeShip, TargetComponent,
} from '../ship/index.js';
import { completeEntity, loadWeaponsGameData } from '../spawn/index.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { styleForTarget } from './hostility.js';

/**
 * ============================================================================
 * A trader shot by the player's ESCORT fights the escort, not the player
 * ============================================================================
 *
 * Reference "A trader shot by the player's escort: whom does it fight?
 * wave 12" (docs/reference_experiments.md): ordered onto an AI 2 trader
 * with `f`, the player's escort shot it down to "Shields Down" over 40 s;
 * the trader fought (and fled) the escort and never fired at the player
 * beside it, yet its corners read RED to the player throughout.
 *
 * NovaJS records the ship that FIRED as the aggressor when it flies on a
 * player's side (npc_targeting.ts's responsibleShip / playerSideAggressor),
 * where an NPC flock still records its root. The brackets read the trader
 * as hostile through tier 3c (hostility.ts's isFightingPlayerFlock).
 *
 * Synthetic stand-ins: a Meridian Corsair as the brave trader (AI 2), a
 * Skiff as the player's escort (weaker, so the trader's odds are good and
 * it fights rather than runs), another Skiff as the player.
 */

const CORSAIR = SYNTHETIC.ships.corsair;
const SKIFF = SYNTHETIC.ships.skiff;
const BLASTER = SYNTHETIC.weapons.blaster;
const MERIDIAN = SYNTHETIC.govts.meridian;

type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;

describe('a trader shot by the player\'s escort (reference wave 12)', () => {
    let gameData: GameData;
    let world: World;

    beforeEach(async () => {
        gameData = await getSyntheticGameData();
        world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
    });

    function pin(ship: Entity, x: number, y: number) {
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0), // Facing -y.
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
    }

    async function addShip(uuid: string, shipId: string, x: number, y: number,
        setup: (ship: Entity) => void) {
        const ship = makeShip(await gameData.data.Ship.get(shipId));
        ship.components.set(MultiplayerData, { owner: 'server' });
        setup(ship);
        await completeEntity(world, ship);
        pin(ship, x, y);
        world.entities.set(uuid, ship);
        return ship;
    }

    function step(ticks: number) {
        for (let i = 0; i < ticks; i++) {
            world.step();
        }
    }

    /** The player and its escort side by side, the trader 150 px ahead of
     * the escort (both face -y). The trader is born asleep. */
    async function scene() {
        const player = await addShip('player', SKIFF, 900, 1000, ship =>
            ship.components.set(ControlledByComponent, { peerId: 'peer' }));
        const escort = await addShip('escort', SKIFF, 1000, 1000, ship => {
            ship.components.set(FormationComponent,
                { leader: 'player', slot: 0 });
            ship.components.set(FiringGroupComponent, { group: 'player' });
        });
        const trader = await addShip('trader', CORSAIR, 1000, 850, ship => {
            ship.components.set(NpcComponent, {
                aiType: 2, nextDecision: Number.MAX_SAFE_INTEGER,
                departAt: 1e12,
            });
            ship.components.set(GovtComponent, { id: MERIDIAN });
        });
        step(20); // Providers attach hulls, weapon state, the rest.
        pin(player, 900, 1000);
        pin(escort, 1000, 1000);
        pin(trader, 1000, 850);
        return { player, escort, trader };
    }

    async function escortFires() {
        await loadWeaponsGameData(world, [BLASTER]);
        const weapon = world.resources.get(WeaponEntries)!.getCached(BLASTER);
        world.entities.get('escort')!.components.set(TargetComponent,
            { target: 'trader' });
        expect(weapon!.fireFromEntity('escort', false)).toBeDefined();
        step(40);
    }

    function style(trader: Entity) {
        return styleForTarget('trader', trader, 'player',
            world.entities.get('player')!, gameData,
            id => world.entities.get(id),
            world.resources.get(TimeResource)!.time,
            world.resources.get(SystemIdResource));
    }

    it('records the escort, not the player, as the aggressor', async () => {
        const { trader } = await scene();
        expect(style(trader)).not.toBe('hostile');
        await escortFires();
        expect(trader.components.get(NpcComponent)!.aggressor)
            .toBe('escort');
    });

    it('fights the escort and never targets the player, and reads hostile '
        + 'to the player while it does', async () => {
            const { trader } = await scene();
            await escortFires();
            const npc = trader.components.get(NpcComponent)!;
            npc.nextDecision = 0;
            // Two seconds: long enough for several thinks, short of the
            // trader's guns disabling the escort.
            for (let tick = 0; tick < 60 * 2; tick++) {
                step(1);
                expect(trader.components.get(TargetComponent)?.target)
                    .not.toBe('player');
            }
            expect(npc.mode).toBe('attack');
            expect(trader.components.get(TargetComponent)?.target)
                .toBe('escort');
            expect(style(trader)).toBe('hostile');
        });
});
