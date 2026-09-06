import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { System } from 'nova_ecs/system';
import { SingletonComponent, World } from 'nova_ecs/world';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { FireSubs, WeaponEntries } from './fire_weapon_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { SoundEvent } from '../core/sound_plugin.js';

// The Polaron Multi-Torpedo: the stock weapon that splits into five
// Polaron Torpedoes, each of which carries the same firing sound. Firing
// it used to stack five copies of that sample on one frame.
const MULTI_TORP = 'nova:182';
const TORP = 'nova:148';
const TORP_SOUND = 'nova:211';
const SUB_COUNT = 5;

const SHIP_ID = 'nova:128'; // Shuttle.
/** nova:226 (Ver'ashan) is asteroid-free: a quiet battlefield. */
const EMPTY_SYSTEM = 'nova:226';

/**
 * A submunition burst is ONE weapon effect and should be heard once, not
 * once per child. This is the SOURCE-level dedup (exactly one instance
 * for a burst of any size); the display-side per-frame limiter in
 * display/sound_limiter.ts is a second, coarser net that also catches
 * coincidental pileups from unrelated ships.
 */
describe('submunition firing sound (real Nova data)', () => {
    let world: World;
    let sounds: string[];
    let gameData: Awaited<ReturnType<typeof getIntegrationGameData>>;

    beforeEach(async () => {
        gameData = await getIntegrationGameData();
        world = await makeSystem(EMPTY_SYSTEM, gameData, undefined,
            { npcs: false });
        sounds = [];
        world.addSystem(new System({
            name: 'SoundRecorder',
            events: [SoundEvent],
            // SingletonComponent, exactly as the real SoundSystem does:
            // SoundEvent is UNtargeted, so a system without it runs once
            // per matching entity and counts every emission N times.
            args: [SoundEvent, SingletonComponent] as const,
            step({ id }) {
                sounds.push(id);
            },
        }));

        // Warm the weapon caches: fireSubs and the FireSubs resource both
        // go through getCached and silently do nothing on a cold entry.
        const weaponEntries = world.resources.get(WeaponEntries)!;
        await weaponEntries.get(MULTI_TORP);
        await weaponEntries.get(TORP);
    });

    async function addShip(uuid: string) {
        const ship = makeShip(await gameData.data.Ship.get(SHIP_ID));
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, ship);
        ship.components.set(MovementStateComponent, {
            position: new Position(0, 0),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        world.entities.set(uuid, ship);
        return ship;
    }

    it('is the five-child Polaron Multi-Torpedo', async () => {
        // Guard the fixture: if these ids drift, fail loudly here rather
        // than asserting a count that no longer means anything.
        const parent = await gameData.data.Weapon.get(MULTI_TORP);
        expect(parent.name).toEqual('Polaron Multi-Torp.');
        const subs = (parent as { submunitions: { id: string, count: number }[] })
            .submunitions;
        expect(subs.length).toEqual(1);
        expect(subs[0]!.id).toEqual(TORP);
        expect(subs[0]!.count).toEqual(SUB_COUNT);
        const sub = await gameData.data.Weapon.get(TORP);
        expect(sub.name).toEqual('Polaron Torp.');
        expect((sub as { sound?: string }).sound).toEqual(TORP_SOUND);
    });

    it('plays the sub weapon\'s sound ONCE for a five-child burst',
        async () => {
            await addShip('shooter');
            world.step();
            sounds = [];

            world.resources.get(FireSubs)!(MULTI_TORP, 'shooter');
            world.step();

            // One sample, not five.
            expect(sounds.filter(id => id === TORP_SOUND).length).toEqual(1);
        });

    it('still spawns all five children', async () => {
        await addShip('shooter');
        world.step();
        const before = world.entities.size;

        const spawned = world.resources.get(FireSubs)!(MULTI_TORP, 'shooter');
        world.step();

        // Silencing shots must not drop any of them.
        expect(spawned.length).toEqual(SUB_COUNT);
        expect(world.entities.size).toEqual(before + SUB_COUNT);
    });

    it('plays once per submunition EVENT, so two bursts are heard twice',
        async () => {
            // Only children of the SAME event dedup; a weapon that
            // submunitions again later is a new effect and sounds again.
            await addShip('shooter');
            world.step();
            sounds = [];

            const fireSubs = world.resources.get(FireSubs)!;
            fireSubs(MULTI_TORP, 'shooter');
            world.step();
            fireSubs(MULTI_TORP, 'shooter');
            world.step();

            expect(sounds.filter(id => id === TORP_SOUND).length).toEqual(2);
        });

    it('leaves ordinary repeated shots sounding once each', async () => {
        // The dedup is scoped to the submunition loop: N separate shots
        // of the same weapon (a burst over N frames) still sound N times.
        await addShip('shooter');
        world.step();
        sounds = [];

        const torp = world.resources.get(WeaponEntries)!.getCached(TORP)!;
        torp.fireFromEntity('shooter');
        world.step();
        torp.fireFromEntity('shooter');
        world.step();
        torp.fireFromEntity('shooter');
        world.step();

        expect(sounds.filter(id => id === TORP_SOUND).length).toEqual(3);
    });
});
