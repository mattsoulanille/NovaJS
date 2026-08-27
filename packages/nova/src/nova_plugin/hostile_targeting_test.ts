import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Position } from 'nova_ecs/datatypes/position';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import {
    AGGRESSION_DAMAGE_THRESHOLD, AGGRESSION_WINDOW_MS, AggressionComponent,
} from './aggression.js';
import { CloakActiveComponent } from './cloak_plugin.js';
import { DamagedEvent, ExplodingComponent } from './death_plugin.js';
import { DisabledComponent } from './disabled_component.js';
import { completeEntity } from './entity_data_loader.js';
import { SourceComponent } from './fire_weapon_plugin.js';
import { SimulationGameDataResource } from './game_data_resource.js';
import { GovtComponent } from './govt_component.js';
import { applyHail } from './hail_plugin.js';
import {
    isHostileTarget, selectNearestHostile, styleForTarget,
} from './hostility.js';
import { IffComponent } from './iff_plugin.js';
import { makeShip } from './make_ship.js';
import {
    ActiveRanksComponent, AggressionSuppressGovtsComponent,
} from './ncb_plugin.js';
import { makeSystem, SIMULATION_STEP_MS } from './make_system.js';
import { FormationComponent, NpcComponent } from './npc_ai_plugin.js';
import { CreditsComponent } from './player_state_plugin.js';
import { isPointDefenseCandidate } from './point_defense.js';
import { applyControlEvents, ControlledByComponent } from './ship_control.js';
import { TargetComponent } from './target_component.js';
import { applySetTarget } from './target_plugin.js';

const PEER = 'test peer';
const PIRATES = 'test:pirates';

function govt(over: Partial<GovtData>): GovtData {
    return { ...getDefaultGovtData(), ...over };
}

/**
 * A system with the player at the origin and a cast of ships placed
 * along the x axis. Every ship is a plain default hull; who is hostile
 * is decided per-spec by government or by what they do to the player.
 */
