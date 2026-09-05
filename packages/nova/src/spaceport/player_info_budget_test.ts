import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import {
    getIntegrationGameData, getPluginGameData,
} from '../communication/simulation_test_fixture.js';
import { makeShip } from '../nova_plugin/make_ship.js';
import { ActiveRanksComponent } from '../nova_plugin/ncb_plugin.js';
import { EscortPayrollComponent } from '../nova_plugin/player_escort.js';
import {
    CreditsComponent, GameDateComponent,
} from '../nova_plugin/player_state_plugin.js';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import {
    legalStatusInSystem, legalStatusName,
} from '../nova_plugin/reputation.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { dailyBudget } from './daily_budget.js';
import {
    budgetRows, healthStatus, stageSystemStatus,
} from './player_info.js';
import {
    advanceEntityDate, loadPayrollShips, playerPayroll,
} from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { PendingEscortsComponent } from './pending_escorts.js';

/**
 * The player-info dialog's General page, below Energy Status.
 *
 * Matthew: "Income / Expenses should show up under 'p' under Energy Status."
 * The reference (ui_screenshots/original_macos_screenshots/p_properties/
 * general.png) shows a single extra row there —
 *
 *     Expenses: 3,300 credits per day
 *
 * — on a pilot who has hired escorts and draws no salary. So the rows are
 * conditional, the wording is fixed, and the number has to be the one the
 * game actually takes: these specs pin the text AND check it against what a
 * real date advance debits.
 *
 * (The dialog itself needs a DOM for PIXI.Text, so it is tested through the
 * pure row builders it delegates to, as the rest of this package does.)
 */
describe('the player-info budget rows', () => {
    it('prints the reference\'s line, verbatim, for a pilot with expenses',
        () => {
            expect(budgetRows({ income: 0, expenses: 3300 })).toEqual([{
                label: 'Expenses:', value: '3,300 credits',
                tail: 'per day', flow: true,
            }]);
        });

    it('shows nothing at all when there is nothing to show', () => {
        // general.png has eight left-hand rows plus the one Expenses line;
        // a pilot with neither side gets the eight the dialog always had.
        expect(budgetRows({ income: 0, expenses: 0 })).toEqual([]);
    });

    it('labels a salary the player is left with as Income', () => {
        expect(budgetRows({ income: 1500, expenses: 0 })
            .map(row => `${row.label} ${row.value} ${row.tail}`))
            .toEqual(['Income: 1,500 credits per day']);
    });

    it('reports the NET on the one row the layout has', () => {
        // The content pane fits exactly nine left-hand rows and the eight
        // fixed ones plus a budget line is nine; a tenth would ink over the
        // Done button. So a pilot who both earns and pays gets the figure
        // that actually moves their credits, labelled with its sign.
        expect(budgetRows({ income: 200, expenses: 1100 })
            .map(row => `${row.label} ${row.value} ${row.tail}`))
            .toEqual(['Expenses: 900 credits per day']);
        expect(budgetRows({ income: 1100, expenses: 200 })
            .map(row => `${row.label} ${row.value} ${row.tail}`))
            .toEqual(['Income: 900 credits per day']);
    });

    it('shows nothing when the books balance', () => {
        // A salary that exactly covers the flock is the same "nothing
        // happens to your credits per day" case as having neither.
        expect(budgetRows({ income: 1100, expenses: 1100 })).toEqual([]);
    });

    it('groups thousands the way every other credits figure does', () => {
        expect(budgetRows({ income: 1234567, expenses: 0 })[0].value)
            .toBe('1,234,567 credits');
    });
});

/**
 * The 'p' dialog's "Legal Status:" row is the STARMAP's function over the
 * system's status government — record and CrimeTol both (#119). It used
 * to be a CrimeTol-blind tier table of its own, so record -30 read
 * "Criminal" on the map and "Offender" in the dialog.
 */
