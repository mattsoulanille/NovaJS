import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import {
    MovementState, MovementStateComponent,
} from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import {
    BayFighterComponent, CollectableEscortComponent, ReturnComponent,
    ReturnWhenTargetRemovedComponent,
} from '../escorts/bay_plugin.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { EscortCommandComponent } from './escort_command.js';
import { OwnerComponent, SourceComponent } from '../combat/fire_weapon_plugin.js';
import { FiringGroupComponent } from '../ship/firing_group.js';
import { ArmorComponent, FuelComponent } from '../ship/health_plugin.js';
import { InitiateJumpEvent } from '../travel/jump_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { MissionShipComponent } from './mission_ship_component.js';
import { FormationComponent } from '../npc/npc_ai_plugin.js';
import { LandEvent, PlanetComponent, PlanetDataComponent } from '../travel/planet_plugin.js';
import {
    EscortLandingComponent, EscortPayrollComponent, PlayerEscortComponent,
} from './player_escort.js';
import {
    escortFollows, EscortJump, EscortJumpEvent, EscortLanded,
    EscortLandedEvent, escortsOnPayroll, ESCORT_LAND_DISTANCE_SQUARED,
    sweepableEscorts, playerEscortLink, steerToStellar,
} from '../escorts/player_escort_plugin.js';
import { ControlledByComponent } from './ship_control.js';
import { prepareCarriedEscort } from '../../spaceport/landed_escorts.js';

const PEER = 'test peer';
const PLAYER = 'player';
const PLANET = 'planet test:planet';
const SHIP_ID = 'test:ship';
/** A hull with no energy capacity at all: no hyperdrive, cannot follow. */
const NO_ENERGY_SHIP_ID = 'test:noEnergy';

type GateKind = 'hypergate' | 'wormhole';

async function makeWorld({ planetGate = false, gateKind = 'hypergate' }:
    { planetGate?: boolean, gateKind?: GateKind } = {}) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, {
        ...getDefaultShipData(),
        id: SHIP_ID,
    });
    const noEnergy = getDefaultShipData();
    noEnergy.id = NO_ENERGY_SHIP_ID;
    noEnergy.physics = { ...noEnergy.physics, energy: 0 };
    gameData.data.Ship.map.set(NO_ENERGY_SHIP_ID, noEnergy);
    await gameData.data.Ship.get(SHIP_ID);
    await gameData.data.Ship.get(NO_ENERGY_SHIP_ID);

    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, x: number, y: number,
        setup: (ship: Entity) => void = () => { },
        shipId = SHIP_ID) {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(x, y),
            rotation: new Angle(Math.PI / 2),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    // A stellar to land on. A bare planet entity is enough for the
    // landing systems (they only read its position and gate kind).
    const planet = new Entity();
    planet.components.set(PlanetComponent, { id: 'test:planet' });
    planet.components.set(PlanetDataComponent, {
        ...getDefaultPlanetData(),
        id: 'test:planet',
        ...(planetGate
            ? {
                gate: {
                    kind: gateKind,
                    // A wormhole needs a real exit so GateDepartureSystem
                    // picks one instead of the random-wormhole path.
                    destinations: gateKind === 'wormhole'
                        ? ['test:exit'] : [],
                    emergenceAngle: null,
                },
            }
            : {}),
    });
    planet.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(2000, 0),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });
    world.entities.set(PLANET, planet);

    const player = await addShip(PLAYER, 0, 0, ship => {
        ship.components.set(ControlledByComponent, { peerId: PEER });
    });

    async function addEscort(uuid: string, x = 0, y = 200,
        setup: (ship: Entity) => void = () => { }, shipId = SHIP_ID) {
        return addShip(uuid, x, y, ship => {
            ship.components.set(FormationComponent,
                { leader: PLAYER, slot: 0 });
            ship.components.set(EscortCommandComponent,
                { command: 'formation' });
            ship.components.set(FiringGroupComponent, { group: PLAYER });
            setup(ship);
        }, shipId);
    }

    return { world, gameData, addShip, addEscort, player, planet };
}

/** Steps until the predicate holds; returns the number of steps taken. */
function stepUntil(world: World, predicate: () => boolean, maxSteps = 4000) {
    for (let i = 0; i < maxSteps; i++) {
        if (predicate()) {
            return i;
        }
        world.step();
    }
    throw new Error(`Condition not met within ${maxSteps} steps`);
}

