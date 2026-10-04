import 'jasmine';
import { EncodedEntity } from 'nova_ecs/plugins/serializer_plugin';
import { EscortDeal, NO_DEAL, PlayerEscort } from '../nova_plugin/player/index.js';
import { AvroSchema, AvroSchemaNode, deriveAvroSchema } from './io_ts_to_avro.js';
import { avroWireCodec, AvroWireCodec, decodeWireOrThrow } from './wire_codec.js';
import { liveWireCodec, novaCodecHooks } from './wire_schemas.js';
import { wireSnapshotRegistrySerializer } from './wire_snapshot_components.js';

/**
 * PlayerEscort's queued deal is the marker's ENCODED state (issue #241):
 * the `deal` field is player_escort.ts's EscortDealType itself, so the
 * live wire — which types every registered component through the
 * world-independent registry (wire_snapshot_components.ts) — carries it as
 * an Avro discriminated union rather than as the retired
 * `pendingUpgrade` / `pendingSale` flag pair.
 */
describe('PlayerEscort\'s queued deal on the typed wire', () => {
    /** The first record named `name` anywhere in `schema`. */
    function findRecord(schema: AvroSchema, name: string): AvroSchemaNode | undefined {
        if (typeof schema === 'string') {
            return undefined;
        }
        if (Array.isArray(schema)) {
            for (const member of schema) {
                const found = findRecord(member, name);
                if (found) {
                    return found;
                }
            }
            return undefined;
        }
        if (schema.name === name) {
            return schema;
        }
        const children: AvroSchema[] = [
            ...(Array.isArray(schema.type) ? schema.type
                : typeof schema.type === 'object' ? [schema.type] : []),
            ...(schema.fields ?? []).map(field => field.type),
            ...(schema.items ? [schema.items] : []),
            ...(schema.values ? [schema.values] : []),
        ];
        for (const child of children) {
            const found = findRecord(child, name);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    function liveMarkerRecord(): AvroSchemaNode {
        const branch = findRecord(
            (liveWireCodec() as AvroWireCodec).schema, 'Component_PlayerEscort');
        expect(branch).toBeDefined();
        const data = branch!.fields!.find(field => field.name === 'data')!.type;
        expect(typeof data).toBe('object');
        return data as AvroSchemaNode;
    }

    it('the live schema types `deal` as a required union of none / upgrade / '
        + 'sale, and carries no flag pair', () => {
        const marker = liveMarkerRecord();
        const fields = marker.fields!.map(field => field.name);
        expect(fields).toContain('deal');
        expect(fields).not.toContain('pendingUpgrade');
        expect(fields).not.toContain('pendingSale');
        expect(marker.optional ?? []).not.toContain('deal');

        const deal = marker.fields!.find(field => field.name === 'deal')!
            .type as AvroSchemaNode;
        expect(deal.logicalType).toBe('kindUnion');
        expect(deal.discriminator).toBe('kind');
        expect(Object.keys(deal.branches!).sort())
            .toEqual(['none', 'sale', 'upgrade']);
        // Required: no null branch, so "nothing queued" has one encoding.
        expect((deal.type as AvroSchema[]).includes('null')).toBeFalse();
        // The upgrade branch carries its resolved target as a string.
        const upgrade = (deal.type as AvroSchemaNode[])
            .find(branch => branch.name === deal.branches!['upgrade'])!;
        const toShip = upgrade.fields!.find(field => field.name === 'toShip');
        expect(toShip?.type === 'string').toBeTrue();
    });

    it('the registry derivation reports nothing about PlayerEscort as '
        + 'untyped or lossy', () => {
        const derivation = deriveAvroSchema(PlayerEscort, {
            name: 'PlayerEscort', hooks: novaCodecHooks(),
        });
        expect(derivation.failures).toEqual([]);
    });

    it('each deal crosses the registry-typed wire and comes back as itself', () => {
        const codec = avroWireCodec(deriveAvroSchema(EncodedEntity, {
            name: 'Entity', hooks: novaCodecHooks(),
            serializer: wireSnapshotRegistrySerializer(),
        }).schema);
        const deals: EscortDeal[] = [
            NO_DEAL, { kind: 'upgrade', toShip: 'nova:137' }, { kind: 'sale' },
        ];
        for (const deal of deals) {
            const marker: PlayerEscort = {
                player: 'player-uuid', parent: 'player-uuid',
                provenance: 'captured', deal,
            };
            const entity: EncodedEntity = {
                components: [['PlayerEscort', PlayerEscort.encode(marker)]],
            };
            expect(decodeWireOrThrow(codec, EncodedEntity, codec.encode(entity)))
                .toEqual(entity);
        }
    });
});
