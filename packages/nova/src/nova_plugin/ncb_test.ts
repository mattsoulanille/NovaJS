import 'jasmine';
import {
    evaluateNCBTest,
    makeControlBitHooks,
    NCBParseError,
    NCBSetHooks,
    NCBSetOperation,
    parseNCBSet,
    parseNCBTest,
    runNCBSet,
} from './ncb.js';

function bitContext(...bits: number[]) {
    const set = new Set(bits);
    return { getBit: (bit: number) => set.has(bit) };
}

describe('parseNCBTest', () => {
    it('parses a blank expression as true', () => {
        expect(parseNCBTest('')).toEqual({ type: 'true' });
        expect(parseNCBTest('   ')).toEqual({ type: 'true' });
    });

    it('parses a single bit lookup', () => {
        expect(parseNCBTest('b13')).toEqual({ type: 'bit', bit: 13 });
    });

    it('parses the special terms', () => {
        expect(parseNCBTest('o142')).toEqual({ type: 'outfit', id: 142 });
        expect(parseNCBTest('e128')).toEqual({ type: 'explored', id: 128 });
        expect(parseNCBTest('g')).toEqual({ type: 'gender' });
        expect(parseNCBTest('p30')).toEqual({ type: 'registered', days: 30 });
    });

    it('parses the first example from the EVN Bible', () => {
        // b13 & (b15 | !b72)
        expect(parseNCBTest('b13 & (b15 | !b72)')).toEqual({
            type: 'and',
            operands: [
                { type: 'bit', bit: 13 },
                {
                    type: 'or',
                    operands: [
                        { type: 'bit', bit: 15 },
                        { type: 'not', operand: { type: 'bit', bit: 72 } },
                    ],
                },
            ],
        });
    });

    it('parses the second example from the EVN Bible', () => {
        // !(B42 | B53) & b103
        expect(parseNCBTest('!(B42 | B53) & b103')).toEqual({
            type: 'and',
            operands: [
                {
                    type: 'not',
                    operand: {
                        type: 'or',
                        operands: [
                            { type: 'bit', bit: 42 },
                            { type: 'bit', bit: 53 },
                        ],
                    },
                },
                { type: 'bit', bit: 103 },
            ],
        });
    });

    it('is case-insensitive', () => {
        expect(parseNCBTest('B13 & O142')).toEqual(parseNCBTest('b13 & o142'));
    });

    it('rejects bits above 9999 that are not namespaced physical bits', () => {
        expect(() => parseNCBTest('b10000')).toThrowError(NCBParseError);
        expect(() => parseNCBTest('b19999')).toThrowError(NCBParseError);
        expect(() => parseNCBTest('b9999')).not.toThrow();
        // Plug-in-private bits are renumbered by NovaParse into the
        // physical range and must read back as bits.
        expect(parseNCBTest('b20000')).toEqual({ type: 'bit', bit: 20000 });
        expect(parseNCBTest('20345')).toEqual({ type: 'bit', bit: 20345 });
    });

    // Plug-in-data compatibility rule; see parseNCBTest's docs for why a
    // bare number is a control bit and where real data relies on it.
    it('reads a bare number as a control bit', () => {
        expect(parseNCBTest('9001')).toEqual({ type: 'bit', bit: 9001 });
        expect(parseNCBTest('!9001')).toEqual(parseNCBTest('!b9001'));
        // More Blasters CHEAT oütf 536's Availability, leading zero and all.
        expect(parseNCBTest('0525')).toEqual({ type: 'bit', bit: 525 });
        // Extra Outfits oütf 471 ("Empty Weapon Hull"), verbatim.
        expect(parseNCBTest('b9002 & b9003 & b9004 & !9001'))
            .toEqual(parseNCBTest('b9002 & b9003 & b9004 & !b9001'));
        // Stock Nova mïsn 428's AvailBits, verbatim.
        expect(parseNCBTest('!(b511 | b515) & !((b50 | 467) | b6666)'))
            .toEqual(parseNCBTest('!(b511 | b515) & !((b50 | b467) | b6666)'));
    });

    it('still range-checks a bare number', () => {
        expect(() => parseNCBTest('10000')).toThrowError(NCBParseError);
    });

    it('rejects malformed expressions', () => {
        expect(() => parseNCBTest('b13 &')).toThrowError(NCBParseError);
        expect(() => parseNCBTest('& b13')).toThrowError(NCBParseError);
        expect(() => parseNCBTest('(b13')).toThrowError(NCBParseError);
        expect(() => parseNCBTest('b13)')).toThrowError(NCBParseError);
        expect(() => parseNCBTest('b13 b14')).toThrowError(NCBParseError);
        expect(() => parseNCBTest('foo')).toThrowError(NCBParseError);
        expect(() => parseNCBTest('!')).toThrowError(NCBParseError);
    });
});

