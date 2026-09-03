import 'jasmine';
import { WeaponData } from 'novadatainterface/weapon_data';
import {
    DEFAULT_IONIZE_COLOR, resolveIonizeColor,
} from 'novadatainterface/weapon_data';
import { EmitNow } from 'nova_ecs/arg_types';
import { UnknownComponent } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { System } from 'nova_ecs/system';
import { SingletonComponent, World } from 'nova_ecs/world';
import {
    getIntegrationGameData, makeSimulationBridgeHarness,
} from '../communication/simulation_test_fixture.js';
import { DamagedEvent } from './death_plugin.js';
import { completeEntity } from './entity_data_loader.js';
import { IonizationColorComponent, IonizationComponent } from './health_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';

/**
 * "IonizeColor: The color that a ship hit by this weapon will appear
 * after being sufficiently ionized (encoded the same as an HTML color
 * value). A value of 0 here will be interpreted as a default bluish
 * color." — EVN Bible, wëap.
 *
 * The colour therefore belongs to the WEAPON, not to the ship and not to
 * the engine. These specs pin that end to end: what the parser reads off
 * real stock weapons, what the simulation records on a victim, and (in
 * ship_animation_test) what the display paints with it.
 */

const SHIP = 'ship under test';

/** wëap IonizeColor of the stock weapons these specs lean on. */
const ION_CANNON = 'nova:142';
const EMP_TORP = 'nova:160';
const POLARON_TORP = 'nova:148';
const NANITES = 'nova:163';
/** Both ship IonizeColor 0 and must come back as the Bible's default. */
const POLARON_MASSIVE_TORP = 'nova:199';
const SOLAR_LANCE = 'nova:164';

describe('resolveIonizeColor (the wëap IonizeColor zero sentinel)', () => {
    it('passes a real colour through untouched', () => {
        expect(resolveIonizeColor(0xff34c2ff)).toEqual(0xff34c2ff);
        expect(resolveIonizeColor(0x00ff00ff)).toEqual(0x00ff00ff);
    });

    it('substitutes the default for a zero field, alpha or not', () => {
        // weap_resource un-inverts Nova's alpha byte, so the raw zero
        // field reaches us as 0xFF000000 rather than 0.
        expect(resolveIonizeColor(0)).toEqual(DEFAULT_IONIZE_COLOR);
        expect(resolveIonizeColor(0xff000000)).toEqual(DEFAULT_IONIZE_COLOR);
    });

    it('never yields a colour that would black the hull out', () => {
        // A multiply tint of 0x000000 does not colour a sprite, it
        // erases it. That is the whole reason the sentinel exists.
        for (const raw of [0, 0xff000000, 0x00000000]) {
            expect(resolveIonizeColor(raw) & 0xffffff).not.toEqual(0);
        }
    });

    it('is bluish, as the Bible says the default is', () => {
        const b = DEFAULT_IONIZE_COLOR & 0xff;
        const g = (DEFAULT_IONIZE_COLOR >> 8) & 0xff;
        const r = (DEFAULT_IONIZE_COLOR >> 16) & 0xff;
        expect(b).toBeGreaterThan(r);
        expect(b).toBeGreaterThan(g);
        // "Using fairly bright colors here is probably the best."
        expect(Math.max(r, g, b)).toBeGreaterThan(0xc0);
    });
});

describe('stock wëap IonizeColor (parsed from real Nova data)', () => {
    let weaponColor: (id: string) => Promise<number>;
    let ionizationOf: (id: string) => Promise<number>;

    beforeEach(async () => {
        const gameData = await getIntegrationGameData();
        const damage = async (id: string) => {
            const weapon = await gameData.data.Weapon.get(id) as WeaponData;
            return (weapon as unknown as {
                damage: { ionization: number, ionizationColor: number },
            }).damage;
        };
        weaponColor = async id => (await damage(id)).ionizationColor & 0xffffff;
        ionizationOf = async id => (await damage(id)).ionization;
    });

    it('gives different weapon families different colours', async () => {
        // The point of the whole feature: an ion cannon and an EMP
        // torpedo do NOT paint a ship the same colour.
        expect(await weaponColor(ION_CANNON)).toEqual(0x34c2ff);   // blue
        expect(await weaponColor(EMP_TORP)).toEqual(0xd4ffff);     // pale cyan
        expect(await weaponColor(POLARON_TORP)).toEqual(0xff00ff); // magenta
        expect(await weaponColor(NANITES)).toEqual(0x5c5c5c);      // grey
    });

    it('resolves the two stock weapons that leave IonizeColor at 0',
        async () => {
            // Polaron Massive Torp. (160 ionization, the heaviest
            // ionizer in the game) and the Solar Lance both ship a zero
            // field. Before the sentinel was honoured they painted the
            // hull pure black.
            expect(await weaponColor(POLARON_MASSIVE_TORP))
                .toEqual(DEFAULT_IONIZE_COLOR & 0xffffff);
            expect(await weaponColor(SOLAR_LANCE))
                .toEqual(DEFAULT_IONIZE_COLOR & 0xffffff);
        });

    it('carries a positive Ionization on every weapon these specs use',
        async () => {
            // If any of these stopped ionizing, the colour specs above
            // would be pinning a field nothing ever reads.
            for (const id of [ION_CANNON, EMP_TORP, POLARON_TORP, NANITES,
                POLARON_MASSIVE_TORP, SOLAR_LANCE]) {
                expect(await ionizationOf(id)).toBeGreaterThan(0);
            }
        });
});