describe('player escort ownership', () => {
    it('marks an escort of a controlled ship', async () => {
        const { world, addEscort } = await makeWorld();
        const escort = await addEscort('escort');
        world.step();
        expect(escort.components.get(PlayerEscortComponent))
            .toEqual({ player: PLAYER, parent: PLAYER });
    });

    it('does not mark an escort of an NPC leader', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('npc leader', 500, 0);
        const wing = await addShip('npc wing', 500, 200, ship => {
            ship.components.set(FormationComponent,
                { leader: 'npc leader', slot: 0 });
        });
        world.step();
        expect(wing.components.has(PlayerEscortComponent)).toBeFalse();
    });

    it('does not mark mission ships (they have their own respawn flow)',
        async () => {
            const { world, addEscort } = await makeWorld();
            const missionShip = await addEscort('mission', 0, 300, ship => {
                ship.components.set(MissionShipComponent,
                    { mission: 'test:mission', owner: PLAYER });
            });
            world.step();
            expect(missionShip.components.has(PlayerEscortComponent))
                .toBeFalse();
        });

    it('marks a fighter launched from an escort with the escort as parent',
        async () => {
            const { world, addEscort, addShip } = await makeWorld();
            await addEscort('carrier');
            const fighter = await addShip('fighter', 0, 400, ship => {
                ship.components.set(OwnerComponent, { owner: 'carrier' });
                ship.components.set(SourceComponent, 'carrier');
                ship.components.set(EscortCommandComponent,
                    { command: 'formation' });
            });
            world.step();
            expect(fighter.components.get(PlayerEscortComponent))
                .toEqual({ player: PLAYER, parent: 'carrier' });
        });

    it('keeps the marker when the player leaves the world', async () => {
        const { world, addEscort } = await makeWorld();
        const escort = await addEscort('escort');
        world.step();
        world.entities.delete(PLAYER);
        world.step();
        world.step();
        // The formation link is allowed to lapse (FormationSystem's
        // unchanged leader-gone rule) but ownership is not.
        expect(escort.components.has(FormationComponent)).toBeFalse();
        expect(escort.components.get(PlayerEscortComponent)?.player)
            .toEqual(PLAYER);
    });

    it('reports no link while the player is out of the world', async () => {
        const { world, addEscort } = await makeWorld();
        await addEscort('escort');
        world.step();
        world.entities.delete(PLAYER);
        expect(playerEscortLink('escort', uuid => world.entities.get(uuid)))
            .toBeUndefined();
    });

    it('carries the DURABLE fields through a re-parenting: provenance and '
        + 'the queued deals', async () => {
            // MarkPlayerEscortsSystem re-stamps the marker whenever the
            // live chain moves — a wing re-attaching to its carrier, a
            // fighter promoted to a direct escort. The facts that are about
            // the PLAYER'S RELATIONSHIP with the ship rather than about the
            // chain have to survive that, or ordering an escort into a
            // different formation would silently cancel the upgrade the
            // player queued at the last hail.
            const { world, addEscort } = await makeWorld();
            const escort = await addEscort('escort');
            world.step();
            escort.components.set(PlayerEscortComponent, {
                // A deliberately WRONG parent, so the system must re-stamp.
                player: PLAYER, parent: 'stale', provenance: 'captured',
                pendingUpgrade: 'test:better', pendingSale: false,
            });
            world.step();
            const marker = escort.components.get(PlayerEscortComponent);
            expect(marker?.parent).toBe(PLAYER);
            expect(marker?.provenance).toBe('captured');
            expect(marker?.pendingUpgrade).toBe('test:better');
        });

    it('carries a queued SALE through a re-parenting too', async () => {
        const { world, addEscort } = await makeWorld();
        const escort = await addEscort('escort');
        world.step();
        escort.components.set(PlayerEscortComponent, {
            player: PLAYER, parent: 'stale', provenance: 'captured',
            pendingSale: true,
        });
        world.step();
        expect(escort.components.get(PlayerEscortComponent)?.pendingSale)
            .toBeTrue();
    });
});

