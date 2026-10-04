import { rabinFingerprint } from "./avro_fingerprint.js";

/**
 * The hash a peer declares on `joinRequest.systems` (#155): a stable
 * digest of its simulation world's ordered system names
 * (nova_ecs World.systemNames).
 *
 * The system ORDER is not covered by state hashes until it has already
 * forked the state, and since the ECS wave it is DERIVED (name
 * tie-break, domain composition, pin edges), so a build or plug-in
 * difference can reorder systems silently. Two worlds that must step in
 * lockstep declare the same hash exactly when they run the same systems
 * in the same order; the relay compares joiners against the room's
 * first declaration (rollback_relay.ts).
 *
 * Deterministic across engines: the input is an ARRAY (ordered by
 * construction, no object key order involved), JSON-encoded so a name
 * containing any separator cannot alias two different lists, and the
 * digest is the wire's own CRC-64-AVRO (avro_fingerprint.ts), integer
 * arithmetic over the UTF-8 bytes.
 */
export function systemOrderHash(systemNames: readonly string[]): string {
    return rabinFingerprint(JSON.stringify(systemNames));
}
