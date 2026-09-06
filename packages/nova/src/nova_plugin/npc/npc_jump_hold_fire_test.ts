import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultProjectileWeaponData } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { GovtComponent } from '../core/govt_component.js';
import { beginDepartureJump, JumpComponent, JUMP_DISTANCE } from '../travel/jump_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { NpcComponent } from './npc_ai_plugin.js';
import { ShipPhysicsComponent } from '../ship/ship_plugin.js';
import { TargetComponent } from '../ship/target_component.js';
import { WeaponsStateComponent } from '../ship/weapons_state.js';

/**
 * A SHIP COMMITTED TO A HYPERSPACE JUMP HOLDS ITS FIRE.
 *
 * NpcDecisionSystem bails on a ship that is already jumping, so it cannot
 * talk itself back into a fight — but bailing PRESERVES the mode and
 * target it was carrying when the sequence began. Nothing downstream used
 * to look at the JumpComponent, so a warship went on shooting all the way
 * through its stop, its turn, its spin-up and its departure burn: the
 * exact opposite of the "committed, so it disengages" the visible sequence
 * was added to show.
 *
 * The warship here is a real AI-type-3 NPC with a real government and a
 * real gun, engaging a real victim, so the whole chain runs:
 * NpcDecisionSystem picks the victim -> NpcFireControlSystem holds
 * `firing` -> the jump sequence takes the trigger away.
 *
 * The SEQUENCE is started directly (beginDepartureJump) rather than by
 * flying the ship into a flee decision, because the mode is the point:
 * departByJump is only ever called from the 'flee' and 'depart' steering
 * arms, so no NPC reaches its own departure while still in 'attack'. The
 * shipped route to "jumping while attacking" is a FOLLOW jump — an NPC
 * fleet escort of a captured fleet leader gets swept along by
 * EscortFollowJumpBeginSystem while still running its own AI, since it has
 * no escort command to make the decision system yield. That is a long
 * scenario to build; what it produces is exactly the state below, and the
 * gate under test does not care which of the three functions attached the
 * component.
 */

const WARSHIP = 'test:warship';
const PREY_SHIP = 'test:preyShip';
const GUN = 'test:gun';
const GUN_OUTFIT = 'test:gunOutfit';
/** Xenophobic: at war with everyone, so the warship always has a victim. */
const PIRATE = 'test:pirate';
const MEEK = 'test:meek';

/** Well inside NPC_FIRE_RANGE (1200), so range is never what stops it. */
const PREY_OFFSET = 400;

async function makeWorld() {
    const gameData = new MockGameData();
    gameData.data.Weapon.map.set(GUN, {
        ...getDefaultProjectileWeaponData(),
        id: GUN,
        guidance: 'unguided',
        reload: 1,
        shotDuration: 2000,
        fireGroup: 'primary',
    });
    gameData.data.Outfit.map.set(GUN_OUTFIT, {
        ...getDefaultOutfitData(),
        id: GUN_OUTFIT,
        weapons: { [GUN]: 1 },
    });
    gameData.data.Ship.map.set(WARSHIP, {
        ...getDefaultShipData(),
        id: WARSHIP,
        strength: 100,
        outfits: { [GUN_OUTFIT]: 1 },
    });
    // Weak enough that the warship's MaxOdds check always says "engage".
    gameData.data.Ship.map.set(PREY_SHIP, {
        ...getDefaultShipData(), id: PREY_SHIP, strength: 1,
    });

    const pirate = getDefaultGovtData();
    pirate.id = PIRATE;
    pirate.flags.xenophobic = true;
    // getDefaultGovtData leaves MaxOdds at 0, and a present 0 means "never
    // accept a fight" — a default-govt warship refuses to engage anything.
    pirate.maxOdds = 300;
    gameData.data.Govt.map.set(PIRATE, pirate);
    const meek = getDefaultGovtData();
    meek.id = MEEK;
    gameData.data.Govt.map.set(MEEK, meek);
    await gameData.data.Govt.get(PIRATE);
    await gameData.data.Govt.get(MEEK);

    // npcs: false skips the system's own NPC population — a controlled
    // battlefield with exactly these two ships.
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, shipId: string, x: number,
        setup: (ship: Entity) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(x, 0),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    // Outside the no-jump radius, so the departure sequence is legal here.
    await addShip('warship', WARSHIP, JUMP_DISTANCE + 500, ship => {
        ship.components.set(NpcComponent, { aiType: 3 });
        ship.components.set(GovtComponent, { id: PIRATE });
    });
    await addShip('prey', PREY_SHIP, JUMP_DISTANCE + 500 + PREY_OFFSET,
        ship => {
            ship.components.set(GovtComponent, { id: MEEK });
        });
    return world;
}

