import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import {
    BeamWeaponData, getDefaultBeamWeaponData, getDefaultProjectileWeaponData,
    ProjectileWeaponData, WeaponData,
} from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { ReturnWhenTargetRemovedComponent, startReturnHome } from '../escorts/index.js';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import {
    AGGRESSION_DAMAGE_THRESHOLD, AGGRESSION_WINDOW_MS,
    AggressionComponent,
} from '../combat/index.js';
import { ExplodingComponent } from '../ship/index.js';
import { DisabledComponent } from '../ship/index.js';
import { SimulationGameDataResource, SystemIdResource } from '../core/index.js';
import { getQuadrant, styleForTarget } from '../combat/index.js';
import { AggressionSuppressGovtsComponent } from '../ncb/index.js';
import { completeEntity } from '../spawn/index.js';
import { ArmorComponent } from '../ship/index.js';
import { EscortCommandComponent, EscortOrdersComponent } from './escort_command.js';
import {
    DEFEND_RADIUS, formationTurretKind, inFrontQuadrant, inRearQuadrant,
} from '../escorts/index.js';
import { Entity } from 'nova_ecs/entity';
import { FiringGroupComponent } from '../ship/index.js';
import { OwnerComponent, SourceComponent } from '../combat/index.js';
import { PlayerEscortComponent, NO_DEAL } from './player_escort.js';
import { GovtComponent } from '../core/index.js';
import { makeShip } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { FormationComponent, NpcComponent } from '../npc/index.js';
import { applyControlEvents, ControlledByComponent } from './ship_control.js';
import { TargetComponent } from '../ship/index.js';
import { WeaponsStateComponent } from '../ship/index.js';

const PEER = 'test peer';
const FQ_WEAPON = 'test:fq';
const GUN_WEAPON = 'test:gun';
// Range: speed 500 px/s * 2 s = 1000 px.
const FQ_RANGE = 1000;
// Full turret (wëap guidance 4), rear-quadrant turret (guidance 8) and
// turreted beam (guidance 3), on their own hulls (see makeWorld's
// escortShip) so the specs above keep their two-weapon escort.
const TURRET_WEAPON = 'test:turret';
const RQ_WEAPON = 'test:rq';
const BEAM_TURRET_WEAPON = 'test:beamTurret';
/** Turret + rear-quadrant turret + fixed gun. */
const TURRET_SHIP = 'test:turretShip';
/** A turreted beam alone (a beam's shot has no velocity, which
 * fireOffAxis cannot read). */
const BEAM_TURRET_SHIP = 'test:beamTurretShip';
/** Rear-quadrant turret + fixed gun: the reference's rear-turret disc
 * (E-fight wave 5), so fireOffAxis reads the rear turret's shots alone. */
const RQ_SHIP = 'test:rqShip';

async function makeWorld(options: { escortShip?: string } = {}) {
    const gameData = new MockGameData();

    const fqWeapon: ProjectileWeaponData = {
        ...getDefaultProjectileWeaponData(),
        id: FQ_WEAPON,
        guidance: 'frontQuadrant',
        reload: 1,
        shotDuration: 2000,
        fireGroup: 'primary',
    };
    fqWeapon.physics = { ...fqWeapon.physics, speed: 500 };
    gameData.data.Weapon.map.set(FQ_WEAPON, fqWeapon);
    gameData.data.Weapon.map.set(GUN_WEAPON, {
        ...getDefaultProjectileWeaponData(),
        id: GUN_WEAPON,
        guidance: 'unguided',
        reload: 1,
        shotDuration: 2000,
        fireGroup: 'primary',
    });
    gameData.data.Outfit.map.set('test:fqOutfit', {
        ...getDefaultOutfitData(),
        id: 'test:fqOutfit',
        weapons: { [FQ_WEAPON]: 1 },
    });
    gameData.data.Outfit.map.set('test:gunOutfit', {
        ...getDefaultOutfitData(),
        id: 'test:gunOutfit',
        weapons: { [GUN_WEAPON]: 1 },
    });
    gameData.data.Ship.map.set('test:ship', {
        ...getDefaultShipData(),
        id: 'test:ship',
        outfits: { 'test:fqOutfit': 1, 'test:gunOutfit': 1 },
    });
    for (const guidance of ['turret', 'rearQuadrant'] as const) {
        const id = guidance === 'turret' ? TURRET_WEAPON : RQ_WEAPON;
        const weapon: ProjectileWeaponData = {
            ...getDefaultProjectileWeaponData(),
            id,
            guidance,
            reload: 1,
            shotDuration: 2000,
            fireGroup: 'primary',
        };
        weapon.physics = { ...weapon.physics, speed: 500 };
        gameData.data.Weapon.map.set(id, weapon);
    }
    const beamTurret: BeamWeaponData = {
        ...getDefaultBeamWeaponData(),
        id: BEAM_TURRET_WEAPON,
        guidance: 'beamTurret',
        reload: 1,
        fireGroup: 'primary',
    };
    beamTurret.beamAnimation = { ...beamTurret.beamAnimation, length: 600 };
    gameData.data.Weapon.map.set(BEAM_TURRET_WEAPON, beamTurret);
    for (const id of [TURRET_WEAPON, RQ_WEAPON, BEAM_TURRET_WEAPON]) {
        gameData.data.Outfit.map.set(`${id}Outfit`, {
            ...getDefaultOutfitData(),
            id: `${id}Outfit`,
            weapons: { [id]: 1 },
        });
    }
    gameData.data.Ship.map.set(TURRET_SHIP, {
        ...getDefaultShipData(),
        id: TURRET_SHIP,
        outfits: {
            [`${TURRET_WEAPON}Outfit`]: 1,
            [`${RQ_WEAPON}Outfit`]: 1,
            'test:gunOutfit': 1,
        },
    });
    gameData.data.Ship.map.set(BEAM_TURRET_SHIP, {
        ...getDefaultShipData(),
        id: BEAM_TURRET_SHIP,
        outfits: { [`${BEAM_TURRET_WEAPON}Outfit`]: 1 },
    });
    gameData.data.Ship.map.set(RQ_SHIP, {
        ...getDefaultShipData(),
        id: RQ_SHIP,
        outfits: { [`${RQ_WEAPON}Outfit`]: 1, 'test:gunOutfit': 1 },
    });

    const pirate = getDefaultGovtData();
    pirate.id = 'test:pirate';
    pirate.flags.xenophobic = true;
    gameData.data.Govt.map.set('test:pirate', pirate);
    const meek = getDefaultGovtData();
    meek.id = 'test:meek';
    gameData.data.Govt.map.set('test:meek', meek);
    // Warm the caches the sim reads synchronously.
    await gameData.data.Govt.get('test:pirate');
    await gameData.data.Govt.get('test:meek');

    const world = await makeSystem('test:system', gameData);

    async function addShip(uuid: string, x: number, y: number,
        setup: (ship: ReturnType<typeof makeShip>) => void = () => { },
        shipId = 'test:ship') {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(x, y),
            // Angle π/2: facing +x.
            rotation: new Angle(Math.PI / 2),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
    }

    await addShip('player', 0, 0, ship => {
        ship.components.set(ControlledByComponent, { peerId: PEER });
    });
    await addShip('escort', 0, 200, ship => {
        ship.components.set(FormationComponent, { leader: 'player', slot: 0 });
        ship.components.set(EscortCommandComponent, { command: 'formation' });
    }, options.escortShip);
    world.step();
    return { world, addShip };
}

