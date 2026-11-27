import 'jasmine';
import { CronData, getDefaultCronData } from 'novadatainterface/cron_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import {
    activeCronContribute, contributeMask, playerContribute,
} from '../nova_plugin/missions/index.js';
import { ActiveRanksComponent } from '../nova_plugin/ncb/index.js';
import {
    CronState, CronStates, CronStatesComponent,
} from '../nova_plugin/player/index.js';
import {
    OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { computePlayerContribute } from './mission_session.js';
import { OutfitterContext, requirementsMet } from './outfitter_rules.js';
import { shipGateContext } from './ship_gate_context.js';
import { shipRequirementsMet } from './shipyard_stock_rules.js';

/**
 * crön Contribute (EVN Bible): "When the cron event is active, these two
 * Contribute fields together form a 64-bit flag that is subsequently
 * combined with the Contribute fields from the player's ship and the other
 * outfit items in the player's possession, to be used with the Require
 * fields in the outf and misn resources."
 *
 * Every Require gate — the outfitter, the shipyard and the bar's hire pool,
 * an escort upgrade, the mission computer — now reads one union
 * (missions/player_contribute.ts), and it has the active crons. A
 * hand-built crön contributing bit 40 (decimal, as crön Contribute is
 * stored) unlocks an oütf, a shïp and a mïsn requiring bit 40 while it is
 * ACTIVE, and not while it is idle or waiting out its PreHoldoff.
 */
describe('active crön Contribute', () => {
    const BIT = 1n << 40n;
    const CRON = 'nova:900';
    const cron: CronData = {
        ...getDefaultCronData(), id: CRON, name: 'Kit Contribute Cron',
        contribute: BIT.toString(),
    };
    const getCron = (id: string) => id === CRON ? cron : undefined;
    const states = (phase: CronState['phase']): CronStates =>
        new Map([[CRON, { phase, phaseStart: 0, nextEligible: 0 }]]);

    describe('the shared union', () => {
        it('counts a crön only in its active phase', () => {
            expect(activeCronContribute(states('active'), getCron)).toBe(BIT);
            expect(activeCronContribute(states('pre'), getCron)).toBe(0n);
            expect(activeCronContribute(states('idle'), getCron)).toBe(0n);
            expect(activeCronContribute(undefined, getCron)).toBe(0n);
        });

        it('unions hull, outfits, ranks and crons', () => {
            const rank = { contribute: (1n << 50n).toString() };
            const all = playerContribute({
                ship: '0x1', outfits: ['0x2', undefined, '0x4'],
                ranks: ['nova:128'], getRank: () => rank as never,
                cronStates: states('active'), getCron,
            });
            expect(all).toBe(0x7n | (1n << 50n) | BIT);
        });

        it('reads hex and decimal, and garbage as nothing', () => {
            expect(contributeMask('0x10')).toBe(16n);
            expect(contributeMask('16')).toBe(16n);
            expect(contributeMask('')).toBe(0n);
            expect(contributeMask(undefined)).toBe(0n);
            expect(contributeMask('nonsense')).toBe(0n);
        });
    });

    describe('the outfitter', () => {
        const locked: OutfitData = {
            ...getDefaultOutfitData(), id: 'nova:700', name: 'Kit Locked',
            require: '0x' + BIT.toString(16),
        };
        function context(cronStates: CronStates): OutfitterContext {
            return {
                shipData: getDefaultShipData(),
                outfits: new Map(),
                getOutfit: () => undefined,
                getWeapon: () => undefined,
                bits: new Set(),
                credits: 1e6,
                contributeSources: { cronStates, getCron },
            };
        }

        it('meets an oütf Require from an active crön', () => {
            expect(requirementsMet(locked, context(states('active'))))
                .toBeTrue();
            expect(requirementsMet(locked, context(states('pre'))))
                .toBeFalse();
            expect(requirementsMet(locked, context(new Map()))).toBeFalse();
        });
    });

    function pilot(phase: CronState['phase']): Entity {
        const entity = new Entity();
        entity.components.set(ShipComponent, { id: 'nova:128' });
        entity.components.set(OutfitsStateComponent, new Map());
        entity.components.set(ActiveRanksComponent, new Set());
        entity.components.set(CronStatesComponent, states(phase));
        return entity;
    }

    describe('the shipyard, the bar and an escort upgrade', () => {
        it('meet a shïp Require from an active crön', () => {
            const gate = (phase: CronState['phase']) => shipGateContext(
                pilot(phase), {
                    getOutfit: () => undefined,
                    getRank: () => undefined,
                    getCron,
                }).contribute;
            const require = '0x' + BIT.toString(16);
            expect(shipRequirementsMet(require, gate('active'))).toBeTrue();
            expect(shipRequirementsMet(require, gate('idle'))).toBeFalse();
        });
    });

    describe('the mission computer', () => {
        const ship: ShipData = { ...getDefaultShipData(), contribute: '0x1' };
        const gameData = {
            data: {
                Ship: { get: async () => ship },
                Outfit: { get: async () => getDefaultOutfitData() },
                Rank: { get: async () => { throw new Error('no ranks'); } },
                Cron: {
                    get: async (id: string) => {
                        const found = getCron(id);
                        if (!found) {
                            throw new Error(`no crön ${id}`);
                        }
                        return found;
                    },
                },
            },
        } as unknown as SimulationGameDataInterface;

        it('meets a mïsn Require from an active crön', async () => {
            expect(await computePlayerContribute(pilot('active'), gameData))
                .toBe(0x1n | BIT);
            expect(await computePlayerContribute(pilot('pre'), gameData))
                .toBe(0x1n);
        });

        it('leaves the crons out for their own run', async () => {
            // runCronsForDays folds each day's active crons in itself.
            expect(await computePlayerContribute(pilot('active'), gameData,
                { crons: false })).toBe(0x1n);
        });
    });
});
