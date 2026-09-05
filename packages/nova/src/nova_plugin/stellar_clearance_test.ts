import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import {
    getIntegrationGameData, getPluginGameData,
} from '../communication/simulation_test_fixture.js';
import { LegalRecords } from './reputation.js';
import { ranksAllowLanding } from './rank_logic.js';
import {
    clearanceDenial, contributeBits, govtRequirementsMet, isMissionDestination,
    MIN_STATUS_IGNORED, MIN_STATUS_NEVER, planetClearance, stellarClearance,
    stellarRecord,
} from './stellar_clearance.js';

function stellar(over: Partial<PlanetData> = {}): PlanetData {
    return { ...getDefaultPlanetData(), ...over };
}

function govt(over: Partial<GovtData> = {}): GovtData {
    return { ...getDefaultGovtData(), id: 'nova:128', ...over };
}

/** The clearance verdict for a MinStatus / record pair, nothing else set. */
function verdict(minStatus: number, record: number) {
    return stellarClearance(
        { minStatus, flags: { uninhabited: false } }, { record });
}

describe('stellarClearance MinStatus semantics', () => {
    // EVN Bible, spöb MinStatus: "-32767  Ignored (player can always land)".
    it('clears every record when MinStatus is the ignored sentinel', () => {
        expect(verdict(MIN_STATUS_IGNORED, 0).cleared).toBeTrue();
        expect(verdict(MIN_STATUS_IGNORED, -32767).cleared).toBeTrue();
        expect(verdict(MIN_STATUS_IGNORED, 32767).cleared).toBeTrue();
    });

    // "32767  Player can never land."
    it('refuses every record when MinStatus is the never sentinel', () => {
        expect(verdict(MIN_STATUS_NEVER, 32766)).toEqual(
            { cleared: false, reason: 'forbidden' });
        expect(verdict(MIN_STATUS_NEVER, 0).cleared).toBeFalse();
    });

    // "-1 to -32766  You can be this evil before they shun you".
    it('shuns a record below a NEGATIVE MinStatus and admits one at it', () => {
        expect(verdict(-10, -9).cleared).toBeTrue();
        expect(verdict(-10, -10).cleared).toBeTrue();
        expect(verdict(-10, -11)).toEqual(
            { cleared: false, reason: 'hostile' });
    });

    // "0 to 32766  They have to like you this much before they let you land".
    it('requires a record at or above a POSITIVE MinStatus', () => {
        expect(verdict(5, 5).cleared).toBeTrue();
        expect(verdict(5, 6).cleared).toBeTrue();
        expect(verdict(5, 4)).toEqual({ cleared: false, reason: 'hostile' });
        // MinStatus 0 — the stock default — shuts a criminal out.
        expect(verdict(0, 0).cleared).toBeTrue();
        expect(verdict(0, -1)).toEqual({ cleared: false, reason: 'hostile' });
    });

    // "(Note that this field is ignored if the stellar is uninhabited)"
    it('ignores MinStatus entirely on an uninhabited stellar', () => {
        const shut = { minStatus: MIN_STATUS_NEVER };
        expect(stellarClearance({ ...shut, flags: { uninhabited: true } },
            { record: -30000 }).cleared).toBeTrue();
        expect(stellarClearance({ ...shut, flags: { uninhabited: false } },
            { record: -30000 }).cleared).toBeFalse();
    });

    // The gate exemption this module used to carry is GONE: a working
    // hypergate's 32767 is a real "shut until you hold the rank".
    it('applies MinStatus to a gate like any other inhabited stellar', () => {
        expect(stellarClearance({
            minStatus: MIN_STATUS_NEVER, flags: { uninhabited: false },
        }, { record: 30000 })).toEqual(
            { cleared: false, reason: 'forbidden' });
    });
});

