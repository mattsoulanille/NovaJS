import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { GameDataAggregator } from '../server/parsing/game_data_aggregator.js';
import { completeEntity } from '../nova_plugin/spawn/entity_data_loader.js';
import { WeaponEntries } from '../nova_plugin/combat/fire_weapon_plugin.js';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import { ActiveMissionType, CreditsComponent, MissionsComponent } from '../nova_plugin/player/player_state_plugin.js';
import { ControlledByComponent, PEER_LOCAL_COMPONENTS } from '../nova_plugin/player/ship_control.js';
import { ShipPhysicsComponent } from '../nova_plugin/ship/ship_plugin.js';
import { WeaponsStateComponent } from '../nova_plugin/ship/weapons_state.js';
import { applyInputRecords, InputRecord, loadInputRecordsGameData } from './simulation_input.js';
import { getIntegrationGameData, makeIntegrationGameData } from './simulation_test_fixture.js';

/**
 * An in-flight mission acceptance can GRANT an outfit (OnAccept Gxxx).
 * Applying the record puts the new id into the player's OutfitsState and
 * drops WeaponsState/ShipPhysics for the providers to rebuild from the
 * game-data cache — `Outfit.getCached` / `Weapon.getCached`, which
 * return undefined ("retry next step") on a miss. Nothing staged the
 * granted ids: the originating peer's worker had the outfit warm by
 * luck of its preload, and every other world (the archive, late joiners)
 * rebuilt the components at a load-timing-dependent tick — a state fork.
 *
 * The control here is a world over a FRESH aggregator (its own cold
 * cache), against a world whose cache is warm: after staging the record
 * the way every replaying world does (loadInputRecordsGameData), both
 * must carry the same derived components on the same tick.
 */
