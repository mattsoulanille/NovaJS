import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import {
    escortDailyFee, escortSellValue, escortUpgradeCost,
} from '../spaceport/escort_fees.js';
import { DisabledComponent } from './disabled_component.js';
import { completeEntity } from './entity_data_loader.js';
import {
    applyEscortAction, escortUpgradeTarget, manageableEscort, releaseEscort,
    replaceEscortShipClass,
} from './escort_action.js';
import { CargoComponent, cargoUsed } from './cargo_plugin.js';
import { EscortCommandComponent } from './escort_command.js';
import { FiringGroupComponent } from './firing_group.js';
import { GovtComponent } from './govt_component.js';
import { ArmorComponent, ShieldComponent } from './health_plugin.js';
import { JumpComponent } from './jump_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem, SIMULATION_STEP_MS } from './make_system.js';
import { FormationComponent, NpcComponent } from './npc_ai_plugin.js';
import { OutfitsStateComponent } from './outfit_plugin.js';
import {
    escortSaleQueued, EscortLandingComponent, pendingEscortUpgrade,
    PlayerEscortComponent,
} from './player_escort.js';
import { CreditsComponent } from './player_state_plugin.js';
import { ControlledByComponent } from './ship_control.js';
import {
    ShipComponent, ShipDataComponent, ShipPhysicsComponent,
} from './ship_plugin.js';
import { Stat } from './stat.js';
import { SystemHoldComponent } from './system_hold.js';
import { TargetComponent } from './target_component.js';
import { OwnerComponent, SourceComponent } from './weapon_components.js';
import { WeaponsStateComponent } from './weapons_state.js';

/**
 * ============================================================================
 * Managing an escort over the comm channel — the simulation half
 * ============================================================================
 *
 * The three functions of hail/hail_escort.png's box, as
 * nova_plugin/escort_action.ts applies them on every peer:
 *
 *   RELEASE   IMMEDIATE. The escort stops being the player's in every way
 *             that could re-recruit it, sheds its government, loses any
 *             hold that would pin it here, and LEAVES the system under its
 *             own power.
 *   SELL      DEFERRED. Captured hulls only; queueing sets a flag and
 *             nothing else, and the money moves at the next shipyard
 *             (spaceport/escort_deals.ts, and escort_deals_test.ts).
 *   UPGRADE   DEFERRED. Queueing records the TARGET CLASS on the escort;
 *             the refit itself is replaceEscortShipClass, run by the same
 *             settlement — and exercised directly here, since it is this
 *             module's function.
 *
 * Both deals are TOGGLES with no price attached: pressing again un-queues,
 * and queueing either cancels the other.
 *
 * Everything is re-derived from synced state inside applyEscortAction, so
 * these specs drive it the way an input record does (peer id + intent) and
 * never hand it a price.
 */

const PEER = 'test peer';
const OTHER_PEER = 'other peer';
const PLAYER = 'player';
const ESCORT = 'escort';
const SHIP_ID = 'test:ship';
/** What SHIP_ID upgrades to: pricier, tougher, and a dead end itself. */
const BETTER_SHIP_ID = 'test:better';
/** A class with no UpgradeTo at all. */
const PLAIN_SHIP_ID = 'test:plain';
const UPGRADE_COST = 50_000;
const GOVT = 'test:govt';