describe('escort re-attachment', () => {
    it('restores formation and resets the command when the player returns',
        async () => {
            const { world, addEscort } = await makeWorld();
            const escort = await addEscort('escort');
            world.step();
            const player = world.entities.get(PLAYER)!;
            world.entities.delete(PLAYER);
            world.step();
            expect(escort.components.has(FormationComponent)).toBeFalse();
            expect(escort.components.get(PlayerEscortComponent)?.detached)
                .toBeTrue();

            // The player lifts off again under the SAME uuid.
            world.entities.set(PLAYER, player);
            world.step();
            expect(escort.components.get(FormationComponent)?.leader)
                .toEqual(PLAYER);
            expect(escort.components.get(EscortCommandComponent))
                .toEqual({ command: 'formation' });
            expect(escort.components.get(FiringGroupComponent))
                .toEqual({ group: PLAYER });
            expect(escort.components.get(PlayerEscortComponent)?.detached)
                .toBeFalse();
        });

    it('resets a holdPosition escort that kept its formation link',
        async () => {
            // FormationSystem yields for non-formation commands, so this
            // escort's formation link never lapses: the reset has to come
            // from the explicit detached flag, not from a missing link.
            const { world, addEscort } = await makeWorld();
            const escort = await addEscort('escort');
            world.step();
            escort.components.set(EscortCommandComponent,
                { command: 'holdPosition' });
            const player = world.entities.get(PLAYER)!;
            world.entities.delete(PLAYER);
            world.step();
            expect(escort.components.get(FormationComponent)?.leader)
                .toEqual(PLAYER);

            world.entities.set(PLAYER, player);
            world.step();
            expect(escort.components.get(EscortCommandComponent))
                .toEqual({ command: 'formation' });
        });

    it('gives several re-attaching escorts distinct slots in uuid order',
        async () => {
            // Slot numbers are hashed simulation state, so a batch
            // re-attaching on one tick must be assigned in an order that
            // does not depend on entity-map iteration: uuid order.
            const { world, addEscort } = await makeWorld();
            const b = await addEscort('escort-b', 0, 200);
            const a = await addEscort('escort-a', 0, 300);
            const c = await addEscort('escort-c', 0, 400);
            world.step();
            const player = world.entities.get(PLAYER)!;
            world.entities.delete(PLAYER);
            world.step();
            world.entities.set(PLAYER, player);
            world.step();

            const slots = [a, b, c].map(escort =>
                escort.components.get(FormationComponent)?.slot);
            expect(new Set(slots).size).toEqual(3);
            // uuid order is escort-a < escort-b < escort-c, and the batch
            // starts from the first free slot.
            expect(slots).toEqual([...slots].sort((x, y) => x! - y!));
        });

    it('does not yank a returning bay fighter back into formation',
        async () => {
            const { world, addShip } = await makeWorld();
            const fighter = await addShip('fighter', 0, 200, ship => {
                ship.components.set(OwnerComponent, { owner: PLAYER });
                ship.components.set(SourceComponent, PLAYER);
                ship.components.set(ReturnWhenTargetRemovedComponent,
                    undefined);
                ship.components.set(EscortCommandComponent,
                    { command: 'returnToBay' });
                ship.components.set(ReturnComponent, undefined);
            });
            world.step();
            // Detach and return: the fighter must not be pulled back into
            // formation by the player's reappearance.
            const player = world.entities.get(PLAYER)!;
            world.entities.delete(PLAYER);
            world.step();
            world.entities.set(PLAYER, player);
            world.step();
            expect(fighter.components.get(PlayerEscortComponent)?.player)
                .toEqual(PLAYER);
            expect(fighter.components.has(FormationComponent)).toBeFalse();
            expect(fighter.components.get(EscortCommandComponent))
                .toEqual({ command: 'returnToBay' });
        });
});

