import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import {
    getDefaultOutfitData, OutfitData,
} from 'novadatainterface/outfit_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import {
    Serializer, SerializerResource,
} from 'nova_ecs/plugins/serializer_plugin';
import { prepareCarriedEscorts } from '../spaceport/landed_escorts.js';
import { BayFighterComponent, ReturnWhenTargetRemovedComponent } from './bay_plugin.js';
import { CargoComponent } from './cargo_plugin.js';
import { commitFleetHolds } from '../spaceport/fleet_cargo.js';
import { completeEntity } from './entity_data_loader.js';
import { EscortCommandComponent } from './escort_command.js';
import { OwnerComponent, SourceComponent } from './fire_weapon_plugin.js';
import { ArmorComponent } from './health_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { FormationComponent } from './npc_ai_plugin.js';
import {
    escortProvenance, PlayerEscortComponent,
} from './player_escort.js';
import { Stat } from './stat.js';
import {
    ActiveRanksComponent, AggressionSuppressGovtsComponent,
    ControlBitsComponent,
} from './ncb_plugin.js';
import { OutfitsState, OutfitsStateComponent } from './outfit_plugin.js';
import { CombatRatingComponent, LegalRecordsComponent } from './reputation_plugin.js';
import { isRight } from 'fp-ts/lib/Either.js';
import {
    ActiveMissionType,
    CreditsComponent,
    CronStatesComponent,
    GameDateComponent,
    MissionsComponent,
    PendingAutoAbortShips,
    PendingAutoAbortShipsComponent,
} from './player_state_plugin.js';
import {
    collectEscortsToSave,
    decodeSave,
    encodeSave,
    extractSaveData,
    extractSavedEscorts,
    loadSave,
    resetSave,
    restoreClientSaveState,
    restorePlayerState,
    setActiveSaveKey,
    restoreSavedEscorts,
    savedFleetArmament,
    RosterEscort,
    SaveData,
    SavedEscort,
    SaveStorage,
    MIN_READABLE_SAVE_VERSION,
    SAVE_KEY,
    SAVE_QUARANTINE_KEY,
    SAVE_VERSION,
    writeSave,
} from './save_game.js';
import {
    discoveryLevel, markDiscovered, resetDiscovery,
} from './discovery_store.js';
import { ShipComponent } from './ship_plugin.js';
import {
    ControlBitNamespaces, FIRST_PRIVATE_PHYSICAL_CONTROL_BIT,
} from 'novadatainterface/control_bit_namespaces';
import { ControlBitResolver } from './control_bit_namespaces.js';
import { getDefaultRankData, RankData } from 'novadatainterface/rank_data';

/** An in-memory SaveStorage for tests. */
class FakeStorage implements SaveStorage {
    readonly items = new Map<string, string>();
    getItem(key: string): string | null {
        return this.items.has(key) ? this.items.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.items.set(key, value);
    }
    removeItem(key: string): void {
        this.items.delete(key);
    }
}

const SAMPLE: SaveData = {
    ship: 'nova:164',
    outfits: [['nova:200', 1], ['nova:201', 4]],
    system: 'nova:130',
};