async function makeWorld() {
    const gameData = new MockGameData();
    const base = getDefaultShipData();
    gameData.data.Ship.map.set(SHIP_ID, {
        ...base, id: SHIP_ID, name: 'Terrapin', price: 150_000,
        escortUpgradeShip: BETTER_SHIP_ID, escortUpgradeCost: UPGRADE_COST,
        escortSellValue: 0,
        outfits: { 'test:outfitA': 1 },
        physics: { ...base.physics, shield: 100, armor: 100, freeCargo: 100 },
    });
    gameData.data.Ship.map.set(BETTER_SHIP_ID, {
        ...base, id: BETTER_SHIP_ID, name: 'Terrapin II', price: 400_000,
        escortUpgradeShip: null, escortUpgradeCost: 0,
        escortSellValue: 0,
        outfits: { 'test:outfitB': 2 },
        // A smaller hold than the Terrapin's: the upgrade path must clamp
        // fleet cargo to it (review r15 C3).
        physics: { ...base.physics, shield: 500, armor: 400, freeCargo: 30 },
    });
    gameData.data.Ship.map.set(PLAIN_SHIP_ID, {
        ...base, id: PLAIN_SHIP_ID, name: 'Shuttle', price: 110_000,
        escortUpgradeShip: null, escortUpgradeCost: 0, escortSellValue: 0,
    });
    for (const id of [SHIP_ID, BETTER_SHIP_ID, PLAIN_SHIP_ID]) {
        await gameData.data.Ship.get(id);
    }

    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, shipId: string,
        setup: (ship: Entity) => void = () => { }, x = 0, y = 0) {
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

    const player = await addShip(PLAYER, PLAIN_SHIP_ID, ship => {
        ship.components.set(ControlledByComponent, { peerId: PEER });
        ship.components.set(CreditsComponent, { credits: 1_000_000 });
    });

    /**
     * A hired or captured escort of the player: the live chain the escort
     * command uses, plus the durable ownership marker with a provenance.
     * Started well outside the no-jump zone so a release can be watched
     * all the way out without a long flight.
     */
    async function addEscort(uuid = ESCORT,
        provenance: 'hired' | 'captured' = 'hired', shipId = SHIP_ID) {
        return addShip(uuid, shipId, ship => {
            ship.components.set(FormationComponent,
                { leader: PLAYER, slot: 0 });
            ship.components.set(EscortCommandComponent,
                { command: 'formation' });
            ship.components.set(FiringGroupComponent, { group: PLAYER });
            ship.components.set(PlayerEscortComponent,
                { player: PLAYER, parent: PLAYER, provenance });
            ship.components.set(GovtComponent, { id: GOVT });
            ship.components.set(NpcComponent, { aiType: 1, mode: 'travel' });
        }, 0, 2_000);
    }

    return { world, gameData, player, addShip, addEscort };
}

function creditsOf(world: World) {
    return world.entities.get(PLAYER)!.components
        .get(CreditsComponent)!.credits;
}

/** Steps until the predicate holds; returns the steps taken. */
function stepUntil(world: World, predicate: () => boolean, maxSteps = 4000) {
    for (let i = 0; i < maxSteps; i++) {
        if (predicate()) {
            return i;
        }
        world.step();
    }
    throw new Error(`Condition not met within ${maxSteps} steps`);
}

describe('manageableEscort', () => {
    let fixture: Awaited<ReturnType<typeof makeWorld>>;
    beforeEach(async () => {
        fixture = await makeWorld();
    });

    it('accepts the player\'s own direct escort', async () => {
        const escort = await fixture.addEscort();
        expect(manageableEscort(escort, PLAYER)).toBeTrue();
    });

    it('refuses the player\'s OWN ship', () => {
        expect(manageableEscort(fixture.player, PLAYER)).toBeFalse();
    });

    it('refuses a BAY FIGHTER — it is ammunition, not an employee',
        async () => {
            const fighter = await fixture.addEscort('fighter');
            fighter.components.set(SourceComponent, PLAYER);
            expect(manageableEscort(fighter, PLAYER)).toBeFalse();
        });

    it('refuses somebody else\'s escort', async () => {
        const escort = await fixture.addEscort();
        expect(manageableEscort(escort, 'someone-else')).toBeFalse();
    });
});

describe('escortUpgradeTarget', () => {
    it('reads the escort\'s CURRENT class, so a chain walks one step at a '
        + 'time', async () => {
            const fixture = await makeWorld();
            const escort = await fixture.addEscort();
            expect(escortUpgradeTarget(escort)).toBe(BETTER_SHIP_ID);
            const plain = await fixture.addEscort('plain', 'hired',
                PLAIN_SHIP_ID);
            expect(escortUpgradeTarget(plain)).toBeUndefined();
        });
});