describe('stellarClearance rank 0x0200 (land regardless of MinStatus)', () => {
    // EVN Bible, rank Flags 0x0200: "All planets of the affiliated government
    // will let the player land when he has this rank, regardless of their
    // MinStatus field".
    const inhabited = { flags: { uninhabited: false } };

    it('opens a MinStatus 32767 stellar - the hypergate case', () => {
        const shutGate = { ...inhabited, minStatus: MIN_STATUS_NEVER };
        expect(stellarClearance(shutGate, { record: 0 })).toEqual(
            { cleared: false, reason: 'forbidden' });
        expect(stellarClearance(shutGate,
            { record: 0, rankLandingOverride: true }).cleared).toBeTrue();
    });

    it('opens a record-gated stellar the player is too disliked for', () => {
        const dock = { ...inhabited, minStatus: 2 };
        expect(stellarClearance(dock, { record: -500 })).toEqual(
            { cleared: false, reason: 'hostile' });
        expect(stellarClearance(dock,
            { record: -500, rankLandingOverride: true }).cleared).toBeTrue();
    });

    it('does NOT bypass the govt Require travel permit, which is a '
        + 'different field', () => {
            expect(stellarClearance(
                { ...inhabited, minStatus: MIN_STATUS_NEVER },
                {
                    record: 0, rankLandingOverride: true,
                    govtRequire: '4', contribute: 0n,
                })).toEqual({ cleared: false, reason: 'permit' });
        });
});

describe('the mission-destination override', () => {
    const shutTight = { flags: { uninhabited: false }, minStatus: 100 };

    it('clears a stellar an active mission sends the player to, no matter '
        + 'what the port would otherwise say', () => {
            expect(stellarClearance(shutTight, { record: -900 }).cleared)
                .toBeFalse();
            expect(stellarClearance(shutTight,
                { record: -900, missionDestination: true }).cleared).toBeTrue();
            // Even a 32767 "never", and even with the permit missing.
            expect(stellarClearance(
                { flags: { uninhabited: false }, minStatus: MIN_STATUS_NEVER },
                {
                    record: -900, missionDestination: true,
                    govtRequire: '4', contribute: 0n,
                }).cleared).toBeTrue();
        });

    it('matches either leg of an active mission', () => {
        const travel = [{ travelPlanet: 'nova:133', returnPlanet: null }];
        const ret = [{ travelPlanet: null, returnPlanet: 'nova:133' }];
        expect(isMissionDestination(travel, 'nova:133')).toBeTrue();
        expect(isMissionDestination(ret, 'nova:133')).toBeTrue();
        expect(isMissionDestination(travel, 'nova:134')).toBeFalse();
        expect(isMissionDestination([], 'nova:133')).toBeFalse();
        expect(isMissionDestination(undefined, 'nova:133')).toBeFalse();
    });

    it('honours the duplicate-stellar rule when a sameStellar is supplied, '
        + 'and matches exact ids without one', () => {
            const missions = [{ travelPlanet: 'nova:503', returnPlanet: null }];
            expect(isMissionDestination(missions, 'nova:214')).toBeFalse();
            expect(isMissionDestination(missions, 'nova:214',
                (a, b) => (a === 'nova:503' && b === 'nova:214')
                    || (a === 'nova:214' && b === 'nova:503'))).toBeTrue();
        });
});

