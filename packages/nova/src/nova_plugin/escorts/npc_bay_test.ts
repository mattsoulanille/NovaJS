import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { BayWeaponData, getDefaultBayWeaponData } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { BayFighterComponent, ReturnComponent } from './bay_plugin.js';
import { CollisionEvent } from '../core/index.js';
import { MissionShipComponent } from '../player/index.js';
import { completeEntity } from '../spawn/index.js';
import { EscortCommandComponent } from '../player/index.js';
import { GovtComponent } from '../core/index.js';
import { makeShip } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { FormationComponent, NpcComponent } from '../npc/index.js';
import { OutfitsStateComponent } from '../ship/index.js';
import { ControlledByComponent } from '../player/index.js';
import { TargetComponent } from '../ship/index.js';
import { WeaponsStateComponent } from '../ship/index.js';

/**
 * NPC carriers launching and using their fighters.
 *
 * The carrier is a real AI-type-3 warship with a real government, so
 * these drive the whole chain the feature depends on: NpcDecisionSystem
 * picks a victim -> NpcFireControlSystem opens the bay ->
 * BayWeaponEntry.fire spends a fighter outfit ->
 * NpcWingCommandSystem orders the wing onto the carrier's victim.
 */

const CARRIER_SHIP = 'test:carrierShip';
const FIGHTER_SHIP = 'test:fighterShip';
const ENEMY_SHIP = 'test:enemyShip';
const BAY_ID = 'test:bay';
const BAY_OUTFIT = 'test:bayOutfit';
const FIGHTER_OUTFIT = 'test:fighterOutfit';
const CARRIER = 'test carrier';
/** Xenophobic: at war with everyone, INCLUDING govt-less independents —
 * which is exactly what an un-flagged bay fighter used to be. */
const PIRATE = 'test:pirate';
const MEEK = 'test:meek';

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

/** Every live bay fighter, as [uuid, entity]. */
function fighters(world: World): [string, Entity][] {
    return [...world.entities]
        .filter(([, entity]) => entity.components.has(BayFighterComponent));
}

function outfitCount(carrier: Entity, id: string): number {
    return carrier.components.get(OutfitsStateComponent)?.get(id)?.count ?? 0;
}

/**
 * A carrier (NPC by default) with one bay, plus a helper for adding
 * enemies. `fighterLoad` is the preinstalled fighter count — the bay's
 * magazine.
 */
async function makeWorld({ fighterLoad = 1, npcCarrier = true }: {
    fighterLoad?: number,
    npcCarrier?: boolean,
} = {}) {
    const gameData = new MockGameData();

    const bay: BayWeaponData = {
        ...getDefaultBayWeaponData(),
        id: BAY_ID,
        shipID: FIGHTER_SHIP,
        ammoType: ['weapon', BAY_ID],
        maxAmmo: 4,
        fireGroup: 'secondary',
        reload: 1,
    };
    gameData.data.Weapon.map.set(BAY_ID, bay);
    gameData.data.Outfit.map.set(BAY_OUTFIT, {
        ...getDefaultOutfitData(),
        id: BAY_OUTFIT,
        weapons: { [BAY_ID]: 1 },
    });
    gameData.data.Outfit.map.set(FIGHTER_OUTFIT, {
        ...getDefaultOutfitData(),
        id: FIGHTER_OUTFIT,
        ammoFor: BAY_ID,
    });

    gameData.data.Ship.map.set(FIGHTER_SHIP, {
        ...getDefaultShipData(),
        id: FIGHTER_SHIP,
    });
    // Weak enough that the carrier's MaxOdds check always says "engage".
    gameData.data.Ship.map.set(ENEMY_SHIP, {
        ...getDefaultShipData(),
        id: ENEMY_SHIP,
        strength: 1,
    });
    const carrierData: ShipData = {
        ...getDefaultShipData(),
        id: CARRIER_SHIP,
        strength: 100,
        outfits: { [BAY_OUTFIT]: 1, [FIGHTER_OUTFIT]: fighterLoad },
    };
    gameData.data.Ship.map.set(CARRIER_SHIP, carrierData);

    const pirate = getDefaultGovtData();
    pirate.id = PIRATE;
    pirate.flags.xenophobic = true;
    // getDefaultGovtData leaves MaxOdds at 0, and NpcDecisionSystem
    // reads `govtData?.maxOdds ?? 100` — a present 0 means "never accept
    // a fight", so a default-govt warship refuses to engage anything.
    pirate.maxOdds = 300;
    gameData.data.Govt.map.set(PIRATE, pirate);
    const meek = getDefaultGovtData();
    meek.id = MEEK;
    gameData.data.Govt.map.set(MEEK, meek);
    // Warm the caches the sim reads synchronously.
    await gameData.data.Govt.get(PIRATE);
    await gameData.data.Govt.get(MEEK);

    // npcs: false skips the system's own NPC population (spawnNpcs), not
    // the AI systems — a controlled battlefield with exactly the ships
    // these tests add.
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, shipId: string, x: number, y: number,
        setup: (ship: Entity) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
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
    }

    const carrier = await addShip(CARRIER, CARRIER_SHIP, 0, 0, ship => {
        if (npcCarrier) {
            ship.components.set(NpcComponent, { aiType: 3 });
            ship.components.set(GovtComponent, { id: PIRATE });
        } else {
            // A player's own carrier: player-controlled, no govt, no AI.
            ship.components.set(ControlledByComponent, { peerId: 'test peer' });
        }
        ship.components.set(TargetComponent, { target: undefined });
    });

    /** An enemy inside both the engage range and NPC_FIRE_RANGE. */
    const addEnemy = (uuid: string, x = 500, y = 0) =>
        addShip(uuid, ENEMY_SHIP, x, y, ship => {
            ship.components.set(GovtComponent, { id: MEEK });
        });

    // Let the provide systems attach weapon state, outfits, physics.
    await stepWorld(world, 2);
    return { world, carrier, addEnemy };
}