describe('releasing an escort', () => {
    let fixture: Awaited<ReturnType<typeof makeWorld>>;
    beforeEach(async () => {
        fixture = await makeWorld();
    });

    function release(target = ESCORT) {
        applyEscortAction(fixture.world, PEER,
            { kind: 'releaseEscort', target });
    }

    it('drops EVERY link that makes the ship the player\'s', async () => {
        const escort = await fixture.addEscort();
        release();
        // The durable marker AND the whole live chain, together: the
        // marking system re-stamps the marker from whichever of these
        // survives, so leaving one behind would re-recruit the ship on
        // the next tick.
        expect(escort.components.has(PlayerEscortComponent)).toBeFalse();
        expect(escort.components.has(FormationComponent)).toBeFalse();
        expect(escort.components.has(FiringGroupComponent)).toBeFalse();
        expect(escort.components.has(EscortCommandComponent)).toBeFalse();
        expect(escort.components.has(EscortLandingComponent)).toBeFalse();
    });

    it('stays released — the marking system does not take it back',
        async () => {
            const escort = await fixture.addEscort();
            release();
            fixture.world.step();
            fixture.world.step();
            expect(escort.components.has(PlayerEscortComponent)).toBeFalse();
        });

    it('clears the GOVERNMENT: a released escort has no affiliation',
        async () => {
            const escort = await fixture.addEscort();
            expect(escort.components.has(GovtComponent)).toBeTrue();
            release();
            expect(escort.components.has(GovtComponent)).toBeFalse();
        });

    it('clears the SYSTEM HOLD so the ship can actually leave', async () => {
        // A hold is exactly what departByJump refuses to jump through, so
        // a held ship would be released into the system and stay forever.
        const escort = await fixture.addEscort();
        escort.components.set(SystemHoldComponent, { reason: 'missionGoal' });
        release();
        expect(escort.components.has(SystemHoldComponent)).toBeFalse();
    });

    it('clears its target and its quarrel', async () => {
        const escort = await fixture.addEscort();
        escort.components.set(TargetComponent, { target: 'someone' });
        escort.components.get(NpcComponent)!.aggressor = 'someone';
        release();
        expect(escort.components.get(TargetComponent)?.target)
            .toBeUndefined();
        expect(escort.components.get(NpcComponent)?.aggressor)
            .toBeUndefined();
    });

    it('puts it in \'depart\' and it JUMPS OUT of the system', async () => {
        await fixture.addEscort();
        release();
        expect(fixture.world.entities.get(ESCORT)!.components
            .get(NpcComponent)?.mode).toBe('depart');
        // It is well outside the no-jump radius already, so the very next
        // steering ticks hand it to the hyperspace sequence, and it is
        // gone from the system when the sequence finishes.
        stepUntil(fixture.world, () => fixture.world.entities.get(ESCORT)
            ?.components.has(JumpComponent) === true);
        stepUntil(fixture.world, () => !fixture.world.entities.has(ESCORT),
            Math.ceil(30_000 / SIMULATION_STEP_MS));
    });

    it('gives an NPC brain to an escort that somehow has none', async () => {
        const escort = await fixture.addEscort();
        escort.components.delete(NpcComponent);
        release();
        // Seeded from the class's own InherentAI, so no PRNG is drawn.
        expect(escort.components.get(NpcComponent)?.mode).toBe('depart');
    });

    it('UN-MARKS the released escort\'s own wing without seizing it',
        async () => {
            // A carrier escort can have fighters of its own. They were the
            // player's only through their carrier, so they stop being swept
            // along on the player's jumps — but they keep their carrier.
            const carrier = await fixture.addEscort();
            const wing = await fixture.addShip('wing', SHIP_ID, ship => {
                ship.components.set(OwnerComponent, { owner: ESCORT });
                ship.components.set(SourceComponent, ESCORT);
                ship.components.set(PlayerEscortComponent,
                    { player: PLAYER, parent: ESCORT, provenance: 'hired' });
            }, 0, 2_010);

            const released = releaseEscort(ESCORT, fixture.world.entities);
            expect(released).toEqual(['escort', 'wing']);
            expect(carrier.components.has(PlayerEscortComponent)).toBeFalse();
            expect(wing.components.has(PlayerEscortComponent)).toBeFalse();
            // It still belongs to its carrier and leaves with it.
            expect(wing.components.get(OwnerComponent)?.owner).toBe(ESCORT);
        });

    it('leaves the player\'s OTHER escorts alone', async () => {
        await fixture.addEscort();
        const kept = await fixture.addEscort('escort-2');
        release();
        expect(kept.components.get(PlayerEscortComponent)?.player)
            .toBe(PLAYER);
        expect(kept.components.has(FormationComponent)).toBeTrue();
    });

    it('refuses a record from a peer who does not own the escort',
        async () => {
            const escort = await fixture.addEscort();
            applyEscortAction(fixture.world, OTHER_PEER,
                { kind: 'releaseEscort', target: ESCORT });
            expect(escort.components.has(PlayerEscortComponent)).toBeTrue();
        });

    it('is a no-op for an escort that is not there', () => {
        expect(() => release('nobody')).not.toThrow();
        expect(releaseEscort('nobody', fixture.world.entities)).toEqual([]);
    });
});