function press(world: World, action: string) {
    applyControlEvents(world, PEER,
        [{ action: action as never, state: 'start' }]);
    world.step();
    applyControlEvents(world, PEER,
        [{ action: action as never, state: false }]);
    world.step();
}

function command(world: World, uuid = 'escort') {
    return world.entities.get(uuid)!.components.get(EscortCommandComponent)!;
}

/**
 * Turns the harness escort into what every REAL escort is: an NPC ship
 * (makeNpcShip stamps NpcComponent) that also carries an escort
 * command. NpcDecisionSystem yields to the escort framework for these,
 * so the mode stays whatever it was — never 'attack'.
 */
function makeNpcEscort(world: World, uuid = 'escort') {
    world.entities.get(uuid)!.components
        .set(NpcComponent, { aiType: 1 });
}

/**
 * A pirate WARSHIP (AI 3) whose brain never runs. Hostile on sight to the
 * flagless player (on_sight.ts), so the corners and the escorts read it as
 * hostile without a target lock — a pirate TRADER would read neutral
 * (reference K9) — while the far-future nextDecision keeps it parked where
 * the spec put it.
 */
function parkedWarship() {
    return { aiType: 3, nextDecision: Number.MAX_SAFE_INTEGER };
}

function setPlayerTarget(world: World, target: string | undefined) {
    world.entities.get('player')!.components
        .set(TargetComponent, { target });
}

/** The unsigned angle between two vectors, in degrees. */
function degreesBetween(a: Vector, b: Vector) {
    return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y))
        * 180 / Math.PI;
}

/**
 * Holds each ship in `placements` 400px from `shooter` at the given
 * bearing off its CURRENT nose (re-placed every tick, so formation
 * turning can't carry it out of the quadrant) until the shooter's first
 * shots appear. Returns a function giving, for a ship, how far (degrees)
 * the best-aimed of those shots' tracks misses the line to it. The ships
 * stand still, so a shot aimed at one flies along the line from its own
 * position to it.
 */
function fireOffAxis(world: World,
    placements: Array<readonly [string, number]>, shooter = 'escort') {
    const movementOf = (uuid: string) => world.entities.get(uuid)!
        .components.get(MovementStateComponent)!;
    for (let i = 0; i < 60; i++) {
        const source = movementOf(shooter);
        for (const [uuid, bearing] of placements) {
            const ship = movementOf(uuid);
            ship.position = source.position.add(source.rotation.add(bearing)
                .getUnitVector().scale(400)) as Position;
            ship.velocity = new Vector(0, 0);
        }
        world.step();
        const tracks = [...world.entities]
            .filter(([, entity]) =>
                entity.components.get(SourceComponent) === shooter)
            .map(([, entity]) =>
                entity.components.get(MovementStateComponent)!);
        if (tracks.length > 0) {
            return (uuid: string) => Math.min(...tracks.map(track =>
                degreesBetween(track.velocity,
                    movementOf(uuid).position.subtract(track.position))));
        }
    }
    throw new Error(`${shooter} never fired`);
}

