/**
 * Headless benchmark for submunition-heavy weapons (e.g. the plug-in
 * "Hex Trap Missile", whose one shot expands to ~9000 spawned entities
 * over a 378-deep expiry chain — see the census in the perf report).
 *
 * Builds a real simulation world (makeSystem, real plug-in game data,
 * npcs off for a controlled battlefield), fires a chosen weapon from a
 * real ship on a fixed schedule, and measures wall time per World.step
 * (distribution, not just mean — the spike when a tree detonates
 * matters) plus entity counts.
 *
 * It also prints a GOLDEN HASH: the world is seeded per system id and
 * the firing schedule is scripted, so the stream of world-state hashes
 * is a pure function of the code. Run before and after an optimization;
 * identical hashes prove the optimization is behavior-preserving.
 *
 * It also takes a CENSUS: the projectiles (and beams) alive after each step
 * (peak) and every projectile ever seen per weapon id (what the shots
 * expanded to). The engine limits (combat/engine_limits.ts) bound the
 * peak: under `--rule original` 128 projectiles, e.g. the Alternate
 * Missles "DVrger missile" (one shot = 1 + 36 x wëap 303 + 72 x wëap 299)
 * held down:
 *   node scripts/submunition_benchmark.mjs --weapon 'Alternate Missles:298' \
 *       --steps 600 --fire-every 2 --shots 300 --quiet --rule original
 *
 * Usage (from packages/nova, after `npm run build`):
 *   node scripts/submunition_benchmark.mjs
 *   node scripts/submunition_benchmark.mjs --weapon 'Gravitron Weapons:359' \
 *       --steps 1500 --fire-every 100 --shots 6 [--json] [--quiet]
 *   [--rule original|novajs]  the room's `limits` rule (default novajs)
 *   [--caps soft,hard,budget] override the NovaJS shot caps and family
 *                             budget (a sweep; `inf` for no limit)
 *   [--beam-caps soft,hard]   override the NovaJS beam caps
 *   [--volley K]              fire K shots on each firing step (default 1)
 *   --weapon replicator       a synthetic cheat weapon: subs into 5 copies
 *                             of itself, fire-at-nearest, SubLimit 9999
 *   --weapon <a beam wëap>    beams: --volley K --fire-every 1 sustains
 *                             about K x (beam life in ticks) beams
 * Profile:
 *   node --cpu-prof --cpu-prof-dir=/tmp/prof scripts/submunition_benchmark.mjs
 */
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { NovaParse } from 'novaparse';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { hashWorld, fnv1a } from 'nova_ecs/plugins/world_hash';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { GameDataAggregator } from '../dist/src/server/parsing/game_data_aggregator.js';
import { FilesystemData } from '../dist/src/server/parsing/filesystem_data.js';
import { completeEntity, loadWeaponsGameData } from '../dist/src/nova_plugin/spawn/entity_data_loader.js';
import { makeShip } from '../dist/src/nova_plugin/ship/make_ship.js';
import { makeSystem } from '../dist/src/nova_plugin/make_system.js';
import { WeaponEntries } from '../dist/src/nova_plugin/combat/fire_weapon_plugin.js';
import { ProjectileComponent } from '../dist/src/nova_plugin/core/projectile_data.js';
import { TargetComponent } from '../dist/src/nova_plugin/ship/target_component.js';
import { ArmorComponent, ShieldComponent } from '../dist/src/nova_plugin/ship/health_plugin.js';
import { applyRoomRules } from '../dist/src/nova_plugin/core/room_rules.js';
import { ENGINE_LIMITS } from '../dist/src/nova_plugin/core/engine_limits.js';
import { BeamDataComponent } from '../dist/src/nova_plugin/combat/beam_plugin.js';

const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const WEAPON_ID = argValue('--weapon', 'Alternate Missles:292');
const STEPS = Number(argValue('--steps', '1500'));
const FIRE_EVERY = Number(argValue('--fire-every', '100'));
const SHOTS = Number(argValue('--shots', '6'));
const HASH_EVERY = Number(argValue('--hash-every', '300'));
const JSON_OUT = args.includes('--json');
const QUIET = args.includes('--quiet');
const RULE = argValue('--rule', 'novajs');
const VOLLEY = Number(argValue('--volley', '1'));
const parseCap = value => value === 'inf' ? Infinity : Number(value);
const CAPS = argValue('--caps', undefined)?.split(',').map(parseCap);
const BEAM_CAPS = argValue('--beam-caps', undefined)?.split(',').map(parseCap);
if (CAPS) {
    // The table is a plain object at run time: a sweep rewrites it.
    ENGINE_LIMITS.novajs.shots.soft = CAPS[0];
    ENGINE_LIMITS.novajs.shots.hard = CAPS[1] ?? CAPS[0];
    if (CAPS[2] !== undefined) {
        ENGINE_LIMITS.novajs.familyBudget = CAPS[2];
    }
}
if (BEAM_CAPS) {
    ENGINE_LIMITS.novajs.beams.soft = BEAM_CAPS[0];
    ENGINE_LIMITS.novajs.beams.hard = BEAM_CAPS[1] ?? BEAM_CAPS[0];
}

