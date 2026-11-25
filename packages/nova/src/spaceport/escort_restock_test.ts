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
    RestockGameData, restockCarriedEscorts, restockEscortEntity,
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

/** A hull class with `freeMass` tons of outfit space and a 100-ton hull. */
function hull(id: string, freeMass: number): ShipData {
    return {
        ...getDefaultShipData(), id,
        physics: { ...getDefaultShipPhysics(), mass: 100, freeMass },
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
            [hull('nova:171', 19)]);

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

        it('never trims a hull that is already over its mass', async () => {
            // A restock only tops up; the gate stops a pile growing.
            const entity = hyperioidEscort(32000);
            await restockEscortEntity(entity, data);
            expect(samplesOf(entity)).toEqual(32000);
        });

        it('applies to a launcher\'s shared pool too', async () => {
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
            // (the launchers alone would take 12 more).
            await restockEscortEntity(entity, gameDataOf(
                [torpedo, tubeOutfit], [tube], [hull('destroyer', 50)]));
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
            ], [hull('boat', 11)]));
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
                [hull('lightning', 0)]));
            expect(entity.components.get(OutfitsStateComponent)!
                .get('ir')!.count).toEqual(200);
        });
    });
});
