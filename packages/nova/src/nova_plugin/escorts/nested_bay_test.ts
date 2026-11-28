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
import { World } from 'nova_ecs/world';
import { countDeployedFighters } from '../../spaceport/deployed_outfits.js';
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
    BayFighterComponent, fighterHome, ReturnComponent,
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
 * destroyed it returns to the player's ship and is credited to nothing,
 * never to the player's own Dart bay (which the player mounts here too,
 * so a mix-up would show).
 *
 * And (Matthew's ruling, the same day): docking replenishes. A Tender
 * that docks relaunches with a full magazine of Darts, whatever it spent
 * or still has out.
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
    return { world, player, gameData };
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
        + 'which relaunches it full', async () => {
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

        const [, relaunched] = await launchTender(world, player);
        expect(count(relaunched, DARTS)).toBe(3);
    });

    it('relaunches a Tender that docked with spent Darts full', async () => {
        const { world, player } = await makeWorld();
        const [tenderUuid, tender] = await launchTender(world, player);
        // Its Dart is shot down: the Tender's magazine is one short.
        const [dartUuid] = await launchDart(world, tenderUuid, tender);
        world.entities.delete(dartUuid);
        expect(count(tender, DARTS)).toBe(2);

        recall(tender);
        await step(world, 2);
        dock(world, tenderUuid, PLAYER);
        await step(world, 1);
        expect(count(player, TENDERS)).toBe(2);

        const [, relaunched] = await launchTender(world, player);
        expect(count(relaunched, DARTS)).toBe(3);
    });

    it('relaunches a Tender that docked with an EMPTY magazine full',
        async () => {
            const { world, player } = await makeWorld();
            const [tenderUuid, tender] = await launchTender(world, player);
            tender.components.get(OutfitsStateComponent)!.get(DARTS)!.count
                = 0;
            recall(tender);
            await step(world, 2);
            dock(world, tenderUuid, PLAYER);
            await step(world, 1);

            const [, relaunched] = await launchTender(world, player);
            expect(count(relaunched, DARTS)).toBe(3);
        });

    it('with the Tender already docked, the Dart docks at the player and '
        + 'is credited to nothing', async () => {
        const { world, player } = await makeWorld();
        const [tenderUuid, tender] = await launchTender(world, player);
        const [dartUuid, dart] = await launchDart(world, tenderUuid, tender);
        const playerDarts = count(player, DARTS);

        recall(tender);
        await step(world, 2);
        // The Tender gets home first, its Dart still out.
        dock(world, tenderUuid, PLAYER);
        await step(world, 1);
        expect(count(player, TENDERS)).toBe(2);

        // The Dart now flies to the player's ship...
        await step(world, 1);
        expect(fighterHome(dart, world.entities)).toBe(PLAYER);
        expect(dart.components.get(MovementStateComponent)!.turnTo)
            .toBe(PLAYER);
        // ...and docks there, credited neither to the player's own Dart
        // bay nor to anything else.
        dock(world, dartUuid, PLAYER);
        await step(world, 1);
        expect(world.entities.has(dartUuid)).toBeFalse();
        expect(count(player, DARTS)).toBe(playerDarts);
        expect(count(player, TENDERS)).toBe(2);

        // The Tender relaunches with its full three Darts.
        const [, relaunched] = await launchTender(world, player);
        expect(count(relaunched, DARTS)).toBe(3);
    });

    it('relaunches a docked Tender full though its Dart is still out, and '
        + 'that Dart, ordered home, docks at the player', async () => {
        const { world, player } = await makeWorld();
        const [tenderUuid, tender] = await launchTender(world, player);
        const [dartUuid, dart] = await launchDart(world, tenderUuid, tender);
        const playerDarts = count(player, DARTS);

        recall(tender);
        await step(world, 2);
        dock(world, tenderUuid, PLAYER);
        await step(world, 1);

        const [newUuid, relaunched] = await launchTender(world, player);
        // A fresh three, not two: docking replenished it.
        expect(count(relaunched, DARTS)).toBe(3);
        // The old Dart is not re-pointed at the new Tender.
        expect(dart.components.get(SourceComponent)).toBe(tenderUuid);
        recall(dart);
        await step(world, 1);
        expect(fighterHome(dart, world.entities)).toBe(PLAYER);
        dock(world, dartUuid, newUuid);
        await step(world, 1);
        expect(world.entities.has(dartUuid)).toBeTrue();
        dock(world, dartUuid, PLAYER);
        await step(world, 1);
        expect(world.entities.has(dartUuid)).toBeFalse();
        expect(count(relaunched, DARTS)).toBe(3);
        expect(count(player, DARTS)).toBe(playerDarts);
    });

    /**
     * Carrier destroyed (left as the nested-bay change made it, the
     * sister-record credit aside): a Dart whose Tender was destroyed
     * flies to the player's ship, as ruled, and docks there, credited to
     * nothing. A docked sister Tender relaunches full regardless.
     */
    it('with its Tender destroyed, the Dart docks at the player and is '
        + 'credited to nothing', async () => {
        const { world, player } = await makeWorld();
        const [tenderUuid, tender] = await launchTender(world, player);
        const [sisterUuid, sister] = await launchTender(world, player);
        const [dartUuid, dart] = await launchDart(world, tenderUuid, tender);
        // The sister launches a Dart, loses it, and docks one short.
        const [sisterDart] = await launchDart(world, sisterUuid, sister);
        world.entities.delete(sisterDart);
        recall(sister);
        await step(world, 2);
        dock(world, sisterUuid, PLAYER);
        await step(world, 1);
        const playerDarts = count(player, DARTS);
        const playerTenders = count(player, TENDERS);

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
        expect(count(player, TENDERS)).toBe(playerTenders);

        const [, relaunched] = await launchTender(world, player);
        expect(count(relaunched, DARTS)).toBe(3);
    });

    it('still charges a deployed Tender to the outfitter\'s Tender cap, '
        + 'and stops once it docks', async () => {
        const { world, player, gameData } = await makeWorld();
        const deployed = () => countDeployedFighters(world.entities, PLAYER,
            id => gameData.data.Outfit.map.get(id))([TENDERS, DARTS]);
        const [tenderUuid] = await launchTender(world, player);
        expect(count(player, TENDERS)).toBe(1);
        expect(deployed().get(TENDERS)).toBe(1);

        recall(world.entities.get(tenderUuid)!);
        await step(world, 2);
        dock(world, tenderUuid, PLAYER);
        await step(world, 1);
        expect(count(player, TENDERS)).toBe(2);
        expect(deployed().get(TENDERS)).toBeUndefined();
    });

    it('does not charge the Tender\'s Dart to the player\'s own Dart bay '
        + 'cap, in flight or after its Tender docks', async () => {
        // RULING (Matthew, 2026-11-27): "Another carrier escort's dart
        // should not count against your limit." The player mounts a Dart
        // bay supplied by the very outfit the Tender's Dart came from.
        const { world, player, gameData } = await makeWorld();
        const deployed = () => countDeployedFighters(world.entities, PLAYER,
            id => gameData.data.Outfit.map.get(id))([TENDERS, DARTS]);
        const [tenderUuid, tender] = await launchTender(world, player);
        await launchDart(world, tenderUuid, tender);
        expect(deployed().get(TENDERS)).toBe(1);
        expect(deployed().get(DARTS)).toBeUndefined();

        // The player's OWN Dart does count.
        const before = launchedFrom(world, PLAYER).length;
        const dartBay = player.components.get(WeaponsStateComponent)!
            .get(DART_BAY)!;
        dartBay.firing = true;
        await step(world, 2);
        dartBay.firing = false;
        expect(launchedFrom(world, PLAYER).length).toBe(before + 1);
        expect(deployed().get(DARTS)).toBe(1);

        // With the Tender home, its orphaned Dart flies to the player but
        // is still not the player's: credited to nothing on docking, so
        // it holds no slot of the player's bay while it is out.
        recall(tender);
        await step(world, 2);
        dock(world, tenderUuid, PLAYER);
        await step(world, 1);
        expect(deployed().get(TENDERS)).toBeUndefined();
        expect(deployed().get(DARTS)).toBe(1);
    });
});