describe('escort commands', () => {
    it('attack: fights the player target until it is destroyed, then ' +
        'returns to formation', async () => {
            const { world, addShip } = await makeWorld();
            await addShip('enemy', 500, 0);
            setPlayerTarget(world, 'enemy');
            press(world, 'attack');
            expect(command(world)).toEqual(
                { command: 'attack', target: 'enemy' });
            // The escort locks on and opens fire in range.
            world.step();
            expect(world.entities.get('escort')!.components
                .get(TargetComponent)!.target).toBe('enemy');
            const weapons = world.entities.get('escort')!.components
                .get(WeaponsStateComponent)!;
            expect([...weapons.values()].some(w => w.firing)).toBeTrue();
            // Victim destroyed: back to formation, guns silent.
            world.entities.delete('enemy');
            world.step();
            expect(command(world).command).toBe('formation');
            expect([...weapons.values()].every(w => !w.firing)).toBeTrue();
        });

    it('attack without a player target still sets the order (the ' +
        'original does), with no victim', async () => {
            const { world } = await makeWorld();
            setPlayerTarget(world, undefined);
            press(world, 'attack');
            expect(command(world)).toEqual({ command: 'attack' });
            world.step();
            expect(command(world)).toEqual({ command: 'attack' });
        });

    it('a new command interrupts the current one', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('enemy', 500, 0);
        setPlayerTarget(world, 'enemy');
        press(world, 'attack');
        expect(command(world).command).toBe('attack');
        press(world, 'holdPosition');
        expect(command(world).command).toBe('holdPosition');
        press(world, 'formation');
        expect(command(world).command).toBe('formation');
    });

    it('commands only reach DIRECT escorts; wings mirror their ' +
        'carrier instead', async () => {
            const { world, addShip } = await makeWorld();
            // A wing fighter launched from the ESCORT's bay.
            await addShip('wing', 30, 230, ship => {
                ship.components.set(FormationComponent,
                    { leader: 'escort', slot: 0 });
                ship.components.set(EscortCommandComponent,
                    { command: 'formation' });
                ship.components.set(OwnerComponent, { owner: 'escort' });
                ship.components.set(SourceComponent, 'escort');
            });
            await addShip('enemy', 500, 0);
            setPlayerTarget(world, 'enemy');
            press(world, 'attack');
            // Direct escort commanded; the wing was NOT commanded
            // directly, but mirrors its carrier on the next tick.
            expect(command(world, 'escort'))
                .toEqual({ command: 'attack', target: 'enemy' });
            world.step();
            expect(command(world, 'wing'))
                .toEqual({ command: 'attack', target: 'enemy' });
            // Carrier completes (victim gone) -> wing follows it back.
            world.entities.delete('enemy');
            world.step();
            world.step();
            expect(command(world, 'escort').command).toBe('formation');
            expect(command(world, 'wing').command).toBe('formation');
        });

    it('defend: engages an iff-hostile intruder inside DEFEND_RADIUS, ' +
        'ignores ships outside it', async () => {
            const { world, addShip } = await makeWorld();
            await addShip('farPirate', DEFEND_RADIUS + 800, 200, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent, parkedWarship());
            });
            await addShip('meek', 300, 200, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
            });
            press(world, 'defend');
            world.step();
            // Nothing hostile in range: still watching, on station.
            expect(command(world).command).toBe('defend');
            expect(command(world).target).toBeUndefined();
            // A pirate wanders into the bubble.
            await addShip('nearPirate', 400, 200, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent, parkedWarship());
            });
            world.step();
            world.step();
            expect(command(world).target).toBe('nearPirate');
            // Attack-until-DISABLED: the engagement ends the moment the
            // intruder disables, and a disabled ship is never re-picked
            // as an intruder.
            const pirateArmor = world.entities.get('nearPirate')!
                .components.get(ArmorComponent)!;
            pirateArmor.current = 0.1 * pirateArmor.max;
            world.step(); // ShipDisableSystem disables the pirate...
            world.step(); // ...and the escort disengages.
            expect(world.entities.get('nearPirate')!.components
                .has(DisabledComponent)).toBeTrue();
            expect(command(world).command).toBe('defend');
            expect(command(world).target).toBeUndefined();
            // Repaired above the threshold, it becomes a threat again.
            pirateArmor.current = pirateArmor.max;
            world.step();
            world.step();
            expect(command(world).target).toBe('nearPirate');
            // Destruction ends the engagement too.
            world.entities.delete('nearPirate');
            world.step();
            expect(command(world).command).toBe('defend');
            expect(command(world).target).toBeUndefined();
        });

    it('defend: an exploding intruder is dropped and never re-picked, ' +
        'guns silent', async () => {
            const { world, addShip } = await makeWorld();
            await addShip('nearPirate', 400, 200, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent, parkedWarship());
            });
            press(world, 'defend');
            world.step();
            world.step();
            expect(command(world).target).toBe('nearPirate');
            const weapons = world.entities.get('escort')!.components
                .get(WeaponsStateComponent)!;
            expect([...weapons.values()].some(w => w.firing)).toBeTrue();
            // The intruder starts its death sequence: it is beyond
            // shooting at, exactly as the attack arm treats it.
            world.entities.get('nearPirate')!.components
                .set(ExplodingComponent, 1e12);
            world.step();
            expect(command(world).command).toBe('defend');
            expect(command(world).target).toBeUndefined();
            expect([...weapons.values()].every(w => !w.firing)).toBeTrue();
            // Still in the bubble, still exploding: not an intruder.
            world.step();
            world.step();
            expect(command(world).target).toBeUndefined();
            expect([...weapons.values()].every(w => !w.firing)).toBeTrue();
        });

    it('holdPosition: brakes to rest and stays put; knocked around, it ' +
        'stops again without returning', async () => {
            const { world } = await makeWorld();
            const movement = world.entities.get('escort')!.components
                .get(MovementStateComponent)!;
            movement.velocity = new Vector(120, 0);
            press(world, 'holdPosition');
            for (let i = 0; i < 600; i++) {
                world.step();
            }
            const stopped = world.entities.get('escort')!.components
                .get(MovementStateComponent)!;
            expect(stopped.velocity.length).toBeLessThan(1);
            const restingPosition = Position.fromVectorLike(stopped.position);
            // A hit knocks it away: it re-stops where it ends up.
            stopped.velocity = new Vector(0, 80);
            for (let i = 0; i < 600; i++) {
                world.step();
            }
            const after = world.entities.get('escort')!.components
                .get(MovementStateComponent)!;
            expect(after.velocity.length).toBeLessThan(1);
            // It did NOT fly back to the original hold point.
            expect(after.position.subtract(restingPosition).length)
                .toBeGreaterThan(20);
        });

    it('returnToBay: bay-launched fighters fly home to dock; plain ' +
        'escorts just return to formation', async () => {
            const { world, addShip } = await makeWorld();
            await addShip('fighter', 40, 220, ship => {
                ship.components.set(FormationComponent,
                    { leader: 'player', slot: 1 });
                ship.components.set(EscortCommandComponent,
                    { command: 'formation' });
                ship.components.set(ReturnWhenTargetRemovedComponent,
                    undefined);
                ship.components.set(OwnerComponent, { owner: 'player' });
                ship.components.set(SourceComponent, 'player');
            });
            press(world, 'returnToBay');
            world.step();
            const fighter = world.entities.get('fighter')!;
            expect([...fighter.components.keys()]
                .some(component => component.name === 'ReturnComponent'))
                .toBeTrue();
            // The plain hired escort has no bay: back to formation.
            expect(command(world, 'escort').command).toBe('formation');
        });

    it('front-quadrant turrets fire opportunistically in formation — ' +
        'and the fixed gun does not', async () => {
            const { world, addShip } = await makeWorld();
            const escort = () => world.entities.get('escort')!;
            const rotation = () => escort().components
                .get(MovementStateComponent)!.rotation;
            const position = () => escort().components
                .get(MovementStateComponent)!.position;
            // A pirate dead ahead, well inside the weapon's range.
            const ahead = rotation().getUnitVector().scale(FQ_RANGE * 0.5);
            await addShip('pirate', position().x + ahead.x,
                position().y + ahead.y, ship => {
                    ship.components.set(GovtComponent, { id: 'test:pirate' });
                    ship.components.set(NpcComponent, parkedWarship());
                });
            // Re-place ahead of the CURRENT facing each tick so slow
            // formation turning can't move it out of the quadrant.
            for (let i = 0; i < 3; i++) {
                const unit = rotation().getUnitVector();
                world.entities.get('pirate')!.components
                    .get(MovementStateComponent)!.position =
                    position().add(unit.scale(FQ_RANGE * 0.5)) as Position;
                world.step();
            }
            const weapons = escort().components
                .get(WeaponsStateComponent)!;
            expect(weapons.get(FQ_WEAPON)!.firing).toBeTrue();
            expect(weapons.get(FQ_WEAPON)!.target).toBe('pirate');
            // The plain gun holds fire: fixed guns never fire from the
            // slot (formationTurretKind).
            expect(weapons.get(GUN_WEAPON)!.firing).toBeFalse();

            // Behind the escort: out of the front quadrant, no fire.
            for (let i = 0; i < 3; i++) {
                const unit = rotation().getUnitVector();
                world.entities.get('pirate')!.components
                    .get(MovementStateComponent)!.position =
                    position().add(unit.scale(-FQ_RANGE * 0.5)) as Position;
                world.step();
            }
            expect(weapons.get(FQ_WEAPON)!.firing).toBeFalse();

            // Ahead but out of range: no fire.
            for (let i = 0; i < 3; i++) {
                const unit = rotation().getUnitVector();
                world.entities.get('pirate')!.components
                    .get(MovementStateComponent)!.position =
                    position().add(unit.scale(FQ_RANGE * 3)) as Position;
                world.step();
            }
            expect(weapons.get(FQ_WEAPON)!.firing).toBeFalse();
        });

    // Matthew's report: "Front quadrant turrets of escorts in formation
    // currently fire straight forward instead of at the enemy ship as
    // they should." The formation rule CHOSE the victim (weapon.target,
    // pinned above) but the shot was aimed off the escort's own ship-level
    // TargetComponent, which a formation escort does not set — and a
    // front-quadrant turret with no target "fires straight ahead if no
    // target" (EVN Bible, wëap Guidance 7). Placed 30° off the nose, a
    // straight-ahead shot misses by 30°.
    for (const npc of [false, true]) {
        it('a formation escort\'s front-quadrant turret aims its shots at '
            + `the hostile it chose, not straight ahead${npc
                ? ' (NPC-brained escort)' : ''}`, async () => {
                const { world, addShip } = await makeWorld();
                if (npc) {
                    makeNpcEscort(world);
                }
                await addShip('pirate', 400, 400, ship => {
                    ship.components.set(GovtComponent, { id: 'test:pirate' });
                    ship.components.set(NpcComponent, parkedWarship());
                });
                const error = fireOffAxis(world, [['pirate', Math.PI / 6]]);
                expect(error('pirate')).toBeLessThan(2);
            });
    }

    it('under the restrict-turrets order the formation turret aims at '
        + "the player's target among several hostiles", async () => {
            const { world, addShip } = await makeWorld();
            for (const uuid of ['pirateA', 'pirateB']) {
                await addShip(uuid, 400, 400, ship => {
                    ship.components.set(GovtComponent, { id: 'test:pirate' });
                    ship.components.set(NpcComponent, parkedWarship());
                });
            }
            press(world, 'escortRestrictFire');
            setPlayerTarget(world, 'pirateB');
            const error = fireOffAxis(world,
                [['pirateA', -Math.PI / 8], ['pirateB', Math.PI / 8]]);
            expect(error('pirateB')).toBeLessThan(2);
        });

    // The flip side of the fix: only an AI aims with its weapon's own
    // target. A pilot's front-quadrant turret tracks the ship THEY
    // locked, whatever a weapon state carries over from an AI past.
    it("a pilot's front-quadrant turret aims at the ship's own lock, not "
        + 'a leftover weapon-state target', async () => {
            const { world, addShip } = await makeWorld();
            for (const uuid of ['pirate', 'decoy']) {
                await addShip(uuid, -400, -400, ship => {
                    ship.components.set(GovtComponent, { id: 'test:pirate' });
                    ship.components.set(NpcComponent, parkedWarship());
                });
            }
            setPlayerTarget(world, 'pirate');
            world.entities.get('player')!.components
                .get(WeaponsStateComponent)!.get(FQ_WEAPON)!.target = 'decoy';
            applyControlEvents(world, PEER,
                [{ action: 'firePrimary', state: 'start' }]);
            const error = fireOffAxis(world,
                [['pirate', Math.PI / 6], ['decoy', -Math.PI / 6]], 'player');
            expect(error('pirate')).toBeLessThan(2);
            expect(error('decoy')).toBeGreaterThan(20);
        });

    it('front-quadrant turrets ignore non-hostile ships', async () => {
        const { world, addShip } = await makeWorld();
        const escort = () => world.entities.get('escort')!;
        for (let i = 0; i < 3; i++) {
            const m = escort().components.get(MovementStateComponent)!;
            if (!world.entities.has('meek')) {
                const unit = m.rotation.getUnitVector();
                await addShip('meek', m.position.x + unit.x * 300,
                    m.position.y + unit.y * 300, ship => {
                        ship.components.set(GovtComponent,
                            { id: 'test:meek' });
                    });
            } else {
                const unit = m.rotation.getUnitVector();
                world.entities.get('meek')!.components
                    .get(MovementStateComponent)!.position =
                    m.position.add(unit.scale(300)) as Position;
            }
            world.step();
        }
        const weapons = escort().components.get(WeaponsStateComponent)!;
        expect(weapons.get(FQ_WEAPON)!.firing).toBeFalse();
    });

    it('the restrict-turrets order limits opportunistic fire to the ' +
        "player's current target", async () => {
            const { world, addShip } = await makeWorld();
            const escort = () => world.entities.get('escort')!;
            const place = (uuid: string, along: number) => {
                const m = escort().components.get(MovementStateComponent)!;
                const unit = m.rotation.getUnitVector();
                const perpendicular = new Vector(-unit.y, unit.x);
                world.entities.get(uuid)!.components
                    .get(MovementStateComponent)!.position =
                    m.position.add(unit.scale(400))
                        .add(perpendicular.scale(along)) as Position;
            };
            await addShip('pirateA', 400, 200, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent, parkedWarship());
            });
            await addShip('pirateB', 450, 200, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent, parkedWarship());
            });
            // Restrict on; the player targets pirateB.
            press(world, 'escortRestrictFire');
            expect(world.entities.get('player')!.components
                .get(EscortOrdersComponent)?.restrictTurretsToTarget)
                .toBeTrue();
            setPlayerTarget(world, 'pirateB');
            for (let i = 0; i < 3; i++) {
                place('pirateA', -50);
                place('pirateB', 50);
                world.step();
            }
            const weapons = escort().components
                .get(WeaponsStateComponent)!;
            expect(weapons.get(FQ_WEAPON)!.firing).toBeTrue();
            expect(weapons.get(FQ_WEAPON)!.target).toBe('pirateB');
            // No player target: restricted turrets stay silent even
            // with hostiles in the quadrant.
            setPlayerTarget(world, undefined);
            for (let i = 0; i < 3; i++) {
                place('pirateA', -50);
                place('pirateB', 50);
                world.step();
            }
            expect(weapons.get(FQ_WEAPON)!.firing).toBeFalse();
        });

    // --- Full turrets in formation (reference_experiments "E-fight") --
    //
    // On the original, two escorts with guidance-4 guns held their slots
    // for 95 s while raiders made passes at the player, and fired bolts
    // from the slot at raiders 200+ px away. Full turrets therefore fire
    // in formation in every direction; fixed guns never do (nothing they
    // could hit without turning off the slot heading; wave 5 measured
    // that too), and rear-quadrant turrets fire at ships astern (wave 5:
    // they took a raider behind the formation to 74% shield).
    describe('full turrets in formation', () => {
        /** Parks `uuid` `distance` px from the escort at `bearing` off its
         * CURRENT nose for `ticks` ticks (formation turning cannot carry
         * it elsewhere). */
        function holdAt(world: World, uuid: string, bearing: number,
            ticks = 3, distance = 400) {
            const escort = world.entities.get('escort')!.components
                .get(MovementStateComponent)!;
            const ship = world.entities.get(uuid)!.components
                .get(MovementStateComponent)!;
            for (let i = 0; i < ticks; i++) {
                ship.position = escort.position.add(escort.rotation
                    .add(bearing).getUnitVector().scale(distance)) as Position;
                ship.velocity = new Vector(0, 0);
                world.step();
            }
        }

        async function turretWorld(npc: boolean) {
            const made = await makeWorld({ escortShip: TURRET_SHIP });
            if (npc) {
                makeNpcEscort(made.world);
            }
            await made.addShip('pirate', 400, 400, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent, parkedWarship());
            });
            return made;
        }

        const weaponsOf = (world: World) => world.entities.get('escort')!
            .components.get(WeaponsStateComponent)!;

        for (const npc of [false, true]) {
            const suffix = npc ? ' (NPC-brained escort)' : '';
            it('a full turret fires at a hostile ahead, beside or behind '
                + `the escort, from its slot${suffix}`, async () => {
                    const { world } = await turretWorld(npc);
                    const weapons = weaponsOf(world);
                    for (const bearing of [Math.PI / 2, Math.PI,
                        -Math.PI / 2, 0]) {
                        holdAt(world, 'pirate', bearing);
                        expect(weapons.get(TURRET_WEAPON)!.firing)
                            .withContext(`bearing ${bearing}`).toBeTrue();
                        expect(weapons.get(TURRET_WEAPON)!.target)
                            .toBe('pirate');
                        expect(weapons.get(GUN_WEAPON)!.firing)
                            .withContext(`gun, bearing ${bearing}`)
                            .toBeFalse();
                    }
                    // Still a formation escort: no order, no ship lock.
                    expect(command(world).command).toBe('formation');
                    expect(world.entities.get('escort')!.components
                        .get(TargetComponent)?.target).toBeUndefined();
                });

            it(`a full turret's shots fly at the hostile${suffix}`,
                async () => {
                    const { world } = await turretWorld(npc);
                    const error = fireOffAxis(world,
                        [['pirate', 3 * Math.PI / 4]]);
                    expect(error('pirate')).toBeLessThan(2);
                });
        }

        it('a rear-quadrant turret fires at a hostile astern from its '
            + 'slot, and only astern (E-fight wave 5)', async () => {
                for (const npc of [false, true]) {
                    const { world } = await turretWorld(npc);
                    const weapons = weaponsOf(world);
                    holdAt(world, 'pirate', Math.PI);
                    expect(weapons.get(RQ_WEAPON)!.firing)
                        .withContext(`astern, npc ${npc}`).toBeTrue();
                    expect(weapons.get(RQ_WEAPON)!.target).toBe('pirate');
                    // 30° off the tail: still the rear quadrant.
                    holdAt(world, 'pirate', Math.PI - Math.PI / 6);
                    expect(weapons.get(RQ_WEAPON)!.firing)
                        .withContext(`30° off the tail, npc ${npc}`)
                        .toBeTrue();
                    // Ahead and abeam: out of its quadrant (the full
                    // turret beside it still fires).
                    for (const bearing of [0, Math.PI / 2, -Math.PI / 2]) {
                        holdAt(world, 'pirate', bearing);
                        expect(weapons.get(RQ_WEAPON)!.firing)
                            .withContext(`bearing ${bearing}, npc ${npc}`)
                            .toBeFalse();
                        expect(weapons.get(TURRET_WEAPON)!.firing)
                            .toBeTrue();
                    }
                    // Astern but beyond the shot's reach (500 px/s * 2 s).
                    holdAt(world, 'pirate', Math.PI, 3, 1500);
                    expect(weapons.get(RQ_WEAPON)!.firing)
                        .withContext(`out of reach, npc ${npc}`).toBeFalse();
                    // The fixed gun never fires, and the order stands.
                    expect(weapons.get(GUN_WEAPON)!.firing).toBeFalse();
                    expect(command(world).command).toBe('formation');
                }
            });

        it("a rear-quadrant turret's shots fly at the hostile behind, "
            + 'not straight back', async () => {
                const { world, addShip } = await makeWorld(
                    { escortShip: RQ_SHIP });
                await addShip('pirate', 400, 400, ship => {
                    ship.components.set(GovtComponent, { id: 'test:pirate' });
                    ship.components.set(NpcComponent, parkedWarship());
                });
                // 30° off the tail: a shot fired straight back would miss
                // by 30°.
                const error = fireOffAxis(world,
                    [['pirate', Math.PI - Math.PI / 6]]);
                expect(error('pirate')).toBeLessThan(2);
            });

        it('a rear-quadrant turret holds fire at a non-hostile astern',
            async () => {
                const { world, addShip } = await makeWorld(
                    { escortShip: RQ_SHIP });
                await addShip('meek', 0, 0, ship => {
                    ship.components.set(GovtComponent, { id: 'test:meek' });
                });
                holdAt(world, 'meek', Math.PI);
                expect(weaponsOf(world).get(RQ_WEAPON)!.firing).toBeFalse();
            });

        it('a full turret holds fire beyond its reach and at non-hostile '
            + 'ships', async () => {
                const { world, addShip } = await turretWorld(false);
                const weapons = weaponsOf(world);
                // Reach: 500 px/s * 2 s (+ a zero proximity radius).
                holdAt(world, 'pirate', Math.PI, 3, 1500);
                expect(weapons.get(TURRET_WEAPON)!.firing).toBeFalse();
                world.entities.delete('pirate');
                await addShip('meek', 0, 0, ship => {
                    ship.components.set(GovtComponent, { id: 'test:meek' });
                });
                holdAt(world, 'meek', Math.PI);
                expect(weapons.get(TURRET_WEAPON)!.firing).toBeFalse();
            });

        it('the restrict-turrets order narrows a full turret to the '
            + "player's target", async () => {
                const { world, addShip } = await turretWorld(false);
                await addShip('pirateB', 400, 400, ship => {
                    ship.components.set(GovtComponent, { id: 'test:pirate' });
                    ship.components.set(NpcComponent, parkedWarship());
                });
                press(world, 'escortRestrictFire');
                setPlayerTarget(world, 'pirateB');
                const escort = world.entities.get('escort')!.components
                    .get(MovementStateComponent)!;
                const far = world.entities.get('pirateB')!.components
                    .get(MovementStateComponent)!;
                // The other pirate is nearer; the turret takes the target.
                for (let i = 0; i < 3; i++) {
                    far.position = escort.position.add(escort.rotation
                        .add(Math.PI).getUnitVector().scale(600)) as Position;
                    far.velocity = new Vector(0, 0);
                    holdAt(world, 'pirate', Math.PI / 2, 1, 200);
                }
                const weapons = weaponsOf(world);
                expect(weapons.get(TURRET_WEAPON)!.firing).toBeTrue();
                expect(weapons.get(TURRET_WEAPON)!.target).toBe('pirateB');
            });

        it('a turreted beam (guidance 3) fires from formation too',
            async () => {
                const { world, addShip } = await makeWorld(
                    { escortShip: BEAM_TURRET_SHIP });
                await addShip('pirate', 400, 400, ship => {
                    ship.components.set(GovtComponent, { id: 'test:pirate' });
                    ship.components.set(NpcComponent, parkedWarship());
                });
                holdAt(world, 'pirate', Math.PI);
                const weapons = weaponsOf(world);
                expect(weapons.get(BEAM_TURRET_WEAPON)!.firing).toBeTrue();
                expect(weapons.get(BEAM_TURRET_WEAPON)!.target)
                    .toBe('pirate');
            });

        it('a hostile parked in front of the formation never pulls the '
            + 'escort off its slot (fixed guns hold, the turret fires)',
            async () => {
                const quiet = await makeWorld({ escortShip: TURRET_SHIP });
                const { world } = await turretWorld(false);
                const pirate = world.entities.get('pirate')!.components
                    .get(MovementStateComponent)!;
                const at = (w: World) => w.entities.get('escort')!
                    .components.get(MovementStateComponent)!.position;
                let fired = false;
                for (let i = 0; i < 300; i++) {
                    // 300 px ahead of the PLAYER (who faces +x): where a
                    // fixed gun would have to turn the escort to bear.
                    pirate.position = new Position(300, 0);
                    pirate.velocity = new Vector(0, 0);
                    world.step();
                    quiet.world.step();
                    const weapons = weaponsOf(world);
                    fired ||= weapons.get(TURRET_WEAPON)!.firing;
                    expect(weapons.get(GUN_WEAPON)!.firing).toBeFalse();
                }
                expect(fired).toBeTrue();
                expect(command(world).command).toBe('formation');
                // It flies the same course as the same escort with no
                // hostile in the system: firing changes nothing about
                // where it is.
                expect(at(world).subtract(at(quiet.world)).length)
                    .toBeLessThan(1);
            });
    });

    describe('formationTurretKind', () => {
        const projectile = (guidance: ProjectileWeaponData['guidance'])
            : WeaponData => ({ ...getDefaultProjectileWeaponData(), guidance });
        const beam = (guidance: BeamWeaponData['guidance']): WeaponData =>
            ({ ...getDefaultBeamWeaponData(), guidance });

        it('reads guidance 4 and 3 as full turrets, 7 as front-quadrant, '
            + '8 as rear-quadrant', () => {
                expect(formationTurretKind(projectile('turret'))).toBe('full');
                expect(formationTurretKind(beam('beamTurret'))).toBe('full');
                expect(formationTurretKind(projectile('frontQuadrant')))
                    .toBe('frontQuadrant');
                expect(formationTurretKind(projectile('rearQuadrant')))
                    .toBe('rearQuadrant');
            });

        it('holds every other weapon, fixed guns above all', () => {
            for (const guidance of ['unguided', 'guided', 'rocket',
                'freefallBomb', 'pointDefense'] as const) {
                expect(formationTurretKind(projectile(guidance)))
                    .withContext(guidance).toBeUndefined();
            }
            for (const guidance of ['beam', 'pointDefenseBeam'] as const) {
                expect(formationTurretKind(beam(guidance)))
                    .withContext(guidance).toBeUndefined();
            }
            expect(formationTurretKind(undefined)).toBeUndefined();
        });
    });

    // --- Escorts that are also NPC ships -----------------------------
    //
    // The specs above build the escort with makeShip, which does NOT
    // add NpcComponent — but two of the three kinds of escort the game
    // actually creates DO carry it, and that is what made Matthew's
    // "escorts sometimes don't fire" report look intermittent:
    //
    //   hired    (browser.ts spawnHiredEscorts -> makeNpcShip)  NPC
    //   captured (boarding_plugin convertToEscort)              NPC
    //   bay      (bay_plugin BayWeaponEntry.fire -> makeShip)   not NPC
    //
    // NpcFireControlSystem used to cease-fire on every NpcComponent
    // ship whose npc.mode was not 'attack' — which a commanded escort's
    // never is, since NpcDecisionSystem yields to this framework. So
    // hired escorts and captured prizes never fired while bay fighters
    // did. See the bail at the top of NpcFireControlSystem.
    describe('an escort that is also an NPC ship (hired / captured)',
        () => {
            it('attack: opens fire on the commanded victim', async () => {
                const { world, addShip } = await makeWorld();
                makeNpcEscort(world);
                await addShip('enemy', 500, 0);
                setPlayerTarget(world, 'enemy');
                press(world, 'attack');
                world.step();
                const weapons = world.entities.get('escort')!.components
                    .get(WeaponsStateComponent)!;
                expect(world.entities.get('escort')!.components
                    .get(TargetComponent)!.target).toBe('enemy');
                expect([...weapons.values()].some(w => w.firing)).toBeTrue();
            });

            it('attack: keeps firing tick after tick', async () => {
                const { world, addShip } = await makeWorld();
                makeNpcEscort(world);
                await addShip('enemy', 500, 0);
                setPlayerTarget(world, 'enemy');
                press(world, 'attack');
                const weapons = world.entities.get('escort')!.components
                    .get(WeaponsStateComponent)!;
                for (let i = 0; i < 10; i++) {
                    world.step();
                    expect([...weapons.values()].some(w => w.firing))
                        .withContext(`tick ${i}`).toBeTrue();
                }
            });

            it('defend: opens fire on an intruder', async () => {
                const { world, addShip } = await makeWorld();
                makeNpcEscort(world);
                await addShip('nearPirate', 400, 200, ship => {
                    ship.components.set(GovtComponent, { id: 'test:pirate' });
                    ship.components.set(NpcComponent, parkedWarship());
                });
                press(world, 'defend');
                world.step();
                world.step();
                expect(command(world).target).toBe('nearPirate');
                const weapons = world.entities.get('escort')!.components
                    .get(WeaponsStateComponent)!;
                expect([...weapons.values()].some(w => w.firing)).toBeTrue();
            });

            it('holdPosition still holds fire', async () => {
                const { world, addShip } = await makeWorld();
                makeNpcEscort(world);
                await addShip('enemy', 500, 0);
                setPlayerTarget(world, 'enemy');
                press(world, 'attack');
                world.step();
                press(world, 'holdPosition');
                world.step();
                const weapons = world.entities.get('escort')!.components
                    .get(WeaponsStateComponent)!;
                expect([...weapons.values()].every(w => !w.firing)).toBeTrue();
            });

            it('formation still restricts opportunistic fire to ' +
                'turrets', async () => {
                    const { world, addShip } = await makeWorld();
                    makeNpcEscort(world);
                    // A pirate dead ahead of the escort (which faces +x),
                    // inside front-quadrant reach.
                    await addShip('pirate', 400, 200, ship => {
                        ship.components.set(GovtComponent,
                            { id: 'test:pirate' });
                        ship.components.set(NpcComponent, parkedWarship());
                    });
                    press(world, 'formation');
                    world.step();
                    const weapons = world.entities.get('escort')!.components
                        .get(WeaponsStateComponent)!;
                    // The front-quadrant turret fires; the plain gun does
                    // not (the formation rule is unchanged for NPC
                    // escorts).
                    expect(weapons.get(FQ_WEAPON)!.firing).toBeTrue();
                    expect(weapons.get(GUN_WEAPON)!.firing).toBeFalse();
                });
        });

    // Each real escort kind by its actual component mix, so the fix is
    // pinned for all three rather than for the NPC case alone.
    describe('every kind of escort fires when commanded to attack', () => {
        const kinds: Array<readonly [string, (e: Entity) => void]> = [
            // spawnHiredEscorts: makeNpcShip + formation + firing group
            // + durable ownership. No govt (it is passed null).
            ['hired', escort => {
                escort.components
                    .set(NpcComponent, { aiType: 1 })
                    .set(FiringGroupComponent, { group: 'player' })
                    .set(PlayerEscortComponent,
                        { player: 'player', parent: 'player', deal: NO_DEAL });
            }],
            // convertToEscort: the captured NPC keeps its brain with
            // mode/aggressor cleared, loses its govt and bay links.
            ['captured prize', escort => {
                escort.components
                    .set(NpcComponent,
                        { aiType: 1, mode: undefined, aggressor: undefined })
                    .set(FiringGroupComponent, { group: 'player' })
                    .set(PlayerEscortComponent,
                        { player: 'player', parent: 'player', deal: NO_DEAL });
                escort.components.delete(GovtComponent);
            }],
            // bay_plugin BayWeaponEntry.fire: makeShip (so NO
            // NpcComponent) + owner/source back to the carrier.
            ['bay fighter', escort => {
                escort.components
                    .set(OwnerComponent, { owner: 'player' })
                    .set(SourceComponent, 'player')
                    .set(ReturnWhenTargetRemovedComponent, undefined);
            }],
        ];

        for (const [kind, setup] of kinds) {
            it(kind, async () => {
                const { world, addShip } = await makeWorld();
                setup(world.entities.get('escort')!);
                await addShip('enemy', 500, 0);
                setPlayerTarget(world, 'enemy');
                press(world, 'attack');
                world.step();
                const weapons = world.entities.get('escort')!.components
                    .get(WeaponsStateComponent)!;
                expect([...weapons.values()].some(w => w.firing))
                    .withContext(`${kind} escort should fire`).toBeTrue();
            });
        }
    });

    // The `firing` flag is only the intent; WeaponsSystem turns it into
    // shots a tick later. This is the end-to-end version of Matthew's
    // report — a commanded hired escort must actually put rounds in the
    // air, not merely latch a flag.
    it('a commanded hired escort actually spawns projectiles',
        async () => {
            const { world, addShip } = await makeWorld();
            makeNpcEscort(world);
            await addShip('enemy', 500, 0);
            setPlayerTarget(world, 'enemy');
            press(world, 'attack');
            for (let i = 0; i < 30; i++) {
                world.step();
            }
            const shots = [...world.entities].filter(([, entity]) =>
                entity.components.get(SourceComponent) === 'escort').length;
            expect(shots).toBeGreaterThan(0);
        });
});