describe('stellarClearance govt Require (travel permits)', () => {
    // EVN Bible, gövt Require: "If for each 1 bit in the Require fields there
    // is not a matching 1 bit in one or more of the Contribute fields then you
    // won't be allowed to visit any planets or stations owned by this govt".
    it('denies a stellar whose govt Require is not covered', () => {
        const open = {
            minStatus: MIN_STATUS_IGNORED, flags: { uninhabited: false },
        };
        expect(stellarClearance(open,
            { record: 0, govtRequire: '4', contribute: 0n }))
            .toEqual({ cleared: false, reason: 'permit' });
        // Holding the permit bit opens it.
        expect(stellarClearance(open,
            { record: 0, govtRequire: '4', contribute: 0b100n }).cleared)
            .toBeTrue();
        // Extra Contribute bits are harmless; a zero Require always passes.
        expect(stellarClearance(open,
            { record: 0, govtRequire: '0', contribute: 0n }).cleared).toBeTrue();
    });

    it('reports the permit denial ahead of the legal-record one', () => {
        expect(clearanceDenial(stellarClearance(
            { minStatus: 100, flags: { uninhabited: false } },
            { record: -500, govtRequire: '1', contribute: 0n })))
            .toEqual('permit');
    });

    it('reads the govt Require DECIMAL encoding, not hex', () => {
        // GovtData.require is decimal (govt_parse) while shïp/oütf Contribute
        // are hex (ship_parse/outfit_parse) — 10 decimal is 0b1010.
        expect(govtRequirementsMet('10', 0b1010n)).toBeTrue();
        expect(govtRequirementsMet('10', 0b0010n)).toBeFalse();
        expect(govtRequirementsMet(undefined, undefined)).toBeTrue();
    });

    it('unions the ship and outfit Contribute bits', () => {
        expect(contributeBits('0x1', ['0x2', '0x8']))
            .toEqual(0xbn);
        expect(contributeBits(undefined, [])).toEqual(0n);
    });
});

describe('planetClearance', () => {
    const shut = stellar({ minStatus: 100 });

    it('honours a live bribe and ignores a lapsed one', () => {
        expect(planetClearance({ planet: shut, now: 1000 }).cleared).toBeFalse();
        expect(planetClearance({
            planet: shut, bribedUntil: 5000, now: 1000,
        }).cleared).toBeTrue();
        // Expiry is compared, never pruned: a lapsed entry simply stops
        // counting.
        expect(planetClearance({
            planet: shut, bribedUntil: 5000, now: 5000,
        }).cleared).toBeFalse();
        expect(planetClearance({
            planet: shut, bribedUntil: 5000, now: 9000,
        }).cleared).toBeFalse();
    });

    it('judges the record with the stellar\'s OWNING govt', () => {
        const fed = govt({ id: 'nova:128', initialRecord: 0 });
        const records: LegalRecords = new Map([
            ['nova:128', -50], ['nova:129', 900]]);
        expect(planetClearance({
            planet: shut, planetGovt: fed, records,
        }).cleared).toBeFalse();
        expect(planetClearance({
            planet: shut, planetGovt: govt({ id: 'nova:129' }), records,
        }).cleared).toBeTrue();
    });

    it('reads an absent record as the govt InitialRec', () => {
        expect(stellarRecord(govt({ initialRecord: 7 }), new Map())).toEqual(7);
        // An independent stellar has no govt to hold a record with.
        expect(stellarRecord(undefined, new Map([['nova:128', -900]])))
            .toEqual(0);
    });

    it('is a pure function of its inputs — two evaluations agree', () => {
        const args = {
            planet: shut, planetGovt: govt({ require: '3' }),
            records: new Map([['nova:128', 4]]) as LegalRecords,
            contribute: 0b11n, bribedUntil: 10, now: 5,
        };
        expect(planetClearance(args)).toEqual(planetClearance(args));
    });
});