function command(fighter: Entity) {
    return fighter.components.get(EscortCommandComponent);
}

/** Forces the carrier's next think to happen on the following step. */
function thinkNow(carrier: Entity) {
    carrier.components.get(NpcComponent)!.nextDecision = 0;
}

describe('NPC carriers launching fighters', () => {
    it('launches a fighter at its victim, spending a fighter outfit',
        async () => {
            const { world, carrier, addEnemy } = await makeWorld();
            await addEnemy('enemy');
            expect(outfitCount(carrier, FIGHTER_OUTFIT)).toBe(1);

            // The carrier's first think ran during world setup, with an
            // empty sky, and pushed its next one a full decision interval
            // out; a handful of steps is far less sim time than that.
            thinkNow(carrier);
            await stepWorld(world, 4);

            // The carrier engaged and opened its bay.
            expect(carrier.components.get(NpcComponent)!.mode).toBe('attack');
            expect(carrier.components.get(TargetComponent)!.target)
                .toBe('enemy');
            expect(outfitCount(carrier, FIGHTER_OUTFIT)).toBe(0);

            const launched = fighters(world);
            expect(launched.length).toBe(1);
            const [, fighter] = launched[0];
            // ...and the wing was ordered onto the carrier's victim
            // rather than left holding formation.
            expect(command(fighter))
                .toEqual({ command: 'attack', target: 'enemy' });
            expect(fighter.components.get(TargetComponent)!.target)
                .toBe('enemy');
        });

    it('does not launch without a target', async () => {
        // No enemy at all: nothing for the AI to engage.
        const { world, carrier } = await makeWorld();
        await stepWorld(world, 10);

        expect(carrier.components.get(NpcComponent)!.mode).not.toBe('attack');
        expect(fighters(world).length).toBe(0);
        // The magazine is untouched: an idle carrier must not dump its
        // hangar into empty space.
        expect(outfitCount(carrier, FIGHTER_OUTFIT)).toBe(1);
    });

    it('does not launch on an empty magazine', async () => {
        const { world, carrier, addEnemy } = await makeWorld({
            fighterLoad: 0,
        });
        await addEnemy('enemy');
        thinkNow(carrier);
        await stepWorld(world, 10);

        // It genuinely wants to fire — it just has nothing to launch.
        expect(carrier.components.get(NpcComponent)!.mode).toBe('attack');
        expect(carrier.components.get(WeaponsStateComponent)!
            .get(BAY_ID)!.firing).toBeTrue();
        expect(fighters(world).length).toBe(0);
    });

    it('stops at the magazine size rather than launching forever',
        async () => {
            const { world, carrier, addEnemy } = await makeWorld({
                fighterLoad: 2,
            });
            await addEnemy('enemy');
            thinkNow(carrier);
            // Far more ticks than reloads: the ammo bound is what holds.
            await stepWorld(world, 12);

            expect(fighters(world).length).toBe(2);
            expect(outfitCount(carrier, FIGHTER_OUTFIT)).toBe(0);
        });

    it('re-engages the carrier\'s next victim after a kill', async () => {
        const { world, carrier, addEnemy } = await makeWorld();
        await addEnemy('enemy');
        thinkNow(carrier);
        await stepWorld(world, 4);
        const [, fighter] = fighters(world)[0];
        expect(command(fighter))
            .toEqual({ command: 'attack', target: 'enemy' });

        // First victim destroyed, a second one arrives.
        world.entities.delete('enemy');
        await addEnemy('enemy2', -400, 0);
        thinkNow(carrier);
        await stepWorld(world, 3);

        expect(carrier.components.get(TargetComponent)!.target).toBe('enemy2');
        // The wing did not sit in formation after its kill.
        expect(command(fighter))
            .toEqual({ command: 'attack', target: 'enemy2' });
    });

    it('holds the wing in formation between victims', async () => {
        const { world, carrier, addEnemy } = await makeWorld();
        await addEnemy('enemy');
        thinkNow(carrier);
        await stepWorld(world, 4);
        const [, fighter] = fighters(world)[0];
        expect(command(fighter)!.command).toBe('attack');

        // The victim is gone; the carrier has not thought again yet, so
        // it is still in 'attack' with no live victim.
        world.entities.delete('enemy');
        await stepWorld(world, 1);

        expect(carrier.components.get(NpcComponent)!.mode).toBe('attack');
        expect(command(fighter)).toEqual({ command: 'formation' });
        expect(fighter.components.has(ReturnComponent)).toBeFalse();
    });

    /** Launches one fighter at 'enemy', then ends the fight: the enemy
     * is gone and the carrier has thought about it. */
    async function fightThenStop() {
        const made = await makeWorld();
        await made.addEnemy('enemy');
        thinkNow(made.carrier);
        await stepWorld(made.world, 4);
        const [fighterUuid, fighter] = fighters(made.world)[0];
        expect(command(fighter)!.command).toBe('attack');
        expect(outfitCount(made.carrier, FIGHTER_OUTFIT)).toBe(0);
        // Out on its sortie, well clear of the carrier, so the specs
        // below see it flying home rather than docking at once (the mock
        // hulls DO collide: a fighter still alongside docks on contact).
        fighter.components.set(MovementStateComponent, {
            ...fighter.components.get(MovementStateComponent)!,
            position: new Position(3000, 3000),
            velocity: new Vector(0, 0),
        });

        made.world.entities.delete('enemy');
        thinkNow(made.carrier);
        await stepWorld(made.world, 3);
        expect(made.carrier.components.get(NpcComponent)!.mode)
            .not.toBe('attack');
        return { ...made, fighterUuid, fighter };
    }

    it('recovers the wing when the carrier stops fighting: it flies home '
        + 'and docks, refunding its round', async () => {
            const { world, carrier, fighterUuid, fighter } =
                await fightThenStop();

            expect(command(fighter)).toEqual({ command: 'returnToBay' });
            expect(fighter.components.has(ReturnComponent)).toBeTrue();
            expect(fighter.components.has(FormationComponent)).toBeFalse();

            // Contact with its own carrier docks it (the mock hulls have
            // no collision shapes, so the contact is emitted by hand, as
            // bay_plugin_test does).
            world.emit(CollisionEvent, { other: CARRIER, initiator: true },
                [fighterUuid]);
            await stepWorld(world, 1);
            expect(world.entities.has(fighterUuid)).toBeFalse();
            expect(outfitCount(carrier, FIGHTER_OUTFIT)).toBe(1);
        });

    it('a recall is final: a wing flying home is not turned around when '
        + 'the carrier fights again', async () => {
            const { world, carrier, addEnemy, fighter } =
                await fightThenStop();
            expect(command(fighter)).toEqual({ command: 'returnToBay' });

            await addEnemy('enemy2', -400, 0);
            thinkNow(carrier);
            await stepWorld(world, 3);

            expect(carrier.components.get(NpcComponent)!.mode).toBe('attack');
            expect(command(fighter)).toEqual({ command: 'returnToBay' });
            expect(fighter.components.has(ReturnComponent)).toBeTrue();
        });

    it('a wing flying home when its carrier vanishes becomes an ordinary '
        + 'NPC and, with no fight left, departs', async () => {
            const { world, fighter, fighterUuid } = await fightThenStop();
            expect(fighter.components.has(ReturnComponent)).toBeTrue();

            world.entities.delete(CARRIER);
            await stepWorld(world, 2);
            expect(world.entities.has(fighterUuid)).toBeTrue();

            // Its departure is due at once (departAt 0, no PRNG roll) and
            // nothing is left to fight, so its brain sends it out.
            expect(fighter.components.get(NpcComponent)).toEqual(
                jasmine.objectContaining(
                    { aiType: 3, departAt: 0, mode: 'depart' }));
            expect(fighter.components.has(ReturnComponent)).toBeFalse();
            expect(fighter.components.has(EscortCommandComponent)).toBeFalse();
        });

    it('a mission carrier protecting the player never launches '
        + '(reference Q4)', async () => {
            const { world, carrier, addEnemy } = await makeWorld();
            // The player it protects: mission_ship_spawn puts a ShipBehav
            // 1 ship in formation on its owner.
            const player = await addEnemy('player', 0, 300);
            player.components.delete(GovtComponent);
            player.components.set(ControlledByComponent,
                { peerId: 'test peer' });
            carrier.components.set(FormationComponent,
                { leader: 'player', slot: 0 });
            carrier.components.set(MissionShipComponent,
                { mission: 'test:mission', owner: 'player' });
            await addEnemy('enemy');
            thinkNow(carrier);
            await stepWorld(world, 10);

            // It fights (the xenophobe's enemy is the protectee's too)...
            expect(carrier.components.get(NpcComponent)!.mode).toBe('attack');
            expect(carrier.components.get(TargetComponent)!.target)
                .toBe('enemy');
            // ...but its hangar stays shut.
            expect(carrier.components.get(WeaponsStateComponent)!
                .get(BAY_ID)!.firing).toBeFalse();
            expect(fighters(world).length).toBe(0);
            expect(outfitCount(carrier, FIGHTER_OUTFIT)).toBe(1);
        });

    it('flies its carrier\'s flag, so a xenophobic carrier does not '
        + 'attack its own wing', async () => {
            const { world, carrier, addEnemy } = await makeWorld();
            await addEnemy('enemy');
            thinkNow(carrier);
            await stepWorld(world, 4);
            const [fighterUuid, fighter] = fighters(world)[0];

            expect(fighter.components.get(GovtComponent))
                .toEqual({ id: PIRATE });
            // The fighter launches at range ~0 from the carrier, so if it
            // read as an independent, a xenophobe would pick it as the
            // NEAREST enemy over the ship 500px away.
            thinkNow(carrier);
            await stepWorld(world, 3);
            expect(carrier.components.get(TargetComponent)!.target)
                .not.toBe(fighterUuid);
            expect(carrier.components.get(TargetComponent)!.target)
                .toBe('enemy');
        });

    /**
     * Reference "A carrier's fighters when it dies (the hub's question),
     * wave 45": a dead Fed Carrier's Viper went on attacking the player
     * for 45 s. The orphan keeps its fight; once that is over it is an
     * ordinary NPC warship, and with nothing left to fight it leaves
     * (GUESS) instead of drifting forever.
     */
    it('a fighter whose carrier died keeps its fight, then departs '
        + 'instead of drifting forever', async () => {
            const { world, carrier, addEnemy } = await makeWorld();
            await addEnemy('enemy');
            thinkNow(carrier);
            await stepWorld(world, 4);
            const [, fighter] = fighters(world)[0];
            expect(command(fighter)!.command).toBe('attack');

            world.entities.delete(CARRIER);
            await stepWorld(world, 20);
            // Still on its attack order, the enemy alive.
            expect(command(fighter)).toEqual(
                { command: 'attack', target: 'enemy' });
            expect(fighter.components.has(NpcComponent)).toBeFalse();
            expect(fighter.components.get(TargetComponent)!.target)
                .toBe('enemy');

            world.entities.delete('enemy');
            await stepWorld(world, 3);
            // Handed to ordinary NPC AI with its departure due: nothing
            // left to fight, so it flies out of the system.
            expect(fighter.components.get(NpcComponent)).toEqual(
                jasmine.objectContaining(
                    { aiType: 3, departAt: 0, mode: 'depart' }));
            expect(fighter.components.has(EscortCommandComponent)).toBeFalse();
            expect(fighter.components.has(FormationComponent)).toBeFalse();
        });
});

