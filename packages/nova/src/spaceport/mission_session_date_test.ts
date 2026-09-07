import 'jasmine';
import { CronData, getDefaultCronData } from 'novadatainterface/cron_data';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { dayNumber } from '../nova_plugin/player/calendar.js';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/ncb_plugin.js';
import { EscortPayrollComponent } from '../nova_plugin/player/player_escort.js';
import {
    CreditsComponent, CronStatesComponent, GameDateComponent,
} from '../nova_plugin/player/player_state_plugin.js';
import { advanceEntityDate, MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * A mïsn DatePostInc — "the game date will be advanced by this number of
 * days after successful completion or auto-aborting of the mission" (EVN
 * Bible) — is LIVED, not merely dated: a mission may skip half a year in
 * one commit, and every one of those days pays the ränk Salary ("per
 * day"), charges the escorts' wages, and rolls the crons, exactly as a
 * jump or a landing does (#109). And the calendar only moves once that
 * bookkeeping has actually happened (#120).
 *
 * Driven on the synthetic data set: a Wren Skiff pilot holding the
 * Meridian warrant (Salary 100) with one Gannet Corsair on the payroll
 * (90,000 cr, so a 900 cr daily wage), skipping the 180 days a long stock
 * DatePostInc asks for.
 */
describe('a DatePostInc date skip', () => {
    /** ränk "Meridian Warrant Officer": Salary 100 a day, no cap. */
    const WARRANT = SYNTHETIC.ranks.warrant;
    /** The Gannet Corsair, 90,000 cr: 1% of that, 900 a day on the payroll. */
    const CORSAIR = SYNTHETIC.ships.corsair;
    /** The rank's daily pay less the escort's daily wage: 100 - 900. */
    const SALARY = 100;
    const WAGE = 900;
    const START = { day: 1, month: 1, year: 1177 };

    function makeCron(partial: Partial<CronData>): CronData {
        return {
            ...getDefaultCronData(), id: 'nova:900', name: 'Test Cron',
            random: 100, ...partial,
        };
    }

    async function pilot(credits: number) {
        const gameData = await getSyntheticGameData();
        // An instance of our own: the crons below must not leak into the
        // shared universe other specs run against.
        const universe = new MissionUniverse(gameData);
        await universe.load();
        const entity = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        entity.components.set(CreditsComponent, { credits });
        entity.components.set(GameDateComponent, { ...START });
        entity.components.set(ActiveRanksComponent, new Set([WARRANT]));
        entity.components.set(EscortPayrollComponent, [CORSAIR]);
        entity.components.set(CronStatesComponent, new Map());
        return { gameData, universe, entity };
    }

    it('pays the salary and charges the wages for every skipped day, '
        + 'steps the crons through them, and then moves the calendar',
        async () => {
            const { gameData, universe, entity } = await pilot(1_000_000);
            const session = await MissionSession.create(
                entity, gameData, universe, SYNTHETIC.planets.port);
            // A cron that fires on any day and sets bit 777 when it does.
            universe.crons = [makeCron({ onStart: 'b777' })];

            session.state.dateAdvance = 180;
            session.commit();

            expect(dayNumber(entity.components.get(GameDateComponent)!))
                .toBe(dayNumber(START) + 180);
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(1_000_000 + 180 * (SALARY - WAGE));
            expect(entity.components.get(ControlBitsComponent)!.has(777))
                .toBe(true);
            // A second commit() charges nothing twice.
            session.commit();
            expect(dayNumber(entity.components.get(GameDateComponent)!))
                .toBe(dayNumber(START) + 180);
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(1_000_000 + 180 * (SALARY - WAGE));
            // ...and the session's own working copies followed the crons,
            // so it did not roll the bit back either.
            expect(session.state.bits.has(777)).toBe(true);
            expect(session.state.credits.credits)
                .toBe(1_000_000 + 180 * (SALARY - WAGE));
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
                .toBe(500_000 + 14 * (SALARY - WAGE));
            expect(entity.components.get(ControlBitsComponent)!.has(777))
                .toBe(false);
        });
});

describe('a date advance whose bookkeeping cannot run (#120)', () => {
    it('leaves the calendar (and the credits) exactly where they were',
        async () => {
            const gameData = await getSyntheticGameData();
            const entity = makeShip(
                await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
            entity.components.set(CreditsComponent, { credits: 10_000 });
            entity.components.set(GameDateComponent,
                { day: 1, month: 1, year: 1177 });
            entity.components.set(ActiveRanksComponent,
                new Set([SYNTHETIC.ranks.warrant]));
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
