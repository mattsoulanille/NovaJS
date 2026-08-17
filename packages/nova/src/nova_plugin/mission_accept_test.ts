import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { SerializerPlugin, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { CargoComponent } from './cargo_plugin.js';
import { AcceptedMission, AcceptedMissionType, applyAcceptMission } from './mission_accept.js';
import { ActiveMission, ActiveMissionType, CreditsComponent, MissionsComponent, MAX_ACTIVE_MISSIONS } from './player_state_plugin.js';
import { ActiveRanksComponent, ControlBitsComponent } from './ncb_plugin.js';
import { OutfitsStateComponent } from './outfit_plugin.js';
import { ControlledByComponent } from './ship_control.js';
import { NpcComponent } from './npc_ai_plugin.js';
import { ShipOfferSpentComponent } from './mission_accept.js';

/**
 * ============================================================================
 * The in-flight mission-accept input record (shape A)
 * ============================================================================
 *
 * A përs ship offers its LinkMission when you hail it, or when you board
 * it (përs Flags 0x0200) — both in flight, where the docked
 * MissionSession/commit route does not exist. The client resolves the
 * offer (the simulation has no access to mission data at all) and bakes
 * the RESULT into a record as DELTAS; the sim applies it on every peer at
 * the same tick, enforcing the invariants it can check without that data.
 *
 * These specs pin the enforcement, since that is the whole trust boundary
 * (see mission_accept.ts's header for where it sits and why).
 */

const PEER = 'the peer';
const MISSION = 'nova:134';

function activeMission(overrides: Partial<ActiveMission> = {}): ActiveMission {
    return {
        id: MISSION, acceptedDay: 0, acceptedAt: 'nova:128',
        travelPlanet: null, returnPlanet: 'nova:128',
        cargoType: -1, cargoQty: 0, cargoLoaded: false,
        travelDone: false, deadlineDay: null, ...overrides,
    };
}

/** A world with one player ship, controlled by PEER. */
function makeWorld() {
    const world = new World();
    world.addPlugin(SerializerPlugin);
    const player = new Entity('player');
    player.components.set(ControlledByComponent, { peerId: PEER });
    player.components.set(MissionsComponent, new Map());
    player.components.set(CreditsComponent, { credits: 1000 });
    player.components.set(ControlBitsComponent, new Set<number>());
    player.components.set(ActiveRanksComponent, new Set<string>());
    player.components.set(CargoComponent, new Map());
    player.components.set(OutfitsStateComponent, new Map());
    world.entities.set('player', player);
    return { world, player };
}

function accepted(overrides: Partial<AcceptedMission> = {}): AcceptedMission {
    return {
        missionId: MISSION,
        mission: ActiveMissionType.encode(activeMission()),
        ...overrides,
    };
}

const missionsOf = (player: Entity) =>
    player.components.get(MissionsComponent)!;

/** A minimal encoded entity for the record's `ships` batch. */
function encodedShip(world: World) {
    const serializer = world.resources.get(SerializerResource)!;
    return serializer.encode(new Entity('pirate'));
}

describe('applyAcceptMission', () => {
    it('registers the resolved mission on the acting peer\'s ship', () => {
        const { world, player } = makeWorld();
        applyAcceptMission(world, PEER, accepted());
        expect(missionsOf(player).get(MISSION)?.returnPlanet)
            .toEqual('nova:128');
    });

    it('resolves the actor from peerId, never from the record', () => {
        // The record cannot name whose mission this is, so no peer can
        // accept one on somebody else's behalf — the same discipline
        // applyHail uses.
        const { world, player } = makeWorld();
        applyAcceptMission(world, 'a different peer', accepted());
        expect(missionsOf(player).size).toEqual(0);
    });

    it('is idempotent: a replayed record cannot pay twice', () => {
        // Load-bearing for rollback, which resimulates recorded inputs.
        const { world, player } = makeWorld();
        const record = accepted({ creditsDelta: 500 });
        applyAcceptMission(world, PEER, record);
        applyAcceptMission(world, PEER, record);
        applyAcceptMission(world, PEER, record);
        expect(missionsOf(player).size).toEqual(1);
        expect(player.components.get(CreditsComponent)!.credits)
            .toEqual(1500);
    });

    it('re-checks the 16-mission cap', () => {
        const { world, player } = makeWorld();
        const missions = missionsOf(player);
        for (let i = 0; i < MAX_ACTIVE_MISSIONS; i++) {
            missions.set(`filler:${i}`, activeMission({ id: `filler:${i}` }));
        }
        applyAcceptMission(world, PEER, accepted());
        expect(missions.has(MISSION)).toBeFalse();
        expect(missions.size).toEqual(MAX_ACTIVE_MISSIONS);
    });

    it('drops a record whose mission does not decode', () => {
        const { world, player } = makeWorld();
        applyAcceptMission(world, PEER,
            { missionId: MISSION, mission: { nonsense: true } });
        expect(missionsOf(player).size).toEqual(0);
    });

    describe('the accept\'s effects, applied as DELTAS', () => {
        it('applies a signed credit change', () => {
            const { world, player } = makeWorld();
            applyAcceptMission(world, PEER, accepted({ creditsDelta: -250 }));
            expect(player.components.get(CreditsComponent)!.credits)
                .toEqual(750);
        });

        it('clamps credits at zero: EV Nova has no debt', () => {
            const { world, player } = makeWorld();
            applyAcceptMission(world, PEER,
                accepted({ creditsDelta: -999_999 }));
            expect(player.components.get(CreditsComponent)!.credits)
                .toEqual(0);
        });

        it('composes with a concurrent change, which an absolute could not',
            () => {
                // The reason the record carries deltas: rollback can
                // resimulate the ticks between the client computing the
                // record and the sim applying it. A "set credits to 1500"
                // would silently undo the plunder below; "+500" survives.
                const { world, player } = makeWorld();
                player.components.get(CreditsComponent)!.credits -= 400;
                applyAcceptMission(world, PEER, accepted({ creditsDelta: 500 }));
                expect(player.components.get(CreditsComponent)!.credits)
                    .toEqual(1100);
            });

        it('sets and clears control bits (the OnAccept set string)', () => {
            const { world, player } = makeWorld();
            player.components.get(ControlBitsComponent)!.add(7);
            applyAcceptMission(world, PEER,
                accepted({ bitsSet: [1, 2], bitsCleared: [7] }));
            const bits = player.components.get(ControlBitsComponent)!;
            expect([...bits].sort()).toEqual([1, 2]);
        });

        it('grants and revokes ranks', () => {
            const { world, player } = makeWorld();
            player.components.get(ActiveRanksComponent)!.add('nova:200');
            applyAcceptMission(world, PEER, accepted({
                ranksGranted: ['nova:201'], ranksRevoked: ['nova:200'],
            }));
            expect([...player.components.get(ActiveRanksComponent)!])
                .toEqual(['nova:201']);
        });

        it('moves cargo, dropping keys that empty out', () => {
            const { world, player } = makeWorld();
            player.components.get(CargoComponent)!.set('Food', 3);
            applyAcceptMission(world, PEER, accepted({
                cargoDelta: [['Food', -3], ['mission:nova:134', 2]],
            }));
            const cargo = player.components.get(CargoComponent)!;
            expect(cargo.has('Food')).toBeFalse();
            expect(cargo.get('mission:nova:134')).toEqual(2);
        });

        it('moves outfits and re-derives what depends on them', () => {
            const { world, player } = makeWorld();
            player.components.get(OutfitsStateComponent)!
                .set('nova:300', { count: 1 });
            applyAcceptMission(world, PEER, accepted({
                outfitsDelta: [['nova:300', -1], ['nova:301', 2]],
            }));
            const outfits = player.components.get(OutfitsStateComponent)!;
            expect(outfits.has('nova:300')).toBeFalse();
            expect(outfits.get('nova:301')?.count).toEqual(2);
        });

        it('leaves derived state alone when no outfit moved', () => {
            const { world, player } = makeWorld();
            applyAcceptMission(world, PEER, accepted({ creditsDelta: 1 }));
            expect(player.components.has(OutfitsStateComponent)).toBeTrue();
        });
    });

    describe('the special ships that ride the record', () => {
        /** A bare serializable ship entity, encoded as the record carries
         * it. */
        it('inserts them, so the mission and its ambush land together',
            () => {
                // The Derelict Decoy's four pirates jump in the moment you
                // take the bait. They ride THIS record rather than a
                // follow-up so a reorder or a dropped second record can
                // never leave a mission whose ships never came.
                const { world, player } = makeWorld();
                applyAcceptMission(world, PEER, accepted({
                    ships: [
                        { uuid: 'pirate:1', entity: encodedShip(world) as never },
                        { uuid: 'pirate:2', entity: encodedShip(world) as never },
                    ],
                }));
                expect(world.entities.has('pirate:1')).toBeTrue();
                expect(world.entities.has('pirate:2')).toBeTrue();
                expect(missionsOf(player).has(MISSION)).toBeTrue();
            });

        it('does not insert them when the accept itself was refused', () => {
            // A record that fails the cap check must not leave its ambush
            // behind: the ships belong to a mission that never started.
            const { world, player } = makeWorld();
            const missions = missionsOf(player);
            for (let i = 0; i < MAX_ACTIVE_MISSIONS; i++) {
                missions.set(`filler:${i}`,
                    activeMission({ id: `filler:${i}` }));
            }
            applyAcceptMission(world, PEER, accepted({
                ships: [
                    { uuid: 'pirate:1', entity: encodedShip(world) as never },
                ],
            }));
            expect(world.entities.has('pirate:1')).toBeFalse();
        });
    });

    describe('the offering përs hull', () => {
        /** A world plus a përs hull for the player to have hailed. */
        function withOffering(npc: Partial<{ mode: string }> = {}) {
            const made = makeWorld();
            const offering = new Entity('the përs');
            offering.components.set(NpcComponent, {
                mode: 'wander', departAt: 1e15, ...npc,
            } as never);
            made.world.entities.set('npc:pers', offering);
            return { ...made, offering };
        }

        it('marks the hull spent, so one offer is taken at most once', () => {
            // The second key (the first is the mission list): a
            // double-clicked Accept produces two records naming the same
            // hull, and only the first may land.
            const { world, player, offering } = withOffering();
            applyAcceptMission(world, PEER,
                accepted({ offeredBy: 'npc:pers', creditsDelta: 500 }));
            expect(offering.components.has(ShipOfferSpentComponent)).toBeTrue();
            expect(player.components.get(CreditsComponent)!.credits)
                .toEqual(1500);

            // A second record for a DIFFERENT mission off the same hull is
            // refused outright — the hull has nothing left to offer.
            applyAcceptMission(world, PEER, accepted({
                missionId: 'nova:133', offeredBy: 'npc:pers',
                mission: ActiveMissionType.encode(
                    activeMission({ id: 'nova:133' })),
                creditsDelta: 500,
            }));
            expect(missionsOf(player).has('nova:133')).toBeFalse();
            expect(player.components.get(CreditsComponent)!.credits)
                .toEqual(1500);
        });

        it('replaces the hull with the mission ship in ONE apply '
            + '(përs Flags 0x0040)', () => {
                // Bible: "replace it with this ship while removing this
                // one from play". Matthew's ruling is that the përs is
                // never pulled out of the world and put back — so the
                // replacement is inserted and the hull deleted on the
                // same tick, and the ship visibly becomes the new one.
                const { world, offering } = withOffering();
                applyAcceptMission(world, PEER, accepted({
                    offeredBy: 'npc:pers', offeredByFate: 'replace',
                    ships: [{
                        uuid: 'rescue:1',
                        entity: encodedShip(world) as never,
                    }],
                }));
                expect(world.entities.has('npc:pers')).toBeFalse();
                expect(world.entities.has('rescue:1')).toBeTrue();
                // The marker went on the hull before it was deleted; what
                // matters is that the hull is gone with it.
                expect(offering.components.has(ShipOfferSpentComponent))
                    .toBeTrue();
            });

        it('keeps the hull when a "replace" record carries NO replacement '
            + '(the client failed to build the ship)', () => {
                const { world } = withOffering();
                applyAcceptMission(world, PEER, accepted({
                    offeredBy: 'npc:pers', offeredByFate: 'replace',
                    ships: [],
                }));
                // The person stays rather than becoming nothing.
                expect(world.entities.has('npc:pers')).toBeTrue();
            });

        it('sends the hull on its way instead of deleting it '
            + '(përs Flags 0x0800)', () => {
                // "Make ship leave after accepting its LinkMission": the
                // person departs under their own power, so the hull stays
                // and its NPC AI is told the departure time has passed.
                const { world, offering } = withOffering();
                applyAcceptMission(world, PEER, accepted({
                    offeredBy: 'npc:pers', offeredByFate: 'leave',
                }));
                expect(world.entities.has('npc:pers')).toBeTrue();
                expect(offering.components.get(NpcComponent)!.departAt)
                    .toEqual(0);
            });

        it('leaves a hull with no fate alone', () => {
            // The derelicts you board keep floating there.
            const { world, offering } = withOffering();
            applyAcceptMission(world, PEER,
                accepted({ offeredBy: 'npc:pers' }));
            expect(world.entities.has('npc:pers')).toBeTrue();
            expect(offering.components.get(NpcComponent)!.departAt)
                .toEqual(1e15);
        });

        it('is tolerant of a hull that is already gone', () => {
            // It could have been destroyed between the client resolving
            // the accept and the record being applied (or replayed).
            const { world, player } = makeWorld();
            applyAcceptMission(world, PEER, accepted({
                offeredBy: 'npc:vanished', offeredByFate: 'replace',
            }));
            expect(missionsOf(player).has(MISSION)).toBeTrue();
        });
    });

    describe('an IMMEDIATE auto-abort accept (mïsn 133 "Derelict Decoy")', () => {
        function decoyRecord(overrides: Partial<AcceptedMission> = {}) {
            return accepted({
                missionId: 'nova:133', mission: null,
                autoAborted: true, offeredBy: 'npc:pers', ...overrides,
            });
        }

        it('spawns the ambush without adding any mission', () => {
            // The mission never becomes active (mission_logic's
            // acceptOffer), so the player's list must stay untouched —
            // but the four pirates are the whole point and must arrive.
            const { world, player } = makeWorld();
            const offering = new Entity('the derelict');
            world.entities.set('npc:pers', offering);
            applyAcceptMission(world, PEER, decoyRecord({
                ships: [
                    { uuid: 'pirate:1', entity: encodedShip(world) as never },
                    { uuid: 'pirate:2', entity: encodedShip(world) as never },
                    { uuid: 'pirate:3', entity: encodedShip(world) as never },
                    { uuid: 'pirate:4', entity: encodedShip(world) as never },
                ],
            }));
            expect(missionsOf(player).size).toEqual(0);
            for (const uuid of ['pirate:1', 'pirate:2', 'pirate:3',
                'pirate:4']) {
                expect(world.entities.has(uuid)).withContext(uuid).toBeTrue();
            }
        });

        it('cannot spring the trap twice', () => {
            // Its idempotence key is the hull, since there is no mission
            // to find in the player's list.
            const { world } = makeWorld();
            world.entities.set('npc:pers', new Entity('the derelict'));
            applyAcceptMission(world, PEER, decoyRecord({
                ships: [
                    { uuid: 'pirate:1', entity: encodedShip(world) as never },
                ],
            }));
            applyAcceptMission(world, PEER, decoyRecord({
                ships: [
                    { uuid: 'pirate:5', entity: encodedShip(world) as never },
                ],
            }));
            expect(world.entities.has('pirate:1')).toBeTrue();
            expect(world.entities.has('pirate:5')).toBeFalse();
        });

        it('is dropped when it names no hull to key on', () => {
            const { world } = makeWorld();
            applyAcceptMission(world, PEER, accepted({
                missionId: 'nova:133', mission: null, autoAborted: true,
                ships: [
                    { uuid: 'pirate:1', entity: encodedShip(world) as never },
                ],
            }));
            expect(world.entities.has('pirate:1')).toBeFalse();
        });
    });

    it('round-trips through its codec unchanged', () => {
        // The record reaches other peers through JSON.stringify, so every
        // field has to be JSON-safe: no Map, no Set, no Position.
        const record = accepted({
            offeredBy: 'npc:derelict', creditsDelta: -100,
            bitsSet: [3], ranksGranted: ['nova:200'],
            cargoDelta: [['Food', 2]], outfitsDelta: [['nova:300', 1]],
            offeredByFate: 'replace', autoAborted: true,
        });
        const wire = JSON.parse(JSON.stringify(
            AcceptedMissionType.encode(record)));
        const decoded = AcceptedMissionType.decode(wire);
        expect(decoded._tag).toEqual('Right');
        if (decoded._tag === 'Right') {
            expect(decoded.right.missionId).toEqual(MISSION);
            expect(decoded.right.offeredBy).toEqual('npc:derelict');
            expect(decoded.right.cargoDelta).toEqual([['Food', 2]]);
            expect(decoded.right.offeredByFate).toEqual('replace');
            expect(decoded.right.autoAborted).toBeTrue();
        }
    });
});