describe('player-launched fighters (regression)', () => {
    it('still launch into formation and are never auto-ordered to attack',
        async () => {
            const { world, carrier, addEnemy } = await makeWorld({
                npcCarrier: false,
            });
            await addEnemy('enemy');
            // The player is TARGETING the enemy — the exact condition
            // that makes an NPC carrier order its wing to attack.
            carrier.components.set(TargetComponent, { target: 'enemy' });
            carrier.components.get(WeaponsStateComponent)!
                .get(BAY_ID)!.firing = true;
            await stepWorld(world, 1);
            carrier.components.get(WeaponsStateComponent)!
                .get(BAY_ID)!.firing = false;
            await stepWorld(world, 4);

            const launched = fighters(world);
            expect(launched.length).toBe(1);
            const [, fighter] = launched[0];
            // Launch into formation, awaiting the player's orders.
            expect(command(fighter)).toEqual({ command: 'formation' });
            expect(fighter.components.get(TargetComponent)!.target)
                .toBeUndefined();
            // (`rcs` is the controller's regime state: a fighter launched
            // beside its carrier is close enough to its slot to be on RCS
            // within a few ticks.)
            expect(fighter.components.get(FormationComponent))
                .toEqual(jasmine.objectContaining({ leader: CARRIER, slot: 0 }));
            // No govt to inherit from a player ship.
            expect(fighter.components.has(GovtComponent)).toBeFalse();
        });
});