describe('save_game schema', () => {
    // extractSaveData reads the MODULE-GLOBAL discovery cache
    // (discovery_store.ts), so a spec elsewhere that marked a system
    // discovered leaks `save.discovery` into these whole-object
    // comparisons — purely a function of jasmine's random seed (22715
    // put discovery_store_test first and failed two `toEqual(SAMPLE)`
    // specs with a stray `discovery: [['nova:130', 1]]`). Both fix-wave
    // branches added this guard independently; kept is the fuller form
    // that also pins the save key and storage, like the sibling
    // `save_game discovery` describe always has.
    // extractSaveData reads the process-global discovery store, so these
    // specs have to own it: without this, a system another spec file left
    // in the store (levels only ever rise, and the store outlives a spec)
    // showed up as an unexpected `discovery` field here, depending purely
    // on the order jasmine happened to shuffle the suite into. The sibling
    // `save_game discovery` describe below has always done this.
    beforeEach(() => {
        setActiveSaveKey(SAVE_KEY);
        resetDiscovery(new FakeStorage());
        // Also the DEFAULT store, the one extractSaveData actually reads
        // (storeless in node: a FakeStorage reset does not touch it).
        resetDiscovery();
    });
    afterEach(() => {
        setActiveSaveKey(SAVE_KEY);
        resetDiscovery(new FakeStorage());
        // Also the DEFAULT store, the one extractSaveData actually reads
        // (storeless in node: a FakeStorage reset does not touch it).
        resetDiscovery();
    });

    it('round-trips a save through encode and decode', () => {
        const decoded = decodeSave(encodeSave(SAMPLE));
        expect(decoded).toEqual(SAMPLE);
    });

    it('round-trips reserved optional fields when present', () => {
        const withReserved: SaveData = {
            ...SAMPLE,
            credits: 12345,
            reputations: [['nova:gov1', -50]],
        };
        const decoded = decodeSave(encodeSave(withReserved));
        expect(decoded).toEqual(withReserved);
    });

    it('extracts ship and outfits from a player entity', () => {
        const entity = new Entity('player');
        entity.components.set(ShipComponent, { id: 'nova:164' });
        const outfits: OutfitsState = new Map([
            ['nova:200', { count: 1 }],
            ['nova:201', { count: 4 }],
        ]);
        entity.components.set(OutfitsStateComponent, outfits);

        const data = extractSaveData(entity, 'nova:130');
        expect(data).toEqual(SAMPLE);
    });

    it('extracts an empty outfit list when the ship has no outfits', () => {
        const entity = new Entity('player');
        entity.components.set(ShipComponent, { id: 'nova:164' });
        const data = extractSaveData(entity, 'nova:131');
        expect(data).toEqual({ ship: 'nova:164', outfits: [], system: 'nova:131' });
    });

    it('returns undefined when the entity has no ship component', () => {
        const entity = new Entity('not a ship');
        expect(extractSaveData(entity, 'nova:130')).toBeUndefined();
    });

    it('round-trips the full player state through extract and restore', () => {
        const entity = new Entity('player');
        entity.components.set(ShipComponent, { id: 'nova:164' });
        entity.components.set(CreditsComponent, { credits: 40000 });
        entity.components.set(GameDateComponent,
            { day: 24, month: 6, year: 1177 });
        entity.components.set(ControlBitsComponent, new Set([13, 342]));
        entity.components.set(ActiveRanksComponent,
            new Set(['nova:147', 'nova:138']));
        entity.components.set(CargoComponent, new Map([
            ['mission:nova:128', 10],
            ['cargo:2', 3],
        ]));
        entity.components.set(MissionsComponent, new Map([['nova:128', {
            id: 'nova:128',
            acceptedDay: 430064,
            acceptedAt: 'nova:172',
            travelPlanet: null,
            returnPlanet: 'nova:128',
            cargoType: 2,
            cargoQty: 10,
            cargoLoaded: true,
            travelDone: false,
            deadlineDay: null,
        }]]));
        entity.components.set(CronStatesComponent, new Map([['nova:300', {
            phase: 'active' as const,
            phaseStart: 430064,
            nextEligible: 0,
        }]]));
        entity.components.set(LegalRecordsComponent, new Map([
            ['nova:128', -15],
            ['nova:129', 7],
        ]));
        entity.components.set(CombatRatingComponent, { kills: 420 });

        const saved = extractSaveData(entity, 'nova:130')!;
        // The save must survive the JSON envelope.
        const decoded = decodeSave(encodeSave(saved))!;
        expect(decoded).toEqual(saved);

        const restored = new Entity('restored');
        restored.components.set(ShipComponent, { id: 'nova:164' });
        restorePlayerState(restored, decoded);
        expect(restored.components.get(CreditsComponent))
            .toEqual({ credits: 40000 });
        expect(restored.components.get(GameDateComponent))
            .toEqual({ day: 24, month: 6, year: 1177 });
        expect(restored.components.get(ControlBitsComponent))
            .toEqual(new Set([13, 342]));
        expect(restored.components.get(ActiveRanksComponent))
            .toEqual(new Set(['nova:147', 'nova:138']));
        // Written sorted, so the same active set always writes the same
        // bytes.
        expect(saved.ranks).toEqual(['nova:138', 'nova:147']);
        expect(restored.components.get(CargoComponent))
            .toEqual(entity.components.get(CargoComponent)!);
        expect(restored.components.get(MissionsComponent))
            .toEqual(entity.components.get(MissionsComponent)!);
        expect(restored.components.get(CronStatesComponent))
            .toEqual(entity.components.get(CronStatesComponent)!);
        expect(restored.components.get(LegalRecordsComponent))
            .toEqual(entity.components.get(LegalRecordsComponent)!);
        expect(restored.components.get(CombatRatingComponent))
            .toEqual({ kills: 420 });
    });

    it('round-trips a pending auto-abort squad, and writes none when '
        + 'nothing is queued', () => {
            // PR #142 review finding 2: a save taken between accepting an
            // enforcement-squad warning (nova:614, auto-abort at accept)
            // and lifting off lost the squad — the batch lived only on the
            // entity. It is now written while non-empty and put back on
            // restore, for the first system entry to drain.
            const batch: PendingAutoAbortShips = [{
                missionId: 'nova:614',
                shipObjective: {
                    goal: 0, systemId: null, shipStart: 0, behavior: 0,
                    dudeId: 'nova:130', total: 4, satisfied: 0,
                    complete: false, failed: false, shipDonePending: false,
                    live: new Map([['ship-1', { observed: true }]]),
                },
                travelPlanet: null,
                returnPlanet: 'nova:128',
                shipName: 'Secession TF',
            }];
            const entity = new Entity('player');
            entity.components.set(ShipComponent, { id: 'nova:164' });
            entity.components.set(PendingAutoAbortShipsComponent, batch);

            const saved = extractSaveData(entity, 'nova:130')!;
            expect(saved.autoAbortShips).toEqual(batch);
            // Survives the JSON envelope (the objective's `live` is a Map).
            const decoded = decodeSave(encodeSave(saved))!;
            expect(decoded).toEqual(saved);
            const restored = new Entity('restored');
            restorePlayerState(restored, decoded);
            expect(restored.components.get(PendingAutoAbortShipsComponent))
                .toEqual(batch);
            // Restored as a copy: the save is not aliased by the entity.
            expect(restored.components.get(PendingAutoAbortShipsComponent))
                .not.toBe(decoded.autoAbortShips!);

            // MissionSession.commit leaves an EMPTIED component behind once
            // one has existed; that writes no field, so a pilot with nothing
            // queued writes exactly the payload this build wrote before.
            entity.components.set(PendingAutoAbortShipsComponent, []);
            const emptied = extractSaveData(entity, 'nova:130')!;
            expect(emptied.autoAbortShips).toBeUndefined();
            expect(emptied).toEqual({
                ship: 'nova:164', outfits: [], system: 'nova:130',
            });
            const bare = new Entity('bare');
            restorePlayerState(bare, decodeSave(encodeSave(emptied))!);
            expect(bare.components.has(PendingAutoAbortShipsComponent))
                .toBe(false);
        });

    it('decodes an active mission saved before <SN> ship names existed',
        () => {
            // ActiveMission.shipName is a t.partial addition: a pilot
            // file written by an older build has no such key, and must
            // still decode (and restore) unchanged.
            const legacyMission = {
                id: 'nova:258',
                acceptedDay: 430064,
                acceptedAt: 'nova:172',
                travelPlanet: null,
                returnPlanet: 'nova:128',
                cargoType: -1,
                cargoQty: 0,
                cargoLoaded: false,
                travelDone: false,
                deadlineDay: null,
            };
            const decoded = ActiveMissionType.decode(legacyMission);
            expect(isRight(decoded)).toBe(true);
            if (isRight(decoded)) {
                expect(decoded.right.shipName).toBeUndefined();
            }
            // And a mission accepted by the current build round-trips
            // its name.
            const named = ActiveMissionType.decode(
                { ...legacyMission, shipName: 'Doomblade' });
            expect(isRight(named)).toBe(true);
            if (isRight(named)) {
                expect(named.right.shipName).toBe('Doomblade');
            }
        });

    it('decodes a save written before ranks existed, and one with them',
        () => {
            // SaveData.ranks is a t.partial addition: a pilot file written by
            // an older build has no such key and must still decode, reading
            // as "no active ranks" — which is exactly the state a pre-rank
            // pilot was in. SAVE_VERSION deliberately does not move.
            const legacy = { ...SAMPLE, credits: 1000 };
            const decoded = decodeSave(encodeSave(legacy))!;
            expect(decoded.ranks).toBeUndefined();
            const entity = new Entity('restored');
            restorePlayerState(entity, decoded);
            expect(entity.components.get(ActiveRanksComponent))
                .toBeUndefined();

            const withRanks = decodeSave(encodeSave(
                { ...legacy, ranks: ['nova:147'] }))!;
            expect(withRanks.ranks).toEqual(['nova:147']);
            const ranked = new Entity('ranked');
            restorePlayerState(ranked, withRanks);
            expect(ranked.components.get(ActiveRanksComponent))
                .toEqual(new Set(['nova:147']));
        });

    it('re-bakes the ränk 0x0100 suppression facts the simulation reads, '
        + 'from the ranks it restored', () => {
            // Only the rank IDS are persisted. The privileges are DERIVED
            // state, so they are recomputed on load — which is what keeps a
            // save right across a change of plug-in set that redefines a
            // rank, and what puts the fact in front of the simulation, which
            // cannot resolve a ränk itself (see rank_logic.ts).
            const save = decodeSave(encodeSave({
                ...SAMPLE, ranks: ['test:guild', 'test:honour'],
            }))!;
            const guild = {
                ...getDefaultRankData(), id: 'test:guild',
                affilGovt: 'test:pirates',
                rankFlags: {
                    ...getDefaultRankData().rankFlags,
                    govtShipsWontAttack: true,
                },
            };
            // 0x0100 with no AffilGovt: a pure honour, nobody to suppress.
            const honour = {
                ...getDefaultRankData(), id: 'test:honour', affilGovt: null,
                rankFlags: {
                    ...getDefaultRankData().rankFlags,
                    govtShipsWontAttack: true,
                },
            };
            const table = new Map<string, RankData>([
                ['test:guild', guild], ['test:honour', honour],
            ]);

            const entity = new Entity('restored');
            restorePlayerState(entity, save, new ControlBitResolver(),
                id => table.get(id));
            expect(entity.components.get(ActiveRanksComponent))
                .toEqual(new Set(['test:guild', 'test:honour']));
            expect(entity.components.get(AggressionSuppressGovtsComponent))
                .toEqual(new Set(['test:pirates']));
        });

    it('leaves the baked suppression set empty when the loader has no ränk '
        + 'table', () => {
            // The bare callers (tooling, specs). Empty is the pre-rank
            // behaviour and never claims a privilege the player lacks.
            const save = decodeSave(encodeSave(
                { ...SAMPLE, ranks: ['nova:147'] }))!;
            const entity = new Entity('restored');
            restorePlayerState(entity, save);
            expect(entity.components.get(AggressionSuppressGovtsComponent))
                .toEqual(new Set());
        });

    describe('namespaced control bits', () => {
        // Stock base set {13, 342}; arpia privately uses 2050 (-> P0) and
        // singularity 1300 (-> P0 + 1).
        const P0 = FIRST_PRIVATE_PHYSICAL_CONTROL_BIT;
        const namespaces: ControlBitNamespaces = {
            baseSet: [13, 342],
            namespaces: [
                { namespace: 'arpia', bits: [[2050, P0]] },
                { namespace: 'singularity', bits: [[1300, P0 + 1]] },
            ],
            pluginOrder: ['singularity', 'arpia'],
        };
        const resolver = new ControlBitResolver(namespaces);

        function playerWithBits(bits: number[]): Entity {
            const entity = new Entity('player');
            entity.components.set(ShipComponent, { id: 'nova:164' });
            entity.components.set(ControlBitsComponent, new Set(bits));
            return entity;
        }

        it('writes pairs, the legacy numbers, and the plug-in manifest', () => {
            const saved = extractSaveData(playerWithBits([342, P0 + 1, 13, P0]),
                'nova:130', { resolver })!;
            expect(saved.controlBits).toEqual([
                ['arpia', 2050], ['nova', 13], ['nova', 342], ['singularity', 1300],
            ]);
            // The legacy field is still written (sorted) for older builds.
            expect(saved.novaControlBits).toEqual([
                ['13', 1], ['342', 1], [String(P0), 1], [String(P0 + 1), 1],
            ]);
            expect(saved.plugins).toEqual(['singularity', 'arpia']);
        });

        it('writes only the legacy numbers without a resolver', () => {
            const saved = extractSaveData(playerWithBits([342, 13]), 'nova:130')!;
            expect(saved.novaControlBits).toEqual([['13', 1], ['342', 1]]);
            expect(saved.controlBits).toBeUndefined();
            expect(saved.plugins).toBeUndefined();
        });

        it('prefers the pairs on load and parks what is not loaded', () => {
            const save: SaveData = {
                ...SAMPLE,
                // The legacy list as this build writes it: the same bits,
                // as physical numbers.
                novaControlBits: [['342', 1], [String(P0), 1]],
                controlBits: [
                    ['nova', 342], ['arpia', 2050], ['Planet Rico', 4601],
                    ['arpia', 7777],
                ],
                plugins: ['Planet Rico', 'arpia'],
            };
            const decoded = decodeSave(encodeSave(save))!;
            const entity = new Entity('restored');
            entity.components.set(ShipComponent, { id: 'nova:164' });
            const { parkedControlBits } = restorePlayerState(entity, decoded, resolver);
            expect(entity.components.get(ControlBitsComponent))
                .toEqual(new Set([342, P0]));
            expect(parkedControlBits)
                .toEqual([['Planet Rico', 4601], ['arpia', 7777]]);

            // Round trip: the parked pairs ride along into the next save,
            // and the physical set is unchanged.
            const again = extractSaveData(entity, 'nova:130',
                { resolver, parked: parkedControlBits })!;
            expect(again.controlBits).toEqual([
                ['Planet Rico', 4601], ['arpia', 2050], ['arpia', 7777], ['nova', 342],
            ]);
            const third = new Entity('third');
            const second = restorePlayerState(third, decodeSave(encodeSave(again))!, resolver);
            expect(third.components.get(ControlBitsComponent))
                .toEqual(new Set([342, P0]));
            expect(second.parkedControlBits).toEqual(parkedControlBits);
        });

        it('never loses a legacy bit the pairs lack (an older build wrote '
            + 'the legacy list in between)', () => {
                const save: SaveData = {
                    ...SAMPLE,
                    // Stale pairs: written before an older build set stock
                    // b13 and (raw, shared) b1300 and re-saved the legacy
                    // list only. Both are kept, and P0 (arpia b2050) is
                    // NOT counted as missing: the pairs cover it.
                    novaControlBits: [['342', 1], ['13', 1], ['1300', 1], [String(P0), 1]],
                    controlBits: [['nova', 342], ['arpia', 2050]],
                };
                const entity = new Entity('restored');
                entity.components.set(ShipComponent, { id: 'nova:164' });
                const warn = spyOn(console, 'warn');
                restorePlayerState(entity, decodeSave(encodeSave(save))!, resolver);
                expect(entity.components.get(ControlBitsComponent))
                    .toEqual(new Set([342, 13, P0 + 1, P0]));
                expect(warn).toHaveBeenCalledTimes(1);
                expect(warn.calls.mostRecent().args[0]).toContain('b13, b1300');
            });

        it('does NOT hand a legacy stock-range extra to a local plug-in when '
            + 'the save came from a DIFFERENT plug-in set (review r12 H-2)', () => {
                // Same shape as above, but the manifest names another set:
                // b1300 meant whatever the writer's base said, so it stays a
                // stock bit here (inert) instead of becoming arpia's private
                // bit and switching on unrelated mission state.
                const save: SaveData = {
                    ...SAMPLE,
                    novaControlBits: [['342', 1], ['1300', 1]],
                    controlBits: [['nova', 342]],
                    plugins: ['some-other-plugin'],
                };
                const entity = new Entity('restored');
                entity.components.set(ShipComponent, { id: 'nova:164' });
                spyOn(console, 'warn');
                spyOn(console, 'info');
                restorePlayerState(entity, decodeSave(encodeSave(save))!, resolver);
                const bits = entity.components.get(ControlBitsComponent)!;
                expect(bits.has(1300)).toBeTrue();
                expect(bits.has(P0 + 1)).toBeFalse();
            });

        it('keeps a physical bit the mapping cannot name, and reads it back',
            () => {
                // The bits and the mapping came from different plug-in
                // sets (or the mapping never arrived): a private-range
                // number with no pair is written under the "physical"
                // pseudo-namespace, never dropped.
                const bare = new ControlBitResolver(undefined);
                spyOn(console, 'warn');
                const saved = extractSaveData(playerWithBits([13, P0 + 7]),
                    'nova:130', { resolver: bare })!;
                expect(saved.controlBits).toEqual([['nova', 13], ['physical', P0 + 7]]);
                expect(console.warn).toHaveBeenCalledTimes(1);
                const entity = new Entity('restored');
                entity.components.set(ShipComponent, { id: 'nova:164' });
                const { parkedControlBits } = restorePlayerState(entity,
                    decodeSave(encodeSave(saved))!, resolver);
                expect(entity.components.get(ControlBitsComponent))
                    .toEqual(new Set([13, P0 + 7]));
                expect(parkedControlBits).toEqual([]);
            });

        it('migrates a legacy save\'s bare numbers', () => {
            // A pre-namespacing save: 342 is stock, 2050 was the shared bit
            // arpia meant, 1300 singularity's, 4601 (Planet Rico, not
            // loaded here) nobody's -> stays a stock-range number.
            const legacy: SaveData = {
                ...SAMPLE,
                novaControlBits: [['342', 1], ['2050', 1], ['1300', 1], ['4601', 1]],
            };
            const entity = new Entity('restored');
            const { parkedControlBits } = restorePlayerState(entity,
                decodeSave(encodeSave(legacy))!, resolver);
            expect(entity.components.get(ControlBitsComponent))
                .toEqual(new Set([342, P0, P0 + 1, 4601]));
            expect(parkedControlBits).toEqual([]);
        });

        it('reads pairs with no namespace data as stock bits plus parked', () => {
            const save: SaveData = {
                ...SAMPLE,
                controlBits: [['nova', 342], ['arpia', 2050]],
            };
            const entity = new Entity('restored');
            const { parkedControlBits } = restorePlayerState(entity,
                decodeSave(encodeSave(save))!);
            expect(entity.components.get(ControlBitsComponent))
                .toEqual(new Set([342]));
            expect(parkedControlBits).toEqual([['arpia', 2050]]);
        });
    });

    it('loads a v1 save written before player state existed', () => {
        // Exactly what an old build wrote: only ship/outfits/system.
        const legacy = JSON.stringify({
            version: SAVE_VERSION,
            data: SAMPLE,
        });
        const decoded = decodeSave(legacy);
        expect(decoded).toEqual(SAMPLE);
        // Restoring applies nothing (fields absent) and doesn't throw.
        const entity = new Entity('restored');
        restorePlayerState(entity, decoded!);
        expect(entity.components.get(CreditsComponent)).toBeUndefined();
    });
});

