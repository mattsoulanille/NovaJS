import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { AggressionComponent, AGGRESSION_WINDOW_MS } from '../combat/index.js';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { EscortCommandComponent, PlayerEscortComponent } from '../player/index.js';
import { DamagedEvent } from '../ship/index.js';
import { DisabledComponent } from '../ship/index.js';
import { SourceComponent } from '../combat/index.js';
import { completeEntity } from '../spawn/index.js';
import { GovtComponent } from '../core/index.js';
import { AssistingComponent } from '../npc/index.js';
import { JumpComponent } from '../travel/index.js';
import {
    applyHail, BRIBE_PACIFY_MS, isSomeoneElsesEscort, SentHailComponent,
} from './hail_plugin.js';
import { FormationComponent } from '../npc/index.js';
import { OwnerComponent } from '../combat/index.js';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { ArmorComponent, FuelComponent } from '../ship/index.js';
import { makeShip } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { NpcComponent } from '../npc/index.js';
import { CreditsComponent } from '../player/index.js';
import { ControlledByComponent } from '../player/index.js';
import { TargetComponent } from '../ship/index.js';

const PEER = 'test peer';

async function makeWorld() {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set('test:ship', {
        ...getDefaultShipData(),
        id: 'test:ship',
    });
    // A class that INHERITS gövt 0x0400 from its attributes govt (the stock
    // Wraith (Adult) nova:185, InherentGovt 159).
    gameData.data.Ship.map.set('test:wraith', {
        ...getDefaultShipData(),
        id: 'test:wraith',
        inheritedCantBeHailed: true,
    });

    // A hostile, bribe-taking pirate govt.
    const pirate = getDefaultGovtData();
    pirate.id = 'test:pirate';
    pirate.flags.xenophobic = true;
    pirate.flags.largerBribes = true;
    gameData.data.Govt.map.set('test:pirate', pirate);
    // A peaceful govt that will lend a hand.
    const meek = getDefaultGovtData();
    meek.id = 'test:meek';
    gameData.data.Govt.map.set('test:meek', meek);
    // A politically NEUTRAL govt whose warships take bribes — used to test
    // behavioral hostility: only "currently attacking the player" makes one of
    // its ships bargain / refuse assistance, not its (neutral) politics.
    const armed = getDefaultGovtData();
    armed.id = 'test:armed';
    armed.flags.warshipsTakeBribes = true;
    gameData.data.Govt.map.set('test:armed', armed);
    // Hostile to the player and takes no bribes (ruling #297's "refuse").
    const hater = getDefaultGovtData();
    hater.id = 'test:hater';
    hater.flags.alwaysAttacksPlayer = true;
    gameData.data.Govt.map.set('test:hater', hater);
    await gameData.data.Govt.get('test:hater');
    // Nothing to say and nothing to offer: Flags2 0x0001 + 0x0008, what the
    // stock Krypt (gövt 140, Flags2 0x002b) carries.
    const krypt = getDefaultGovtData();
    krypt.id = 'test:krypt';
    krypt.flags2.noAssistOrMercy = true;
    krypt.flags2.noDistressMessages = true;
    gameData.data.Govt.map.set('test:krypt', krypt);
    await gameData.data.Govt.get('test:krypt');
    await gameData.data.Govt.get('test:pirate');
    await gameData.data.Govt.get('test:meek');
    await gameData.data.Govt.get('test:armed');

    const world = await makeSystem('test:system', gameData);

    async function addShip(uuid: string, x: number, y: number,
        setup: (ship: ReturnType<typeof makeShip>) => void = () => { },
        shipId = 'test:ship') {
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
    }

    await addShip('player', 0, 0, ship => {
        ship.components.set(ControlledByComponent, { peerId: PEER });
        ship.components.set(CreditsComponent, { credits: 100_000 });
    });
    world.step();
    return { world, addShip };
}

function player(world: World) {
    return world.entities.get('player')!;
}
function target(world: World) {
    return world.entities.get('target')!;
}