describe('stellarClearance against real Nova data', () => {
    let planets: PlanetData[];
    let govts: Map<string, GovtData>;
    beforeAll(async () => {
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        planets = await Promise.all(
            ids.Planet.map(id => gameData.data.Planet.get(id)));
        govts = new Map(await Promise.all(ids.Govt.map(async id =>
            [id, await gameData.data.Govt.get(id)] as const)));
    }, 120_000);

    it('parses MinStatus off the stock spöbs', () => {
        // Earth: the ordinary Federation homeworld, MinStatus 0 — open to a
        // clean pilot and shut to a criminal.
        const earth = planets.find(p => p.id === 'nova:128')!;
        expect(earth.name).toBe('Earth');
        expect(earth.minStatus).toBe(0);
        expect(earth.govt).toBe('nova:128');

        // A stellar that wants to LIKE you first: Spacedock II, MinStatus 2.
        const spacedock = planets.find(p => p.id === 'nova:133')!;
        expect(spacedock.name).toBe('Spacedock II');
        expect(spacedock.minStatus).toBe(2);

        // A stellar that tolerates evil: Brass, MinStatus -100.
        const brass = planets.find(p => p.id === 'nova:505')!;
        expect(brass.name).toBe('Brass');
        expect(brass.minStatus).toBe(-100);
    });

    it('finds MinStatus 32767 ONLY on the 19 working hypergates, and '
        + 'refuses every one of them to a rank-less pilot', () => {
            const never = planets.filter(p => p.minStatus === MIN_STATUS_NEVER);
            // All 19 of them: HG-V01 (nova:1400) .. HG-Koria (nova:1418).
            expect(never.length).toBe(19);
            expect(never.map(p => p.id)).toContain('nova:1400');
            expect(never.find(p => p.id === 'nova:1400')!.name).toBe('HG-V01');
            for (const stock of never) {
                expect(stock.gate?.kind)
                    .withContext(`${stock.id} ${stock.name}`).toBe('hypergate');
                expect(stock.flags.canLand)
                    .withContext(`${stock.id} ${stock.name}`).toBeTrue();
                // govt nova:183 "Hypergate" - the rank's affiliation.
                expect(stock.govt)
                    .withContext(`${stock.id} ${stock.name}`).toBe('nova:183');
                // The network is SHUT until rank nova:147 is active.
                expect(planetClearance({
                    planet: stock, planetGovt: govts.get('nova:183'),
                })).withContext(`${stock.id} ${stock.name}`)
                    .toEqual({ cleared: false, reason: 'forbidden' });
                // ...and open with it.
                expect(planetClearance({
                    planet: stock, planetGovt: govts.get('nova:183'),
                    rankLandingOverride: true,
                }).cleared).withContext(`${stock.id} ${stock.name}`).toBeTrue();
            }
            // The 19 gates are consequently the ONLY stock 'forbidden'
            // stellars.
            const forbidden = planets.filter(p =>
                clearanceDenial(planetClearance({
                    planet: p,
                    planetGovt: p.govt ? govts.get(p.govt) : undefined,
                })) === 'forbidden');
            expect(forbidden.length).toBe(19);
        });

    it('opens every gate to a pilot holding rank nova:147, and to one on a '
        + 'mission that sends them there', async () => {
            const gameData = await getIntegrationGameData();
            const rank = await gameData.data.Rank.get('nova:147');
            const stock = planets.find(p => p.id === 'nova:1400')!;
            const hypergateGovt = govts.get('nova:183')!;
            // The whole mechanism, end to end, off the real data.
            expect(rank.affilGovt).toBe(hypergateGovt.id);
            expect(rank.rankFlags.canAlwaysLandOnGovtStellars).toBeTrue();
            expect(planetClearance({
                planet: stock, planetGovt: hypergateGovt,
                rankLandingOverride: ranksAllowLanding(
                    new Set(['nova:147']), () => rank, stock.govt),
            }).cleared).toBeTrue();
            // A mission that sends the pilot to a gate opens it too, with no
            // rank at all. (No STOCK mission does - see rank_stock_test.ts -
            // but a plug-in's may.)
            expect(planetClearance({
                planet: stock, planetGovt: hypergateGovt,
                missionDestination: true,
            }).cleared).toBeTrue();
        });

    it('shuts Spacedock II to a fresh pilot and opens it to a liked one',
        () => {
            const spacedock = planets.find(p => p.id === 'nova:133')!;
            const fed = govts.get('nova:128')!;
            expect(planetClearance({
                planet: spacedock, planetGovt: fed, records: new Map(),
            })).toEqual({ cleared: false, reason: 'hostile' });
            expect(planetClearance({
                planet: spacedock, planetGovt: fed,
                records: new Map([['nova:128', 2]]),
            }).cleared).toBeTrue();
        });

    it('keeps Earth open to a clean pilot and shuts it to a criminal', () => {
        const earth = planets.find(p => p.id === 'nova:128')!;
        const fed = govts.get('nova:128')!;
        expect(planetClearance({
            planet: earth, planetGovt: fed, records: new Map(),
        }).cleared).toBeTrue();
        expect(planetClearance({
            planet: earth, planetGovt: fed,
            records: new Map([['nova:128', -1]]),
        })).toEqual({ cleared: false, reason: 'hostile' });
    });

    it('ignores MinStatus on the uninhabited stellars that set one', () => {
        // New Ireland (nova:506) is uninhabited with MinStatus -50: the
        // Bible's parenthesis means the field never fires.
        const newIreland = planets.find(p => p.id === 'nova:506')!;
        expect(newIreland.flags.uninhabited).toBeTrue();
        expect(newIreland.minStatus).toBe(-50);
        expect(planetClearance({
            planet: newIreland, records: new Map([['nova:144', -30000]]),
        }).cleared).toBeTrue();
    });

    it('no stock govt sets Require, so travel permits deny nothing today',
        () => {
            for (const [id, g] of govts) {
                expect(BigInt(g.require)).withContext(`${id} ${g.name}`)
                    .toBe(0n);
            }
        });
});