describe('save_game corrupt/version fallback', () => {
    it('rejects malformed JSON', () => {
        expect(decodeSave('{not json')).toBeUndefined();
    });

    it('rejects a payload with the wrong shape', () => {
        expect(decodeSave(JSON.stringify({
            version: SAVE_VERSION,
            data: { ship: 42 /* should be a string */ },
        }))).toBeUndefined();
    });

    it('rejects a save from a different schema version', () => {
        expect(decodeSave(JSON.stringify({
            version: SAVE_VERSION + 1,
            data: SAMPLE,
        }))).toBeUndefined();
    });

    it('rejects null and empty input', () => {
        expect(decodeSave(null)).toBeUndefined();
        expect(decodeSave(undefined)).toBeUndefined();
    });
});

describe('save_game storage', () => {
    it('writes and loads a save', () => {
        const storage = new FakeStorage();
        writeSave(SAMPLE, storage);
        expect(loadSave(storage)).toEqual(SAMPLE);
    });

    it('quarantines an unreadable save instead of deleting it', () => {
        const storage = new FakeStorage();
        const bad = '{"version":999,"data":{"garbage":true}}';
        storage.setItem(SAVE_KEY, bad);

        expect(loadSave(storage)).toBeUndefined();
        // The bad save is preserved under the quarantine key...
        expect(storage.getItem(SAVE_QUARANTINE_KEY)).toBe(bad);
        // ...and removed from the live key so it isn't retried forever.
        expect(storage.getItem(SAVE_KEY)).toBeNull();
    });

    it('does not quarantine a valid save', () => {
        const storage = new FakeStorage();
        writeSave(SAMPLE, storage);
        loadSave(storage);
        expect(storage.getItem(SAVE_QUARANTINE_KEY)).toBeNull();
    });

    it('reset clears the live save but leaves quarantine alone', () => {
        const storage = new FakeStorage();
        writeSave(SAMPLE, storage);
        storage.setItem(SAVE_QUARANTINE_KEY, 'old bad save');
        resetSave(storage);
        expect(storage.getItem(SAVE_KEY)).toBeNull();
        expect(storage.getItem(SAVE_QUARANTINE_KEY)).toBe('old bad save');
    });

    it('returns undefined when there is no save', () => {
        expect(loadSave(new FakeStorage())).toBeUndefined();
    });
});