describe('applyHail: bribe / beg for mercy', () => {
    it('deducts the demanded credits and pacifies a hostile pirate',
        async () => {
            const { world, addShip } = await makeWorld();
            await addShip('target', 500, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent,
                    { aiType: 3, mode: 'attack', aggressor: 'player' });
                ship.components.set(TargetComponent, { target: 'player' });
            });
            applyHail(world, PEER, { kind: 'bribe', target: 'target' });

            // 30% of 100k for a largerBribes govt.
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(70_000);
            const npc = target(world).components.get(NpcComponent)!;
            expect(npc.pacifiedFrom).toBe('player');
            expect(npc.pacifiedUntil).toBeGreaterThan(0);
            expect(npc.aggressor).toBeUndefined();
            // The pacified pirate drops its attack on the briber.
            expect(target(world).components.get(TargetComponent)!.target)
                .toBeUndefined();
        });

    /**
     * Matthew: "when an NPC accepts a beg-for-mercy bribe, its IFF should
     * become neutral again so PD weapons don't shoot at it and anger it
     * again."
     *
     * Dropping the pirate's own attack is not enough: hostility is a
     * two-sided reading, and the PLAYER's AggressionComponent remembers every
     * shot that pirate landed for another 30 seconds (tier 3b of
     * hostility.ts's styleForTarget). That memory kept the bribed ship red —
     * and the player's point defense shoots hostile fighters, so the truce
     * was cancelled by the briber's own turrets.
     */
    it('forgets what the bribed ship did to the player (and vice versa)',
        async () => {
            const { world, addShip } = await makeWorld();
            await addShip('target', 500, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent,
                    { aiType: 3, mode: 'attack', aggressor: 'player' });
                ship.components.set(TargetComponent, { target: 'player' });
            });
            // The pirate has been shooting the player, and a bystander has
            // been shooting them too.
            player(world).components.set(AggressionComponent, new Map([
                ['target', { at: 0, damage: 120, hostile: true }],
                ['bystander', { at: 0, damage: 120, hostile: true }],
            ]));

            applyHail(world, PEER, { kind: 'bribe', target: 'target' });

            const aggression =
                player(world).components.get(AggressionComponent)!;
            expect(aggression.has('target')).toBeFalse();
            // A brawl with several ships only forgives the one that was paid.
            expect(aggression.has('bystander')).toBeTrue();
        });

    it('refuses to charge twice for a reprieve the player already owns',
        async () => {
            // The comm dialog keeps Beg For Mercy in its slot after a paid
            // bribe (the reference keeps Request Assistance there too), so a
            // second Pay press reaches applyHail — and must cost nothing.
            const { world, addShip } = await makeWorld();
            await addShip('target', 500, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent,
                    { aiType: 3, mode: 'attack', aggressor: 'player' });
                ship.components.set(TargetComponent, { target: 'player' });
            });
            applyHail(world, PEER, { kind: 'bribe', target: 'target' });
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(70_000);
            const until =
                target(world).components.get(NpcComponent)!.pacifiedUntil;

            applyHail(world, PEER, { kind: 'bribe', target: 'target' });
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(70_000);
            // Nor is the reprieve silently extended by the free press.
            expect(target(world).components.get(NpcComponent)!.pacifiedUntil)
                .toBe(until);
        });

    it('does nothing to a non-hostile ship the player is not fighting',
        async () => {
            // Neutral politics AND not attacking the player: no bribe to make.
            const { world, addShip } = await makeWorld();
            await addShip('target', 500, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
                ship.components.set(NpcComponent, { aiType: 3 });
            });
            applyHail(world, PEER, { kind: 'bribe', target: 'target' });
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(100_000);
        });

    it('bribes a NEUTRAL-govt ship that is attacking the player', async () => {
        // Behavioral hostility: a bribe-taking neutral warship the player
        // provoked (mode 'attack' aimed at the player) bargains just like a
        // politically hostile pirate — credits deducted, attack dropped.
        const { world, addShip } = await makeWorld();
        await addShip('target', 500, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:armed' });
            ship.components.set(NpcComponent,
                { aiType: 3, mode: 'attack', aggressor: 'player' });
            ship.components.set(TargetComponent, { target: 'player' });
        });
        applyHail(world, PEER, { kind: 'bribe', target: 'target' });
        // 10% of 100k (armed is not a largerBribes govt).
        expect(player(world).components.get(CreditsComponent)!.credits)
            .toBe(90_000);
        const npc = target(world).components.get(NpcComponent)!;
        expect(npc.pacifiedFrom).toBe('player');
        expect(npc.pacifiedUntil).toBeGreaterThan(0);
        expect(target(world).components.get(TargetComponent)!.target)
            .toBeUndefined();
    });

    it('the pacify reprieve lapses after BRIBE_PACIFY_MS', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('target', 500, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:pirate' });
            ship.components.set(NpcComponent, { aiType: 3 });
        });
        applyHail(world, PEER, { kind: 'bribe', target: 'target' });
        const npc = target(world).components.get(NpcComponent)!;
        expect(npc.pacifiedUntil).toBeGreaterThanOrEqual(BRIBE_PACIFY_MS);
    });

    it('the reprieve is voided when the briber shoots the ship again',
        async () => {
            // A bribe lasts only "until the player provokes them again": once
            // the briber damages the pacified ship, NpcAggressionSystem clears
            // the reprieve so the ship resumes hostility.
            const { world, addShip } = await makeWorld();
            await addShip('target', 500, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:pirate' });
                ship.components.set(NpcComponent, { aiType: 3 });
            });
            applyHail(world, PEER, { kind: 'bribe', target: 'target' });
            const npc = target(world).components.get(NpcComponent)!;
            expect(npc.pacifiedFrom).toBe('player');
            expect(npc.pacifiedUntil).toBeGreaterThan(0);

            // A projectile fired by the player (its SourceComponent) hits the
            // pacified ship. NpcAggressionSystem reads the source off the
            // damager entity, so add the shot as a real entity.
            const zeroDamage: WeaponDamage = {
                shield: 0, armor: 0, ionization: 0, ionizationColor: 0,
                passThroughShield: 0, knockback: 0,
            };
            world.entities.set('playerShot',
                new Entity().addComponent(SourceComponent, 'player'));
            world.emit(DamagedEvent,
                { damage: zeroDamage, damager: 'playerShot' }, ['target']);
            world.step();

            const after = target(world).components.get(NpcComponent)!;
            expect(after.aggressor).toBe('player');
            expect(after.pacifiedFrom).toBeUndefined();
            expect(after.pacifiedUntil).toBeUndefined();
        });
});

