import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from '../nova_plugin/escorts/bay_plugin.js';
import { SourceComponent } from '../nova_plugin/combat/fire_weapon_plugin.js';
import { countLandedFighters, mergeDeployedCounts } from './deployed_outfits.js';

const PLAYER = 'player-uuid';
const BAY = 'nova:149';

function outfitLookup(map: Record<string, Partial<OutfitData>>) {
    return (id: string): OutfitData | undefined => {
        const partial = map[id];
        return partial ? { ...getDefaultOutfitData(), id, ...partial }
            : undefined;
    };
}

/** A landed roster entry: a fighter launched from `source`'s bay. */
function landedFighter(player: string, source: string,
    bayWeaponId = BAY) {
    const entity = new Entity()
        .addComponent(BayFighterComponent, { bayWeaponId })
        .addComponent(SourceComponent, source);
    return { player, entity };
}

describe('countLandedFighters (landed-roster outfitter counts)', () => {
    const getOutfit = outfitLookup({
        'nova:158': { ammoFor: BAY },
    });

    it('counts the docked player\'s own landed fighters by ammo outfit', () => {
        const roster = [
            landedFighter(PLAYER, PLAYER),
            landedFighter(PLAYER, PLAYER),
        ];
        const counts = countLandedFighters(() => roster, PLAYER, getOutfit)(
            ['nova:158']);
        expect(counts.get('nova:158')).toEqual(2);
    });

    it('ignores other players\' entries and non-fighter escorts', () => {
        const hiredEscort = {
            player: PLAYER,
            entity: new Entity(), // No BayFighterComponent.
        };
        const roster = [
            landedFighter('other-player', 'other-player'),
            hiredEscort,
            landedFighter(PLAYER, PLAYER),
        ];
        const counts = countLandedFighters(() => roster, PLAYER, getOutfit)(
            ['nova:158']);
        expect(counts.get('nova:158')).toEqual(1);
    });

    it('ignores fighters launched from a carrier ESCORT\'s bays', () => {
        // That fighter draws on the escort's own outfits, which travel
        // inside the escort's carried entity, not the player's outfitter.
        const roster = [landedFighter(PLAYER, 'carrier-escort-uuid')];
        const counts = countLandedFighters(() => roster, PLAYER, getOutfit)(
            ['nova:158']);
        expect(counts.size).toEqual(0);
    });

    it('attributes to the lowest-sorted owned outfit, like consumeAmmo', () => {
        const twoSupplies = outfitLookup({
            'nova:158': { ammoFor: BAY },
            'nova:070': { ammoFor: BAY },
        });
        const roster = [landedFighter(PLAYER, PLAYER)];
        const counts = countLandedFighters(() => roster, PLAYER, twoSupplies)(
            ['nova:158', 'nova:070']);
        expect(counts.get('nova:070')).toEqual(1);
        expect(counts.has('nova:158')).toBeFalse();
    });

    it('reads the roster live: a fighter landing mid-visit starts counting', () => {
        const roster: { player: string, entity: Entity }[] = [];
        const provider = countLandedFighters(() => roster, PLAYER, getOutfit);
        expect(provider(['nova:158']).size).toEqual(0);
        roster.push(landedFighter(PLAYER, PLAYER));
        expect(provider(['nova:158']).get('nova:158')).toEqual(1);
    });

    it('composes with other providers through mergeDeployedCounts', () => {
        const roster = [landedFighter(PLAYER, PLAYER)];
        const inFlight = () => new Map([['nova:158', 2]]);
        const merged = mergeDeployedCounts(
            inFlight, countLandedFighters(() => roster, PLAYER, getOutfit));
        expect(merged(['nova:158']).get('nova:158')).toEqual(3);
    });
});