describe('acceptMission outfit grants', () => {
    const PEER = 'a';

    async function findGrantableOutfit(gameData: GameDataAggregator,
        shipId: string) {
        const shipData = await gameData.data.Ship.get(shipId);
        const stockWeapons = new Set<string>();
        for (const outfitId of Object.keys(shipData.outfits)) {
            const outfit = await gameData.data.Outfit.get(outfitId);
            for (const weaponId of Object.keys(outfit?.weapons ?? {})) {
                stockWeapons.add(weaponId);
            }
        }
        const ids = await gameData.ids;
        for (const id of [...ids.Outfit].sort()) {
            const outfit = await gameData.data.Outfit.get(id);
            for (const wid of Object.keys(outfit?.weapons ?? {})) {
                if (stockWeapons.has(wid)) {
                    continue;
                }
                const weapon = await gameData.data.Weapon.get(wid);
                if (weapon?.type === 'ProjectileWeaponData') {
                    return { outfitId: id, weaponId: wid };
                }
            }
        }
        return undefined;
    }

    async function makePlayerWorld(gameData: GameDataAggregator,
        systemId: string, shipId: string) {
        const world = await makeSystem(systemId, gameData, 'node', { npcs: false });
        const ship = makeShip(await gameData.data.Ship.get(shipId));
        // makeShip places a ship at random; the two worlds must start
        // identical for their hashes to be comparable.
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(0, 0),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        ship.components.set(ControlledByComponent, { peerId: PEER });
        ship.components.set(MissionsComponent, new Map());
        ship.components.set(CreditsComponent, { credits: 0 });
        await completeEntity(world, ship);
        world.entities.set('player', ship);
        for (let i = 0; i < 5; i++) {
            world.step();
        }
        return { world, ship };
    }

    function grantRecord(outfitId: string, tick: number): InputRecord {
        return {
            peerId: PEER, tick,
            inputs: [{
                kind: 'acceptMission',
                accepted: {
                    missionId: 'nova:134',
                    mission: ActiveMissionType.encode({
                        id: 'nova:134', acceptedDay: 0, acceptedAt: 'nova:128',
                        travelPlanet: null, returnPlanet: null,
                        cargoType: -1, cargoQty: 0, cargoLoaded: false,
                        travelDone: false, deadlineDay: null,
                    }),
                    outfitsDelta: [[outfitId, 1]],
                },
            }],
        };
    }

    function derived(ship: Entity) {
        return {
            physics: ship.components.get(ShipPhysicsComponent),
            weapons: ship.components.get(WeaponsStateComponent),
        };
    }

    it('a replaying world with a cold cache rebuilds the same weapons and '
        + 'physics on the same tick as a warm one', async () => {
            const warmData = await getIntegrationGameData();
            const ids = await warmData.ids;
            const systemId = [...ids.System].sort()[0]!;
            const shipId = [...ids.Ship].sort()[0]!;
            const grant = await findGrantableOutfit(warmData, shipId);
            expect(grant).withContext(
                'game data has no non-stock weapon outfit to test with')
                .toBeDefined();
            const { outfitId, weaponId } = grant!;

            // The warm world: the originating peer, whose cache already
            // holds the outfit (getIntegrationGameData is process-wide).
            const warm = await makePlayerWorld(warmData, systemId, shipId);
            // The cold world: a replaying world (archive, late joiner)
            // over an aggregator that never loaded the granted weapon.
            // (The OUTFIT is warm everywhere: the aggregator preloads
            // every Outfit into its own cache at construction. The
            // grant's weapon is what the providers reach for cold.)
            const coldData = makeIntegrationGameData();
            const cold = await makePlayerWorld(coldData, systemId, shipId);
            // (Inspected through the cache's own store: getCached would
            // START a background load, warming the control by accident.)
            const coldWeapons = (coldData.data.Weapon as unknown as
                { gotten: Record<string, unknown> }).gotten;
            expect(weaponId in coldWeapons)
                .withContext('the control must start cold').toBeFalse();
            expect(hashWorld(cold.world, PEER_LOCAL_COMPONENTS).hash)
                .withContext('the worlds must agree before the grant')
                .toBe(hashWorld(warm.world, PEER_LOCAL_COMPONENTS).hash);

            const tick = warm.world.resources.get(TimeResource)!.frame + 1;
            const record = grantRecord(outfitId, tick);
            // Both worlds stage the record the way every replaying world
            // does, then apply and step it in lockstep.
            await loadInputRecordsGameData(warm.world, [record]);
            await loadInputRecordsGameData(cold.world, [record]);
            for (const { world } of [warm, cold]) {
                applyInputRecords(world, [record]);
                world.step();
            }

            const warmDerived = derived(warm.ship);
            const coldDerived = derived(cold.ship);
            expect(warmDerived.weapons?.get(weaponId)?.count)
                .withContext('the warm world fires the granted weapon').toBe(1);
            expect(warmDerived.physics).toBeDefined();
            expect(coldDerived.weapons?.get(weaponId)?.count)
                .withContext('the cold world must have staged the grant: '
                    + `weapon ${weaponId} of outfit ${outfitId}`).toBe(1);
            expect(coldDerived.physics)
                .withContext('the cold world must have staged the outfit')
                .toBeDefined();
            expect(cold.world.resources.get(WeaponEntries)!.getCached(weaponId))
                .withContext('the weapon entry is primed for a synchronous '
                    + 'first shot').toBeDefined();
            expect(cold.ship.components.get(OutfitsStateComponent)!.get(outfitId))
                .toEqual({ count: 1 });

            // And the two timelines agree, hash for hash.
            expect(hashWorld(cold.world, PEER_LOCAL_COMPONENTS).hash)
                .toBe(hashWorld(warm.world, PEER_LOCAL_COMPONENTS).hash);
        });

    it('an outfit the game data cannot load is reported and skipped, not a '
        + 'staging failure', async () => {
            // A hostile record can name any id. The aggregator itself
            // answers an unknown id with a default outfit (deterministic
            // on every world), but a data source can also REJECT — a
            // fetch failure on a browser worker — and a rejected staging
            // would wedge the archive on that record forever.
            const gameData = await getIntegrationGameData();
            const ids = await gameData.ids;
            const systemId = [...ids.System].sort()[0]!;
            const world = await makeSystem(systemId, gameData, 'node', { npcs: false });
            const outfits = gameData.data.Outfit;
            const realGet = outfits.get.bind(outfits);
            spyOn(outfits, 'get').and.callFake((id: string, priority?: number) =>
                id === 'nova:999999'
                    ? Promise.reject(new Error('no such outfit'))
                    : realGet(id, priority));
            const warned = spyOn(console, 'warn');
            const record = grantRecord('nova:999999', 1);
            await expectAsync(loadInputRecordsGameData(world, [record]))
                .toBeResolved();
            expect(warned).toHaveBeenCalledWith(
                jasmine.stringMatching(/nova:999999 could not be staged/));
            expect(world instanceof World).toBeTrue();
        });
});