/**
 * Escort persistence.
 *
 * These go through the REAL entity serializer (the one a system world
 * builds), because the whole point of storing escorts as encoded entities
 * rather than ship ids is that every registered component survives. A
 * hand-rolled fake codec would assert nothing about that.
 */
const PLAYER = 'player-uuid';
const SHIP_ID = 'test:ship';

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

async function makeEscortFixture() {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, {
        ...getDefaultShipData(),
        id: SHIP_ID,
    });
    await gameData.data.Ship.get(SHIP_ID);
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });
    const serializer = world.resources.get(SerializerResource)!;

    async function makeEscort(setup: (ship: Entity) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(SHIP_ID)!);
        ship.components.set(MovementStateComponent, movement(500, 500));
        setup(ship);
        await completeEntity(world, ship);
        return ship;
    }

    return { world, serializer, makeEscort };
}

/** The save round trip, end to end, as a helper. */
function saveAndLoad(escorts: SavedEscort[], serializer: Serializer) {
    const stored = encodeSave({ ...SAMPLE, escorts });
    const decoded = decodeSave(stored);
    expect(decoded).toBeDefined();
    return restoreSavedEscorts(decoded!.escorts, serializer);
}

describe('save_game escorts', () => {
    let fixture: Awaited<ReturnType<typeof makeEscortFixture>>;
    beforeAll(async () => {
        fixture = await makeEscortFixture();
    });

    it('round-trips an escort that was IN FLIGHT with the player', async () => {
        const { serializer, makeEscort } = fixture;
        const escort = await makeEscort(ship => {
            ship.components.set(PlayerEscortComponent,
                { player: PLAYER, parent: PLAYER });
            // Battle damage and cargo: the state a ship-id list would lose.
            ship.components.set(ArmorComponent, new Stat({
                current: 23, max: 100, min: 0, recharge: 0,
            }));
            ship.components.set(CargoComponent, new Map([['cargo:2', 5]]));
        });

        // In flight, escorts are live entities in the display world and
        // the client's rosters are empty.
        const toSave = collectEscortsToSave(PLAYER,
            [['escort-1', escort]], []);
        expect(toSave.map(({ uuid }) => uuid)).toEqual(['escort-1']);

        const restored = saveAndLoad(
            extractSavedEscorts(toSave, serializer), serializer);
        expect(restored.length).toBe(1);
        expect(restored[0].uuid).toBe('escort-1');
        expect(restored[0].entity.components.get(ArmorComponent)?.current)
            .toBe(23);
        expect(restored[0].entity.components.get(CargoComponent))
            .toEqual(new Map([['cargo:2', 5]]));
        expect(restored[0].entity.components.get(PlayerEscortComponent))
            .toEqual({ player: PLAYER, parent: PLAYER });
    });

    it('round-trips an escort held on the DOCKED landed roster', async () => {
        const { serializer, makeEscort } = fixture;
        const escort = await makeEscort(ship => {
            ship.components.set(PlayerEscortComponent,
                { player: PLAYER, parent: PLAYER, detached: true });
            ship.components.set(ArmorComponent, new Stat({
                current: 41, max: 100, min: 0, recharge: 0,
            }));
        });
        const landed: RosterEscort[] = [
            { player: PLAYER, uuid: 'landed-1', entity: escort },
        ];

        // Docked: the player and its escorts are out of the world
        // entirely, so the roster is the only source.
        const toSave = collectEscortsToSave(PLAYER, [], [landed]);
        expect(toSave.map(({ uuid }) => uuid)).toEqual(['landed-1']);

        const restored = saveAndLoad(
            extractSavedEscorts(toSave, serializer), serializer);
        expect(restored.length).toBe(1);
        expect(restored[0].entity.components.get(ArmorComponent)?.current)
            .toBe(41);
    });

    it('round-trips a CAPTURED escort\'s provenance', async () => {
        // How an escort was acquired decides whether it draws a wage and
        // whether it can be sold (player_escort.ts). It rides the durable
        // ownership marker, so it has to survive the save like the rest of
        // it — a prize taken by boarding must still be a prize after a
        // quit and reload, or its resale value quietly evaporates.
        const { serializer, makeEscort } = fixture;
        const prize = await makeEscort(ship => ship.components.set(
            PlayerEscortComponent,
            { player: PLAYER, parent: PLAYER, provenance: 'captured' }));
        const hire = await makeEscort(ship => ship.components.set(
            PlayerEscortComponent,
            { player: PLAYER, parent: PLAYER, provenance: 'hired' }));

        const toSave = collectEscortsToSave(PLAYER,
            [['prize', prize], ['hire', hire]], []);
        const restored = saveAndLoad(
            extractSavedEscorts(toSave, serializer), serializer);
        // (The roster is swept in uuid order — 'hire' before 'prize'.)
        expect(restored.map(({ uuid, entity }) => [uuid, entity.components
            .get(PlayerEscortComponent)?.provenance]))
            .toEqual([['hire', 'hired'], ['prize', 'captured']]);
    });

    it('round-trips the QUEUED DEALS — an upgrade\'s target class and a '
        + 'pending sale', async () => {
        // Upgrading and selling an escort are deferred to the next
        // shipyard (nova_plugin/escort_action.ts), so a player can queue a
        // deal, quit, and come back days later expecting it to be waiting.
        // Both flags ride the durable ownership marker for exactly that
        // reason; this is the spec that keeps them in the save.
        const { serializer, makeEscort } = fixture;
        const upgrading = await makeEscort(ship => ship.components.set(
            PlayerEscortComponent, {
                player: PLAYER, parent: PLAYER, provenance: 'hired',
                pendingUpgrade: 'nova:137',
            }));
        const selling = await makeEscort(ship => ship.components.set(
            PlayerEscortComponent, {
                player: PLAYER, parent: PLAYER, provenance: 'captured',
                pendingSale: true,
            }));

        const toSave = collectEscortsToSave(PLAYER,
            [['upgrading', upgrading], ['selling', selling]], []);
        const restored = saveAndLoad(
            extractSavedEscorts(toSave, serializer), serializer);
        const markers = new Map(restored.map(({ uuid, entity }) =>
            [uuid, entity.components.get(PlayerEscortComponent)]));
        expect(markers.get('upgrading')?.pendingUpgrade).toBe('nova:137');
        expect(markers.get('upgrading')?.pendingSale).toBeUndefined();
        expect(markers.get('selling')?.pendingSale).toBeTrue();
        expect(markers.get('selling')?.pendingUpgrade).toBeUndefined();
    });

    it('restores an escort saved BEFORE provenance existed, and reads it '
        + 'as hired', async () => {
            // The field is additive on a component that older saves
            // already carry, so an escort without one has to decode. It
            // reads as 'hired' — the reading that cannot be turned into
            // cash — so no pre-existing save can be mined for credits.
            const { serializer, makeEscort } = fixture;
            const legacy = await makeEscort(ship => ship.components.set(
                PlayerEscortComponent, { player: PLAYER, parent: PLAYER }));
            const restored = saveAndLoad(extractSavedEscorts(
                collectEscortsToSave(PLAYER, [['old', legacy]], []),
                serializer), serializer);
            const marker = restored[0].entity.components
                .get(PlayerEscortComponent);
            expect(marker).toEqual({ player: PLAYER, parent: PLAYER });
            expect(escortProvenance(restored[0].entity)).toBe('hired');
        });

    it('includes a batch waiting on a carried jump', async () => {
        const { serializer, makeEscort } = fixture;
        const inWorld = await makeEscort(ship => ship.components.set(
            PlayerEscortComponent, { player: PLAYER, parent: PLAYER }));
        const jumping = await makeEscort(ship => ship.components.set(
            PlayerEscortComponent, { player: PLAYER, parent: PLAYER }));
        const carriedJump: RosterEscort[] = [
            { player: PLAYER, uuid: 'jumping-1', entity: jumping },
        ];

        const toSave = collectEscortsToSave(PLAYER, [['in-world-1', inWorld]],
            [[], carriedJump]);
        expect(toSave.map(({ uuid }) => uuid))
            .toEqual(['in-world-1', 'jumping-1']);

        const restored = saveAndLoad(
            extractSavedEscorts(toSave, serializer), serializer);
        expect(restored.map(({ uuid }) => uuid))
            .toEqual(['in-world-1', 'jumping-1']);
    });

    it('writes an escort caught in the landing overlap exactly once',
        async () => {
            const { serializer, makeEscort } = fixture;
            // Mid-landing an escort is on the roster while still present
            // in the world it is flying down through.
            const escort = await makeEscort(ship => ship.components.set(
                PlayerEscortComponent, { player: PLAYER, parent: PLAYER }));
            const roster: RosterEscort[] = [
                { player: PLAYER, uuid: 'both', entity: escort },
            ];
            const toSave = collectEscortsToSave(PLAYER, [['both', escort]],
                [roster]);
            expect(toSave.map(({ uuid }) => uuid)).toEqual(['both']);
            expect(extractSavedEscorts(toSave, serializer).length).toBe(1);
        });

    it('carries FLEET CARGO bought at the exchange inside the escort\'s own '
        + 'record, and loses it with the escort', async () => {
            const { serializer, makeEscort } = fixture;
            const hauler = await makeEscort(ship => ship.components.set(
                PlayerEscortComponent,
                { player: PLAYER, parent: PLAYER, detached: true }));
            const escortB = await makeEscort(ship => ship.components.set(
                PlayerEscortComponent,
                { player: PLAYER, parent: PLAYER, detached: true }));

            // What Done in the trade center does to the landed roster: the
            // working holds are written onto the escorts themselves. No new
            // persisted shape is involved — CargoComponent already rides
            // inside the SavedEscort entity blob.
            commitFleetHolds([
                {
                    uuid: 'hauler', capacity: 400, entity: hauler,
                    cargo: new Map([['cargo:0', 375], ['junk:test:1', 5]]),
                },
                {
                    uuid: 'doomed', capacity: 100, entity: escortB,
                    cargo: new Map([['cargo:0', 90]]),
                },
            ]);

            const roster: RosterEscort[] = [
                { player: PLAYER, uuid: 'hauler', entity: hauler },
                { player: PLAYER, uuid: 'doomed', entity: escortB },
            ];
            const restored = saveAndLoad(extractSavedEscorts(
                collectEscortsToSave(PLAYER, [], [roster]), serializer),
                serializer);
            expect(restored.map(({ uuid }) => uuid))
                .toEqual(['doomed', 'hauler']);
            expect(restored.find(({ uuid }) => uuid === 'hauler')!
                .entity.components.get(CargoComponent))
                .toEqual(new Map([['cargo:0', 375], ['junk:test:1', 5]]));

            // Now the second escort is destroyed before the save: it is on
            // no roster and in no world, so nothing writes its record and
            // its 90 tons are simply gone. (Decision where the Bible is
            // silent — see spaceport/fleet_cargo.ts.)
            const afterLoss = saveAndLoad(extractSavedEscorts(
                collectEscortsToSave(PLAYER, [], [[roster[0]]]), serializer),
                serializer);
            expect(afterLoss.map(({ uuid }) => uuid)).toEqual(['hauler']);
            const fleetTons = afterLoss.reduce((tons, { entity }) =>
                tons + (entity.components.get(CargoComponent)?.get('cargo:0')
                    ?? 0), 0);
            expect(fleetTons).toBe(375);
        });

    it('ignores escorts belonging to another player', async () => {
        const { makeEscort } = fixture;
        const mine = await makeEscort(ship => ship.components.set(
            PlayerEscortComponent, { player: PLAYER, parent: PLAYER }));
        const theirs = await makeEscort(ship => ship.components.set(
            PlayerEscortComponent, { player: 'someone-else', parent: 'x' }));
        const roster: RosterEscort[] = [
            { player: 'someone-else', uuid: 'peer-roster', entity: theirs },
        ];
        const toSave = collectEscortsToSave(PLAYER,
            [['mine', mine], ['theirs', theirs]], [roster]);
        expect(toSave.map(({ uuid }) => uuid)).toEqual(['mine']);
    });

    it('keeps a deployed bay fighter\'s identity, and re-links it to its '
        + 'carrier under fresh uuids', async () => {
            const { serializer, makeEscort } = fixture;
            const carrier = await makeEscort(ship => ship.components.set(
                PlayerEscortComponent, { player: PLAYER, parent: PLAYER }));
            const fighter = await makeEscort(ship => {
                // A launched fighter's whole bay identity.
                ship.components.set(BayFighterComponent,
                    { bayWeaponId: 'test:bay' });
                ship.components.set(ReturnWhenTargetRemovedComponent,
                    undefined);
                ship.components.set(OwnerComponent, { owner: 'carrier-uuid' });
                ship.components.set(SourceComponent, 'carrier-uuid');
                ship.components.set(PlayerEscortComponent,
                    { player: PLAYER, parent: 'carrier-uuid' });
            });

            const toSave = collectEscortsToSave(PLAYER, [
                ['carrier-uuid', carrier], ['fighter-uuid', fighter],
            ], []);
            const restored = saveAndLoad(
                extractSavedEscorts(toSave, serializer), serializer);
            expect(restored.length).toBe(2);
            const restoredFighter = restored
                .find(({ uuid }) => uuid === 'fighter-uuid')!;
            expect(restoredFighter.entity.components
                .get(BayFighterComponent)).toEqual({ bayWeaponId: 'test:bay' });
            expect(restoredFighter.entity.components
                .has(ReturnWhenTargetRemovedComponent)).toBeTrue();

            // The restore path is the ordinary carried-batch one, so the
            // fighter must come back attached to its carrier's NEW uuid
            // rather than to the dead pre-save one.
            const leader = new Entity();
            leader.components.set(MovementStateComponent, movement(0, 0));
            let next = 0;
            const prepared = prepareCarriedEscorts(
                restored.map(escort => ({ ...escort, player: PLAYER })),
                PLAYER, leader, 0, () => `fresh-${next++}`);
            expect(prepared.length).toBe(2);
            const newCarrierUuid = prepared
                .find(({ entity }) => entity === restored
                    .find(e => e.uuid === 'carrier-uuid')!.entity)!.uuid;
            const preparedFighter = prepared
                .find(({ entity }) => entity === restoredFighter.entity)!
                .entity;
            expect(newCarrierUuid).not.toBe('carrier-uuid');
            expect(preparedFighter.components.get(SourceComponent))
                .toBe(newCarrierUuid);
            expect(preparedFighter.components.get(OwnerComponent))
                .toEqual({ owner: newCarrierUuid });
            expect(preparedFighter.components.get(FormationComponent)?.leader)
                .toBe(newCarrierUuid);
            // Commands are reset to formation by the same machinery.
            expect(preparedFighter.components.get(EscortCommandComponent))
                .toEqual({ command: 'formation' });
        });

    it('drops only the escort whose entity no longer decodes', async () => {
        const { serializer, makeEscort } = fixture;
        const good = await makeEscort(ship => ship.components.set(
            PlayerEscortComponent, { player: PLAYER, parent: PLAYER }));
        const encoded = extractSavedEscorts(
            collectEscortsToSave(PLAYER, [['good', good]], []), serializer);
        // Structurally a valid blob (EncodedEntity says nothing about a
        // component's payload), but PlayerEscort.player is not a number.
        // This is the entity-codec drift the module comment warns about.
        const rotten: SavedEscort = {
            uuid: 'rotten',
            entity: { components: [['PlayerEscort', { player: 42 }]] },
        };

        const restored = saveAndLoad([...encoded, rotten], serializer);
        expect(restored.map(({ uuid }) => uuid)).toEqual(['good']);
    });

    it('reads a save with no escorts field as zero escorts', () => {
        const { serializer } = fixture;
        const decoded = decodeSave(encodeSave(SAMPLE))!;
        expect(decoded.escorts).toBeUndefined();
        expect(restoreSavedEscorts(decoded.escorts, serializer)).toEqual([]);
    });
});

