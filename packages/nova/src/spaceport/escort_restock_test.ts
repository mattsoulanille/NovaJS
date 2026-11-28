import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import {
    getDefaultShipData, getDefaultShipPhysics, ShipData,
} from 'novadatainterface/ship_data';
import {
    getDefaultProjectileWeaponData, WeaponData,
} from 'novadatainterface/weapon_data';
import { Entity } from 'nova_ecs/entity';
import {
    BayFighterComponent, ReturnWhenTargetRemovedComponent,
} from '../nova_plugin/escorts/index.js';
import {
    DisabledComponent, ArmorComponent, FuelComponent, IonizationComponent, ShieldComponent,
    IsIonizedComponent, OutfitsState, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { SourceComponent } from '../nova_plugin/combat/index.js';
import { Stat } from '../nova_plugin/core/index.js';
import {
    NO_DEAL, PlayerEscort, PlayerEscortComponent,
} from '../nova_plugin/player/index.js';
import {
    RestockGameData, restockCarriedEscorts, restockEscortEntity,
    takeMissingAmmoStock,
} from './escort_restock.js';

function outfit(o: Partial<OutfitData> & { id: string }): OutfitData {
    return { ...getDefaultOutfitData(), ...o };
}

function launcherWeapon(w: Partial<WeaponData> & { id: string }): WeaponData {
    return { ...getDefaultProjectileWeaponData(), ...w } as WeaponData;
}

/** A game data stub over fixed outfit, weapon and ship tables. */
function gameDataOf(outfits: OutfitData[], weapons: WeaponData[],
    ships: ShipData[] = []): RestockGameData {
    const outfitMap = new Map(outfits.map(o => [o.id, o]));
    const weaponMap = new Map(weapons.map(w => [w.id, w]));
    const shipMap = new Map(ships.map(s => [s.id, s]));
    return {
        getOutfit: async id => outfitMap.get(id),
        getWeapon: async id => weaponMap.get(id),
        getShip: async id => shipMap.get(id),
    };
}

/** A hull class with `freeMass` tons of outfit space and a 100-ton hull,
 * stocking `outfits` (its shïp resource's loadout). */
function hull(id: string, freeMass: number,
    outfits: Record<string, number> = {}): ShipData {
    return {
        ...getDefaultShipData(), id, outfits,
        physics: { ...getDefaultShipPhysics(), mass: 100, freeMass },
    };
}

/** A hired escort of hull class `shipId`, carrying `outfits`. */
function hiredEscort(shipId: string, outfits: OutfitsState): Entity {
    const entity = escortEntity(outfits);
    entity.components.set(ShipComponent, { id: shipId });
    return entity;
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

    /**
     * Matthew (2026-11-27): landing refills a hired escort to its ship
     * VARIANT's default ammo, the counts its shïp resource stocks, not the
     * most its magazines could hold: "a Fed Viper should come back with 6
     * IR missiles, not 200". The same loadout a docked bay craft relaunches
     * with (escorts/bay_plugin.ts).
     */
    describe('a hired escort refills to its hull class\'s stock loadout',
        () => {
            const IR = 'ir';
            const irMissile = outfit({
                id: IR, ammoFor: 'irLauncher', max: 200,
            });
            const irRack = outfit({
                id: 'irRack', weapons: { irLauncher: 2 },
            });
            // MaxAmmo 0: the oütf Max (200) would be the capacity.
            const irLauncher = launcherWeapon({
                id: 'irLauncher', maxAmmo: 0,
            });
            const viper = hull('viper', 50, { irRack: 1, [IR]: 6 });
            const data = gameDataOf([irMissile, irRack], [irLauncher],
                [viper]);
            const missiles = (entity: Entity) =>
                entity.components.get(OutfitsStateComponent)!.get(IR)?.count;

            it('back to its 6 after firing them, not the oütf Max of 200',
                async () => {
                    const escort = hiredEscort('viper', new Map([
                        ['irRack', { count: 1 }], [IR, { count: 1 }],
                    ]));
                    await restockEscortEntity(escort, data);
                    expect(missiles(escort)).toEqual(6);
                });

            it('brings back an outfit spent to nothing and dropped',
                async () => {
                    const escort = hiredEscort('viper', new Map([
                        ['irRack', { count: 1 }],
                    ]));
                    await restockEscortEntity(escort, data);
                    expect(missiles(escort)).toEqual(6);
                });

            it('trims a magazine an earlier build filled to capacity back '
                + 'to the stock count', async () => {
                    const escort = hiredEscort('viper', new Map([
                        ['irRack', { count: 1 }], [IR, { count: 200 }],
                    ]));
                    await restockEscortEntity(escort, data);
                    expect(missiles(escort)).toEqual(6);
                });

            it('ignores a launcher\'s MaxAmmo too', async () => {
                // Two launchers of 10: capacity 20, stock 3.
                const rocket = outfit({ id: 'ammo', ammoFor: 'launcher' });
                const launcherOutfit = outfit({
                    id: 'launcherOutfit', weapons: { launcher: 1 },
                });
                const weapon = launcherWeapon({
                    id: 'launcher', maxAmmo: 10,
                    ammoType: ['weapon', 'launcher'],
                });
                const outfits: OutfitsState = new Map([
                    ['ammo', { count: 0 }], ['launcherOutfit', { count: 2 }],
                ]);
                await restockEscortEntity(hiredEscort('boat', outfits),
                    gameDataOf([rocket, launcherOutfit], [weapon], [
                        hull('boat', 50, { launcherOutfit: 2, ammo: 3 }),
                    ]));
                expect(outfits.get('ammo')!.count).toEqual(3);
            });

            it('leaves an escort whose hull class is unknown as it is',
                async () => {
                    const outfits: OutfitsState = new Map([
                        ['irRack', { count: 1 }], [IR, { count: 1 }],
                    ]);
                    await restockEscortEntity(escortEntity(outfits), data);
                    expect(outfits.get(IR)!.count).toEqual(1);
                });

            it('leaves ammo its hull class does not stock alone', async () => {
                const other = outfit({ id: 'other', ammoFor: 'irLauncher' });
                const escort = hiredEscort('viper', new Map([
                    ['irRack', { count: 1 }], [IR, { count: 6 }],
                    ['other', { count: 40 }],
                ]));
                await restockEscortEntity(escort, gameDataOf(
                    [irMissile, irRack, other], [irLauncher], [viper]));
                expect(escort.components.get(OutfitsStateComponent)!
                    .get('other')!.count).toEqual(40);
                expect(missiles(escort)).toEqual(6);
            });
        });

    it('leaves non-ammo outfits alone', async () => {
        const armorPlate = outfit({ id: 'plate', max: 4 });
        const outfits: OutfitsState = new Map([['plate', { count: 1 }]]);
        await restockEscortEntity(hiredEscort('boat', outfits),
            gameDataOf([armorPlate], [], [hull('boat', 50, { plate: 3 })]));
        expect(outfits.get('plate')!.count).toEqual(1);
    });

    describe('a carrier escort\'s fighters (ammo too)', () => {
        const fighters = outfit({ id: 'fighters', ammoFor: 'bay' });
        const bayOutfit = outfit({ id: 'bayOutfit', weapons: { bay: 1 } });
        // MaxAmmo 6: room for more than the 4 the class stocks.
        const bay = launcherWeapon({
            id: 'bay', maxAmmo: 6, ammoType: ['weapon', 'bay'],
        });
        const carrier = hull('carrier', 50, { bayOutfit: 1, fighters: 4 });
        const data = gameDataOf([fighters, bayOutfit], [bay], [carrier]);

        it('restores the stock complement, not the bay\'s capacity',
            async () => {
                // Two fighters were launched and lost: 2 of 4 left.
                const outfits: OutfitsState = new Map([
                    ['fighters', { count: 2 }], ['bayOutfit', { count: 1 }],
                ]);
                await restockEscortEntity(hiredEscort('carrier', outfits),
                    data);
                expect(outfits.get('fighters')!.count).toEqual(4);
            });

        /**
         * A carrier escort that lands with its own fighters STILL DEPLOYED
         * (landing does not stow them — see landed_escorts.ts) would
         * otherwise be restocked to its full complement and the landed
         * fighters redeploy on top of the fresh ones. A launched fighter
         * still occupies its bay slot, as the outfitter's deployedCounts
         * hook models it.
         */
        it('subtracts its still-deployed fighters from the target',
            async () => {
                const outfits: OutfitsState = new Map([
                    ['fighters', { count: 1 }], ['bayOutfit', { count: 1 }],
                ]);
                await restockEscortEntity(hiredEscort('carrier', outfits),
                    data, new Map([['bay', 2]]));
                // Stock 4, two fighters out: two aboard.
                expect(outfits.get('fighters')!.count).toEqual(2);
            });

        it('trims an over-stock bay to the slots its deployed fighters '
            + 'leave', async () => {
                // 4 aboard and 2 out of a stock 4 (an earlier build's
                // capacity fill): back to the 2 slots left.
                const outfits: OutfitsState = new Map([
                    ['fighters', { count: 4 }], ['bayOutfit', { count: 1 }],
                ]);
                await restockEscortEntity(hiredEscort('carrier', outfits),
                    data, new Map([['bay', 2]]));
                expect(outfits.get('fighters')!.count).toEqual(2);
            });

        it('counts a landed roster\'s own deployed fighters against its '
            + 'carrier', async () => {
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
                    { uuid: 'carrier',
                        entity: hiredEscort('carrier', carrierOutfits) },
                    { uuid: 'f1', entity: fighterEntry('carrier') },
                    { uuid: 'f2', entity: fighterEntry('carrier') },
                    // Another carrier's fighter must not shrink this bay.
                    { uuid: 'f3', entity: fighterEntry('somebody else') },
                ];
                await restockCarriedEscorts(batch, data);
                // Stock 4 minus the carrier's own two still out.
                expect(carrierOutfits.get('fighters')!.count).toEqual(2);
            });
    });

    /**
     * Two ammo outfits can supply ONE launcher — the bay data model does
     * exactly this, with several fighter outfits whose ammoFor is the same
     * bay. Each refills to its own stock count, and the deployed rounds come
     * off the group in sorted id order (bay_plugin's spend/refund order).
     */
    it('refills each supplying outfit of one launcher to its own stock',
        async () => {
            const ammoA = outfit({ id: 'ammoA', ammoFor: 'bay' });
            const ammoB = outfit({ id: 'ammoB', ammoFor: 'bay' });
            const bayOutfit = outfit({ id: 'bayOutfit', weapons: { bay: 1 } });
            const bay = launcherWeapon({
                id: 'bay', maxAmmo: 10, ammoType: ['weapon', 'bay'],
            });
            const outfits: OutfitsState = new Map([
                ['ammoA', { count: 0 }], ['ammoB', { count: 0 }],
                ['bayOutfit', { count: 1 }],
            ]);
            await restockEscortEntity(hiredEscort('carrier', outfits),
                gameDataOf([ammoA, ammoB, bayOutfit], [bay], [
                    hull('carrier', 50, { bayOutfit: 1, ammoA: 2, ammoB: 3 }),
                ]), new Map([['bay', 1]]));
            // Stock 2 + 3, one out: 4 aboard, filled in sorted id order
            // (the owned refill's order too), so the last is the short one.
            expect(outfits.get('ammoA')!.count).toEqual(2);
            expect(outfits.get('ammoB')!.count).toEqual(2);
        });

    it('restocks a whole batch', async () => {
        const ammo = outfit({ id: 'ammo', ammoFor: 'gun', max: 90 });
        const weapon = launcherWeapon({ id: 'gun', maxAmmo: 0 });
        const first: OutfitsState = new Map([['ammo', { count: 1 }]]);
        const second: OutfitsState = new Map([['ammo', { count: 2 }]]);
        const batch = [
            { entity: hiredEscort('boat', first) },
            { entity: hiredEscort('boat', second) },
        ];
        batch[0].entity.components.set(FuelComponent, stat(0, 300));
        batch[1].entity.components.set(FuelComponent, stat(50, 300));
        await restockCarriedEscorts(batch, gameDataOf([ammo], [weapon],
            [hull('boat', 50, { ammo: 9 })]));
        expect(first.get('ammo')!.count).toEqual(9);
        expect(second.get('ammo')!.count).toEqual(9);
        for (const { entity } of batch) {
            expect(entity.components.get(FuelComponent)!.current).toEqual(300);
        }
    });

    /**
     * Playtest 2026-11-24 (Matthew, plug-in "More Blasters CHEAT"): after a
     * swap he owned 32,000 "Hyperioid cell sample" with -31,951 tons free.
     * Its Hyperioid (shïp 171 override) ships with 4 of them: ammo (oütf
     * 520) for the hull's Space Crane (wëap 248, MaxAmmo 0, so the oütf Max
     * of 32000 is the count ceiling), 1 ton each, and the stock loadout
     * leaves the hull no free mass. A landing topped it to 32000, and
     * swapping into the escort handed the player the pile. A purchase stops
     * at the hull's free mass, and so does the restock.
     */
    describe('the hull\'s free mass', () => {
        const SAMPLE = 'More Blasters CHEAT:520';
        const CRANE = 'More Blasters CHEAT:248';
        const sample = outfit({
            id: SAMPLE, ammoFor: CRANE, max: 32000, physics: { freeMass: 1 },
        });
        const craneOutfit = outfit({
            id: 'More Blasters CHEAT:526', weapons: { [CRANE]: 1 },
        });
        const crane = launcherWeapon({
            id: CRANE, maxAmmo: 0, ammoType: ['weapon', CRANE],
        });
        // 19 t free; the hull's 15-ton gun (nova:230) and the 4 samples
        // use all of it, as in the data.
        const gun = outfit({ id: 'nova:230', physics: { freeMass: 15 } });
        const data = gameDataOf([sample, craneOutfit, gun], [crane],
            [hull('nova:171', 19, {
                'nova:230': 1, 'More Blasters CHEAT:526': 1, [SAMPLE]: 4,
            })]);

        function hyperioidEscort(samples: number): Entity {
            const entity = escortEntity(new Map([
                ['nova:230', { count: 1 }],
                ['More Blasters CHEAT:526', { count: 1 }],
                [SAMPLE, { count: samples }],
            ]));
            entity.components.set(ShipComponent, { id: 'nova:171' });
            return entity;
        }
        const samplesOf = (entity: Entity) =>
            entity.components.get(OutfitsStateComponent)!.get(SAMPLE)!.count;

        it('does not fill a full hull to the oütf Max (the 32000 pile)',
            async () => {
                const entity = hyperioidEscort(4);
                await restockEscortEntity(entity, data);
                expect(samplesOf(entity)).toEqual(4);
            });

        it('fills only as many massive rounds as the free mass holds',
            async () => {
                // Spent 3 of the 4: 3 tons free again, and 3 refill.
                const entity = hyperioidEscort(1);
                await restockEscortEntity(entity, data);
                expect(samplesOf(entity)).toEqual(4);
            });

        /**
         * The two rules compose for an OWNED escort: it refills to
         * min(its ammoStock snapshot, what fits the free mass).
         */
        describe('for an owned escort', () => {
            function owned(samples: number, snapshot: number): Entity {
                const entity = hyperioidEscort(samples);
                entity.components.set(PlayerEscortComponent, {
                    player: 'p', parent: 'p', provenance: 'captured',
                    deal: NO_DEAL, ammoStock: [[SAMPLE, snapshot]],
                });
                return entity;
            }

            it('refills to the snapshot when it fits', async () => {
                const entity = owned(1, 3);
                await restockEscortEntity(entity, data);
                // 3 tons free: the snapshot of 3, not 4 (all that fits).
                expect(samplesOf(entity)).toEqual(3);
            });

            it('stops at the free mass below a larger snapshot', async () => {
                const entity = owned(1, 10);
                await restockEscortEntity(entity, data);
                expect(samplesOf(entity)).toEqual(4);
            });
        });

        it('trims a hired escort\'s 32000 pile back to its stock 4',
            async () => {
                // A hired escort refills to exactly its hull class's stock
                // (Matthew, 2026-11-27), so an earlier build's pile heals.
                const entity = hyperioidEscort(32000);
                await restockEscortEntity(entity, data);
                expect(samplesOf(entity)).toEqual(4);
            });

        it('stops at the free mass below a hired escort\'s stock',
            async () => {
                // Something else aboard grew: a second 15-ton gun leaves
                // the hull 15 t short, so none of the 3 spent samples fit.
                const entity = hyperioidEscort(1);
                entity.components.get(OutfitsStateComponent)!
                    .get('nova:230')!.count = 2;
                await restockEscortEntity(entity, data);
                expect(samplesOf(entity)).toEqual(1);
            });

        it('applies to a launcher\'s ammo too', async () => {
            const torpedo = outfit({
                id: 'torp', ammoFor: 'tube', physics: { freeMass: 4 },
            });
            const tubeOutfit = outfit({
                id: 'tubeOutfit', weapons: { tube: 2 },
            });
            const tube = launcherWeapon({
                id: 'tube', maxAmmo: 10, ammoType: ['weapon', 'tube'],
            });
            const entity = escortEntity(new Map([
                ['torp', { count: 8 }], ['tubeOutfit', { count: 1 }],
            ]));
            entity.components.set(ShipComponent, { id: 'destroyer' });
            // 50 t free, 32 t of torpedoes aboard: 18 t left, 4 more fit
            // (the stock alone would take 12 more).
            // The class stocks 20 (more than its hull holds, so the gate
            // shows).
            await restockEscortEntity(entity, gameDataOf(
                [torpedo, tubeOutfit], [tube],
                [hull('destroyer', 50, { torp: 20, tubeOutfit: 1 })]));
            expect(entity.components.get(OutfitsStateComponent)!
                .get('torp')!.count).toEqual(12);
        });

        it('spends the mass across ammo types in fill order', async () => {
            const heavy = outfit({
                id: 'a-heavy', ammoFor: 'gunA', max: 100,
                physics: { freeMass: 2 },
            });
            const light = outfit({
                id: 'b-light', ammoFor: 'gunB', max: 100,
                physics: { freeMass: 1 },
            });
            const entity = escortEntity(new Map([
                ['a-heavy', { count: 0 }], ['b-light', { count: 0 }],
            ]));
            entity.components.set(ShipComponent, { id: 'boat' });
            await restockEscortEntity(entity, gameDataOf([heavy, light], [
                launcherWeapon({ id: 'gunA', maxAmmo: 0 }),
                launcherWeapon({ id: 'gunB', maxAmmo: 0 }),
            ], [hull('boat', 11, { 'a-heavy': 100, 'b-light': 100 })]));
            const outfits = entity.components.get(OutfitsStateComponent)!;
            // gunA first (sorted): 5 heavy rounds take 10 t, 1 light fits.
            expect(outfits.get('a-heavy')!.count).toEqual(5);
            expect(outfits.get('b-light')!.count).toEqual(1);
        });

        it('does not limit massless ammo', async () => {
            const missile = outfit({ id: 'ir', ammoFor: 'irGun', max: 200 });
            const entity = escortEntity(new Map([['ir', { count: 5 }]]));
            entity.components.set(ShipComponent, { id: 'lightning' });
            await restockEscortEntity(entity, gameDataOf([missile],
                [launcherWeapon({ id: 'irGun', maxAmmo: 0 })],
                [hull('lightning', 0, { ir: 200 })]));
            expect(entity.components.get(OutfitsStateComponent)!
                .get('ir')!.count).toEqual(200);
        });
    });
});

