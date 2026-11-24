import 'jasmine';
import { GovtData, getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import {
    restoreWorld, snapshotWorld,
} from 'nova_ecs/plugins/snapshot_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { styleForTarget } from '../combat/index.js';
import {
    deriveEntityComponents, GovtComponent, SystemIdResource,
} from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { ControlledByComponent } from '../player/index.js';
import {
    DamagedEvent, FiringGroupComponent, makeShip, SourceComponent,
    TargetComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import {
    DISTRESS_CALL_INTERVAL_MS, distressCallDue, DistressCallEvent,
    DistressCallEventData, distressCallMessage, distressLine,
    sendsDistressCalls,
} from './distress.js';
import { NpcComponent } from './npc_component.js';
import { INTERCEPTOR_ENGAGE_RANGE } from './npc_decision.js';
import { FormationComponent } from './npc_formation.js';
import { PIRACY_WATCH_RANGE, policeDefendVictim } from './piracy_police.js';

/**
 * ============================================================================
 * Piracy police and distress calls (reference "P1 wave 14")
 * ============================================================================
 *
 * docs/reference_experiments.md, "P1 wave 14: piracy police are the NOSY
 * govts, gövt 0x0020, police defending an ally, distress calls", against
 * wave 13's non-nosy police (who watched hits, a kill and a board and did
 * nothing):
 *  - nosy police (gövt 0x0002) turned on the player for shooting a trader of
 *    an unrelated govt beside them, and ignored it for a 0x0020 victim;
 *  - non-nosy police defended their ALLY's trader;
 *  - traders under NPC attack sent "<ship>: <STR# 5003 line>", never those
 *    of a Flags2-0x0008 govt.
 */

const HULL = 'test:hull';
const QUIET_HULL = 'test:quiet-hull';

const NOSY = 'test:nosy';
const PLAIN = 'test:plain';
const FRIEND = 'test:friend';
const SHIPPING = 'test:shipping';
const IGNORED = 'test:ignored';
const QUIET = 'test:quiet';
const RAIDER = 'test:raider';

/** A govt with only these fields changed from the defaults. */
function govt(id: string, classes: number[],
    more: Partial<Omit<GovtData, 'flags' | 'flags2'>> & {
        flags?: Partial<GovtData['flags']>,
        flags2?: Partial<GovtData['flags2']>,
    } = {}): GovtData {
    const base = getDefaultGovtData();
    return {
        ...base, ...more, id, classes,
        flags: { ...base.flags, ...more.flags },
        flags2: { ...base.flags2, ...more.flags2 },
    };
}

const GOVTS: GovtData[] = [
    govt(NOSY, [10], { flags: { attacksPlayerIfCriminal: true } }),
    // PLAIN and FRIEND are allies both ways, as in the reference rig (gövt
    // 323 Kit Police Allied and 324 Kit Police Friend).
    govt(PLAIN, [11], { allies: [12] }),
    govt(FRIEND, [12], { allies: [11] }),
    govt(SHIPPING, [13]),
    govt(IGNORED, [14], { flags: { ignoredByOtherNosyGovts: true } }),
    govt(QUIET, [15], { flags2: { noDistressMessages: true } }),
    govt(RAIDER, [16], { enemies: [13, 14, 15] }),
];
const byId = new Map(GOVTS.map(g => [g.id, g]));
const G = (id: string) => byId.get(id)!;

const NO_DAMAGE: WeaponDamage = {
    shield: 0, armor: 0, ionization: 0, ionizationColor: 0xffffff,
    passThroughShield: 0, knockback: 0,
};

/** Never thinks until a test says so. */
const ASLEEP = Number.MAX_SAFE_INTEGER;

describe('policeDefendVictim', () => {
    it('a NOSY govt defends any non-enemy victim of an unrelated govt',
        () => {
            expect(policeDefendVictim(G(NOSY), G(SHIPPING), undefined))
                .toBeTrue();
            // An independent ship (no govt) too.
            expect(policeDefendVictim(G(NOSY), undefined, undefined))
                .toBeTrue();
        });

    it('a non-nosy govt does not (reference wave 13)', () => {
        expect(policeDefendVictim(G(PLAIN), G(SHIPPING), undefined))
            .toBeFalse();
    });

    it('gövt 0x0020 victims are ignored by nosy police', () => {
        expect(policeDefendVictim(G(NOSY), G(IGNORED), undefined))
            .toBeFalse();
    });

    it('any police defend their own govt\'s and an ally\'s ship, 0x0020 '
        + 'or not', () => {
            expect(policeDefendVictim(G(PLAIN), G(FRIEND), undefined))
                .toBeTrue();
            expect(policeDefendVictim(G(PLAIN), G(PLAIN), undefined))
                .toBeTrue();
            const ignoredAlly = govt('test:ignored-ally', [12],
                { flags: { ignoredByOtherNosyGovts: true } });
            expect(policeDefendVictim(G(PLAIN), ignoredAlly, undefined))
                .toBeTrue();
        });

    it('a ONE-WAY alliance is enough (GUESS: the A14 enforcement rule)',
        () => {
            const oneWay = govt('test:one-way', [20], { allies: [11] });
            expect(policeDefendVictim(G(PLAIN), oneWay, undefined))
                .toBeTrue();
        });

    it('not a victim the police count as an ENEMY ("non-enemy ship")', () => {
        const hostileNosy = govt('test:nosy-hostile', [10],
            { flags: { attacksPlayerIfCriminal: true }, enemies: [13] });
        expect(policeDefendVictim(hostileNosy, G(SHIPPING), undefined))
            .toBeFalse();
    });

    it('never against an attacker of their own or an allied govt', () => {
        expect(policeDefendVictim(G(NOSY), G(SHIPPING), G(NOSY)))
            .toBeFalse();
        expect(policeDefendVictim(G(PLAIN), G(PLAIN), G(FRIEND)))
            .toBeFalse();
    });

    it('a ship with no govt polices nothing', () => {
        expect(policeDefendVictim(undefined, G(SHIPPING), undefined))
            .toBeFalse();
    });

    it('watches over the interceptor\'s engagement range', () => {
        expect(PIRACY_WATCH_RANGE).toBe(INTERCEPTOR_ENGAGE_RANGE);
    });
});

describe('distress call rules', () => {
    it('traders call; warships and interceptors do not', () => {
        expect(sendsDistressCalls(1, G(SHIPPING), false)).toBeTrue();
        expect(sendsDistressCalls(2, G(SHIPPING), false)).toBeTrue();
        expect(sendsDistressCalls(3, G(SHIPPING), false)).toBeFalse();
        expect(sendsDistressCalls(4, G(SHIPPING), false)).toBeFalse();
        expect(sendsDistressCalls(1, undefined, undefined)).toBeTrue();
    });

    it('Flags2 0x0008 silences a govt\'s ships, and a hull inheriting it',
        () => {
            expect(sendsDistressCalls(1, G(QUIET), false)).toBeFalse();
            expect(sendsDistressCalls(1, G(SHIPPING), true)).toBeFalse();
        });

    it('one call per DISTRESS_CALL_INTERVAL_MS', () => {
        expect(distressCallDue(undefined, 0)).toBeTrue();
        expect(distressCallDue(1000, 1000 + DISTRESS_CALL_INTERVAL_MS - 1))
            .toBeFalse();
        expect(distressCallDue(1000, 1000 + DISTRESS_CALL_INTERVAL_MS))
            .toBeTrue();
    });

    it('the draw picks a line, skipping blanks', () => {
        const lines = ['Mayday!', '', 'Help us!', 'Anyone?'];
        expect(distressLine(lines, 0)).toBe('Mayday!');
        expect(distressLine(lines, 0.5)).toBe('Help us!');
        expect(distressLine(lines, 0.999)).toBe('Anyone?');
        expect(distressLine([], 0.5)).toBeUndefined();
        expect(distressLine(['', ' '], 0.5)).toBeUndefined();
    });

    it('reads "<ship name>: <line>"', () => {
        expect(distressCallMessage('Kit Shipping',
            'We\'re being attacked! Someone please help us!'))
            .toBe('Kit Shipping: We\'re being attacked! Someone please help us!');
    });
});

describe('piracy police and distress calls in the sim', () => {
    let gameData: MockGameData;
    let world: World;
    let calls: DistressCallEventData[];

    beforeEach(async () => {
        gameData = new MockGameData();
        const hull = getDefaultShipData();
        gameData.data.Ship.map.set(HULL, { ...hull, id: HULL });
        gameData.data.Ship.map.set(QUIET_HULL,
            { ...hull, id: QUIET_HULL, inheritedNoGreetings: true });
        for (const g of GOVTS) {
            gameData.data.Govt.map.set(g.id, g);
        }
        world = await makeSystem('test:system', gameData, undefined,
            { npcs: false });
        calls = [];
        world.events.get(DistressCallEvent).subscribe(
            ({ data }) => calls.push(data));
    });

    function pin(ship: Entity, x: number, y: number) {
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
    }

    async function addShip(uuid: string, x: number, y: number,
        setup: (ship: Entity) => void, hull = HULL) {
        const ship = makeShip(gameData.data.Ship.map.get(hull)!);
        setup(ship);
        await completeEntity(world, ship);
        pin(ship, x, y);
        world.entities.set(uuid, ship);
        return ship;
    }

    function npcShip(aiType: number, govtId: string) {
        return (ship: Entity) => {
            ship.components.set(NpcComponent,
                { aiType, nextDecision: ASLEEP, departAt: 1e12 });
            ship.components.set(GovtComponent, { id: govtId });
        };
    }

    const player = (ship: Entity) =>
        ship.components.set(ControlledByComponent, { peerId: 'peer' });

    /** The player beside a trader of `victimGovt`, a police ship of
     * `policeGovt` 500 px off, and one more 6000 px away (out of sight). */
    async function scene(policeGovt: string, victimGovt: string,
        victimAi = 1) {
        await addShip('player', 0, 0, player);
        await addShip('victim', 0, -150, npcShip(victimAi, victimGovt));
        await addShip('police', 500, 0, npcShip(4, policeGovt));
        await addShip('farPolice', 6000, 0, npcShip(4, policeGovt));
        world.step();
    }

    /** A hit on `victim` through the real DamagedEvent path. */
    function hit(victim: string, firer: string,
        { group, aimed }: { group?: string, aimed: boolean }) {
        const shot = new Entity('shot').addComponent(SourceComponent, firer);
        if (group !== undefined) {
            shot.components.set(FiringGroupComponent, { group });
        }
        if (aimed) {
            shot.components.set(TargetComponent, { target: victim });
        }
        const shotUuid = `shot ${now()}`;
        world.entities.set(shotUuid, shot);
        world.step();
        world.emit(DamagedEvent, { damage: NO_DAMAGE, damager: shotUuid },
            [victim]);
        world.step();
        world.entities.delete(shotUuid);
        world.step();
    }

    function now() {
        return world.resources.get(TimeResource)!.time;
    }

    function npc(uuid: string) {
        return world.entities.get(uuid)!.components.get(NpcComponent)!;
    }

    function wake(...uuids: string[]) {
        for (const uuid of uuids) {
            npc(uuid).nextDecision = 0;
        }
    }

    function style(uuid: string) {
        return styleForTarget(uuid, world.entities.get(uuid)!, 'player',
            world.entities.get('player')!, gameData,
            id => world.entities.get(id), now(),
            world.resources.get(SystemIdResource));
    }

    function advance(ms: number) {
        const until = now() + ms;
        while (now() < until) {
            world.step();
        }
    }

    describe('piracy police', () => {
        it('NOSY police that see the player shoot an unrelated trader turn '
            + 'on him: red, attacking', async () => {
                await scene(NOSY, SHIPPING);
                expect(style('police')).not.toBe('hostile');
                hit('victim', 'player', { group: 'player', aimed: true });
                expect(npc('police').aggressor).toBe('player');
                wake('police');
                advance(2000);
                expect(npc('police').mode).toBe('attack');
                expect(world.entities.get('police')!.components
                    .get(TargetComponent)?.target).toBe('player');
                expect(style('police')).toBe('hostile');
            });

        it('police out of sight (beyond PIRACY_WATCH_RANGE of both ships) '
            + 'do not', async () => {
                await scene(NOSY, SHIPPING);
                hit('victim', 'player', { group: 'player', aimed: true });
                expect(npc('farPolice').aggressor).toBeUndefined();
            });

        it('NON-nosy police ignore it (reference wave 13)', async () => {
            await scene(PLAIN, SHIPPING);
            hit('victim', 'player', { group: 'player', aimed: true });
            expect(npc('victim').aggressor).toBe('player');
            expect(npc('police').aggressor).toBeUndefined();
        });

        it('nosy police ignore an attack on a gövt 0x0020 ship', async () => {
            await scene(NOSY, IGNORED);
            hit('victim', 'player', { group: 'player', aimed: true });
            expect(npc('police').aggressor).toBeUndefined();
        });

        it('non-nosy police defend their ALLY\'s ship', async () => {
            await scene(PLAIN, FRIEND);
            hit('victim', 'player', { group: 'player', aimed: true });
            expect(npc('police').aggressor).toBe('player');
            wake('police');
            advance(2000);
            expect(style('police')).toBe('hostile');
        });

        it('and their own govt\'s ship', async () => {
            await scene(PLAIN, PLAIN);
            hit('victim', 'player', { group: 'player', aimed: true });
            expect(npc('police').aggressor).toBe('player');
        });

        it('the player\'s escort shooting: the police go for the escort, as '
            + 'the victim does', async () => {
                await scene(NOSY, SHIPPING);
                await addShip('wing', -100, 0, ship => {
                    ship.components.set(FormationComponent,
                        { leader: 'player', slot: 0 });
                    ship.components.set(FiringGroupComponent,
                        { group: 'player' });
                });
                world.step();
                hit('victim', 'wing', { group: 'player', aimed: true });
                expect(npc('victim').aggressor).toBe('wing');
                expect(npc('police').aggressor).toBe('wing');
            });

        it('NPC-on-NPC fights are not policed (GUESS: player-side only)',
            async () => {
                await scene(NOSY, SHIPPING);
                await addShip('raider', 0, -400, npcShip(3, RAIDER));
                world.step();
                hit('victim', 'raider', { group: 'raider', aimed: true });
                expect(npc('victim').aggressor).toBe('raider');
                expect(npc('police').aggressor).toBeUndefined();
            });

        it('self-defence is not piracy: no witness for a victim attacking '
            + 'the player', async () => {
                await scene(NOSY, SHIPPING, 2);
                Object.assign(npc('victim'), { mode: 'attack' });
                world.entities.get('victim')!.components.set(TargetComponent,
                    { target: 'player' });
                hit('victim', 'player', { group: 'player', aimed: true });
                expect(npc('police').aggressor).toBeUndefined();
            });

        it('a stray player hit counts as the victim\'s own rule does',
            async () => {
                await scene(NOSY, SHIPPING);
                hit('victim', 'player', { group: 'player', aimed: false });
                expect(npc('police').aggressor).toBe('player');
            });

        it('the hostility ends with the visit: gone with the player',
            async () => {
                await scene(NOSY, SHIPPING);
                hit('victim', 'player', { group: 'player', aimed: true });
                world.entities.delete('player');
                wake('police');
                advance(2000);
                expect(npc('police').aggressor).toBeUndefined();
                expect(npc('police').mode).not.toBe('attack');
            });

        it('voids a police ship\'s bribe', async () => {
            await scene(NOSY, SHIPPING);
            Object.assign(npc('police'),
                { pacifiedFrom: 'player', pacifiedUntil: now() + 60_000 });
            hit('victim', 'player', { group: 'player', aimed: true });
            expect(npc('police').aggressor).toBe('player');
            expect(npc('police').pacifiedFrom).toBeUndefined();
        });

        it('a player shot sends no distress call (none seen on the '
            + 'original)', async () => {
                await scene(NOSY, SHIPPING);
                hit('victim', 'player', { group: 'player', aimed: true });
                expect(calls).toEqual([]);
            });

        // Reference "P1 wave 15", finding 1: five runs of the player
        // shooting traders (waves 12-15), never one call, against several
        // a minute from traders under NPC attack.
        it('the player\'s own victims NEVER call, however long he keeps at '
            + 'it (reference wave 15)', async () => {
                await scene(PLAIN, SHIPPING);
                for (let i = 0; i < 4; i++) {
                    hit('victim', 'player', { group: 'player', aimed: true });
                    advance(DISTRESS_CALL_INTERVAL_MS);
                }
                expect(calls).toEqual([]);
                expect(npc('victim').distressAt).toBeUndefined();
            });

        // Reference "P1 wave 15", finding 2: a NON-nosy owner's police
        // turned on the player for shooting a ship of its ALLY whose govt
        // sets 0x0020 (brackets red, bolts): 0x0020 turns away only nosy
        // govts that are not allied (the Bible's "non-allied").
        it('0x0020 does not stop the police of the victim\'s ALLY (reference '
            + 'wave 15)', async () => {
                const ignoredFriend = govt('test:ignored-friend', [12],
                    { flags: { ignoredByOtherNosyGovts: true } });
                gameData.data.Govt.map.set(ignoredFriend.id, ignoredFriend);
                await scene(PLAIN, ignoredFriend.id);
                hit('victim', 'player', { group: 'player', aimed: true });
                expect(npc('police').aggressor).toBe('player');
                wake('police');
                advance(2000);
                expect(style('police')).toBe('hostile');
            });

        // Reference "P1 wave 15", finding 3: a nosy police's hostility was
        // still on after 30 s and 60 s (brackets red, the shield falling),
        // and gone after a jump out and back ("gone with the player",
        // above): it lasts the visit, not a timer.
        it('the hostility outlasts a minute while the player stays '
            + '(reference wave 15)', async () => {
                await scene(NOSY, SHIPPING);
                hit('victim', 'player', { group: 'player', aimed: true });
                wake('police');
                advance(61_000);
                expect(npc('police').aggressor).toBe('player');
                expect(npc('police').mode).toBe('attack');
                expect(style('police')).toBe('hostile');
            });
    });

    describe('distress calls', () => {
        async function raid(victimGovt: string, victimAi = 1,
            hull = HULL) {
            await addShip('victim', 0, -150, npcShip(victimAi, victimGovt),
                hull);
            await addShip('raider', 0, -400, npcShip(3, RAIDER));
            world.step();
        }

        it('a trader under NPC attack calls, once per interval', async () => {
            await raid(SHIPPING);
            hit('victim', 'raider', { group: 'raider', aimed: true });
            expect(calls.length).toBe(1);
            expect(calls[0].ship).toBe('victim');
            expect(calls[0].roll).toBeGreaterThanOrEqual(0);
            expect(calls[0].roll).toBeLessThan(1);
            expect(npc('victim').distressAt).toBeDefined();
            hit('victim', 'raider', { group: 'raider', aimed: true });
            expect(calls.length).toBe(1);
            advance(DISTRESS_CALL_INTERVAL_MS);
            hit('victim', 'raider', { group: 'raider', aimed: true });
            expect(calls.length).toBe(2);
        });

        it('a brave trader calls too', async () => {
            await raid(SHIPPING, 2);
            hit('victim', 'raider', { group: 'raider', aimed: true });
            expect(calls.length).toBe(1);
        });

        it('never from a Flags2-0x0008 govt, nor a hull inheriting it',
            async () => {
                await raid(QUIET);
                hit('victim', 'raider', { group: 'raider', aimed: true });
                expect(calls).toEqual([]);
            });

        it('never from a hull inheriting 0x0008', async () => {
            await raid(SHIPPING, 1, QUIET_HULL);
            hit('victim', 'raider', { group: 'raider', aimed: true });
            expect(calls).toEqual([]);
        });

        it('warships do not call', async () => {
            await raid(SHIPPING, 3);
            hit('victim', 'raider', { group: 'raider', aimed: true });
            expect(calls).toEqual([]);
        });

        it('a stray that provokes nothing calls nothing', async () => {
            await raid(SHIPPING);
            await addShip('bystander', 300, -150, npcShip(3, SHIPPING));
            world.step();
            hit('victim', 'bystander', { group: 'bystander', aimed: false });
            expect(calls).toEqual([]);
        });
    });

    it('replays identically from a snapshot taken before the attacks',
        async () => {
            await scene(NOSY, SHIPPING);
            await addShip('trader2', 400, -400, npcShip(1, SHIPPING));
            await addShip('raider', 600, -600, npcShip(3, RAIDER));
            world.step();
            wake('police', 'victim', 'trader2', 'raider');
            const before = snapshotWorld(world);
            const record = () => {
                calls = [];
                const hashes: string[] = [];
                hit('victim', 'player', { group: 'player', aimed: true });
                hit('trader2', 'raider', { group: 'raider', aimed: true });
                for (let i = 0; i < 60 * 3; i++) {
                    world.step();
                    hashes.push(hashWorld(world).hash);
                }
                return {
                    hashes, calls: [...calls],
                    police: npc('police').aggressor,
                    distressAt: npc('trader2').distressAt,
                };
            };
            const first = record();
            restoreWorld(world, before, deriveEntityComponents);
            const second = record();
            expect(first.police).toBe('player');
            expect(first.calls.length).toBe(1);
            expect(second).toEqual(first);
        });
});