describe('queueing a sale of a captured escort', () => {
    let fixture: Awaited<ReturnType<typeof makeWorld>>;
    beforeEach(async () => {
        fixture = await makeWorld();
    });

    function queueSale(target = ESCORT, peer: string | undefined = PEER) {
        applyEscortAction(fixture.world, peer, { kind: 'queueSale', target });
    }
    function cancelSale(target = ESCORT, peer: string | undefined = PEER) {
        applyEscortAction(fixture.world, peer, { kind: 'cancelSale', target });
    }

    it('only FLAGS the escort — nothing is paid and it does not leave',
        async () => {
            // The original defers the sale to the next shipyard
            // (hail/sell_captured_escort.png: "Will be sold off at next
            // shipyard"). Nothing moves over the comm channel.
            const escort = await fixture.addEscort(ESCORT, 'captured');
            const before = creditsOf(fixture.world);
            queueSale();
            expect(creditsOf(fixture.world)).toBe(before);
            expect(escortSaleQueued(escort)).toBeTrue();
            // Still the player's, still in formation, still flying.
            expect(escort.components.get(PlayerEscortComponent)?.player)
                .toBe(PLAYER);
            expect(escort.components.has(FormationComponent)).toBeTrue();
            expect(escort.components.get(NpcComponent)?.mode).not.toBe(
                'depart');
        });

    it('cancels again, as many times as the player likes, for free',
        async () => {
            const escort = await fixture.addEscort(ESCORT, 'captured');
            const before = creditsOf(fixture.world);
            for (let i = 0; i < 3; i++) {
                queueSale();
                expect(escortSaleQueued(escort)).toBeTrue();
                cancelSale();
                expect(escortSaleQueued(escort)).toBeFalse();
            }
            expect(creditsOf(fixture.world)).toBe(before);
        });

    it('leaves the marker\'s ENCODED SHAPE unchanged after a cancel, so a '
        + 'peer that never queued anything hashes the same', async () => {
            const escort = await fixture.addEscort(ESCORT, 'captured');
            const before = { ...escort.components
                .get(PlayerEscortComponent)! };
            queueSale();
            cancelSale();
            const after = escort.components.get(PlayerEscortComponent)!;
            expect(after).toEqual(before);
            expect(Object.keys(after).sort())
                .toEqual(Object.keys(before).sort());
        });

    it('REFUSES to queue a sale of a HIRED escort — the player never owned '
        + 'the hull', async () => {
            const escort = await fixture.addEscort(ESCORT, 'hired');
            queueSale();
            expect(escortSaleQueued(escort)).toBeFalse();
        });

    it('refuses an escort with NO recorded provenance (an old save), '
        + 'which reads as hired', async () => {
            const escort = await fixture.addEscort(ESCORT, 'captured');
            escort.components.set(PlayerEscortComponent,
                { player: PLAYER, parent: PLAYER });
            queueSale();
            expect(escortSaleQueued(escort)).toBeFalse();
        });

    it('refuses a record from a peer who does not own the escort',
        async () => {
            const escort = await fixture.addEscort(ESCORT, 'captured');
            queueSale(ESCORT, OTHER_PEER);
            expect(escortSaleQueued(escort)).toBeFalse();
        });
});

