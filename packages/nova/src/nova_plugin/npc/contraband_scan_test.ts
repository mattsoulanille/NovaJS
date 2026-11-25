import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { getDefaultJunkData } from 'novadatainterface/junk_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
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
    applyContrabandScan, CONTRABAND_SCAN_RANGE,
    CONTRABAND_SIT_LEASH, CONTRABAND_SIT_RADIUS,
    contrabandFine, ContrabandFindings, findContraband, hasContraband,
    missionIllegal, newContraband, scansHere, smugglingPenalty,
    smugglingRecordChange, statedFine,
} from './contraband.js';
import { ContrabandScanEvent, ContrabandScanEventData } from './contraband_scan.js';
import { ContrabandScannedComponent, flownOff } from './contraband_target.js';
import { NpcComponent } from './npc_component.js';
import { FormationComponent, offFormationBusiness } from './npc_formation.js';
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
/** A fleet's lead and its AI 4 escort: stock Aurora Cruiser (shïp
 * nova:300 class: slow) and Firebird (nova:155: 225 px/s, 144 px/s^2,
 * 240°/s) physics. */
const LEAD_HULL = 'test:cruiser';
const ESCORT_HULL = 'test:firebird';
const POD = 'test:pod';
const LEGAL_GUN = 'test:legal';
const SMUGGLED_JUNK = 'test:junk';
const LEGAL_JUNK = 'test:junk-legal';
const CUTTER = 'npc:cutter';
const CUTTER_2 = 'npc:cutter2';
const FLEET_LEADER = 'npc:fleet-lead';
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
    /** The interceptor is a FLEET ESCORT: it holds formation slot 0 on
     * an AI 3 leader of its govt (FLEET_LEADER) at (-200, 0), as a stock
     * Heraan Firebird does on its Aurora Cruiser. */
    fleetLeader?: boolean;
}

async function scanWorld(options: WorldOptions = {}) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(CUTTER_HULL, { ...getDefaultShipData(), id: CUTTER_HULL });
    gameData.data.Ship.map.set(PLAYER_HULL, { ...getDefaultShipData(), id: PLAYER_HULL });
    const hull = (id: string, physics: Partial<ShipData['physics']>) => {
        const base = getDefaultShipData();
        gameData.data.Ship.map.set(id,
            { ...base, id, physics: { ...base.physics, ...physics } });
    };
    hull(LEAD_HULL, { speed: 60, acceleration: 40, turnRate: Math.PI / 3 });
    hull(ESCORT_HULL,
        { speed: 225, acceleration: 144, turnRate: 4 * Math.PI / 3 });
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
        addShip(uuid, options.fleetLeader ? ESCORT_HULL : CUTTER_HULL,
            new Position(x, 0), ship => {
                ship.components.set(NpcComponent, { aiType: 4 });
                ship.components.set(GovtComponent, { id: CUSTOMS });
            });

    const pilot = await addPilot(PILOT, 900, options.pilot);
    const pilot2 = options.pilot2
        ? await addPilot(PILOT_2, -900, options.pilot2) : undefined;
    const leader = options.fleetLeader
        ? await addShip(FLEET_LEADER, LEAD_HULL, new Position(-200, 0),
            ship => {
                ship.components.set(NpcComponent, { aiType: 3 });
                ship.components.set(GovtComponent, { id: CUSTOMS });
            })
        : undefined;
    const cutter = await addCutter(CUTTER, 0);
    if (leader) {
        cutter.components.set(FormationComponent,
            { leader: FLEET_LEADER, slot: 0 });
    }
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
    return { world, gameData, pilot, pilot2, cutter, leader, scans };
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
/** The pilot's record in the scan's system (records are per system, ruling
 * #380: whoever owns it, the scan changes this one key). */
const record = (ship: Entity) =>
    ship.components.get(LegalRecordsComponent)!.get(SYSTEM) ?? 0;
/** The systems the pilot holds a record for: never more than the scan's
 * own, since smuggling does not spread. */
