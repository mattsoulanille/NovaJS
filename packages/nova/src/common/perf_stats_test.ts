import 'jasmine';
import { isLeft, isRight } from 'fp-ts/lib/Either.js';
import {
    ENTITY_COUNT_KEYS, FRAME_HISTOGRAM_BUCKETS, MAX_STALLS_PER_SAMPLE,
    PerfSampleType,
} from './perf_stats.js';
import {
    makePerfSample, makeStall,
} from '../test_support/perf_sample_fixture.js';

/** Decodes a sample after `mutate` edits a deep copy of a valid one. */
function decodeEdited(mutate: (raw: Record<string, any>) => void) {
    const raw = JSON.parse(JSON.stringify(makePerfSample())) as
        Record<string, any>;
    mutate(raw);
    return PerfSampleType.decode(raw);
}

describe('PerfSampleType (the route\'s validation)', () => {
    it('accepts a full sample, through JSON as the server sees it', () => {
        const decoded = PerfSampleType.decode(
            JSON.parse(JSON.stringify(makePerfSample({
                stalls: [makeStall(), makeStall({ ms: 2500 })],
            }))));
        expect(isRight(decoded)).toBeTrue();
    });

    it('accepts a landed sample with every optional section null', () => {
        expect(isRight(decodeEdited(raw => {
            raw.sim = null;
            raw.rollback = null;
            raw.counts = null;
            raw.longTasks = null;
            raw.heap = null;
            raw.system = null;
            raw.speed = null;
            raw.playersInSpace = null;
            raw.env.renderer = null;
            raw.env.hardwareConcurrency = null;
            raw.env.deviceMemoryGB = null;
        }))).toBeTrue();
    });

    it('strips keys it does not know, at every level', () => {
        const decoded = decodeEdited(raw => {
            raw.pilotName = 'Captain';
            raw.frames.extra = 1;
            raw.env.ip = '10.0.0.1';
            raw.sim.worker.secret = 'x';
        });
        if (isLeft(decoded)) {
            fail('expected a decode');
            return;
        }
        const out = JSON.parse(JSON.stringify(decoded.right));
        expect(out.pilotName).toBeUndefined();
        expect(out.frames.extra).toBeUndefined();
        expect(out.env.ip).toBeUndefined();
        expect(out.sim.worker.secret).toBeUndefined();
        expect(out.frames.count).toBe(700);
    });

    it('rejects a wrong version', () => {
        expect(isLeft(decodeEdited(raw => { raw.v = 2; }))).toBeTrue();
    });

    it('rejects a session id that is not a short random token', () => {
        expect(isLeft(decodeEdited(raw => { raw.sid = 'short'; }))).toBeTrue();
        expect(isLeft(decodeEdited(raw => {
            raw.sid = 'has spaces in it ok';
        }))).toBeTrue();
        expect(isLeft(decodeEdited(raw => {
            raw.sid = 'a'.repeat(65);
        }))).toBeTrue();
    });

    it('rejects non-finite, negative and absurd numbers', () => {
        // JSON has no NaN / Infinity: they arrive as null.
        expect(isLeft(decodeEdited(raw => { raw.frames.meanMs = null; })))
            .toBeTrue();
        expect(isLeft(decodeEdited(raw => { raw.frames.meanMs = -1; })))
            .toBeTrue();
        expect(isLeft(decodeEdited(raw => { raw.windowMs = 1e12; })))
            .toBeTrue();
        expect(isLeft(decodeEdited(raw => { raw.frames.count = 1.5; })))
            .toBeTrue();
        expect(isLeft(decodeEdited(raw => { raw.frames.meanMs = '17'; })))
            .toBeTrue();
        expect(PerfSampleType.is({ ...makePerfSample(), windowMs: NaN }))
            .toBeFalse();
        expect(PerfSampleType.is({ ...makePerfSample(), windowMs: Infinity }))
            .toBeFalse();
    });

    it('caps strings: user agent, renderer, build, system', () => {
        expect(isLeft(decodeEdited(raw => {
            raw.env.userAgent = 'x'.repeat(401);
        }))).toBeTrue();
        expect(isLeft(decodeEdited(raw => {
            raw.env.renderer = 'x'.repeat(201);
        }))).toBeTrue();
        expect(isLeft(decodeEdited(raw => { raw.build = 'x'.repeat(121); })))
            .toBeTrue();
        expect(isLeft(decodeEdited(raw => { raw.system = 'x'.repeat(41); })))
            .toBeTrue();
    });

    it('caps the stall list and wants the histogram exactly', () => {
        expect(isLeft(decodeEdited(raw => {
            raw.stalls = new Array(MAX_STALLS_PER_SAMPLE + 1).fill(makeStall());
        }))).toBeTrue();
        expect(isRight(decodeEdited(raw => {
            raw.stalls = new Array(MAX_STALLS_PER_SAMPLE).fill(makeStall());
        }))).toBeTrue();
        expect(isLeft(decodeEdited(raw => {
            raw.frames.hist = new Array(FRAME_HISTOGRAM_BUCKETS + 1).fill(0);
        }))).toBeTrue();
        expect(isLeft(decodeEdited(raw => {
            raw.frames.hist = new Array(FRAME_HISTOGRAM_BUCKETS - 1).fill(0);
        }))).toBeTrue();
    });

    it('bounds the rollback event map: count, names, values', () => {
        const many: Record<string, number> = {};
        for (let i = 0; i < 33; i++) {
            many[`event${i}`] = 1;
        }
        expect(isLeft(decodeEdited(raw => { raw.rollback.events = many; })))
            .toBeTrue();
        expect(isLeft(decodeEdited(raw => {
            raw.rollback.events = { ['x'.repeat(41)]: 1 };
        }))).toBeTrue();
        expect(isLeft(decodeEdited(raw => {
            raw.rollback.events = { 'not ok': 1 };
        }))).toBeTrue();
        expect(isLeft(decodeEdited(raw => {
            raw.rollback.events = { __proto__x: 1 };
        }))).toBeTrue();
        expect(isLeft(decodeEdited(raw => {
            raw.rollback.events = { rollback: -1 };
        }))).toBeTrue();
        expect(isLeft(decodeEdited(raw => { raw.rollback.events = [1]; })))
            .toBeTrue();
    });

    it('has one count key per EntityCounts field, totals and on-screen', () => {
        expect(ENTITY_COUNT_KEYS).toContain('ships');
        expect(ENTITY_COUNT_KEYS).toContain('onScreenEntities');
        expect(ENTITY_COUNT_KEYS).toContain('missiles');
        expect(ENTITY_COUNT_KEYS.length).toBe(15);
    });

    it('stays well under the body limit at its largest', () => {
        const big = makePerfSample({
            stalls: new Array(MAX_STALLS_PER_SAMPLE).fill(
                makeStall({ ms: 123456.7 })),
        });
        big.env.userAgent = 'x'.repeat(400);
        big.env.renderer = 'y'.repeat(200);
        const events: Record<string, number> = {};
        for (let i = 0; i < 32; i++) {
            events[`e${i}`.padEnd(40, 'x')] = 999999;
        }
        big.rollback!.events = events;
        expect(JSON.stringify(big).length).toBeLessThan(8 * 1024);
    });
});