describe('queueing an escort upgrade', () => {
    let fixture: Awaited<ReturnType<typeof makeWorld>>;
    beforeEach(async () => {
        fixture = await makeWorld();
    });

    function queueUpgrade(toShip = BETTER_SHIP_ID, target = ESCORT,
        peer: string | undefined = PEER) {
        applyEscortAction(fixture.world, peer,
            { kind: 'queueUpgrade', target, toShip });
    }
    function cancelUpgrade(target = ESCORT, peer: string | undefined = PEER) {
        applyEscortAction(fixture.world, peer,
            { kind: 'cancelUpgrade', target });
    }

    it('only FLAGS the escort with its TARGET CLASS — nothing is charged '
        + 'and the hull does not change', async () => {
            const escort = await fixture.addEscort();
            const before = creditsOf(fixture.world);
            queueUpgrade();
            expect(creditsOf(fixture.world)).toBe(before);
            expect(pendingEscortUpgrade(escort)).toBe(BETTER_SHIP_ID);
            expect(escort.components.get(ShipComponent)?.id).toBe(SHIP_ID);
            // Everything derived from the class is untouched too: the
            // escort is still flying the ship it was flying.
            expect([...escort.components.get(OutfitsStateComponent)!.keys()])
                .toEqual(['test:outfitA']);
        });

    it('keeps the DAILY FEE on the CURRENT class until the deal settles',
        async () => {
            // A queued upgrade changes nothing about what the escort is
            // flying, so it changes nothing about what it is paid.
            const escort = await fixture.addEscort();
            queueUpgrade();
            const data = escort.components.get(ShipDataComponent)!;
            expect(data.id).toBe(SHIP_ID);
            expect(escortDailyFee(data)).toBe(1_500);
            expect(escortSellValue(data)).toBe(15_000);
            expect(escortUpgradeCost(data)).toBe(UPGRADE_COST);
        });

    it('cancels again, for free, as many times as the player likes',
        async () => {
            const escort = await fixture.addEscort();
            const before = creditsOf(fixture.world);
            for (let i = 0; i < 3; i++) {
                queueUpgrade();
                expect(pendingEscortUpgrade(escort)).toBe(BETTER_SHIP_ID);
                cancelUpgrade();
                expect(pendingEscortUpgrade(escort)).toBeUndefined();
            }
            expect(creditsOf(fixture.world)).toBe(before);
        });

    it('QUEUES EVEN WHEN THE PLAYER CANNOT AFFORD IT TODAY — the money is '
        + 'checked when it is taken', async () => {
            const escort = await fixture.addEscort();
            fixture.player.components.get(CreditsComponent)!.credits = 0;
            queueUpgrade();
            expect(pendingEscortUpgrade(escort)).toBe(BETTER_SHIP_ID);
            expect(creditsOf(fixture.world)).toBe(0);
        });

    it('refuses a class the escort\'s own shïp UpgradeTo does not name',
        async () => {
            // The record is intent, not authority: a tampered client
            // cannot queue an upgrade to an arbitrary hull.
            const escort = await fixture.addEscort();
            queueUpgrade(PLAIN_SHIP_ID);
            expect(pendingEscortUpgrade(escort)).toBeUndefined();
        });

    it('refuses a class that cannot be upgraded at all', async () => {
        const escort = await fixture.addEscort(ESCORT, 'hired',
            PLAIN_SHIP_ID);
        queueUpgrade(BETTER_SHIP_ID);
        expect(pendingEscortUpgrade(escort)).toBeUndefined();
    });

    it('queues on a CAPTURED escort too — both kinds can be upgraded',
        async () => {
            const escort = await fixture.addEscort(ESCORT, 'captured');
            queueUpgrade();
            expect(pendingEscortUpgrade(escort)).toBe(BETTER_SHIP_ID);
            expect(escort.components.get(PlayerEscortComponent)?.provenance)
                .toBe('captured');
        });

    it('refuses a record from a peer who does not own the escort',
        async () => {
            const escort = await fixture.addEscort();
            queueUpgrade(BETTER_SHIP_ID, ESCORT, OTHER_PEER);
            expect(pendingEscortUpgrade(escort)).toBeUndefined();
        });
});

