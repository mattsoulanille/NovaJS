import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import {
    getDefaultProjectileWeaponData, WeaponData,
} from 'novadatainterface/weapon_data';
import { Entity } from 'nova_ecs/entity';
import {
    BayFighterComponent, ReturnWhenTargetRemovedComponent,
} from '../nova_plugin/bay_plugin.js';
import { DisabledComponent } from '../nova_plugin/disabled_component.js';
import { SourceComponent } from '../nova_plugin/fire_weapon_plugin.js';
import {
    ArmorComponent, FuelComponent, IonizationComponent, ShieldComponent,
} from '../nova_plugin/health_plugin.js';
import { IsIonizedComponent } from '../nova_plugin/ionization_plugin.js';
import {
    OutfitsState, OutfitsStateComponent,
} from '../nova_plugin/outfit_plugin.js';
import { Stat } from '../nova_plugin/stat.js';
import {
    RestockGameData, restockCarriedEscorts, restockEscortEntity,
} from './escort_restock.js';

function outfit(o: Partial<OutfitData> & { id: string }): OutfitData {
    return { ...getDefaultOutfitData(), ...o };
}

function launcherWeapon(w: Partial<WeaponData> & { id: string }): WeaponData {
    return { ...getDefaultProjectileWeaponData(), ...w } as WeaponData;
}

/** A game data stub over fixed outfit and weapon tables. */
function gameDataOf(outfits: OutfitData[], weapons: WeaponData[]):
    RestockGameData {
    const outfitMap = new Map(outfits.map(o => [o.id, o]));
    const weaponMap = new Map(weapons.map(w => [w.id, w]));
    return {
        getOutfit: async id => outfitMap.get(id),
        getWeapon: async id => weaponMap.get(id),
    };
}

function stat(current: number, max: number): Stat {
    return new Stat({ current, max, min: 0, recharge: 0 });
}

function escortEntity(outfits: OutfitsState, fuel?: Stat): Entity {
    const entity = new Entity('escort');
    entity.components.set(OutfitsStateComponent, outfits);
    if (fuel) {
        entity.components.set(FuelComponent, fuel);
    }
    return entity;
}

