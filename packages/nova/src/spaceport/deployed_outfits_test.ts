import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from '../nova_plugin/escorts/index.js';
import { SourceComponent } from '../nova_plugin/combat/index.js';
import {
    countDeployedFighters, countLandedFighters, mergeDeployedCounts,
} from './deployed_outfits.js';

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

describe('countDeployedFighters and countLandedFighters agree', () => {
    const OTHER_BAY = 'nova:150';
    const getOutfit = outfitLookup({
        'nova:158': { ammoFor: BAY },
        'nova:160': { ammoFor: OTHER_BAY },
    });
    const ESCORT = 'carrier-escort-uuid';

    /** One cast of fighters, every case either counter distinguishes:
     * the player's own (two bays), a carrier escort's Dart on the bay
     * the player ALSO mounts, a fighter launched by one of the player's
     * own fighters, and another player's. */
    const cast: [string, string][] = [
        ['own-1', PLAYER],
        ['own-2', PLAYER],
        ['escorts-dart', ESCORT],
        ['nested', 'own-1'],
        ['theirs', 'other-player'],
    ];
    const bayOf = (name: string) => name === 'own-2' ? OTHER_BAY : BAY;

    it('count the same fighters whether they are in flight or landed', () => {
        const inFlight = new Map<string, Entity>(cast.map(([name, source]) =>
            [name, landedFighter(PLAYER, source, bayOf(name)).entity]));
        // An escort entity in flight, owned by the player: the old
        // owner-chain walk would have charged its Dart to the player.
        inFlight.set(ESCORT, new Entity().addComponent(SourceComponent, PLAYER));
        const roster = cast.map(([name, source]) =>
            landedFighter(source === 'other-player' ? source : PLAYER, source,
                bayOf(name)));

        const owned = ['nova:158', 'nova:160'];
        const flying = countDeployedFighters(inFlight, PLAYER, getOutfit)(owned);
        const landed = countLandedFighters(() => roster, PLAYER, getOutfit)(
            owned);
        const expected = new Map([['nova:158', 1], ['nova:160', 1]]);
        expect(flying).toEqual(expected);
        expect(landed).toEqual(expected);
    });
});