describe('the Legal Status row', () => {
    const fed = { ...getDefaultGovtData(), id: 'nova:128', crimeTol: 6 };
    const geese = { ...getDefaultGovtData(), id: 'nova:144', crimeTol: 3 };
    const getGovt = (id: string) => [fed, geese].find(g => g.id === id);
    const status = (record: number, govt: { id: string }) =>
        legalStatusInSystem(new Map([[govt.id, record]]), govt.id, getGovt);

    it('prints exactly what the starmap prints for the same record', () => {
        for (const record of [-5000, -400, -30, -7, -6, -1, 0, 1, 25, 30,
            100, 1000, 7000]) {
            for (const govt of [fed, geese]) {
                expect(status(record, govt))
                    .withContext(`${record} with ${govt.id}`)
                    .toBe(legalStatusName(record, govt.crimeTol));
            }
        }
    });

    it('judges an independent system by gövt 128', () => {
        expect(legalStatusInSystem(new Map([['nova:128', -13]]), null,
            getGovt)).toBe('Minor Offender');
    });

    it('scales by the govt\'s own tolerance, as the map does', () => {
        // -13 is 2.2 Federation tolerances but 4.3 Wild Geese ones.
        expect(status(-13, fed)).toBe('Minor Offender');
        expect(status(-13, geese)).toBe('Offender');
        expect(status(-30, fed)).toBe('Offender');
        expect(status(-100, geese)).toBe('Criminal');
        expect(status(0, fed)).toBe('No Record');
        expect(status(30, fed)).toBe('Good Citizen');
    });
});

/**
 * The General page renders synchronously off the data caches, so the
 * dialog's load() warms the current system and its STATUS government
 * first — otherwise the first draw after entering a system could scale
 * the record by an unresolved govt (CrimeTol 0) and only correct itself
 * on the next page flip.
 */
describe('stageSystemStatus (the first render finds its govt cached)', () => {
    const fed = { ...getDefaultGovtData(), id: 'nova:128', crimeTol: 6 };
    const geese = { ...getDefaultGovtData(), id: 'nova:144', crimeTol: 3 };

    /** A Gettable stand-in: getCached hits only after a get resolved. */
    function fakeGettable<T>(items: Record<string, T>) {
        const gotten: Record<string, T> = {};
        return {
            async get(id: string): Promise<T> {
                if (!(id in items)) {
                    throw new Error(`no ${id}`);
                }
                gotten[id] = items[id];
                return items[id];
            },
            getCached: (id: string): T | undefined => gotten[id],
        };
    }
    function fakeData(systems: Record<string, { govt: string | null }>) {
        return {
            data: {
                System: fakeGettable(systems),
                Govt: fakeGettable({ 'nova:128': fed, 'nova:144': geese }),
            },
        } as unknown as SimulationGameDataInterface;
    }

    it("caches the system and its own government", async () => {
        const data = fakeData({ 'nova:200': { govt: 'nova:144' } });
        expect(data.data.Govt.getCached('nova:144')).toBeUndefined();
        await stageSystemStatus(data, 'nova:200');
        expect(data.data.System.getCached('nova:200')).toBeDefined();
        expect(data.data.Govt.getCached('nova:144')).toBe(geese);
        expect(data.data.Govt.getCached('nova:128')).toBeUndefined();
    });

    it('caches gövt 128 for an independent system', async () => {
        const data = fakeData({ 'nova:201': { govt: null } });
        await stageSystemStatus(data, 'nova:201');
        expect(data.data.Govt.getCached('nova:128')).toBe(fed);
        expect(data.data.Govt.getCached('nova:144')).toBeUndefined();
    });

    it('tolerates an unknown system, and no system at all', async () => {
        const data = fakeData({});
        await expectAsync(stageSystemStatus(data, 'nova:999')).toBeResolved();
        await expectAsync(stageSystemStatus(data, undefined)).toBeResolved();
        expect(data.data.Govt.getCached('nova:128')).toBeUndefined();
    });
});

/**
 * "Let's put the total shields / armor next to Shield Status and Armor
 * Status like we do for energy" (Matthew). The parenthesis on the Energy row
 * is a capacity figure ("(5 jumps)"), so these carry the capacity too.
 */
