import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import { UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { getPluginGameData } from '../../communication/simulation_test_fixture.js';
import { canBuyOutfit, OutfitterContext } from '../../spaceport/outfitter_rules.js';
import { BayFighterComponent } from '../escorts/bay_plugin.js';
import { DamagedEvent } from '../ship/death_plugin.js';
import { completeEntity, loadWeaponGameData } from '../spawn/entity_data_loader.js';
import { EscortCommandComponent } from '../player/escort_command.js';
import { ESCORT_FIRE_RANGE } from '../escorts/escort_command_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { DeathAIComponent } from '../npc/npc_plugin.js';
import { OutfitsStateComponent } from '../ship/outfit_plugin.js';
import { ControlledByComponent } from '../player/ship_control.js';
import { ShipComponent } from '../ship/ship_plugin.js';
import { TargetComponent } from '../ship/target_component.js';
import { weaponReach } from '../ship/weapon_range.js';
import { WeaponsStateComponent } from '../ship/weapons_state.js';

/**
 * ============================================================================
 * The "Intelligent EMP Torpedo" plug-in, against its real resources
 * ============================================================================
 *
 * Matthew's report: "Intelligent emp torpedo doesn't work. It's a bay
 * weapon that fires torpedos that you can command to fight enemy ships by
 * flying into them and exploding. It has a weapon that kills the parent
 * ship when fired."
 *
 * The plug-in is three wëaps, one shïp and two oütfs:
 *
 *   oütf 567 "Intelligent EMP Torpedo Tube"  ModType weapon      -> wëap 262
 *   oütf 568 "Intelligent EMP Torpedo"       ModType ammunition  -> wëap 262
 *   wëap 262 "Combat Drone"    Guidance 99 (bay), AmmoType 666 (the shïp)
 *   shïp 666 "Int. EMP Torpedo"  built-in wëap 261 + wëap 260
 *   wëap 261 "CD exp"          AmmoType -999 -> destroys the torpedo
 *   wëap 260 "CD TB"           the drone's 1-point "tractor beam"
 *
 * Everything the feature needs is in those numbers, so this spec pins
 * them rather than trusting the description — and then flies one.
 *
 * SKIPPED when the plug-in is not installed (getPluginGameData resolves
 * undefined), like every other plug-in-backed spec.
 */

const PLUGIN = 'Intelligent EMP Torpedo';
const BAY = `${PLUGIN}:262`;
const WARHEAD = `${PLUGIN}:261`;
const TRACTOR = `${PLUGIN}:260`;
const TORPEDO_SHIP = `${PLUGIN}:666`;
const TUBE_OUTFIT = `${PLUGIN}:567`;
const TORPEDO_OUTFIT = `${PLUGIN}:568`;
/** Ver'ashan: asteroid-free, so the battlefield is only what we put in
 * it (the same adaptation firing_group_integration_test makes). */
const SYSTEM = 'nova:226';
/** Starbridge: roomy enough to mount the tube, and a plain warship. */
const CARRIER_SHIP = 'nova:151';

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

describe('the Intelligent EMP Torpedo plug-in\'s resources', () => {
    it('is a bay whose fighter is a ship armed with an AmmoType -999 wëap',
        async () => {
            const gameData = await getPluginGameData(PLUGIN);
            if (!gameData) {
                pending('Intelligent EMP Torpedo plug-in not installed');
                return;
            }

            // The launcher: a fighter bay (wëap Guidance 99) that carries
            // shïp 666, with its fighters as its own ammo supply.
            const bay = await gameData.data.Weapon.get(BAY);
            expect(bay.type).toBe('BayWeaponData');
            if (bay.type !== 'BayWeaponData') {
                return;
            }
            expect(bay.shipID).toBe(TORPEDO_SHIP);
            expect(bay.ammoType).toEqual(['weapon', BAY]);
            expect(bay.maxAmmo).toBe(32000);
            expect(bay.destroyShipWhenFiring)
                .withContext('the BAY is an ordinary weapon').toBeFalse();

            // The torpedo carries both built-in weapons as outfits (the
            // shïp WeapType list; neither has an oütf of its own, so they
            // come through as built-in weapon outfits).
            const torpedo = await gameData.data.Ship.get(TORPEDO_SHIP);
            const mounted = Object.keys(torpedo.outfits);
            expect(mounted.some(id => id.startsWith(WARHEAD)))
                .withContext(`wëap 261 mounted, got ${mounted}`).toBeTrue();
            expect(mounted.some(id => id.startsWith(TRACTOR)))
                .withContext(`wëap 260 mounted, got ${mounted}`).toBeTrue();

            // The warhead: the whole feature. AmmoType -999.
            const warhead = await gameData.data.Weapon.get(WARHEAD);
            expect(warhead.destroyShipWhenFiring).toBeTrue();
            expect(warhead.type).toBe('ProjectileWeaponData');
            if (warhead.type !== 'ProjectileWeaponData') {
                return;
            }
            // A 45px/s shot that lives 100ms behind a 120px proximity
            // fuse, with a 100px blast: a contact weapon.
            expect(warhead.proxRadius).toBe(120);
            expect(warhead.blastRadius).toBe(100);
            expect(warhead.damage.armor).toBe(100);
            expect(warhead.damage.shield).toBe(340);
            // ...whose reach is two orders of magnitude short of the flat
            // radius the AI would otherwise fire it at. This gap is the
            // reason suicide weapons get their own fire gate.
            expect(weaponReach(warhead)).toBeLessThan(200);
            expect(weaponReach(warhead)).toBeLessThan(ESCORT_FIRE_RANGE / 5);
        });

    it('sells the tube and the torpedoes as a launcher/ammo pair',
        async () => {
            const gameData = await getPluginGameData(PLUGIN);
            if (!gameData) {
                pending('Intelligent EMP Torpedo plug-in not installed');
                return;
            }
            const tube = await gameData.data.Outfit.get(TUBE_OUTFIT);
            const torpedoes = await gameData.data.Outfit.get(TORPEDO_OUTFIT);
            expect(tube.weapons).toEqual({ [BAY]: 1 });
            expect(torpedoes.ammoFor).toBe(BAY);

            const shipData = await gameData.data.Ship.get(CARRIER_SHIP);
            const bay = await gameData.data.Weapon.get(BAY);
            const outfits = new Map<string, OutfitData>([
                [TUBE_OUTFIT, tube], [TORPEDO_OUTFIT, torpedoes],
            ]);
            const context = (owned: Array<[string, number]>):
                OutfitterContext => ({
                    shipData,
                    outfits: new Map(owned),
                    getOutfit: id => outfits.get(id),
                    getWeapon: id => id === BAY ? bay : undefined,
                    bits: new Set<number>(),
                    credits: 100_000_000,
                });

            // The tube is buyable outright (cost 0, Availability !b424,
            // and b424 is not set).
            expect(canBuyOutfit(tube, context([]))).toEqual({ allowed: true });
            // Torpedoes need a tube to live in: the bay's MaxAmmo times
            // the bays mounted is the magazine, and with no bay that is
            // zero.
            expect(canBuyOutfit(torpedoes, context([])).allowed).toBeFalse();
            expect(canBuyOutfit(torpedoes, context([[TUBE_OUTFIT, 1]])))
                .toEqual({ allowed: true });
        });
});

describe('flying the real Intelligent EMP Torpedo', () => {
    it('launches, is commanded onto an enemy, flies in and detonates',
        async () => {
            const gameData = await getPluginGameData(PLUGIN);
            if (!gameData) {
                pending('Intelligent EMP Torpedo plug-in not installed');
                return;
            }
            const world = await makeSystem(SYSTEM, gameData, undefined,
                { npcs: false });
            // The tube is not part of any ship's stock loadout, so its
            // closure (the bay, shïp 666, and the torpedo's own weapons)
            // has to be warmed the way staging would warm it.
            await loadWeaponGameData(gameData, BAY);
            // The tube and its ammo are not in any ship's stock loadout
            // either, and the ammo count is read synchronously.
            await gameData.data.Outfit.get(TUBE_OUTFIT);
            await gameData.data.Outfit.get(TORPEDO_OUTFIT);

            const damaged: Array<{ uuid: string, armor: number }> = [];
            world.addSystem(new System({
                name: 'DamageRecorder',
                events: [DamagedEvent],
                args: [DamagedEvent, UUID] as const,
                step({ damage }, uuid) {
                    damaged.push({ uuid, armor: damage.armor });
                },
            }));

            const addShip = async (uuid: string, id: string,
                x: number, y: number, setup: (s: Entity) => void) => {
                const ship = makeShip(await gameData.data.Ship.get(id));
                ship.components.set(MovementStateComponent, {
                    accelerating: 0,
                    position: new Position(x, y),
                    rotation: new Angle(0),
                    turnBack: false,
                    turning: 0,
                    velocity: new Vector(0, 0),
                });
                setup(ship);
                await completeEntity(world, ship);
                world.entities.set(uuid, ship);
                return ship;
            };

            // Far from the system's planets so nothing else is in the way.
            const carrier = await addShip('carrier', CARRIER_SHIP,
                4000, 4000, ship => {
                    ship.components.set(ControlledByComponent,
                        { peerId: 'test peer' });
                    ship.components.set(TargetComponent, { target: 'enemy' });
                });
            // A sitting duck: no AI of any kind, so it neither shoots
            // back nor manoeuvres.
            await addShip('enemy', CARRIER_SHIP, 4000, 4400, ship => {
                ship.components.set(DeathAIComponent, undefined);
            });
            await stepWorld(world, 2);

            // Fit the tube and load one torpedo, as the outfitter would.
            // Reassigned (not mutated) so the weapon-state provider
            // re-derives and the bay appears on the ship.
            const owned = carrier.components.get(OutfitsStateComponent)!;
            carrier.components.set(OutfitsStateComponent, new Map([...owned,
            [TUBE_OUTFIT, { count: 1 }], [TORPEDO_OUTFIT, { count: 1 }]]));
            await stepWorld(world, 2);

            const bayState = carrier.components
                .get(WeaponsStateComponent)!.get(BAY);
            expect(bayState).withContext('the tube mounted').toBeDefined();

            // Launch. The magazine holds exactly one torpedo, so
            // holding the trigger down launches exactly one — no need to
            // guess which tick the bay's weapon entry finishes loading.
            bayState!.firing = true;
            // wëap 262 reloads in 3.3s, and the world's clock starts at
            // zero, so the bay is not ready until then.
            await stepWorld(world, 220);
            bayState!.firing = false;
            await stepWorld(world, 2);

            const launched = [...world.entities].filter(([, e]) =>
                e.components.has(BayFighterComponent));
            expect(launched.length).withContext('one torpedo away').toBe(1);
            const [torpedoUuid, torpedo] = launched[0];
            expect(torpedo.components.get(ShipComponent)!.id)
                .toBe(TORPEDO_SHIP);
            // It spent a torpedo from the magazine.
            expect(carrier.components.get(OutfitsStateComponent)!
                .get(TORPEDO_OUTFIT)!.count).toBe(0);

            // The player's "attack my target" order, as
            // EscortCommandInputSystem writes it.
            torpedo.components.set(EscortCommandComponent,
                { command: 'attack', target: 'enemy' });

            // One tick in it is still 400px out — far inside the escort
            // fire radius, and far outside the warhead's reach.
            await stepWorld(world, 1);
            expect(torpedo.components.get(WeaponsStateComponent)!
                .get(WARHEAD)?.firing ?? false)
                .withContext('holds fire at 400px').toBeFalse();

            // Now let it fly the 400px in (shïp 666 does 180px/s).
            await stepWorld(world, 400);

            expect(world.entities.has(torpedoUuid))
                .withContext('the torpedo spent itself').toBeFalse();
            const warheadHits = damaged.filter(
                ({ uuid, armor }) => uuid === 'enemy' && armor >= 100);
            expect(warheadHits.length)
                .withContext(`a 100-armor EMP hit landed; saw `
                    + JSON.stringify(damaged)).toBeGreaterThan(0);
        });
});
