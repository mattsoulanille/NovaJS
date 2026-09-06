import 'jasmine';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { OwnerComponent } from '../nova_plugin/combat/fire_weapon_plugin.js';
import { FormationComponent } from '../nova_plugin/npc/npc_ai_plugin.js';
import { PlayerEscortComponent } from '../nova_plugin/player/player_escort.js';
import { ControlledByComponent } from '../nova_plugin/player/ship_control.js';
import { CarriedEscort } from '../spaceport/landed_escorts.js';
import {
    buildHiredEscort, FleetBridge, insertEscortBatch, insertPlayerAndFleet,
} from './fleet_insertion.js';

const PLAYER = 'player-uuid';
const PEER = 'peer-uuid';

function movement(x: number, y: number) {
    return {
        accelerating: 0,
        position: new Position(x, y),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    };
}

function ship(name: string): Entity {
    const entity = new Entity(name);
    entity.components.set(MovementStateComponent, movement(100, 100));
    return entity;
}

function escort(uuid: string, parent?: string): CarriedEscort {
    const entity = ship(uuid);
    if (parent) {
        entity.components.set(PlayerEscortComponent,
            { player: PLAYER, parent });
        entity.components.set(OwnerComponent, { owner: parent });
    }
    return { player: PLAYER, uuid, entity };
}

/**
 * A bridge stub that records insertions and rejects the uuids (or the
 * nth call) it is told to.
 */
function stubBridge(options: { rejectUuids?: string[], rejectCalls?: number[] }
    = {}) {
    const inserted: Array<{ uuid: string, entity: Entity }> = [];
    let calls = 0;
    const bridge: FleetBridge = {
        async addEntity(uuid, entity) {
            calls++;
            if (options.rejectUuids?.includes(uuid)
                || options.rejectCalls?.includes(calls)) {
                throw new Error(`rejected ${uuid}`);
            }
            inserted.push({ uuid, entity });
        },
    };
    return { bridge, inserted };
}

function minter() {
    let n = 0;
    return () => `minted:${n++}`;
}

/**
 * Issue #73 (the one insertion sequence) and #31 (its failure policy:
 * never drop a single escort).
 */