/**
 * ============================================================================
 * Cleaning a save polluted by the mission-carrier escort bug
 * ============================================================================
 *
 * Before playerEscortLink stopped its walk at a mission ship, a mïsn
 * ShipBehav 1 carrier's bay fighters were marked as the PLAYER's, swept
 * through every jump, and flattened onto the player at the far end — and
 * they went into the save. Fixing the simulation does nothing for a pilot
 * who already has thirty of them, so the load path drops them, on the
 * three-part criterion documented on SavedFleetOwner.
 *
 * The specs below are the two sides of that criterion: the phantom goes,
 * and every shape of LEGITIMATE deployed fighter stays. A player's own
 * launched fighters really are in the save under parent = the player
 * (landing does not stow a deployed fighter), so "drop bay fighters
 * parented to the player" on its own would take the pilot's real wing.
 */
const OWN_BAY = 'test:ownBay';
const FOREIGN_BAY = 'test:foreignBay';

describe('save_game phantom bay fighters', () => {
    let fixture: Awaited<ReturnType<typeof makeEscortFixture>>;
    beforeAll(async () => {
        fixture = await makeEscortFixture();
    });

    /** A deployed bay fighter, as the save holds one. */
    async function fighter(parent: string, carrier: string, bay: string) {
        return fixture.makeEscort(ship => {
            ship.components.set(PlayerEscortComponent,
                { player: PLAYER, parent });
            ship.components.set(BayFighterComponent, { bayWeaponId: bay });
            ship.components.set(ReturnWhenTargetRemovedComponent, undefined);
            ship.components.set(SourceComponent, carrier);
            ship.components.set(OwnerComponent, { owner: carrier });
        });
    }

    function roundTrip(escorts: Array<[string, Entity]>,
        owner?: { player: string, armament?: ReadonlySet<string> }) {
        const { serializer } = fixture;
        const saved = extractSavedEscorts(
            escorts.map(([uuid, entity]) => ({ uuid, entity })), serializer);
        const stored = encodeSave({ ...SAMPLE, escorts: saved });
        return restoreSavedEscorts(decodeSave(stored)!.escorts, serializer,
            owner)
            .map(({ uuid }) => uuid);
    }

    it('drops a mission carrier\'s fighter that was flattened onto the '
        + 'player', async () => {
            // Exactly the shape insertCarriedEscorts produced: parented to
            // the player, but launched from a carrier that is in no save
            // (mission ships are never marked and never saved), out of a
            // bay this pilot does not own.
            const phantom = await fighter(PLAYER, 'dead mission carrier',
                FOREIGN_BAY);
            expect(roundTrip([['phantom', phantom]],
                { player: PLAYER, armament: new Set([OWN_BAY]) }))
                .toEqual([]);
        });

    it('keeps the player\'s OWN deployed fighter', async () => {
        // A fighter out of the player's own bay: parented to the player
        // too, and legitimately in the save (landing does not stow a
        // deployed fighter — see landed_escorts.ts). Both halves of the
        // third test refuse it: its carrier IS the player, and the player
        // owns the bay.
        const mine = await fighter(PLAYER, PLAYER, OWN_BAY);
        expect(roundTrip([['mine', mine]],
            { player: PLAYER, armament: new Set([OWN_BAY]) }))
            .toEqual(['mine']);
    });

    it('keeps a CARRIER ESCORT\'s fighter, carrier and all', async () => {
        const carrier = await fixture.makeEscort(ship => ship.components.set(
            PlayerEscortComponent, { player: PLAYER, parent: PLAYER }));
        // Parented to its carrier, and its carrier is saved beside it.
        const wing = await fighter('carrier', 'carrier', FOREIGN_BAY);
        expect(roundTrip([['carrier', carrier], ['wing', wing]],
            { player: PLAYER, armament: new Set([OWN_BAY]) }).sort())
            .toEqual(['carrier', 'wing']);
    });

    it('keeps a fighter whose bay the pilot actually owns, whatever it '
        + 'was launched from', async () => {
            // The bay-outfit half of the criterion on its own: a fighter
            // out of a bay this pilot mounts is a fighter this pilot could
            // have launched, so it is not evidence of anything.
            const doubtful = await fighter(PLAYER, 'some other ship',
                OWN_BAY);
            expect(roundTrip([['doubtful', doubtful]],
                { player: PLAYER, armament: new Set([OWN_BAY]) }))
                .toEqual(['doubtful']);
        });

    it('keeps ordinary escorts, which are not fighters at all', async () => {
        const hire = await fixture.makeEscort(ship => ship.components.set(
            PlayerEscortComponent,
            { player: PLAYER, parent: PLAYER, provenance: 'hired' }));
        expect(roundTrip([['hire', hire]],
            { player: PLAYER, armament: new Set() }))
            .toEqual(['hire']);
    });

    it('drops nothing when the pilot\'s armament could not be resolved',
        async () => {
            // A save written with a plug-in that is not loaded today: we
            // cannot see the pilot's hangar, so we keep everything.
            const phantom = await fighter(PLAYER, 'dead mission carrier',
                FOREIGN_BAY);
            expect(roundTrip([['phantom', phantom]], { player: PLAYER }))
                .toEqual(['phantom']);
        });

    it('drops nothing when the save records no player uuid', async () => {
        // Every reference inside a saved escort is in the PRE-SAVE uuid
        // namespace; without the pilot's own uuid none of them can be
        // read, so the array is restored verbatim (which is also what a
        // save written before `playerUuid` existed gets).
        const phantom = await fighter(PLAYER, 'dead mission carrier',
            FOREIGN_BAY);
        expect(roundTrip([['phantom', phantom]])).toEqual(['phantom']);
    });
});