describe('inFrontQuadrant', () => {
    const movement = {
        position: new Position(0, 0),
        velocity: new Vector(0, 0),
        rotation: new Angle(Math.PI / 2), // Facing +x.
        accelerating: 0,
        turning: 0,
        turnBack: false,
    };

    it('accepts targets within ±45° of the facing', () => {
        expect(inFrontQuadrant(movement, { x: 100, y: 0 })).toBeTrue();
        expect(inFrontQuadrant(movement, { x: 100, y: 90 })).toBeTrue();
        expect(inFrontQuadrant(movement, { x: 100, y: -90 })).toBeTrue();
    });

    it('rejects targets beside or behind', () => {
        expect(inFrontQuadrant(movement, { x: 0, y: 100 })).toBeFalse();
        expect(inFrontQuadrant(movement, { x: -100, y: 0 })).toBeFalse();
        expect(inFrontQuadrant(movement, { x: 100, y: 110 })).toBeFalse();
    });

    it('measures across the system\'s wrap seam the short way', () => {
        // Facing +x just inside the +x edge: a ship just over the seam
        // (at the -x edge) is 200 px dead ahead, not 19,800 px behind.
        const nearEdge = { ...movement, position: new Position(9900, 0) };
        expect(inFrontQuadrant(nearEdge, { x: -9900, y: 0 })).toBeTrue();
        expect(inFrontQuadrant(nearEdge, { x: 9700, y: 0 })).toBeFalse();
    });
});