describe('escorts landing with the player', () => {
    it('orders owned escorts to the stellar and lands them', async () => {
        const { world, addEscort } = await makeWorld();
        const escort = await addEscort('escort');
        const landed: EscortLanded[] = [];
        world.events.get(EscortLandedEvent).subscribe(
            ({ data }) => landed.push(data));
        world.step();
        // Damage the escort so we can prove the captured entity is the
        // real one rather than a rebuild from its ship id.
        escort.components.get(ArmorComponent)!.current = 42;

        world.emit(LandEvent, { id: 'test:planet', uuid: PLANET }, [PLAYER]);
        world.step();
        expect(escort.components.get(EscortLandingComponent))
            .toEqual({ planet: PLANET });

        // The player docks: its entity leaves the simulation.
        world.entities.delete(PLAYER);
        stepUntil(world, () => landed.length > 0);
        expect(world.entities.has('escort')).toBeFalse();
        expect(landed.length).toEqual(1);
        expect(landed[0].player).toEqual(PLAYER);
        expect(landed[0].planet).toEqual(PLANET);
        // Captured with its state intact and no stale landing order.
        expect(landed[0].entity.components.get(ArmorComponent)?.current)
            .toEqual(42);
        expect(landed[0].entity.components.has(EscortLandingComponent))
            .toBeFalse();
        expect(landed[0].entity.components.get(PlayerEscortComponent)?.player)
            .toEqual(PLAYER);
    });

    it('lands inside the escort landing window', async () => {
        const { world, addEscort, planet } = await makeWorld();
        await addEscort('escort');
        const landed: EscortLanded[] = [];
        world.events.get(EscortLandedEvent).subscribe(
            ({ data }) => landed.push(data));
        world.step();
        world.emit(LandEvent, { id: 'test:planet', uuid: PLANET }, [PLAYER]);
        world.step();
        world.entities.delete(PLAYER);
        const steps = stepUntil(world, () => landed.length > 0);
        // A 2000px approach at 300px/s takes ~485 steps (~8s of sim time).
        // The bound is a regression guard on the approach controller: a
        // change that makes escorts dawdle or orbit the stellar fails here.
        expect(steps).toBeLessThan(900);
        const movement =
            landed[0].entity.components.get(MovementStateComponent)!;
        const planetPosition =
            planet.components.get(MovementStateComponent)!.position;
        expect(Position.fromVectorLike(planetPosition)
            .subtract(movement.position).lengthSquared)
            .toBeLessThanOrEqual(ESCORT_LAND_DISTANCE_SQUARED);
    });

    it('cancels a bay fighter\'s return home so it lands instead',
        async () => {
            const { world, addShip } = await makeWorld();
            const fighter = await addShip('fighter', 0, 200, ship => {
                ship.components.set(OwnerComponent, { owner: PLAYER });
                ship.components.set(SourceComponent, PLAYER);
                ship.components.set(ReturnWhenTargetRemovedComponent,
                    undefined);
                ship.components.set(EscortCommandComponent,
                    { command: 'returnToBay' });
                ship.components.set(ReturnComponent, undefined);
                ship.components.set(CollectableEscortComponent, undefined);
            });
            world.step();
            world.emit(LandEvent, { id: 'test:planet', uuid: PLANET },
                [PLAYER]);
            world.step();
            expect(fighter.components.has(EscortLandingComponent)).toBeTrue();
            expect(fighter.components.has(ReturnComponent)).toBeFalse();
            expect(fighter.components.has(CollectableEscortComponent))
                .toBeFalse();
        });

    it('does not order a landing at a gate stellar', async () => {
        // An escort has no reason to fly down to a gate: the transit takes
        // the whole flock on this same event (EscortFollowGateSystem), so
        // the escort leaves the system rather than being given an order.
        const { world, addEscort } = await makeWorld({ planetGate: true });
        const escort = await addEscort('escort');
        world.step();
        world.emit(LandEvent, { id: 'test:planet', uuid: PLANET }, [PLAYER]);
        world.step();
        expect(escort.components.has(EscortLandingComponent)).toBeFalse();
        expect(world.entities.has('escort')).toBeFalse();
    });

    it('does not land an escort in the tick the player returns', async () => {
        // The stranding race: an escort can drift into the landing window
        // on the same tick the player's relaunch record is applied (the
        // record lands before the tick's systems run). EscortLandingSystem
        // is ordered AFTER EscortReattachSystem so the order is cleared
        // first — otherwise the escort despawns and its capture arrives
        // after the client already consumed and re-inserted its roster.
        //
        // The state below is the start of exactly that tick: inside the
        // window, order still pending, player back, detached still set.
        const { world, addEscort, planet } = await makeWorld();
        const planetPosition =
            planet.components.get(MovementStateComponent)!.position;
        const escort = await addEscort('escort',
            planetPosition.x, planetPosition.y);
        const landed: EscortLanded[] = [];
        world.events.get(EscortLandedEvent).subscribe(
            ({ data }) => landed.push(data));
        escort.components.set(PlayerEscortComponent,
            { player: PLAYER, parent: PLAYER, detached: true });
        escort.components.set(EscortLandingComponent, { planet: PLANET });

        world.step();

        expect(landed.length).toEqual(0);
        expect(world.entities.has('escort')).toBeTrue();
        expect(escort.components.has(EscortLandingComponent)).toBeFalse();
        expect(escort.components.get(FormationComponent)?.leader)
            .toEqual(PLAYER);
    });

    it('re-attaches an escort still flying to the planet at liftoff',
        async () => {
            const { world, addEscort } = await makeWorld();
            const escort = await addEscort('escort');
            world.step();
            world.emit(LandEvent, { id: 'test:planet', uuid: PLANET },
                [PLAYER]);
            world.step();
            const player = world.entities.get(PLAYER)!;
            world.entities.delete(PLAYER);
            // Part-way to the planet, still in the air.
            for (let i = 0; i < 20; i++) {
                world.step();
            }
            expect(world.entities.has('escort')).toBeTrue();
            expect(escort.components.has(EscortLandingComponent)).toBeTrue();

            world.entities.set(PLAYER, player);
            world.step();
            expect(escort.components.has(EscortLandingComponent)).toBeFalse();
            expect(escort.components.get(FormationComponent)?.leader)
                .toEqual(PLAYER);
            expect(escort.components.get(EscortCommandComponent))
                .toEqual({ command: 'formation' });
        });
});