describe('escort restock', () => {
    it('refuels to full', async () => {
        const entity = escortEntity(new Map(), stat(17, 400));
        await restockEscortEntity(entity, gameDataOf([], []));
        expect(entity.components.get(FuelComponent)!.current).toEqual(400);
    });

    it('leaves an entity with no fuel stat alone', async () => {
        const entity = escortEntity(new Map());
        await restockEscortEntity(entity, gameDataOf([], []));
        expect(entity.components.has(FuelComponent)).toBeFalse();
    });

    /**
     * Matthew's playtest ruling: "escorts should repair and deionize when
     * landed." Free, for the same reason the fuel and ammo are (the hire
     * fee covers the pilot's own upkeep).
     */
    describe('the hull half of a port visit', () => {
        it('repairs armor and shields to full', async () => {
            const entity = escortEntity(new Map());
            entity.components.set(ArmorComponent, stat(12, 300));
            entity.components.set(ShieldComponent, stat(5, 120));

            await restockEscortEntity(entity, gameDataOf([], []));

            expect(entity.components.get(ArmorComponent)!.current)
                .toEqual(300);
            expect(entity.components.get(ShieldComponent)!.current)
                .toEqual(120);
        });

        it('bleeds off ionization and drops its derived flag', async () => {
            const entity = escortEntity(new Map());
            entity.components.set(IonizationComponent, stat(90, 100));
            entity.components.set(IsIonizedComponent, true);

            await restockEscortEntity(entity, gameDataOf([], []));

            expect(entity.components.get(IonizationComponent)!.current)
                .toEqual(0);
            // Deleted, not set: IonizedSystem owns that derived value and
            // recomputes it (and re-emits its event) from the zeroed stat.
            expect(entity.components.has(IsIonizedComponent)).toBeFalse();
        });

        it('brings a disabled escort back online', async () => {
            // A disabled escort should never reach a pad, but the roster
            // is durable state and a stray shot can land in the same tick
            // it is swept up. Coming back up disabled would strand it.
            const entity = escortEntity(new Map());
            entity.components.set(ArmorComponent, stat(1, 300));
            entity.components.set(DisabledComponent, { repairAt: null });

            await restockEscortEntity(entity, gameDataOf([], []));

            expect(entity.components.has(DisabledComponent)).toBeFalse();
            expect(entity.components.get(ArmorComponent)!.current)
                .toEqual(300);
        });

        it('leaves an entity with no health stats alone', async () => {
            const entity = escortEntity(new Map());
            await restockEscortEntity(entity, gameDataOf([], []));
            expect(entity.components.has(ArmorComponent)).toBeFalse();
            expect(entity.components.has(ShieldComponent)).toBeFalse();
            expect(entity.components.has(IonizationComponent)).toBeFalse();
        });

        it('repairs every escort in a landed batch', async () => {
            const first = escortEntity(new Map());
            first.components.set(ArmorComponent, stat(3, 100));
            const second = escortEntity(new Map());
            second.components.set(IonizationComponent, stat(50, 60));
            second.components.set(DisabledComponent, { repairAt: null });

            await restockCarriedEscorts(
                [{ uuid: 'a', entity: first }, { uuid: 'b', entity: second }],
                gameDataOf([], []));

            expect(first.components.get(ArmorComponent)!.current).toEqual(100);
            expect(second.components.get(IonizationComponent)!.current)
                .toEqual(0);
            expect(second.components.has(DisabledComponent)).toBeFalse();
        });
    });

    it('restocks ammo to launcher maxAmmo times the launcher count',
        async () => {
            // Two launchers aboard, each holding 10 rounds: capacity 20.
            const rocket = outfit({ id: 'ammo', ammoFor: 'launcher' });
            const launcherOutfit = outfit({
                id: 'launcherOutfit', weapons: { launcher: 1 },
            });
            const weapon = launcherWeapon({
                id: 'launcher', maxAmmo: 10, ammoType: ['weapon', 'launcher'],
            });
            const outfits: OutfitsState = new Map([
                ['ammo', { count: 3 }],
                ['launcherOutfit', { count: 2 }],
            ]);
            await restockEscortEntity(escortEntity(outfits),
                gameDataOf([rocket, launcherOutfit], [weapon]));
            expect(outfits.get('ammo')!.count).toEqual(20);
        });

    it('restocks to the SUPPLY weapon\'s instances, not its drawers\'',
        async () => {
            // The Nuke plug-in's shape (see ammoCapacity in
            // outfitter_rules.ts): the magazine is the outfit granting the
            // supply weapon 'rack' (MaxAmmo 8), while 'tube' merely fires
            // from that supply and holds nothing. Two racks and any number
            // of tubes hold 16 rounds.
            const nuke = outfit({ id: 'ammo', ammoFor: 'rack', max: 120 });
            const rackOutfit = outfit({
                id: 'rackOutfit', weapons: { rack: 1 },
            });
            const tubeOutfit = outfit({
                id: 'tubeOutfit', weapons: { tube: 1 },
            });
            const rack = launcherWeapon({ id: 'rack', maxAmmo: 8 });
            const tube = launcherWeapon({
                id: 'tube', maxAmmo: 0, ammoType: ['weapon', 'rack'],
            });
            const outfits: OutfitsState = new Map([
                ['ammo', { count: 1 }],
                ['rackOutfit', { count: 2 }],
                ['tubeOutfit', { count: 3 }],
            ]);
            await restockEscortEntity(escortEntity(outfits),
                gameDataOf([nuke, rackOutfit, tubeOutfit], [rack, tube]));
            expect(outfits.get('ammo')!.count).toEqual(16);
        });

    it('falls back to the outfit Max when the weapon has no maxAmmo',
        async () => {
            // maxAmmo 0 means "constrained by the ammo outfit's Max".
            const ammo = outfit({ id: 'ammo', ammoFor: 'gun', max: 50 });
            const weapon = launcherWeapon({ id: 'gun', maxAmmo: 0 });
            const outfits: OutfitsState = new Map([['ammo', { count: 4 }]]);
            await restockEscortEntity(escortEntity(outfits),
                gameDataOf([ammo], [weapon]));
            expect(outfits.get('ammo')!.count).toEqual(50);
        });

    it('applies increases-max items to the Max fallback', async () => {
        const ammo = outfit({ id: 'ammo', ammoFor: 'gun', max: 50 });
        const expander = outfit({ id: 'expander', increasesMax: 'ammo' });
        const weapon = launcherWeapon({ id: 'gun', maxAmmo: 0 });
        const outfits: OutfitsState = new Map([
            ['ammo', { count: 4 }], ['expander', { count: 3 }],
        ]);
        await restockEscortEntity(escortEntity(outfits),
            gameDataOf([ammo, expander], [weapon]));
        expect(outfits.get('ammo')!.count).toEqual(150);
    });

    it('leaves unlimited ammo (Max <= 0, no launcher cap) untouched',
        async () => {
            const ammo = outfit({ id: 'ammo', ammoFor: 'gun', max: 0 });
            const weapon = launcherWeapon({ id: 'gun', maxAmmo: 0 });
            const outfits: OutfitsState = new Map([['ammo', { count: 4 }]]);
            await restockEscortEntity(escortEntity(outfits),
                gameDataOf([ammo], [weapon]));
            expect(outfits.get('ammo')!.count).toEqual(4);
        });

    it("restores a carrier's fighter complement, which is ammo too",
        async () => {
            // A bay outfit is a launcher whose "ammo" is the fighter.
            const fighters = outfit({ id: 'fighters', ammoFor: 'bay' });
            const bayOutfit = outfit({ id: 'bayOutfit', weapons: { bay: 1 } });
            const bay = launcherWeapon({
                id: 'bay', maxAmmo: 4, ammoType: ['weapon', 'bay'],
            });
            // Two fighters were launched and lost: 2 of 4 left.
            const outfits: OutfitsState = new Map([
                ['fighters', { count: 2 }], ['bayOutfit', { count: 1 }],
            ]);
            await restockEscortEntity(escortEntity(outfits),
                gameDataOf([fighters, bayOutfit], [bay]));
            expect(outfits.get('fighters')!.count).toEqual(4);
        });

    it('never trims a magazine that is somehow overfull', async () => {
        const ammo = outfit({ id: 'ammo', ammoFor: 'gun', max: 10 });
        const weapon = launcherWeapon({ id: 'gun', maxAmmo: 0 });
        const outfits: OutfitsState = new Map([['ammo', { count: 25 }]]);
        await restockEscortEntity(escortEntity(outfits),
            gameDataOf([ammo], [weapon]));
        expect(outfits.get('ammo')!.count).toEqual(25);
    });

    it('leaves non-ammo outfits alone', async () => {
        const armorPlate = outfit({ id: 'plate', max: 4 });
        const outfits: OutfitsState = new Map([['plate', { count: 1 }]]);
        await restockEscortEntity(escortEntity(outfits),
            gameDataOf([armorPlate], []));
        expect(outfits.get('plate')!.count).toEqual(1);
    });

    /**
     * Two ammo outfits can supply ONE launcher — the bay data model does
     * exactly this, with several fighter outfits whose ammoFor is the same
     * bay. The launcher capacity is a single pool shared between them (the
     * outfitter gates the SUM; see ammoCapacity/ownedAmmoCount in
     * outfitter_rules.ts), so topping each supplying outfit to the full
     * capacity on its own fills the launcher twice over.
     */
    it('shares one launcher capacity across every supplying outfit',
        async () => {
            const ammoA = outfit({ id: 'ammoA', ammoFor: 'launcher' });
            const ammoB = outfit({ id: 'ammoB', ammoFor: 'launcher' });
            const launcherOutfit = outfit({
                id: 'launcherOutfit', weapons: { launcher: 1 },
            });
            const weapon = launcherWeapon({
                id: 'launcher', maxAmmo: 10, ammoType: ['weapon', 'launcher'],
            });
            const outfits: OutfitsState = new Map([
                ['ammoA', { count: 3 }],
                ['ammoB', { count: 2 }],
                ['launcherOutfit', { count: 1 }],
            ]);
            await restockEscortEntity(escortEntity(outfits),
                gameDataOf([ammoA, ammoB, launcherOutfit], [weapon]));
            // 10 rounds TOTAL, not 10 of each. The free space goes to the
            // lowest-sorted supplying outfit, matching the bay's own
            // consume/refund policy (bay_plugin).
            expect(outfits.get('ammoA')!.count).toEqual(8);
            expect(outfits.get('ammoB')!.count).toEqual(2);
        });

    it('adds nothing when the supplying outfits already fill the pool',
        async () => {
            const ammoA = outfit({ id: 'ammoA', ammoFor: 'launcher' });
            const ammoB = outfit({ id: 'ammoB', ammoFor: 'launcher' });
            const launcherOutfit = outfit({
                id: 'launcherOutfit', weapons: { launcher: 1 },
            });
            const weapon = launcherWeapon({
                id: 'launcher', maxAmmo: 6, ammoType: ['weapon', 'launcher'],
            });
            const outfits: OutfitsState = new Map([
                ['ammoA', { count: 4 }],
                ['ammoB', { count: 4 }],
                ['launcherOutfit', { count: 1 }],
            ]);
            await restockEscortEntity(escortEntity(outfits),
                gameDataOf([ammoA, ammoB, launcherOutfit], [weapon]));
            // Overfull already: a restock tops up, it never trims.
            expect(outfits.get('ammoA')!.count).toEqual(4);
            expect(outfits.get('ammoB')!.count).toEqual(4);
        });

    /**
     * A carrier escort that lands with its own fighters STILL DEPLOYED
     * (landing does not stow them — see landed_escorts.ts) used to be
     * restocked to full capacity, and the landed fighters then redeployed
     * on top of the fresh ones. A launched fighter still occupies its bay
     * slot, exactly as the outfitter's deployedCounts hook models it.
     */
    it('subtracts a carrier\'s still-deployed fighters from its bay ceiling',
        async () => {
            const fighters = outfit({ id: 'fighters', ammoFor: 'bay' });
            const bayOutfit = outfit({ id: 'bayOutfit', weapons: { bay: 1 } });
            const bay = launcherWeapon({
                id: 'bay', maxAmmo: 4, ammoType: ['weapon', 'bay'],
            });
            const outfits: OutfitsState = new Map([
                ['fighters', { count: 1 }], ['bayOutfit', { count: 1 }],
            ]);
            await restockEscortEntity(escortEntity(outfits),
                gameDataOf([fighters, bayOutfit], [bay]),
                new Map([['bay', 2]]));
            // Capacity 4, two fighters out: only two slots to fill.
            expect(outfits.get('fighters')!.count).toEqual(2);
        });

    it('charges deployed fighters only against the bay they came out of',
        async () => {
            const alpha = outfit({ id: 'alpha', ammoFor: 'bayA' });
            const beta = outfit({ id: 'beta', ammoFor: 'bayB' });
            const bayAOutfit = outfit({
                id: 'bayAOutfit', weapons: { bayA: 1 },
            });
            const bayBOutfit = outfit({
                id: 'bayBOutfit', weapons: { bayB: 1 },
            });
            const bayA = launcherWeapon({
                id: 'bayA', maxAmmo: 4, ammoType: ['weapon', 'bayA'],
            });
            const bayB = launcherWeapon({
                id: 'bayB', maxAmmo: 4, ammoType: ['weapon', 'bayB'],
            });
            const outfits: OutfitsState = new Map([
                ['alpha', { count: 0 }], ['beta', { count: 0 }],
                ['bayAOutfit', { count: 1 }], ['bayBOutfit', { count: 1 }],
            ]);
            await restockEscortEntity(escortEntity(outfits),
                gameDataOf([alpha, beta, bayAOutfit, bayBOutfit],
                    [bayA, bayB]),
                new Map([['bayA', 3]]));
            expect(outfits.get('alpha')!.count).toEqual(1);
            expect(outfits.get('beta')!.count).toEqual(4);
        });

    it('restocks a whole batch', async () => {
        const ammo = outfit({ id: 'ammo', ammoFor: 'gun', max: 9 });
        const weapon = launcherWeapon({ id: 'gun', maxAmmo: 0 });
        const first: OutfitsState = new Map([['ammo', { count: 1 }]]);
        const second: OutfitsState = new Map([['ammo', { count: 2 }]]);
        const batch = [
            { entity: escortEntity(first, stat(0, 300)) },
            { entity: escortEntity(second, stat(50, 300)) },
        ];
        await restockCarriedEscorts(batch, gameDataOf([ammo], [weapon]));
        expect(first.get('ammo')!.count).toEqual(9);
        expect(second.get('ammo')!.count).toEqual(9);
        for (const { entity } of batch) {
            expect(entity.components.get(FuelComponent)!.current).toEqual(300);
        }
    });

    /**
     * The batch-level half of the deployed-fighter ceiling: the roster
     * being restocked is where the still-deployed fighters are counted
     * from, because a landed roster is the complete set of ships that came
     * down together (a carrier escort's launched fighters land as roster
     * entries in their own right).
     */
    it('counts a landed roster\'s own deployed fighters against its carrier',
        async () => {
            const fighters = outfit({ id: 'fighters', ammoFor: 'bay' });
            const bayOutfit = outfit({ id: 'bayOutfit', weapons: { bay: 1 } });
            const bay = launcherWeapon({
                id: 'bay', maxAmmo: 4, ammoType: ['weapon', 'bay'],
            });
            const carrierOutfits: OutfitsState = new Map([
                ['fighters', { count: 0 }], ['bayOutfit', { count: 1 }],
            ]);
            const fighterEntry = (source: string) => {
                const entity = new Entity('fighter');
                entity.components.set(SourceComponent, source);
                entity.components.set(ReturnWhenTargetRemovedComponent,
                    undefined);
                entity.components.set(BayFighterComponent,
                    { bayWeaponId: 'bay' });
                return entity;
            };
            const batch = [
                { uuid: 'carrier', entity: escortEntity(carrierOutfits) },
                { uuid: 'f1', entity: fighterEntry('carrier') },
                { uuid: 'f2', entity: fighterEntry('carrier') },
                // Another carrier's fighter must not shrink this bay.
                { uuid: 'f3', entity: fighterEntry('somebody else') },
            ];
            await restockCarriedEscorts(batch,
                gameDataOf([fighters, bayOutfit], [bay]));
            // Capacity 4 minus the carrier's own two still-deployed
            // fighters. Restocking to 4 would put it 2 over capacity the
            // moment those two came back out with it.
            expect(carrierOutfits.get('fighters')!.count).toEqual(2);
        });
});