describe('evaluateNCBTest', () => {
    it('evaluates blank expressions to true', () => {
        expect(evaluateNCBTest('', bitContext())).toBe(true);
    });

    it('looks up bits', () => {
        expect(evaluateNCBTest('b13', bitContext(13))).toBe(true);
        expect(evaluateNCBTest('b13', bitContext())).toBe(false);
    });

    it('evaluates negation', () => {
        expect(evaluateNCBTest('!b13', bitContext())).toBe(true);
        expect(evaluateNCBTest('!b13', bitContext(13))).toBe(false);
        expect(evaluateNCBTest('!!b13', bitContext(13))).toBe(true);
    });

    it('evaluates conjunction and disjunction', () => {
        expect(evaluateNCBTest('b1 & b2', bitContext(1, 2))).toBe(true);
        expect(evaluateNCBTest('b1 & b2', bitContext(1))).toBe(false);
        expect(evaluateNCBTest('b1 | b2', bitContext(2))).toBe(true);
        expect(evaluateNCBTest('b1 | b2', bitContext())).toBe(false);
    });

    it('evaluates the first example from the EVN Bible', () => {
        const expression = 'b13 & (b15 | !b72)';
        expect(evaluateNCBTest(expression, bitContext(13, 15, 72))).toBe(true);
        expect(evaluateNCBTest(expression, bitContext(13))).toBe(true);
        expect(evaluateNCBTest(expression, bitContext(13, 72))).toBe(false);
        expect(evaluateNCBTest(expression, bitContext(15))).toBe(false);
    });

    it('evaluates the second example from the EVN Bible', () => {
        const expression = '!(B42 | B53) & b103';
        expect(evaluateNCBTest(expression, bitContext(103))).toBe(true);
        expect(evaluateNCBTest(expression, bitContext(42, 103))).toBe(false);
        expect(evaluateNCBTest(expression, bitContext(53, 103))).toBe(false);
        expect(evaluateNCBTest(expression, bitContext())).toBe(false);
    });

    it('gives & precedence over |', () => {
        // b1 | b2 & b3 parses as b1 | (b2 & b3).
        expect(evaluateNCBTest('b1 | b2 & b3', bitContext(1))).toBe(true);
        expect(evaluateNCBTest('b1 | b2 & b3', bitContext(2))).toBe(false);
        expect(evaluateNCBTest('b1 | b2 & b3', bitContext(2, 3))).toBe(true);
    });

    it('evaluates outfit and explored terms through the context', () => {
        const context = {
            getBit: () => false,
            hasOutfit: (id: number) => id === 142,
            hasExplored: (id: number) => id === 130,
        };
        expect(evaluateNCBTest('o142', context)).toBe(true);
        expect(evaluateNCBTest('o143', context)).toBe(false);
        expect(evaluateNCBTest('e130', context)).toBe(true);
        expect(evaluateNCBTest('e131', context)).toBe(false);
    });

    it('defaults exotic terms sensibly when the context omits them', () => {
        expect(evaluateNCBTest('o142', bitContext())).toBe(false);
        expect(evaluateNCBTest('e130', bitContext())).toBe(false);
        expect(evaluateNCBTest('g', bitContext())).toBe(true);
        expect(evaluateNCBTest('p30', bitContext())).toBe(true);
    });

    it('reads gender from the context', () => {
        expect(evaluateNCBTest('g', { ...bitContext(), isMale: false }))
            .toBe(false);
        expect(evaluateNCBTest('g', { ...bitContext(), isMale: true }))
            .toBe(true);
    });
});