describe('inRearQuadrant', () => {
    const movement = {
        position: new Position(0, 0),
        velocity: new Vector(0, 0),
        rotation: new Angle(Math.PI / 2), // Facing +x.
        accelerating: 0,
        turning: 0,
        turnBack: false,
    };

    it('accepts targets within ±45° of the tail', () => {
        expect(inRearQuadrant(movement, { x: -100, y: 0 })).toBeTrue();
        expect(inRearQuadrant(movement, { x: -100, y: 90 })).toBeTrue();
        expect(inRearQuadrant(movement, { x: -100, y: -90 })).toBeTrue();
    });

    it('rejects targets ahead, beside, or on top of the ship', () => {
        expect(inRearQuadrant(movement, { x: 100, y: 0 })).toBeFalse();
        expect(inRearQuadrant(movement, { x: 0, y: 100 })).toBeFalse();
        expect(inRearQuadrant(movement, { x: -100, y: 110 })).toBeFalse();
        expect(inRearQuadrant(movement, { x: 0, y: 0 })).toBeFalse();
    });

    it('agrees with the quadrant the fire control aims by (getQuadrant)',
        () => {
            for (let degrees = -180; degrees < 180; degrees += 5) {
                const bearing = degrees * Math.PI / 180;
                const target = movement.rotation.add(bearing)
                    .getUnitVector().scale(300);
                expect(inRearQuadrant(movement, target))
                    .withContext(`${degrees}°`)
                    .toBe(getQuadrant(movement.position, movement.rotation,
                        new Position(target.x, target.y)) === 'rearQuadrant');
            }
        });
});