describe('applyHail: request assistance', () => {
    it('marks a friendly ship as assisting when the player is disabled',
        async () => {
            const { world, addShip } = await makeWorld();
            player(world).components.set(DisabledComponent, { repairAt: null });
            await addShip('target', 150, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
                ship.components.set(NpcComponent, { aiType: 3 });
            });
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            expect(target(world).components.get(AssistingComponent))
                .toEqual({ client: 'player' });
        });

    it('does nothing when the player is healthy — the dialog still OFFERS '
        + 'the request, and the ship just says you need no help', async () => {
            // Matthew: "it should show request assistance even if there's no
            // reason for you to request it (they usually just tell you that
            // you don't need help)." The OFFER moved out to the dialog, so a
            // healthy player's request now reaches the sim — and must still
            // leave the hailed ship completely alone: no AssistingComponent,
            // so AssistBehaviorSystem never steers it and never heals anyone.
            const { world, addShip } = await makeWorld();
            await addShip('target', 150, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
                ship.components.set(NpcComponent, { aiType: 3, mode: 'travel' });
                ship.components.set(TargetComponent, { target: undefined });
            });
            const before = { ...target(world).components
                .get(MovementStateComponent)! };

            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            world.step();

            expect(target(world).components.has(AssistingComponent))
                .toBeFalse();
            // Its own errand is untouched: same mode, and no assist steering
            // was written over the top of it.
            expect(target(world).components.get(NpcComponent)!.mode)
                .toBe('travel');
            const after = target(world).components
                .get(MovementStateComponent)!;
            expect(after.position.x).toBe(before.position.x);
            expect(after.position.y).toBe(before.position.y);
        });

    it('still grants the errand to a player who DOES need help', async () => {
        // The need test moved from the offer to the answer; a real need must
        // still get a helper on its way.
        const { world, addShip } = await makeWorld();
        player(world).components.set(DisabledComponent, { repairAt: null });
        await addShip('target', 150, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:meek' });
            ship.components.set(NpcComponent, { aiType: 3, mode: 'travel' });
        });
        applyHail(world, PEER,
            { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.get(AssistingComponent))
            .toEqual({ client: 'player' });
    });

    it('refuses a neutral-govt ship ATTACKING the disabled player', async () => {
        // The assistance exploit: a neutral warship the player provoked is
        // shooting the disabled player — it must not also be able to fly over
        // and fully repair them. Behavioral hostility bars the request.
        const { world, addShip } = await makeWorld();
        player(world).components.set(DisabledComponent, { repairAt: null });
        await addShip('target', 150, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:meek' });
            ship.components.set(NpcComponent,
                { aiType: 3, mode: 'attack' });
            ship.components.set(TargetComponent, { target: 'player' });
        });
        applyHail(world, PEER,
            { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.has(AssistingComponent)).toBeFalse();
    });

    it('REFUSES a ship that is busy fighting someone else, and leaves its '
        + 'combat state untouched', async () => {
            // Matthew's playtest bug: a ship in the middle of a fight would
            // agree to assist — turning toward the player while still firing
            // at its opponent. It must refuse ("I'm busy") instead.
            const { world, addShip } = await makeWorld();
            player(world).components.set(DisabledComponent, { repairAt: null });
            await addShip('bystander', 900, 0);
            await addShip('target', 150, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
                ship.components.set(NpcComponent,
                    { aiType: 3, mode: 'attack', aggressor: 'bystander' });
                ship.components.set(TargetComponent, { target: 'bystander' });
            });

            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });

            expect(target(world).components.has(AssistingComponent))
                .toBeFalse();
            // Its fight is undisturbed: same mode, same target.
            const npc = target(world).components.get(NpcComponent)!;
            expect(npc.mode).toBe('attack');
            expect(target(world).components.get(TargetComponent)!.target)
                .toBe('bystander');
        });

    it('assists once the fight is over and the ship is re-hailed', async () => {
        // The refusal is a state, not a grudge: the same ship helps as soon
        // as it is no longer fighting.
        const { world, addShip } = await makeWorld();
        player(world).components.set(DisabledComponent, { repairAt: null });
        await addShip('bystander', 900, 0);
        await addShip('target', 150, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:meek' });
            ship.components.set(NpcComponent,
                { aiType: 3, mode: 'attack' });
            ship.components.set(TargetComponent, { target: 'bystander' });
        });
        applyHail(world, PEER,
            { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.has(AssistingComponent)).toBeFalse();

        // The fight ends.
        const npc = target(world).components.get(NpcComponent)!;
        npc.mode = undefined;
        target(world).components.get(TargetComponent)!.target = undefined;

        applyHail(world, PEER,
            { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.get(AssistingComponent))
            .toEqual({ client: 'player' });
    });

    it('still assists a ship whose attack mode has no target', async () => {
        // "Busy" is the fire-control condition (mode AND a target); an
        // attack mode with nothing targeted is not shooting at anyone.
        const { world, addShip } = await makeWorld();
        player(world).components.set(DisabledComponent, { repairAt: null });
        await addShip('target', 150, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:meek' });
            ship.components.set(NpcComponent, { aiType: 3, mode: 'attack' });
            ship.components.set(TargetComponent, { target: undefined });
        });
        applyHail(world, PEER,
            { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.get(AssistingComponent))
            .toEqual({ client: 'player' });
    });

    it('still assists a ship that is fleeing', async () => {
        const { world, addShip } = await makeWorld();
        player(world).components.set(DisabledComponent, { repairAt: null });
        await addShip('bystander', 900, 0);
        await addShip('target', 150, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:meek' });
            ship.components.set(NpcComponent, { aiType: 3, mode: 'flee' });
            ship.components.set(TargetComponent, { target: 'bystander' });
        });
        applyHail(world, PEER,
            { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.get(AssistingComponent))
            .toEqual({ client: 'player' });
    });

    it('an alongside assister repairs and refuels the client, then leaves',
        async () => {
            const { world, addShip } = await makeWorld();
            const p = player(world);
            p.components.set(DisabledComponent, { repairAt: null });
            const armor = p.components.get(ArmorComponent)!;
            armor.current = 1;
            const fuel = p.components.get(FuelComponent);
            if (fuel) {
                fuel.current = 0;
            }
            // Place the helper already alongside (within ASSIST_ARRIVAL_RANGE).
            await addShip('target', 150, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
                ship.components.set(NpcComponent, { aiType: 3 });
            });
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            world.step();
            expect(p.components.get(ArmorComponent)!.current)
                .toBe(p.components.get(ArmorComponent)!.max);
            if (fuel) {
                expect(p.components.get(FuelComponent)!.current)
                    .toBe(p.components.get(FuelComponent)!.max);
            }
            // The helper releases back to normal AI once done.
            expect(target(world).components.has(AssistingComponent))
                .toBeFalse();
        });

    it('YIELDS to a jump sequence, and picks the errand back up if the ' +
        'jump is cancelled', async () => {
            // AssistBehaviorSystem writes turnTo/accelerating, so it is a
            // movement writer like FormationSystem, NpcSteeringSystem and
            // EscortCommandBehaviorSystem — all of which stand down for a
            // ship committed to a hyperspace jump, which has to hold still
            // for its spin-up and hold its heading through the burn. This
            // is the same bail, for the same reason.
            const { world, addShip } = await makeWorld();
            const p = player(world);
            p.components.set(DisabledComponent, { repairAt: null });
            const armor = p.components.get(ArmorComponent)!;
            armor.current = 1;
            // Alongside, so the ONLY thing that can stop it rendering
            // assistance this tick is the jump.
            await addShip('target', 150, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
                ship.components.set(NpcComponent, { aiType: 3 });
            });
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            // A jump held in spin-up: stageStart is absent, so the stage
            // never times out and the sequence parks there.
            target(world).components.set(JumpComponent, {
                stage: 'spinup', direction: 0, to: 'test:elsewhere',
            });
            world.step();

            expect(p.components.get(ArmorComponent)!.current).toBe(1);
            // The errand is KEPT, not abandoned: a cancelled jump must put
            // the helper straight back to work rather than strand a client
            // that is still waiting.
            expect(target(world).components.get(AssistingComponent))
                .toEqual({ client: 'player' });

            // Cancel the jump the way JumpDisableCancelSystem does.
            target(world).components.delete(JumpComponent);
            world.step();
            expect(p.components.get(ArmorComponent)!.current)
                .toBe(p.components.get(ArmorComponent)!.max);
            expect(target(world).components.has(AssistingComponent))
                .toBeFalse();
        });
});