/**
 * The one real travel permit in the installed data. arpia's "Gas Giant"
 * gövts 202/203 own 22 landable stellars (Neo New York, Tau III, Jupiter,
 * Spica, ...) and Require raw bit 7; the plug-in's Keycard oütf 493 (and
 * the Kilmura / Sylvatha hulls) Contribute raw bit 7. Bit 7 is not in the
 * stock base set, so NovaParse renumbers it to a plug-in-private physical
 * bit — and the permit only works if the gövt's Require is renumbered
 * through the same namespace as the outfit's Contribute (it was not:
 * the gövt kept the raw mask, and the 22 planets were unlandable forever).
 *
 * Install-dependent by design, so it PENDS (is skipped, not passed) on a
 * machine without the plug-in; do not count it as coverage there. The
 * mechanism is pinned without the plug-in by novaparse's
 * plugin_govt_require_test (the same shape rebuilt from bytes, through the
 * whole parse pipeline), flag_namespace_test and govt_parse_test.
 */
describe('gövt Require against real plug-in data (arpia travel permit)', () => {
    it('is satisfied by the plug-in\'s own keycard outfit', async () => {
        const gameData = await getPluginGameData('arpia');
        if (!gameData) {
            pending('SKIPPED, not passed: the arpia plug-in is not installed '
                + 'under packages/nova/Nova_Data/Plug-ins. The gövt Require '
                + 'namespacing it checks is still pinned by novaparse\'s '
                + 'plugin_govt_require_test (synthetic stand-in).');
            return;
        }
        const gasGiant = await gameData.data.Govt.get('arpia:202');
        const keycard = await gameData.data.Outfit.get('arpia:493');
        expect(gasGiant.name).toContain('Gas Giant');
        expect(keycard.name).toContain('Keycard');
        const require = BigInt(gasGiant.require);
        expect(require).not.toBe(0n);
        // Namespaced: the raw bit 7 is not in the stock base set, so the
        // physical bit is a private one at or past 64.
        expect(require & ((1n << 64n) - 1n)).toBe(0n);

        // Nothing owned: denied.
        expect(govtRequirementsMet(gasGiant.require,
            contributeBits(undefined, []))).toBeFalse();
        // Keycard owned: cleared.
        expect(govtRequirementsMet(gasGiant.require,
            contributeBits(undefined, [keycard.contribute]))).toBeTrue();
    });
});