/**
 * ============================================================================
 * The escort's hostility question IS its owner's
 * ============================================================================
 *
 * An escort has no politics, no reputation and no grudges of its own: it
 * fights whoever its OWNER would call hostile. That answer already exists —
 * `styleForTarget` in hostility.ts, the one rule behind the target corners,
 * the 'r' key and the point-defense prey filter — and the escort brain used
 * to reproduce only two of its tiers (politics, and "is currently attacking
 * us"). The two it was missing are the two that matter most in a fight:
 *
 *  - PACIFICATION. A pirate the player bribed reads neutral to the player,
 *    but the player's escorts kept shooting it. The first round to land
 *    voids the reprieve (NpcDecisionSystem clears pacifiedFrom on damage
 *    from the briber), so the money bought nothing at all — the same
 *    failure the point-defense prey filter was fixed for.
 *  - RECENT AGGRESSION. A ship that just emptied its guns into the owner
 *    and looked away was not "attacking" by the posture test, so a
 *    'defend' escort stood and watched. This is also the only tier that
 *    can reach another PLAYER's ship, which has no government and no NPC
 *    brain to read a posture off.
 *
 * Each spec below checks the escort AND the corner bracket the owner sees,
 * so the two can never drift apart again.
 */
describe("an escort's hostility matches its owner's target corners", () => {
    /** The corner style the PLAYER's HUD paints on `uuid`. */
    function cornerStyle(world: World, uuid: string) {
        const player = world.entities.get('player')!;
        return styleForTarget(uuid, world.entities.get(uuid)!, 'player',
            player, world.resources.get(SimulationGameDataResource)!,
            u => world.entities.get(u),
            world.resources.get(TimeResource)!.time,
            world.resources.get(SystemIdResource));
    }

    /** Marks `uuid` as having taken the player's bribe. */
    function bribe(world: World, uuid: string) {
        const npc = world.entities.get(uuid)!.components.get(NpcComponent)
            ?? { aiType: 3 };
        world.entities.get(uuid)!.components.set(NpcComponent, {
            ...npc,
            pacifiedFrom: 'player',
        });
    }

    /** Records `uuid` as having just shot the player. */
    function shotThePlayer(world: World, uuid: string) {
        world.entities.get('player')!.components.set(AggressionComponent,
            new Map([[uuid, {
                at: world.resources.get(TimeResource)!.time,
                damage: AGGRESSION_DAMAGE_THRESHOLD + 1,
                hostile: true,
            }]]));
    }

    it('defend does NOT engage a pirate its owner has bribed', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('pirate', 400, 200, ship => {
            ship.components.set(GovtComponent, { id: 'test:pirate' });
            ship.components.set(NpcComponent, parkedWarship());
        });
        press(world, 'defend');
        world.step();
        world.step();
        // Politics alone: an intruder, and red on the HUD.
        expect(command(world).target).toBe('pirate');
        expect(cornerStyle(world, 'pirate')).toBe('hostile');

        bribe(world, 'pirate');
        world.step();
        world.step();
        // The money bought indifference from the escort too.
        expect(cornerStyle(world, 'pirate')).toBe('neutral');
        expect(command(world).target).toBeUndefined();
    });

    it("a formation escort's opportunistic turrets leave a bribed ship "
        + 'alone', async () => {
            const { world, addShip } = await makeWorld();
            // Straight ahead of the escort (which faces +x from (0, 200))
            // and inside the front-quadrant turret's reach.
            await addShip('pirate', 400, 200, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent, parkedWarship());
            });
            // Formation is the default command; front-quadrant turrets
            // still shoot opportunistically at anything hostile in reach.
            expect(command(world).command).toBe('formation');
            world.step();
            const weapons = world.entities.get('escort')!.components
                .get(WeaponsStateComponent)!;
            expect([...weapons.values()].some(w => w.firing)).toBeTrue();

            bribe(world, 'pirate');
            world.step();
            expect([...weapons.values()].every(w => !w.firing)).toBeTrue();
        });

    it('defend DOES engage a ship that just shot its owner, even after '
        + 'that ship has looked away', async () => {
            const { world, addShip } = await makeWorld();
            // Politically neutral, targeting nobody: invisible to the
            // posture tier.
            await addShip('brawler', 400, 200, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
            });
            press(world, 'defend');
            world.step();
            world.step();
            expect(command(world).target).toBeUndefined();
            expect(cornerStyle(world, 'brawler')).toBe('neutral');

            shotThePlayer(world, 'brawler');
            world.step();
            world.step();
            expect(cornerStyle(world, 'brawler')).toBe('hostile');
            expect(command(world).target).toBe('brawler');
        });

    it('drops the engagement when the aggression window lapses, exactly '
        + 'as the corners do', async () => {
            const { world, addShip } = await makeWorld();
            await addShip('brawler', 400, 200, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
            });
            press(world, 'defend');
            shotThePlayer(world, 'brawler');
            world.step();
            world.step();
            expect(command(world).target).toBe('brawler');

            // Age the record past the window.
            const aggression = world.entities.get('player')!.components
                .get(AggressionComponent)!;
            aggression.get('brawler')!.at =
                world.resources.get(TimeResource)!.time
                - AGGRESSION_WINDOW_MS - 1;
            world.step();
            world.step();
            expect(cornerStyle(world, 'brawler')).toBe('neutral');
            expect(command(world).target).toBeUndefined();
        });

    it("honours the owner's ränk 0x0100 suppression, read from the same "
        + 'baked component the corners read', async () => {
            const { world, addShip } = await makeWorld();
            await addShip('pirate', 400, 200, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent, parkedWarship());
            });
            press(world, 'defend');
            world.step();
            world.step();
            expect(command(world).target).toBe('pirate');

            world.entities.get('player')!.components.set(
                AggressionSuppressGovtsComponent, new Set(['test:pirate']));
            world.step();
            world.step();
            expect(cornerStyle(world, 'pirate')).toBe('neutral');
            expect(command(world).target).toBeUndefined();
        });
});