describe('the simulation records the ionizing weapon\'s colour', () => {
    async function shipWorld() {
        const gameData = await getIntegrationGameData();
        const world = await makeSystem('nova:226', gameData, 'worker',
            { npcs: false });
        const shipData = (await gameData.data.Ship.get('nova:128'))!;
        const ship = makeShip(shipData);
        await completeEntity(world, ship);
        world.entities.set(SHIP, ship);
        world.step();
        return { world, ship, gameData };
    }

    /**
     * Fires one hit at the ship under test, the way every real damage
     * source does: emitNow(DamagedEvent) from inside a step system.
     */
    function hitOnce(world: World, damage: Record<string, unknown>) {
        const system = new System({
            name: `TestHit${Math.random()}`,
            args: [EmitNow, SingletonComponent] as const,
            step(emitNow) {
                emitNow(DamagedEvent,
                    { damage: damage as never, damager: 'attacker' },
                    [SHIP]);
            },
        });
        world.addSystem(system);
        world.step();
        world.removeSystem(system);
    }

    const ionizingHit = (ionization: number, ionizationColor: number) => ({
        shield: 0, armor: 0, ionization, ionizationColor,
        knockback: 0, passThroughShield: 1,
    });

    it('starts on the Bible default before anything has hit it',
        async () => {
            const { ship } = await shipWorld();
            expect(ship.components.get(IonizationColorComponent))
                .toEqual({ color: DEFAULT_IONIZE_COLOR });
        });

    it('takes the colour of an ionizing hit', async () => {
        const { world, ship } = await shipWorld();
        hitOnce(world, ionizingHit(20, 0xffff00ff));
        expect(ship.components.get(IonizationColorComponent)!.color)
            .toEqual(0xffff00ff);
        expect(ship.components.get(IonizationComponent)!.current)
            .toBeGreaterThan(0);
    });

    it('lets the LAST ionizing hit win when two weapons disagree',
        async () => {
            // The ruling: the Bible says nothing about mixing two
            // ionizing weapons of different colours, so the most recent
            // ionizing hit owns the hull. Deterministic (the ECS orders
            // DamagedEvent handling), and indistinguishable from any
            // other rule for the ordinary single-weapon barrage.
            const { world, ship } = await shipWorld();
            hitOnce(world, ionizingHit(20, 0xff34c2ff)); // ion cannon
            hitOnce(world, ionizingHit(20, 0xffff00ff)); // polaron torp
            expect(ship.components.get(IonizationColorComponent)!.color)
                .toEqual(0xffff00ff);

            // ...and back again, so it is genuinely "last", not "first
            // non-default" or "brightest".
            hitOnce(world, ionizingHit(20, 0xff34c2ff));
            expect(ship.components.get(IonizationColorComponent)!.color)
                .toEqual(0xff34c2ff);
        });

    it('is not repainted by a hit that does not ionize', async () => {
        const { world, ship } = await shipWorld();
        hitOnce(world, ionizingHit(20, 0xffff00ff));
        // A plain gun: real armour damage, zero Ionization. Its
        // IonizeColor field is meaningless and must not reach the hull.
        hitOnce(world, {
            shield: 0, armor: 5, ionization: 0, ionizationColor: 0xff00ff00,
            knockback: 0, passThroughShield: 1,
        });
        expect(ship.components.get(IonizationColorComponent)!.color)
            .toEqual(0xffff00ff);
    });

    it('is not repainted by a hit that DRAINS ionization', async () => {
        const { world, ship } = await shipWorld();
        hitOnce(world, ionizingHit(20, 0xffff00ff));
        hitOnce(world, ionizingHit(-5, 0xff00ff00));
        expect(ship.components.get(IonizationColorComponent)!.color)
            .toEqual(0xffff00ff);
    });

});

/**
 * The tint is drawn in the DISPLAY world, whose entities are mirrored
 * from the simulation by SimulationBridgeHost.snapshot() — which carries
 * only serializer-registered components. If IonizationColorComponent
 * ever fell off that registration the display would silently fall back
 * to the legacy grey for every ship, with no error anywhere.
 */
describe('the ionization colour crosses the sim -> display bridge', () => {
    it('registers IonizationColorComponent with the simulation serializer',
        async () => {
            const harness = await makeSimulationBridgeHarness();
            const serializer = harness.world.resources
                .get(SerializerResource)!;
            expect(serializer.hasComponent(
                IonizationColorComponent as unknown as UnknownComponent))
                .toBeTrue();
        });

    it('carries the recorded colour in a frame from a live world',
        async () => {
            const { client, world } = await makeSimulationBridgeHarness();
            world.entities.set('ionized-uuid', new Entity('victim')
                .addComponent(IonizationColorComponent, { color: 0xff00ff }));

            const frame = client.snapshot();
            const added = frame.added.find(([uuid]) => uuid === 'ionized-uuid');
            expect(added).toBeDefined();
            const encoded = added![1].components
                .find(([name]) => name === 'IonizationColorComponent');
            expect(encoded).toBeDefined();
            expect(JSON.stringify(encoded![1]))
                .toContain(String(0xff00ff));
        });
});