describe('parseNCBSet', () => {
    it('parses a blank expression as no operations', () => {
        expect(parseNCBSet('')).toEqual([]);
        expect(parseNCBSet('   ')).toEqual([]);
    });

    it('parses the example from the EVN Bible', () => {
        // b1 b2 !b3 ^b4
        expect(parseNCBSet('b1 b2 !b3 ^b4')).toEqual([
            { type: 'set', bit: 1 },
            { type: 'set', bit: 2 },
            { type: 'clear', bit: 3 },
            { type: 'toggle', bit: 4 },
        ]);
    });

    it('parses the random example from the EVN Bible', () => {
        // b1 R(b2 !b3)
        expect(parseNCBSet('b1 R(b2 !b3)')).toEqual([
            { type: 'set', bit: 1 },
            {
                type: 'random',
                choices: [
                    { type: 'set', bit: 2 },
                    { type: 'clear', bit: 3 },
                ],
            },
        ]);
    });

    it('parses every named operator', () => {
        expect(parseNCBSet(
            'A128 F129 S130 G131 D132 M133 N134 C135 E136 H137 ' +
            'K138 L139 P140 Y141 U142 Q143 T144 X145')).toEqual([
                { type: 'abortMission', id: 128 },
                { type: 'failMission', id: 129 },
                { type: 'startMission', id: 130 },
                { type: 'grantOutfit', id: 131 },
                { type: 'removeOutfit', id: 132 },
                { type: 'moveToSystem', id: 133, keepCoordinates: false },
                { type: 'moveToSystem', id: 134, keepCoordinates: true },
                { type: 'changeShip', id: 135, outfits: 'keep' },
                { type: 'changeShip', id: 136, outfits: 'keepAndGrantDefaults' },
                { type: 'changeShip', id: 137, outfits: 'dropAndGrantDefaults' },
                { type: 'activateRank', id: 138 },
                { type: 'deactivateRank', id: 139 },
                { type: 'playSound', id: 140 },
                { type: 'destroyStellar', id: 141 },
                { type: 'regenerateStellar', id: 142 },
                { type: 'leaveStellar', stringId: 143 },
                { type: 'renameShip', stringId: 144 },
                { type: 'exploreSystem', id: 145 },
            ] as NCBSetOperation[]);
    });

    it('is case-insensitive', () => {
        expect(parseNCBSet('B1 g142 r(B2 !B3)'))
            .toEqual(parseNCBSet('b1 G142 R(b2 !b3)'));
    });

    // Plug-in-data compatibility rule; see parseNCBSet's docs. Rejecting
    // these threw away the whole string, taking the operators AFTER the
    // stray separator with it -- the Energon Cannon bug.
    it('treats a stray & or | between operations as a separator', () => {
        expect(parseNCBSet('D613 & G615 & b9027'))
            .toEqual(parseNCBSet('D613 G615 b9027'));
        expect(parseNCBSet('b1 | b2')).toEqual(parseNCBSet('b1 b2'));
        // Extra Outfits oütf 471's OnPurchase, verbatim (trailing space
        // included): the whole crafting step in one string.
        expect(parseNCBSet(
            '!b9002 & !b9003 & !b9004 & b9001 G472 D468 D469 D470 D471 '))
            .toEqual(parseNCBSet(
                '!b9002 !b9003 !b9004 b9001 G472 D468 D469 D470 D471'));
        // HypergatePass crön 386's OnEnd: the separator sits mid-string,
        // with a Qxxx after it that used to be lost.
        expect(parseNCBSet('D444 L159 !B918 & Q25077'))
            .toEqual(parseNCBSet('D444 L159 !b918 Q25077'));
    });

    it('rejects malformed expressions', () => {
        expect(() => parseNCBSet('b')).toThrowError(NCBParseError);
        expect(() => parseNCBSet('z123')).toThrowError(NCBParseError);
        expect(() => parseNCBSet('R(b1 b2')).toThrowError(NCBParseError);
        expect(() => parseNCBSet('R(b1)')).toThrowError(NCBParseError);
        expect(() => parseNCBSet('R(b1 b2 b3)')).toThrowError(NCBParseError);
        expect(() => parseNCBSet('b1)')).toThrowError(NCBParseError);
        expect(() => parseNCBSet('b10000')).toThrowError(NCBParseError);
        expect(() => parseNCBSet('!G142')).toThrowError(NCBParseError);
        // ...but a namespaced physical bit is fine.
        expect(parseNCBSet('b20000 !b20001')).toEqual([
            { type: 'set', bit: 20000 }, { type: 'clear', bit: 20001 }]);
    });
});