describe('escorts following a jump', () => {
    it('carries owned escorts out of the system for free', async () => {
        const { world, addEscort } = await makeWorld();
        const escort = await addEscort('escort');
        const jumps: EscortJump[] = [];
        world.events.get(EscortJumpEvent).subscribe(
            ({ data }) => jumps.push(data));
        world.step();
        const fuelBefore = escort.components.get(FuelComponent)!.current;

        world.emit(InitiateJumpEvent, { to: 'test:destination' }, [PLAYER]);
        world.step();

        expect(world.entities.has('escort')).toBeFalse();
        expect(jumps.length).toEqual(1);
        expect(jumps[0].to).toEqual('test:destination');
        expect(jumps[0].player).toEqual(PLAYER);
        expect(jumps[0].uuid).toEqual('escort');
        // Escorts jump for free: no fuel is deducted.
        expect(jumps[0].entity.components.get(FuelComponent)?.current)
            .toEqual(fuelBefore);
        expect(jumps[0].entity.components.get(PlayerEscortComponent)?.player)
            .toEqual(PLAYER);
    });

    it('leaves a zero-energy escort behind, still owned', async () => {
        const { world, addEscort } = await makeWorld();
        const stranded = await addEscort('stranded', 0, 300, () => { },
            NO_ENERGY_SHIP_ID);
        const jumps: EscortJump[] = [];
        world.events.get(EscortJumpEvent).subscribe(
            ({ data }) => jumps.push(data));
        world.step();
        expect(stranded.components.get(FuelComponent)?.max).toEqual(0);

        world.emit(InitiateJumpEvent, { to: 'test:destination' }, [PLAYER]);
        world.step();

        expect(jumps.length).toEqual(0);
        expect(world.entities.has('stranded')).toBeTrue();
        expect(stranded.components.get(PlayerEscortComponent)?.player)
            .toEqual(PLAYER);
    });

    it('does not carry another ship\'s escorts', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('other player', 1000, 0, ship => {
            ship.components.set(ControlledByComponent,
                { peerId: 'other peer' });
        });
        const theirs = await addShip('their escort', 1000, 200, ship => {
            ship.components.set(FormationComponent,
                { leader: 'other player', slot: 0 });
            ship.components.set(EscortCommandComponent,
                { command: 'formation' });
        });
        const jumps: EscortJump[] = [];
        world.events.get(EscortJumpEvent).subscribe(
            ({ data }) => jumps.push(data));
        world.step();
        expect(theirs.components.get(PlayerEscortComponent)?.player)
            .toEqual('other player');

        world.emit(InitiateJumpEvent, { to: 'test:destination' }, [PLAYER]);
        world.step();
        expect(jumps.length).toEqual(0);
        expect(world.entities.has('their escort')).toBeTrue();
    });
});

