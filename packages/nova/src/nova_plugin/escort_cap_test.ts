import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from './bay_plugin.js';
import {
    cappedEscortsInWorld, countsTowardEscortCap, MAX_ESCORTS,
    MAX_ESCORTS_MESSAGE,
} from './escort_cap.js';
import { MissionShipComponent } from './mission_ship_plugin.js';
import { EscortProvenance, PlayerEscortComponent } from './player_escort.js';

/**
 * Maintainer ruling #161: six escorts, counting only the ones the player
 * hired or captured. Mission-granted escorts and bay fighters neither
 * count nor are limited. The bar (spaceport/hire_escort_test) and the
 * plunder session (boarding_plugin_test) each pin their refusal; this
 * pins the number and the counting rule they share.
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
        expect(cappedEscortsInWorld(world(
            escort(PLAYER, 'hired'), escort(PLAYER, 'hired'),
            escort(PLAYER, 'captured'), escort()), PLAYER)).toBe(4);
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
        expect(cappedEscortsInWorld(world(...wing, ...hired), PLAYER)).toBe(6);
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
        expect(cappedEscortsInWorld(world(...hired, ...mission), PLAYER))
            .toBe(6);
    });

    it('counts only the named player\'s escorts, and only marked ones', () => {
        const stranger = new Entity();
        expect(cappedEscortsInWorld(world(
            escort(PLAYER, 'hired'), escort('someone else', 'hired'),
            stranger), PLAYER)).toBe(1);
        expect(cappedEscortsInWorld(world(), PLAYER)).toBe(0);
    });
});