describe('savedFleetArmament', () => {
    const outfitData = (id: string, extra: Partial<OutfitData>) =>
        ({ ...getDefaultOutfitData(), id, ...extra } as OutfitData);

    it('collects both halves of a fighter bay — the launcher and its '
        + 'ammo', async () => {
            // A stock bay is a PAIR of outfits: "Firebird Bay" mounts wëap
            // nova:151, "Firebird" is ammo for it (verified against the
            // real data). Either one on its own proves the pilot owns the
            // bay, so both are collected.
            const outfits: Record<string, OutfitData> = {
                'bay': outfitData('bay', { weapons: { 'weap:1': 1 } }),
                'ammo': outfitData('ammo', { ammoFor: 'weap:1' }),
                'plate': outfitData('plate', {}),
            };
            const armament = await savedFleetArmament(
                [['bay', 1], ['ammo', 0], ['plate', 3]],
                async id => outfits[id]);
            expect(armament).toEqual(new Set(['weap:1']));
        });

    it('gives up entirely when an outfit cannot be resolved', async () => {
        // An incomplete picture of the hangar must not be used to drop
        // anything: undefined disables the cleanup.
        const armament = await savedFleetArmament([['gone', 1]],
            async () => { throw new Error('no such outfit'); });
        expect(armament).toBeUndefined();
    });
});