function warshipOf(world: World) {
    return world.entities.get('warship');
}

/** Whether the warship is holding the trigger on any weapon right now. */
function firing(world: World): boolean {
    const weapons = warshipOf(world)?.components.get(WeaponsStateComponent);
    if (!weapons) {
        return false;
    }
    for (const [, weapon] of weapons) {
        if (weapon.firing) {
            return true;
        }
    }
    return false;
}

function npcOf(world: World) {
    return warshipOf(world)!.components.get(NpcComponent)!;
}

/** Steps until the warship has picked its victim and opened fire. */
function stepUntilFiring(world: World, maxSteps = 200) {
    for (let i = 0; i < maxSteps && !firing(world); i++) {
        world.step();
    }
}

/** Puts the warship into the departure sequence exactly as the NPC AI
 * does, leaving its mode and target untouched — the state the decision
 * system's jump bail preserves. */
function startJump(world: World) {
    const ship = warshipOf(world)!;
    beginDepartureJump(ship,
        ship.components.get(MovementStateComponent)!,
        ship.components.get(ShipPhysicsComponent)!);
}

describe('a ship in a jump sequence holds its fire', () => {
    it('stops firing on the tick the sequence begins, and stays silent ' +
        'for the whole sequence', async () => {
            const world = await makeWorld();
            stepUntilFiring(world);
            // Precondition: it really is shooting, at a live victim.
            expect(firing(world)).toBeTrue();
            expect(npcOf(world).mode).toEqual('attack');
            expect(warshipOf(world)!.components.get(TargetComponent)!.target)
                .toEqual('prey');

            startJump(world);
            const stagesSeen = new Set<string>();
            let everFired = false;
            for (let i = 0; i < 600 && warshipOf(world); i++) {
                const jump = warshipOf(world)?.components.get(JumpComponent);
                if (!jump) {
                    break;
                }
                stagesSeen.add(jump.stage);
                world.step();
                // Sampled AFTER the tick: the trigger it was already
                // holding when the sequence began is released by the first
                // tick of the gate, not by the act of starting the jump
                // (that release is the second spec below).
                if (firing(world)) {
                    everFired = true;
                }
            }
            // It went all the way through the visible sequence.
            expect(stagesSeen).toEqual(new Set(
                ['stopping', 'aligning', 'spinup', 'accelerating']));
            // ...without ever pulling the trigger. This is the regression:
            // a warship used to fire through its entire departure burn.
            expect(everFired).toBeFalse();
            // And it left, rather than being stopped by the gate.
            expect(warshipOf(world)).toBeUndefined();
        });

    it('GATES rather than clears: the mode and target survive the ' +
        'sequence, so a cancelled jump resumes the fight', async () => {
            const world = await makeWorld();
            stepUntilFiring(world);
            startJump(world);
            world.step();
            expect(firing(world)).toBeFalse();

            // Nothing was thrown away — which is what lets a repaired ship
            // fight on. Clearing the target instead would leave a ship
            // whose jump was cancelled blank and defenceless until its next
            // think tick.
            expect(npcOf(world).mode).toEqual('attack');
            expect(warshipOf(world)!.components.get(TargetComponent)!.target)
                .toEqual('prey');

            // Cancel the sequence the way JumpDisableCancelSystem does.
            warshipOf(world)!.components.delete(JumpComponent);
            world.step();
            expect(firing(world)).toBeTrue();
        });
});
