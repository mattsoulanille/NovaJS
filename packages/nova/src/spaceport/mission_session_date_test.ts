import 'jasmine';
import { CronData, getDefaultCronData } from 'novadatainterface/cron_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import {
    dayNumber, EscortPayrollComponent, CreditsComponent, CronStatesComponent, GameDateComponent,
} from '../nova_plugin/player/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import { advanceEntityDate, MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * A mïsn DatePostInc — "the game date will be advanced by this number of
 * days after successful completion or auto-aborting of the mission" (EVN
 * Bible) — is LIVED, not merely dated: stock nova:172 "Head to Nil'ar
 * Kemorya" skips 180 days and nova:659 "Receive Training from Karlaekaar"
 * 185, and every one of those days pays the ränk Salary ("per day"),
 * charges the escorts' wages, and rolls the crons, exactly as a jump or
 * a landing does (#109). And the calendar only moves once that
 * bookkeeping has actually happened (#120).
 */
describe('a DatePostInc date skip', () => {
    /** ränk 128 "Federation Naval Rank of Commander": Salary 200, no cap. */
    const FED_COMMANDER = 'nova:128';
    /** Viper, 110,000 cr: 1,100 a day on the payroll. */
    const VIPER = 'nova:335';
    const START = { day: 1, month: 1, year: 1177 };

    function makeCron(partial: Partial<CronData>): CronData {
        return {
            ...getDefaultCronData(), id: 'nova:900', name: 'Test Cron',
            random: 100, ...partial,
        };
    }

    async function pilot(credits: number) {
        const gameData = await getIntegrationGameData();
        // An instance of our own: the crons below must not leak into the
        // shared universe other specs run against.
        const universe = new MissionUniverse(gameData);
        await universe.load();
        const entity = makeShip(await gameData.data.Ship.get('nova:136'));
        entity.components.set(CreditsComponent, { credits });
        entity.components.set(GameDateComponent, { ...START });
        entity.components.set(ActiveRanksComponent, new Set([FED_COMMANDER]));
        entity.components.set(EscortPayrollComponent, [VIPER]);
        entity.components.set(CronStatesComponent, new Map());
        return { gameData, universe, entity };
    }

    it('pays the salary and charges the wages for every skipped day, '
        + 'steps the crons through them, and then moves the calendar',
        async () => {
            const { gameData, universe, entity } = await pilot(1_000_000);
            const session = await MissionSession.create(
                entity, gameData, universe, 'nova:128');
            // A cron that fires on any day and sets bit 777 when it does.
            universe.crons = [makeCron({ onStart: 'b777' })];

            session.state.dateAdvance = 180;
            session.commit();

            expect(dayNumber(entity.components.get(GameDateComponent)!))
                .toBe(dayNumber(START) + 180);
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(1_000_000 + 180 * (200 - 1_100));
            expect(entity.components.get(ControlBitsComponent)!.has(777))
                .toBe(true);
            // A second commit() charges nothing twice.
            session.commit();
            expect(dayNumber(entity.components.get(GameDateComponent)!))
                .toBe(dayNumber(START) + 180);
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(1_000_000 + 180 * (200 - 1_100));
            // ...and the session's own working copies followed the crons,
            // so it did not roll the bit back either.
            expect(session.state.bits.has(777)).toBe(true);
            expect(session.state.credits.credits)
                .toBe(1_000_000 + 180 * (200 - 1_100));
        });

    it('settles the books and the calendar, but no crons, for a DETACHED '
        + 'copy (the in-flight accept path)', async () => {
            const { gameData, universe, entity } = await pilot(500_000);
            // A detached copy carries no cron state (ship_mission_accept's
            // detachPlayerState), and its diff could not carry one back.
            entity.components.delete(CronStatesComponent);
            const session = await MissionSession.create(
                entity, gameData, universe, '<in-flight>',
                { announceCheckpoints: false });
            universe.crons = [makeCron({ onStart: 'b777' })];
            session.state.dateAdvance = 14;
            session.commit();
            expect(dayNumber(entity.components.get(GameDateComponent)!))
                .toBe(dayNumber(START) + 14);
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(500_000 + 14 * (200 - 1_100));
            expect(entity.components.get(ControlBitsComponent)!.has(777))
                .toBe(false);
        });
});

describe('a date advance whose bookkeeping cannot run (#120)', () => {
    it('leaves the calendar (and the credits) exactly where they were',
        async () => {
            const gameData = await getIntegrationGameData();
            const entity = makeShip(await gameData.data.Ship.get('nova:136'));
            entity.components.set(CreditsComponent, { credits: 10_000 });
            entity.components.set(GameDateComponent,
                { day: 1, month: 1, year: 1177 });
            entity.components.set(ActiveRanksComponent,
                new Set(['nova:128']));
            // A universe whose data never arrives: the date used to be
            // written BEFORE this rejected, so the skipped days were never
            // stepped by the crons and never paid, and a retried landing
            // was charged its day twice.
            const offline = new MissionUniverse(gameData);
            offline.load = () => Promise.reject(new Error('offline'));
            const warn = spyOn(console, 'warn');
            await advanceEntityDate(entity, 3, offline, gameData);
            expect(warn).toHaveBeenCalled();
            expect(entity.components.get(GameDateComponent))
                .toEqual({ day: 1, month: 1, year: 1177 });
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(10_000);
        });
});