describe('save_game escort version skew', () => {
    it('loads a v1 save (written before escorts existed) with no escorts',
        () => {
            // Byte for byte what the previous build wrote.
            const v1 = JSON.stringify({
                version: MIN_READABLE_SAVE_VERSION,
                data: SAMPLE,
            });
            expect(MIN_READABLE_SAVE_VERSION).toBeLessThan(SAVE_VERSION);
            const decoded = decodeSave(v1);
            expect(decoded).toEqual(SAMPLE);
            expect(decoded!.escorts).toBeUndefined();
        });

    it('does not quarantine a v1 save', () => {
        const storage = new FakeStorage();
        storage.setItem(SAVE_KEY, JSON.stringify({
            version: MIN_READABLE_SAVE_VERSION,
            data: SAMPLE,
        }));
        expect(loadSave(storage)).toEqual(SAMPLE);
        expect(storage.getItem(SAVE_QUARANTINE_KEY)).toBeNull();
    });

    it('quarantines a save whose escorts are structurally corrupt', () => {
        const storage = new FakeStorage();
        // `escorts` is present but is not an array of {uuid, entity}: the
        // envelope no longer decodes at all, so the WHOLE save is parked
        // rather than dropped, and the game starts from defaults.
        const bad = JSON.stringify({
            version: SAVE_VERSION,
            data: { ...SAMPLE, escorts: [{ uuid: 5, entity: 'nonsense' }] },
        });
        storage.setItem(SAVE_KEY, bad);

        expect(decodeSave(bad)).toBeUndefined();
        expect(loadSave(storage)).toBeUndefined();
        expect(storage.getItem(SAVE_QUARANTINE_KEY)).toBe(bad);
        expect(storage.getItem(SAVE_KEY)).toBeNull();
    });

    it('still quarantines a save from a FUTURE version', () => {
        const storage = new FakeStorage();
        const future = JSON.stringify({
            version: SAVE_VERSION + 1,
            data: SAMPLE,
        });
        storage.setItem(SAVE_KEY, future);
        expect(loadSave(storage)).toBeUndefined();
        expect(storage.getItem(SAVE_QUARANTINE_KEY)).toBe(future);
    });

    it('round-trips escorts through the storage layer', () => {
        const storage = new FakeStorage();
        const escorts: SavedEscort[] = [{
            uuid: 'e1',
            entity: { components: [['Armor', { current: 3 }]], name: 'esc' },
        }];
        writeSave({ ...SAMPLE, escorts }, storage);
        expect(loadSave(storage)?.escorts).toEqual(escorts);
    });
});