/**
 * #297 and its ruling: "Hostility in the hailing channel should reflect the
 * iff of that ship, not the government stance." applyHail used to read only
 * the NPC-posture half of the corners' tier 3 (target on the player AND mode
 * 'attack'); it now asks hostility.ts's isIffHostile, the predicate the
 * corners paint with. The load-bearing difference is tier 3b, RECENT
 * AGGRESSION: a ship that shot the player inside AGGRESSION_WINDOW_MS is red
 * in the corners even after it breaks its lock and runs.
 */
describe('applyHail: hostility is the ship\'s IFF (ruling #297)', () => {
    /** A neutral-govt warship that shot the player and is now FLEEING. */
    async function fleeingAggressor(govt: string, shotAgoMs: number) {
        const made = await makeWorld();
        const { world, addShip } = made;
        player(world).components.set(DisabledComponent, { repairAt: null });
        await addShip('target', 150, 0, ship => {
            ship.components.set(GovtComponent, { id: govt });
            ship.components.set(NpcComponent, { aiType: 3, mode: 'flee' });
            ship.components.set(TargetComponent, { target: undefined });
        });
        const now = world.resources.get(TimeResource)!.time;
        player(world).components.set(AggressionComponent, new Map([
            ['target', { at: now - shotAgoMs, damage: 120, hostile: true }],
        ]));
        return made;
    }

    it('refuses assistance from a fleeing RECENT AGGRESSOR', async () => {
        // The corners are red (tier 3b); the channel offers Beg For Mercy,
        // not Request Assistance, so the sim must refuse the errand too —
        // otherwise the ship that just disabled the player flies over and
        // repairs them.
        const { world } = await fleeingAggressor('test:meek', 0);
        applyHail(world, PEER, { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.has(AssistingComponent)).toBeFalse();
    });

    it('takes a bribe from a fleeing recent aggressor whose govt bargains',
        async () => {
            const { world } = await fleeingAggressor('test:armed', 0);
            applyHail(world, PEER, { kind: 'bribe', target: 'target' });
            // 10% of 100k (armed is not a largerBribes govt).
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(90_000);
            expect(target(world).components.get(NpcComponent)!.pacifiedFrom)
                .toBe('player');
        });

    it('assists again once the aggression window has passed', async () => {
        const { world } = await fleeingAggressor('test:meek',
            AGGRESSION_WINDOW_MS);
        applyHail(world, PEER, { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.get(AssistingComponent))
            .toEqual({ client: 'player' });
    });

    it('takes no bribe once the window has passed (not IFF-hostile)',
        async () => {
            const { world } = await fleeingAggressor('test:armed',
                AGGRESSION_WINDOW_MS);
            applyHail(world, PEER, { kind: 'bribe', target: 'target' });
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(100_000);
        });

    it('refuses assistance from an ESCORT engaging the player', async () => {
        // An escort holding its leader's perimeter against us (command
        // 'defend', TargetComponent on us) is red in the corners before its
        // first shot lands; it is no rescuer either.
        const { world, addShip } = await makeWorld();
        player(world).components.set(DisabledComponent, { repairAt: null });
        await addShip('target', 150, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:meek' });
            ship.components.set(NpcComponent, { aiType: 3 });
            ship.components.set(TargetComponent, { target: 'player' });
            ship.components.set(EscortCommandComponent,
                { command: 'defend', target: 'player' });
        });
        applyHail(world, PEER, { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.has(AssistingComponent)).toBeFalse();
    });

    it('takes no bribe from a non-bribing govt: the plea is refused',
        async () => {
            // Beg For Mercy is OFFERED to every IFF-hostile ship now, so the
            // press can reach the sim for a govt that does not bargain; it
            // must cost nothing and change nothing.
            const { world } = await fleeingAggressor('test:meek', 0);
            applyHail(world, PEER, { kind: 'bribe', target: 'target' });
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(100_000);
            expect(target(world).components.get(NpcComponent)!.pacifiedFrom)
                .toBeUndefined();
        });
});

/**
 * Ruling #297: "Some ships don't respond to hails at all (no hailing channel
 * appears), like the krypt pod and wraith." The dialog never opens for one,
 * and the sim refuses anything a tampered client sends at one.
 */
describe('applyHail: a ship that does not answer hails', () => {
    it('neither assists nor bargains (gövt 0x0001 + 0x0008, the Krypt)',
        async () => {
            const { world, addShip } = await makeWorld();
            player(world).components.set(DisabledComponent, { repairAt: null });
            await addShip('target', 150, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:krypt' });
                ship.components.set(NpcComponent, { aiType: 3 });
            });
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            expect(target(world).components.has(AssistingComponent))
                .toBeFalse();
        });

    it('refuses a class that INHERITS Can\'t-hail (the gövt 159 Wraith)',
        async () => {
            const { world, addShip } = await makeWorld();
            player(world).components.set(DisabledComponent, { repairAt: null });
            await addShip('target', 150, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
                ship.components.set(NpcComponent, { aiType: 3 });
            }, 'test:wraith');
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            expect(target(world).components.has(AssistingComponent))
                .toBeFalse();
        });
});

