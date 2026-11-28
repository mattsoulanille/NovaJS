import 'jasmine';
import { isRight } from 'fp-ts/lib/Either.js';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { Stat } from '../nova_plugin/core/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import { BayFighterComponent } from '../nova_plugin/escorts/index.js';
import {
    CreditsComponent, MissionShipComponent, MissionsComponent, NO_DEAL,
    PlayerEscort, PlayerEscortComponent, PlayerNamesComponent,
    PlayerShipSelector, StoredShip, StoredShipsComponent,
} from '../nova_plugin/player/index.js';
import {
    CargoComponent, FuelComponent, OutfitsStateComponent, ShipComponent,
    SourceComponent,
} from '../nova_plugin/ship/index.js';
import { restockCarriedEscorts } from './escort_restock.js';
import { PendingEscortsComponent } from './pending_escorts.js';
import {
    buildEscortFromRecord, buyAndKeep, canBuyAndKeep, escortToStorage, escortWingOut, exchangeHolds,
    recordOutfitsLoaded, setStoredShips, snapshotHull, StorageLookups,
    storableEscort, storedShipLabel, storedShipsOf, storedToEscort,
    swapHoldRefusal, swapWithEscort, swapWithStored,
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
    const TANK = 'nova:303';
    const MISSILE = 'nova:304';
    const RACK = 'nova:305';

    function ship(id: string, name: string, freeCargo: number,
        outfits: Record<string, number> = {}): ShipData {
        const base = getDefaultShipData();
        return {
            ...base, id, name, outfits,
            // A 300-unit tank, as the pilot fixture's: a hull built from
            // storage gets its class's real tank (plus outfits) as its max.
            physics: { ...base.physics, freeCargo, energy: 300 },
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
        // A fuel tank: 100 more units of energy.
        [TANK, outfit(TANK, { physics: { energy: 100 } } as Partial<OutfitData>)],
        // A launcher and its ammunition (the owned-escort ammo specs).
        [RACK, outfit(RACK, { weapons: { 'nova:900': 1 } })],
        [MISSILE, outfit(MISSILE, { ammoFor: 'nova:900' })],
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
                deal: NO_DEAL, ammoStock: [],
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

    describe('between storage and the escort roster', () => {
        const PLAYER = 'player-uuid';

        it('sends a stored ship along as a captured escort, and takes it off '
            + 'the list', () => {
            const a = stored(SHUTTLE, { name: 'A', outfits: [[BLASTER, 1]] });
            const b = stored(FREIGHTER, { name: 'B', fuel: 90 });
            const hull = pilot(SHUTTLE, { stored: [a, b] });
            const listBefore = hull.components.get(StoredShipsComponent);
            const escort = storedToEscort(hull, 1, PLAYER, lookups);
            expect(escort.components.get(ShipComponent))
                .toEqual({ id: FREIGHTER });
            expect(escort.components.get(FuelComponent)!.current).toBe(90);
            expect(escort.components.get(PlayerEscortComponent)?.provenance)
                .toBe('captured');
            expect(storedShipsOf(hull)).toEqual([a]);
            // A new array, not an edit of the old one.
            expect(listBefore).toEqual([a, b]);

            storedToEscort(hull, 0, PLAYER, lookups);
            expect(hull.components.has(StoredShipsComponent)).toBeFalse();
            expect(() => storedToEscort(hull, 0, PLAYER, lookups)).toThrow();
        });

        it('puts a captured escort into storage at the end of the list, '
            + 'hold and all', () => {
            const a = stored(SHUTTLE, { name: 'A' });
            const hull = pilot(SHUTTLE, { stored: [a] });
            const escort = buildEscortFromRecord(stored(FREIGHTER, {
                outfits: [[BLASTER, 2]], cargo: [['cargo:4', 6]], fuel: 33,
            }), PLAYER, lookups);
            escortToStorage(hull, escort, HERE, lookups);
            expect(storedShipsOf(hull)).toEqual([a, {
                ship: FREIGHTER, name: 'Freighter', outfits: [[BLASTER, 2]],
                cargo: [['cargo:4', 6]], fuel: 33, storedAt: HERE,
            }]);
        });

        it('round-trips a ship from storage to the roster and back unchanged',
            () => {
                const record = stored(FREIGHTER, {
                    name: 'Freighter', outfits: [[BLASTER, 2], [POD, 1]],
                    cargo: [['cargo:1', 4]], fuel: 120, storedAt: HERE,
                });
                const hull = pilot(SHUTTLE, { stored: [record] });
                const escort = storedToEscort(hull, 0, 'player-uuid', lookups);
                escortToStorage(hull, escort, HERE, lookups);
                expect(storedShipsOf(hull)).toEqual([record]);
            });
    });

    /**
     * Matthew's ruling (2026-11-24): an escort made from the player's own
     * hull rearms back up to what the player left aboard when it became an
     * escort (the marker's ammoStock), and the snapshot lives exactly as
     * long as the escort does.
     */
    describe('an owned escort\'s ammo snapshot', () => {
        const PLAYER = 'player-uuid';
        const restockData = {
            getOutfit: async (id: string) => OUTFITS.get(id),
            getWeapon: async (id: string) => id === 'nova:900'
                ? { id, maxAmmo: 30 } as never : undefined,
            getShip: async (id: string) => SHIPS.get(id),
        };
        const missiles = (entity: Entity) =>
            entity.components.get(OutfitsStateComponent)!.get(MISSILE)?.count;
        const stockOf = (entity: Entity) =>
            entity.components.get(PlayerEscortComponent)?.ammoStock;

        it('buy and keep, send the old hull along, spend its ammo, land: it '
            + 'comes back to the partial count it was left with, not full',
            async () => {
                const hull = pilot(SHUTTLE, {
                    outfits: [[RACK, 1], [MISSILE, 6], [BLASTER, 1]],
                });
                const bought = buyAndKeep(hull, SHIPS.get(FREIGHTER)!, {
                    currentShip: SHIPS.get(SHUTTLE)!,
                    outfits: new Map([[RACK, 1], [MISSILE, 6], [BLASTER, 1]]),
                    getOutfit: (id: string) => OUTFITS.get(id),
                    credits: 100000,
                }, HERE, lookups);
                const escort = storedToEscort(bought, 0, PLAYER, lookups);
                // Ammo outfits only: the rack and the blaster are not in it.
                expect(stockOf(escort)).toEqual([[MISSILE, 6]]);

                escort.components.get(OutfitsStateComponent)!
                    .get(MISSILE)!.count = 0; // Fired them all.
                await restockCarriedEscorts([{ uuid: 'e', entity: escort }],
                    restockData);
                // 6, not the launcher's 30.
                expect(missiles(escort)).toBe(6);
            });

        it('goes away with the marker into storage, and a re-escort takes a '
            + 'new one', async () => {
                const hull = pilot(SHUTTLE, {
                    stored: [stored(FREIGHTER, {
                        outfits: [[RACK, 1], [MISSILE, 6]],
                    })],
                });
                const escort = storedToEscort(hull, 0, PLAYER, lookups);
                escort.components.get(OutfitsStateComponent)!
                    .get(MISSILE)!.count = 2;
                escortToStorage(hull, escort, HERE, lookups);
                // The record has no marker, so nothing of the old snapshot.
                expect(storedShipsOf(hull)[0].outfits)
                    .toEqual([[MISSILE, 2], [RACK, 1]]);
                const again = storedToEscort(hull, 0, PLAYER, lookups);
                expect(stockOf(again)).toEqual([[MISSILE, 2]]);
                await restockCarriedEscorts([{ uuid: 'e', entity: again }],
                    restockData);
                expect(missiles(again)).toBe(2);
            });

        it('a hangar swap snapshots the hull left behind; the hull taken '
            + 'over carries no marker', () => {
                const hull = pilot(FREIGHTER, {
                    outfits: [[RACK, 1], [MISSILE, 4], [LICENCE, 1]],
                });
                const prize = buildEscortFromRecord(stored(SHUTTLE, {
                    outfits: [[RACK, 1], [MISSILE, 9]],
                }), PLAYER, lookups);
                const swapped = swapWithEscort(hull, prize, HERE, PLAYER,
                    lookups);
                expect(stockOf(swapped.escort)).toEqual([[MISSILE, 4]]);
                expect(swapped.hull.components.has(PlayerEscortComponent))
                    .toBeFalse();
            });

        /**
         * Matthew (2026-11-27): a custom escort, a hull the player switched
         * off of, refills to the ammo AND bay quantities the player left it
         * with, not its class's stock loadout (a hired escort's target) nor
         * capacity. The target is the marker's `ammoStock`, which rides the
         * escort's saved entity, so it survives a save and load.
         */
        it('a swapped-out hull refills its missiles and its bay to what it '
            + 'was left with, across a save, not to its class\'s stock',
        async () => {
            const BAY = 'nova:306';
            const FIGHTERS = 'nova:307';
            const outfits = new Map([...OUTFITS,
                [BAY, outfit(BAY, { weapons: { 'nova:901': 1 } })],
                [FIGHTERS, outfit(FIGHTERS, { ammoFor: 'nova:901' })],
            ]);
            const withBay: StorageLookups = {
                getShip: id => SHIPS.get(id),
                getOutfit: id => outfits.get(id),
            };
            const hull = pilot(FREIGHTER, {
                outfits: [[RACK, 1], [MISSILE, 4], [BAY, 1], [FIGHTERS, 2]],
            });
            const prize = buildEscortFromRecord(stored(SHUTTLE, {
                outfits: [[RACK, 1], [MISSILE, 9]],
            }), PLAYER, withBay);
            const { escort } = swapWithEscort(hull, prize, HERE, PLAYER,
                withBay);
            expect(stockOf(escort)).toEqual([[MISSILE, 4], [FIGHTERS, 2]]);

            // The save: the marker goes out and back through its codec.
            const marker = escort.components.get(PlayerEscortComponent)!;
            const decoded = PlayerEscort.decode(JSON.parse(JSON.stringify(
                PlayerEscort.encode(marker))));
            expect(isRight(decoded)).toBeTrue();
            const loaded = new Entity('loaded')
                .addComponent(ShipComponent, { id: FREIGHTER })
                .addComponent(PlayerEscortComponent,
                    (decoded as { right: PlayerEscort }).right)
                .addComponent(OutfitsStateComponent, new Map([
                    [RACK, { count: 1 }], [MISSILE, { count: 0 }],
                    [BAY, { count: 1 }], [FIGHTERS, { count: 0 }],
                ]));

            // Its class stocks 10 missiles and 5 fighters.
            await restockCarriedEscorts([{ uuid: 'e', entity: loaded }], {
                getOutfit: async (id: string) => outfits.get(id),
                getWeapon: async () => undefined,
                getShip: async (id: string) => id === FREIGHTER
                    ? { ...SHIPS.get(FREIGHTER)!,
                        outfits: { [MISSILE]: 10, [FIGHTERS]: 5 } }
                    : undefined,
            });
            const counts = loaded.components.get(OutfitsStateComponent)!;
            expect(counts.get(MISSILE)!.count).toBe(4);
            expect(counts.get(FIGHTERS)!.count).toBe(2);
        });
    });

    describe('buying a ship and keeping the old one', () => {
        function context(hull: Entity, credits: number) {
            return {
                currentShip: SHIPS.get(SHUTTLE)!,
                outfits: new Map([...hull.components.get(OutfitsStateComponent)!]
                    .map(([id, { count }]) => [id, count])),
                getOutfit: (id: string) => OUTFITS.get(id),
                credits,
            };
        }
        const BIG = { ...SHIPS.get(FREIGHTER)!, price: 1000,
            outfits: { [BLASTER]: 2 } };

        it('charges the FULL price and puts the old hull at the end of the '
            + 'list, the pilot\'s persistent outfits following them', () => {
            const earlier = stored(FREIGHTER, { name: 'Earlier' });
            const hull = pilot(SHUTTLE, {
                outfits: [[LICENCE, 1], [BLASTER, 1]], fuel: 80,
                cargo: [['cargo:0', 4]], stored: [earlier],
            });
            const ctx = context(hull, 1234);
            expect(canBuyAndKeep(BIG, ctx).allowed).toBeTrue();
            const bought = buyAndKeep(hull, BIG, ctx, HERE, lookups);
            expect(bought.components.get(ShipComponent))
                .toEqual({ id: FREIGHTER });
            expect(bought.components.get(CreditsComponent))
                .toEqual({ credits: 234 });
            expect(bought.components.get(OutfitsStateComponent)).toEqual(
                new Map([[BLASTER, { count: 2 }], [LICENCE, { count: 1 }]]));
            expect(bought.components.get(CargoComponent))
                .toEqual(new Map([['cargo:0', 4]]));
            expect(storedShipsOf(bought)).toEqual([earlier, {
                ship: SHUTTLE, name: 'Shuttle', outfits: [[BLASTER, 1]],
                cargo: [], fuel: 80, storedAt: HERE,
            }]);
            expect(storedShipsOf(hull)).toEqual([earlier]);
        });

        it('refuses what the trade-in would make affordable but the full '
            + 'price does not', () => {
            const hull = pilot(SHUTTLE);
            expect(canBuyAndKeep(BIG, context(hull, 999))).toEqual(
                jasmine.objectContaining({ allowed: false, reason: 'credits' }));
            expect(canBuyAndKeep(BIG, { ...context(hull, 5000),
                deployedCounts: new Map([[BLASTER, 1]]) })).toEqual(
                jasmine.objectContaining({ allowed: false,
                    reason: 'fightersDeployed' }));
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
    describe('names (player_names.ts)', () => {
        function named(entity: Entity, ship: string): Entity {
            entity.components.set(PlayerNamesComponent,
                { pilot: 'Matt', ship });
            return entity;
        }

        it('a snapshot keeps the ship\'s own name beside its class name',
            () => {
                const record = snapshotHull(
                    named(pilot(SHUTTLE), 'Rocinante'), HERE, lookups);
                expect(record.name).toBe('Shuttle');
                expect(record.shipName).toBe('Rocinante');
                expect(storedShipLabel(record)).toBe('Rocinante');
                // An escort has no name of its own: listed by class.
                const escort = snapshotHull(pilot(FREIGHTER), HERE, lookups);
                expect(escort.shipName).toBeUndefined();
                expect(storedShipLabel(escort)).toBe('Freighter');
                // A blank name is a name, but lists as the class.
                expect(storedShipLabel({ ...record, shipName: '' }))
                    .toBe('Shuttle');
            });

        it('a swap brings the stored ship\'s name back and stores the '
            + 'outgoing hull under its own', () => {
                const hull = named(pilot(SHUTTLE, {
                    stored: [stored(FREIGHTER, { shipName: 'Tub' })],
                }), 'Rocinante');
                const swapped = swapWithStored(hull, 0, HERE, lookups);
                expect(swapped.components.get(PlayerNamesComponent))
                    .toEqual({ pilot: 'Matt', ship: 'Tub' });
                expect(storedShipsOf(swapped)[0].shipName).toBe('Rocinante');
                // And back again.
                const back = swapWithStored(swapped, 0, HERE, lookups);
                expect(back.components.get(PlayerNamesComponent))
                    .toEqual({ pilot: 'Matt', ship: 'Rocinante' });
                expect(storedShipsOf(back)[0].shipName).toBe('Tub');
                // The hull swapped away still has its record untouched.
                expect(hull.components.get(PlayerNamesComponent)?.ship)
                    .toBe('Rocinante');
            });

        it('a stored ship that never had a name comes out with none (the '
            + 'derived "<class> <number>" stands in)', () => {
                const hull = named(pilot(SHUTTLE, {
                    stored: [stored(FREIGHTER)],
                }), 'Rocinante');
                const swapped = swapWithStored(hull, 0, HERE, lookups);
                expect(swapped.components.get(PlayerNamesComponent))
                    .toEqual({ pilot: 'Matt' });
            });

        it('buy and keep stores the old hull under its own name', () => {
            const hull = named(pilot(SHUTTLE), 'Rocinante');
            const bought = buyAndKeep(hull, SHIPS.get(FREIGHTER)!, {
                currentShip: SHIPS.get(SHUTTLE)!, outfits: new Map(),
                getOutfit: id => OUTFITS.get(id), credits: 1_000_000,
            }, HERE, lookups);
            expect(storedShipsOf(bought).map(record => record.shipName))
                .toEqual(['Rocinante']);
        });
    });

    describe('review findings', () => {
        it('a stored ship with an outfit that is not loaded is known as '
            + 'such (finding 1)', () => {
                expect(recordOutfitsLoaded(stored(SHUTTLE,
                    { outfits: [[BLASTER, 1]] }), lookups)).toBeTrue();
                expect(recordOutfitsLoaded(stored(SHUTTLE,
                    { outfits: [[BLASTER, 1], ['gone:128', 1]] }), lookups))
                    .toBeFalse();
            });

        it('an escort built from storage lifts off with a FULL tank, its '
            + 'class\'s and its outfits\' (finding 2)', async () => {
                const hull = pilot(SHUTTLE, {
                    stored: [stored(FREIGHTER,
                        { outfits: [[TANK, 1]], fuel: 0 })],
                });
                const escort = storedToEscort(hull, 0, 'player-uuid', lookups);
                const fuel = escort.components.get(FuelComponent)!;
                // Stored dry, and dry until the lift-off refuels it...
                expect(fuel.current).toBe(0);
                expect(fuel.max).toBe(400);
                // ...which fills it to the real tank, not to what it held.
                await restockCarriedEscorts([{ uuid: 'e', entity: escort }], {
                    getOutfit: async id => OUTFITS.get(id),
                    getWeapon: async () => undefined,
                    getShip: async id => SHIPS.get(id),
                });
                expect(escort.components.get(FuelComponent)!.current)
                    .toBe(400);
            });

        it('a hull taken out of storage keeps its stored fuel in a tank of '
            + 'its real size (finding 2)', () => {
                const hull = pilot(SHUTTLE, {
                    stored: [stored(FREIGHTER,
                        { outfits: [[TANK, 2]], fuel: 120 })],
                });
                const fuel = swapWithStored(hull, 0, HERE, lookups)
                    .components.get(FuelComponent)!;
                expect(fuel.current).toBe(120);
                expect(fuel.max).toBe(500);
            });

        it('refuses a swap that would overfill the hull put away '
            + '(finding 6)', () => {
                // A 10 t Shuttle with 20 t of mission cargo, for a full
                // 100 t Freighter: 20 t of commodities would be left in a
                // 10 t hold.
                const hull = pilot(SHUTTLE, {
                    cargo: [['mission:nova:400', 20]],
                });
                const full = stored(FREIGHTER, { cargo: [['cargo:0', 100]] });
                expect(swapHoldRefusal(hull, full, lookups)).toBe('holdFull');
                // 90 t aboard: 10 t left behind fits the Shuttle exactly.
                const fits = stored(FREIGHTER, { cargo: [['cargo:0', 90]] });
                expect(swapHoldRefusal(hull, fits, lookups)).toBeUndefined();
                // Without the mission cargo there is nothing to displace.
                expect(swapHoldRefusal(pilot(SHUTTLE), full, lookups))
                    .toBeUndefined();
            });
    });
});