/**
 * ============================================================================
 * Star-system discovery in the save
 * ============================================================================
 *
 * Discovery is client-local state with no component behind it (see
 * discovery_store.ts): the save carries it so a pilot is complete in one
 * payload, and the store is what actually answers at runtime.
 */
describe('save_game discovery', () => {
    let storage: FakeStorage;

    beforeEach(() => {
        storage = new FakeStorage();
        setActiveSaveKey(SAVE_KEY);
        resetDiscovery(storage);
    });

    afterEach(() => {
        setActiveSaveKey(SAVE_KEY);
        resetDiscovery(storage);
    });

    it('round-trips the discovery field', () => {
        const withDiscovery: SaveData = {
            ...SAMPLE,
            discovery: [['nova:130', 1], ['nova:131', 2]],
        };
        expect(decodeSave(encodeSave(withDiscovery))).toEqual(withDiscovery);
    });

    it('reads a save written before discovery existed', () => {
        // Purely additive: the field's absence is a pilot who knows
        // nothing, which is exactly what a pre-discovery save meant.
        const decoded = decodeSave(JSON.stringify({
            version: MIN_READABLE_SAVE_VERSION, data: SAMPLE,
        }));
        expect(decoded).toBeDefined();
        expect(decoded!.discovery).toBeUndefined();
    });

    it('restores a save\'s discovery into the live store', () => {
        restoreClientSaveState(
            { ...SAMPLE, discovery: [['nova:130', 2]] }, storage);
        expect(discoveryLevel('nova:130', storage)).toBe(2);
    });

    it('never lowers what the store already knows', () => {
        markDiscovered('nova:130', 2, storage);
        // Rolling back to an older checkpoint must not un-learn a system.
        restoreClientSaveState(
            { ...SAMPLE, discovery: [['nova:130', 1]] }, storage);
        expect(discoveryLevel('nova:130', storage)).toBe(2);
    });

    it('gives each pilot their own record when the save key moves', () => {
        markDiscovered('nova:130', 1, storage);
        setActiveSaveKey('novajs:save:pilot2');
        expect(discoveryLevel('nova:130', storage)).toBe(0);
    });

    it('clears the record with the save', () => {
        markDiscovered('nova:130', 2, storage);
        resetSave(storage);
        expect(discoveryLevel('nova:130', storage)).toBe(0);
    });
});
