import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { getDefaultJunkData } from 'novadatainterface/junk_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { contrabandScanMessage } from '../../display/status_bar_content.js';
import { deriveEntityComponents, GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { prepareCarriedEntitiesForFreshWorld } from '../pilot/index.js';
import {
    ActiveMission, CreditsComponent, MissionsComponent,
} from '../player/index.js';
import { LegalRecordsComponent } from '../reputation/index.js';
import { AggressionSuppressGovtsComponent } from '../ncb/index.js';
import {
    CargoComponent, makeShip, OutfitsStateComponent, TargetComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { LandEvent } from '../travel/index.js';
import {
    applyContrabandScan, contrabandFine, ContrabandFindings, findContraband,
    hasContraband, missionIllegal, scansHere, smugglingPenalty,
    smugglingRecordChange,
} from './contraband.js';
import { ContrabandScanEvent, ContrabandScanEventData } from './contraband_scan.js';
import { ContrabandScannedComponent } from './contraband_target.js';
import { NpcComponent } from './npc_component.js';
import {
    govtDispositionTo, localLaw, shipDisposition,
} from '../reputation/index.js';

/**
 * ============================================================================
 * The AI 4 contraband scan (npc/contraband*.ts) against the reference
 * ============================================================================
 *
 * docs/reference_experiments.md, "S1 / I1 wave 11" and "S1 and S2 wave
 * 12", on a kit govt like the one measured: ScanMask 0x0001, ScanFine 500,
 * SmugPenalty 50, CrimeTol 10, owning the system.
 */

const CUSTOMS = 'test:customs';
const NEIGHBOUR = 'test:neighbour';
const SYSTEM = 'test:system';
const CUTTER_HULL = 'test:cutter';
const PLAYER_HULL = 'test:lancer';
const POD = 'test:pod';
const LEGAL_GUN = 'test:legal';
const SMUGGLED_JUNK = 'test:junk';
const LEGAL_JUNK = 'test:junk-legal';
const CUTTER = 'npc:cutter';
const CUTTER_2 = 'npc:cutter2';
const PILOT = 'pilot:one';
const PILOT_2 = 'pilot:two';
const START_CREDITS = 1_000_000;

function govt(id: string, overrides: Partial<GovtData>): GovtData {
    return { ...getDefaultGovtData(), id, ...overrides };
}

function mission(id: string, overrides: Partial<ActiveMission>): ActiveMission {
    return {
        id, acceptedDay: 0, acceptedAt: 'test:planet', travelPlanet: null,
        returnPlanet: null, cargoType: 3, cargoQty: 1, cargoLoaded: true,
        travelDone: false, deadlineDay: null, ...overrides,
    };
}

interface Hold {
    outfits?: Record<string, number>;
    cargo?: Record<string, number>;
    missions?: ActiveMission[];
    credits?: number;
}

interface WorldOptions {
    /** Overrides for the customs govt. */
    customs?: Partial<GovtData>;
    /** Overrides for the neighbour govt (classes [8], no relations). */
    neighbour?: Partial<GovtData>;
    /** The system's owner; null for independent. Defaults to CUSTOMS. */
    systemGovt?: string | null;
    /** The first pilot's possessions. */
    pilot?: Hold;
    /** A second pilot, at the mirror position. */
    pilot2?: Hold;
    /** A second interceptor. */
    secondCutter?: boolean;
}

async function scanWorld(options: WorldOptions = {}) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(CUTTER_HULL, { ...getDefaultShipData(), id: CUTTER_HULL });
    gameData.data.Ship.map.set(PLAYER_HULL, { ...getDefaultShipData(), id: PLAYER_HULL });
    const outfit = (id: string, extra: Partial<OutfitData>) =>
        gameData.data.Outfit.map.set(id, { ...getDefaultOutfitData(), id, ...extra });
    outfit(POD, { name: 'Kit Contraband Pod', lcName: 'kit contraband pod', scanMask: 0x0001 });
    outfit(LEGAL_GUN, { name: 'Legal Gun', scanMask: 0x0002 });
    gameData.data.Junk.map.set(SMUGGLED_JUNK, {
        ...getDefaultJunkData(), id: SMUGGLED_JUNK, name: 'Kit Contraband',
        lcName: 'kit contraband', scanMask: 0x0001,
    });
    gameData.data.Junk.map.set(LEGAL_JUNK,
        { ...getDefaultJunkData(), id: LEGAL_JUNK, scanMask: 0x0004 });
    gameData.data.Govt.map.set(CUSTOMS, govt(CUSTOMS, {
        classes: [7], scanMask: 0x0001, scanFine: 500, smugglePenalty: 50,
        crimeTol: 10, ...options.customs,
    }));
    gameData.data.Govt.map.set(NEIGHBOUR,
        govt(NEIGHBOUR, { classes: [8], ...options.neighbour }));
    gameData.data.System.map.set(SYSTEM, {
        ...getDefaultSystemData(), id: SYSTEM,
        govt: options.systemGovt === undefined ? CUSTOMS : options.systemGovt,
    });
    const world = await makeSystem(SYSTEM, gameData);

    async function addShip(uuid: string, hull: string, position: Position,
        setup: (ship: Entity) => void) {
        const ship = makeShip(gameData.data.Ship.map.get(hull)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position, rotation: new Angle(0),
            turnBack: false, turning: 0, velocity: new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    const addPilot = (uuid: string, x: number, hold: Hold = {}) =>
        addShip(uuid, PLAYER_HULL, new Position(x, 0), ship => {
            ship.components.set(CreditsComponent,
                { credits: hold.credits ?? START_CREDITS });
            ship.components.set(LegalRecordsComponent, new Map());
            ship.components.set(MissionsComponent, new Map(
                (hold.missions ?? []).map(m => [m.id, m])));
            ship.components.set(OutfitsStateComponent, new Map(
                Object.entries(hold.outfits ?? {}).map(
                    ([id, count]) => [id, { count }])));
            ship.components.set(CargoComponent,
                new Map(Object.entries(hold.cargo ?? {})));
        });
    const addCutter = (uuid: string, x: number) =>
        addShip(uuid, CUTTER_HULL, new Position(x, 0), ship => {
            ship.components.set(NpcComponent, { aiType: 4 });
            ship.components.set(GovtComponent, { id: CUSTOMS });
        });

    const pilot = await addPilot(PILOT, 900, options.pilot);
    const pilot2 = options.pilot2
        ? await addPilot(PILOT_2, -900, options.pilot2) : undefined;
    const cutter = await addCutter(CUTTER, 0);
    if (options.secondCutter) {
        await addCutter(CUTTER_2, 50);
    }

    const scans: Array<{ target: string, scan: ContrabandScanEventData }> = [];
    world.addSystem(new System({
        name: 'CollectContrabandScans',
        events: [ContrabandScanEvent],
        args: [ContrabandScanEvent, UUID] as const,
        step(scan, target) {
            scans.push({ target, scan: { ...scan } });
        },
    }));
    world.step();
    return { world, gameData, pilot, pilot2, cutter, scans };
}

function run(world: World, steps: number, each?: () => void) {
    for (let i = 0; i < steps; i++) {
        world.step();
        each?.();
    }
}

/** Steps until `ship` carries the scanned marker, or `maxSteps` pass. */
function runUntilScanned(world: World, ship: Entity, maxSteps = 1200): boolean {
    for (let i = 0; i < maxSteps; i++) {
        world.step();
        if (ship.components.has(ContrabandScannedComponent)) {
            return true;
        }
    }
    return false;
}

const credits = (ship: Entity) => ship.components.get(CreditsComponent)!.credits;
const record = (ship: Entity, govtId = CUSTOMS) =>
    ship.components.get(LegalRecordsComponent)!.get(govtId) ?? 0;

describe('Contraband scan (AI 4 interceptors)', () => {
    it('buzzes a pilot carrying an illegal outfit, fines him, charges '
        + 'SmugPenalty, then attacks a now-criminal pilot (S1)', async () => {
            const { world, pilot, cutter, scans } = await scanWorld(
                { pilot: { outfits: { [POD]: 1 } } });
            expect(cutter.components.get(NpcComponent)?.mode).toBe('scan');
            expect(cutter.components.get(NpcComponent)?.scanTarget).toBe(PILOT);
            expect(runUntilScanned(world, pilot)).toBeTrue();

            expect(credits(pilot)).toBe(START_CREDITS - 500);
            expect(record(pilot)).toBe(-50);
            expect(scans).toEqual([{
                target: PILOT,
                scan: {
                    scanner: CUTTER, outfit: 'kit contraband pod',
                    smuggled: false, missionFailed: false, fine: 500,
                },
            }]);
            // A detection: the customs govt's ships turn on him (and -50
            // against CrimeTol 10 makes him a criminal here besides).
            expect(pilot.components.get(ContrabandScannedComponent)?.hostile)
                .toBe(CUSTOMS);
            run(world, 120);
            expect(cutter.components.get(NpcComponent)?.mode).toBe('attack');
            // ONE fine only.
            run(world, 600);
            expect(credits(pilot)).toBe(START_CREDITS - 500);
            expect(scans.length).toBe(1);
        });

    it('never approaches a clean ship', async () => {
        const { world, pilot, cutter, scans } = await scanWorld({
            pilot: {
                outfits: { [LEGAL_GUN]: 2 },
                cargo: { [`junk:${LEGAL_JUNK}`]: 5, 'cargo:0': 10 },
                missions: [mission('test:legal-mission', { scanMask: 0x0002 })],
            },
        });
        const modes = new Set<string | undefined>();
        run(world, 1200, () => modes.add(
            cutter.components.get(NpcComponent)?.mode));
        expect(modes.has('scan')).toBeFalse();
        expect(pilot.components.has(ContrabandScannedComponent)).toBeFalse();
        expect(credits(pilot)).toBe(START_CREDITS);
        expect(scans).toEqual([]);
    });

    it('fails a 0x0020 mission whose cargo is illegal, with no fine and no '
        + 'record change (S2a)', async () => {
            const flagged = mission('test:s2a', { scanMask: 1, failIfScanned: true });
            const { world, pilot, scans } = await scanWorld(
                { pilot: { missions: [flagged] } });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            const missions = pilot.components.get(MissionsComponent)!;
            expect(missions.get('test:s2a')!.failed).toBeTrue();
            expect(credits(pilot)).toBe(START_CREDITS);
            expect(record(pilot)).toBe(0);
            expect(scans.map(s => s.scan)).toEqual([{
                scanner: CUTTER, smuggled: false, missionFailed: true, fine: 0,
            }]);
            expect(contrabandScanMessage({ ...scans[0].scan, scanner: 'Cutter' }))
                .toBe('Your ship has been scanned - mission failed.');
            // Not a detection (guess): the cutters do not turn on him.
            expect(pilot.components.get(ContrabandScannedComponent)?.hostile)
                .toBeUndefined();
        });

    it('never fails a ScanMask-0 0x0020 mission, even when the scan finds '
        + 'something else (reference S3, wave 14)', async () => {
            // A kit copy of stock mïsn 441 "Rebel Food Drop": Flags 0x0020,
            // ScanMask 0, as 51 stock missions.
            const drop = () => mission('test:s3', {
                scanMask: 0, failIfScanned: true,
            });
            // w14_rescan: the pod is found and fined, the mission survives.
            const withPod = await scanWorld(
                { pilot: { outfits: { [POD]: 1 }, missions: [drop()] } });
            expect(runUntilScanned(withPod.world, withPod.pilot)).toBeTrue();
            expect(withPod.pilot.components.get(MissionsComponent)!
                .get('test:s3')!.failed).toBeUndefined();
            expect(credits(withPod.pilot)).toBe(START_CREDITS - 500);
            expect(withPod.scans.map(s => s.scan.missionFailed)).toEqual([false]);
            // w14_s3_clean: a clean ship carrying it is never approached.
            const clean = await scanWorld({ pilot: { missions: [drop()] } });
            run(clean.world, 600);
            expect(clean.pilot.components.has(ContrabandScannedComponent))
                .toBeFalse();
            expect(clean.scans).toEqual([]);
        });

    it('fines an ordinary mission\'s illegal cargo, keeps the mission, and '
        + 'charges no SmugPenalty (S2b)', async () => {
            const plain = mission('test:s2b', { scanMask: 1 });
            const { world, pilot, scans } = await scanWorld(
                { pilot: { missions: [plain] } });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(pilot.components.get(MissionsComponent)!.get('test:s2b')!
                .failed).toBeUndefined();
            expect(credits(pilot)).toBe(START_CREDITS - 500);
            expect(record(pilot)).toBe(0);
            expect(scans.map(s => s.scan)).toEqual([{
                scanner: CUTTER, smuggled: true, missionFailed: false, fine: 500,
            }]);
        });

    it('names illegal jünk and charges ScanFine AND SmugPenalty '
        + '(w14_junk)', async () => {
            const { world, pilot, scans } = await scanWorld(
                { pilot: { cargo: { [`junk:${SMUGGLED_JUNK}`]: 10 } } });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(credits(pilot)).toBe(START_CREDITS - 500);
            expect(record(pilot)).toBe(-50);
            expect(scans.map(s => s.scan)).toEqual([{
                scanner: CUTTER, junk: 'kit contraband', smuggled: false,
                missionFailed: false, fine: 500,
            }]);
            expect(contrabandScanMessage({
                ...scans[0].scan, scanner: 'Kit Customs Cutter', pilot: 'w14-junk',
            })).toBe('Kit Customs Cutter: w14-junk, your attempt to smuggle kit '
                + 'contraband through this system has been detected. You have '
                + 'been fined 500 credits.');
            expect(pilot.components.get(ContrabandScannedComponent)?.hostile)
                .toBe(CUSTOMS);
        });

    it('ignores mission cargo that is not aboard yet', async () => {
        const later = mission('test:later', {
            scanMask: 1, failIfScanned: true, cargoLoaded: false,
        });
        const { world, pilot, cutter } = await scanWorld(
            { pilot: { missions: [later] } });
        run(world, 600);
        expect(cutter.components.get(NpcComponent)?.mode).not.toBe('scan');
        expect(pilot.components.get(MissionsComponent)!.get('test:later')!
            .failed).toBeUndefined();
    });

    it('does not scan where its govt does not enforce the law (guess)',
        async () => {
            // An independent system, and the customs govt is not nosy.
            const { world, pilot, cutter } = await scanWorld({
                systemGovt: null, pilot: { outfits: { [POD]: 1 } },
            });
            run(world, 600);
            expect(cutter.components.get(NpcComponent)?.mode).not.toBe('scan');
            expect(pilot.components.has(ContrabandScannedComponent)).toBeFalse();
            expect(credits(pilot)).toBe(START_CREDITS);
        });

    it('does not scan for a govt with ScanMask 0', async () => {
        const { world, pilot } = await scanWorld({
            customs: { scanMask: 0 }, pilot: { outfits: { [POD]: 1 } },
        });
        run(world, 600);
        expect(pilot.components.has(ContrabandScannedComponent)).toBeFalse();
    });

    it('attacks a pilot who is already a criminal here instead of '
        + 'scanning him', async () => {
            const { world, pilot, cutter } = await scanWorld(
                { pilot: { outfits: { [POD]: 1 } } });
            pilot.components.get(LegalRecordsComponent)!.set(CUSTOMS, -500);
            run(world, 120);
            expect(cutter.components.get(NpcComponent)?.mode).toBe('attack');
            expect(pilot.components.has(ContrabandScannedComponent)).toBeFalse();
            expect(credits(pilot)).toBe(START_CREDITS);
        });

    for (const scanFine of [0, -5]) {
        it(`ScanFine ${scanFine} is a warning: no fine, no fine sentence, `
            + `SmugPenalty still charged (w14_free / w14_percent)`, async () => {
                const { world, pilot, scans } = await scanWorld({
                    customs: { scanFine },
                    pilot: { outfits: { [POD]: 1 } },
                });
                expect(runUntilScanned(world, pilot)).toBeTrue();
                // NOT 5% of the cash for -5, whatever the Bible says.
                expect(credits(pilot)).toBe(START_CREDITS);
                expect(record(pilot)).toBe(-50);
                expect(scans[0].scan.fine).toBe(0);
                expect(contrabandScanMessage({ ...scans[0].scan, scanner: 'Cutter', pilot: 'Ace' }))
                    .toBe('Cutter: Ace, your posession of a kit contraband pod has been detected.');
            });
    }

    it('after a detection the scanning govt attacks whatever its CrimeTol, '
        + 'until the pilot lands (w14_rescan)', async () => {
            // Kit Customs Tolerant: CrimeTol 30000, so -50 is no crime.
            const { world, pilot, cutter } = await scanWorld({
                customs: { crimeTol: 30000 }, pilot: { outfits: { [POD]: 1 } },
            });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(record(pilot)).toBe(-50);
            run(world, 120);
            expect(cutter.components.get(NpcComponent)?.mode).toBe('attack');
            expect(cutter.components.get(TargetComponent)?.target).toBe(PILOT);

            world.emit(LandEvent, { id: 'test:planet', uuid: 'stellar' }, [PILOT]);
            run(world, 120);
            expect(pilot.components.get(ContrabandScannedComponent)?.hostile)
                .toBeUndefined();
            expect(cutter.components.get(NpcComponent)?.mode).not.toBe('attack');
        });

    it('a ränk 0x0100 holder draws no detection hostility (guess)',
        async () => {
            // A rank of the customs govt with 0x0100: "will not
            // automatically attack" covers the detection (unmeasured).
            const { world, pilot, cutter } = await scanWorld({
                customs: { crimeTol: 30000 }, pilot: { outfits: { [POD]: 1 } },
            });
            pilot.components.set(AggressionSuppressGovtsComponent,
                new Set([CUSTOMS]));
            expect(runUntilScanned(world, pilot)).toBeTrue();
            run(world, 240);
            expect(cutter.components.get(NpcComponent)?.mode).not.toBe('attack');
        });

    it('two interceptors scan a pilot once', async () => {
        const { world, pilot, scans } = await scanWorld({
            secondCutter: true, pilot: { outfits: { [POD]: 1 } },
        });
        expect(runUntilScanned(world, pilot)).toBeTrue();
        run(world, 600);
        expect(scans.length).toBe(1);
        expect(credits(pilot)).toBe(START_CREDITS - 500);
    });

    it('scans each pilot separately, and the consequences land on that '
        + 'pilot alone (multiplayer)', async () => {
            // SmugPenalty 5 keeps the first pilot inside CrimeTol 10, so
            // only the detection itself turns the cutters on him.
            const { world, pilot, pilot2, cutter, scans } = await scanWorld({
                secondCutter: true, customs: { smugglePenalty: 5 },
                pilot: { outfits: { [POD]: 1 } },
                pilot2: { missions: [mission('test:p2', { scanMask: 1 })], credits: 2000 },
            });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            // The detection's hostility is the first pilot's alone.
            run(world, 120);
            expect(cutter.components.get(TargetComponent)?.target).toBe(PILOT);
            expect(pilot2!.components.get(ContrabandScannedComponent)?.hostile)
                .toBeUndefined();
            // The first pilot leaves; the cutters go on to the second.
            world.entities.delete(PILOT);
            expect(runUntilScanned(world, pilot2!)).toBeTrue();
            expect(credits(pilot)).toBe(START_CREDITS - 500);
            expect(record(pilot)).toBe(-5);
            expect(credits(pilot2!)).toBe(1500);
            expect(record(pilot2!)).toBe(0);
            expect(scans.map(s => [s.target, s.scan.outfit ?? null, s.scan.smuggled])
                .sort()).toEqual([
                    [PILOT, 'kit contraband pod', false],
                    [PILOT_2, null, true],
                ]);
        });

    it('does not scan again after a landing, only after an arrival by jump '
        + '(w14_rescan, w14_rescan_jump)', async () => {
            const { world, pilot } = await scanWorld({
                customs: { smugglePenalty: 0, crimeTol: 30000 },
                pilot: { outfits: { [POD]: 1 } },
            });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            const scannedAt = pilot.components.get(ContrabandScannedComponent)!.at;
            world.emit(LandEvent, { id: 'test:planet', uuid: 'stellar' }, [PILOT]);
            run(world, 1200);
            // The marker stays (its hostility gone): no second fine.
            expect(pilot.components.get(ContrabandScannedComponent))
                .toEqual({ at: scannedAt });
            expect(credits(pilot)).toBe(START_CREDITS - 500);

            // A crossing into a fresh world is a new visit.
            prepareCarriedEntitiesForFreshWorld(pilot, PILOT, []);
            expect(pilot.components.has(ContrabandScannedComponent)).toBeFalse();
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(credits(pilot)).toBe(START_CREDITS - 1000);
        });

    it('a nosy scanner in another govt\'s system fines, and RAISES the '
        + 'record by half the owner\'s SmugPenalty (w14_smug_owner, '
        + 'w14_foreign)', async () => {
            const nosyFlags = {
                ...getDefaultGovtData().flags, attacksPlayerIfCriminal: true,
            };
            for (const [ownerSmug, expected] of [[70, 35], [0, 0]] as const) {
                const { world, pilot, scans } = await scanWorld({
                    customs: { flags: nosyFlags }, systemGovt: NEIGHBOUR,
                    neighbour: { smugglePenalty: ownerSmug },
                    pilot: { outfits: { [POD]: 1 } },
                });
                expect(runUntilScanned(world, pilot)).toBeTrue();
                expect(credits(pilot)).toBe(START_CREDITS - 500);
                expect(scans[0].scan.fine).toBe(500);
                expect(record(pilot, NEIGHBOUR)).toBe(expected);
                // The scanner's own record does not move: no spread.
                expect(pilot.components.get(LegalRecordsComponent)!.has(CUSTOMS))
                    .toBeFalse();
            }
        });

    it('replays identically after a rollback', async () => {
        const { world, pilot, scans } = await scanWorld(
            { pilot: { outfits: { [POD]: 1 } } });
        while (world.queuedEventCount > 0) {
            world.step();
        }
        const before = snapshotWorld(world);
        const record_ = () => {
            const hashes: string[] = [];
            run(world, 900, () => hashes.push(hashWorld(world).hash));
            return {
                hashes, credits: credits(pilot), record: record(pilot),
                scanned: pilot.components.get(ContrabandScannedComponent)?.at,
            };
        };
        const first = record_();
        expect(first.credits).toBe(START_CREDITS - 500);
        expect(scans.length).toBe(1);
        restoreWorld(world, before, deriveEntityComponents);
        const restoredPilot = world.entities.get(PILOT)!;
        expect(restoredPilot.components.get(CreditsComponent)!.credits)
            .toBe(START_CREDITS);
        const hashes: string[] = [];
        run(world, 900, () => hashes.push(hashWorld(world).hash));
        expect(hashes).toEqual(first.hashes);
        expect(restoredPilot.components.get(CreditsComponent)!.credits)
            .toBe(first.credits);
        expect(restoredPilot.components.get(ContrabandScannedComponent)?.at)
            .toBe(first.scanned);
        expect(scans.length).toBe(2);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
});

describe('Contraband rules', () => {
    const customs = govt(CUSTOMS, { scanMask: 0x0001, scanFine: 500, smugglePenalty: 50 });
    const outfits = new Map<string, OutfitData>([
        [POD, { ...getDefaultOutfitData(), id: POD, name: 'Contraband Pod', lcName: '', scanMask: 0x8001 }],
        ['test:a', { ...getDefaultOutfitData(), id: 'test:a', name: 'Illegal Blaster; dev note', scanMask: 0x0001 }],
    ]);
    const find = (mask: number, hold: Parameters<typeof findContraband>[1]) =>
        findContraband(mask, hold, id => outfits.get(id), () => undefined);

    it('names the first illegal outfit by sorted id, from its name when '
        + 'LCName is blank', () => {
        const findings = find(0x0001, {
            outfits: new Map([[POD, { count: 1 }], ['test:a', { count: 2 }]]),
        });
        expect(findings.outfit).toEqual({ id: 'test:a', name: 'illegal blaster' });
        expect(hasContraband(findings)).toBeTrue();
        expect(find(0x0002, {
            outfits: new Map([[POD, { count: 1 }]]),
        }).outfit).toBeUndefined();
        expect(find(0x0001, {
            outfits: new Map([[POD, { count: 0 }]]),
        }).outfit).toBeUndefined();
    });

    it('fines a positive ScanFine, never more than the pilot has, and '
        + 'nothing for 0 or below (the original, not the Bible\'s %)', () => {
        expect(contrabandFine(500, 1_000_000)).toBe(500);
        expect(contrabandFine(500, 200)).toBe(200);
        expect(contrabandFine(0, 1_000_000)).toBe(0);
        expect(contrabandFine(-5, 1_000)).toBe(0);
        expect(contrabandFine(-500, 1_000)).toBe(0);
    });

    it('moves the record by the A14 rule with the scanner as the victim',
        () => {
        const owner = (extra: Partial<GovtData>) =>
            govt(NEIGHBOUR, { classes: [3], smugglePenalty: 70, ...extra });
        const scanner = govt(CUSTOMS, { classes: [7], smugglePenalty: 50 });
        const lawOf = (o: GovtData | undefined) =>
            localLaw(o?.id ?? null, id => id === o?.id ? o : undefined);
        // The owner itself: minus its SmugPenalty.
        expect(smugglingRecordChange(scanner, lawOf(scanner))).toBe(-50);
        // The owner's ally, either direction: minus the SCANNER's (guess).
        expect(smugglingRecordChange(scanner, lawOf(owner({ allies: [7] }))))
            .toBe(-50);
        expect(smugglingRecordChange(govt(CUSTOMS, {
            classes: [7], allies: [3], smugglePenalty: 50,
        }), lawOf(owner({})))).toBe(-50);
        // Unrelated (a nosy scanner): plus half the OWNER's, truncated.
        expect(smugglingRecordChange(scanner, lawOf(owner({})))).toBe(35);
        expect(smugglingRecordChange(scanner,
            lawOf(owner({ smugglePenalty: 9 })))).toBe(4);
        expect(smugglingRecordChange(scanner,
            lawOf(owner({ smugglePenalty: 0 })))).toBe(0);
        // Independent: no owner, no change (guess).
        expect(smugglingRecordChange(scanner, lawOf(undefined))).toBe(0);
    });

    it('turns only the detecting govt\'s ships on the pilot', () => {
        const self = govt(CUSTOMS, { classes: [7], crimeTol: 30000 });
        const law = localLaw(CUSTOMS, () => self);
        const records = new Map<string, number>();
        expect(govtDispositionTo(self, undefined, records, law)).toBe('neutral');
        expect(govtDispositionTo(self, undefined, records, law, false, CUSTOMS))
            .toBe('enemy');
        expect(govtDispositionTo(self, undefined, records, law, false, NEIGHBOUR))
            .toBe('neutral');
        expect(govtDispositionTo(self, undefined, records, law, true, CUSTOMS))
            .toBe('neutral');
        expect(govtDispositionTo(govt(CUSTOMS, {
            flags: { ...getDefaultGovtData().flags, neverAttacksPlayer: true },
        }), undefined, records, law, false, CUSTOMS)).toBe('neutral');
        expect(shipDisposition(self, undefined, records, law)).toBe('neutral');
        expect(shipDisposition(self, undefined, records, law, false, CUSTOMS))
            .toBe('hostile');
    });

    it('reads a negative SmugPenalty as no penalty', () => {
        expect(smugglingPenalty(govt('x', { smugglePenalty: -1 }))).toBe(0);
        expect(smugglingPenalty(govt('x', { smugglePenalty: 12 }))).toBe(12);
    });

    it('counts a cargo-less mission as illegal while active (guess)', () => {
        expect(missionIllegal(mission('m', { scanMask: 1, cargoType: -1, cargoLoaded: false }), 1))
            .toBeTrue();
        expect(missionIllegal(mission('m', { scanMask: 1, failed: true }), 1)).toBeFalse();
        expect(missionIllegal(mission('m', { scanMask: 2 }), 1)).toBeFalse();
    });

    it('charges the record of the system scanned in, once, for an outfit '
        + 'or jünk and never for mission cargo', () => {
        // An owner allied to the customs govt: the scanner's SmugPenalty
        // comes off the OWNER's record (the system's status govt).
        const owner = govt(NEIGHBOUR, { classes: [3], allies: [7] });
        const scanner = { ...customs, classes: [7] };
        const law = localLaw(NEIGHBOUR, id => id === NEIGHBOUR ? owner : undefined);
        const scan = (findings: ContrabandFindings) => {
            const records = new Map<string, number>();
            const pilot = { credits: { credits: 1000 }, records, missions: new Map() };
            const result = applyContrabandScan(findings, scanner, law, pilot);
            return { result, records, credits: pilot.credits.credits };
        };
        const both = scan({
            outfit: { id: POD, name: 'pod' }, junk: { id: 'j', name: 'junk' },
            smuggled: true, failMissions: [],
        });
        expect(both.result).toEqual({
            outfit: 'pod', junk: 'junk', smuggled: true, missionFailed: false,
            fine: 500,
        });
        expect([...both.records]).toEqual([[NEIGHBOUR, -50]]);
        expect(both.credits).toBe(500);
        const cargoOnly = scan({ smuggled: true, failMissions: [] });
        expect(cargoOnly.records.size).toBe(0);
        expect(cargoOnly.credits).toBe(500);
    });

    it('names the first illegal jünk by sorted id, by its LCName', () => {
        const junks = new Map([
            ['test:b', { ...getDefaultJunkData(), id: 'test:b', name: 'Bees', lcName: 'bees', scanMask: 1 }],
            ['test:a', { ...getDefaultJunkData(), id: 'test:a', name: 'Kit Ale', lcName: '', scanMask: 1 }],
        ]);
        const findings = findContraband(1, {
            cargo: new Map([['junk:test:b', 1], ['junk:test:a', 2], ['cargo:0', 5]]),
        }, () => undefined, id => junks.get(id));
        expect(findings.junk).toEqual({ id: 'test:a', name: 'kit ale' });
        expect(findings.smuggled).toBeFalse();
        expect(hasContraband(findings)).toBeTrue();
    });

    it('scans only where the govt enforces, and only with a ScanMask', () => {
        const self = govt(CUSTOMS, { classes: [7], scanMask: 1 });
        expect(scansHere(self, localLaw(CUSTOMS, () => self))).toBeTrue();
        expect(scansHere(self, localLaw(null, () => undefined))).toBeFalse();
        const nosy = govt(CUSTOMS, {
            scanMask: 1,
            flags: { ...getDefaultGovtData().flags, attacksPlayerIfCriminal: true },
        });
        expect(scansHere(nosy, localLaw(null, () => undefined))).toBeTrue();
        expect(scansHere(govt(CUSTOMS, { scanMask: 0 }),
            localLaw(CUSTOMS, () => self))).toBeFalse();
    });

    it('composes the stock status lines', () => {
        expect(contrabandScanMessage({
            scanner: 'Kit Customs Cutter', pilot: 'w11-scan-pod',
            outfit: 'kit contraband pod', smuggled: false,
            missionFailed: false, fine: 500,
        })).toBe('Kit Customs Cutter: w11-scan-pod, your posession of a kit '
            + 'contraband pod has been detected. You have been fined 500 credits.');
        expect(contrabandScanMessage({
            scanner: 'Kit Customs Cutter', pilot: 'w12-s2b', smuggled: true,
            missionFailed: false, fine: 500,
        })).toBe('Kit Customs Cutter: w12-s2b, your attempt to smuggle illegal '
            + 'cargo through this system has been detected. You have been '
            + 'fined 500 credits.');
        expect(contrabandScanMessage({
            scanner: 'Cutter', outfit: 'illegal blaster', smuggled: true,
            missionFailed: true, fine: 0,
        })).toBe('Cutter: your posession of an illegal blaster has been detected.');
    });
});
