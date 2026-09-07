import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from './bay_plugin.js';
import {
    cappedEscortCount, CarriedEscortEntry, countsTowardEscortCap,
    MAX_ESCORTS, MAX_ESCORTS_MESSAGE,
} from './escort_cap.js';
import { MissionShipComponent } from '../player/mission_ship_component.js';
import { EscortProvenance, PlayerEscortComponent } from '../player/player_escort.js';

/**
 * Maintainer ruling #161: six escorts, counting only the ones the player
 * hired or captured. Mission-granted escorts and bay fighters neither
 * count nor are limited. The bar (spaceport/hire_escort_test) pins its
 * refusal and the plunder session (boarding_plugin_test,
 * boarding_dialog_test) its greyed Capture (#250); this pins the number
 * and the ONE count they share, wherever an escort happens to be when it
 * is counted.
 */
describe('the escort cap (#161)', () => {
    const PLAYER = 'player-uuid';

    function escort(player = PLAYER, provenance?: EscortProvenance,
        ...extra: ('fighter' | 'mission')[]): Entity {
        const entity = new Entity();
        entity.components.set(PlayerEscortComponent, {
            player, ...(provenance ? { provenance } : {}),
        });
        if (extra.includes('fighter')) {
            entity.components.set(BayFighterComponent,
                { bayWeaponId: 'nova:150', slot: 0 } as any);
        }
        if (extra.includes('mission')) {
            entity.components.set(MissionShipComponent, {} as any);
        }
        return entity;
    }

    function world(...escorts: Entity[]): Iterable<[string, Entity]> {
        return escorts.map((e, i): [string, Entity] => [`escort ${i}`, e]);
    }

    it('is six, with the stock STR# 2002 #123 refusal', () => {
        expect(MAX_ESCORTS).toBe(6);
        expect(MAX_ESCORTS_MESSAGE)
            .toBe('You already have the maximum possible number of escorts.');
    });

    it('counts hired and captured escorts alike', () => {
        expect(countsTowardEscortCap(escort(PLAYER, 'hired'))).toBeTrue();
        expect(countsTowardEscortCap(escort(PLAYER, 'captured'))).toBeTrue();
        // An escort from a save that predates provenance reads as hired.
        expect(countsTowardEscortCap(escort(PLAYER))).toBeTrue();
        expect(cappedEscortCount(PLAYER, {
            world: world(escort(PLAYER, 'hired'), escort(PLAYER, 'hired'),
                escort(PLAYER, 'captured'), escort()),
        })).toBe(4);
    });

    it('never counts a bay fighter', () => {
        expect(countsTowardEscortCap(escort(PLAYER, 'hired', 'fighter')))
            .toBeFalse();
        // A wing of ten from the player's own bays, and a full hired
        // complement: still exactly six.
        const wing = Array.from({ length: 10 },
            () => escort(PLAYER, undefined, 'fighter'));
        const hired = Array.from({ length: 6 },
            () => escort(PLAYER, 'hired'));
        expect(cappedEscortCount(PLAYER, { world: world(...wing, ...hired) }))
            .toBe(6);
    });

    it('never counts a mission-granted escort', () => {
        expect(countsTowardEscortCap(escort(PLAYER, undefined, 'mission')))
            .toBeFalse();
        // Six hired plus three from a mission: the mission escorts are
        // in the world (they joined regardless), and the count is six.
        const hired = Array.from({ length: 6 },
            () => escort(PLAYER, 'hired'));
        const mission = Array.from({ length: 3 },
            () => escort(PLAYER, undefined, 'mission'));
        expect(cappedEscortCount(PLAYER, {
            world: world(...hired, ...mission),
        })).toBe(6);
    });

    it('counts only the named player\'s escorts, and only marked ones', () => {
        const stranger = new Entity();
        expect(cappedEscortCount(PLAYER, {
            world: world(escort(PLAYER, 'hired'),
                escort('someone else', 'hired'), stranger),
        })).toBe(1);
        expect(cappedEscortCount(PLAYER, { world: world() })).toBe(0);
        expect(cappedEscortCount(PLAYER, {})).toBe(0);
    });

    /**
     * The landing / take-off window (review of PR #212, finding 1): the
     * player docks first and the escorts follow over several seconds,
     * each leaving the world for the client's landed roster as it
     * touches down — under the SAME uuid. The count must not move while
     * a fleet crosses that window in either direction, and must not
     * count an escort twice when a frame has it in both places (the
     * display applies a landing event before the removal it rode with).
     */
    describe('across the landing and take-off window', () => {
        /** The fleet: five hired and one captured prize, with uuids. */
        function fleet(): [string, Entity][] {
            return [
                ...Array.from({ length: 5 }, (_, i): [string, Entity] =>
                    [`hired ${i}`, escort(PLAYER, 'hired')]),
                ['prize', escort(PLAYER, 'captured')],
            ];
        }
        function carried(entries: [string, Entity][],
            player = PLAYER): CarriedEscortEntry[] {
            return entries.map(([uuid, entity]) => ({ player, uuid, entity }));
        }

        it('counts an escort once wherever it is, all the way down', () => {
            const all = fleet();
            // Every step of the landing: k have touched down, the rest
            // are still on approach in the world.
            for (let landed = 0; landed <= all.length; landed++) {
                expect(cappedEscortCount(PLAYER, {
                    world: all.slice(landed),
                    carried: carried(all.slice(0, landed)),
                })).withContext(`${landed} landed`).toBe(6);
            }
        });

        it('counts a captured prize still on approach, which no payroll '
            + 'mirror would', () => {
                const all = fleet();
                const [prize] = all.filter(([uuid]) => uuid === 'prize');
                // Five hired have landed; the prize is the last one down.
                expect(cappedEscortCount(PLAYER, {
                    world: [prize],
                    carried: carried(all.filter(e => e !== prize)),
                })).toBe(6);
            });

        it('never counts an escort twice when a frame has it in both', () => {
            const all = fleet();
            const twice = all.slice(0, 2);
            expect(cappedEscortCount(PLAYER, {
                world: all, carried: carried(twice),
            })).toBe(6);
            expect(cappedEscortCount(PLAYER, {
                world: all, carried: carried(all),
            })).toBe(6);
        });

        it('drops an escort lost on the way down, freeing a slot', () => {
            const all = fleet();
            // The first three landed; one of the rest was shot down on
            // approach and is in neither place.
            expect(cappedEscortCount(PLAYER, {
                world: all.slice(4),
                carried: carried(all.slice(0, 3)),
            })).toBe(5);
        });

        it('adds this landing\'s hires, which have no entity yet', () => {
            const all = fleet();
            expect(cappedEscortCount(PLAYER, {
                world: [], carried: carried(all.slice(0, 5)), pending: 1,
            })).toBe(6);
            expect(cappedEscortCount(PLAYER, { pending: 2 })).toBe(2);
        });

        it('applies the counting rule to the roster as well', () => {
            const roster = carried([
                ['f', escort(PLAYER, 'hired', 'fighter')],
                ['m', escort(PLAYER, undefined, 'mission')],
                ['h', escort(PLAYER, 'hired')],
            ]);
            expect(cappedEscortCount(PLAYER, { carried: roster })).toBe(1);
            // Another player's roster entries are not this player's.
            expect(cappedEscortCount(PLAYER, {
                carried: carried([['h2', escort()]], 'someone else'),
            })).toBe(0);
        });

        it('reads the same on take-off, as the roster goes back in', () => {
            const all = fleet();
            for (let reinserted = 0; reinserted <= all.length; reinserted++) {
                expect(cappedEscortCount(PLAYER, {
                    world: all.slice(0, reinserted),
                    carried: carried(all.slice(reinserted)),
                })).withContext(`${reinserted} back in`).toBe(6);
            }
        });
    });
});