/**
 * #332: applyHail resolved the hailer from the record's peer but took ANY
 * ship as the target — including another peer's own player ship, whose
 * AssistingComponent then had AssistBehaviorSystem steer the victim to the
 * requester and fully heal the requester on arrival. Matthew's ruling:
 * "For now, buttons pressed should just send the message to the bottom
 * left info text area on that player's screen. Nothing should take control
 * of their ship. Players can't repair each other yet."
 */
describe('applyHail: another player\'s ship (#332)', () => {
    const OTHER_PEER = 'other peer';

    /** The test world plus peer B's ship 'victim', within assist range. */
    async function twoPlayers() {
        const made = await makeWorld();
        await made.addShip('victim', 150, 0, ship => {
            ship.components.set(ControlledByComponent, { peerId: OTHER_PEER });
        });
        // Peer A is disabled and badly damaged: exactly the player the
        // exploit paid off for.
        const a = player(made.world);
        a.components.set(DisabledComponent, { repairAt: null });
        a.components.get(ArmorComponent)!.current = 1;
        return made;
    }

    function victim(world: World) {
        return world.entities.get('victim')!;
    }

    it('never marks another player\'s ship as assisting, and nobody is '
        + 'steered or healed', async () => {
            const { world } = await twoPlayers();
            const before = victim(world).components
                .get(MovementStateComponent)!;
            const turnTo = before.turnTo;
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'victim' });
            expect(victim(world).components.has(AssistingComponent))
                .toBeFalse();
            for (let i = 0; i < 5; i++) {
                world.step();
            }
            expect(player(world).components.get(ArmorComponent)!.current)
                .toBe(1);
            expect(victim(world).components.get(MovementStateComponent)!
                .turnTo).toEqual(turnTo);
        });

    it('takes no bribe from, and pacifies nothing on, a player ship',
        async () => {
            const { world } = await twoPlayers();
            // B shot A a moment ago: A sees B as IFF-hostile (tier 3b),
            // which is exactly when the dialog offers Beg For Mercy.
            const now = world.resources.get(TimeResource)!.time;
            player(world).components.set(AggressionComponent, new Map([
                ['victim', { at: now, damage: 50, hostile: true }],
            ]));
            applyHail(world, PEER, { kind: 'bribe', target: 'victim' });
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(100_000);
            expect(player(world).components.get(AggressionComponent)!
                .has('victim')).toBeTrue();
        });

    it('sends a message: recorded on the SENDER\'s ship, the target ship '
        + 'untouched', async () => {
            const { world } = await twoPlayers();
            const targetComponents = [...victim(world).components.keys()];
            applyHail(world, PEER, {
                kind: 'message', target: 'victim', message: 'greetings',
            });
            const sent = player(world).components.get(SentHailComponent);
            expect(sent).toEqual({
                to: 'victim', message: 'greetings', seq: 1,
                at: world.resources.get(TimeResource)!.time,
            });
            expect([...victim(world).components.keys()])
                .toEqual(targetComponents);
            expect(victim(world).components.has(SentHailComponent))
                .toBeFalse();

            // Every press is a new message, even of the same button.
            applyHail(world, PEER, {
                kind: 'message', target: 'victim', message: 'assistance',
            });
            expect(player(world).components.get(SentHailComponent))
                .toEqual(jasmine.objectContaining({
                    message: 'assistance', seq: 2,
                }));
        });

    it('records no message to an NPC, or to yourself', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('target', 150, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:meek' });
            ship.components.set(NpcComponent, { aiType: 3 });
        });
        applyHail(world, PEER,
            { kind: 'message', target: 'target', message: 'greetings' });
        applyHail(world, PEER,
            { kind: 'message', target: 'player', message: 'greetings' });
        expect(player(world).components.has(SentHailComponent)).toBeFalse();
    });

    it('refuses assistance from another player\'s ESCORT', async () => {
        const { world, addShip } = await makeWorld();
        player(world).components.set(DisabledComponent, { repairAt: null });
        await addShip('target', 150, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:meek' });
            ship.components.set(NpcComponent, { aiType: 3 });
            ship.components.set(PlayerEscortComponent,
                { player: 'their ship', deal: { kind: 'none' } } as never);
        });
        applyHail(world, PEER, { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.has(AssistingComponent)).toBeFalse();
    });

    it('refuses assistance from a ship another PEER inserted (a mission '
        + 'ship, a fighter), but not from a server-owned one', async () => {
            const { world, addShip } = await makeWorld();
            player(world).components.set(DisabledComponent, { repairAt: null });
            await addShip('target', 150, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
                ship.components.set(NpcComponent, { aiType: 3 });
                ship.components.set(MultiplayerData, { owner: OTHER_PEER });
            });
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            expect(target(world).components.has(AssistingComponent))
                .toBeFalse();

            target(world).components.set(MultiplayerData, { owner: 'server' });
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            expect(target(world).components.get(AssistingComponent))
                .toEqual({ client: 'player' });
        });

    it('AssistBehaviorSystem never steers a player\'s ship, even given a '
        + 'stray AssistingComponent', async () => {
            const { world } = await twoPlayers();
            victim(world).components.set(AssistingComponent,
                { client: 'player' });
            const turnTo = victim(world).components
                .get(MovementStateComponent)!.turnTo;
            world.step();
            expect(victim(world).components.has(AssistingComponent))
                .toBeFalse();
            expect(victim(world).components.get(MovementStateComponent)!
                .turnTo).toEqual(turnTo);
            expect(player(world).components.get(ArmorComponent)!.current)
                .toBe(1);
        });
});

