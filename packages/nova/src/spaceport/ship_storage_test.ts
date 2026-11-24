import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { Stat } from '../nova_plugin/core/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import { BayFighterComponent } from '../nova_plugin/escorts/index.js';
import {
    CreditsComponent, MissionShipComponent, MissionsComponent, NO_DEAL,
    PlayerEscortComponent, PlayerShipSelector, StoredShip,
    StoredShipsComponent,
} from '../nova_plugin/player/index.js';
import {
    CargoComponent, FuelComponent, OutfitsStateComponent, ShipComponent,
    SourceComponent,
} from '../nova_plugin/ship/index.js';
import { PendingEscortsComponent } from './pending_escorts.js';
import {
    buildEscortFromRecord, escortWingOut, exchangeHolds, setStoredShips,
    snapshotHull, StorageLookups, storableEscort, storedShipsOf, swapWithEscort,
    swapWithStored,
} from './ship_storage.js';

/**
 * Ship storage's rules (ship_storage.ts, docs/ship_storage.md): what a
 * snapshot keeps, where the pilot's persistent outfits and hold go, and the
 * swap with a stored ship.
 */
describe('ship storage rules', () => {
    const SHUTTLE = 'nova:128';
    const FREIGHTER = 'nova:129';
    const HERE = 'nova:200';
    const BLASTER = 'nova:300';
    const LICENCE = 'nova:301';
    const POD = 'nova:302';

    function ship(id: string, name: string, freeCargo: number,
        outfits: Record<string, number> = {}): ShipData {
        const base = getDefaultShipData();
        return {
            ...base, id, name, outfits,
            physics: { ...base.physics, freeCargo },
        };
    }
    function outfit(id: string, fields: Partial<OutfitData> = {}): OutfitData {
        return {
            ...getDefaultOutfitData(), id, ...fields,
            physics: { freeMass: 0, ...fields.physics },
        };
    }
    const SHIPS = new Map([
        [SHUTTLE, ship(SHUTTLE, 'Shuttle; dev note', 10)],
        [FREIGHTER, ship(FREIGHTER, 'Freighter', 100)],
    ]);
    const OUTFITS = new Map([
        [BLASTER, outfit(BLASTER)],
        [LICENCE, outfit(LICENCE, { persistent: true })],
        // Adds hold: counts toward the incoming hull's capacity.
        [POD, outfit(POD, { physics: { freeCargo: 5 } } as Partial<OutfitData>)],
    ]);
    const lookups: StorageLookups = {
        getShip: id => SHIPS.get(id),
        getOutfit: id => OUTFITS.get(id),
    };

    /** The pilot as they dock, flying `shipId`. */
    function pilot(shipId: string, fields: {
        outfits?: [string, number][], cargo?: [string, number][],
        fuel?: number, stored?: StoredShip[],
    } = {}): Entity {
        const entity = new Entity('pilot')
            .addComponent(ShipComponent, { id: shipId })
            .addComponent(PlayerShipSelector, undefined)
            .addComponent(MultiplayerData, { owner: 'peer-1' })
            .addComponent(CreditsComponent, { credits: 1234 })
            .addComponent(ControlBitsComponent, new Set([7]))
            .addComponent(MissionsComponent, new Map())
            .addComponent(PendingEscortsComponent, ['nova:129'])
            .addComponent(OutfitsStateComponent, new Map(
                (fields.outfits ?? []).map(([id, count]) => [id, { count }])))
            .addComponent(CargoComponent, new Map(fields.cargo ?? []))
            .addComponent(FuelComponent, new Stat({
                current: fields.fuel ?? 300, max: 300, recharge: 0,
            }));
        if (fields.stored) {
            setStoredShips(entity, fields.stored);
        }
        return entity;
    }

    function stored(shipId: string, fields: Partial<StoredShip> = {}):
        StoredShip {
        return {
            ship: shipId, name: 'x', outfits: [], cargo: [], fuel: 100,
            storedAt: 'nova:999', ...fields,
        };
    }

    describe('a snapshot', () => {
        it('keeps the class, its name, every outfit at its count, the hold '
            + 'and the fuel, sorted', () => {
            const hull = pilot(SHUTTLE, {
                outfits: [[POD, 1], [BLASTER, 2]],
                cargo: [['cargo:3', 2], ['cargo:1', 4]], fuel: 150,
            });
            expect(snapshotHull(hull, HERE, lookups)).toEqual({
                ship: SHUTTLE, name: 'Shuttle',
                outfits: [[BLASTER, 2], [POD, 1]],
                cargo: [['cargo:1', 4], ['cargo:3', 2]],
                fuel: 150, storedAt: HERE,
            });
        });

        it('leaves out what it is told to strip, and zero counts', () => {
            const hull = pilot(SHUTTLE,
                { outfits: [[LICENCE, 1], [BLASTER, 1]] });
            expect(snapshotHull(hull, HERE, lookups,
                { strip: new Map([[LICENCE, 1]]) }).outfits)
                .toEqual([[BLASTER, 1]]);
        });
    });

    describe('the hold exchange', () => {
        it('takes everything when it fits, leaving nothing behind', () => {
            const { aboard, leftBehind } = exchangeHolds(
                new Map([['cargo:0', 3]]), [['cargo:0', 2], ['cargo:4', 1]], 10);
            expect(aboard).toEqual(new Map([['cargo:0', 5], ['cargo:4', 1]]));
            expect(leftBehind.size).toBe(0);
        });

        it('takes mission cargo always, and leaves the commodity overflow '
            + 'behind, highest key first', () => {
            const { aboard, leftBehind } = exchangeHolds(
                new Map([['mission:nova:400', 6], ['cargo:0', 4],
                    ['cargo:5', 3]]), [], 8);
            expect(aboard).toEqual(
                new Map([['mission:nova:400', 6], ['cargo:0', 2]]));
            expect(leftBehind).toEqual(new Map([['cargo:0', 2], ['cargo:5', 3]]));
        });
    });

    describe('swapping with a stored ship', () => {
        it('flies the stored ship and stores the old one IN ITS SLOT, '
            + 'carrying the pilot\'s state and moving no money', () => {
            const before = stored(FREIGHTER, {
                name: 'Freighter', outfits: [[BLASTER, 3]], fuel: 120,
                cargo: [['cargo:2', 10]],
            });
            const other = stored(SHUTTLE, { name: 'Spare' });
            const hull = pilot(SHUTTLE, {
                outfits: [[BLASTER, 1]], cargo: [['cargo:0', 4]], fuel: 90,
                stored: [other, before],
            });
            const flown = swapWithStored(hull, 1, HERE, lookups);

            expect(flown).not.toBe(hull);
            expect(flown.components.get(ShipComponent)).toEqual({ id: FREIGHTER });
            expect(flown.components.get(OutfitsStateComponent))
                .toEqual(new Map([[BLASTER, { count: 3 }]]));
            expect(flown.components.get(CargoComponent))
                .toEqual(new Map([['cargo:0', 4], ['cargo:2', 10]]));
            expect(flown.components.get(FuelComponent)!.current).toBe(120);
            expect(flown.components.get(CreditsComponent)).toEqual({ credits: 1234 });
            expect(flown.components.get(ControlBitsComponent))
                .toEqual(new Set([7]));
            expect(flown.components.get(PendingEscortsComponent))
                .toEqual(['nova:129']);
            expect(flown.components.has(PlayerShipSelector)).toBeTrue();
            expect(flown.components.get(MultiplayerData))
                .toEqual({ owner: 'peer-1' });
            expect(storedShipsOf(flown)).toEqual([other, {
                ship: SHUTTLE, name: 'Shuttle', outfits: [[BLASTER, 1]],
                cargo: [], fuel: 90, storedAt: HERE,
            }]);
            // The old hull is untouched, list and all.
            expect(storedShipsOf(hull)).toEqual([other, before]);
            expect(hull.components.get(ShipComponent)).toEqual({ id: SHUTTLE });
        });

        it('moves the pilot\'s PERSISTENT outfits onto the hull taken out',
            () => {
                const hull = pilot(SHUTTLE, {
                    outfits: [[LICENCE, 1], [BLASTER, 1]],
                    stored: [stored(FREIGHTER, { outfits: [[BLASTER, 2]] })],
                });
                const flown = swapWithStored(hull, 0, HERE, lookups);
                expect(flown.components.get(OutfitsStateComponent)).toEqual(
                    new Map([[BLASTER, { count: 2 }], [LICENCE, { count: 1 }]]));
                expect(storedShipsOf(flown)[0].outfits)
                    .toEqual([[BLASTER, 1]]);
            });

        it('leaves the commodities a smaller hold cannot take aboard the '
            + 'ship put away; mission cargo always comes along', () => {
            const hull = pilot(FREIGHTER, {
                cargo: [['mission:nova:400', 8], ['cargo:0', 30]],
                stored: [stored(SHUTTLE, { outfits: [[POD, 1]] })],
            });
            // Shuttle: 10 tons + the pod's 5.
            const flown = swapWithStored(hull, 0, HERE, lookups);
            expect(flown.components.get(CargoComponent)).toEqual(
                new Map([['mission:nova:400', 8], ['cargo:0', 7]]));
            expect(storedShipsOf(flown)[0].cargo).toEqual([['cargo:0', 23]]);
        });

        it('takes a pilot with one stored ship and swaps back to where it '
            + 'started', () => {
            const hull = pilot(SHUTTLE, {
                outfits: [[BLASTER, 1]], fuel: 75,
                stored: [stored(FREIGHTER, { name: 'Freighter', fuel: 40 })],
            });
            const there = swapWithStored(hull, 0, HERE, lookups);
            const back = swapWithStored(there, 0, 'nova:201', lookups);
            expect(back.components.get(ShipComponent)).toEqual({ id: SHUTTLE });
            expect(back.components.get(OutfitsStateComponent))
                .toEqual(new Map([[BLASTER, { count: 1 }]]));
            expect(back.components.get(FuelComponent)!.current).toBe(75);
            expect(storedShipsOf(back)).toEqual([{
                ship: FREIGHTER, name: 'Freighter', outfits: [], cargo: [],
                fuel: 40, storedAt: 'nova:201',
            }]);
        });

        it('refuses an index out of range and a class that is not loaded',
            () => {
                const hull = pilot(SHUTTLE,
                    { stored: [stored('nova:404')] });
                expect(() => swapWithStored(hull, 3, HERE, lookups)).toThrow();
                expect(() => swapWithStored(hull, 0, HERE, lookups)).toThrow();
            });
    });

    describe('captured escorts', () => {
        const PLAYER = 'player-uuid';

        /** A landed captured escort flying `shipId`. */
        function captured(shipId: string, fields: {
            outfits?: [string, number][], cargo?: [string, number][],
            fuel?: number,
        } = {}): Entity {
            return buildEscortFromRecord(stored(shipId, {
                outfits: fields.outfits ?? [], cargo: fields.cargo ?? [],
                fuel: fields.fuel ?? 50,
            }), PLAYER, lookups);
        }

        it('builds an escort from a record as a captured prize with nothing '
            + 'queued, carrying the record\'s outfits, hold and fuel', () => {
            const escort = buildEscortFromRecord(stored(FREIGHTER, {
                outfits: [[BLASTER, 2]], cargo: [['cargo:1', 9]], fuel: 70,
            }), PLAYER, lookups);
            expect(escort.components.get(ShipComponent))
                .toEqual({ id: FREIGHTER });
            expect(escort.components.get(OutfitsStateComponent))
                .toEqual(new Map([[BLASTER, { count: 2 }]]));
            expect(escort.components.get(CargoComponent))
                .toEqual(new Map([['cargo:1', 9]]));
            expect(escort.components.get(FuelComponent)!.current).toBe(70);
            expect(escort.components.get(PlayerEscortComponent)).toEqual({
                player: PLAYER, parent: PLAYER, provenance: 'captured',
                deal: NO_DEAL,
            });
            expect(storableEscort({ player: PLAYER, uuid: 'e', entity: escort },
                PLAYER)).toBeTrue();
        });

        it('lists only the player\'s captured escorts: not a hire, a bay '
            + 'fighter, a mission ship or another player\'s prize', () => {
            const entry = (entity: Entity, player = PLAYER) =>
                ({ player, uuid: 'e', entity });
            const hired = captured(SHUTTLE);
            hired.components.set(PlayerEscortComponent, {
                player: PLAYER, parent: PLAYER, provenance: 'hired',
                deal: NO_DEAL,
            });
            const fighter = captured(SHUTTLE);
            fighter.components.set(BayFighterComponent,
                { bayWeaponId: 'nova:200' });
            const missionShip = captured(SHUTTLE);
            missionShip.components.set(MissionShipComponent,
                {} as never);
            expect(storableEscort(entry(captured(SHUTTLE)), PLAYER)).toBeTrue();
            expect(storableEscort(entry(hired), PLAYER)).toBeFalse();
            expect(storableEscort(entry(fighter), PLAYER)).toBeFalse();
            expect(storableEscort(entry(missionShip), PLAYER)).toBeFalse();
            expect(storableEscort(entry(captured(SHUTTLE), 'other'), PLAYER))
                .toBeFalse();
        });

        it('knows when an escort\'s own wing is out, on the roster or in '
            + 'the world', () => {
            const wing = captured(SHUTTLE);
            wing.components.set(SourceComponent, 'carrier');
            const roster = [
                { player: PLAYER, uuid: 'carrier', entity: captured(FREIGHTER) },
                { player: PLAYER, uuid: 'other', entity: captured(SHUTTLE) },
            ];
            expect(escortWingOut('carrier', roster)).toBeFalse();
            expect(escortWingOut('carrier', roster, [['f', wing]])).toBeTrue();
            expect(escortWingOut('carrier',
                [...roster, { player: PLAYER, uuid: 'f', entity: wing }]))
                .toBeTrue();
        });

        it('swaps ships with a captured escort: the pilot flies the prize, '
            + 'and the old hull becomes the escort with the hold\'s overflow',
            () => {
                const hull = pilot(FREIGHTER, {
                    outfits: [[LICENCE, 1], [BLASTER, 1]], fuel: 260,
                    cargo: [['mission:nova:400', 2], ['cargo:0', 20]],
                });
                const prize = captured(SHUTTLE, {
                    outfits: [[BLASTER, 4]], cargo: [['cargo:5', 3]], fuel: 30,
                });
                const swapped = swapWithEscort(hull, prize, HERE, PLAYER,
                    lookups);

                const flown = swapped.hull;
                expect(flown.components.get(ShipComponent))
                    .toEqual({ id: SHUTTLE });
                expect(flown.components.get(OutfitsStateComponent)).toEqual(
                    new Map([[BLASTER, { count: 4 }], [LICENCE, { count: 1 }]]));
                // 10 tons: the mission cargo, then commodities by key.
                expect(flown.components.get(CargoComponent)).toEqual(new Map([
                    ['mission:nova:400', 2], ['cargo:0', 8]]));
                expect(flown.components.get(FuelComponent)!.current).toBe(30);
                expect(flown.components.get(CreditsComponent))
                    .toEqual({ credits: 1234 });
                expect(flown.components.has(PlayerEscortComponent)).toBeFalse();

                const escort = swapped.escort;
                expect(escort.components.get(ShipComponent))
                    .toEqual({ id: FREIGHTER });
                expect(escort.components.get(OutfitsStateComponent))
                    .toEqual(new Map([[BLASTER, { count: 1 }]]));
                expect(escort.components.get(CargoComponent)).toEqual(
                    new Map([['cargo:0', 12], ['cargo:5', 3]]));
                expect(escort.components.get(FuelComponent)!.current).toBe(260);
                expect(escort.components.get(PlayerEscortComponent)?.provenance)
                    .toBe('captured');
                expect(escort.components.has(PlayerShipSelector)).toBeFalse();
                expect(escort.components.has(CreditsComponent)).toBeFalse();
                // Neither input was touched.
                expect(hull.components.get(ShipComponent))
                    .toEqual({ id: FREIGHTER });
                expect(prize.components.get(ShipComponent))
                    .toEqual({ id: SHUTTLE });
            });
    });

    it('writes no component for an empty list, and a new array otherwise',
        () => {
            const hull = pilot(SHUTTLE);
            const list = [stored(SHUTTLE)];
            setStoredShips(hull, list);
            expect(hull.components.get(StoredShipsComponent)).not.toBe(list);
            expect(hull.components.get(StoredShipsComponent)).toEqual(list);
            setStoredShips(hull, []);
            expect(hull.components.has(StoredShipsComponent)).toBeFalse();
        });
});
