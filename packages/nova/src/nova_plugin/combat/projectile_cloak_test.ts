import 'jasmine';
import { ProjectileWeaponData } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { getDefaultCloakScannerData } from 'novadatainterface/cloak_scanner_data';
import {
    CloakActiveComponent,
    CloakActiveState,
    CloakScannerComponent,
} from '../ship/cloak_plugin.js';
import { OwnerComponent } from './fire_weapon_plugin.js';
import { DEFAULT_MISSILE_GUIDANCE, MissileGuidanceResource } from './guidance.js';
import { ProjectileDataComponent } from '../core/projectile_data.js';
import { ProjectileGuidanceSystem } from './projectile_plugin.js';
import { TargetComponent } from '../ship/target_component.js';

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
 * missiles lose their lock while the target is cloaked (fly straight),
 * regain it when the target decloaks, and a cloak scanner on the parent
 * ship does NOT exempt its missiles.
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

    it('a cloak scanner on the parent ship does not keep missiles tracking', () => {
        // The parent ship can target cloaked ships with its scanner, but
        // its missiles still lose lock (original-game behavior).
        world.entities.set('parent', new Entity()
            .addComponent(CloakScannerComponent, {
                ...getDefaultCloakScannerData(),
                isCloakScanner: true,
                hasScanner: true,
                targetsCloaked: true,
            }));
        const missile = world.entities.get('missile')!;
        missile.components.set(OwnerComponent, { owner: 'parent' });

        targetCloak.active = true;
        world.step();
        expect(missileMovement.turnTo)
            .withContext('parent scanner must not exempt the missile')
            .toBeNull();
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
