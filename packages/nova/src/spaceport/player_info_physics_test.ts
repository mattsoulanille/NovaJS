import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { OutfitsState, deriveShipPhysics } from '../nova_plugin/ship/index.js';
import { dialogShipPhysics, InfoRow, physicsRows } from './player_info.js';

/**
 * The player-info General page's Turn Rate / Accel Rate / Max Speed rows
 * for a DOCKED ship.
 *
 * The bug these pin: the outfitter deletes ShipPhysicsComponent from the
 * (detached) docked entity so takeoff rebuilds it with the new outfits
 * (spaceport.ts showOutfitter), and the dialog used to read
 * `entity.components.get(ShipPhysicsComponent) ?? shipData.physics`. So
 * after any outfitter visit, opening Player Info while still landed showed
 * the BARE HULL's numbers and every outfit modifier silently vanished
 * until takeoff. The dialog now re-derives from the ship's current outfits
 * through the same deriveShipPhysics the takeoff path uses.
 *
 * (PlayerInfoDialog itself needs a DOM for PIXI.Text, so — as elsewhere in
 * this package — it is tested through the pure functions it delegates to.)
 */
describe('the docked player-info physics rows', () => {
    /**
     * A hull worth 300 raw speed, 300 raw accel and 30°/sec of turn.
     * Speed and acceleration are stored in px/sec (raw * 30/100), turn
     * rate in rad/sec.
     */
    function hull(): ShipData {
        const ship = getDefaultShipData();
        ship.physics = {
            ...ship.physics,
            speed: 300 * 30 / 100,
            acceleration: 300 * 30 / 100,
            turnRate: 30 * Math.PI / 180,
            freeMass: 100,
        };
        return ship;
    }

    /** An engine-tuning outfit: +60 raw speed, +100 raw accel, +15°/sec. */
    function booster(id: string): OutfitData {
        return {
            ...getDefaultOutfitData(), id,
            physics: {
                freeMass: 10,
                speed: 60 * 30 / 100,
                acceleration: 100 * 30 / 100,
                turnRate: 15 * Math.PI / 180,
            },
        };
    }

    /** Game data whose Outfit cache holds exactly `outfits`. */
    function gameData(outfits: OutfitData[]): SimulationGameDataInterface {
        const byId = new Map(outfits.map(o => [o.id, o]));
        return {
            data: {
                Outfit: { getCached: (id: string) => byId.get(id) },
            },
        } as unknown as SimulationGameDataInterface;
    }

    function owned(...ids: [string, number][]): OutfitsState {
        return new Map(ids.map(([id, count]) => [id, { count }]));
    }

    /**
     * The three rows as {label, value} records — physicsRows returns the
     * dialog's InfoRow shape now that the General page has a row style with
     * a dim trailing run ("Expenses: 3,300 credits per day").
     */
    const rows = (...pairs: [string, string][]): InfoRow[] =>
        pairs.map(([label, value]) => ({ label, value }));

    const HULL_ROWS: InfoRow[] = rows(['Turn Rate:', '30°/sec'],
        ['Accel Rate:', '300'], ['Max Speed:', '300']);

    it('shows the outfitted numbers with no ShipPhysicsComponent aboard '
        + '(the state the outfitter leaves the docked entity in)', () => {
            const ship = hull();
            const actual = physicsRows(dialogShipPhysics(
                gameData([booster('nova:200')]), ship,
                owned(['nova:200', 1]), undefined));

            expect(actual).toEqual(rows(['Turn Rate:', '45°/sec'],
                ['Accel Rate:', '400'], ['Max Speed:', '360']));
            // What the old bare-hull fallback printed instead.
            expect(actual).not.toEqual(HULL_ROWS);
        });

    it('stacks several units of an outfit', () => {
        expect(physicsRows(dialogShipPhysics(
            gameData([booster('nova:200')]), hull(),
            owned(['nova:200', 3])))).toEqual(rows(['Turn Rate:', '75°/sec'],
                ['Accel Rate:', '600'], ['Max Speed:', '480']));
    });

    it('matches, field for field, the physics the takeoff deriver builds '
        + 'for the same ship and outfits', () => {
            // The point of routing through ship_plugin's deriveShipPhysics:
            // the numbers read while landed are the ones the relaunched
            // ship actually flies with, so no value changes at takeoff.
            const ship = hull();
            const outfits = owned(['nova:200', 2], ['nova:201', 1]);
            const data = gameData([booster('nova:200'), booster('nova:201')]);

            expect(dialogShipPhysics(data, ship, outfits))
                .toEqual(deriveShipPhysics(ship, data, outfits));
        });

    it('prefers the current outfits over an attached component', () => {
        // A ShipPhysicsComponent that survived onto the docked entity is
        // not authoritative: the dialog re-derives regardless.
        const ship = hull();
        const stale = { ...ship.physics, speed: 999, acceleration: 999 };
        expect(physicsRows(dialogShipPhysics(gameData([booster('nova:200')]),
            ship, owned(['nova:200', 1]), stale)))
            .toEqual(rows(['Turn Rate:', '45°/sec'], ['Accel Rate:', '400'],
                ['Max Speed:', '360']));
    });

    it('leaves the hull data untouched (the derivation copies)', () => {
        const ship = hull();
        const derived = dialogShipPhysics(gameData([booster('nova:200')]),
            ship, owned(['nova:200', 1]));
        expect(derived).not.toBe(ship.physics);
        expect(physicsRows(ship.physics)).toEqual(HULL_ROWS);
    });

    it('reports the hull for a ship carrying no outfits', () => {
        expect(physicsRows(dialogShipPhysics(gameData([]), hull(), owned())))
            .toEqual(HULL_ROWS);
        expect(physicsRows(dialogShipPhysics(gameData([]), hull(), undefined)))
            .toEqual(HULL_ROWS);
    });

    it('falls back to the attached component when an owned outfit\'s data '
        + 'is not cached', () => {
            // Nothing in the cache, so the derivation cannot complete; the
            // component the entity still carries beats the bare hull.
            const ship = hull();
            const attached = {
                ...ship.physics, speed: 360 * 30 / 100,
                acceleration: 400 * 30 / 100, turnRate: 45 * Math.PI / 180,
            };
            expect(physicsRows(dialogShipPhysics(gameData([]), ship,
                owned(['nova:200', 1]), attached)))
                .toEqual(rows(['Turn Rate:', '45°/sec'],
                    ['Accel Rate:', '400'], ['Max Speed:', '360']));
        });

    it('falls back to the hull when there is no component either', () => {
        expect(physicsRows(dialogShipPhysics(gameData([]), hull(),
            owned(['nova:200', 1])))).toEqual(HULL_ROWS);
    });

    it('dashes every row when there is no ship data at all', () => {
        expect(dialogShipPhysics(gameData([]), undefined, owned()))
            .toBeUndefined();
        expect(physicsRows(undefined)).toEqual(rows(['Turn Rate:', '-'],
            ['Accel Rate:', '-'], ['Max Speed:', '-']));
    });
});