describe('escorts following a gate transit', () => {
    /** Sweeps the flock through a gate and returns the carry events. */
    async function transit(world: World, landed: EscortLanded[]) {
        world.emit(LandEvent, { id: 'test:planet', uuid: PLANET }, [PLAYER]);
        world.step();
        return landed;
    }

    it('carries owned escorts through a hypergate', async () => {
        const { world, addEscort } = await makeWorld({ planetGate: true });
        const escort = await addEscort('escort');
        const landed: EscortLanded[] = [];
        world.events.get(EscortLandedEvent).subscribe(
            ({ data }) => landed.push(data));
        world.step();

        await transit(world, landed);

        expect(world.entities.has('escort')).toBeFalse();
        expect(landed.length).toEqual(1);
        expect(landed[0].uuid).toEqual('escort');
        expect(landed[0].player).toEqual(PLAYER);
        // The gate the flock went through, so the batch is attributable the
        // same way a landing's is.
        expect(landed[0].planet).toEqual(PLANET);
        expect(landed[0].entity.components.get(PlayerEscortComponent)?.player)
            .toEqual(PLAYER);
        expect(escort.components.has(EscortLandingComponent)).toBeFalse();
    });

    it('carries owned escorts through a wormhole', async () => {
        const { world, addEscort } = await makeWorld(
            { planetGate: true, gateKind: 'wormhole' });
        await addEscort('escort');
        const landed: EscortLanded[] = [];
        world.events.get(EscortLandedEvent).subscribe(
            ({ data }) => landed.push(data));
        world.step();

        await transit(world, landed);

        // The player transits from the same event (GateDepartureSystem);
        // the flock must leave with them, not be left behind.
        expect(world.entities.has(PLAYER)).toBeFalse();
        expect(world.entities.has('escort')).toBeFalse();
        expect(landed.map(({ uuid }) => uuid)).toEqual(['escort']);
    });

    it('carries a zero-energy escort through a gate (gates carry anything)',
        async () => {
            // The mirror image of the jump rule: a hull with no hyperdrive
            // is left behind by a JUMP but goes through a GATE, which does
            // the moving for it.
            const { world, addEscort } = await makeWorld({ planetGate: true });
            const stranded = await addEscort('noEnergy', 0, 300, () => { },
                NO_ENERGY_SHIP_ID);
            const landed: EscortLanded[] = [];
            world.events.get(EscortLandedEvent).subscribe(
                ({ data }) => landed.push(data));
            world.step();
            expect(stranded.components.get(FuelComponent)?.max).toEqual(0);

            await transit(world, landed);

            expect(world.entities.has('noEnergy')).toBeFalse();
            expect(landed.map(({ uuid }) => uuid)).toEqual(['noEnergy']);
        });

    it('carries a flying escort and a zero-energy escort together',
        async () => {
            const { world, addEscort } = await makeWorld({ planetGate: true });
            await addEscort('a flyer');
            await addEscort('b noEnergy', 0, 300, () => { },
                NO_ENERGY_SHIP_ID);
            const landed: EscortLanded[] = [];
            world.events.get(EscortLandedEvent).subscribe(
                ({ data }) => landed.push(data));
            world.step();

            await transit(world, landed);

            // Swept in uuid order, so the batch's formation slots come out
            // the same on every peer and in every replay.
            expect(landed.map(({ uuid }) => uuid))
                .toEqual(['a flyer', 'b noEnergy']);
            expect(world.entities.has('a flyer')).toBeFalse();
            expect(world.entities.has('b noEnergy')).toBeFalse();
        });

    it('drops a pending landing order as it carries', async () => {
        // The order names a stellar in the system being left behind. The
        // escort must come back out of the roster clean, or it would fly at
        // a planet uuid that means nothing in the destination system.
        const { world, addEscort } = await makeWorld({ planetGate: true });
        const escort = await addEscort('escort');
        escort.components.set(EscortLandingComponent, { planet: PLANET });
        const landed: EscortLanded[] = [];
        world.events.get(EscortLandedEvent).subscribe(
            ({ data }) => landed.push(data));
        world.step();

        await transit(world, landed);

        expect(landed.length).toEqual(1);
        expect(landed[0].entity.components.has(EscortLandingComponent))
            .toBeFalse();
    });

    it('does not carry another player\'s escorts through a gate', async () => {
        const { world, addShip } = await makeWorld({ planetGate: true });
        await addShip('other player', 1000, 0, ship => {
            ship.components.set(ControlledByComponent,
                { peerId: 'other peer' });
        });
        await addShip('their escort', 1000, 200, ship => {
            ship.components.set(FormationComponent,
                { leader: 'other player', slot: 0 });
            ship.components.set(EscortCommandComponent,
                { command: 'formation' });
        });
        const landed: EscortLanded[] = [];
        world.events.get(EscortLandedEvent).subscribe(
            ({ data }) => landed.push(data));
        world.step();

        await transit(world, landed);

        expect(landed.length).toEqual(0);
        expect(world.entities.has('their escort')).toBeTrue();
    });

    it('comes back out of the roster in formation, command reset',
        async () => {
            // End to end across the split: the sim sweeps the escort at the
            // gate, and the client puts the very same carried entity back
            // beside the player in the destination system. An escort that
            // went through the gate under orders arrives in formation, the
            // explicit lifecycle-boundary reset.
            const { world, addEscort, player } = await makeWorld(
                { planetGate: true });
            const escort = await addEscort('escort');
            world.step();
            escort.components.set(EscortCommandComponent,
                { command: 'holdPosition' });
            const landed: EscortLanded[] = [];
            world.events.get(EscortLandedEvent).subscribe(
                ({ data }) => landed.push(data));

            await transit(world, landed);
            expect(landed.length).toEqual(1);

            const prepared = prepareCarriedEscort(
                {
                    player: PLAYER, uuid: landed[0].uuid,
                    entity: landed[0].entity,
                }, PLAYER, player, 0);
            expect(prepared).toBeDefined();
            expect(prepared!.components.get(EscortCommandComponent))
                .toEqual({ command: 'formation' });
            expect(prepared!.components.get(FormationComponent))
                .toEqual({ leader: PLAYER, slot: 0 });
            expect(prepared!.components.get(PlayerEscortComponent))
                .toEqual({ player: PLAYER, parent: PLAYER });
        });

    it('does not carry anything at an ordinary stellar', async () => {
        // The two LandEvent systems split on `gate` and never both act: an
        // ordinary landing issues orders and sweeps nothing.
        const { world, addEscort } = await makeWorld();
        const escort = await addEscort('escort');
        const landed: EscortLanded[] = [];
        world.events.get(EscortLandedEvent).subscribe(
            ({ data }) => landed.push(data));
        world.step();

        world.emit(LandEvent, { id: 'test:planet', uuid: PLANET }, [PLAYER]);
        world.step();

        expect(landed.length).toEqual(0);
        expect(world.entities.has('escort')).toBeTrue();
        expect(escort.components.has(EscortLandingComponent)).toBeTrue();
    });
});

