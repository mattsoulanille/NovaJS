import 'jasmine';
import { ProjectileWeaponData } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { RunQuery } from 'nova_ecs/arg_types';
import { restoreWorld, snapshotWorld } from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import {
    decodeCloakScannerModVal, getDefaultCloakScannerData,
} from 'novadatainterface/cloak_scanner_data';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { makeSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import {
    CloakActiveComponent,
    CloakActiveState,
    CloakScannerCapability,
    CloakScannerComponent,
    OutfitsState,
    OutfitsStateComponent,
    SourceComponent,
} from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { loadWeaponsGameData } from '../spawn/index.js';
import { OwnerComponent, WeaponConstructors } from './fire_weapon_plugin.js';
import { DEFAULT_MISSILE_GUIDANCE, MissileGuidanceResource } from './guidance.js';
import {
    deriveEntityComponents, ProjectileDataComponent, SimulationGameDataResource,
} from '../core/index.js';
import { ProjectileGuidanceSystem } from './projectile_plugin.js';
import { TargetComponent } from '../ship/index.js';

function makeMovement(x: number, y: number): MovementState {
    return {
        position: new Position(x, y),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        turning: 0,
        turnBack: false,
        accelerating: 0,
        turnTo: null,
    };
}

// Only shotSpeed is read by the guidance system.
const projectileData = { shotSpeed: 10 } as ProjectileWeaponData;

/**
 * Missile lock vs cloak, per observed original-game behavior: homing
 * missiles lose their lock while the target is cloaked (fly straight) and
 * regain it when the target decloaks, unless their parent ship has a cloak
 * scanner that can target cloaked ships (ModType 30 ModVal 0x0008), which
 * keeps them homing (docs/reference_experiments.md, "J wave 6").
 */
describe('ProjectileGuidanceSystem vs cloak', () => {
    let world: World;
    let missileMovement: MovementState;
    let targetCloak: CloakActiveState;

    beforeEach(() => {
        world = new World();
        world.resources.set(MissileGuidanceResource,
            { mode: DEFAULT_MISSILE_GUIDANCE });
        world.addSystem(ProjectileGuidanceSystem);

        targetCloak = { active: false };
        world.entities.set('target', new Entity()
            .addComponent(MovementStateComponent, makeMovement(100, 50))
            .addComponent(CloakActiveComponent, targetCloak));

        missileMovement = makeMovement(0, 0);
        world.entities.set('missile', new Entity()
            .addComponent(MovementStateComponent, missileMovement)
            .addComponent(TargetComponent, { target: 'target' })
            .addComponent(ProjectileDataComponent, projectileData));
    });

    it('homes on an uncloaked target', () => {
        world.step();
        expect(missileMovement.turnTo).toBeInstanceOf(Angle);
    });

    it('stops homing (flies straight) while the target is cloaked', () => {
        world.step();
        expect(missileMovement.turnTo).toBeInstanceOf(Angle);

        targetCloak.active = true;
        world.step();
        expect(missileMovement.turnTo)
            .withContext('lock suspended: no steering while target cloaked')
            .toBeNull();
    });

    it('regains the lock when the target decloaks', () => {
        targetCloak.active = true;
        world.step();
        expect(missileMovement.turnTo).toBeNull();

        // The TargetComponent still holds the target uuid: the lock was
        // suspended, not cleared.
        const missile = world.entities.get('missile')!;
        expect(missile.components.get(TargetComponent)?.target).toBe('target');

        targetCloak.active = false;
        world.step();
        expect(missileMovement.turnTo)
            .withContext('homing resumes on the same target after decloak')
            .toBeInstanceOf(Angle);
    });

    function addParent(scanner: Partial<CloakScannerCapability> | undefined) {
        const parent = new Entity();
        if (scanner) {
            parent.addComponent(CloakScannerComponent, {
                ...getDefaultCloakScannerData(),
                isCloakScanner: true,
                hasScanner: true,
                ...scanner,
            });
        }
        world.entities.set('parent', parent);
    }

    it('keeps homing on a cloaked target when the parent\'s cloak scanner '
        + 'can target cloaked ships (ModVal 0x0008)', () => {
            // "J wave 6": with a 0x000C scanner keeping the cloaked target
            // selected, every missile still homed and hit on the original.
            addParent({ targetsCloaked: true, targetsUntargetable: true,
                rawModVal: 0x000C });
            world.entities.get('missile')!.components
                .set(OwnerComponent, { owner: 'parent' });

            targetCloak.active = true;
            world.step();
            expect(missileMovement.turnTo)
                .withContext('the parent scanner keeps the lock')
                .toBeInstanceOf(Angle);
        });

    it('reads the scanner of the ship it was fired FROM when it has no '
        + 'owner', () => {
            addParent({ targetsCloaked: true, rawModVal: 0x0008 });
            world.entities.get('missile')!.components
                .set(SourceComponent, 'parent');

            targetCloak.active = true;
            world.step();
            expect(missileMovement.turnTo).toBeInstanceOf(Angle);
        });

    it('still loses the lock when the parent has no scanner, or one that '
        + 'cannot target cloaked ships', () => {
            const missile = world.entities.get('missile')!;
            missile.components.set(OwnerComponent, { owner: 'parent' });
            targetCloak.active = true;

            addParent(undefined);
            world.step();
            expect(missileMovement.turnTo)
                .withContext('no scanner').toBeNull();

            // Reveal-only scanners (0x0001 radar, 0x0002 screen, 0x0004
            // untargetable ships) do not let the parent target a cloaked
            // ship, so they do not keep the lock either.
            addParent({ revealsOnRadar: true, revealsOnScreen: true,
                targetsUntargetable: true, rawModVal: 0x0007 });
            world.step();
            expect(missileMovement.turnTo)
                .withContext('scanner without 0x0008').toBeNull();
        });

    it('loses the lock when its scanning parent is gone', () => {
        world.entities.get('missile')!.components
            .set(OwnerComponent, { owner: 'parent' });
        targetCloak.active = true;
        world.step();
        expect(missileMovement.turnTo).toBeNull();
    });

    it('does not touch projectiles without a target lock', () => {
        const dumbMovement = makeMovement(5, 5);
        dumbMovement.turnTo = new Angle(2);
        world.entities.set('dumbfire', new Entity()
            .addComponent(MovementStateComponent, dumbMovement)
            .addComponent(ProjectileDataComponent, projectileData));

        targetCloak.active = true;
        world.step();
        expect(dumbMovement.turnTo).toEqual(new Angle(2));
    });
});

/**
 * The same rule in a real simulation world, through the real weapon entry,
 * guidance and movement systems and the rollback snapshot layer. The
 * parent's CloakScannerComponent is derived from its outfits and skipped
 * from snapshots, so a restore must re-derive it for the replay to home
 * identically. The scanner is an injected test outfit (ModType 30, ModVal
 * 0x000C, the reference kit's Kit Cloak Scanner T) in a fresh synthetic
 * aggregator's cache, so no other spec sees it.
 */
describe('missiles of a scanning parent in flight', () => {
    const HARRIER = SYNTHETIC.weapons.missile;
    const SCANNER = 'nova:9999';
    let world: World;

    beforeEach(async () => {
        const gameData = makeSyntheticGameData();
        const base = await gameData.data.Outfit.get(SYNTHETIC.outfits.cargoPod);
        gameData.data.Outfit.gotten[SCANNER] = {
            ...base, id: SCANNER, name: 'Test Cloak Scanner',
            cloakScanner: decodeCloakScannerModVal(0x000C),
        };
        world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        await loadWeaponsGameData(world, [HARRIER]);
    });

    function addParent(outfits: OutfitsState) {
        world.entities.set('parent', new Entity('parent')
            .addComponent(MovementStateComponent, makeMovement(0, 100))
            .addComponent(OutfitsStateComponent, outfits));
        world.entities.set('target', new Entity('target')
            .addComponent(MovementStateComponent, makeMovement(300, 0))
            .addComponent(CloakActiveComponent, { active: true }));
        world.step();
    }

    /** Fires a Harrier from (0, 0) facing -y at the cloaked target; returns
     * the closest it came, and the world hash every tick. */
    async function launch() {
        const harrier = await world.resources.get(SimulationGameDataResource)!
            .data.Weapon.get(HARRIER) as ProjectileWeaponData;
        const construct = world.resources.get(WeaponConstructors)!
            .get('ProjectileWeaponData')!;
        const entry = new construct(harrier, world.resources.get(RunQuery)!);
        const missile = entry.fire(new Position(0, 0), new Angle(0),
            'parent', 'target', 'parent')!;
        const uuid = [...world.entities].find(([, e]) => e === missile)![0];
        let closest = Infinity;
        const hashes: string[] = [];
        for (let i = 0; i < 150 && world.entities.has(uuid); i++) {
            world.step();
            hashes.push(hashWorld(world).hash);
            const at = world.entities.get(uuid)
                ?.components.get(MovementStateComponent)?.position;
            if (at) {
                closest = Math.min(closest, Math.hypot(at.x - 300, at.y));
            }
        }
        return { closest, hashes };
    }

    it('homes onto the cloaked target, and replays identically after a '
        + 'rollback', async () => {
            addParent(new Map([[SCANNER, { count: 1 }]]));
            expect(world.entities.get('parent')!.components
                .get(CloakScannerComponent)?.targetsCloaked).toBeTrue();
            const before = snapshotWorld(world);
            const first = await launch();
            expect(first.closest).toBeLessThan(20);

            restoreWorld(world, before, deriveEntityComponents);
            expect(world.entities.get('parent')!.components
                .get(CloakScannerComponent)?.targetsCloaked)
                .withContext('re-derived at restore').toBeTrue();
            const second = await launch();
            expect(second.closest).toBe(first.closest);
            expect(second.hashes).toEqual(first.hashes);
        });

    it('flies straight past without a scanner', async () => {
        addParent(new Map());
        const { closest } = await launch();
        expect(closest).toBeGreaterThan(250);
    });
});
