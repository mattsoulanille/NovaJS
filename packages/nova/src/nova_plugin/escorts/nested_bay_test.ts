import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import { BayWeaponData, getDefaultBayWeaponData } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import { CollisionEvent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import {
    ControlledByComponent, EscortCommandComponent, PlayerEscortComponent,
} from '../player/index.js';
import {
    makeShip, OutfitsStateComponent, SourceComponent, WeaponsStateComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import {
    BayFighterComponent, fighterHome, HangarComponent, ReturnComponent,
} from './bay_plugin.js';

/**
 * ============================================================================
 * Nested bays: "return to ship" with a fighter that launched fighters
 * ============================================================================
 *
 * The report (2026-11-27): "If a bay escort itself spawns another escort
 * from its bay, and then the player commands 'return to ship', both
 * escorts will try to return to the player's ship." Matthew's ruling: the
 * second-level fighter (a Dart) returns to ITS carrier (the Tender the
 * player launched) while that is in space; with the Tender docked or
 * destroyed it returns to the player's ship and is credited to the
 * Tender's bay, never to the player's own Dart bay (which the player
 * mounts here too, so a mix-up would show).
 */

const PLAYER = 'player';
const PLAYER_SHIP = 'test:carrier';
const TENDER_SHIP = 'test:tender';
const DART_SHIP = 'test:dart';
const VICTIM_SHIP = 'test:victim';
const TENDER_BAY = 'test:tenderBay';
const DART_BAY = 'test:dartBay';
const TENDER_BAY_OUTFIT = 'test:tenderBayOutfit';
const DART_BAY_OUTFIT = 'test:dartBayOutfit';
const TENDERS = 'test:tenders';
const DARTS = 'test:darts';

function bay(id: string, shipID: string, maxAmmo: number): BayWeaponData {
    return {
        ...getDefaultBayWeaponData(),
        id, shipID, maxAmmo,
        ammoType: ['weapon', id],
        fireGroup: 'secondary',
        shotSpeed: 0,
        // One original frame: a held trigger launches every second step.
        reload: 1,
    };
}

async function makeWorld() {
    const gameData = new MockGameData();
    gameData.data.Weapon.map.set(TENDER_BAY, bay(TENDER_BAY, TENDER_SHIP, 4));
    gameData.data.Weapon.map.set(DART_BAY, bay(DART_BAY, DART_SHIP, 3));
    gameData.data.Outfit.map.set(TENDER_BAY_OUTFIT, {
        ...getDefaultOutfitData(), id: TENDER_BAY_OUTFIT,
        weapons: { [TENDER_BAY]: 1 },
    });
    gameData.data.Outfit.map.set(DART_BAY_OUTFIT, {
        ...getDefaultOutfitData(), id: DART_BAY_OUTFIT,
        weapons: { [DART_BAY]: 1 },
    });
    gameData.data.Outfit.map.set(TENDERS, {
        ...getDefaultOutfitData(), id: TENDERS, ammoFor: TENDER_BAY,
    });
    gameData.data.Outfit.map.set(DARTS, {
        ...getDefaultOutfitData(), id: DARTS, ammoFor: DART_BAY,
    });
    const ship = (id: string, outfits: ShipData['outfits']): ShipData => ({
        ...getDefaultShipData(), id, outfits,
        physics: { ...getDefaultShipPhysics(), speed: 300, acceleration: 300,
            turnRate: 3 },
    });
    // The player mounts BOTH bays: its own Dart bay is the one a nested
    // Dart must never be credited to.
    const playerData = ship(PLAYER_SHIP, {
        [TENDER_BAY_OUTFIT]: 1, [TENDERS]: 2,
        [DART_BAY_OUTFIT]: 1, [DARTS]: 2,
    });
    gameData.data.Ship.map.set(PLAYER_SHIP, playerData);
    gameData.data.Ship.map.set(TENDER_SHIP,
        ship(TENDER_SHIP, { [DART_BAY_OUTFIT]: 1, [DARTS]: 3 }));
    gameData.data.Ship.map.set(DART_SHIP, ship(DART_SHIP, {}));
    const victimData = ship(VICTIM_SHIP, {});
    gameData.data.Ship.map.set(VICTIM_SHIP, victimData);

    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });
    const player = makeShip(playerData);
    player.components.set(ControlledByComponent, { peerId: 'p' });
    await completeEntity(world, player);
    park(player, 0, 0);
    world.entities.set(PLAYER, player);
    const victim = makeShip(victimData);
    await completeEntity(world, victim);
    park(victim, 400, 0);
    world.entities.set('victim', victim);
    await step(world, 2);
    return { world, player };
}

function park(entity: Entity, x: number, y: number) {
    entity.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(x, y),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });
}

