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
import {
    CargoComponent, makeShip, OutfitsStateComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { LandEvent } from '../travel/index.js';
import {
    applyContrabandScan, contrabandFine, ContrabandFindings, findContraband,
    hasContraband, missionIllegal, scansHere, smugglingPenalty,
} from './contraband.js';
import { ContrabandScanEvent, ContrabandScanEventData } from './contraband_scan.js';
import { ContrabandScannedComponent } from './contraband_target.js';
import { NpcComponent } from './npc_component.js';
import { localLaw } from '../reputation/index.js';

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
    gameData.data.Junk.map.set(SMUGGLED_JUNK,
        { ...getDefaultJunkData(), id: SMUGGLED_JUNK, scanMask: 0x0001 });
    gameData.data.Junk.map.set(LEGAL_JUNK,
        { ...getDefaultJunkData(), id: LEGAL_JUNK, scanMask: 0x0004 });
    gameData.data.Govt.map.set(CUSTOMS, govt(CUSTOMS, {
        classes: [7], scanMask: 0x0001, scanFine: 500, smugglePenalty: 50,
        crimeTol: 10, ...options.customs,
    }));
    gameData.data.Govt.map.set(NEIGHBOUR, govt(NEIGHBOUR, { classes: [8] }));
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
            // -50 against CrimeTol 10: a criminal here, so the cutter
            // turns on him (the ordinary law, local_law.ts).
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

    it('treats illegal jünk like an ordinary mission\'s cargo (guess)',
        async () => {
            const { world, pilot, scans } = await scanWorld(
                { pilot: { cargo: { [`junk:${SMUGGLED_JUNK}`]: 3 } } });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(credits(pilot)).toBe(START_CREDITS - 500);
            expect(record(pilot)).toBe(0);
            expect(scans[0].scan.smuggled).toBeTrue();
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

    it('ScanFine 0 is a warning: no fine, SmugPenalty still charged '
        + '(guess)', async () => {
            const { world, pilot, scans } = await scanWorld({
                customs: { scanFine: 0, smugglePenalty: 3 },
                pilot: { outfits: { [POD]: 1 } },
            });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(credits(pilot)).toBe(START_CREDITS);
            expect(record(pilot)).toBe(-3);
            expect(contrabandScanMessage({ ...scans[0].scan, scanner: 'Cutter', pilot: 'Ace' }))
                .toBe('Cutter: Ace, your posession of a kit contraband pod has been detected.');
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
            // SmugPenalty 5 keeps the first pilot inside CrimeTol 10: a
            // criminal would draw both cutters into a fight instead.
            const { world, pilot, pilot2, scans } = await scanWorld({
                secondCutter: true, customs: { smugglePenalty: 5 },
                pilot: { outfits: { [POD]: 1 } },
                pilot2: { missions: [mission('test:p2', { scanMask: 1 })], credits: 2000 },
            });
            expect(runUntilScanned(world, pilot)).toBeTrue();
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

    it('scans again after a landing or a new system (a new visit; guess)',
        async () => {
            const { world, pilot } = await scanWorld(
                { customs: { smugglePenalty: 0 }, pilot: { outfits: { [POD]: 1 } } });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            world.emit(LandEvent, { id: 'test:planet', uuid: 'stellar' }, [PILOT]);
            world.step();
            expect(pilot.components.has(ContrabandScannedComponent)).toBeFalse();
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(credits(pilot)).toBe(START_CREDITS - 1000);

            prepareCarriedEntitiesForFreshWorld(pilot, PILOT, []);
            expect(pilot.components.has(ContrabandScannedComponent)).toBeFalse();
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

    it('fines per the Bible\'s ScanFine table, never more than the pilot '
        + 'has', () => {
        expect(contrabandFine(500, 1_000_000)).toBe(500);
        expect(contrabandFine(500, 200)).toBe(200);
        expect(contrabandFine(0, 1_000_000)).toBe(0);
        expect(contrabandFine(-5, 1_000)).toBe(50);
        expect(contrabandFine(-5, 1_019)).toBe(50);
        expect(contrabandFine(-500, 1_000)).toBe(1_000);
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

    it('charges SmugPenalty to the record of the system scanned in', () => {
        const owner = govt(NEIGHBOUR, { classes: [3] });
        const law = localLaw(NEIGHBOUR, id => id === NEIGHBOUR ? owner : undefined);
        const records = new Map<string, number>();
        const pilot = { credits: { credits: 1000 }, records, missions: new Map() };
        const findings: ContrabandFindings = {
            outfit: { id: POD, name: 'pod' }, smuggled: false, failMissions: [],
        };
        expect(applyContrabandScan(findings, customs, law, pilot)).toEqual({
            outfit: 'pod', smuggled: false, missionFailed: false, fine: 500,
        });
        expect(records.get(NEIGHBOUR)).toBe(-50);
        expect(records.has(CUSTOMS)).toBeFalse();
        expect(pilot.credits.credits).toBe(500);
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
