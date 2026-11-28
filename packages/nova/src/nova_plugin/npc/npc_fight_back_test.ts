import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Position } from 'nova_ecs/datatypes/position';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { getPluginGameData } from '../../communication/simulation_test_fixture.js';
import { GovtComponent, IdFactoryResource } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import {
    DamagedEvent, makeShip, ShieldComponent, ShipDataComponent,
    SourceComponent, TargetComponent,
} from '../ship/index.js';
import { completeEntity, loadShipClassGameData, spawnNpc } from '../spawn/index.js';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { NpcComponent } from './npc_component.js';

/**
 * An AI 3 warship FIGHTS BACK whatever its gövt MaxOdds says; MaxOdds
 * gates only the hunts it starts itself.
 *
 * Playtest: "The Scourge ships from argolian alliance / singularity plugin
 * ... do not fight back when attacked." The Singularity plug-in's gövt 194
 * "scourge" has MaxOdds 0, and NovaJS let the odds call veto every
 * engagement, the aggressor's included, so a Scourge ship shot at just
 * patrolled on. Reference "Scourge: MaxOdds and fighting back"
 * (docs/reference_experiments.md, 2026-11-28): the wave-3 ai_retal rig
 * (the AI 3 AI Subject Disc, Strength 50, against a Strength-100 player)
 * with its gövt's MaxOdds set to 0 and to 1: tickled once, the disc closed
 * in and wore the player's shield down for two minutes both times, like
 * the MaxOdds-1000 control; made xenophobic at MaxOdds 0 it never came at
 * an idle player, where the xenophobic MaxOdds-1000 control did.
 */

const HULL = 'test:warship';
const ODDS0 = 'test:odds0';
const ODDS1 = 'test:odds1';
const ODDS0_XENO = 'test:odds0xeno';
const ODDS1000_XENO = 'test:odds1000xeno';

const SHOT: WeaponDamage = {
    shield: 5, armor: 5, ionization: 0, ionizationColor: 0xffffff,
    passThroughShield: 0, knockback: 0,
};

/**
 * A warship of `govtId` 600 px from a brainless attacker (Strength 100,
 * twice the warship's, so a MaxOdds under 200 calls the fight
 * unfavorable). The attacker "fires" only through `hit`.
 */
async function standoff(govtId: string) {
    const gameData = new MockGameData();
    const hull = getDefaultShipData();
    gameData.data.Ship.map.set(HULL, {
        ...hull, id: HULL, strength: 50,
        physics: {
            ...hull.physics, shield: 1000, shieldRecharge: 0,
            armor: 30000, armorRecharge: 0,
        },
    });
    const govt = getDefaultGovtData();
    gameData.data.Govt.map.set(ODDS0, { ...govt, id: ODDS0, maxOdds: 0 });
    gameData.data.Govt.map.set(ODDS1, { ...govt, id: ODDS1, maxOdds: 1 });
    gameData.data.Govt.map.set(ODDS0_XENO, {
        ...govt, id: ODDS0_XENO, maxOdds: 0,
        flags: { ...govt.flags, xenophobic: true },
    });
    gameData.data.Govt.map.set(ODDS1000_XENO, {
        ...govt, id: ODDS1000_XENO, maxOdds: 1000,
        flags: { ...govt.flags, xenophobic: true },
    });
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, x: number,
        configure: (entity: Entity) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(HULL)!);
        const movement = ship.components.get(MovementStateComponent)!;
        ship.components.set(MovementStateComponent, {
            ...movement, position: new Position(x, 0),
        });
        configure(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }
    const attacker = await addShip('attacker', 0);
    attacker.components.set(ShipDataComponent, {
        ...attacker.components.get(ShipDataComponent)!, strength: 100,
    });
    attacker.components.set(TargetComponent, { target: 'warship' });
    await addShip('warship', 600, ship => {
        ship.components.set(GovtComponent, { id: govtId });
        ship.components.set(NpcComponent, { aiType: 3 });
    });
    world.entities.set('shot',
        new Entity('shot').addComponent(SourceComponent, 'attacker'));
    world.step();
    return world;
}

function hit(world: World) {
    world.emit(DamagedEvent, { damage: SHOT, damager: 'shot' }, ['warship']);
}

function run(world: World, ms: number) {
    const time = () => world.resources.get(TimeResource)!.time;
    const until = time() + ms;
    while (time() < until) {
        world.step();
    }
}

function warship(world: World) {
    const entity = world.entities.get('warship')!;
    return {
        npc: entity.components.get(NpcComponent)!,
        target: entity.components.get(TargetComponent)?.target,
    };
}

