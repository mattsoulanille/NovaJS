import 'jasmine';
import { formatAmbiguities, reportAmbiguities } from 'nova_ecs/ambiguities';
import { World } from 'nova_ecs/world';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { makeSystem } from './make_system.js';

/**
 * The simulation's system order must be a function of declared
 * before/after edges alone (#156, #237): any pair of systems that could
 * observe their relative order — they run on a shared event and their
 * args reach the same component or resource — has a declared path
 * between them. The ambiguity report (nova_ecs/ambiguities) is the
 * check; the World's tie-break for the remaining, non-conflicting
 * pairs is name order, so registration order does not matter.
 *
 * History: 4465 ambiguous pairs at fc133e44 (before the pins were
 * declared); 0 since. The number may only go down. A new system that
 * shares state with an existing one must declare where it runs.
 */
const MAX_AMBIGUOUS_PAIRS = 0;

describe('simulation system order ambiguities', () => {
    for (const platform of ['worker', 'node'] as const) {
        it(`are all declared away on the ${platform} platform`, async () => {
            const gameData = await getSyntheticGameData();
            const ids = await gameData.ids;
            const systemId = [...ids.System].sort()[0]!;
            const world: World = await makeSystem(
                systemId, gameData, platform, { npcs: false });
            const report = reportAmbiguities(world);
            if (report.length > 0) {
                console.log(`${platform} platform:\n${formatAmbiguities(report)}`);
            }
            expect(report.length).withContext(formatAmbiguities(report))
                .toBeLessThanOrEqual(MAX_AMBIGUOUS_PAIRS);
        });
    }
});