/**
 * The synthetic cheat weapon (Matthew: "subs into 5 copies of self; subs
 * fire at nearest target; sub limit 9999"), built on a stock gun's data.
 */
const REPLICATOR_ID = 'bench:replicator';
const REPLICATOR_BASE = argValue('--replicator-base', 'nova:128');
function withReplicator(aggregator, base) {
    const replicator = {
        ...base,
        id: REPLICATOR_ID,
        name: 'Bench Replicator',
        shotDuration: 500,
        submunitions: [{
            id: REPLICATOR_ID, count: 5, theta: 0.5, limit: 9999,
            fireAtNearest: true, subIfExpire: true,
        }],
    };
    const weapons = aggregator.data.Weapon;
    // Everything else (the cache the wire's sprite references are read
    // from, among others) is the real table's.
    const Weapon = new Proxy(weapons, {
        get(target, key) {
            if (key === 'get') {
                return id => id === REPLICATOR_ID
                    ? Promise.resolve(replicator) : target.get(id);
            }
            if (key === 'getCached') {
                return id => id === REPLICATOR_ID ? replicator
                    : target.getCached(id);
            }
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const data = new Proxy(aggregator.data, {
        get: (target, key, receiver) => key === 'Weapon' ? Weapon
            : Reflect.get(target, key, receiver),
    });
    return new Proxy(aggregator, {
        get(target, key) {
            if (key === 'data') {
                return data;
            }
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

// nova:226 (Ver'ashan): asteroid-free, a controlled battlefield (same
// choice as the firing-group and bay-escort integration specs).
const SYSTEM_ID = argValue('--system', 'nova:226');
const SHIP_ID = argValue('--ship', 'nova:128'); // Shuttle

const packageRoot = process.cwd();

async function getGameData() {
    // Unlike the test fixture, plug-ins ARE loaded: the offending
    // weapons live in them.
    const novaParse = new NovaParse(path.join(packageRoot, 'Nova_Data'), false);
    novaParse.resourceNotFoundFunction = () => { };
    const aggregator = new GameDataAggregator([
        new FilesystemData(path.join(packageRoot, 'objects')),
        novaParse,
    ], () => { });
    aggregator.getSettings = async (file) => JSON.parse(
        await fs.promises.readFile(path.join(packageRoot, 'settings', file), 'utf8'));
    return aggregator;
}

function quantile(sorted, q) {
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[idx];
}

async function main() {
    let gameData = await getGameData();
    const weaponId = WEAPON_ID === 'replicator' ? REPLICATOR_ID : WEAPON_ID;
    if (weaponId === REPLICATOR_ID) {
        gameData = withReplicator(gameData,
            await gameData.data.Weapon.get(REPLICATOR_BASE));
    }
    const world = await makeSystem(SYSTEM_ID, gameData, undefined, { npcs: false });
    applyRoomRules(world, { limits: RULE });

    const shipData = await gameData.data.Ship.get(SHIP_ID);
    const ship = makeShip(shipData);
    ship.components.set(MultiplayerData, { owner: 'server' });
    await completeEntity(world, ship);
    ship.components.set(MovementStateComponent, {
        position: new Position(2000, 2000),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        accelerating: 0,
        turning: 0,
        turnBack: false,
    });
    world.entities.set('shooter', ship);

    // A victim ship 600px downrange: guided offenders (Hex Trap,
    // Graviton Torpedo) only submunition on DETONATION (subIfExpire is
    // false on the first hop), so without a target the tree never
    // expands. Its health is refilled and its position re-pinned every
    // step (scripted input, deterministic) so it survives the run and
    // the geometry stays fixed.
    const victimData = await gameData.data.Ship.get(SHIP_ID);
    const victim = makeShip(victimData);
    victim.components.set(MultiplayerData, { owner: 'server' });
    await completeEntity(world, victim);
    world.entities.set('victim', victim);
    ship.components.set(TargetComponent, { target: 'victim' });
    function pinVictim() {
        victim.components.set(MovementStateComponent, {
            position: new Position(2600, 2000),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        for (const stat of [victim.components.get(ArmorComponent),
                            victim.components.get(ShieldComponent)]) {
            if (stat) stat.current = stat.max;
        }
    }
    pinVictim();

    // Staged, not bare-got: the whole submunition closure (shot sprites,
    // hurtboxes) must be cached before the sim spawns any of it — a
    // simulation world throws CacheMissError on an unstaged projectile.
    // The replicator borrows its base gun's sprite, whose wire reference
    // names the base: stage that too.
    await loadWeaponsGameData(world, weaponId === REPLICATOR_ID
        ? [weaponId, REPLICATOR_BASE] : [weaponId]);
    const weapon = world.resources.get(WeaponEntries).getCached(weaponId);
    if (!weapon) throw new Error(`No weapon entry for ${weaponId}`);

    // Warm up: providers attach hitboxes/hurtboxes; JIT warms.
    for (let i = 0; i < 60; i++) world.step();

    const stepMs = new Array(STEPS);
    const entityCounts = new Array(STEPS);
    const hashes = [];
    let shotsFired = 0;
    // Census: projectiles alive per step (peak), and every projectile
    // ever seen per weapon id (spawned) — what one shot expands to.
    const projectileCounts = new Array(STEPS);
    const beamCounts = new Array(STEPS);
    const seen = new Set();
    const spawnedById = new Map();

    const t0 = performance.now();
    for (let i = 0; i < STEPS; i++) {
        if (i % FIRE_EVERY === 0 && shotsFired < SHOTS) {
            // inaccuracy=false: pinned geometry; the sub cones still
            // draw from the seeded PRNG deterministically.
            for (let v = 0; v < VOLLEY; v++) {
                weapon.fireFromEntity('shooter', false);
            }
            shotsFired++;
        }
        pinVictim();
        const a = performance.now();
        world.step();
        stepMs[i] = performance.now() - a;
        entityCounts[i] = world.entities.size;
        let live = 0;
        let beams = 0;
        for (const [uuid, entity] of world.entities) {
            if (entity.components.has(BeamDataComponent)) beams++;
            const projectile = entity.components.get(ProjectileComponent);
            if (!projectile) continue;
            live++;
            if (!seen.has(uuid)) {
                seen.add(uuid);
                spawnedById.set(projectile.id,
                    (spawnedById.get(projectile.id) ?? 0) + 1);
            }
        }
        projectileCounts[i] = live;
        beamCounts[i] = beams;
        if ((i + 1) % HASH_EVERY === 0) {
            hashes.push(`${i + 1}:${hashWorld(world).hash}`);
        }
    }
    const totalMs = performance.now() - t0;

    const finalHash = hashWorld(world).hash;
    hashes.push(`end:${finalHash}`);
    const goldenHash = fnv1a(hashes.join('\n')).toString(16);

    const sorted = [...stepMs].sort((a, b) => a - b);
    // The plateau: the second half of the run, where a sustained flood
    // holds steady (the headline for a cap sweep).
    const half = Math.floor(STEPS / 2);
    const mean = values => values.reduce((a, b) => a + b, 0)
        / Math.max(1, values.length);
    const stats = {
        weapon: WEAPON_ID,
        rule: RULE,
        limits: ENGINE_LIMITS[RULE],
        plateauMeanMs: +mean(stepMs.slice(half)).toFixed(3),
        plateauProjectiles: Math.round(mean(projectileCounts.slice(half))),
        plateauBeams: Math.round(mean(beamCounts.slice(half))),
        peakBeams: Math.max(...beamCounts),
        steps: STEPS,
        shots: shotsFired,
        totalMs: +totalMs.toFixed(1),
        meanMs: +(totalMs / STEPS).toFixed(3),
        p50Ms: +quantile(sorted, 0.5).toFixed(3),
        p90Ms: +quantile(sorted, 0.9).toFixed(3),
        p95Ms: +quantile(sorted, 0.95).toFixed(3),
        p99Ms: +quantile(sorted, 0.99).toFixed(3),
        maxMs: +sorted[sorted.length - 1].toFixed(3),
        peakEntities: Math.max(...entityCounts),
        endEntities: entityCounts[STEPS - 1],
        peakProjectiles: Math.max(...projectileCounts),
        spawned: Object.fromEntries([...spawnedById].sort()),
        goldenHash,
    };

    if (JSON_OUT) {
        console.log(JSON.stringify(stats));
    } else {
        console.log(`weapon=${stats.weapon} steps=${stats.steps} shots=${stats.shots}`);
        console.log(`total=${stats.totalMs}ms mean=${stats.meanMs}ms ` +
            `p50=${stats.p50Ms}ms p90=${stats.p90Ms}ms p95=${stats.p95Ms}ms ` +
            `p99=${stats.p99Ms}ms max=${stats.maxMs}ms`);
        console.log(`peakEntities=${stats.peakEntities} endEntities=${stats.endEntities} ` +
            `peakProjectiles=${stats.peakProjectiles} peakBeams=${stats.peakBeams}`);
        console.log(`rule=${RULE} plateau: ${stats.plateauMeanMs}ms/step with ` +
            `${stats.plateauProjectiles} projectiles, ${stats.plateauBeams} beams`);
        console.log(`spawned=${JSON.stringify(stats.spawned)}`);
        console.log(`goldenHash=${stats.goldenHash}`);
        if (!QUIET) {
            // Worst 10 steps with entity counts: where the spikes are.
            const worst = stepMs.map((ms, i) => [ms, i])
                .sort((a, b) => b[0] - a[0]).slice(0, 10)
                .map(([ms, i]) => `step ${i}: ${ms.toFixed(2)}ms (${entityCounts[i]} entities)`);
            console.log('worst steps:\n  ' + worst.join('\n  '));
        }
    }
}

await main();
