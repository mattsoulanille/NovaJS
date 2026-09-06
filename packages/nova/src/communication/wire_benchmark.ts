/**
 * Wire encoding benchmark: json (today) vs msgpack vs avro over a
 * recorded set of real messages from the determinism harness world.
 *
 *   node dist/src/communication/wire_benchmark.js [npcCount] [ticks] [reps]
 *
 * Reports, per message family and encoding: bytes per message, encode
 * and decode µs (median of `reps` passes over the recorded set), and the
 * io-ts validation cost that every encoding pays after its decode. Then
 * the per-frame delta-detection cost of what DeltaFrameEncoder does
 * today (io-ts encode + JSON.stringify + string compare) against
 * comparing msgpack or avro bytes, with the fraction of components that
 * actually changed per frame — the bound on what per-component dirty
 * flags could save.
 */
import { EncodedComponentList, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { wireSnapshotWorld } from 'nova_ecs/plugins/snapshot_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import * as t from 'io-ts';
import { makeDeterminismWorld } from './determinism_harness.js';
import { AvroSchema, AvroSchemaNode, deriveAvroSchema, formatDerivationFailures } from './io_ts_to_avro.js';
import { DeltaFrameEncoder, SimulationFrame, SimulationFrameType } from './simulation_frame.js';
import { applyInputRecords, InputRecord } from './simulation_input.js';
import { avroWireCodec, jsonWireCodec, msgpackWireCodec, WireCodec } from './wire_codec.js';
import { novaCodecHooks, rollbackProtocolDerivation, RollbackEnvelopeType, simulationFrameDerivation } from './wire_schemas.js';

const npcCount = Number(process.argv[2] ?? 12);
const ticks = Number(process.argv[3] ?? 300);
const reps = Number(process.argv[4] ?? 20);

function median(samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
}

/** Median over `reps` of the mean per-item time of `run` over `items`. */
function timePerItem<T>(items: T[], run: (item: T) => unknown): number {
    const samples: number[] = [];
    for (let r = 0; r < reps; r++) {
        const start = performance.now();
        for (const item of items) {
            run(item);
        }
        samples.push((performance.now() - start) * 1000 / items.length);
    }
    return median(samples);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

interface Family {
    name: string;
    messages: unknown[];
    type: t.Type<unknown, unknown, unknown>;
    avro: WireCodec;
}

function fmt(n: number, digits = 1): string {
    return n.toFixed(digits).padStart(9);
}

function benchFamily(family: Family) {
    const codecs: WireCodec[] = [jsonWireCodec, msgpackWireCodec, family.avro];
    const gate = family.type;
    console.log(`\n${family.name} (${family.messages.length} messages)`);
    console.log(`  ${'encoding'.padEnd(8)}${'bytes/msg'.padStart(10)}${'encode µs'.padStart(11)}`
        + `${'decode µs'.padStart(11)}${'io-ts µs'.padStart(10)}${'vs json'.padStart(9)}`);
    let jsonBytes = 0;
    for (const codec of codecs) {
        const encoded = family.messages.map(message => codec.encode(message));
        const bytes = encoded.reduce((sum, b) => sum + b.length, 0) / encoded.length;
        if (codec.encoding === 'json') {
            jsonBytes = bytes;
        }
        const encodeUs = timePerItem(family.messages, message => codec.encode(message));
        const decodeUs = timePerItem(encoded, bytes => codec.decode(bytes));
        const decoded = encoded.map(bytes => codec.decode(bytes));
        const gateUs = timePerItem(decoded, raw => {
            const result = gate.decode(raw);
            if (result._tag === 'Left') {
                throw new Error(`${family.name}: ${codec.encoding} failed the io-ts gate`);
            }
        });
        console.log(`  ${codec.encoding.padEnd(8)}${fmt(bytes, 0).padStart(10)}${fmt(encodeUs).padStart(11)}`
            + `${fmt(decodeUs).padStart(11)}${fmt(gateUs).padStart(10)}`
            + `${(bytes / jsonBytes * 100).toFixed(0).padStart(8)}%`);
    }
}

async function main() {
    console.log(`npcs=${npcCount} ticks=${ticks} reps=${reps}`);
    const world = await makeDeterminismWorld(npcCount);
    const serializer = world.resources.get(SerializerResource)!;

    // --- Record a session: control inputs from the test peer, frames
    // every tick, the rollback messages the room would see.
    const frameEncoder = new DeltaFrameEncoder();
    const frames: SimulationFrame[] = [];
    const records: InputRecord[] = [];
    let seq = 0;
    for (let tick = 1; tick <= ticks; tick++) {
        const inputs: InputRecord['inputs'] = [];
        if (tick % 30 === 1) {
            inputs.push({ kind: 'control', events: [{ action: 'accelerate', state: 'start' }, { action: 'firePrimary', state: 'start' }] });
        }
        if (tick % 30 === 15) {
            inputs.push({ kind: 'control', events: [{ action: 'accelerate', state: false }, { action: 'turnLeft', state: 'start' }] });
        }
        if (tick % 7 === 0) {
            inputs.push({ kind: 'analogControl', heading: (tick % 360) / 57.3, throttle: tick % 2 ? 0.5 : null });
        }
        if (tick % 45 === 0) {
            inputs.push({ kind: 'setTarget', target: tick % 90 === 0 ? 'determinism npc 0' : null });
        }
        if (inputs.length > 0) {
            const record: InputRecord = { peerId: 'test peer', tick, seq: seq++, inputs };
            records.push(record);
            applyInputRecords(world, [record]);
        }
        world.step();
        if (tick % 10 === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
        frames.push({
            ...frameEncoder.encode(world, serializer),
            time: world.resources.get(TimeResource),
            events: [],
            pacing: { rate: 1, behindTicks: 0 },
        });
    }
    const fullFrame = frames[0]!;
    const deltaFrames = frames.slice(ticks - 100);
    const catchUp = {
        rollback: {
            kind: 'catchUp', tick: ticks, records,
            baseline: { tick: ticks, snapshot: wireSnapshotWorld(world) },
        },
    };
    console.log(`entities=${world.entities.size} records=${records.length}`
        + ` mean changed entities/delta=${(deltaFrames.reduce((s, f) => s + f.changed.length + f.added.length, 0) / deltaFrames.length).toFixed(1)}`);

    // --- Schemas
    const rollback = rollbackProtocolDerivation(serializer);
    const frame = simulationFrameDerivation(serializer);
    console.log(`\nderivation: rollback ${rollback.failures.length} failures, frame ${frame.failures.length} failures`);
    for (const line of formatDerivationFailures([...rollback.failures, ...frame.failures])) {
        console.log(`  ${line}`);
    }
    const rollbackAvro = avroWireCodec(rollback.schema);
    const frameAvro = avroWireCodec(frame.schema);
    const envelope = RollbackEnvelopeType as t.Type<unknown, unknown, unknown>;
    const frameType = SimulationFrameType as t.Type<unknown, unknown, unknown>;

    const families: Family[] = [
        { name: 'inputs (per-tick control records)', messages: records.map(record => ({ rollback: { kind: 'inputs', record } })), type: envelope, avro: rollbackAvro },
        { name: 'tickSync', messages: [{ rollback: { kind: 'tickSync', tick: ticks } }], type: envelope, avro: rollbackAvro },
        { name: 'joinRequest', messages: [{ rollback: { kind: 'joinRequest', fresh: true, protocol: 5 } }], type: envelope, avro: rollbackAvro },
        { name: 'stateHash', messages: [{ rollback: { kind: 'stateHash', tick: ticks, hash: 'deadbeef' } }], type: envelope, avro: rollbackAvro },
        { name: `inputLog (${records.length} records)`, messages: [{ rollback: { kind: 'inputLog', records } }], type: envelope, avro: rollbackAvro },
        { name: 'catchUp (baseline snapshot + log)', messages: [catchUp], type: envelope, avro: rollbackAvro },
        { name: 'frame: full (first snapshot)', messages: [fullFrame], type: frameType, avro: frameAvro },
        { name: 'frame: delta (steady state)', messages: deltaFrames, type: frameType, avro: frameAvro },
    ];
    for (const family of families) {
        benchFamily(family);
    }

    // --- Delta detection: what DeltaFrameEncoder pays per frame today
    // (io-ts encode every component, JSON.stringify it, compare the
    // string with last frame's) against comparing bytes.
    console.log('\ndelta detection per frame (ms), over the last 100 ticks');
    const componentSchema = deriveAvroSchema(EncodedComponentList, { hooks: novaCodecHooks(), serializer }).schema;
    const pairAvro = avroWireCodec((componentSchema as AvroSchemaNode).items as AvroSchema);
    const stepsToReplay = 100;
    const encodeMs: number[] = [];
    const stringifyMs: number[] = [];
    const msgpackMs: number[] = [];
    const avroMs: number[] = [];
    let components = 0;
    let changedComponents = 0;
    let lastStrings = new Map<string, string>();
    let lastMsgpack = new Map<string, Uint8Array>();
    let lastAvro = new Map<string, Uint8Array>();
    for (let i = 0; i < stepsToReplay; i++) {
        world.step();
        const pairs: [string, [string, unknown]][] = [];
        const t0 = performance.now();
        for (const [uuid, entity] of world.entities) {
            for (const [component, data] of entity.components) {
                if (serializer.hasComponent(component)) {
                    pairs.push([`${uuid}/${component.name}`, [component.name, serializer.encodeComponent(component, data)]]);
                }
            }
        }
        const t1 = performance.now();
        const strings = new Map<string, string>();
        let changed = 0;
        for (const [key, [, encoded]] of pairs) {
            const json = JSON.stringify(encoded) ?? 'undefined';
            strings.set(key, json);
            if (lastStrings.get(key) !== json) {
                changed++;
            }
        }
        const t2 = performance.now();
        const packed = new Map<string, Uint8Array>();
        for (const [key, [, encoded]] of pairs) {
            const bytes = msgpackWireCodec.encode(encoded);
            packed.set(key, bytes);
            const last = lastMsgpack.get(key);
            if (!last || !bytesEqual(last, bytes)) {
                changed++;
            }
        }
        const t3 = performance.now();
        const avroBytes = new Map<string, Uint8Array>();
        for (const [key, pair] of pairs) {
            const bytes = pairAvro.encode(pair);
            avroBytes.set(key, bytes);
            const last = lastAvro.get(key);
            if (!last || !bytesEqual(last, bytes)) {
                changed++;
            }
        }
        const t4 = performance.now();
        if (i > 0) {
            encodeMs.push(t1 - t0);
            stringifyMs.push(t2 - t1);
            msgpackMs.push(t3 - t2);
            avroMs.push(t4 - t3);
            components += pairs.length;
            changedComponents += changed / 3;
        }
        lastStrings = strings;
        lastMsgpack = packed;
        lastAvro = avroBytes;
    }
    const changedFraction = changedComponents / components;
    const row = (name: string, samples: number[]) =>
        console.log(`  ${name.padEnd(36)} median ${median(samples).toFixed(3)} ms`);
    row('io-ts encodeComponent (all)', encodeMs);
    row('+ JSON.stringify + string compare', stringifyMs);
    row('+ msgpack encode + byte compare', msgpackMs);
    row('+ avro encode + byte compare', avroMs);
    console.log(`  components/frame ${(components / (stepsToReplay - 1)).toFixed(0)}, changed ${(changedFraction * 100).toFixed(1)}%`);
    console.log(`  dirty-flag bound: encode only changed = ${(median(encodeMs) * changedFraction).toFixed(3)} ms`
        + ` (vs ${(median(encodeMs) + median(stringifyMs)).toFixed(3)} ms encode+stringify today)`);
    process.exit(0);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