/**
 * Matthew's ruling (2026-11-24): an OWNED escort — provenance 'captured',
 * the player's own hull — rearms back up to the ammoStock snapshot taken
 * when it became an escort, never to capacity. Hired escorts are the
 * stock-loadout specs above.
 */
describe('owned escort restock', () => {
    const missile = outfit({ id: 'missile', ammoFor: 'launcher' });
    const launcherOutfit = outfit({ id: 'rack', weapons: { launcher: 1 } });
    const launcher = launcherWeapon({ id: 'launcher', maxAmmo: 20 });
    const data = () => gameDataOf([missile, launcherOutfit], [launcher]);

    function owned(outfits: OutfitsState,
        ammoStock?: [string, number][], fuel?: Stat): Entity {
        const entity = escortEntity(outfits, fuel);
        const marker: PlayerEscort = {
            player: 'p', parent: 'p', provenance: 'captured', deal: NO_DEAL,
            ...(ammoStock ? { ammoStock } : {}),
        };
        entity.components.set(PlayerEscortComponent, marker);
        return entity;
    }

    it('refills back up to the snapshot, not to capacity', async () => {
        const outfits: OutfitsState = new Map([
            ['rack', { count: 1 }], ['missile', { count: 0 }],
        ]);
        await restockEscortEntity(owned(outfits, [['missile', 7]]), data());
        expect(outfits.get('missile')!.count).toEqual(7);
    });

    it('never trims ammo above the snapshot', async () => {
        const outfits: OutfitsState = new Map([
            ['rack', { count: 1 }], ['missile', { count: 12 }],
        ]);
        await restockEscortEntity(owned(outfits, [['missile', 7]]), data());
        expect(outfits.get('missile')!.count).toEqual(12);
    });

    it('brings back an ammo outfit that was spent out of the map',
        async () => {
            const outfits: OutfitsState = new Map([['rack', { count: 1 }]]);
            await restockEscortEntity(owned(outfits, [['missile', 3]]),
                data());
            expect(outfits.get('missile')!.count).toEqual(3);
        });

    it('leaves an ammo outfit the snapshot does not name alone',
        async () => {
            const outfits: OutfitsState = new Map([
                ['rack', { count: 1 }], ['missile', { count: 2 }],
            ]);
            await restockEscortEntity(owned(outfits, []), data());
            expect(outfits.get('missile')!.count).toEqual(2);
        });

    it('still refuels and repairs the hull', async () => {
        const entity = owned(new Map(), [], stat(5, 300));
        entity.components.set(ArmorComponent, stat(10, 100));
        await restockEscortEntity(entity, data());
        expect(entity.components.get(FuelComponent)!.current).toEqual(300);
        expect(entity.components.get(ArmorComponent)!.current).toEqual(100);
    });

    it('counts its deployed fighters against the snapshot', async () => {
        const fighters = outfit({ id: 'fighters', ammoFor: 'bay' });
        const bayOutfit = outfit({ id: 'bayOutfit', weapons: { bay: 1 } });
        const bay = launcherWeapon({ id: 'bay', maxAmmo: 8 });
        const outfits: OutfitsState = new Map([
            ['bayOutfit', { count: 1 }], ['fighters', { count: 0 }],
        ]);
        await restockEscortEntity(owned(outfits, [['fighters', 4]]),
            gameDataOf([fighters, bayOutfit], [bay]), new Map([['bay', 3]]));
        // Four in the bay when it became an escort, three still out:
        // one goes back in, not four (and not the bay's eight).
        expect(outfits.get('fighters')!.count).toEqual(1);
    });

    it('fills each of two outfits feeding one bay to its own count',
        async () => {
            const a = outfit({ id: 'a', ammoFor: 'bay' });
            const b = outfit({ id: 'b', ammoFor: 'bay' });
            const bay = launcherWeapon({ id: 'bay', maxAmmo: 10 });
            const outfits: OutfitsState = new Map([
                ['a', { count: 5 }], ['b', { count: 0 }],
            ]);
            // 'a' is over its snapshot; that does not stop 'b' refilling.
            await restockEscortEntity(owned(outfits, [['a', 2], ['b', 3]]),
                gameDataOf([a, b], [bay]));
            expect(outfits.get('a')!.count).toEqual(5);
            expect(outfits.get('b')!.count).toEqual(3);
        });

    it('takes its current counts as the target when it has no snapshot '
        + '(a save from before the rule) and adds nothing', async () => {
        const outfits: OutfitsState = new Map([
            ['rack', { count: 1 }], ['missile', { count: 4 }],
        ]);
        const entity = owned(outfits);
        await restockEscortEntity(entity, data());
        expect(outfits.get('missile')!.count).toEqual(4);
        expect(entity.components.get(PlayerEscortComponent)!.ammoStock)
            .toEqual([['missile', 4]]);
        // From then on it refills back up to that.
        outfits.get('missile')!.count = 1;
        await restockEscortEntity(entity, data());
        expect(outfits.get('missile')!.count).toEqual(4);
    });

    it('takeMissingAmmoStock leaves hired escorts and existing snapshots '
        + 'alone', async () => {
        const hired = escortEntity(new Map([['missile', { count: 1 }]]));
        hired.components.set(PlayerEscortComponent, {
            player: 'p', deal: NO_DEAL, provenance: 'hired',
        });
        expect(await takeMissingAmmoStock(hired, data())).toBeFalse();
        expect(hired.components.get(PlayerEscortComponent)!.ammoStock)
            .toBeUndefined();

        const stamped = owned(new Map([['missile', { count: 1 }]]),
            [['missile', 9]]);
        expect(await takeMissingAmmoStock(stamped, data())).toBeFalse();
        expect(stamped.components.get(PlayerEscortComponent)!.ammoStock)
            .toEqual([['missile', 9]]);
    });

    it('a hired escort still refills to its class\'s stock', async () => {
        const outfits: OutfitsState = new Map([
            ['rack', { count: 1 }], ['missile', { count: 0 }],
        ]);
        const entity = escortEntity(outfits);
        entity.components.set(ShipComponent, { id: 'boat' });
        entity.components.set(PlayerEscortComponent, {
            player: 'p', deal: NO_DEAL, provenance: 'hired',
            // Even a stray snapshot does not make a hire owned.
            ammoStock: [['missile', 3]],
        });
        // Not the snapshot's 3, nor the launcher's 20: the class's 9.
        await restockEscortEntity(entity, gameDataOf(
            [missile, launcherOutfit], [launcher],
            [hull('boat', 50, { rack: 1, missile: 9 })]));
        expect(outfits.get('missile')!.count).toEqual(9);
    });
});
