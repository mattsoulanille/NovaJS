import 'jasmine';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { dayNumber } from '../player/calendar.js';
import { runCronsForDays } from './cron_logic.js';
import { CronStates } from '../player/player_state_plugin.js';

/**
 * The crön date window against the REAL Nova Files.
 *
 * Stock data uses exactly three window shapes, which is why the two-regime
 * reading in cron_logic's inDateRange is the right one:
 *
 *   122 of 125   every field wildcarded (always in range)
 *     2 of 125   every field set (nova:128 1/1/1183-31/12/1200,
 *                nova:129 1/1/1178-1/1/1179)
 *     1 of 125   nova:156, months and days set with BOTH years wildcarded
 *                — a recurring season
 *
 * No stock crön mixes a set year with a wildcarded one, so the seasonal
 * reading and the absolute reading never have to be told apart on a
 * borderline case in the shipped scenario.
 */
describe('crön date windows against real Nova data', () => {
    async function cron(id: string) {
        const gameData = await getIntegrationGameData();
        return gameData.data.Cron.get(id);
    }

    it("pins nova:156 'Auroran Drop Bear Mating Season' as a "
        + 'September-December season', async () => {
            const c = await cron('nova:156');
            expect(c.name).toBe('Auroran Drop Bear Mating Season');
            expect([c.firstDay, c.firstMonth, c.firstYear])
                .toEqual([1, 9, -1]);
            expect([c.lastDay, c.lastMonth, c.lastYear])
                .toEqual([30, 12, -1]);
            // Random 100, so inside the window it activates the same day.
            expect(c.random).toBe(100);
            expect(c.enableOn).toBe('!b42');
            expect(c.onStart).toBe('b42');
        });

    it('leaves the Drop Bear season idle in March and active in October',
        async () => {
            const c = await cron('nova:156');
            const run = (date: { day: number, month: number, year: number }) => {
                const bits = new Set<number>();
                const states: CronStates = new Map();
                const day = dayNumber(date);
                runCronsForDays([c], states, bits, day - 1, day, () => 0);
                return {
                    bit42: bits.has(42),
                    phase: states.get('nova:156')?.phase,
                };
            };
            // The bug: a wildcarded year swamped the month/day comparison,
            // so the season was "in range" on 15 March and set b42 there.
            expect(run({ day: 15, month: 3, year: 1177 }))
                .toEqual({ bit42: false, phase: 'idle' });
            // Duration 105, so an October activation stays active.
            expect(run({ day: 15, month: 10, year: 1177 }))
                .toEqual({ bit42: true, phase: 'active' });
        });

    it('pins the two fully-dated stock cröns, whose windows are absolute',
        async () => {
            const wraith = await cron('nova:128');
            expect(wraith.name).toBe('Wraith Change');
            expect([wraith.firstDay, wraith.firstMonth, wraith.firstYear])
                .toEqual([1, 1, 1183]);
            expect([wraith.lastDay, wraith.lastMonth, wraith.lastYear])
                .toEqual([31, 12, 1200]);

            const terraform = await cron('nova:129');
            expect(terraform.name).toBe('Terraforming Start');
            expect([terraform.firstDay, terraform.firstMonth,
                terraform.firstYear]).toEqual([1, 1, 1178]);
            expect([terraform.lastDay, terraform.lastMonth,
                terraform.lastYear]).toEqual([1, 1, 1179]);
        });

    it('is the only stock crön with a month/day season and no year',
        async () => {
            const gameData = await getIntegrationGameData();
            const ids = [...(await gameData.ids).Cron]
                .filter(id => id.startsWith('nova:'));
            expect(ids.length).toBe(125);
            const shapes = { seasonal: [] as string[], absolute: 0, open: 0 };
            for (const id of ids) {
                const c = await gameData.data.Cron.get(id);
                const yearless = c.firstYear <= 0 && c.lastYear <= 0;
                const dated = c.firstMonth > 0 || c.firstDay > 0
                    || c.lastMonth > 0 || c.lastDay > 0;
                if (yearless && dated) {
                    shapes.seasonal.push(id);
                } else if (yearless) {
                    shapes.open++;
                } else {
                    shapes.absolute++;
                }
            }
            expect(shapes.seasonal).toEqual(['nova:156']);
            expect(shapes.absolute).toBe(2);
            expect(shapes.open).toBe(122);
        });
});