describe('the Shield / Armor status rows', () => {
    it('puts the ship\'s total points in parentheses', () => {
        expect(healthStatus({ current: 150, max: 150 }, 150))
            .toBe('100% (150)');
        expect(healthStatus({ current: 75, max: 150 }, 150))
            .toBe('50% (150)');
    });

    it('takes the capacity from the DERIVED physics, and the percentage '
        + 'against that same number', () => {
            // The outfitter deletes ShipPhysicsComponent from the docked
            // entity, and the Stat's max is only reconciled once the ship is
            // back in the world — so a shield booster bought this visit is
            // in the derived physics and not yet in the Stat. Reading the
            // stale max would print the capacity the player had BEFORE they
            // bought it.
            expect(healthStatus({ current: 42, max: 42 }, 44))
                .toBe('95% (44)');
        });

    it('falls back to the stat\'s own max when there are no physics', () => {
        expect(healthStatus({ current: 21, max: 42 }, undefined))
            .toBe('50% (42)');
    });

    it('dashes when there is no capacity to report', () => {
        expect(healthStatus(undefined, undefined)).toBe('-');
        expect(healthStatus({ current: 0, max: 0 }, 0)).toBe('-');
    });

    it('never reports more than full', () => {
        // Selling the shield tank leaves current above the new max until
        // the stat systems clamp it on the next step.
        expect(healthStatus({ current: 150, max: 150 }, 100))
            .toBe('100% (100)');
    });
});

/**
 * The line and the ledger, against the real game data: what the dialog
 * quotes is what `advanceEntityDate` charges.
 */