describe('the two queued deals are MUTUALLY EXCLUSIVE', () => {
    let fixture: Awaited<ReturnType<typeof makeWorld>>;
    beforeEach(async () => {
        fixture = await makeWorld();
    });

    it('queueing a SALE cancels a queued upgrade', async () => {
        const escort = await fixture.addEscort(ESCORT, 'captured');
        applyEscortAction(fixture.world, PEER, {
            kind: 'queueUpgrade', target: ESCORT, toShip: BETTER_SHIP_ID,
        });
        applyEscortAction(fixture.world, PEER,
            { kind: 'queueSale', target: ESCORT });
        expect(escortSaleQueued(escort)).toBeTrue();
        expect(pendingEscortUpgrade(escort)).toBeUndefined();
    });

    it('queueing an UPGRADE cancels a queued sale', async () => {
        // The original keeps "Upgrade Escort" LIVE beside a queued sale
        // (hail/sell_captured_escort.png), so pressing it has to mean
        // something — and what it means is "that one instead".
        const escort = await fixture.addEscort(ESCORT, 'captured');
        applyEscortAction(fixture.world, PEER,
            { kind: 'queueSale', target: ESCORT });
        applyEscortAction(fixture.world, PEER, {
            kind: 'queueUpgrade', target: ESCORT, toShip: BETTER_SHIP_ID,
        });
        expect(pendingEscortUpgrade(escort)).toBe(BETTER_SHIP_ID);
        expect(escortSaleQueued(escort)).toBeFalse();
    });

    it('a REFUSED queue does not cancel the other deal', async () => {
        // Queueing an upgrade to a class the escort does not name is
        // refused outright, so the sale it would have replaced stands.
        const escort = await fixture.addEscort(ESCORT, 'captured');
        applyEscortAction(fixture.world, PEER,
            { kind: 'queueSale', target: ESCORT });
        applyEscortAction(fixture.world, PEER, {
            kind: 'queueUpgrade', target: ESCORT, toShip: PLAIN_SHIP_ID,
        });
        expect(escortSaleQueued(escort)).toBeTrue();
    });
});