/**
 * Matthew's rulings of 2026-10-03: "The request assistance / beg for mercy
 * button should always be visible for ships that communicate ... They just
 * refuse to help you or make you pay" (#297), and someone's escort answers
 * "Sorry sir, I'm just an escort." (#332). The simulation half: what a
 * request DOES, re-derived from synced state.
 */
describe('applyHail: an unfriendly ship refuses or charges; an escort '
    + 'declines (rulings #297/#332)', () => {
    /** A ship of `govt` that the player has bought off: its government is
     * hostile to them, but its IFF reads neutral. */
    function boughtOff(govt: string) {
        return (ship: ReturnType<typeof makeShip>) => {
            ship.components.set(GovtComponent, { id: govt });
            ship.components.set(NpcComponent, {
                aiType: 3, pacifiedFrom: 'player',
                pacifiedUntil: BRIBE_PACIFY_MS * 10,
            });
        };
    }

    it('makes the player PAY a bribe-taking unfriendly ship, then comes',
        async () => {
            const { world, addShip } = await makeWorld();
            player(world).components.set(DisabledComponent, { repairAt: null });
            await addShip('target', 150, 0, boughtOff('test:pirate'));
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            // 30% of 100k: the same demand a mercy plea from it costs.
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(70_000);
            expect(target(world).components.get(AssistingComponent))
                .toEqual({ client: 'player' });
            // A second Pay press while it is on its way charges nothing.
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(70_000);
        });

    it('refuses, and charges nothing, when the player cannot pay',
        async () => {
            // bribeAmount caps the demand at the player's cash, so only an
            // empty purse cannot pay at all.
            const { world, addShip } = await makeWorld();
            player(world).components.set(DisabledComponent, { repairAt: null });
            player(world).components.set(CreditsComponent, { credits: 0 });
            await addShip('target', 150, 0, boughtOff('test:pirate'));
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(0);
            expect(target(world).components.has(AssistingComponent))
                .toBeFalse();
        });

    it('REFUSES outright when the unfriendly govt takes no bribes',
        async () => {
            const { world, addShip } = await makeWorld();
            player(world).components.set(DisabledComponent, { repairAt: null });
            await addShip('target', 150, 0, boughtOff('test:hater'));
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            expect(target(world).components.has(AssistingComponent))
                .toBeFalse();
            expect(player(world).components.get(CreditsComponent)!.credits)
                .toBe(100_000);
        });

    it('lets a friendly ship help for free, as before', async () => {
        const { world, addShip } = await makeWorld();
        player(world).components.set(DisabledComponent, { repairAt: null });
        await addShip('target', 150, 0, ship => {
            ship.components.set(GovtComponent, { id: 'test:meek' });
            ship.components.set(NpcComponent, { aiType: 3 });
        });
        applyHail(world, PEER, { kind: 'requestAssistance', target: 'target' });
        expect(target(world).components.get(AssistingComponent))
            .toEqual({ client: 'player' });
        expect(player(world).components.get(CreditsComponent)!.credits)
            .toBe(100_000);
    });

    it('leaves an NPC flagship\'s fleet ESCORT alone — "I\'m just an escort"',
        async () => {
            const { world, addShip } = await makeWorld();
            player(world).components.set(DisabledComponent, { repairAt: null });
            await addShip('flagship', 400, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
                ship.components.set(NpcComponent, { aiType: 3 });
            });
            await addShip('target', 150, 0, ship => {
                ship.components.set(GovtComponent, { id: 'test:meek' });
                ship.components.set(NpcComponent, { aiType: 3 });
                ship.components.set(FormationComponent,
                    { leader: 'flagship', slot: 0 });
            });
            applyHail(world, PEER,
                { kind: 'requestAssistance', target: 'target' });
            expect(target(world).components.has(AssistingComponent))
                .toBeFalse();
            expect(target(world).components.get(FormationComponent))
                .toEqual({ leader: 'flagship', slot: 0 });
        });

    it('isSomeoneElsesEscort: a fleet escort, another player\'s escort and '
        + 'a bay fighter are; the hailer\'s own escort and a loner are not',
        () => {
            const fleet = new Entity().addComponent(FormationComponent,
                { leader: 'flagship', slot: 0 });
            const theirs = new Entity().addComponent(PlayerEscortComponent,
                { player: 'their ship', deal: { kind: 'none' } } as never);
            const fighter = new Entity().addComponent(OwnerComponent,
                { owner: 'carrier' });
            const mine = new Entity().addComponent(FormationComponent,
                { leader: 'player', slot: 0 });
            expect(isSomeoneElsesEscort(fleet, 'player')).toBeTrue();
            expect(isSomeoneElsesEscort(theirs, 'player')).toBeTrue();
            expect(isSomeoneElsesEscort(fighter, 'player')).toBeTrue();
            expect(isSomeoneElsesEscort(mine, 'player')).toBeFalse();
            expect(isSomeoneElsesEscort(new Entity(), 'player')).toBeFalse();
        });
});