describe('escortFollows', () => {
    it('excludes a zero-energy hull from a jump but not from a gate',
        async () => {
            const { world, addEscort } = await makeWorld();
            const noEnergy = await addEscort('noEnergy', 0, 300, () => { },
                NO_ENERGY_SHIP_ID);
            const normal = await addEscort('normal');
            world.step();

            expect(escortFollows('jump', noEnergy)).toBeFalse();
            expect(escortFollows('gate', noEnergy)).toBeTrue();
            expect(escortFollows('jump', normal)).toBeTrue();
            expect(escortFollows('gate', normal)).toBeTrue();
            expect(world.entities.has('normal')).toBeTrue();
        });

    it('carries a ship whose fuel component has not been provided yet',
        async () => {
            // The exclusion needs positive evidence of a zero-energy hull.
            // FuelComponent comes from a per-tick provider, so "not there
            // yet" must not be read as "no hyperdrive" — that would strand
            // an escort inserted on the same tick as the jump.
            const { world, addEscort } = await makeWorld();
            const escort = await addEscort('escort');
            world.step();
            escort.components.delete(FuelComponent);
            expect(escortFollows('jump', escort)).toBeTrue();
            expect(escortFollows('gate', escort)).toBeTrue();
        });
});

describe('sweepableEscorts', () => {
    it('returns the player\'s followers in uuid order, filtered by rule',
        async () => {
            const { world, addEscort } = await makeWorld();
            await addEscort('c');
            await addEscort('a');
            await addEscort('b noEnergy', 0, 300, () => { },
                NO_ENERGY_SHIP_ID);
            world.step();

            expect(sweepableEscorts(world.entities, PLAYER, 'gate'))
                .toEqual(['a', 'b noEnergy', 'c']);
            // The jump rule drops the hull with no hyperdrive.
            expect(sweepableEscorts(world.entities, PLAYER, 'jump'))
                .toEqual(['a', 'c']);
            expect(sweepableEscorts(world.entities, 'nobody', 'gate'))
                .toEqual([]);
        });

    it('sweeps a ship that joined the flock before it has been marked',
        async () => {
            // MarkPlayerEscortsSystem declares no ordering against the
            // departure events, so a fighter launched (or a hulk captured)
            // on the very tick the player leaves may not carry the marker
            // yet. The live chain is consulted so it is not left behind.
            const { world, addShip } = await makeWorld();
            const fresh = await addShip('fresh', 0, 200, ship => {
                ship.components.set(FormationComponent,
                    { leader: PLAYER, slot: 0 });
                ship.components.set(EscortCommandComponent,
                    { command: 'formation' });
            });
            // No world.step(), so nothing has stamped ownership.
            expect(fresh.components.has(PlayerEscortComponent)).toBeFalse();

            expect(sweepableEscorts(world.entities, PLAYER, 'gate'))
                .toEqual(['fresh']);
            // And the marker is back-filled, so the carried entity knows
            // its own parent for re-attachment.
            expect(fresh.components.get(PlayerEscortComponent))
                .toEqual({ player: PLAYER, parent: PLAYER });
        });

    it('does not sweep the player, a mission ship, or an NPC\'s wing',
        async () => {
            const { world, addShip } = await makeWorld();
            await addShip('mission', 0, 300, ship => {
                ship.components.set(FormationComponent,
                    { leader: PLAYER, slot: 1 });
                ship.components.set(MissionShipComponent,
                    { mission: 'test:mission', owner: PLAYER });
            });
            await addShip('npc leader', 500, 0);
            await addShip('npc wing', 500, 200, ship => {
                ship.components.set(FormationComponent,
                    { leader: 'npc leader', slot: 0 });
            });

            expect(sweepableEscorts(world.entities, PLAYER, 'gate'))
                .toEqual([]);
        });
});

/**
 * The wage bill mirror. The daily fee is debited by `advanceEntityDate`
 * (spaceport/mission_session.ts) while the PLAYER's entity is out of the
 * world — docked, or mid-jump — where the escorts themselves cannot be
 * reached, so the flock's ship classes are mirrored onto the player while
 * they are all still in the world together.
 */