describe('an AI 3 warship attacked against the odds', () => {
    for (const [name, govt] of [['MaxOdds 0', ODDS0], ['MaxOdds 1', ODDS1]]) {
        it(`fights back at ${name} (reference "Scourge", 2026-11-28)`,
            async () => {
                const world = await standoff(govt);
                hit(world);
                run(world, 3000);
                expect(warship(world).npc.aggressor).toBe('attacker');
                expect(warship(world).npc.mode).toBe('attack');
                expect(warship(world).target).toBe('attacker');
                // And keeps at it: retaliation is permanent (wave 3).
                run(world, 10_000);
                expect(warship(world).npc.mode).toBe('attack');
                expect(warship(world).target).toBe('attacker');
            });
    }

    it('left alone, a xenophobic MaxOdds 0 warship never starts that '
        + 'fight', async () => {
            const world = await standoff(ODDS0_XENO);
            run(world, 10_000);
            expect(warship(world).npc.mode).not.toBe('attack');
            expect(warship(world).target).toBeUndefined();
        });

    it('left alone, a xenophobic MaxOdds 1000 warship does (the control)',
        async () => {
            const world = await standoff(ODDS1000_XENO);
            run(world, 3000);
            expect(warship(world).npc.mode).toBe('attack');
            expect(warship(world).target).toBe('attacker');
        });

    it('a hostile it would not take on does not shield its aggressor',
        async () => {
            // The xenophobic MaxOdds 0 warship has a NEARER enemy (the
            // bystander, right beside it) whose odds it calls unfavorable,
            // and the attacker farther off: it goes for the attacker.
            const world = await standoff(ODDS0_XENO);
            const bystander = makeShip(world.entities.get('attacker')!
                .components.get(ShipDataComponent)!);
            const movement = bystander.components.get(MovementStateComponent)!;
            bystander.components.set(MovementStateComponent, {
                ...movement, position: new Position(650, 0),
            });
            await completeEntity(world, bystander);
            world.entities.set('bystander', bystander);
            world.step();
            hit(world);
            run(world, 3000);
            expect(warship(world).npc.mode).toBe('attack');
            expect(warship(world).target).toBe('attacker');
        });
});

describe('Singularity\'s Scourge ships (real plug-in data)', () => {
    const SINGULARITY = 'singularity';
    /** Stock gövt 194, redefined by the plug-in as "scourge". */
    const SCOURGE_GOVT = 'nova:194';
    /** Stock düde 271, redefined as "Scourge Warships" (AI 3, gövt 194:
     * Scourge Scouts and both Wyrms). */
    const SCOURGE_WARSHIPS = 'nova:271';
    /** The Raven: a well-armed attacker. */
    const RAVEN = 'nova:164';

    it('fire back at a ship that shoots one', async () => {
        const gameData = await getPluginGameData(SINGULARITY);
        if (!gameData) {
            pending('the singularity plug-in is not installed');
            return;
        }
        // The data that made them passive: a MaxOdds 0 government.
        const govt = await gameData.data.Govt.get(SCOURGE_GOVT);
        expect(govt.name).toBe('scourge');
        expect(govt.maxOdds).toBe(0);
        const dude = await gameData.data.Dude.get(SCOURGE_WARSHIPS);
        expect(dude.aiType).toBe(3);
        expect(dude.govt).toBe(SCOURGE_GOVT);

        const world = await makeSystem('nova:402', gameData, undefined,
            { npcs: false });
        for (const { id } of dude.ships) {
            await loadShipClassGameData(world, id);
        }
        await loadShipClassGameData(world, RAVEN);
        world.step();
        const before = new Set(world.entities.keys());
        spawnNpc(world, gameData, world.resources.get(IdFactoryResource)!,
            world.resources.get(RandomResource)!,
            [{ weight: 100, dude: { aiType: dude.aiType, govt: dude.govt,
                ships: dude.ships } }], false);
        world.step();
        const scourge = [...world.entities].find(([uuid, entity]) =>
            !before.has(uuid) && entity.components.has(NpcComponent));
        expect(scourge).toBeDefined();
        const [scourgeUuid, scourgeShip] = scourge!;

        const attacker = makeShip(await gameData.data.Ship.get(RAVEN));
        const movement = attacker.components.get(MovementStateComponent)!;
        const at = scourgeShip.components.get(MovementStateComponent)!
            .position;
        attacker.components.set(MovementStateComponent, {
            ...movement, position: new Position(at.x + 600, at.y),
        });
        await completeEntity(world, attacker);
        world.entities.set('attacker', attacker);
        attacker.components.set(TargetComponent, { target: scourgeUuid });
        world.entities.set('shot',
            new Entity('shot').addComponent(SourceComponent, 'attacker'));
        world.step();
        const shieldBefore = attacker.components.get(ShieldComponent)!.current;
        world.emit(DamagedEvent, { damage: SHOT, damager: 'shot' },
            [scourgeUuid]);
        run(world, 8000);

        expect(scourgeShip.components.get(NpcComponent)!.mode)
            .toBe('attack');
        expect(scourgeShip.components.get(TargetComponent)?.target)
            .toBe('attacker');
        // Its guns work: the attacker's shield is coming down.
        expect(attacker.components.get(ShieldComponent)!.current)
            .toBeLessThan(shieldBefore);
    }, 240_000);
});
