/**
 * Diagnostic: prints the simulation world's ambiguity report and the
 * live order of the two hull updaters.
 */
import { reportAmbiguities, formatAmbiguities } from 'nova_ecs/ambiguities';
import { getSyntheticGameData } from '../dist/src/communication/simulation_test_fixture.js';
import { makeSystem } from '../dist/src/nova_plugin/make_system.js';

const gameData = await getSyntheticGameData();
const ids = await gameData.ids;
const systemId = [...ids.System].sort()[0];
for (const platform of ['worker', 'node']) {
    const world = await makeSystem(systemId, gameData, platform);
    const report = reportAmbiguities(world);
    console.log(`== ${platform}: ${report.length} ambiguous pair(s)`);
    if (report.length > 0) {
        console.log(formatAmbiguities(report));
    }
    const names = world.systemNames;
    const hitbox = names.indexOf('UpdateHitboxHullSystem');
    const hurtbox = names.indexOf('UpdateHurtboxHullSystem');
    console.log(`UpdateHitboxHullSystem at ${hitbox}, UpdateHurtboxHullSystem at ${hurtbox}`);
}
process.exit(0);