describe('the escort payroll', () => {
    it('mirrors the flock\'s ship classes onto the player', async () => {
        const { world, addEscort, player } = await makeWorld();
        await addEscort('c');
        await addEscort('a', 0, 300, () => { }, NO_ENERGY_SHIP_ID);
        world.step();

        expect(escortsOnPayroll(world.entities, PLAYER))
            .toEqual([NO_ENERGY_SHIP_ID, SHIP_ID].sort());
        expect(player.components.get(EscortPayrollComponent))
            .toEqual([NO_ENERGY_SHIP_ID, SHIP_ID].sort());
    });

    it('bills one wage per escort, not one per class', async () => {
        const { world, addEscort } = await makeWorld();
        await addEscort('a');
        await addEscort('b', 0, 300);
        world.step();
        expect(escortsOnPayroll(world.entities, PLAYER))
            .toEqual([SHIP_ID, SHIP_ID]);
    });

    it('does not bill the player for their own bay fighters', async () => {
        // A launched fighter is the player's own outfit flying: there is
        // nobody to pay, and a wing that launches and docks a dozen times
        // in a fight must not make the daily expense flicker.
        const { world, addEscort, player } = await makeWorld();
        await addEscort('fighter', 0, 250, ship => {
            ship.components.set(BayFighterComponent,
                { bayWeaponId: 'test:bay' });
        });
        world.step();
        expect(escortsOnPayroll(world.entities, PLAYER)).toEqual([]);
        expect(player.components.get(EscortPayrollComponent)).toBeUndefined();
    });

    it('does not bill the player for a CAPTURED escort', async () => {
        // Matthew's spec: a hired pilot draws a daily fee, a captured hull
        // draws none — it is property, not an employee. The original's own
        // comm box says the same: hail/hail_escort.png's hired Terrapin has
        // a "Pay:" line and hail/hail_captured_escort.png's prize has none.
        const { world, addEscort, player } = await makeWorld();
        await addEscort('prize', 0, 250, ship => {
            ship.components.set(PlayerEscortComponent, {
                player: PLAYER, parent: PLAYER, provenance: 'captured',
            });
        });
        world.step();
        expect(escortsOnPayroll(world.entities, PLAYER)).toEqual([]);
        expect(player.components.get(EscortPayrollComponent)).toBeUndefined();
    });

    it('bills an escort with NO recorded provenance — an old save reads '
        + 'as hired, which is where it has always been', async () => {
            const { world, addEscort } = await makeWorld();
            await addEscort('legacy', 0, 250, ship => {
                ship.components.set(PlayerEscortComponent,
                    { player: PLAYER, parent: PLAYER });
            });
            world.step();
            expect(escortsOnPayroll(world.entities, PLAYER))
                .toEqual([SHIP_ID]);
        });

    it('drops an escort that is gone, and stays put otherwise', async () => {
        const { world, addEscort, player } = await makeWorld();
        await addEscort('doomed');
        world.step();
        const first = player.components.get(EscortPayrollComponent);
        expect(first).toEqual([SHIP_ID]);
        // No change, no rewrite: the component is serializer-registered, so
        // a fresh array every step would churn every rollback snapshot and
        // wire baseline for a value that never moves.
        world.step();
        expect(player.components.get(EscortPayrollComponent)).toBe(first!);

        world.entities.delete('doomed');
        world.step();
        expect(player.components.get(EscortPayrollComponent)).toEqual([]);
    });

    it('ignores another player\'s escorts, and mission ships', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('mission', 0, 300, ship => {
            ship.components.set(FormationComponent,
                { leader: PLAYER, slot: 1 });
            ship.components.set(MissionShipComponent,
                { mission: 'test:mission', owner: PLAYER });
        });
        world.step();
        expect(escortsOnPayroll(world.entities, PLAYER)).toEqual([]);
        expect(escortsOnPayroll(world.entities, 'someone else')).toEqual([]);
    });
});

describe('steerToStellar', () => {
    it('converges on the target and comes to rest', () => {
        const movement: MovementState = {
            accelerating: 0,
            position: new Position(0, 0),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        };
        const target = new Position(1500, 0);
        // Kinematics only (no MovementSystem): integrate the controller's
        // own velocity writes plus a perfect thrust response.
        const delta_s = 1 / 60;
        for (let i = 0; i < 4000; i++) {
            steerToStellar(movement, target, 300, 300, delta_s);
            if (movement.accelerating > 0) {
                movement.velocity = movement.velocity.add(
                    (movement.turnTo instanceof Angle
                        ? movement.turnTo : movement.rotation)
                        .getUnitVector().scale(300 * delta_s));
            }
            if (movement.turnTo instanceof Angle) {
                movement.rotation = movement.turnTo;
            }
            movement.position = Position.fromVectorLike(
                movement.position.add(movement.velocity.scale(delta_s)));
        }
        expect(target.subtract(movement.position).length)
            .toBeLessThan(50);
        expect(movement.velocity.length).toBeLessThan(20);
    });
});
