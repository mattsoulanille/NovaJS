import { AvroSchema, AvroSchemaNode } from './io_ts_to_avro.js';

/**
 * ============================================================================
 * Avro schema fingerprints
 * ============================================================================
 *
 * The identity of a wire format, as the Avro specification defines it:
 * the schema's PARSING CANONICAL FORM (attributes that do not affect
 * parsing stripped, the rest in a fixed order, no whitespace) hashed
 * with CRC-64-AVRO, the 64-bit Rabin fingerprint the specification
 * gives reference code for. Two builds whose live wire schemas
 * fingerprint alike encode every message identically; a joiner sends
 * its fingerprint on `joinRequest` and the relay refuses one it does
 * not share (rollback_relay.ts).
 *
 * The derivation's annotations (optional fields, discriminators, the
 * component table) are not part of the canonical form — the form only
 * describes the bytes — and neither are defaults or docs. A change to
 * an annotation alone is a change of BUILD, which the build-version
 * handshake (common/version_handshake.ts) already refuses.
 */

/**
 * The Parsing Canonical Form of a derived schema. Named types keep the
 * derived (namespace-less) names, which the specification's FULLNAMES
 * step leaves as they are; a second use of a name is the reference the
 * derivation already emitted.
 */
export function canonicalForm(schema: AvroSchema): string {
    if (typeof schema === 'string') {
        return JSON.stringify(schema);
    }
    if (Array.isArray(schema)) {
        return `[${schema.map(canonicalForm).join(',')}]`;
    }
    return canonicalNode(schema);
}

function canonicalNode(node: AvroSchemaNode): string {
    if (Array.isArray(node.type)) {
        // The deriver's discriminated and component unions: a plain
        // union to the specification.
        return canonicalForm(node.type);
    }
    switch (node.type) {
        case 'record':
            return `{"name":${JSON.stringify(node.name)},"type":"record","fields":[`
                + (node.fields ?? []).map(field =>
                    `{"name":${JSON.stringify(field.name)},"type":${canonicalForm(field.type)}}`)
                    .join(',')
                + ']}';
        case 'enum':
            return `{"name":${JSON.stringify(node.name)},"type":"enum","symbols":`
                + `${JSON.stringify(node.symbols ?? [])}}`;
        case 'array':
            return `{"type":"array","items":${canonicalForm(node.items!)}}`;
        case 'map':
            return `{"type":"map","values":${canonicalForm(node.values!)}}`;
        case 'fixed':
            return `{"name":${JSON.stringify(node.name)},"type":"fixed","size":`
                + `${(node as { size?: number }).size ?? 0}}`;
        default:
            // A primitive carrying attributes ({type: 'bytes', ...}).
            return canonicalForm(node.type);
    }
}

// CRC-64-AVRO: the specification's reference algorithm, in BigInt.
const EMPTY = 0xc15d213aa4d7a795n;
const MASK = 0xffffffffffffffffn;

let table: bigint[] | undefined;

function fingerprintTable(): bigint[] {
    if (table) {
        return table;
    }
    table = [];
    for (let i = 0; i < 256; i++) {
        let fp = BigInt(i);
        for (let j = 0; j < 8; j++) {
            fp = (fp >> 1n) ^ (EMPTY & -(fp & 1n));
        }
        table.push(fp & MASK);
    }
    return table;
}

const utf8 = new TextEncoder();

/** The 64-bit Rabin fingerprint of `text`'s UTF-8 bytes, as 16 hex digits. */
export function rabinFingerprint(text: string): string {
    const bytes = utf8.encode(text);
    const lookup = fingerprintTable();
    let fp = EMPTY;
    for (const byte of bytes) {
        fp = ((fp >> 8n) ^ lookup[Number((fp ^ BigInt(byte)) & 0xffn)]!) & MASK;
    }
    return fp.toString(16).padStart(16, '0');
}

/** CRC-64-AVRO of the schema's Parsing Canonical Form, as hex. */
export function schemaFingerprint(schema: AvroSchema): string {
    return rabinFingerprint(canonicalForm(schema));
}