async function makeWorld() {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set('test:ship', {
        ...getDefaultShipData(), id: 'test:ship',
    });
    const pirates = govt({ id: PIRATES });
    // Xenophobic: "attacks everyone except allies", so this govt is
    // hostile to a govt-less player by politics alone.
    pirates.flags.xenophobic = true;
    gameData.data.Govt.map.set(PIRATES, pirates);

    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    const template = makeShip(gameData.data.Ship.map.get('test:ship')!);
    const templateMovement = template.components.get(MovementStateComponent)!;
    const at = (x: number) => ({
        accelerating: 0,
        position: new Position(x, 0),
        rotation: templateMovement.rotation,
        turnBack: false,
        turning: 0,
        velocity: templateMovement.velocity,
    });

    async function addShip(uuid: string, x: number,
        configure: (entity: Entity) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get('test:ship')!);
        ship.components.set(MovementStateComponent, at(x));
        configure(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    return { world, gameData, addShip };
}

/** The default cast: a nearby neutral and a distant pirate. */
async function makeStandardWorld() {
    const built = await makeWorld();
    await built.addShip('player', 0, ship => {
        ship.components.set(ControlledByComponent, { peerId: PEER });
    });
    await built.addShip('neutral', 50);
    await built.addShip('pirate', 400, ship => {
        ship.components.set(GovtComponent, { id: PIRATES });
    });
    built.world.step();
    return built;
}

function press(world: World, action: string) {
    applyControlEvents(world, PEER,
        [{ action: action as never, state: 'start' }]);
    world.step();
    applyControlEvents(world, PEER,
        [{ action: action as never, state: false }]);
    world.step();
}

function playerTarget(world: World) {
    return world.entities.get('player')!
        .components.get(TargetComponent)?.target;
}

/**
 * The selection the 'r' key makes, evaluated the way the DISPLAY does
 * it — the very predicate behind the "can't do that" beep. Undefined
 * means the key is refused and 153 plays.
 */
function displaySelection(world: World) {
    const player = world.entities.get('player')!;
    return selectNearestHostile({
        viewerUuid: 'player',
        viewerEntity: player,
        entities: world.entities,
        gameData: world.resources.get(SimulationGameDataResource)!,
        now: world.resources.get(TimeResource)!.time,
    });
}

/** The corner-bracket style the player's HUD would paint on `uuid`. */
function cornerStyle(world: World, uuid: string) {
    const player = world.entities.get('player')!;
    return styleForTarget(uuid, world.entities.get(uuid)!, 'player', player,
        world.resources.get(SimulationGameDataResource)!,
        u => world.entities.get(u),
        world.resources.get(TimeResource)!.time);
}

const NO_DAMAGE: WeaponDamage = {
    shield: 0, armor: 0, ionization: 0, ionizationColor: 0xffffff,
    passThroughShield: 0, knockback: 0,
};

/**
 * Lands a hit on the player from `aggressor`, through the real
 * DamagedEvent path: the damager is a weapon entity whose
 * SourceComponent names the firing ship, exactly as a projectile or
 * beam arrives.
 */
function hitPlayer(world: World, aggressor: string, damage: Partial<WeaponDamage>) {
    const shot = new Entity('shot').addComponent(SourceComponent, aggressor);
    const shotUuid = `shot ${world.resources.get(TimeResource)!.time}`;
    world.entities.set(shotUuid, shot);
    world.step();
    world.emit(DamagedEvent,
        { damage: { ...NO_DAMAGE, ...damage }, damager: shotUuid },
        ['player']);
    // The emit is delivered on the NEXT step, so the weapon entity has
    // to outlive this line for the damage systems to resolve who fired.
    world.step();
    world.entities.delete(shotUuid);
    world.step();
}

/** Advances the simulation clock by at least `ms`. */
function advance(world: World, ms: number) {
    const until = world.resources.get(TimeResource)!.time + ms;
    while (world.resources.get(TimeResource)!.time < until) {
        world.step();
    }
}

describe("the 'r' key targets the nearest HOSTILE ship", () => {
    it('skips a nearer neutral for a more distant pirate', async () => {
        const { world } = await makeStandardWorld();
        press(world, 'nearestTarget');
        expect(playerTarget(world)).toBe('pirate');
    });

    it('picks the nearest of several hostiles', async () => {
        const { world, addShip } = await makeStandardWorld();
        await addShip('near pirate', 100, ship => {
            ship.components.set(GovtComponent, { id: PIRATES });
        });
        world.step();
        press(world, 'nearestTarget');
        expect(playerTarget(world)).toBe('near pirate');
    });

    it('works with no IFF radar outfit — hostility is behavior and ' +
        'politics, never equipment', async () => {
            const { world } = await makeStandardWorld();
            // The player owns nothing, so the IFF capability is absent.
            expect(world.entities.get('player')!.components
                .get(IffComponent)?.hasIff).toBeFalse();
            press(world, 'nearestTarget');
            expect(playerTarget(world)).toBe('pirate');
        });

    it('agrees with the corner brackets about who is hostile', async () => {
        const { world } = await makeStandardWorld();
        expect(cornerStyle(world, 'pirate')).toBe('hostile');
        expect(cornerStyle(world, 'neutral')).toBe('neutral');
        expect(displaySelection(world)).toBe('pirate');
    });
});

describe("'r' with nothing hostile", () => {
    it('leaves an existing target completely alone', async () => {
        const { world } = await makeStandardWorld();
        world.entities.delete('pirate');
        world.step();
        applySetTarget(world, PEER, 'neutral');
        expect(playerTarget(world)).toBe('neutral');
        press(world, 'nearestTarget');
        // NOT cleared: the key is refused, not obeyed.
        expect(playerTarget(world)).toBe('neutral');
    });

    it('leaves the lack of a target alone', async () => {
        const { world } = await makeStandardWorld();
        world.entities.delete('pirate');
        world.step();
        press(world, 'nearestTarget');
        expect(playerTarget(world)).toBeUndefined();
    });

    it("the beep predicate says 'refused' exactly when the sim leaves " +
        'the target alone', async () => {
            const { world } = await makeStandardWorld();
            // A hostile exists: not refused, and the target moves.
            expect(displaySelection(world)).toBe('pirate');
            press(world, 'nearestTarget');
            expect(playerTarget(world)).toBe('pirate');

            // The pirate leaves the system (which drops the lock on its
            // own), and the player picks the neutral by hand.
            world.entities.delete('pirate');
            world.step();
            applySetTarget(world, PEER, 'neutral');
            // Now refused, and the hand-picked target stays put.
            expect(displaySelection(world)).toBeUndefined();
            press(world, 'nearestTarget');
            expect(playerTarget(world)).toBe('neutral');
        });
});

describe("the 'r' filters are preserved", () => {
    it('never targets yourself', async () => {
        const { world } = await makeStandardWorld();
        world.entities.delete('pirate');
        // Make the PLAYER look hostile to itself if the self check were
        // missing (a govt-hostile player ship).
        world.entities.get('player')!.components
            .set(GovtComponent, { id: PIRATES });
        world.step();
        press(world, 'nearestTarget');
        expect(playerTarget(world)).toBeUndefined();
    });

    it('skips a cloaked hostile', async () => {
        const { world } = await makeStandardWorld();
        world.entities.get('pirate')!.components
            .set(CloakActiveComponent, { active: true });
        world.step();
        press(world, 'nearestTarget');
        expect(playerTarget(world)).toBeUndefined();
    });

    it('skips an exploding hostile', async () => {
        const { world } = await makeStandardWorld();
        world.entities.get('pirate')!.components
            .set(ExplodingComponent, 1e12);
        world.step();
        press(world, 'nearestTarget');
        expect(playerTarget(world)).toBeUndefined();
    });

    it("skips the player's own flock even when it flies a hostile flag",
        async () => {
            const { world, addShip } = await makeStandardWorld();
            world.entities.delete('pirate');
            await addShip('escort', 30, ship => {
                ship.components.set(GovtComponent, { id: PIRATES });
                ship.components.set(FormationComponent,
                    { leader: 'player', slot: 0 });
            });
            world.step();
            press(world, 'nearestTarget');
            expect(playerTarget(world)).toBeUndefined();
        });

    it('skips a DISABLED hostile: a hulk is not a threat, and the ' +
        'corners paint it gray rather than red', async () => {
            const { world } = await makeStandardWorld();
            // `hulk` so ShipDisableSystem doesn't re-enable it on the
            // next step (its armor is untouched).
            world.entities.get('pirate')!.components
                .set(DisabledComponent, { repairAt: null, hulk: true });
            world.step();
            expect(cornerStyle(world, 'pirate')).toBe('disabled');
            press(world, 'nearestTarget');
            expect(playerTarget(world)).toBeUndefined();
        });
});

describe('nearest-hostile selection is deterministic', () => {
    /**
     * Two hostiles at EXACTLY the same distance. A peer that built its
     * entity map by insertion and one restored from a wire snapshot
     * iterate in different orders, so the tie must break on something
     * order-independent: the lexicographically smaller uuid.
     */
    async function tiedWorld(first: string, second: string) {
        const built = await makeWorld();
        await built.addShip('player', 0, ship => {
            ship.components.set(ControlledByComponent, { peerId: PEER });
        });
        await built.addShip(first, 200, ship => {
            ship.components.set(GovtComponent, { id: PIRATES });
        });
        await built.addShip(second, -200, ship => {
            ship.components.set(GovtComponent, { id: PIRATES });
        });
        built.world.step();
        return built.world;
    }

    it('breaks an exact distance tie toward the smaller uuid', async () => {
        const world = await tiedWorld('aaa pirate', 'zzz pirate');
        press(world, 'nearestTarget');
        expect(playerTarget(world)).toBe('aaa pirate');
    });

    it('gives the same answer with the insertion order reversed',
        async () => {
            const world = await tiedWorld('zzz pirate', 'aaa pirate');
            press(world, 'nearestTarget');
            expect(playerTarget(world)).toBe('aaa pirate');
        });
});

describe('player-vs-player aggression', () => {
    /** The standard world plus a second PLAYER's ship at x=200. */
    async function withOtherPlayer() {
        const built = await makeStandardWorld();
        built.world.entities.delete('pirate');
        await built.addShip('other player', 200, ship => {
            ship.components.set(ControlledByComponent, { peerId: 'peer b' });
        });
        built.world.step();
        return built.world;
    }

    function aggression(world: World, aggressor: string) {
        return world.entities.get('player')!.components
            .get(AggressionComponent)?.get(aggressor);
    }

    it('another player is neutral until they do something', async () => {
        const world = await withOtherPlayer();
        expect(cornerStyle(world, 'other player')).toBe('neutral');
        expect(displaySelection(world)).toBeUndefined();
    });

    describe('(b) a damaging hit while targeting us', () => {
        it('makes them hostile at once', async () => {
            const world = await withOtherPlayer();
            applySetTarget(world, 'peer b', 'player');
            expect(world.entities.get('other player')!.components
                .get(TargetComponent)?.target).toBe('player');
            hitPlayer(world, 'other player', { shield: 1 });
            expect(cornerStyle(world, 'other player')).toBe('hostile');
            press(world, 'nearestTarget');
            expect(playerTarget(world)).toBe('other player');
        });

        it('a hit that does NO shield or armor damage does not count',
            async () => {
                const world = await withOtherPlayer();
                applySetTarget(world, 'peer b', 'player');
                // Pure ionization and knockback: unpleasant, not damage.
                hitPlayer(world, 'other player',
                    { ionization: 20, knockback: 50 });
                expect(cornerStyle(world, 'other player')).toBe('neutral');
            });
    });

    describe('(c) enough damage while NOT targeting us', () => {
        it('forgives a single stray hit below the threshold', async () => {
            const world = await withOtherPlayer();
            hitPlayer(world, 'other player',
                { shield: AGGRESSION_DAMAGE_THRESHOLD - 1 });
            expect(aggression(world, 'other player')?.hostile).toBeFalse();
            expect(cornerStyle(world, 'other player')).toBe('neutral');
        });

        it('turns hostile once the crossfire adds up past the threshold',
            async () => {
                const world = await withOtherPlayer();
                const half = AGGRESSION_DAMAGE_THRESHOLD / 2;
                hitPlayer(world, 'other player', { shield: half });
                expect(cornerStyle(world, 'other player')).toBe('neutral');
                hitPlayer(world, 'other player', { shield: half });
                expect(cornerStyle(world, 'other player')).toBe('hostile');
                press(world, 'nearestTarget');
                expect(playerTarget(world)).toBe('other player');
            });
    });

    describe('lapsing back to neutral', () => {
        it('30 seconds of good behavior and the corners, the selection ' +
            'and the beep all flip together', async () => {
                const world = await withOtherPlayer();
                applySetTarget(world, 'peer b', 'player');
                hitPlayer(world, 'other player', { shield: 1 });
                applySetTarget(world, 'peer b', null);
                expect(cornerStyle(world, 'other player')).toBe('hostile');
                expect(displaySelection(world)).toBe('other player');

                advance(world, AGGRESSION_WINDOW_MS + SIMULATION_STEP_MS);

                expect(cornerStyle(world, 'other player')).toBe('neutral');
                expect(displaySelection(world)).toBeUndefined();
                // The sweep cleaned up after itself, so a ship nobody is
                // shooting at carries no state at all.
                expect(world.entities.get('player')!.components
                    .has(AggressionComponent)).toBeFalse();
                // And 'r' is now refused rather than re-acquiring them.
                press(world, 'nearestTarget');
                expect(playerTarget(world)).toBeUndefined();
            }, 30_000);

        it('a fresh hit inside the window restarts the 30 seconds',
            async () => {
                const world = await withOtherPlayer();
                applySetTarget(world, 'peer b', 'player');
                hitPlayer(world, 'other player', { shield: 1 });
                advance(world, AGGRESSION_WINDOW_MS / 2);
                hitPlayer(world, 'other player', { shield: 1 });
                advance(world, AGGRESSION_WINDOW_MS * 3 / 4);
                // Past 30s since the FIRST hit, well inside 30s of the
                // second.
                expect(cornerStyle(world, 'other player')).toBe('hostile');
            }, 30_000);
    });

    it('is recorded against the victim, not the shooter', async () => {
        const world = await withOtherPlayer();
        applySetTarget(world, 'peer b', 'player');
        hitPlayer(world, 'other player', { shield: 1 });
        expect(aggression(world, 'other player')?.hostile).toBeTrue();
        expect(world.entities.get('other player')!.components
            .has(AggressionComponent)).toBeFalse();
    });

    it('NPC victims keep their own aggression channel and gain no ' +
        'aggression component', async () => {
            const { world, addShip } = await makeStandardWorld();
            await addShip('trader', 300);
            world.step();
            const shot = new Entity('shot')
                .addComponent(SourceComponent, 'player');
            world.entities.set('shot', shot);
            world.step();
            world.emit(DamagedEvent,
                { damage: { ...NO_DAMAGE, shield: 90 }, damager: 'shot' },
                ['trader']);
            world.step();
            expect(world.entities.get('trader')!.components
                .has(AggressionComponent)).toBeFalse();
        });
});

describe('aggression state crosses the wire', () => {
    it('is registered with the serializer, so the bridge cannot drop it',
        async () => {
            const { world } = await makeStandardWorld();
            const serializer = world.resources.get(SerializerResource)!;
            expect(serializer.hasComponent(AggressionComponent)).toBeTrue();
        });

    it('round-trips through the serializer with its timestamps intact',
        async () => {
            const { world } = await makeStandardWorld();
            const serializer = world.resources.get(SerializerResource)!;
            const player = world.entities.get('player')!;
            player.components.set(AggressionComponent, new Map([
                ['shooter', { at: 1234, damage: 7, hostile: true }],
            ]));
            const encoded = serializer.encode(player);
            const decoded = serializer.decode(encoded);
            if (isLeft(decoded)) {
                throw new Error('failed to decode the player entity');
            }
            const restored = decoded.right.components
                .get(AggressionComponent)!.get('shooter')!;
            expect(restored).toEqual({ at: 1234, damage: 7, hostile: true });
        });
});

describe('aggression is deterministic across peers', () => {
    it('two independently built worlds reach byte-identical aggression ' +
        'state from the same inputs', async () => {
            const build = async () => {
                const built = await makeStandardWorld();
                built.world.entities.delete('pirate');
                await built.addShip('other player', 200, ship => {
                    ship.components.set(ControlledByComponent,
                        { peerId: 'peer b' });
                });
                built.world.step();
                applySetTarget(built.world, 'peer b', 'player');
                hitPlayer(built.world, 'other player', { shield: 3 });
                advance(built.world, 500);
                hitPlayer(built.world, 'other player', { shield: 4 });
                return built.world;
            };
            const a = await build();
            const b = await build();
            const state = (world: World) => [...world.entities.get('player')!
                .components.get(AggressionComponent)!];
            expect(state(a)).toEqual(state(b));
        });

    it('draws nothing from the seeded random, so recording aggression ' +
        "cannot shift anybody else's rolls", async () => {
            // Two identical worlds stepped identically, except that one
            // takes a hit that records aggression. If that path drew
            // from the seeded Random, every later roll in the shot world
            // would shift and the two states would part company.
            const build = async () => {
                const world = (await makeStandardWorld()).world;
                world.entities.set('shot', new Entity('shot')
                    .addComponent(SourceComponent, 'neutral'));
                world.step();
                return world;
            };
            const shotWorld = await build();
            const quietWorld = await build();
            shotWorld.emit(DamagedEvent,
                { damage: { ...NO_DAMAGE, shield: 99 }, damager: 'shot' },
                ['player']);
            shotWorld.step();
            quietWorld.step();

            // The hit landed and was recorded...
            expect(shotWorld.entities.get('player')!.components
                .get(AggressionComponent)!.get('neutral')!.hostile).toBeTrue();
            expect(quietWorld.entities.get('player')!.components
                .has(AggressionComponent)).toBeFalse();
            // ...without consuming a single draw.
            expect(shotWorld.resources.get(RandomResource)!.getState())
                .toEqual(quietWorld.resources.get(RandomResource)!.getState());
        });
});

/**
 * ============================================================================
 * A SHIP BOUGHT OFF WITH A BEG-FOR-MERCY BRIBE
 * ============================================================================
 *
 * Matthew: "when an NPC accepts a beg-for-mercy bribe, its IFF should become
 * neutral again so PD weapons don't shoot at it and anger it again."
 *
 * Two things kept a paid-off pirate red, and both are exercised here:
 *
 *  - the PLAYER's own aggression memory of what it did (30 seconds of it),
 *    which applyHail now forgets for the ship that was paid; and
 *  - its GOVERNMENT, which never softens — a pirate govt is hostile by its
 *    flags forever, so only a pacification tier in the one hostility rule
 *    (hostility.ts's styleForTarget) can clear it.
 *
 * Why it matters beyond the corner colour: the point defense prey filter is
 * exactly "hostile fighter in range" (point_defense.ts), so the player's own
 * turrets kept hosing the ship they had just bought off — and the first round
 * to land voided the reprieve, restarting the fight.
 */
describe('a ship bought off with a bribe reads NEUTRAL to the briber', () => {
    async function bribedWorld() {
        const built = await makeStandardWorld();
        // Let this pirate govt bargain (gövt Flags 0x0200).
        built.gameData.data.Govt.map.get(PIRATES)!
            .flags.warshipsTakeBribes = true;
        const pirate = built.world.entities.get('pirate')!;
        pirate.components.set(NpcComponent,
            { aiType: 3, mode: 'attack', aggressor: 'player' });
        pirate.components.set(TargetComponent, { target: 'player' });
        built.world.entities.get('player')!.components
            .set(CreditsComponent, { credits: 10_000 });
        built.world.step();
        return built;
    }

    /** Whether the player's point defense would shoot at `uuid`. */
    function pointDefenseWouldShoot(world: World, uuid: string) {
        const player = world.entities.get('player')!;
        return isPointDefenseCandidate({
            uuid,
            kind: 'fighter',
            distanceSquared: 100,
            owner: uuid,
            hostile: isHostileTarget(uuid, world.entities.get(uuid)!, {
                viewerUuid: 'player',
                viewerEntity: player,
                entities: world.entities,
                gameData: world.resources.get(SimulationGameDataResource)!,
                now: world.resources.get(TimeResource)!.time,
            }),
            inFlock: false,
        }, { owner: 'player', source: 'player', rangeSquared: 1_000_000 });
    }

    it('is hostile before the bribe — politics AND what it has done',
        async () => {
            const { world } = await bribedWorld();
            hitPlayer(world, 'pirate', { shield: 99 });
            expect(cornerStyle(world, 'pirate')).toBe('hostile');
            expect(displaySelection(world)).toBe('pirate');
            expect(pointDefenseWouldShoot(world, 'pirate')).toBeTrue();
        });

    it('goes NEUTRAL the moment the bribe is paid, though its government '
        + 'is unchanged', async () => {
            const { world } = await bribedWorld();
            hitPlayer(world, 'pirate', { shield: 99 });
            applyHail(world, PEER, { kind: 'bribe', target: 'pirate' });

            expect(cornerStyle(world, 'pirate')).toBe('neutral');
            // Its politics really are untouched: it is still a pirate.
            expect(world.entities.get('pirate')!.components
                .get(GovtComponent)!.id).toBe(PIRATES);
        });

    it('drops out of the r-key nearest-hostile scan', async () => {
        const { world } = await bribedWorld();
        expect(displaySelection(world)).toBe('pirate');
        applyHail(world, PEER, { kind: 'bribe', target: 'pirate' });
        // Nothing else in the standard cast is hostile.
        expect(displaySelection(world)).toBeUndefined();
    });

    it('stops being POINT DEFENSE prey, so the turrets cannot re-anger it',
        async () => {
            const { world } = await bribedWorld();
            hitPlayer(world, 'pirate', { shield: 99 });
            expect(pointDefenseWouldShoot(world, 'pirate')).toBeTrue();
            applyHail(world, PEER, { kind: 'bribe', target: 'pirate' });
            expect(pointDefenseWouldShoot(world, 'pirate')).toBeFalse();
        });

    it('is per-briber: another pilot still sees a pirate', async () => {
        const { world, addShip } = await bribedWorld();
        await addShip('rival', 20, ship => {
            ship.components.set(ControlledByComponent, { peerId: 'other' });
        });
        world.step();
        applyHail(world, PEER, { kind: 'bribe', target: 'pirate' });

        const rival = world.entities.get('rival')!;
        expect(styleForTarget('pirate', world.entities.get('pirate')!,
            'rival', rival, world.resources.get(SimulationGameDataResource)!,
            u => world.entities.get(u),
            world.resources.get(TimeResource)!.time)).toBe('hostile');
    });

    it('goes hostile again the instant the reprieve lapses', async () => {
        const { world } = await bribedWorld();
        applyHail(world, PEER, { kind: 'bribe', target: 'pirate' });
        expect(cornerStyle(world, 'pirate')).toBe('neutral');

        // The boundary is strict: at pacifiedUntil the truce is over.
        const npc = world.entities.get('pirate')!.components
            .get(NpcComponent)!;
        npc.pacifiedUntil = world.resources.get(TimeResource)!.time;
        expect(cornerStyle(world, 'pirate')).toBe('hostile');
    });

    it('goes hostile again if the PLAYER shoots it, exactly as before',
        async () => {
            // The truce is bought, not permanent: NpcAggressionSystem voids
            // it the moment the briber damages the ship, and this tier is
            // then off again — no separate un-pacify path to keep in step.
            const { world } = await bribedWorld();
            applyHail(world, PEER, { kind: 'bribe', target: 'pirate' });
            expect(cornerStyle(world, 'pirate')).toBe('neutral');

            const shot = new Entity('shot')
                .addComponent(SourceComponent, 'player');
            world.entities.set('player shot', shot);
            world.step();
            world.emit(DamagedEvent, {
                damage: { ...NO_DAMAGE, shield: 99 }, damager: 'player shot',
            }, ['pirate']);
            world.step();

            const npc = world.entities.get('pirate')!.components
                .get(NpcComponent)!;
            expect(npc.pacifiedFrom).toBeUndefined();
            expect(cornerStyle(world, 'pirate')).toBe('hostile');
        });
});

/**
 * ränk Flags 0x0100 — "Ships of the affiliated government will not
 * automatically attack the player when he has this rank" — as the
 * SIMULATION sees it.
 *
 * The privilege used to be read here by resolving the player's
 * ActiveRanksComponent through `gameData.data.Rank.getCached`. That read is
 * never warm in a simulation world: the preload bundle carries Outfit, Ship
 * and System, and entity staging (entity_data_loader) adds only Govt —
 * nothing anywhere stages Rank. The sim runs in its own worker (and its own
 * server archive) with its own cache, so the read was cold there while the
 * MAIN THREAD's display world, which had loaded the ränk table for a
 * spaceport dialog, read it warm: the corner brackets said "this government
 * leaves you alone" while the NPCs kept shooting, and two peers that had
 * opened different dialogs could fork npc.mode and npc target outright.
 *
 * The fact is now baked at grant time into AggressionSuppressGovtsComponent
 * (rank_logic.ts's suppressAggressionGovts) and the hot path reads only
 * that. These specs therefore run against a completely EMPTY ränk table,
 * which is exactly what a simulation world has.
 */
describe('ränk 0x0100 suppression is read from synced state, not game data',
    () => {
        it('turns an automatically hostile govt neutral with a stone-cold '
            + 'ränk cache', async () => {
                const { world, gameData } = await makeStandardWorld();
                // The sim worker's reality: no ränk resource has ever been
                // fetched into this world's cache.
                expect(gameData.data.Rank.getCached('nova:143'))
                    .toBeUndefined();
                expect(cornerStyle(world, 'pirate')).toBe('hostile');

                world.entities.get('player')!.components.set(
                    AggressionSuppressGovtsComponent, new Set([PIRATES]));
                world.step();
                expect(cornerStyle(world, 'pirate')).toBe('neutral');
                // ... and the 'r' key, which quotes the same rule, now finds
                // nothing hostile at all.
                expect(displaySelection(world)).toBeUndefined();
            });

        it('suppresses only the government the rank names', async () => {
            const { world } = await makeStandardWorld();
            world.entities.get('player')!.components.set(
                AggressionSuppressGovtsComponent,
                new Set(['test:some other govt']));
            world.step();
            expect(cornerStyle(world, 'pirate')).toBe('hostile');
            expect(displaySelection(world)).toBe('pirate');
        });

        it('does NOT fall back to the ränk table when the baked set is '
            + 'absent — the simulation never reads rank data', async () => {
                const { world, gameData } = await makeStandardWorld();
                // A fully WARM ränk table carrying the privilege, and the
                // player holding that rank the old way. Before the bake this
                // was enough; now it deliberately is not, because the same
                // state on a peer whose cache was cold would have said the
                // opposite.
                gameData.data.Rank.map.set('test:rank', {
                    id: 'test:rank', name: 'Pirate Guild-Master',
                    prefix: 'test', affilGovt: PIRATES, weight: 1,
                    contribute: '0', priceMod: 100, salary: 0, salaryCap: 0,
                    convName: '', shortName: '', flags: 0x0100,
                    rankFlags: {
                        dropOtherRanksWhenActivated: false,
                        dropOtherRanksWhenDeactivated: false,
                        permanent: false,
                        dropLowerRanksWhenActivated: false,
                        dropLowerRanksWhenDeactivated: false,
                        govtShipsWontAttack: true,
                        canAlwaysLandOnGovtStellars: false,
                        canRequestBattleAssistance: false,
                        freeRefuelAndRepair: false,
                    },
                } as never);
                await gameData.data.Rank.get('test:rank');
                expect(gameData.data.Rank.getCached('test:rank'))
                    .toBeDefined();
                world.entities.get('player')!.components.set(
                    ActiveRanksComponent, new Set(['test:rank']));
                world.step();
                expect(cornerStyle(world, 'pirate')).toBe('hostile');
            });
    });