const recordSystems = (ship: Entity) =>
    [...ship.components.get(LegalRecordsComponent)!.keys()];

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

    it('approaches a CLEAN ship too, says nothing, and sits on it for the '
        + 'whole visit (A14 / contraband wave 16, w16_clean_several; '
        + 'Contraband / W1 / C1 wave 18, w17_scan_clean: 8+ minutes)',
        async () => {
            const { world, pilot, cutter, scans } = await scanWorld({
                pilot: {
                    outfits: { [LEGAL_GUN]: 2 },
                    cargo: { [`junk:${LEGAL_JUNK}`]: 5, 'cargo:0': 10 },
                    missions: [mission('test:legal-mission', { scanMask: 0x0002 })],
                },
            });
            const npc = () => cutter.components.get(NpcComponent)!;
            const now = () => world.resources.get(TimeResource)!.time;
            const gap = () => cutter.components.get(MovementStateComponent)!
                .position.subtract(pilot.components
                    .get(MovementStateComponent)!.position).length;
            expect(npc().mode).toBe('scan');
            expect(npc().scanTarget).toBe(PILOT);
            expect(runUntilScanned(world, pilot)).toBeTrue();
            const marker = pilot.components.get(ContrabandScannedComponent)!;
            expect(marker.found).toBeUndefined();
            expect(marker.hostile).toBeUndefined();
            // It stays on the ship, in mode 'scan', for the whole visit:
            // once it has braked from its run in, within scan range, and
            // then settled close beside the pilot (the reference cutters sat
            // 23-51 px off, not moving, from 20 s to the end of an 8.5 min
            // watch; the old 30 s hold is gone).
            const watch = 9 * 60_000;
            let settling = 0;
            let settled = 0;
            while (now() < marker.at + watch) {
                world.step();
                expect(npc().mode).toBe('scan');
                expect(npc().scanTarget).toBe(PILOT);
                if (now() > marker.at + 20_000) {
                    settled = Math.max(settled, gap());
                } else if (now() > marker.at + 5000) {
                    settling = Math.max(settling, gap());
                }
            }
            expect(settling).toBeLessThanOrEqual(CONTRABAND_SCAN_RANGE);
            expect(settled).toBeLessThanOrEqual(4 * CONTRABAND_SIT_RADIUS);
            // Nothing was ever said or charged, and it was scanned once.
            expect(credits(pilot)).toBe(START_CREDITS);
            expect(record(pilot)).toBe(0);
            expect(scans).toEqual([]);
            expect(pilot.components.get(ContrabandScannedComponent)!.at)
                .toBe(marker.at);

            // The ship LEAVES the world (a landing or a jump): the cutter
            // lets go and goes back to its patrol.
            world.entities.delete(PILOT);
            run(world, 120);
            expect(npc().mode).not.toBe('scan');
            expect(npc().scanTarget).toBeUndefined();
            // Back after a landing (the marker survives it): not due a
            // scan, so not approached again (GUESS: unmeasured).
            world.entities.set(PILOT, pilot);
            const later = new Set<string | undefined>();
            run(world, 1200, () => later.add(npc().mode));
            expect(later.has('scan')).toBeFalse();
        });

    it('does NOT follow a scanned clean ship that flies off: it holds its '
        + 'spot, lets go, and does not come after him (Contraband / rescue '
        + '/ A14, wave 19)', async () => {
            const { world, pilot, cutter } = await scanWorld();
            expect(runUntilScanned(world, pilot)).toBeTrue();
            run(world, 600);
            const npc = () => cutter.components.get(NpcComponent)!;
            expect(npc().scanSatOn).toBe(PILOT);
            const movement = () =>
                pilot.components.get(MovementStateComponent)!;
            const cutterAt = () =>
                cutter.components.get(MovementStateComponent)!.position;
            const gap = () => cutterAt().subtract(movement().position).length;
            const spot = cutterAt();
            // The pilot flies 4000 px off at 120 px/s (the reference pilot
            // flew 2,700 px north), then stops.
            let releasedAt: number | undefined;
            let drift = 0;
            for (let i = 0; i < 2000; i++) {
                const { position } = movement();
                pilot.components.set(MovementStateComponent, {
                    ...movement(),
                    position: new Position(position.x + 2, position.y),
                    velocity: new Vector(120, 0),
                });
                world.step();
                if (releasedAt === undefined && npc().mode !== 'scan') {
                    releasedAt = gap();
                }
                if (releasedAt === undefined) {
                    // How far it moved after him while it still sat.
                    drift = Math.max(drift, cutterAt().subtract(spot).length);
                }
            }
            // It let go once he was past the leash, from about where it sat:
            // it crept after him no faster than CONTRABAND_SIT_SPEED.
            expect(releasedAt).toBeDefined();
            expect(releasedAt!).toBeGreaterThan(CONTRABAND_SIT_LEASH);
            expect(npc().scanTarget).toBeUndefined();
            expect(npc().scanSatOn).toBeUndefined();
            pilot.components.set(MovementStateComponent, {
                ...movement(), velocity: new Vector(0, 0),
            });
            // Nothing comes after him (the reference watched 50 s more).
            const modes = new Set<string | undefined>();
            run(world, 3600, () => modes.add(npc().mode));
            expect(modes.has('scan')).toBeFalse();
            expect(npc().scanTarget).toBeUndefined();
            // Until it let go it stayed by its spot: no chase (he flew
            // past the leash in about 2.5 s; 20 px/s at most after him).
            expect(drift).toBeLessThan(100);
        });

    it('a FLEET ESCORT does not scan: it stays in formation on its lead, '
        + 'even beside a pilot carrying a ScanMask pod (Fleet escort scans, '
        + 'wave 23)', async () => {
            const { world, pilot, cutter, leader, scans } = await scanWorld(
                { fleetLeader: true, pilot: { outfits: { [POD]: 1 } } });
            const npc = () => cutter.components.get(NpcComponent)!;
            const at = (ship: Entity) =>
                ship.components.get(MovementStateComponent)!.position;
            // The reference fleet parked 10-40 px from the pod pilot for
            // 10-15 s a visit, three visits: put the lead right beside him
            // so the escort's slot is well inside scan range.
            leader!.components.set(MovementStateComponent, {
                ...leader!.components.get(MovementStateComponent)!,
                position: new Position(850, 0),
            });
            let farthest = 0;
            const modes = new Set<string | undefined>();
            run(world, 60 * 60, () => {
                modes.add(npc().mode);
                if (world.resources.get(TimeResource)!.time > 10_000) {
                    farthest = Math.max(farthest,
                        at(cutter).subtract(at(leader!)).length);
                }
            });
            expect(modes.has('scan')).toBeFalse();
            expect(npc().scanTarget).toBeUndefined();
            // It held its slot behind the lead (the reference escorts sat
            // 10-60 px off it) once it had formed up.
            expect(farthest).toBeLessThan(150);
            // No scan, no fine, no record change, no status line.
            expect(pilot.components.has(ContrabandScannedComponent))
                .toBeFalse();
            expect(scans).toEqual([]);
            expect(credits(pilot)).toBe(START_CREDITS);
            expect(record(pilot)).toBe(0);
        });

    it('a fleet escort whose LEAD is gone is a lone interceptor again and '
        + 'scans (GUESS: no reference run lost a lead)', async () => {
            const { world, pilot, cutter, scans } = await scanWorld(
                { fleetLeader: true, pilot: { outfits: { [POD]: 1 } } });
            const npc = () => cutter.components.get(NpcComponent)!;
            run(world, 120);
            expect(npc().mode).not.toBe('scan');
            world.entities.delete(FLEET_LEADER);
            run(world, 2);
            expect(npc().mode).toBe('scan');
            expect(npc().scanTarget).toBe(PILOT);
            expect(runUntilScanned(world, pilot, 10 * 60)).toBeTrue();
            expect(scans.length).toBe(1);
            expect(credits(pilot)).toBe(START_CREDITS - 500);
        });

    it('exactly one of the formation keeper and the NPC steering flies an '
        + 'escort, whatever its mode', () => {
            for (const mode of ['attack', 'flee', 'depart', 'board', 'scan']) {
                expect(offFormationBusiness(mode)).withContext(mode).toBeTrue();
            }
            for (const mode of [undefined, 'patrol', 'travel', 'dwell',
                'mine', 'scoop']) {
                expect(offFormationBusiness(mode)).withContext(String(mode))
                    .toBeFalse();
            }
        });

    it('the leash only binds an interceptor that has come up to the ship '
        + '(flownOff)', () => {
            const far = (CONTRABAND_SIT_LEASH + 1) ** 2;
            const near = (CONTRABAND_SIT_LEASH - 1) ** 2;
            // Settled on it: let go past the leash, not inside it.
            expect(flownOff(PILOT, PILOT, far)).toBeTrue();
            expect(flownOff(PILOT, PILOT, near)).toBeFalse();
            // Still closing (another cutter scanned it, or it is on its
            // way): any distance.
            expect(flownOff(PILOT, undefined, far)).toBeFalse();
            expect(flownOff(PILOT, PILOT_2, far)).toBeFalse();
            expect(flownOff(undefined, undefined, far)).toBeFalse();
        });

    it('a sitting cutter still buzzes a second pilot due a scan, then sits '
        + 'on him', async () => {
            const { world, pilot, pilot2, cutter } = await scanWorld({
                pilot2: {},
            });
            const npc = () => cutter.components.get(NpcComponent)!;
            expect(runUntilScanned(world, pilot)
                || pilot2!.components.has(ContrabandScannedComponent))
                .toBeTrue();
            const first = npc().scanTarget;
            const second = first === PILOT ? pilot2! : pilot;
            expect(runUntilScanned(world, second, 3600)).toBeTrue();
            run(world, 1800);
            expect(npc().mode).toBe('scan');
            expect(npc().scanTarget).not.toBe(first);
        });

    it('an aggressor pulls a sitting cutter off the clean ship it sits on '
        + '(piracy policing still wins)', async () => {
            const { world, pilot, cutter } = await scanWorld({ pilot2: {} });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            run(world, 600);
            const npc = cutter.components.get(NpcComponent)!;
            expect(npc.mode).toBe('scan');
            // The second pilot shot a ship in front of this nosy police
            // (piracy_police.ts's witness rule records him as its
            // aggressor, exactly as a hit on it would).
            npc.aggressor = PILOT_2;
            npc.aggressorSince = world.resources.get(TimeResource)!.time;
            run(world, 120);
            expect(npc.mode).toBe('attack');
            expect(cutter.components.get(TargetComponent)?.target)
                .toBe(PILOT_2);
        });

    it('a cutter that is only passing through does not sit past its '
        + 'departure time', async () => {
            const { world, pilot, cutter } = await scanWorld();
            const npc = cutter.components.get(NpcComponent)!;
            npc.passingThrough = true;
            npc.departAt = Number.MAX_SAFE_INTEGER;
            expect(runUntilScanned(world, pilot)).toBeTrue();
            run(world, 600);
            expect(npc.mode).toBe('scan');
            npc.departAt = world.resources.get(TimeResource)!.time;
            const modes = new Set<string | undefined>();
            run(world, 600, () => modes.add(npc.mode));
            expect(modes.has('depart')).toBeTrue();
        });

    it('fails a 0x0020 mission whose cargo is illegal, with no fine and no '
        + 'record change (S2a)', async () => {
            const flagged = mission('test:s2a', { scanMask: 1, failIfScanned: true });
            const { world, pilot, scans } = await scanWorld(
                { pilot: { missions: [flagged] } });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            const missions = pilot.components.get(MissionsComponent)!;
            expect(missions.get('test:s2a')!.failed).toBeTrue();
            // Marked as a scan failure, which costs no CompReward at the
            // next date advance (mission_reputation_test.ts).
            expect(missions.get('test:s2a')!.failCause).toBe('scan');
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
            // w14_s3_clean: a clean ship carrying it is never fined or
            // failed (scanned, silently: "A14 / contraband wave 16").
            const clean = await scanWorld({ pilot: { missions: [drop()] } });
            run(clean.world, 600);
            expect(clean.pilot.components.get(MissionsComponent)!
                .get('test:s3')!.failed).toBeUndefined();
            expect(credits(clean.pilot)).toBe(START_CREDITS);
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
        const { world, pilot, scans } = await scanWorld(
            { pilot: { missions: [later] } });
        // Scanned as a clean ship (wave 16): nothing found, nothing said.
        expect(runUntilScanned(world, pilot)).toBeTrue();
        run(world, 600);
        expect(pilot.components.get(ContrabandScannedComponent)!.found)
            .toBeUndefined();
        expect(pilot.components.get(MissionsComponent)!.get('test:later')!
            .failed).toBeUndefined();
        expect(scans).toEqual([]);
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
            pilot.components.get(LegalRecordsComponent)!.set(SYSTEM, -500);
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
            // The marker stays (its hostility gone) with what it found: no
            // second fine.
            expect(pilot.components.get(ContrabandScannedComponent))
                .toEqual({ at: scannedAt, found: [`outfit:${POD}`] });
            expect(credits(pilot)).toBe(START_CREDITS - 500);

            // A crossing into a fresh world is a new visit.
            prepareCarriedEntitiesForFreshWorld(pilot, PILOT, []);
            expect(pilot.components.has(ContrabandScannedComponent)).toBeFalse();
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(credits(pilot)).toBe(START_CREDITS - 1000);
        });

    it('rescans after a landing only for NEW contraband, and names the jünk '
        + 'of several finds (w15_several, w14_s3_pod)', async () => {
            const { world, pilot, scans } = await scanWorld({
                customs: { crimeTol: 30000 },
                pilot: { outfits: { [POD]: 1 } },
            });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(credits(pilot)).toBe(START_CREDITS - 500);
            expect(record(pilot)).toBe(-50);

            // Landed: a ScanMask-0 mission is nothing new (w14_s3_pod).
            world.emit(LandEvent, { id: 'test:planet', uuid: 'stellar' }, [PILOT]);
            run(world, 2);
            pilot.components.get(MissionsComponent)!.set('test:s3',
                mission('test:s3', { scanMask: 0, failIfScanned: true }));
            run(world, 900);
            expect(scans.length).toBe(1);
            expect(credits(pilot)).toBe(START_CREDITS - 500);

            // Landed again: bought illegal jünk and took a 0x0020 mission
            // with illegal cargo (w15_several). Takes off: scanned again.
            world.emit(LandEvent, { id: 'test:planet', uuid: 'stellar' }, [PILOT]);
            run(world, 2);
            pilot.components.set(CargoComponent, new Map([
                [`junk:${SMUGGLED_JUNK}`, 10], ['mission:test:food', 1]]));
            pilot.components.get(MissionsComponent)!.set('test:food',
                mission('test:food', {
                    cargoType: 0, scanMask: 1, failIfScanned: true,
                }));
            run(world, 900);
            expect(scans.length).toBe(2);
            const rescan = scans[1].scan;
            // One fine, one record change, the jünk named over the pod,
            // and the 0x0020 mission failed with no line of its own.
            expect(rescan).toEqual({
                scanner: CUTTER, outfit: 'kit contraband pod',
                junk: 'kit contraband', smuggled: false, missionFailed: true,
                fine: 500,
            });
            expect(contrabandScanMessage({
                ...rescan, scanner: 'Kit Customs Cutter', pilot: 'w15-several',
            })).toBe('Kit Customs Cutter: w15-several, your attempt to smuggle '
                + 'kit contraband through this system has been detected. You '
                + 'have been fined 500 credits.');
            expect(credits(pilot)).toBe(START_CREDITS - 1000);
            expect(record(pilot)).toBe(-100);
            expect(pilot.components.get(MissionsComponent)!.get('test:food')!
                .failed).toBeTrue();
            expect(pilot.components.get(ContrabandScannedComponent)?.found)
                .toEqual([`junk:${SMUGGLED_JUNK}`, `outfit:${POD}`,
                    'mission:test:food'].sort());
            // Nothing new since: no third scan.
            world.emit(LandEvent, { id: 'test:planet', uuid: 'stellar' }, [PILOT]);
            run(world, 900);
            expect(scans.length).toBe(2);
        });

    it('an ally of the owner scanning charges ITS OWN SmugPenalty '
        + '(w15_scan_ally)', async () => {
            // 321 Kit Smug Ally Owner (SmugPenalty 70, no ScanMask) owns
            // the system; its ally 320 Kit Customs Ally (Smug 50) scans.
            const { world, pilot, scans } = await scanWorld({
                customs: { crimeTol: 30000 }, systemGovt: NEIGHBOUR,
                neighbour: { smugglePenalty: 70, allies: [7] },
                pilot: { outfits: { [POD]: 1 } },
            });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(scans.map(s => s.scan)).toEqual([{
                scanner: CUTTER, outfit: 'kit contraband pod', smuggled: false,
                missionFailed: false, fine: 500,
            }]);
            expect(credits(pilot)).toBe(START_CREDITS - 500);
            expect(record(pilot)).toBe(-50);
            expect(recordSystems(pilot)).toEqual([SYSTEM]);
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
                expect(record(pilot)).toBe(expected);
                // The scanner's own system does not move: no spread.
                expect(recordSystems(pilot))
                    .toEqual(expected === 0 ? [] : [SYSTEM]);
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
        // The line names the whole ScanFine, whatever was taken.
        expect(statedFine(5000)).toBe(5000);
        expect(statedFine(0)).toBe(0);
        expect(statedFine(-5)).toBe(0);
    });

    it('a fine above the pilot\'s cash takes all of it and no more, and the '
        + 'line names the WHOLE ScanFine with a separator (A14 / contraband '
        + 'wave 16, w16_bigfine)', async () => {
            const { world, pilot, scans } = await scanWorld({
                customs: { scanFine: 5000 },
                pilot: { outfits: { [POD]: 1 }, credits: 1200 },
            });
            expect(runUntilScanned(world, pilot)).toBeTrue();
            expect(credits(pilot)).toBe(0);
            expect(record(pilot)).toBe(-50);
            expect(scans.map(s => s.scan.fine)).toEqual([5000]);
            expect(contrabandScanMessage({
                ...scans[0].scan, scanner: 'Kit Customs Cutter',
                pilot: 'w16-bigfine',
            })).toBe('Kit Customs Cutter: w16-bigfine, your posession of a '
                + 'kit contraband pod has been detected. You have been fined '
                + '5,000 credits.');
        });

    it('moves the record by the A14 rule with the scanner as the victim',
        () => {
        const owner = (extra: Partial<GovtData>) =>
            govt(NEIGHBOUR, { classes: [3], smugglePenalty: 70, ...extra });
        const scanner = govt(CUSTOMS, { classes: [7], smugglePenalty: 50 });
        const lawOf = (o: GovtData | undefined) =>
            localLaw(SYSTEM, o?.id ?? null, id => id === o?.id ? o : undefined);
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
        const law = localLaw(SYSTEM, CUSTOMS, () => self);
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
        // comes off the record IN THIS SYSTEM (per system, ruling #380).
        const owner = govt(NEIGHBOUR, { classes: [3], allies: [7] });
        const scanner = { ...customs, classes: [7] };
        const law = localLaw(SYSTEM, NEIGHBOUR,
            id => id === NEIGHBOUR ? owner : undefined);
        const scan = (findings: ContrabandFindings) => {
            const records = new Map<string, number>();
            const pilot = { credits: { credits: 1000 }, records, missions: new Map() };
            const result = applyContrabandScan(findings, scanner, law, pilot);
            return { result, records, credits: pilot.credits.credits };
        };
        const both = scan({
            outfit: { id: POD, name: 'pod' }, junk: { id: 'j', name: 'junk' },
            smuggled: true, failMissions: [],
            items: [`outfit:${POD}`, 'junk:j', 'mission:m'],
        });
        expect(both.result).toEqual({
            outfit: 'pod', junk: 'junk', smuggled: true, missionFailed: false,
            fine: 500, taken: 500,
        });
        expect([...both.records]).toEqual([[SYSTEM, -50]]);
        expect(both.credits).toBe(500);
        const cargoOnly = scan({
            smuggled: true, failMissions: [], items: ['mission:m'],
        });
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
        expect(scansHere(self, localLaw(SYSTEM, CUSTOMS, () => self))).toBeTrue();
        expect(scansHere(self, localLaw(SYSTEM, null, () => undefined))).toBeFalse();
        const nosy = govt(CUSTOMS, {
            scanMask: 1,
            flags: { ...getDefaultGovtData().flags, attacksPlayerIfCriminal: true },
        });
        expect(scansHere(nosy, localLaw(SYSTEM, null, () => undefined))).toBeTrue();
        expect(scansHere(govt(CUSTOMS, { scanMask: 0 }),
            localLaw(SYSTEM, CUSTOMS, () => self))).toBeFalse();
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
            scanner: 'Cutter', outfit: 'illegal blaster', smuggled: false,
            missionFailed: true, fine: 0,
        })).toBe('Cutter: your posession of an illegal blaster has been detected.');
    });

    it('names the hold\'s cargo before an outfit of several finds: the '
        + 'jünk (w15_several), then "illegal cargo" (guess)', () => {
        expect(contrabandScanMessage({
            scanner: 'Cutter', outfit: 'kit contraband pod',
            junk: 'kit contraband', smuggled: true, missionFailed: true,
            fine: 500,
        })).toBe('Cutter: your attempt to smuggle kit contraband through this '
            + 'system has been detected. You have been fined 500 credits.');
        expect(contrabandScanMessage({
            scanner: 'Cutter', outfit: 'illegal blaster', smuggled: true,
            missionFailed: false, fine: 0,
        })).toBe('Cutter: your attempt to smuggle illegal cargo through this '
            + 'system has been detected.');
    });

    it('lists every illegal thing found, and tells new finds from old',
        () => {
        const junks = new Map([['test:j', {
            ...getDefaultJunkData(), id: 'test:j', lcName: 'j', scanMask: 1,
        }]]);
        const findings = findContraband(0x0001, {
            outfits: new Map([[POD, { count: 1 }], ['test:a', { count: 2 }]]),
            cargo: new Map([['junk:test:j', 3]]),
            missions: new Map([
                ['test:m', mission('test:m', { scanMask: 1 })],
                ['test:f', mission('test:f', { scanMask: 1, failIfScanned: true })],
                ['test:legal', mission('test:legal', { scanMask: 2 })],
            ]),
        }, id => outfits.get(id), id => junks.get(id));
        expect(findings.items).toEqual(['junk:test:j', 'mission:test:f',
            'mission:test:m', 'outfit:test:a', `outfit:${POD}`]);
        // The named outfit is still the first by sorted id.
        expect(findings.outfit?.id).toBe('test:a');
        expect(newContraband(findings, undefined)).toEqual(findings.items);
        expect(newContraband(findings, ['outfit:test:a', `outfit:${POD}`]))
            .toEqual(['junk:test:j', 'mission:test:f', 'mission:test:m']);
        expect(newContraband(findings, findings.items)).toEqual([]);
    });
});