describe('fleet insertion', () => {
    describe('the sequence', () => {
        it('inserts the player first, then the escorts, hires and mission '
            + 'ships, through the same bridge', async () => {
                const { bridge, inserted } = stubBridge();
                const player = ship('player');
                const mission = ship('mission');
                const result = await insertPlayerAndFleet({
                    bridge, playerUuid: PLAYER, player,
                    escorts: [escort('e1'), escort('e2')],
                    hires: ['test:ship'],
                    missionShips: [mission],
                    ownerUuid: PEER, baseSlot: 3, mintUuid: minter(),
                    getShip: async () => getDefaultShipData(),
                });
                expect(inserted.map(i => i.uuid)).toEqual([
                    PLAYER, 'minted:0', 'minted:1', 'minted:2', 'minted:3']);
                expect(inserted[4].entity).toBe(mission);
                expect(result.failed).toEqual([]);
                // Escorts took slots 3 and 4, the hire slot 5.
                expect(inserted[1].entity.components.get(FormationComponent))
                    .toEqual({ leader: PLAYER, slot: 3 });
                expect(inserted[3].entity.components.get(FormationComponent))
                    .toEqual({ leader: PLAYER, slot: 5 });
                expect(result.nextSlot).toBe(6);
            });

        it('stamps the multiplayer identity on the player on EVERY path — '
            + 'the gate lift-off used to skip it', async () => {
                const { bridge } = stubBridge();
                const player = ship('player');
                await insertPlayerAndFleet({
                    bridge, playerUuid: PLAYER, player, escorts: [],
                    ownerUuid: PEER, baseSlot: 0, mintUuid: minter(),
                    getShip: async () => getDefaultShipData(),
                });
                expect(player.components.get(ControlledByComponent))
                    .toEqual({ peerId: PEER });
                expect(player.components.get(MultiplayerData))
                    .toEqual({ owner: PEER });
            });

        it('marks every follower as owned by this peer, so removePeer '
            + 'cleans them up', async () => {
                const { bridge, inserted } = stubBridge();
                await insertPlayerAndFleet({
                    bridge, playerUuid: PLAYER, player: ship('player'),
                    escorts: [escort('e1')], hires: ['test:ship'],
                    missionShips: [ship('mission')],
                    ownerUuid: PEER, baseSlot: 0, mintUuid: minter(),
                    getShip: async () => getDefaultShipData(),
                });
                for (const { entity } of inserted) {
                    expect(entity.components.get(MultiplayerData))
                        .toEqual({ owner: PEER });
                }
            });
    });

    describe('the failure policy (issue #31)', () => {
        it('rethrows when the PLAYER cannot be inserted, having inserted '
            + 'nothing, so the caller keeps its whole roster', async () => {
                const { bridge, inserted } = stubBridge(
                    { rejectUuids: [PLAYER] });
                await expectAsync(insertPlayerAndFleet({
                    bridge, playerUuid: PLAYER, player: ship('player'),
                    escorts: [escort('e1')], hires: ['test:ship'],
                    ownerUuid: PEER, baseSlot: 0, mintUuid: minter(),
                    getShip: async () => getDefaultShipData(),
                })).toBeRejectedWithError(/rejected player-uuid/);
                expect(inserted).toEqual([]);
            });

        it('returns an escort whose insertion rejected, under the uuid it '
            + 'was placed under, instead of dropping it', async () => {
                const { bridge, inserted } = stubBridge(
                    { rejectUuids: ['minted:1'] });
                spyOn(console, 'warn');
                const rows = [escort('e1'), escort('e2'), escort('e3')];
                const result = await insertPlayerAndFleet({
                    bridge, playerUuid: PLAYER, player: ship('player'),
                    escorts: rows, ownerUuid: PEER, baseSlot: 0,
                    mintUuid: minter(),
                    getShip: async () => getDefaultShipData(),
                });
                expect(inserted.map(i => i.uuid))
                    .toEqual([PLAYER, 'minted:0', 'minted:2']);
                expect(result.failed.length).toBe(1);
                expect(result.failed[0].uuid).toBe('minted:1');
                expect(result.failed[0].entity).toBe(rows[1].entity);
                expect(result.failed[0].player).toBe(PLAYER);
            });

        it('a carrier and its wing that BOTH fail come back as a pair the '
            + 'retry can keep together', async () => {
                const { bridge } = stubBridge(
                    { rejectUuids: ['minted:0', 'minted:1'] });
                spyOn(console, 'warn');
                const carrier = escort('carrier');
                const fighter = escort('fighter', 'carrier');
                const first = await insertEscortBatch(bridge, PLAYER,
                    ship('player'), [carrier, fighter], 0, minter(), PEER);
                expect(first.failed.map(f => f.uuid))
                    .toEqual(['minted:0', 'minted:1']);
                // The fighter's references were rewritten to the carrier's
                // minted uuid, which is exactly the uuid the carrier's row
                // now carries: a retry remaps from it.
                expect(fighter.entity.components.get(OwnerComponent))
                    .toEqual({ owner: 'minted:0' });
                const retry = stubBridge();
                let n = 10;
                const second = await insertEscortBatch(retry.bridge, PLAYER,
                    ship('player'), first.failed, 0, () => `again:${n++}`,
                    PEER);
                expect(second.failed).toEqual([]);
                expect(fighter.entity.components.get(OwnerComponent))
                    .toEqual({ owner: 'again:10' });
                expect(fighter.entity.components.get(FormationComponent))
                    .toEqual({ leader: 'again:10', slot: 0 });
            });

        it('a hire that cannot be spawned is logged and skipped without '
            + 'stopping the rest', async () => {
                const { bridge, inserted } = stubBridge();
                const warn = spyOn(console, 'warn');
                const result = await insertPlayerAndFleet({
                    bridge, playerUuid: PLAYER, player: ship('player'),
                    escorts: [], hires: ['missing', 'test:ship'],
                    ownerUuid: PEER, baseSlot: 0, mintUuid: minter(),
                    getShip: async id => {
                        if (id === 'missing') {
                            throw new Error('no such ship');
                        }
                        return getDefaultShipData();
                    },
                });
                expect(warn).toHaveBeenCalled();
                expect(inserted.length).toBe(2); // player + one hire
                expect(result.nextSlot).toBe(1);
            });
    });

    describe('a hired escort', () => {
        it('is an NPC hull in formation on the leader with the hired '
            + 'provenance', () => {
                const leader = ship('player');
                const hired = buildHiredEscort(getDefaultShipData(), PLAYER,
                    leader, 4, PEER)!;
                expect(hired.components.get(FormationComponent))
                    .toEqual({ leader: PLAYER, slot: 4 });
                expect(hired.components.get(PlayerEscortComponent))
                    .toEqual({ player: PLAYER, parent: PLAYER,
                        provenance: 'hired' });
                expect(hired.components.get(MultiplayerData))
                    .toEqual({ owner: PEER });
            });

        it('cannot be placed on a leader with no movement state', () => {
            expect(buildHiredEscort(getDefaultShipData(), PLAYER,
                new Entity('player'), 0)).toBeUndefined();
        });
    });
});