describe('runNCBSet', () => {
    it('sets, clears, and toggles bits', () => {
        const bits = new Set([3, 4]);
        runNCBSet('b1 b2 !b3 ^b4 ^b5', makeControlBitHooks(bits), () => 0);
        expect(bits).toEqual(new Set([1, 2, 5]));
    });

    it('runs exactly one branch of R(...)', () => {
        const bits = new Set([3]);
        runNCBSet('b1 R(b2 !b3)', makeControlBitHooks(bits), () => 0);
        expect(bits).toEqual(new Set([1, 2, 3]));

        const bits2 = new Set([3]);
        runNCBSet('b1 R(b2 !b3)', makeControlBitHooks(bits2), () => 0.75);
        expect(bits2).toEqual(new Set([1]));
    });

    it('supports nested random choices', () => {
        // First call picks the outer branch, second the inner one.
        const rolls = [0.25, 0.75];
        const bits = new Set<number>();
        runNCBSet('R(R(b1 b2) b3)', makeControlBitHooks(bits),
            () => rolls.shift()!);
        expect(bits).toEqual(new Set([2]));
    });

    it('grants and removes outfits through the hooks', () => {
        const bits = new Set<number>();
        const outfits = new Map([['nova:200', 2]]);
        const hooks = makeControlBitHooks(bits, {
            outfits,
            resolveId: id => `nova:${id}`,
        });
        runNCBSet('G142 G142 D200', hooks, () => 0);
        expect(outfits).toEqual(new Map([['nova:142', 2], ['nova:200', 1]]));
        runNCBSet('D200 D200', hooks, () => 0);
        expect(outfits).toEqual(new Map([['nova:142', 2]]));
    });

    it('dispatches every operator to its hook', () => {
        const calls: [string, ...unknown[]][] = [];
        const record = (name: string) =>
            (...args: unknown[]) => void calls.push([name, ...args]);
        const hooks: NCBSetHooks = {
            setBit: record('setBit'),
            clearBit: record('clearBit'),
            toggleBit: record('toggleBit'),
            grantOutfit: record('grantOutfit'),
            removeOutfit: record('removeOutfit'),
            abortMission: record('abortMission'),
            failMission: record('failMission'),
            startMission: record('startMission'),
            moveToSystem: record('moveToSystem'),
            changeShip: record('changeShip'),
            activateRank: record('activateRank'),
            deactivateRank: record('deactivateRank'),
            playSound: record('playSound'),
            destroyStellar: record('destroyStellar'),
            regenerateStellar: record('regenerateStellar'),
            leaveStellar: record('leaveStellar'),
            renameShip: record('renameShip'),
            exploreSystem: record('exploreSystem'),
        };
        runNCBSet(
            'b1 !b2 ^b3 A128 F129 S130 G131 D132 M133 N134 C135 E136 H137 ' +
            'K138 L139 P140 Y141 U142 Q143 T144 X145', hooks, () => 0);
        expect(calls).toEqual([
            ['setBit', 1],
            ['clearBit', 2],
            ['toggleBit', 3],
            ['abortMission', 128],
            ['failMission', 129],
            ['startMission', 130],
            ['grantOutfit', 131],
            ['removeOutfit', 132],
            ['moveToSystem', 133, false],
            ['moveToSystem', 134, true],
            ['changeShip', 135, 'keep'],
            ['changeShip', 136, 'keepAndGrantDefaults'],
            ['changeShip', 137, 'dropAndGrantDefaults'],
            ['activateRank', 138],
            ['deactivateRank', 139],
            ['playSound', 140],
            ['destroyStellar', 141],
            ['regenerateStellar', 142],
            ['leaveStellar', 143],
            ['renameShip', 144],
            ['exploreSystem', 145],
        ]);
    });

    it('ignores operators whose hooks are absent', () => {
        const bits = new Set<number>();
        // Unimplemented hooks no-op (with a warning) rather than throw.
        expect(() => runNCBSet('A128 S129 b1', makeControlBitHooks(bits),
            () => 0)).not.toThrow();
        expect(bits).toEqual(new Set([1]));
    });
});