async function step(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

function count(entity: Entity, outfit: string): number {
    return entity.components.get(OutfitsStateComponent)?.get(outfit)?.count
        ?? 0;
}

function launchedFrom(world: World, carrier: string): [string, Entity][] {
    return [...world.entities].filter(([, entity]) =>
        entity.components.has(BayFighterComponent)
        && entity.components.get(SourceComponent) === carrier);
}

/** The player launches one Tender from its Tender bay. */
async function launchTender(world: World, player: Entity) {
    const before = launchedFrom(world, PLAYER).length;
    const weapon = player.components.get(WeaponsStateComponent)!
        .get(TENDER_BAY)!;
    weapon.firing = true;
    await step(world, 2);
    weapon.firing = false;
    const now = launchedFrom(world, PLAYER);
    expect(now.length).toBe(before + 1);
    const [uuid, tender] = now[now.length - 1];
    park(tender, 0, 2000);
    return [uuid, tender] as const;
}

/** The Tender, ordered onto the victim, launches one Dart. */
async function launchDart(world: World, tenderUuid: string, tender: Entity) {
    park(tender, 300, 0);
    tender.components.set(EscortCommandComponent,
        { command: 'attack', target: 'victim' });
    for (let i = 0; i < 20 && launchedFrom(world, tenderUuid).length === 0;
        i++) {
        await step(world, 1);
    }
    // Back to formation; the Tender's fight is over.
    tender.components.set(EscortCommandComponent, { command: 'formation' });
    const darts = launchedFrom(world, tenderUuid);
    expect(darts.length).toBe(1);
    const [uuid, dart] = darts[0];
    park(dart, 2000, 2000);
    park(tender, 0, 2000);
    return [uuid, dart] as const;
}

/** The player's 'return to ship' (Alt+C) reaches its DIRECT escorts. */
function recall(entity: Entity) {
    entity.components.set(EscortCommandComponent, { command: 'returnToBay' });
}

function dock(world: World, fighter: string, withShip: string) {
    world.emit(CollisionEvent, { other: withShip, initiator: true },
        [fighter]);
}

describe('nested bays: return to ship', () => {
    it('sends the Dart home to its Tender and the Tender home to the '
        + 'player', async () => {
        const { world, player } = await makeWorld();
        const [tenderUuid, tender] = await launchTender(world, player);
        const [dartUuid, dart] = await launchDart(world, tenderUuid, tender);
        // The Dart is the player's escort-of-escort, owned by the player.
        expect(dart.components.get(PlayerEscortComponent)?.player)
            .toBe(PLAYER);

        recall(tender);
        await step(world, 2);

        // Both fly home, each to its OWN carrier.
        expect(tender.components.has(ReturnComponent)).toBeTrue();
        expect(dart.components.has(ReturnComponent)).toBeTrue();
        expect(tender.components.get(MovementStateComponent)!.turnTo)
            .toBe(PLAYER);
        expect(dart.components.get(MovementStateComponent)!.turnTo)
            .toBe(tenderUuid);
        expect(fighterHome(dart, world.entities)).toBe(tenderUuid);

        // Contact with the player is not the Dart's docking.
        const playerDarts = count(player, DARTS);
        dock(world, dartUuid, PLAYER);
        await step(world, 1);
        expect(world.entities.has(dartUuid)).toBeTrue();
        expect(count(player, DARTS)).toBe(playerDarts);
    });

    it('docks the Dart into the Tender, then the Tender into the player, '
        + 'which keeps the Tender\'s magazine', async () => {
        const { world, player } = await makeWorld();
        const [tenderUuid, tender] = await launchTender(world, player);
        expect(count(player, TENDERS)).toBe(1);
        const [dartUuid] = await launchDart(world, tenderUuid, tender);
        expect(count(tender, DARTS)).toBe(2);
        const playerDarts = count(player, DARTS);

        recall(tender);
        await step(world, 2);
        dock(world, dartUuid, tenderUuid);
        await step(world, 1);
        expect(world.entities.has(dartUuid)).toBeFalse();
        expect(count(tender, DARTS)).toBe(3);
        expect(count(player, DARTS)).toBe(playerDarts);

        dock(world, tenderUuid, PLAYER);
        await step(world, 1);
        expect(world.entities.has(tenderUuid)).toBeFalse();
        expect(count(player, TENDERS)).toBe(2);
        expect(count(player, DARTS)).toBe(playerDarts);
        expect(player.components.get(HangarComponent)).toEqual([{
            fighter: tenderUuid, bayWeaponId: TENDER_BAY,
            bays: [{ weapon: DART_BAY, count: 1 }],
            magazine: [{ outfit: DARTS, count: 3 }],
        }]);
    });

    it('with the Tender already docked, the Dart docks at the player, is '
        + 'credited to the Tender\'s bay, and relaunches with it',
    async () => {
        const { world, player } = await makeWorld();
        const [tenderUuid, tender] = await launchTender(world, player);
        const [dartUuid, dart] = await launchDart(world, tenderUuid, tender);
        const playerDarts = count(player, DARTS);

        recall(tender);
        await step(world, 2);
        // The Tender gets home first, its Dart still out.
        dock(world, tenderUuid, PLAYER);
        await step(world, 1);
        expect(player.components.get(HangarComponent)![0].magazine)
            .toEqual([{ outfit: DARTS, count: 2 }]);

        // The Dart now flies to the player's ship...
        await step(world, 1);
        expect(fighterHome(dart, world.entities)).toBe(PLAYER);
        expect(dart.components.get(MovementStateComponent)!.turnTo)
            .toBe(PLAYER);
        // ...and docks there, into the Tender's bay, not the player's.
        dock(world, dartUuid, PLAYER);
        await step(world, 1);
        expect(world.entities.has(dartUuid)).toBeFalse();
        expect(count(player, DARTS)).toBe(playerDarts);
        expect(player.components.get(HangarComponent)![0].magazine)
            .toEqual([{ outfit: DARTS, count: 3 }]);

        // Relaunching the Tender brings its Dart back out with it.
        const [, relaunched] = await launchTender(world, player);
        expect(count(relaunched, DARTS)).toBe(3);
        expect(player.components.has(HangarComponent)).toBeFalse();
    });

    it('relaunches a docked Tender with its short magazine, and its '
        + 'still-deployed Dart comes home to the new Tender', async () => {
        const { world, player } = await makeWorld();
        const [tenderUuid, tender] = await launchTender(world, player);
        const [dartUuid, dart] = await launchDart(world, tenderUuid, tender);

        recall(tender);
        await step(world, 2);
        dock(world, tenderUuid, PLAYER);
        await step(world, 1);

        const [newUuid, relaunched] = await launchTender(world, player);
        // Two Darts aboard, not a fresh three: the third is still out.
        expect(count(relaunched, DARTS)).toBe(2);
        expect(dart.components.get(SourceComponent)).toBe(newUuid);
        await step(world, 1);
        expect(dart.components.get(MovementStateComponent)!.turnTo)
            .toBe(newUuid);
        dock(world, dartUuid, newUuid);
        await step(world, 1);
        expect(world.entities.has(dartUuid)).toBeFalse();
        expect(count(relaunched, DARTS)).toBe(3);
    });

    /**
     * GUESS (the brief leaves it open): a Dart whose Tender was destroyed
     * flies to the player's ship, as ruled, and goes aboard the first
     * docked sister Tender with room for it; with none it docks and is
     * lost. Never into the player's own Dart bay.
     */
    async function orphanDart(withDockedSister: boolean) {
        const { world, player } = await makeWorld();
        const [tenderUuid, tender] = await launchTender(world, player);
        const [sisterUuid, sister] = await launchTender(world, player);
        const [dartUuid, dart] = await launchDart(world, tenderUuid, tender);
        if (withDockedSister) {
            // The sister launches a Dart and docks one short of full.
            const [sisterDart] = await launchDart(world, sisterUuid, sister);
            world.entities.delete(sisterDart);
            recall(sister);
            await step(world, 2);
            dock(world, sisterUuid, PLAYER);
            await step(world, 1);
            expect(player.components.get(HangarComponent)![0].magazine)
                .toEqual([{ outfit: DARTS, count: 2 }]);
        }
        const playerDarts = count(player, DARTS);

        // The Tender is destroyed with its Dart out.
        world.entities.delete(tenderUuid);
        recall(dart);
        await step(world, 2);
        expect(fighterHome(dart, world.entities)).toBe(PLAYER);
        expect(dart.components.get(MovementStateComponent)!.turnTo)
            .toBe(PLAYER);
        dock(world, dartUuid, PLAYER);
        await step(world, 1);
        expect(world.entities.has(dartUuid)).toBeFalse();
        expect(count(player, DARTS)).toBe(playerDarts);
        return player;
    }

    it('GUESS: with its Tender destroyed, the Dart docks at the player '
        + 'into a docked sister Tender with room', async () => {
        const player = await orphanDart(true);
        expect(player.components.get(HangarComponent)![0].magazine)
            .toEqual([{ outfit: DARTS, count: 3 }]);
    });

    it('GUESS: with its Tender destroyed and no sister docked, the Dart '
        + 'docks at the player and is lost', async () => {
        const player = await orphanDart(false);
        expect(player.components.has(HangarComponent)).toBeFalse();
    });

    it('registers the hangar as synced simulation state', async () => {
        const { world } = await makeWorld();
        expect(world.resources.get(SerializerResource)!
            .hasComponent(HangarComponent)).toBeTrue();
    });
});