describe('replaceEscortShipClass (the refit itself, run at the shipyard)',
    () => {
        let fixture: Awaited<ReturnType<typeof makeWorld>>;
        beforeEach(async () => {
            fixture = await makeWorld();
        });

        /** What escort_deals.ts does to the hull once the deal settles. */
        function refit(escort: Entity) {
            replaceEscortShipClass(escort, BETTER_SHIP_ID,
                fixture.gameData.data.Ship.map.get(BETTER_SHIP_ID)!);
        }

        it('replaces the class IN PLACE, leaving the escort itself alone',
            async () => {
                const escort = await fixture.addEscort();
                refit(escort);
                expect(escort.components.get(ShipComponent)?.id)
                    .toBe(BETTER_SHIP_ID);
                // Same escort, same slot, same ownership: only the hull.
                expect(escort.components.get(PlayerEscortComponent))
                    .toEqual({
                        player: PLAYER, parent: PLAYER, provenance: 'hired',
                    });
                expect(escort.components.get(FormationComponent))
                    .toEqual({ leader: PLAYER, slot: 0 });
                expect(escort.components.get(EscortCommandComponent)?.command)
                    .toBe('formation');
            });

        it('writes the new class\'s STOCK LOADOUT, not the old one',
            async () => {
                const escort = await fixture.addEscort();
                refit(escort);
                expect([...escort.components
                    .get(OutfitsStateComponent)!.keys()])
                    .toEqual(['test:outfitB']);
            });

        it('rebuilds every DERIVED component from the new class', async () => {
            const escort = await fixture.addEscort();
            // The stats are attached by shipStatSystem from the physics, so
            // give it the tick that does that before damaging them.
            fixture.world.step();
            // Battle damage on the old hull, and a disable with it.
            escort.components.set(ShieldComponent, new Stat({
                current: 1, max: 100, min: 0, recharge: 0,
            }));
            escort.components.set(ArmorComponent, new Stat({
                current: 5, max: 100, min: 0, recharge: 0,
            }));
            escort.components.set(DisabledComponent, { repairAt: null });

            refit(escort);
            // Gone on the tick of the swap...
            expect(escort.components.has(ShipPhysicsComponent)).toBeFalse();
            expect(escort.components.has(WeaponsStateComponent)).toBeFalse();
            expect(escort.components.has(DisabledComponent)).toBeFalse();

            // ...and back from the NEW class, at full strength: this is a
            // new ship, not a repair, so the old hull's damage cannot leak.
            fixture.world.step();
            expect(escort.components.get(ShipPhysicsComponent)?.shield)
                .toBe(500);
            const shield = escort.components.get(ShieldComponent)!;
            expect(shield.max).toBe(500);
            expect(shield.current).toBe(500);
            const armor = escort.components.get(ArmorComponent)!;
            expect(armor.max).toBe(400);
            expect(armor.current).toBe(400);
        });

        it('evicts fleet cargo above the NEW hull\'s hold, by sorted key '
            + 'from the end, and keeps the rest', async () => {
                const escort = await fixture.addEscort();
                escort.components.set(CargoComponent, new Map([
                    ['cargo:0', 40], ['cargo:4', 30], ['junk:nova:134', 10]]));
                refit(escort);
                const cargo = escort.components.get(CargoComponent)!;
                // 80 aboard, 30 fits: junk (last key) goes, then cargo:4
                // down to what is left; cargo:0 untouched.
                expect(cargo.get('junk:nova:134')).toBeUndefined();
                expect(cargo.get('cargo:4')).toBeUndefined();
                expect(cargo.get('cargo:0')).toBe(30);
                expect(cargoUsed(cargo)).toBe(30);
            });

        it('leaves fleet cargo alone when the new hull holds it', async () => {
            const escort = await fixture.addEscort();
            escort.components.set(CargoComponent, new Map([['cargo:0', 20]]));
            refit(escort);
            expect(escort.components.get(CargoComponent)!.get('cargo:0'))
                .toBe(20);
        });

        it('makes the DAILY FEE and the RESALE follow the new class',
            async () => {
                // Every escort price is a pure function of the CURRENT
                // class, which is the whole reason an upgrade needs nothing
                // else updated: replacing ShipDataComponent moves the wage
                // from 1,500/day (150,000 cr hull) to 4,000/day (400,000
                // cr) and the resale from 15,000 to 40,000, by itself.
                const escort = await fixture.addEscort(ESCORT, 'captured');
                const before = escort.components.get(ShipDataComponent)!;
                expect(escortDailyFee(before)).toBe(1_500);
                expect(escortSellValue(before)).toBe(15_000);

                refit(escort);
                const after = escort.components.get(ShipDataComponent)!;
                expect(after.id).toBe(BETTER_SHIP_ID);
                expect(escortDailyFee(after)).toBe(4_000);
                expect(escortSellValue(after)).toBe(40_000);
                // ...and the upgraded hull is a dead end, so there is no
                // second upgrade to offer.
                expect(escortUpgradeTarget(escort)).toBeUndefined();
                expect(escortUpgradeCost(after)).toBe(0);
            });
    });