describe('the Expenses line against a real date advance', () => {
    /** Thunderhead, 320,000 cr: hires for 32,000 and draws 3,200 a day. */
    const THUNDERHEAD = 'nova:307';
    /** Viper, 110,000 cr: 1,100 a day. */
    const VIPER = 'nova:335';
    /** ränk 128 "Federation Naval Rank of Commander": Salary 200, no cap. */
    const FED_COMMANDER = 'nova:128';
    /** ränk 144 "Pirate Guild-Master; Pirate 1b": Salary 350, cap 350,000. */
    const PIRATE_GUILD_MASTER = 'nova:144';

    async function pilot(credits: number, escorts: string[]) {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const entity = makeShip(await gameData.data.Ship.get('nova:136'));
        entity.components.set(CreditsComponent, { credits });
        entity.components.set(GameDateComponent,
            { day: 1, month: 1, year: 1177 });
        entity.components.set(EscortPayrollComponent, escorts);
        return { gameData, universe, entity };
    }

    /** The rows the dialog would draw for this entity, right now. */
    async function rows(entity: Entity,
        gameData: Awaited<ReturnType<typeof getIntegrationGameData>>,
        universe: MissionUniverse) {
        const ships = await loadPayrollShips(entity, gameData);
        return budgetRows(dailyBudget({
            getRank: id => universe.getRank(id),
            ranks: entity.components.get(ActiveRanksComponent),
            escortShips: playerPayroll(entity),
            getShip: id => ships.get(id),
        }, entity.components.get(CreditsComponent)!.credits));
    }

    it('quotes 4,300 credits per day for a Thunderhead and a Viper, and '
        + 'takes exactly that much per day advanced', async () => {
            const b = await pilot(1_000_000, [THUNDERHEAD, VIPER]);
            expect((await rows(b.entity, b.gameData, b.universe)).map(
                row => `${row.label} ${row.value} ${row.tail}`))
                .toEqual(['Expenses: 4,300 credits per day']);

            await advanceEntityDate(b.entity, 3, b.universe, b.gameData);
            expect(b.entity.components.get(CreditsComponent)!.credits)
                .toBe(1_000_000 - 3 * 4_300);
        });

    it('charges nothing, and shows nothing, for a pilot with no escorts',
        async () => {
            const b = await pilot(50_000, []);
            expect(await rows(b.entity, b.gameData, b.universe)).toEqual([]);
            await advanceEntityDate(b.entity, 7, b.universe, b.gameData);
            expect(b.entity.components.get(CreditsComponent)!.credits)
                .toBe(50_000);
        });

    it('bills a pilot who has just hired at the bar, before the escort has '
        + 'been spawned', async () => {
            // A hire is a ship id parked on the entity until lift-off
            // (PendingEscortsComponent). It is on the payroll from the
            // moment the fee is paid, or the dialog would tell a player who
            // just hired two Thunderheads that they have no expenses.
            const b = await pilot(100_000, [VIPER]);
            b.entity.components.set(PendingEscortsComponent, [THUNDERHEAD]);
            expect((await rows(b.entity, b.gameData, b.universe))[0].value)
                .toBe('4,300 credits');
        });

    it('stops at zero rather than going into debt', async () => {
        const b = await pilot(5_000, [THUNDERHEAD]);
        await advanceEntityDate(b.entity, 10, b.universe, b.gameData);
        expect(b.entity.components.get(CreditsComponent)!.credits).toBe(0);
    });

    it('shows a stock ränk salary as Income and pays it', async () => {
        // ränk 128, the Federation Naval Rank of Commander: Salary 200,
        // SalaryCap 0 (unused).
        const b = await pilot(1_000, []);
        b.entity.components.set(ActiveRanksComponent,
            new Set([FED_COMMANDER]));
        expect((await rows(b.entity, b.gameData, b.universe)).map(
            row => `${row.label} ${row.value} ${row.tail}`))
            .toEqual(['Income: 200 credits per day']);
        await advanceEntityDate(b.entity, 2, b.universe, b.gameData);
        expect(b.entity.components.get(CreditsComponent)!.credits)
            .toBe(1_000 + 2 * 200);
    });

    it('drops the Income line once a capped salary stops paying', async () => {
        // ränk 144, "Pirate Guild-Master; Pirate 1b": Salary 350 with a
        // SalaryCap of 350,000 — the one stock rank that has a cap at all.
        const rich = await pilot(350_000, []);
        rich.entity.components.set(ActiveRanksComponent,
            new Set([PIRATE_GUILD_MASTER]));
        expect(await rows(rich.entity, rich.gameData, rich.universe))
            .toEqual([]);

        const poor = await pilot(349_999, []);
        poor.entity.components.set(ActiveRanksComponent,
            new Set([PIRATE_GUILD_MASTER]));
        expect((await rows(poor.entity, poor.gameData, poor.universe))[0]
            .value).toBe('350 credits');
    });

    it('nets a ränk salary against the escorts it does not cover',
        async () => {
            const b = await pilot(1_000_000, [VIPER]);
            b.entity.components.set(ActiveRanksComponent,
                new Set([FED_COMMANDER]));
            expect((await rows(b.entity, b.gameData, b.universe)).map(
                row => `${row.label} ${row.value} ${row.tail}`))
                .toEqual(['Expenses: 900 credits per day']);
            await advanceEntityDate(b.entity, 5, b.universe, b.gameData);
            expect(b.entity.components.get(CreditsComponent)!.credits)
                .toBe(1_000_000 + 5 * (200 - 1_100));
        });
});

/**
 * The negative-salary case, against the plug-in that actually ships one:
 * Extra Outfits' ränk 167 is named "Shipyard Expenses (1000 per day)" and
 * carries Salary -1000. It has to read as an EXPENSE, not as negative income.
 */
describe('a negative ränk Salary against real plug-in data', () => {
    it('lands in Expenses and is debited', async () => {
        const gameData = await getPluginGameData('extra-outfits');
        if (!gameData) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const rank = universe.getRank('extra-outfits:167');
        expect(rank?.salary).toBe(-1000);

        const entity = makeShip(await gameData.data.Ship.get('nova:136'));
        entity.components.set(CreditsComponent, { credits: 100_000 });
        entity.components.set(GameDateComponent,
            { day: 1, month: 1, year: 1177 });
        entity.components.set(ActiveRanksComponent,
            new Set(['extra-outfits:167']));

        expect(budgetRows(dailyBudget({
            getRank: id => universe.getRank(id),
            ranks: entity.components.get(ActiveRanksComponent),
        }, 100_000)).map(row => `${row.label} ${row.value} ${row.tail}`))
            .toEqual(['Expenses: 1,000 credits per day']);

        await advanceEntityDate(entity, 4, universe, gameData);
        expect(entity.components.get(CreditsComponent)!.credits)
            .toBe(100_000 - 4_000);
    });
});
