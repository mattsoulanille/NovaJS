import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { getDefaultPersData } from 'novadatainterface/pers_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import {
    AggressionComponent, AGGRESSION_WINDOW_MS, OwnerComponent, SourceComponent,
    styleForTarget,
} from '../nova_plugin/combat/index.js';
import { GovtComponent, Stat, SystemIdResource } from '../nova_plugin/core/index.js';
import {
    FormationComponent, FuelHaggleComponent, NpcComponent,
    ShootAllWeaponsComponent,
} from '../nova_plugin/npc/index.js';
import { PersComponent } from '../nova_plugin/spawn/index.js';
import {
    MissionShipComponent, PlayerShipSelector, PlayerEscortComponent, CreditsComponent,
    EscortCommandComponent, ControlledByComponent, GameDateComponent,
} from '../nova_plugin/player/index.js';
import {
    ShipDataComponent, TargetComponent, DisabledComponent, OutfitsStateComponent,
    FuelComponent,
} from '../nova_plugin/ship/index.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import {
    ASSIST_GRANTED_FALLBACK, ASSIST_GRANTED_FIRST_INDEX, BUSY_RESPONSE_FALLBACK,
    BUSY_RESPONSE_FIRST_INDEX, CHANNEL_OPEN_FALLBACK, CHANNEL_OPEN_FIRST_INDEX,
    GENERIC_GREETING_FIRST_INDEX, HAIL_RESPONSE_TABLE, HOSTILE_RESPONSE_FALLBACK,
    HOSTILE_RESPONSE_FIRST_INDEX, MERCY_ACCEPTED_FALLBACK, MERCY_ACCEPTED_FIRST_INDEX, MERCY_LOWERED_FALLBACK, MERCY_REFUSED_FALLBACK,
    MISC_STRING_TABLE, miscString, NO_NEED_RESPONSE_FALLBACK, NO_NEED_RESPONSE_FIRST_INDEX,
    NO_RESPONSE_FALLBACK, NO_RESPONSE_INDEX, STELLAR_RESPONSE_TABLE, LegalRecordsComponent,
    ASSIST_FOR_PAY_FALLBACK, ASSIST_PAID_FALLBACK, ASSIST_REFUSED_FALLBACK,
    JUST_AN_ESCORT_FALLBACK, MERCY_REFUSED_FIRST_INDEX, fuelSaleTerms,
    planetRefusesBribe, planetLowerPriceCounters, bribeDay,
    MERCY_LOWERED_FIRST_INDEX, NO_MERCY_HAGGLE,
} from '../nova_plugin/reputation/index.js';
import {
    CANNOT_UPGRADE_TEXT, escortReadout, HailContext, HailPage, HailPress, haggleText,
    hailPress, playerChannelMessage, SALE_QUEUED_TEXT, UPGRADE_QUEUED_TEXT,
} from '../spaceport/hail_dialog.js';
import {
    commButtonSlots, escortButtonSlots,
} from '../spaceport/hail_layout.js';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { ActiveRanksComponent, ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import { getDefaultRankData } from 'novadatainterface/rank_data';
import {
    PlanetComponent, PlanetDataComponent, PlanetTargetComponent,
    StellarBribesComponent, StellarHaggleComponent, SystemVisitComponent,
} from '../nova_plugin/travel/index.js';
import { TimePlugin, TimeResource } from 'nova_ecs/plugins/time_plugin';
import { SimulationTimeResource } from './simulation_time.js';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import {
    ControlEvent, ControlsSubject, DisplayAssetDataResource,
    SimulationGameDataResource,
} from '../nova_plugin/core/index.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import { ScreenSize } from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    assistAnswer, computeContext, fuelOffer, HailDialogPlugin, mercyOffer,
    HailDialogResource, hailIsUnanswerable,
    hailTargetIsDisabled,
    shipIdentityBlock,
    targetIsFighting,
} from './hail_dialog_plugin.js';

const PLAYER = 'player-uuid';
const TARGET = 'target-uuid';

function shipData(overrides: Partial<ReturnType<typeof getDefaultShipData>> = {}) {
    return { ...getDefaultShipData(), ...overrides };
}

/**
 * A minimal world with a player ship targeting one other ship, plus a
 * MockGameData carrying the target's govt / pers / ship records. computeContext
 * only reads world.entities and the game data, so no systems are needed.
 */
/** A Roadside Assistance govt (Flags2 0x0010): free help, the one kind a
 * plain neutral ship no longer gives (reference H1 wave 16). */
const ROADSIDE = 'test:roadside';

function makeWorld(configureTarget: (target: Entity) => void) {
    const gameData = new MockGameData();
    gameData.data.Govt.map.set(ROADSIDE, {
        ...getDefaultGovtData(), id: ROADSIDE,
        flags2: { ...getDefaultGovtData().flags2, roadsideAssistance: true },
    });
    // A ship record the target can resolve (its class name / pict).
    gameData.data.Ship.map.set('nova:128', shipData({
        id: 'nova:128', name: 'Target Class', pict: 'nova:3001',
    }));

    const world = new World();
    world.entities.set(PLAYER, new Entity()
        .addComponent(PlayerShipSelector, undefined)
        .addComponent(TargetComponent, { target: TARGET }));

    const target = new Entity()
        .addComponent(ShipDataComponent, gameData.data.Ship.map.get('nova:128')!);
    configureTarget(target);
    world.entities.set(TARGET, target);
    return { world, gameData };
}

describe('computeContext: target image (pers hailPict is not re-prefixed)',
    () => {
        it('uses a pers hailPict verbatim (already a global id)', async () => {
            const pers = getDefaultPersData();
            pers.id = 'nova:131';
            // The parser emits hailPict already prefixed.
            pers.hailPict = 'nova:4001';
            const { world, gameData } = makeWorld(target => {
                target.components.set(PersComponent,
                    { id: 'nova:131', name: 'Captain Nemo', subtitle: '' });
            });
            gameData.data.Pers.map.set('nova:131', pers);

            const result = await computeContext(world, gameData);
            expect(result?.context.image).toBe('nova:4001');
        });

        it('falls back to the ship pict when the pers has no hailPict',
            async () => {
                const pers = getDefaultPersData();
                pers.id = 'nova:131';
                pers.hailPict = null;
                const { world, gameData } = makeWorld(target => {
                    target.components.set(PersComponent,
                        { id: 'nova:131', name: 'Captain Nemo', subtitle: '' });
                });
                gameData.data.Pers.map.set('nova:131', pers);

                const result = await computeContext(world, gameData);
                expect(result?.context.image).toBe('nova:3001');
            });
    });

describe('computeContext: bay fighters vs hired escorts (SourceComponent)',
    () => {
        it('labels a hired escort (no SourceComponent) "Hired Escort:"',
            async () => {
                const { world, gameData } = makeWorld(target => {
                    target.components.set(FormationComponent,
                        { leader: PLAYER, slot: 0 });
                });
                const result = await computeContext(world, gameData);
                expect(result?.context.variant).toBe('escort');
                // `heading` is the LOWER well's whole identity block (the
                // comm frames' second black box), so the label is its first
                // line with the ship's name/class indented beneath it — the
                // way hail/hail_escort.png stacks them.
                expect(result?.context.heading.split('\n')[0])
                    .toBe('Hired Escort:');
                expect(result?.isEscort).toBeTrue();
            });

        it('labels a carrier-bay fighter (has SourceComponent) "Fighter:", ' +
            'not "Hired Escort:", with no management buttons', async () => {
                const { world, gameData } = makeWorld(target => {
                    // Bay fighters carry BOTH formation/owner links to the
                    // player AND a SourceComponent (the launching carrier).
                    target.components.set(FormationComponent,
                        { leader: PLAYER, slot: 0 });
                    target.components.set(OwnerComponent, { owner: PLAYER });
                    target.components.set(SourceComponent, PLAYER);
                });
                const result = await computeContext(world, gameData);
                expect(result?.context.heading.split('\n')[0])
                    .toBe('Fighter:');
                expect(result?.isEscort).toBeFalse();
                // No escort-management seam buttons for a bay fighter.
                expect(result?.context.escort).toBeFalsy();
            });
    });

/**
 * ============================================================================
 * The escort box's OFFER — what the dialog puts in front of the player
 * ============================================================================
 *
 * The prices come off the escort's CURRENT class (escort_fees.ts), the
 * queued deals off its synced ownership marker, and the UPGRADE OFFER off
 * the target class's own shïp gates. Those gates are the part worth pinning:
 * an escort upgrade hands the player a hull, so the hull's Require flags
 * and its Availability control-bit test apply exactly as they would in a
 * shipyard — while the SHOP-side gates (tech level, BuyRandom) do not,
 * because the deal is struck over a comm channel with no stellar involved.
 */
describe('computeContext: the escort management offer', () => {
    const UPGRADE = 'nova:200';

    /** A player with a hired escort of a class that upgrades to UPGRADE. */
    function escortWorld(configure: (target: Entity) => void = () => { },
        upgradeOverrides: Partial<ReturnType<typeof getDefaultShipData>> = {}) {
        const { world, gameData } = makeWorld(target => {
            target.components.set(FormationComponent,
                { leader: PLAYER, slot: 0 });
            configure(target);
        });
        gameData.data.Ship.map.set('nova:128', shipData({
            id: 'nova:128', name: 'Target Class', pict: 'nova:3001',
            price: 150_000, escortUpgradeShip: UPGRADE,
            escortUpgradeCost: 50_000,
        }));
        world.entities.get(TARGET)!.components.set(ShipDataComponent,
            gameData.data.Ship.map.get('nova:128')!);
        gameData.data.Ship.map.set(UPGRADE, shipData({
            id: UPGRADE, name: 'Better Class', price: 400_000,
            ...upgradeOverrides,
        }));
        world.entities.get(PLAYER)!.components.set(CreditsComponent,
            { credits: 1_000_000 });
        return { world, gameData };
    }

    it('offers the upgrade at its EscUpgrdCost when the target class is '
        + 'ungated', async () => {
            const { world, gameData } = escortWorld();
            const escort = (await computeContext(world, gameData))
                ?.context.escort;
            expect(escort?.upgrade)
                .toEqual({ toShip: UPGRADE, cost: 50_000, canAfford: true });
            expect(escort?.queuedDeal).toBeUndefined();
        });

    it('withdraws the offer — "This ship class cannot be upgraded." — when '
        + 'the player lacks the target hull\'s REQUIRE bits, and brings it '
        + 'back when they are granted', async () => {
            // shïp Require (Bible ~:2620): "If for each 1 bit in the
            // Require fields there is a matching 1 bit in one or more of
            // the Contribute fields, the ship can be purchased." The escort
            // upgrade hands the player that hull, so the same rule holds.
            const { world, gameData } =
                escortWorld(() => { }, { require: '0x4' });
            const player = world.entities.get(PLAYER)!;
            const before = (await computeContext(world, gameData))
                ?.context.escort;
            expect(before?.upgrade).toBeUndefined();
            expect(before && escortReadout(before).split('\n')[0])
                .toBe(CANNOT_UPGRADE_TEXT);

            // Grant it — through an OUTFIT's Contribute, the way the
            // shipyard's own playerContributeOf reads it — and the price
            // appears, with a live button.
            gameData.data.Outfit.map.set('nova:300',
                { ...getDefaultOutfitData(), id: 'nova:300',
                    contribute: '0x4' });
            await gameData.data.Outfit.get('nova:300');
            player.components.set(OutfitsStateComponent,
                new Map([['nova:300', { count: 1 }]]) as never);

            const after = (await computeContext(world, gameData))
                ?.context.escort;
            expect(after?.upgrade)
                .toEqual({ toShip: UPGRADE, cost: 50_000, canAfford: true });
            expect(escortButtonSlots(after!)[0])
                .toEqual({ slot: 'upgradeEscort', enabled: true });
        });

    it('withdraws the offer when the target hull\'s AVAILABILITY test '
        + 'fails, and brings it back when the bit is set', async () => {
            const { world, gameData } =
                escortWorld(() => { }, { availability: 'b900' });
            const player = world.entities.get(PLAYER)!;
            expect((await computeContext(world, gameData))
                ?.context.escort?.upgrade).toBeUndefined();

            player.components.set(ControlBitsComponent,
                new Set([900]) as never);
            expect((await computeContext(world, gameData))
                ?.context.escort?.upgrade?.toShip).toBe(UPGRADE);
        });

    it('does NOT apply the shop-side gates: a target class no stellar '
        + 'stocks is still upgradeable', async () => {
            // Tech level and BuyRandom say what a particular shipyard has
            // on the lot; an escort upgrade is arranged in deep space.
            const { world, gameData } = escortWorld(() => { },
                { techLevel: 999, buyRandom: 0 });
            expect((await computeContext(world, gameData))
                ?.context.escort?.upgrade?.toShip).toBe(UPGRADE);
        });

    it('says the class cannot be upgraded when it has no UpgradeTo at all',
        async () => {
            const { world, gameData } = escortWorld();
            gameData.data.Ship.map.get('nova:128')!.escortUpgradeShip = null;
            const escort = (await computeContext(world, gameData))
                ?.context.escort;
            expect(escort?.upgrade).toBeUndefined();
            expect(escort && escortReadout(escort).split('\n')[0])
                .toBe(CANNOT_UPGRADE_TEXT);
        });

    it('greys — but still prices — an upgrade the player cannot afford',
        async () => {
            const { world, gameData } = escortWorld();
            world.entities.get(PLAYER)!.components
                .set(CreditsComponent, { credits: 10 });
            const escort = (await computeContext(world, gameData))
                ?.context.escort;
            expect(escort?.upgrade?.canAfford).toBeFalse();
            expect(escortReadout(escort!).split('\n')[0])
                .toBe('Upgrade Cost: 50,000 credits');
            expect(escortButtonSlots(escort!)[0])
                .toEqual({ slot: 'upgradeEscort', enabled: false });
        });

    it('reports the deals already QUEUED against the escort, so re-opening '
        + 'the channel shows the same box', async () => {
            const { world, gameData } = escortWorld(target => {
                target.components.set(PlayerEscortComponent, {
                    player: PLAYER, parent: PLAYER, provenance: 'captured',
                    deal: { kind: 'upgrade', toShip: UPGRADE },
                });
            });
            const escort = (await computeContext(world, gameData))
                ?.context.escort;
            expect(escort?.queuedDeal).toBe('upgrade');
            expect(escortReadout(escort!).split('\n')[0])
                .toBe(UPGRADE_QUEUED_TEXT);
            expect(escortButtonSlots(escort!)[0])
                .toEqual({ slot: 'cancelUpgrade', enabled: true });
        });

    it('reports a queued SALE the same way', async () => {
        const { world, gameData } = escortWorld(target => {
            target.components.set(PlayerEscortComponent, {
                player: PLAYER, parent: PLAYER, provenance: 'captured',
                deal: { kind: 'sale' },
            });
        });
        const escort = (await computeContext(world, gameData))
            ?.context.escort;
        expect(escort?.queuedDeal).toBe('sale');
        expect(escortReadout(escort!).split('\n')[1]).toBe(SALE_QUEUED_TEXT);
        expect(escortButtonSlots(escort!)[1])
            .toEqual({ slot: 'cancelSale', enabled: true });
    });

    it('keeps the WAGE on the escort\'s CURRENT class while an upgrade is '
        + 'queued', async () => {
            // The escort is still flying the old hull until the deal
            // settles at lift-off, so it is still paid for the old hull.
            const { world, gameData } = escortWorld(target => {
                target.components.set(PlayerEscortComponent, {
                    player: PLAYER, parent: PLAYER, provenance: 'hired',
                    deal: { kind: 'upgrade', toShip: UPGRADE },
                });
            });
            const escort = (await computeContext(world, gameData))
                ?.context.escort;
            // 1% of the CURRENT 150,000 cr hull, not the 400,000 cr one.
            expect(escort?.dailyFee).toBe(1_500);
        });
});

/**
 * mïsn ShipNameID: "Tells Nova how to name the special ships". The name
 * is picked from the STR# list when the mission is ACCEPTED and every
 * one of that mission's special ships wears it — so hailing the bounty
 * target the briefing called "Doomblade" must not answer "Class:
 * Target Class". The name reaches the display world on the
 * serializer-registered MissionShipComponent; it used to live only on
 * Entity.name, a debugging label that never crosses the bridge.
 */
describe('computeContext: a mission special ship is named, not classed',
    () => {
        it('titles the ship with its mission-given name', async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(MissionShipComponent, {
                    mission: 'nova:258', owner: PLAYER, name: 'Doomblade',
                });
            });
            const result = await computeContext(world, gameData);
            expect(result?.context.heading.split('\n')[0])
                .toBe('Doomblade');
        });

        it('still classes a mission ship whose mïsn set no ShipNameID',
            async () => {
                const { world, gameData } = makeWorld(target => {
                    target.components.set(MissionShipComponent,
                        { mission: 'nova:258', owner: PLAYER });
                });
                const result = await computeContext(world, gameData);
                expect(result?.context.heading.split('\n')[0])
                    .toBe('Class: Target Class');
            });

        it('lets a përs the mission replaced keep its own name', async () => {
            // përs Flags 0x0040 puts the mission's special ship where the
            // offering përs hull was, so one entity can carry both tags.
            const pers = getDefaultPersData();
            pers.id = 'nova:131';
            const { world, gameData } = makeWorld(target => {
                target.components.set(PersComponent,
                    { id: 'nova:131', name: 'Captain Nemo', subtitle: '' });
                target.components.set(MissionShipComponent, {
                    mission: 'nova:258', owner: PLAYER, name: 'Doomblade',
                });
            });
            gameData.data.Pers.map.set('nova:131', pers);
            const result = await computeContext(world, gameData);
            expect(result?.context.heading.split('\n')[0])
                .toBe('Captain Nemo');
        });
    });

describe('computeContext: behavioral hostility (attacking neutral)', () => {
    it('a neutral ship attacking the player greets with hostility', async () => {
        const govt = { id: 'test:neutral' };
        const { world, gameData } = makeWorld(target => {
            target.components.set(GovtComponent, govt);
            target.components.set(NpcComponent,
                { aiType: 3, mode: 'attack' });
            target.components.set(TargetComponent, { target: PLAYER });
        });
        // A plain neutral govt (no hostility, no bribe flags).
        gameData.data.Govt.map.set('test:neutral',
            { ...gameData.data.Govt.defaultValue!, id: 'test:neutral' });

        const result = await computeContext(world, gameData);
        // Behavioral hostility → the hostile response set (STR# 3000 10-14,
        // falling back to its pinned first line with no display assets) and
        // NO assistance offer.
        expect(result?.context.assist).toBeUndefined();
        expect(result?.context.body).toBe(HOSTILE_RESPONSE_FALLBACK);
        // The identity block carries the red Status line the reference shows.
        expect(result?.context.heading).toContain('Status: Hostile');
    });
});

/**
 * What a Request Assistance press gets answered with. The OFFER is made to
 * every non-hostile ship — busy or not, needed or not — so the decision
 * happens on the press, which is what assistAnswer resolves: the line to show
 * in the response well, and whether a simulation request goes out at all.
 */
describe('hail assistance answers (accept / busy / no need)', () => {
    /** A display-asset stub carrying the stock groups of STR# 3000. */
    function fakeDisplayAssets(): DisplayAssetDataInterface {
        const strings: string[] = [];
        strings[HOSTILE_RESPONSE_FIRST_INDEX] = 'What is it you want?';
        strings[HOSTILE_RESPONSE_FIRST_INDEX + 1] = 'What do you want?';
        strings[HOSTILE_RESPONSE_FIRST_INDEX + 2] = 'What is it?';
        strings[HOSTILE_RESPONSE_FIRST_INDEX + 3] = 'What is it?';
        strings[HOSTILE_RESPONSE_FIRST_INDEX + 4] = 'What?';
        strings[NO_NEED_RESPONSE_FIRST_INDEX] = "You're not in any trouble.";
        strings[NO_NEED_RESPONSE_FIRST_INDEX + 1] = "You're in no danger.";
        strings[NO_NEED_RESPONSE_FIRST_INDEX + 2] =
            "You don't have any problems.";
        strings[NO_NEED_RESPONSE_FIRST_INDEX + 3] =
            "It looks like you're sitting pretty from here.  "
            + 'Try helping yourself.';
        strings[NO_NEED_RESPONSE_FIRST_INDEX + 4] =
            "There's no danger to you right now.";
        strings[ASSIST_GRANTED_FIRST_INDEX] = "All right, I'll help you.";
        strings[ASSIST_GRANTED_FIRST_INDEX + 1] = "Sure, I'll help you out.";
        strings[ASSIST_GRANTED_FIRST_INDEX + 2] = 'Help is on the way.';
        strings[ASSIST_GRANTED_FIRST_INDEX + 3] = "I'll come and help you.";
        strings[ASSIST_GRANTED_FIRST_INDEX + 4] = "Hang on, I'm coming.";
        strings[BUSY_RESPONSE_FIRST_INDEX] = "I'm busy.";
        strings[BUSY_RESPONSE_FIRST_INDEX + 1] = "I'm a little busy right now.";
        strings[BUSY_RESPONSE_FIRST_INDEX + 2] = "I'm too busy to help you.";
        strings[BUSY_RESPONSE_FIRST_INDEX + 3] = 'I have other business.';
        strings[BUSY_RESPONSE_FIRST_INDEX + 4] = "I've got other things to do.";
        strings[MERCY_REFUSED_FIRST_INDEX] = 'In your dreams, pal.';
        strings[MERCY_REFUSED_FIRST_INDEX + 1] = 'Yeah, right!';
        strings[MERCY_REFUSED_FIRST_INDEX + 2] = 'No way.';
        strings[MERCY_REFUSED_FIRST_INDEX + 3] = 'You wish.';
        strings[MERCY_REFUSED_FIRST_INDEX + 4] = 'Not a chance.';
        return {
            data: {
                StringTable: {
                    get: async (id: string) => id === HAIL_RESPONSE_TABLE
                        ? { strings } : { strings: [] },
                },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    /** A world whose player needs help (disabled), hailing a ship of a
     * govt that helps for free (a neutral one refuses a disabled pilot:
     * reference H1 wave 16). */
    function needyWorld(configureTarget: (target: Entity) => void) {
        const built = makeWorld(target => {
            target.components.set(GovtComponent, { id: ROADSIDE });
            configureTarget(target);
        });
        built.world.entities.get(PLAYER)!.components
            .set(DisabledComponent, { repairAt: null });
        return built;
    }

    it('reads the target\'s combat state the same way the sim does', () => {
        const fighting = new Entity()
            .addComponent(NpcComponent, { aiType: 3, mode: 'attack' } as never)
            .addComponent(TargetComponent, { target: 'someone else' });
        expect(targetIsFighting(fighting)).toBeTrue();

        const idle = new Entity()
            .addComponent(NpcComponent, { aiType: 3 } as never)
            .addComponent(TargetComponent, { target: undefined });
        expect(targetIsFighting(idle)).toBeFalse();

        const devEnemy = new Entity()
            .addComponent(ShootAllWeaponsComponent, undefined);
        expect(targetIsFighting(devEnemy)).toBeTrue();
    });

    it('OFFERS assistance to a HEALTHY player (no reason to ask)', async () => {
        // Matthew: "it should show request assistance even if there's no
        // reason for you to request it (they usually just tell you that you
        // don't need help)."
        const { world, gameData } = makeWorld(target => {
            target.components.set(NpcComponent, { aiType: 3 });
        });
        const result = await computeContext(world, gameData);
        expect(result?.context.assist).toBeDefined();
    });

    it('answers a healthy player\'s press with the no-need line from STR# '
        + '3000, and dispatches nothing', async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(NpcComponent, { aiType: 3 });
            });
            const result = await computeContext(world, gameData,
                fakeDisplayAssets());
            const answer = assistAnswer(world, TARGET, result!.replies);
            expect(answer.dispatch).toBeFalse();
            expect(answer.line).toBe(result!.replies.noNeed);
            expect([
                "You're not in any trouble.", "You're in no danger.",
                "You don't have any problems.",
                "It looks like you're sitting pretty from here.  "
                + 'Try helping yourself.',
                "There's no danger to you right now.",
            ]).toContain(answer.line);
        });

    it('still OFFERS assistance to a ship that is busy fighting', async () => {
        const { world, gameData } = needyWorld(target => {
            target.components.set(NpcComponent,
                { aiType: 3, mode: 'attack' });
            target.components.set(TargetComponent, { target: 'someone else' });
        });
        const result = await computeContext(world, gameData);
        // The button is there; pressing it is what gets the refusal.
        expect(result?.context.assist).toBeDefined();
    });

    it('answers a press with a busy line from STR# 3000, and dispatches '
        + 'nothing', async () => {
            const { world, gameData } = needyWorld(target => {
                target.components.set(NpcComponent,
                    { aiType: 3, mode: 'attack' });
                target.components.set(TargetComponent,
                    { target: 'someone else' });
            });
            const result = await computeContext(world, gameData,
                fakeDisplayAssets());
            expect(result?.replies.busy).toContain('busy');

            const answer = assistAnswer(world, TARGET, result!.replies);
            expect(answer.dispatch).toBeFalse();
            expect(answer.line).toBe(result!.replies.busy);
        });

    it('ACCEPTS with a line of its own, so the channel can stay open',
        async () => {
            // Matthew: the channel must not slam shut on accept — the player
            // has to hear the answer ("All right, I'll help you.", STR# 3000
            // indices 75-79).
            const { world, gameData } = needyWorld(target => {
                target.components.set(NpcComponent, { aiType: 3 });
                target.components.set(TargetComponent, { target: undefined });
            });
            const result = await computeContext(world, gameData,
                fakeDisplayAssets());
            const answer = assistAnswer(world, TARGET, result!.replies);
            expect(answer.dispatch).toBeTrue();
            expect(answer.line).toBe(result!.replies.granted);
            expect([
                "All right, I'll help you.", "Sure, I'll help you out.",
                'Help is on the way.', "I'll come and help you.",
                "Hang on, I'm coming.",
            ]).toContain(answer.line);
        });

    it('dispatches once the fight ends', async () => {
        const { world, gameData } = needyWorld(target => {
            target.components.set(NpcComponent,
                { aiType: 3, mode: 'attack' });
            target.components.set(TargetComponent, { target: 'someone else' });
        });
        const result = await computeContext(world, gameData,
            fakeDisplayAssets());
        expect(assistAnswer(world, TARGET, result!.replies).dispatch)
            .toBeFalse();

        // The fight ends while the channel is open: the SAME open dialog now
        // gets the request through, because the press is what decides.
        const target = world.entities.get(TARGET)!;
        target.components.get(NpcComponent)!.mode = undefined;
        target.components.get(TargetComponent)!.target = undefined;
        expect(assistAnswer(world, TARGET, result!.replies).dispatch)
            .toBeTrue();
    });

    it('falls back to the pinned literals with no display assets', async () => {
        const { world, gameData } = needyWorld(target => {
            target.components.set(NpcComponent, { aiType: 3 });
        });
        const result = await computeContext(world, gameData);
        expect(result?.replies).toEqual({
            granted: ASSIST_GRANTED_FALLBACK,
            busy: BUSY_RESPONSE_FALLBACK,
            noNeed: NO_NEED_RESPONSE_FALLBACK,
            underFire: MERCY_REFUSED_FALLBACK,
        });
    });

    /**
     * Reference "W1 / C1 / H1 wave 15", H1: a healthy pilot under raider
     * fire asking a neutral warship or trader for help was refused from STR#
     * 3000 95-99 ("Yeah, right!", "No way."), with record 0 and with record
     * +1000 / rating 6400 alike — never 70-74's "You're not in any trouble."
     */
    describe('a HEALTHY player under attack (reference H1 wave 15)', () => {
        const RAIDER = 'raider-uuid';
        const REFUSALS = ['In your dreams, pal.', 'Yeah, right!', 'No way.',
            'You wish.', 'Not a chance.'];

        function addRaider(world: World) {
            world.entities.set(RAIDER, new Entity()
                .addComponent(NpcComponent, { aiType: 3, mode: 'attack' } as never)
                .addComponent(TargetComponent, { target: PLAYER }));
        }

        for (const [kind, aiType] of [['warship', 3], ['trader', 1]] as const) {
            it(`a neutral ${kind} refuses from 95-99 and dispatches nothing`,
                async () => {
                    const { world, gameData } = makeWorld(target => {
                        target.components.set(NpcComponent, { aiType });
                    });
                    addRaider(world);
                    const result = await computeContext(world, gameData,
                        fakeDisplayAssets());
                    const answer = assistAnswer(world, TARGET, result!.replies);
                    expect(answer).toEqual({
                        line: result!.replies.underFire!, dispatch: false,
                        haggle: false,
                    });
                    expect(REFUSALS).toContain(answer.line);
                });
        }

        it('whatever his record', async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(NpcComponent, { aiType: 3 });
                target.components.set(GovtComponent, { id: 'test:neutral' });
            });
            gameData.data.Govt.map.set('test:neutral',
                { ...getDefaultGovtData(), id: 'test:neutral' });
            world.entities.get(PLAYER)!.components.set(LegalRecordsComponent,
                new Map([['test:neutral', 1000]]));
            addRaider(world);
            const result = await computeContext(world, gameData,
                fakeDisplayAssets());
            expect(REFUSALS).toContain(
                assistAnswer(world, TARGET, result!.replies).line);
        });

        it('a recent hit counts as being under attack (the aggression '
            + 'window)', async () => {
                const { world, gameData } = makeWorld(target => {
                    target.components.set(NpcComponent, { aiType: 3 });
                });
                // The raider broke off but hit the player a moment ago.
                world.entities.set(RAIDER, new Entity()
                    .addComponent(NpcComponent, { aiType: 3 } as never));
                world.entities.get(PLAYER)!.components.set(
                    AggressionComponent,
                    new Map([[RAIDER, { at: 0, damage: 80, hostile: true }]]));
                const result = await computeContext(world, gameData,
                    fakeDisplayAssets());
                expect(REFUSALS).toContain(
                    assistAnswer(world, TARGET, result!.replies).line);
            });

        it('with nobody attacking, the no-need line as before', async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(NpcComponent, { aiType: 3 });
            });
            // A ship merely targeting the player, not attacking.
            world.entities.set(RAIDER, new Entity()
                .addComponent(NpcComponent, { aiType: 3 } as never)
                .addComponent(TargetComponent, { target: PLAYER }));
            const result = await computeContext(world, gameData,
                fakeDisplayAssets());
            expect(assistAnswer(world, TARGET, result!.replies).line)
                .toBe(result!.replies.noNeed);
        });

        it('UNMEASURED cases keep their answers: a disabled player under '
            + 'attack is still helped by a ship that helps for free',
            async () => {
                const { world, gameData } = needyWorld(target => {
                    target.components.set(NpcComponent, { aiType: 3 });
                    target.components.set(TargetComponent,
                        { target: undefined });
                });
                addRaider(world);
                const result = await computeContext(world, gameData,
                    fakeDisplayAssets());
                const answer = assistAnswer(world, TARGET, result!.replies);
                expect(answer.dispatch).toBeTrue();
                expect(answer.line).toBe(result!.replies.granted);
            });

        it('and a WARSHIP whose govt\'s ränk 0x0400 the player holds turns '
            + 'him down flat too, AI 3 and AI 4 (reference H1 wave 19, '
            + 'finding 4: "No way." / "Not a chance." / "You wish.")',
            async () => {
                for (const aiType of [3, 4]) {
                    const { world, gameData } = await rankWorld(aiType);
                    const result = await computeContext(world, gameData,
                        fakeDisplayAssets());
                    expect(result!.replies.underFire)
                        .withContext(`AI ${aiType}`).toBeDefined();
                    const answer = assistAnswer(world, TARGET,
                        result!.replies);
                    expect(answer.line).withContext(`AI ${aiType}`)
                        .toBe(result!.replies.underFire!);
                    expect(answer.line).not.toBe(result!.replies.noNeed);
                    expect(answer.dispatch).toBeFalse();
                }
            });

        it('as does a TRADER of that govt (reference H1 wave 17, finding 7: '
            + '"Not a chance.")', async () => {
                const { world, gameData } = await rankWorld(1);
                const result = await computeContext(world, gameData,
                    fakeDisplayAssets());
                expect(result!.replies.underFire).toBeDefined();
                expect(assistAnswer(world, TARGET, result!.replies).line)
                    .toBe(result!.replies.underFire!);
            });

        /** Under raider fire, holding a ränk 0x0400 for the hailed ship's
         * `test:navy`, whose ship has `aiType`. */
        async function rankWorld(aiType: number) {
            const built = makeWorld(target => {
                target.components.set(NpcComponent, { aiType });
                target.components.set(GovtComponent, { id: 'test:navy' });
            });
            const { world, gameData } = built;
            gameData.data.Govt.map.set('test:navy',
                { ...getDefaultGovtData(), id: 'test:navy' });
            const base = getDefaultRankData();
            gameData.data.Rank.map.set('test:rank', {
                ...base, id: 'test:rank', affilGovt: 'test:navy',
                rankFlags: {
                    ...base.rankFlags, canRequestBattleAssistance: true,
                },
            });
            // Staged, as the sim stages every active rank (getCached).
            await gameData.data.Rank.get('test:rank');
            world.entities.get(PLAYER)!.components.set(
                ActiveRanksComponent, new Set(['test:rank']));
            addRaider(world);
            return built;
        }
    });
});

describe('computeContext: hostile ships answer from their own STR# 3000 set',
    () => {
        function hostileDisplayAssets(): DisplayAssetDataInterface {
            const strings: string[] = [];
            strings[HOSTILE_RESPONSE_FIRST_INDEX] = 'What is it you want?';
            strings[HOSTILE_RESPONSE_FIRST_INDEX + 1] = 'What do you want?';
            strings[HOSTILE_RESPONSE_FIRST_INDEX + 2] = 'What is it?';
            strings[HOSTILE_RESPONSE_FIRST_INDEX + 3] = 'What is it?';
            strings[HOSTILE_RESPONSE_FIRST_INDEX + 4] = 'What?';
            return {
                data: {
                    StringTable: {
                        get: async (id: string) => id === HAIL_RESPONSE_TABLE
                            ? { strings } : { strings: [] },
                    },
                },
            } as unknown as DisplayAssetDataInterface;
        }

        /** A ship whose politics are neutral but which is shooting at us. */
        function attackingWorld() {
            const built = makeWorld(target => {
                target.components.set(GovtComponent, { id: 'test:neutral' });
                target.components.set(NpcComponent,
                    { aiType: 3, mode: 'attack' });
                target.components.set(TargetComponent, { target: PLAYER });
            });
            built.gameData.data.Govt.map.set('test:neutral', {
                ...built.gameData.data.Govt.defaultValue!,
                id: 'test:neutral', commName: 'Federation',
                commGreetings: ['Greetings from the Federation Navy.'],
            });
            return built;
        }

        it('uses the hostile group, NOT the govt greeting STR#', async () => {
            const { world, gameData } = attackingWorld();
            const result = await computeContext(world, gameData,
                hostileDisplayAssets());
            expect(['What is it you want?', 'What do you want?',
                'What is it?', 'What?']).toContain(result!.context.body);
            expect(result!.context.body)
                .not.toBe('Greetings from the Federation Navy.');
        });

        it('picks the same line every time for the same ship (uuid hash, '
            + 'never Math.random)', async () => {
                // Re-hailing must not shuffle the answer, and every peer
                // rendering this dialog must read the same line.
                const { world, gameData } = attackingWorld();
                const first = await computeContext(world, gameData,
                    hostileDisplayAssets());
                const again = await computeContext(world, gameData,
                    hostileDisplayAssets());
                expect(first!.context.body).toBe(again!.context.body);
            });

        it('falls back to the pinned literal with no display assets',
            async () => {
                const { world, gameData } = attackingWorld();
                const result = await computeContext(world, gameData);
                expect(result!.context.body).toBe(HOSTILE_RESPONSE_FALLBACK);
            });

        it('still prefers a pers CommQuote over the hostile group',
            async () => {
                const { world, gameData } = attackingWorld();
                const pers = getDefaultPersData();
                pers.id = 'nova:131';
                pers.commQuote = 'You will regret this, captain.';
                gameData.data.Pers.map.set('nova:131', pers);
                world.entities.get(TARGET)!.components.set(PersComponent,
                    { id: 'nova:131', name: 'Captain Nemo', subtitle: '' });
                const result = await computeContext(world, gameData,
                    hostileDisplayAssets());
                expect(result!.context.body)
                    .toBe('You will regret this, captain.');
            });
    });

/**
 * OPENING A CHANNEL IS NOT A GREETING (Matthew: "when hailing, the dialog
 * should initially just show one of the 'Channel open' messages ... instead of
 * one of the greetings").
 *
 * The reference pair proves it: hail/hail.png is a freshly hailed Terrapin
 * whose response well reads "Channel open." with Greetings still unpressed,
 * and hail/greetings.png is the SAME frame reading "Greetings." after the
 * button. NovaJS answered the hail itself with the government greeting, which
 * both skipped the channel-open group and left the Greetings button with
 * nothing of its own to say.
 */
describe('computeContext: a ship hail OPENS with the channel-open group', () => {
    /** Display assets carrying STR# 3000's channel-open / greeting groups. */
    function commAssets(): DisplayAssetDataInterface {
        const strings: string[] = [];
        strings[CHANNEL_OPEN_FIRST_INDEX] = 'Channel open.';
        strings[CHANNEL_OPEN_FIRST_INDEX + 1] = 'Communications channel open.';
        strings[CHANNEL_OPEN_FIRST_INDEX + 2] =
            'Communications interlink established.';
        strings[CHANNEL_OPEN_FIRST_INDEX + 3] = 'Hailing frequencies open.';
        strings[CHANNEL_OPEN_FIRST_INDEX + 4] = 'Hailing channel ready.';
        strings[GENERIC_GREETING_FIRST_INDEX] = 'Nice to meet you.';
        strings[GENERIC_GREETING_FIRST_INDEX + 1] = 'Hello there.';
        strings[GENERIC_GREETING_FIRST_INDEX + 2] = 'Greetings.';
        strings[GENERIC_GREETING_FIRST_INDEX + 3] = 'Hi there.';
        strings[GENERIC_GREETING_FIRST_INDEX + 4] = 'Howdy.';
        strings[HOSTILE_RESPONSE_FIRST_INDEX] = 'What is it you want?';
        strings[MERCY_ACCEPTED_FIRST_INDEX] = "Okay, I'll leave you alone.";
        return {
            data: {
                StringTable: {
                    get: async (id: string) => id === HAIL_RESPONSE_TABLE
                        ? { strings } : { strings: [] },
                },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    const CHANNEL_OPEN_GROUP = [
        'Channel open.', 'Communications channel open.',
        'Communications interlink established.', 'Hailing frequencies open.',
        'Hailing channel ready.',
    ];

    it('answers the hail itself with a channel-open line, NOT the govt '
        + 'greeting', async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(GovtComponent, { id: 'test:fed' });
                target.components.set(NpcComponent, { aiType: 3 });
            });
            gameData.data.Govt.map.set('test:fed', {
                ...gameData.data.Govt.defaultValue!, id: 'test:fed',
                commName: 'Federation',
                commGreetings: ['Greetings from the Federation Navy.'],
            });

            const result = await computeContext(world, gameData, commAssets());
            expect(CHANNEL_OPEN_GROUP).toContain(result!.context.body);
            expect(result!.context.body)
                .not.toBe('Greetings from the Federation Navy.');
            // The greeting is held in reserve for the Greetings button.
            expect(result!.context.greeting)
                .toBe('Greetings from the Federation Navy.');
        });

    it('falls back to the pinned "Channel open." with no display assets',
        async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(NpcComponent, { aiType: 3 });
            });
            const result = await computeContext(world, gameData);
            expect(result!.context.body).toBe(CHANNEL_OPEN_FALLBACK);
            expect(CHANNEL_OPEN_FALLBACK).toBe('Channel open.');
        });

    it('picks the same opening line every time for the same ship (uuid hash, '
        + 'never Math.random)', async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(NpcComponent, { aiType: 3 });
            });
            const first = await computeContext(world, gameData, commAssets());
            const again = await computeContext(world, gameData, commAssets());
            expect(first!.context.body).toBe(again!.context.body);
        });

    it('gives a govt-LESS ship the stock generic greeting (the reference\'s '
        + '"Greetings.") rather than a synthetic line', async () => {
            // hail/greetings.png's Terrapin carries no government at all.
            const { world, gameData } = makeWorld(target => {
                target.components.set(NpcComponent, { aiType: 3 });
            });
            const result = await computeContext(world, gameData, commAssets());
            expect(['Nice to meet you.', 'Hello there.', 'Greetings.',
                'Hi there.', 'Howdy.']).toContain(result!.context.greeting!);
            expect(result!.context.greeting).not.toContain('Fly safe');
        });

    it('still lets a përs speak their own CommQuote as the greeting',
        async () => {
            const pers = getDefaultPersData();
            pers.id = 'nova:131';
            pers.commQuote = 'Well met, captain.';
            const { world, gameData } = makeWorld(target => {
                target.components.set(PersComponent,
                    { id: 'nova:131', name: 'Captain Nemo', subtitle: '' });
                target.components.set(NpcComponent, { aiType: 3 });
            });
            gameData.data.Pers.map.set('nova:131', pers);
            const result = await computeContext(world, gameData, commAssets());
            // The channel still OPENS with the channel-open line...
            expect(CHANNEL_OPEN_GROUP).toContain(result!.context.body);
            // ...and the përs quote is what Greetings produces.
            expect(result!.context.greeting).toBe('Well met, captain.');
        });

    it('leaves a HOSTILE ship answering from the hostile group, with no '
        + 'greeting to give', async () => {
            // hail/hail_hostile.png opens on "What is it?", not on "Channel
            // open." — the hostile group REPLACES the channel-open line.
            const { world, gameData } = makeWorld(target => {
                target.components.set(GovtComponent, { id: 'test:neutral' });
                target.components.set(NpcComponent,
                    { aiType: 3, mode: 'attack' });
                target.components.set(TargetComponent, { target: PLAYER });
            });
            gameData.data.Govt.map.set('test:neutral', {
                ...gameData.data.Govt.defaultValue!, id: 'test:neutral',
                commGreetings: ['Greetings from the Federation Navy.'],
            });
            const result = await computeContext(world, gameData, commAssets());
            expect(result!.context.body).toBe(HOSTILE_RESPONSE_FALLBACK);
            expect(CHANNEL_OPEN_GROUP).not.toContain(result!.context.body);
            expect(result!.context.greeting).toBeUndefined();
        });

    it('gives a bribe-taking hostile ship its paid-off line up front',
        async () => {
            // Resolved when the channel opens because the Pay handler is
            // synchronous — the same reason the assistance replies are.
            const { world, gameData } = makeWorld(target => {
                target.components.set(GovtComponent, { id: 'test:pirate' });
                target.components.set(NpcComponent,
                    { aiType: 3, mode: 'attack' });
                target.components.set(TargetComponent, { target: PLAYER });
            });
            const pirate = {
                ...gameData.data.Govt.defaultValue!, id: 'test:pirate',
            };
            // 0x8000 prices it; 0x0200 makes its warships take one at all
            // (reference "R7 bribe price, wave 22", finding 5).
            pirate.flags = {
                ...pirate.flags, largerBribes: true, warshipsTakeBribes: true,
            };
            gameData.data.Govt.map.set('test:pirate', pirate);
            world.entities.get(PLAYER)!.components
                .set(CreditsComponent, { credits: 10_000 });

            const result = await computeContext(world, gameData, commAssets());
            expect(result!.context.bribe?.purpose).toBe('mercy');
            expect(result!.context.bribe?.accepted)
                .toBe(MERCY_ACCEPTED_FALLBACK);
            // Lower Price's withdrawal (STR# 3000 150-154, reference "R7
            // a provoked freighter's Beg For Mercy above 20M, wave 31").
            expect(result!.context.bribe?.withdrawn)
                .toBe(MERCY_LOWERED_FALLBACK);
            // The price in the fuel sale's words: the ship's mood line
            // in the well, "Pay me N credits." on the popup (20,000 flat,
            // capped to a third of 10,000; hail/beg_mercy.png).
            expect(result!.context.bribe?.amount).toBe(3000);
            expect(result!.context.bribe?.demand)
                .toBe('Pay me 3,000 credits.');
            expect(result!.context.bribe?.offer).toBeDefined();
            expect(haggleText(result!.context.bribe))
                .toBe('Pay me 3,000 credits.');
            // The channel's haggle lines, for Lower Price and the next
            // plea (reference "R7 a provoked freighter's Lower Price, wave
            // 32"): one more withdrawn ask is 1,000 more, past the cap.
            const mercy = result!.replies.mercy!;
            expect(mercy.firstAsk).toBe(3000);
            expect(mercyOffer(mercy, NO_MERCY_HAGGLE, 10_000))
                .toEqual(result!.context.bribe!);
            const second = mercyOffer(mercy,
                { asks: 1, countered: false }, 10_000);
            expect(second.amount).toBe(4000);
            expect(second.demand).toBe('Pay me 4,000 credits.');
            expect(second.withdrawn).toBe(mercy.withdrawn);
            // 3/4 of 4,000.
            expect(mercyOffer(mercy, { asks: 1, countered: true }, 10_000)
                .amount).toBe(3000);
            expect(mercyOffer(mercy, { asks: 4, countered: false }, 6_000)
                .canAfford).toBeFalse();
        });

    it('draws a hostile ship\'s withdrawal line ONCE PER HAIL (STR# 3000 '
        + '150-154; reference "R7 a provoked freighter\'s Lower Price, wave '
        + '32", finding 4)', async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(GovtComponent, { id: 'test:pirate' });
                target.components.set(NpcComponent,
                    { aiType: 3, mode: 'attack' });
                target.components.set(TargetComponent, { target: PLAYER });
            });
            const pirate = {
                ...gameData.data.Govt.defaultValue!, id: 'test:pirate',
            };
            pirate.flags = {
                ...pirate.flags, largerBribes: true, warshipsTakeBribes: true,
            };
            gameData.data.Govt.map.set('test:pirate', pirate);
            world.entities.get(PLAYER)!.components
                .set(CreditsComponent, { credits: 200_000_000 });
            const lines = ['What? How dare you! Prepare to die!',
                'Die, cheapskate!',
                'What a cheapskate! This\'ll teach you a lesson!',
                'No! You die!', 'Ha ha ha! This will be your last mistake!'];
            const assets = commAssets();
            const strings = (await assets.data.StringTable
                .get(HAIL_RESPONSE_TABLE)).strings as string[];
            lines.forEach((line, i) => {
                strings[MERCY_LOWERED_FIRST_INDEX + i] = line;
            });
            const seen = new Set<string>();
            for (let channel = 0; channel < 40; channel++) {
                const result = await computeContext(world, gameData, assets,
                    undefined, channel);
                const withdrawn = result!.context.bribe!.withdrawn!;
                expect(lines).toContain(withdrawn);
                // The same channel draws the same line.
                expect((await computeContext(world, gameData, assets,
                    undefined, channel))!.context.bribe!.withdrawn)
                    .toBe(withdrawn);
                seen.add(withdrawn);
            }
            // Another hail draws again: every line turns up.
            expect(seen.size).toBe(lines.length);
        });

    it('opens a NON-TALKATIVE govt\'s channel too, with nothing to greet '
        + 'with', async () => {
            // Flags2 noDistressMessages: "don't respond with greetings when
            // hailed". The channel still opens — the ship answers the hail —
            // but the Greetings button has no line of its own.
            const { world, gameData } = makeWorld(target => {
                target.components.set(GovtComponent, { id: 'test:silent' });
                target.components.set(NpcComponent, { aiType: 3 });
            });
            const silent = {
                ...gameData.data.Govt.defaultValue!, id: 'test:silent',
            };
            silent.flags2 = { ...silent.flags2, noDistressMessages: true };
            gameData.data.Govt.map.set('test:silent', silent);

            const result = await computeContext(world, gameData, commAssets());
            expect(CHANNEL_OPEN_GROUP).toContain(result!.context.body);
            expect(result!.context.greeting).toBeUndefined();
        });
});


/**
 * THE DIALOG'S PAGE BEHAVIOUR (hailPress + commButtonSlots — the pure pair
 * HailDialog draws). Matthew's second nit: "'Request assistance' button should
 * not disappear after requesting (same with 'beg for mercy')."
 *
 * hail/request_assistance.png settles it: the ship has already answered
 * "You're not in any trouble." and the Request Assistance pill is still in the
 * middle slot, with Greetings above and Close Channel below — the identical
 * three-row column hail.png and greetings.png show. NovaJS dropped the offer
 * with the answer, so the column silently collapsed to two rows and a player
 * who asked too early could not ask again without re-opening the channel.
 */
describe('the comm dialog\'s button column survives its own presses', () => {
    const SHIP: HailContext = {
        variant: 'ship', heading: 'Class: Terrapin', image: null,
        body: 'Channel open.', greeting: 'Greetings.',
        assist: { free: false },
    };
    const HOSTILE: HailContext = {
        variant: 'ship', heading: 'Class: Fed Destroyer\nStatus: Hostile',
        image: null, body: 'What is it?',
        bribe: {
            amount: 3000, canAfford: true, purpose: 'mercy',
            accepted: "Okay, I'll leave you alone.",
            withdrawn: 'What? How dare you! Prepare to die!',
        },
    };
    const PORT: HailContext = {
        variant: 'planet', heading: 'Earth', image: null,
        body: 'Channel open to Earth.\nLanding request denied.',
        bribe: { amount: 1000, canAfford: true, purpose: 'landing' },
    };

    /** The page a freshly opened channel starts on. */
    function open(context: HailContext): HailPage {
        return { phase: 'main', context };
    }

    /** The captions the column draws for a page, top to bottom. */
    function slots(page: HailPage): string[] {
        return commButtonSlots(page.context.variant, page.context);
    }

    /** Applies presses in order; throws if the channel closes early. */
    function pressAll(page: HailPage, presses: HailPress[],
        opening: HailContext): HailPage {
        let current = page;
        for (const press of presses) {
            const next = hailPress(current, press, opening);
            if (next === 'close') {
                throw new Error(`press ${press.kind} closed the channel`);
            }
            current = next;
        }
        return current;
    }

    it('opens on the channel-open line with hail.png\'s three rows', () => {
        expect(open(SHIP).context.body).toBe('Channel open.');
        expect(slots(open(SHIP)))
            .toEqual(['greetings', 'assist', 'close']);
    });

    it('Greetings swaps in the greeting and leaves the column alone', () => {
        const after = pressAll(open(SHIP), [{ kind: 'greetings' }], SHIP);
        expect(after.context.body).toBe('Greetings.');
        expect(slots(after)).toEqual(['greetings', 'assist', 'close']);
    });

    it('KEEPS Request Assistance after the ship has answered', () => {
        const after = pressAll(open(SHIP),
            [{ kind: 'assist', answer: "You're not in any trouble." }], SHIP);
        expect(after.context.body).toBe("You're not in any trouble.");
        expect(after.context.assist).toEqual({ free: false });
        expect(slots(after)).toEqual(['greetings', 'assist', 'close']);
    });

    it('answers a SECOND request with whatever the ship says then', () => {
        // Asking again really re-asks: the caller recomputes the answer from
        // live state on every press (assistAnswer), so a ship that has
        // stopped fighting, or a player who has since taken damage, gets the
        // new answer rather than the stale one.
        const after = pressAll(open(SHIP), [
            { kind: 'assist', answer: "I'm busy." },
            { kind: 'assist', answer: "All right, I'll help you." },
        ], SHIP);
        expect(after.context.body).toBe("All right, I'll help you.");
        expect(slots(after)).toEqual(['greetings', 'assist', 'close']);
    });

    it('lets Greetings undo a refusal — the answer never became the line '
        + 'the channel opened with', () => {
            const after = pressAll(open(SHIP), [
                { kind: 'assist', answer: "You're not in any trouble." },
                { kind: 'greetings' },
            ], SHIP);
            expect(after.context.body).toBe('Greetings.');
        });

    it('KEEPS Beg For Mercy after the bribe is paid, and reports the deal '
        + 'instead of slamming the channel shut', () => {
            const haggling = pressAll(open(HOSTILE), [{ kind: 'beg' }],
                HOSTILE);
            expect(haggling.phase).toBe('haggle');

            const paid = pressAll(haggling, [{ kind: 'pay' }], HOSTILE);
            expect(paid.phase).toBe('main');
            expect(paid.context.body).toBe("Okay, I'll leave you alone.");
            expect(paid.context.bribe?.amount).toBe(3000);
            expect(slots(paid)).toEqual(['greetings', 'beg', 'close']);
        });

    it('Lower Price on a MERCY price withdraws it with the ship\'s line, '
        + 'Beg For Mercy stays, and the next plea asks 1,000 more '
        + '(reference "R7 a provoked freighter\'s Lower Price, wave 32")',
        () => {
            const haggling = pressAll(open(HOSTILE), [{ kind: 'beg' }],
                HOSTILE);
            const next = { ...HOSTILE.bribe!, amount: 4000,
                demand: 'Pay me 4,000 credits.' };
            const lowered = pressAll(haggling,
                [{ kind: 'lowerPrice', next }], HOSTILE);
            expect(lowered.phase).toBe('main');
            expect(lowered.context.body)
                .toBe('What? How dare you! Prepare to die!');
            expect(slots(lowered)).toEqual(['greetings', 'beg', 'close']);
            const again = pressAll(lowered, [{ kind: 'beg' }], HOSTILE);
            expect(again.phase).toBe('haggle');
            expect(again.context.bribe?.amount).toBe(4000);
            // With no next offer the plea keeps its price.
            const bare = pressAll(haggling, [{ kind: 'lowerPrice' },
                { kind: 'beg' }], HOSTILE);
            expect(bare.context.bribe?.amount).toBe(3000);
        });

    it('Lower Price on a MERCY price can COUNTER with 3/4, and Lower Price '
        + 'on the counter withdraws (reference "R7 a provoked freighter\'s '
        + 'Lower Price, wave 32": 22,000 -> 16,500)', () => {
            const haggling = pressAll(open(HOSTILE), [{ kind: 'beg' }],
                HOSTILE);
            const counter = { ...HOSTILE.bribe!, amount: 2200,
                demand: 'Pay me 2,200 credits.' };
            const countered = hailPress(haggling,
                { kind: 'lowerPrice', counter }, HOSTILE) as HailPage;
            expect(countered.phase).toBe('haggle');
            expect(countered.context.bribe?.amount).toBe(2200);
            expect(haggleText(countered.context.bribe))
                .toBe('Pay me 2,200 credits.');
            const next = { ...HOSTILE.bribe!, amount: 4000 };
            const withdrawn = hailPress(countered,
                { kind: 'lowerPrice', next }, HOSTILE) as HailPage;
            expect(withdrawn.phase).toBe('main');
            expect(withdrawn.context.body)
                .toBe('What? How dare you! Prepare to die!');
            expect(withdrawn.context.bribe?.amount).toBe(4000);
            // A fuel counter is not a mercy price's.
            expect((hailPress(haggling, { kind: 'lowerPrice', counter: {
                ...counter, purpose: 'fuel' } }, HOSTILE) as HailPage).phase)
                .toBe('main');
        });

    it('still CLOSES the channel when a PORT bribe is paid', () => {
        // A port's clearance has to be re-derived by a fresh hail, so this
        // one really does close — the ship path is what changed.
        const haggling = pressAll(open(PORT), [{ kind: 'beg' }], PORT);
        expect(hailPress(haggling, { kind: 'pay' }, PORT)).toBe('close');
    });

    it('restores the OPENING line for a party with no greeting', () => {
        // A hostile ship has no greeting of its own (hail_hostile.png opens
        // on "What is it?"), so Greetings puts that line back after a
        // haggle round trip rather than inventing a hello.
        const after = pressAll(open(HOSTILE), [
            { kind: 'beg' }, { kind: 'cancel' }, { kind: 'greetings' },
        ], HOSTILE);
        expect(after.context.body).toBe('What is it?');
        expect(slots(after)).toEqual(['greetings', 'beg', 'close']);
    });

    it('ignores an offer press the context does not carry', () => {
        // Belt and braces: the 'r' key routes through the same slot, and a
        // context with no offer must not move the page.
        const bare: HailContext = {
            variant: 'ship', heading: 'Class: Terrapin', image: null,
            body: 'Channel open.',
        };
        expect(hailPress(open(bare), { kind: 'assist', answer: 'x' }, bare))
            .toEqual(open(bare));
        expect(hailPress(open(bare), { kind: 'beg' }, bare))
            .toEqual(open(bare));
        expect(slots(open(bare))).toEqual(['greetings', 'close']);
    });
});

describe('shipIdentityBlock', () => {
    // The ship comm's LOWER well (PICT 8511's second black box). Compare
    // hail/hail.png ("Class: Terrapin") with hail/hail_hostile.png
    // ("Class: Fed Destroyer" / "(Federation)" / "Status: Hostile").
    it('classes an anonymous ship on one line', () => {
        expect(shipIdentityBlock({ shipClass: 'Terrapin', hostile: false }))
            .toBe('Class: Terrapin');
    });

    it('adds the government and the hostile status', () => {
        expect(shipIdentityBlock({
            shipClass: 'Fed Destroyer', govtName: 'Federation', hostile: true,
        })).toBe('Class: Fed Destroyer\n(Federation)\nStatus: Hostile');
    });

    it('names a pers instead of classing them', () => {
        expect(shipIdentityBlock({
            persName: 'Captain Hector', shipClass: 'Terrapin', hostile: false,
        })).toBe('Captain Hector');
    });

    it('stays readable with nothing known', () => {
        expect(shipIdentityBlock({ hostile: false }))
            .toBe('Class: Unidentified ship');
    });

    it('never leaves a Status line on a friendly ship', () => {
        expect(shipIdentityBlock({
            shipClass: 'Terrapin', govtName: 'Federation', hostile: false,
        })).not.toContain('Status:');
    });
});

describe('computeContext: hailing a STELLAR', () => {
    const PLANET = 'planet-uuid';

    /** A world whose player has a stellar (and no ship) selected. */
    function planetWorld(opts: {
        minStatus?: number,
        record?: number,
        planetsTakeBribes?: boolean,
        credits?: number,
        isStation?: boolean,
        canLand?: boolean,
        /** spöb Flags 0x0020 "Stellar is uninhabited". */
        uninhabited?: boolean,
        /** Sim-clock ms until which this port has been bribed. */
        bribedUntil?: number,
        /** PlanetData.typeDescription (STR# 1100 by spöb Type). */
        typeDescription?: string,
        /** A transit stellar (PlanetData.gate). */
        gate?: 'hypergate' | 'wormhole',
        /** The pilot's game date (it seeds planetLowerPriceCounters). */
        date?: { day: number, month: number, year: number },
        /** The pilot's system-visit ordinal (SystemVisitComponent; it
         * seeds planetRefusesBribe). */
        visit?: number,
        /** The pilot's haggle with this port (StellarHaggleComponent). */
        haggle?: { countered: boolean, withdrawn: boolean },
    } = {}) {
        const gameData = new MockGameData();
        const govt = {
            ...getDefaultGovtData(), id: 'nova:128', name: 'Federation',
        };
        govt.flags.planetsTakeBribes = opts.planetsTakeBribes ?? false;
        gameData.data.Govt.map.set('nova:128', govt);

        const planetData = {
            ...getDefaultPlanetData(), id: 'nova:128', name: 'Earth',
            govt: 'nova:128', minStatus: opts.minStatus ?? -32767,
            typeDescription: opts.typeDescription ?? '',
            flags: {
                ...getDefaultPlanetData().flags,
                isStation: opts.isStation ?? false,
                canLand: opts.canLand ?? true,
                uninhabited: opts.uninhabited ?? false,
            },
            gate: opts.gate
                ? { kind: opts.gate, destinations: ['nova:1401'],
                    emergenceAngle: null }
                : null,
        };

        const world = new World();
        // The port's system: records are per system (ruling #380).
        world.resources.set(SystemIdResource, 'test:earth-system');
        const player = new Entity()
            .addComponent(PlayerShipSelector, undefined);
        if (opts.bribedUntil !== undefined) {
            player.addComponent(StellarBribesComponent,
                new Map([['nova:128', opts.bribedUntil]]));
        }
        if (opts.date) {
            player.addComponent(GameDateComponent, opts.date);
        }
        if (opts.visit !== undefined) {
            player.addComponent(SystemVisitComponent, opts.visit);
        }
        if (opts.haggle) {
            player.addComponent(StellarHaggleComponent,
                new Map([['nova:128', opts.haggle]]));
        }
        world.entities.set(PLAYER, player
            .addComponent(CreditsComponent, { credits: opts.credits ?? 10_000 })
            .addComponent(LegalRecordsComponent,
                new Map([['test:earth-system', opts.record ?? 0]]))
            .addComponent(PlanetTargetComponent, { target: PLANET }));
        world.entities.set(PLANET, new Entity()
            .addComponent(PlanetComponent, { id: 'nova:128' })
            .addComponent(PlanetDataComponent, planetData));
        return { world, gameData };
    }

    /** displayAssets carrying the real STR# 3002 / 2002 lines under test. */
    function stellarAssets() {
        const stellar: string[] = [];
        stellar[0] = 'Communications channel open to ';
        stellar[30] = 'Yeah, you wish.';
        stellar[45] = 'Yeah, right.';
        stellar[40] =
            "We'll let you slip by the security barrier if you pay us.";
        const misc: string[] = [];
        misc[81] = 'Docking request denied.';
        misc[82] = 'Landing request denied.';
        misc[95] = 'You are cleared to dock.';
        misc[98] = 'You are cleared to land.';
        misc[172] = 'Forbidden';
        misc[173] = 'Hostile';
        return {
            data: {
                StringTable: {
                    get: async (id: string) =>
                        id === STELLAR_RESPONSE_TABLE ? { strings: stellar }
                            : id === MISC_STRING_TABLE ? { strings: misc }
                                : { strings: [] },
                },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    it('clears an open port in the original\'s words and offers no bribe',
        async () => {
            const { world, gameData } = planetWorld();
            const result = await computeContext(world, gameData,
                stellarAssets());

            expect(result?.context.variant).toBe('planet');
            // "Channel open to Earth." is the reference's own opening line.
            expect(result?.context.body)
                .toBe('Communications channel open to Earth.\n'
                    + 'You are cleared to land.');
            // A friendly port names itself and carries no Status line.
            expect(result?.context.heading).toBe('Earth');
            expect(result?.context.bribe).toBeUndefined();
        });

    it('shows the stellar\'s own sprite, not its landscape PICT',
        async () => {
            // hail/hail_planet.png: Earth's space sprite (rlëD 2000) on the
            // frame's starfield. The landscape is the spaceport's picture.
            const { world, gameData } = planetWorld();
            const planet = world.entities.get(PLANET)!;
            const planetData = planet.components.get(PlanetDataComponent)!;
            planet.components.set(PlanetDataComponent,
                { ...planetData, landingPict: 'nova:10000' });
            const result = await computeContext(world, gameData,
                stellarAssets());

            expect(result?.context.image).toBeNull();
            expect(result?.context.stellarSprite)
                .toEqual(planetData.animation.images.baseImage);
        });

    it('gives the stellar\'s class caption under its name', async () => {
        // hail/hail_planet.png: "Earth" / "[Earth/Luna System]" (STR# 1100
        // entry 0, Earth's spöb Type) — its class, not its system (Sol).
        const { world, gameData } = planetWorld({
            typeDescription: '[Earth/Luna System]',
        });
        const result = await computeContext(world, gameData,
            stellarAssets());
        expect(result?.context.heading).toBe('Earth\n[Earth/Luna System]');
    });

    it('keeps a refusing port\'s Status line under the class caption',
        async () => {
            const { world, gameData } = planetWorld({
                minStatus: 0, record: -1, planetsTakeBribes: true,
                typeDescription: '[Rocky Moon - metallic]',
            });
            const result = await computeContext(world, gameData,
                stellarAssets());
            expect(result?.context.heading)
                .toBe('Earth\n[Rocky Moon - metallic]\nStatus: Hostile');
        });

    it('refuses a criminal, states the status as Hostile, and offers the '
        + 'port\'s price when its govt bargains', async () => {
            const { world, gameData } = planetWorld({
                minStatus: 0, record: -1, planetsTakeBribes: true,
            });
            const result = await computeContext(world, gameData,
                stellarAssets());

            // STR# 3002 index 40 — the bribe offer, not a flat refusal.
            expect(result?.context.body).toContain(
                "We'll let you slip by the security barrier if you pay us.");
            // STR# 2002 index 173, painted red by identityRuns.
            expect(result?.context.heading).toBe('Earth\nStatus: Hostile');
            // A plain (0x4000) govt's planet asks 3,000, here also a third
            // of 10,000 (reference "R7 bribe price, wave 22"), in its own
            // words.
            // Lower Price's two answers ride along (reference "R7 planet
            // bribe, wave 28"): the withdrawal (STR# 3002 30-34) and the
            // refusal of every later offer (45-49).
            expect(result?.context.bribe).toEqual({
                amount: 3000, canAfford: true, purpose: 'landing',
                demand: 'Pay us 3,000 credits.',
                withdrawn: 'Yeah, you wish.', refused: 'Yeah, right.',
            });
            expect(result?.replies.planetBribe?.planetId).toBe('nova:128');
            expect(result?.replies.planetBribe?.price).toBe(3000);
        });

    it('refuses every offer for the rest of the system visit once the '
        + 'planet has withdrawn, on later days too (reference "R7 planet '
        + 'bribe withdrawal, wave 29")', async () => {
            const date = { day: 1, month: 1, year: 1177 };
            // The visit's fresh draw names a price: only the withdrawal
            // refuses.
            expect(planetRefusesBribe(PLANET, PLAYER, false, 0))
                .toBeFalse();
            const withdrawn = planetWorld({
                minStatus: 0, record: -1, planetsTakeBribes: true, date,
                haggle: { countered: false, withdrawn: true },
            });
            const result = await computeContext(withdrawn.world,
                withdrawn.gameData, stellarAssets());
            expect(result?.context.bribe).toBeUndefined();
            // STR# 3002 45-49 ("Yeah, right." here).
            expect(result?.context.mercyRefused).toBe('Yeah, right.');
            expect(commButtonSlots('planet', result!.context))
                .toEqual(['greetings', 'bribe', 'close']);

            // The next day, still in the system (a landing elsewhere and
            // a take-off moved the date): still refused.
            const nextDay = { day: 2, month: 1, year: 1177 };
            const later = planetWorld({
                minStatus: 0, record: -1, planetsTakeBribes: true,
                date: nextDay,
                haggle: { countered: false, withdrawn: true },
            });
            const still = await computeContext(later.world, later.gameData,
                stellarAssets());
            expect(still?.context.bribe).toBeUndefined();
            expect(still?.context.mercyRefused).toBe('Yeah, right.');

            // After a jump out and back the entry is gone (the crossing
            // drops it and advances the visit twice:
            // pilot/transition_prep.ts): a fresh price.
            const back = planetWorld({
                minStatus: 0, record: -1, planetsTakeBribes: true,
                date: { day: 3, month: 1, year: 1177 }, visit: 2,
            });
            expect(planetRefusesBribe(PLANET, PLAYER, false, 2)).toBeFalse();
            const offer = await computeContext(back.world, back.gameData,
                stellarAssets());
            expect(offer?.context.bribe?.amount).toBe(3000);
            expect(offer?.context.mercyRefused).toBeUndefined();
        });

    it('quotes the 3/4 counter while one is on the table', async () => {
        const date = { day: 1, month: 1, year: 1177 };
        const { world, gameData } = planetWorld({
            minStatus: 0, record: -1, planetsTakeBribes: true, date,
            haggle: { countered: true, withdrawn: false },
        });
        const result = await computeContext(world, gameData, stellarAssets());
        // 3,000 -> 2,200 (reference "R7 bribe price, wave 22").
        expect(result?.context.bribe?.amount).toBe(2200);
        expect(result?.context.bribe?.demand).toBe('Pay us 2,200 credits.');
    });

    it('the dialog\'s own Lower Price outranks the mirrored haggle',
        async () => {
            const date = { day: 1, month: 1, year: 1177 };
            const { world, gameData } = planetWorld({
                minStatus: 0, record: -1, planetsTakeBribes: true, date,
            });
            const local = new Map([['nova:128', {
                countered: false, withdrawn: true,
            }]]);
            const result = await computeContext(world, gameData,
                stellarAssets(), local);
            expect(result?.context.bribe).toBeUndefined();
            expect(result?.context.mercyRefused).toBe('Yeah, right.');
            // The draw a first Lower Price makes is a pure function of the
            // planet, the pilot and the day.
            expect(planetLowerPriceCounters(PLANET, PLAYER, bribeDay(date)))
                .toBe(planetLowerPriceCounters(PLANET, PLAYER,
                    bribeDay(date)));
        });

    it('an ordinary port that turns the bribe down flat still offers it, '
        + 'and answers the press with the refusal (reference "R7 bribe '
        + 'price above 1M, wave 27": "Yeah, right." at 2M)', async () => {
            // planetRefusesBribe draws per planet, pilot and system visit:
            // this pilot is refused by this port on visit 1, not on visit
            // 0 (no SystemVisit yet).
            expect(planetRefusesBribe(PLANET, PLAYER, false, 1))
                .toBeTrue();
            expect(planetRefusesBribe(PLANET, PLAYER, false, 0))
                .toBeFalse();
            const refused = planetWorld({
                minStatus: 0, record: -1, planetsTakeBribes: true,
                credits: 2_000_000, date: { day: 15, month: 1, year: 1177 },
                visit: 1,
            });
            const result = await computeContext(refused.world,
                refused.gameData, stellarAssets());
            // The opening is the bargaining port's; the press answers
            // from STR# 3002 45-49 ("Yeah, right.", reference "R7 planet
            // bribe, wave 28").
            expect(result?.context.body).toContain(
                "We'll let you slip by the security barrier if you pay us.");
            expect(result?.context.bribe).toBeUndefined();
            expect(result?.context.mercyRefused).toBe('Yeah, right.');
            expect(commButtonSlots('planet', result!.context))
                .toEqual(['greetings', 'bribe', 'close']);

            // A landing in the system a day later is the same visit: still
            // refused (reference "R7 planet bribe withdrawal, wave 30",
            // finding 3: "Yeah, right." the next day).
            const nextDay = planetWorld({
                minStatus: 0, record: -1, planetsTakeBribes: true,
                credits: 2_000_000, date: { day: 16, month: 1, year: 1177 },
                visit: 1,
            });
            const still = await computeContext(nextDay.world,
                nextDay.gameData, stellarAssets());
            expect(still?.context.bribe).toBeUndefined();
            expect(still?.context.mercyRefused).toBe('Yeah, right.');

            const priced = planetWorld({
                minStatus: 0, record: -1, planetsTakeBribes: true,
                credits: 2_000_000, date: { day: 15, month: 1, year: 1177 },
            });
            const offer = await computeContext(priced.world,
                priced.gameData, stellarAssets());
            expect(offer?.context.bribe?.purpose).toBe('landing');
            expect(offer?.context.mercyRefused).toBeUndefined();
        });

    it('refuses flatly when the port will not be bought', async () => {
        const { world, gameData } = planetWorld({
            minStatus: 0, record: -1, planetsTakeBribes: false,
        });
        const result = await computeContext(world, gameData, stellarAssets());

        // STR# 2002 index 82 followed by STR# 3002 index 30.
        expect(result?.context.body).toContain('Landing request denied.');
        expect(result?.context.body).toContain('Yeah, you wish.');
        expect(result?.context.bribe).toBeUndefined();
    });

    it('reports a shut port as Forbidden and uses the STATION wording',
        async () => {
            const { world, gameData } = planetWorld({
                minStatus: 32767, isStation: true,
            });
            const result = await computeContext(world, gameData,
                stellarAssets());

            expect(result?.context.heading).toBe('Earth\nStatus: Forbidden');
            expect(result?.context.body).toContain('Docking request denied.');
        });

    it('clears a station with the docking wording', async () => {
        const { world, gameData } = planetWorld({ isStation: true });
        const result = await computeContext(world, gameData, stellarAssets());
        expect(result?.context.body).toContain('You are cleared to dock.');
    });

    it('judges a paid bribe against the MIRRORED SIM CLOCK, not this '
        + 'world\'s wall clock', async () => {
            // The sim stamps bribe expiries on its 0-based logical clock.
            // A display world keeps wall-clock epoch ms in TimeResource,
            // which is ~50 years past any such stamp: read there, every
            // paid bribe looked expired and the channel re-offered the deal.
            const { world, gameData } = planetWorld({
                minStatus: 0, record: -1, planetsTakeBribes: true,
                bribedUntil: 90_000,
            });
            await world.addPlugin(TimePlugin);
            world.resources.set(TimeResource, {
                time: 1_800_000_000_000, delta_ms: 16, delta_s: 0.016,
                frame: 1,
            });
            world.resources.set(SimulationTimeResource, {
                time: 60_000, delta_ms: 16, delta_s: 0.016, frame: 3600,
            });
            const result = await computeContext(world, gameData,
                stellarAssets());

            expect(result?.context.body).toContain('You are cleared to land.');
            expect(result?.context.bribe).toBeUndefined();
            expect(result?.context.heading).toBe('Earth');

            // And once the sim clock passes the expiry, the deal is back.
            world.resources.set(SimulationTimeResource, {
                time: 90_001, delta_ms: 16, delta_s: 0.016, frame: 5400,
            });
            const later = await computeContext(world, gameData,
                stellarAssets());
            expect(later?.context.bribe?.purpose).toBe('landing');
        });

    it('opens NO channel to an UNLANDABLE stellar (Jupiter) — nobody is '
        + 'there to answer', async () => {
            const { world, gameData } = planetWorld({
                canLand: false, planetsTakeBribes: true,
            });
            const result = await computeContext(world, gameData,
                stellarAssets());

            // The refusal marker: undefined, so no dialog is shown at all.
            // A dead moon has no traffic control to deny a landing, to
            // bargain, or to state a Status — the press gets "No response."
            // on the status line and a beep instead (see the plugin's
            // hailIsUnanswerable / refuseHail).
            expect(result).toBeUndefined();
        });

    it('still opens the channel for a landable stellar targeted the same way',
        async () => {
            // Guards the refusal against over-reach: only the can-land bit
            // silences the channel.
            const { world, gameData } = planetWorld({ canLand: true });
            const result = await computeContext(world, gameData,
                stellarAssets());
            expect(result?.context.variant).toBe('planet');
        });

    it('falls back to pinned literals when the string tables are missing',
        async () => {
            const { world, gameData } = planetWorld();
            const result = await computeContext(world, gameData);
            expect(result?.context.body)
                .toBe('Communications channel open to Earth.\n'
                    + 'You are cleared to land.');
        });

    describe('hailTargetIsDisabled (a hulk answers nothing)', () => {
        // The original (reference "Reviving a disabled ally, wave 11"):
        // a disabled mission ally and a disabled hired escort both
        // answered the hail key with "No response." and no channel.
        it('refuses a disabled ship, your own escort included', () => {
            const { world } = makeWorld(target => {
                target.components.set(FormationComponent,
                    { leader: PLAYER, slot: 0 });
                target.components.set(DisabledComponent, { repairAt: null });
            });
            expect(hailTargetIsDisabled(world)).toBeTrue();
        });

        it('lets the same ship answer while it is not disabled', () => {
            const { world } = makeWorld(target => {
                target.components.set(FormationComponent,
                    { leader: PLAYER, slot: 0 });
            });
            expect(hailTargetIsDisabled(world)).toBeFalse();
        });

        it('is silent (not a refusal) when nothing is targeted', () => {
            const { world } = makeWorld(() => undefined);
            world.entities.get(PLAYER)!.components.delete(TargetComponent);
            expect(hailTargetIsDisabled(world)).toBeFalse();
        });
    });

    describe('hailIsUnanswerable (the no-dialog refusal)', () => {
        it('refuses a hail at an uninhabited stellar', () => {
            const { world } = planetWorld({ canLand: false });
            expect(hailIsUnanswerable(world)).toBeTrue();
        });

        it('lets a landable, INHABITED stellar answer', () => {
            const { world } = planetWorld({ canLand: true });
            expect(hailIsUnanswerable(world)).toBeFalse();
        });

        it('refuses a LANDABLE stellar that is flagged uninhabited — the '
            + 'Bible\'s 0x0020 is "no traffic control or refuelling", so '
            + 'Pan, Spica and the wormholes have nobody to answer', () => {
                const { world } = planetWorld({
                    canLand: true, uninhabited: true,
                });
                expect(hailIsUnanswerable(world)).toBeTrue();
            });

        it('refuses a GATE the player may not use: "No response.", no dialog '
            + '(HG-V01, reference "Stellar hail graphic, wave 23")',
            async () => {
                for (const gate of ['hypergate', 'wormhole'] as const) {
                    // Every working stock gate is MinStatus 32767, "player
                    // can never land", until ränk 147 opens the network.
                    const { world, gameData } = planetWorld({
                        gate, isStation: true, minStatus: 32767,
                        planetsTakeBribes: true,
                    });
                    expect(hailIsUnanswerable(world))
                        .withContext(gate).toBeTrue();
                    expect(await computeContext(world, gameData,
                        stellarAssets())).withContext(gate).toBeUndefined();
                }
            });

        it('refuses a gate the player MAY use too (Kit Gate C2 after "Cleared '
            + 'for hypergate entry", reference "Hypergates and the radar, '
            + 'wave 24"; the wormhole a GUESS)', async () => {
                for (const gate of ['hypergate', 'wormhole'] as const) {
                    const { world, gameData } = planetWorld({
                        gate, isStation: true,
                    });
                    expect(hailIsUnanswerable(world))
                        .withContext(gate).toBeTrue();
                    expect(await computeContext(world, gameData,
                        stellarAssets())).withContext(gate).toBeUndefined();
                }
            });

        it('still opens a refusing NON-gate port, to bargain', async () => {
            const { world, gameData } = planetWorld({
                minStatus: 32767, planetsTakeBribes: true,
            });
            expect(hailIsUnanswerable(world)).toBeFalse();
            const result = await computeContext(world, gameData,
                stellarAssets());
            expect(result?.context.variant).toBe('planet');
        });

        it('is silent (not a refusal) when nothing is targeted', () => {
            // computeContext also returns undefined here, but a hail into
            // empty space must not beep "No response." at the player.
            const { world } = planetWorld();
            world.entities.get(PLAYER)!.components
                .delete(PlanetTargetComponent);
            expect(hailIsUnanswerable(world)).toBeFalse();
        });

        it('a targeted SHIP wins over a dead moon that is also selected',
            () => {
                // The ship target is what computeContext reads first, so
                // hailing a ship while Jupiter happens to be selected must
                // open the ship's channel rather than beep.
                const { world } = planetWorld({ canLand: false });
                world.entities.get(PLAYER)!.components
                    .set(TargetComponent, { target: TARGET });
                world.entities.set(TARGET, new Entity()
                    .addComponent(ShipDataComponent, shipData()));
                expect(hailIsUnanswerable(world)).toBeFalse();
            });

        it('uses the original\'s wording, with the pinned fallback', () => {
            // STR# 2002 index 52 is "No response." — the original's own
            // status line for a hail nobody answers (its neighbour at 53
            // is the other hail-failure line). The plugin reads it through
            // miscString, so a missing table still says the right thing.
            const misc: string[] = [];
            misc[NO_RESPONSE_INDEX] = 'No response.';
            expect(miscString(misc, NO_RESPONSE_INDEX, NO_RESPONSE_FALLBACK))
                .toBe('No response.');
            expect(miscString(undefined, NO_RESPONSE_INDEX,
                NO_RESPONSE_FALLBACK)).toBe('No response.');
            expect(NO_RESPONSE_FALLBACK).toBe('No response.');
        });
    });

    /**
     * The comm dialog through the plugin's own 'y' handler, with the
     * stellar selection landing a snapshot AFTER the press (the number key
     * pressed just ahead of 'y'): `before` is the selection the display
     * world holds at the press, and the dialog must hail Philar.
     */
    async function hailRacingTheSelection(before: string | undefined) {
        installHeadlessPixi();
        const { world, gameData } = planetWorld({ isStation: true });
        world.entities.set(OTHER_PLANET, new Entity()
            .addComponent(PlanetComponent, { id: 'nova:129' })
            .addComponent(PlanetDataComponent, {
                ...world.entities.get(PLANET)!.components
                    .get(PlanetDataComponent)!,
                id: 'nova:129', name: 'Pholar',
            }));
        world.entities.get(PLANET)!.components.get(PlanetDataComponent)!
            .name = 'Philar';
        const player = world.entities.get(PLAYER)!;
        player.components.set(PlanetTargetComponent, { target: before });
        const keys = new Subject<ControlEvent>();
        world.resources.set(SimulationGameDataResource, gameData);
        world.resources.set(DisplayAssetDataResource, stellarAssets());
        world.resources.set(ControlsSubject, keys);
        world.resources.set(Stage, new PIXI.Container());
        world.resources.set(ScreenSize, { x: 1024, y: 768 });
        world.resources.set(SimulationTimeResource,
            { time: 0, delta_s: 0, delta_ms: 0, frame: 0 });
        await world.addPlugin(HailDialogPlugin);
        const dialog = world.resources.get(HailDialogResource)!;
        let shown: HailContext | undefined;
        dialog.show = async (context: HailContext) => { shown = context; };

        // The display sees 'y' at once, and the selection only once the
        // simulation has stepped on it and its snapshot has landed.
        keys.next({ action: 'hail', state: 'start' });
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        await sleep(10);
        player.components.set(PlanetTargetComponent, { target: PLANET });
        for (let frame = 1; frame <= 2; frame++) {
            world.resources.set(SimulationTimeResource,
                { time: frame * 1000 / 60, delta_s: 0, delta_ms: 0, frame });
            await sleep(10);
        }
        for (let i = 0; i < 100 && !shown; i++) {
            await sleep(5);
        }
        await world.removePlugin(HailDialogPlugin);
        return shown;
    }
    const OTHER_PLANET = 'planet-uuid-2';

    it('hails the stellar selected just before the press, not the one '
        + 'selected before that (Philar / Pholar, nova:603)', async () => {
            const shown = await hailRacingTheSelection(OTHER_PLANET);
            expect(shown?.heading.split('\n')[0]).toBe('Philar');
        });

    it('opens a channel when the press beat the first selection (Gladius '
        + 'Shipyards, nova:281)', async () => {
            const shown = await hailRacingTheSelection(undefined);
            expect(shown).withContext('a dialog opened').toBeDefined();
            expect(shown?.heading.split('\n')[0]).toBe('Philar');
        });

});

/**
 * #297's ruling: "Hostility in the hailing channel should reflect the iff of
 * that ship, not the government stance. A ship of an unfriendly government
 * may show as neutral when hailed, but they will likely be rude and not offer
 * assistance for free, or at all. Any ship that is iff hostile shows up as
 * hostile with the 'beg for mercy' button instead of 'request assistance'.
 * Some ships don't respond to hails at all (no hailing channel appears), like
 * the krypt pod and wraith, and some don't have a 'request assistance' button
 * (Polaris (often) and Dechtakar)."
 *
 * The channel reads hostility.ts's isIffHostile — the corners' own verdict —
 * so each case below also checks that the brackets around the same ship say
 * the same thing.
 */
describe('computeContext: the channel shows the ship\'s IFF (ruling #297)',
    () => {
        const NOW = 60_000;

        function iffWorld(govtId: string,
            configure: (target: Entity) => void = () => { },
            govtOverrides: Partial<ReturnType<typeof getDefaultGovtData>> = {}) {
            const built = makeWorld(target => {
                target.components.set(GovtComponent, { id: govtId });
                configure(target);
            });
            built.gameData.data.Govt.map.set(govtId, {
                ...getDefaultGovtData(), id: govtId, ...govtOverrides,
            });
            built.world.resources.set(SimulationTimeResource, {
                time: NOW, delta_ms: 16, delta_s: 0.016, frame: 3600,
            });
            return built;
        }

        /** The corner set the target corners would draw for TARGET. */
        async function corners(world: World,
            gameData: Parameters<typeof computeContext>[1]) {
            // computeContext awaits the govts, which warms getCached.
            await computeContext(world, gameData);
            return styleForTarget(TARGET, world.entities.get(TARGET)!, PLAYER,
                world.entities.get(PLAYER)!, gameData,
                uuid => world.entities.get(uuid), NOW, undefined);
        }

        it('shows a fleeing RECENT AGGRESSOR as hostile, with Beg For Mercy '
            + 'and no Request Assistance — exactly as its corners do',
            async () => {
                const { world, gameData } = iffWorld('test:neutral', target => {
                    target.components.set(NpcComponent,
                        { aiType: 3, mode: 'flee' });
                });
                // It shot the player five seconds ago (tier 3b).
                world.entities.get(PLAYER)!.components.set(AggressionComponent,
                    new Map([[TARGET,
                        { at: NOW - 5_000, damage: 80, hostile: true }]]));

                const result = await computeContext(world, gameData);
                expect(result?.context.heading).toContain('Status: Hostile');
                expect(result?.context.assist).toBeUndefined();
                expect(commButtonSlots('ship', result!.context))
                    .toEqual(['greetings', 'beg', 'close']);
                expect(await corners(world, gameData)).toBe('hostile');
            });

        it('treats another player\'s ESCORT engaging us as hostile', async () => {
            const { world, gameData } = iffWorld('test:neutral', target => {
                target.components.set(TargetComponent, { target: PLAYER });
                target.components.set(EscortCommandComponent,
                    { command: 'defend', target: PLAYER });
            });
            const result = await computeContext(world, gameData);
            expect(result?.context.heading).toContain('Status: Hostile');
            expect(result?.context.assist).toBeUndefined();
            expect(await corners(world, gameData)).toBe('hostile');
        });

        it('shows the same ship NEUTRAL once the aggression window has '
            + 'passed, and offers assistance again', async () => {
            const { world, gameData } = iffWorld('test:neutral', target => {
                target.components.set(NpcComponent,
                    { aiType: 3, mode: 'flee' });
            });
            world.entities.get(PLAYER)!.components.set(AggressionComponent,
                new Map([[TARGET, {
                    at: NOW - AGGRESSION_WINDOW_MS, damage: 80, hostile: true,
                }]]));
            const result = await computeContext(world, gameData);
            expect(result?.context.heading).not.toContain('Status:');
            expect(result?.context.assist).toBeDefined();
            expect(await corners(world, gameData)).toBe('neutral');
        });

        it('shows a bought-off pirate NEUTRAL, with Request Assistance — it '
            + 'is rude and makes you PAY (ruling #297, 2026-10-03: "always '
            + 'visible ... They just refuse to help you or make you pay")',
            async () => {
                const { world, gameData } = iffWorld('test:pirate', target => {
                    target.components.set(NpcComponent, {
                        aiType: 3, pacifiedFrom: PLAYER,
                        pacifiedUntil: NOW + 60_000,
                    });
                }, {
                    flags: {
                        ...getDefaultGovtData().flags,
                        xenophobic: true, largerBribes: true,
                        warshipsTakeBribes: true,
                    },
                });
                const player = world.entities.get(PLAYER)!;
                player.components.set(CreditsComponent, { credits: 100_000 });
                player.components.set(DisabledComponent, { repairAt: null });
                const result = await computeContext(world, gameData);
                const context = result!.context;
                expect(context.heading).not.toContain('Status:');
                expect(context.mercyRefused).toBeUndefined();
                expect(commButtonSlots('ship', context))
                    .toEqual(['greetings', 'assist', 'close']);
                expect(await corners(world, gameData)).toBe('neutral');
                // Rude: Greetings gets the curt group, not a greeting.
                expect(context.greeting).toBe(HOSTILE_RESPONSE_FALLBACK);
                // The price of its help: the mercy demand (a 0x8000 govt's
                // flat 20,000 here; GUESS that help costs the same).
                expect(context.bribe).toEqual({
                    amount: 20_000, canAfford: true, purpose: 'assist',
                    offer: ASSIST_FOR_PAY_FALLBACK,
                    accepted: ASSIST_PAID_FALLBACK,
                });
                // The press names the price and dispatches nothing...
                const answer = assistAnswer(world, TARGET, result!.replies);
                expect(answer).toEqual({
                    line: ASSIST_FOR_PAY_FALLBACK, dispatch: false,
                    haggle: true,
                });
                // ...onto the haggle page, whose Pay brings it back with
                // the ship's "on my way".
                const haggle = hailPress({ phase: 'main', context },
                    { kind: 'assist', answer: answer.line, haggle: true },
                    context) as HailPage;
                expect(haggle.phase).toBe('haggle');
                // Its terms in the well, the demand on the popup.
                expect(haggle.context.body).toBe(ASSIST_FOR_PAY_FALLBACK);
                expect(haggleText(haggle.context.bribe)).toBe(
                    `They demand ${(20_000).toLocaleString()} credits to `
                    + 'help you.');
                expect(hailPress(haggle, { kind: 'pay' }, context)).toEqual({
                    phase: 'main', context: {
                        ...haggle.context, body: ASSIST_PAID_FALLBACK,
                    },
                });
                // Beg For Mercy's press cannot reach a price for help.
                expect(hailPress({ phase: 'main', context }, { kind: 'beg' },
                    context)).toEqual({ phase: 'main', context });
            });

        it('REFUSES help from an unfriendly govt that takes no bribes, with '
            + 'the button still there', async () => {
                const { world, gameData } = iffWorld('test:hater', target => {
                    target.components.set(NpcComponent, {
                        aiType: 3, pacifiedFrom: PLAYER,
                        pacifiedUntil: NOW + 60_000,
                    });
                }, {
                    flags: {
                        ...getDefaultGovtData().flags,
                        alwaysAttacksPlayer: true,
                    },
                });
                world.entities.get(PLAYER)!.components
                    .set(DisabledComponent, { repairAt: null });
                const result = await computeContext(world, gameData);
                expect(commButtonSlots('ship', result!.context))
                    .toEqual(['greetings', 'assist', 'close']);
                expect(result!.context.bribe).toBeUndefined();
                expect(assistAnswer(world, TARGET, result!.replies)).toEqual({
                    line: ASSIST_REFUSED_FALLBACK, dispatch: false,
                    haggle: false,
                });
                // A healthy player is still told they need nothing first.
                world.entities.get(PLAYER)!.components
                    .delete(DisabledComponent);
                expect(assistAnswer(world, TARGET, result!.replies).line)
                    .toBe(NO_NEED_RESPONSE_FALLBACK);
            });

        it('keeps the ordinary greeting for a ship whose govt does not '
            + 'dislike the player', async () => {
                const { world, gameData } = iffWorld('test:neutral');
                const result = await computeContext(world, gameData);
                expect(result!.context.greeting).not
                    .toBe(HOSTILE_RESPONSE_FALLBACK);
                expect(result!.context.greeting).toBeDefined();
            });

        it('greets RUDELY from STR# 3000 10-14, seeded by the ship', async () => {
            const { world, gameData } = iffWorld('test:pirate', target => {
                target.components.set(NpcComponent, {
                    aiType: 3, pacifiedFrom: PLAYER,
                    pacifiedUntil: NOW + 60_000,
                });
            }, {
                flags: { ...getDefaultGovtData().flags, xenophobic: true },
            });
            const strings = Array.from({ length: 190 },
                (_, i) => `line ${i}`);
            const assets = {
                data: { StringTable: { get: async () => ({ strings }) } },
            } as unknown as DisplayAssetDataInterface;
            const first = await computeContext(world, gameData, assets);
            const again = await computeContext(world, gameData, assets);
            const index = Number(first!.context.greeting!.split(' ')[1]);
            expect(index).toBeGreaterThanOrEqual(HOSTILE_RESPONSE_FIRST_INDEX);
            expect(index).toBeLessThan(HOSTILE_RESPONSE_FIRST_INDEX + 5);
            expect(again!.context.greeting).toBe(first!.context.greeting);
        });

        it('classes the ship by its shïp CommName ("Class: Aur Carrier")',
            async () => {
                const { world, gameData } = iffWorld('test:neutral', target => {
                    target.components.set(ShipDataComponent, shipData({
                        id: 'nova:128', name: 'Aurora Carrier',
                        commName: 'Aur Carrier',
                    }));
                });
                gameData.data.Govt.map.get('test:neutral')!.commName =
                    'Dechtakar';
                const result = await computeContext(world, gameData);
                expect(result!.context.heading)
                    .toBe('Class: Aur Carrier\n(Dechtakar)');
            });

        it('offers Beg For Mercy to a hostile ship that will NOT be bought, '
            + 'and the plea is refused in the well (STR# 3000 95-99)',
            async () => {
                const { world, gameData } = iffWorld('test:neutral', target => {
                    target.components.set(NpcComponent,
                        { aiType: 3, mode: 'attack' });
                    target.components.set(TargetComponent, { target: PLAYER });
                });
                const result = await computeContext(world, gameData);
                const context = result!.context;
                expect(context.bribe).toBeUndefined();
                expect(context.mercyRefused).toBe(MERCY_REFUSED_FALLBACK);
                expect(commButtonSlots('ship', context))
                    .toEqual(['greetings', 'beg', 'close']);
                const page = hailPress({ phase: 'main', context },
                    { kind: 'beg' }, context);
                expect(page).toEqual({ phase: 'main', context: {
                    ...context, body: MERCY_REFUSED_FALLBACK,
                } });
            });

        it('gives a hostile Flags2 0x0001 govt no Beg For Mercy at all',
            async () => {
                const { world, gameData } = iffWorld('test:silentish', target => {
                    target.components.set(NpcComponent,
                        { aiType: 3, mode: 'attack' });
                    target.components.set(TargetComponent, { target: PLAYER });
                }, {
                    flags: {
                        ...getDefaultGovtData().flags, warshipsTakeBribes: true,
                    },
                    flags2: {
                        ...getDefaultGovtData().flags2, noAssistOrMercy: true,
                    },
                });
                const result = await computeContext(world, gameData);
                expect(result?.context.heading).toContain('Status: Hostile');
                expect(commButtonSlots('ship', result!.context))
                    .toEqual(['greetings', 'close']);
            });

        it('opens the Dechtakar\'s channel (Flags2 0x0001 only) with no '
            + 'Request Assistance', async () => {
            const { world, gameData } = iffWorld('test:dechtakar', () => { }, {
                flags2: {
                    ...getDefaultGovtData().flags2, noAssistOrMercy: true,
                },
            });
            const result = await computeContext(world, gameData);
            expect(result).toBeDefined();
            expect(commButtonSlots('ship', result!.context))
                .toEqual(['greetings', 'close']);
        });

        it('opens NO channel to a Krypt-like ship (Flags2 0x0001 + 0x0008)',
            async () => {
                const { world, gameData } = iffWorld('test:krypt', () => { }, {
                    flags2: {
                        ...getDefaultGovtData().flags2,
                        noAssistOrMercy: true, noDistressMessages: true,
                    },
                });
                expect(await computeContext(world, gameData)).toBeUndefined();
            });

        it('opens NO channel to a class that inherits Can\'t-hail', async () => {
            const { world, gameData } = iffWorld('test:neutral', target => {
                target.components.set(ShipDataComponent, shipData({
                    id: 'nova:128', name: 'Wraith (Adult)',
                    inheritedCantBeHailed: true,
                }));
            });
            expect(await computeContext(world, gameData)).toBeUndefined();
        });
    });

/**
 * Ruling #332: "Eventually, hailing a player should open an actual channel of
 * some kind ... For now, buttons pressed should just send the message to the
 * bottom left info text area on that player's screen. Nothing should take
 * control of their ship."
 */
describe('computeContext: hailing another PLAYER\'s ship (#332)', () => {
    function playerTargetWorld() {
        const built = makeWorld(target => {
            target.components.set(ControlledByComponent,
                { peerId: 'the other peer' });
        });
        built.world.resources.set(SimulationTimeResource, {
            time: 60_000, delta_ms: 16, delta_s: 0.016, frame: 3600,
        });
        return built;
    }

    it('opens the ship column, every press of which is a message', async () => {
        const { world, gameData } = playerTargetWorld();
        const result = await computeContext(world, gameData);
        const context = result!.context;
        expect(context.playerChannel).toEqual({ hostile: false });
        // No ship-side offer is computed for them at all.
        expect(context.assist).toBeUndefined();
        expect(context.bribe).toBeUndefined();
        expect(commButtonSlots('ship', context))
            .toEqual(['greetings', 'assist', 'close']);
        expect(playerChannelMessage(context, 'greetings')).toBe('greetings');
        expect(playerChannelMessage(context, 'offer')).toBe('assistance');
    });

    it('offers Beg For Mercy to a player who is IFF-hostile to us', async () => {
        const { world, gameData } = playerTargetWorld();
        world.entities.get(PLAYER)!.components.set(AggressionComponent,
            new Map([[TARGET, { at: 59_000, damage: 40, hostile: true }]]));
        const context = (await computeContext(world, gameData))!.context;
        expect(context.playerChannel).toEqual({ hostile: true });
        expect(context.heading).toContain('Status: Hostile');
        expect(commButtonSlots('ship', context))
            .toEqual(['greetings', 'beg', 'close']);
        expect(playerChannelMessage(context, 'offer')).toBe('mercy');
    });

    it('says the message went, and keeps the column', async () => {
        const { world, gameData } = playerTargetWorld();
        const context = (await computeContext(world, gameData))!.context;
        const page = hailPress({ phase: 'main', context },
            { kind: 'sent', answer: 'Message sent.' }, context);
        expect(page).toEqual({
            phase: 'main', context: { ...context, body: 'Message sent.' },
        });
        // A 'sent' press means nothing outside a player channel.
        const npcContext: HailContext = {
            variant: 'ship', heading: '', image: null, body: 'Channel open.',
        };
        const npcPage: HailPage = { phase: 'main', context: npcContext };
        expect(hailPress(npcPage, { kind: 'sent', answer: 'x' }))
            .toBe(npcPage);
    });

    it('answers "Sorry sir, I\'m just an escort." from ANOTHER player\'s '
        + 'escort, and dispatches nothing (ruling #332)', async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(PlayerEscortComponent, {
                    player: 'their ship', deal: { kind: 'none' },
                } as never);
            });
            // Even a player who really needs help.
            world.entities.get(PLAYER)!.components
                .set(DisabledComponent, { repairAt: null });
            const result = await computeContext(world, gameData);
            const context = result!.context;
            expect(context.playerChannel).toBeUndefined();
            expect(context.bribe).toBeUndefined();
            expect(commButtonSlots('ship', context))
                .toEqual(['greetings', 'assist', 'close']);
            expect(assistAnswer(world, TARGET, result!.replies)).toEqual({
                line: JUST_AN_ESCORT_FALLBACK, dispatch: false, haggle: false,
            });
        });

    it('answers the same from an NPC flagship\'s fleet escort (the '
        + 'original\'s Fed Viper)', async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(FormationComponent,
                    { leader: 'some flagship', slot: 1 });
            });
            world.entities.get(PLAYER)!.components
                .set(DisabledComponent, { repairAt: null });
            const result = await computeContext(world, gameData);
            expect(result!.context.variant).toBe('ship');
            expect(assistAnswer(world, TARGET, result!.replies).line)
                .toBe(JUST_AN_ESCORT_FALLBACK);
        });

    it('refuses a plea for mercy from another player\'s IFF-hostile escort '
        + 'the same way', async () => {
            const { world, gameData } = makeWorld(target => {
                target.components.set(PlayerEscortComponent, {
                    player: 'their ship', deal: { kind: 'none' },
                } as never);
                target.components.set(TargetComponent, { target: PLAYER });
                target.components.set(EscortCommandComponent,
                    { command: 'attack', target: PLAYER });
            });
            world.resources.set(SimulationTimeResource, {
                time: 60_000, delta_ms: 16, delta_s: 0.016, frame: 3600,
            });
            const context = (await computeContext(world, gameData))!.context;
            expect(context.heading).toContain('Status: Hostile');
            expect(context.bribe).toBeUndefined();
            expect(context.mercyRefused).toBe(JUST_AN_ESCORT_FALLBACK);
            expect(commButtonSlots('ship', context))
                .toEqual(['greetings', 'beg', 'close']);
        });
});

/**
 * The 2026-10-03 rulings on #297 through the parser, on the checked-in
 * synthetic data set: the class line is the shïp CommName, and a Verge
 * Raider (xenophobic, warships take bribes) the player has bought off is
 * rude and names a price for help.
 */
describe('computeContext on the synthetic data set (ruling #297)', () => {
    it('classes a bought-off Raider "Class: Corsair", greets rudely and '
        + 'charges for help', async () => {
            const gameData = await getSyntheticGameData();
            const corsair = await gameData.data.Ship.get(SYNTHETIC.ships.corsair);
            await gameData.data.Govt.get(SYNTHETIC.govts.raiders);
            expect(corsair.name).toBe('Gannet Corsair');
            const world = new World();
            world.resources.set(SimulationTimeResource, {
                time: 60_000, delta_ms: 16, delta_s: 0.016, frame: 3600,
            });
            world.entities.set(PLAYER, new Entity()
                .addComponent(PlayerShipSelector, undefined)
                .addComponent(TargetComponent, { target: TARGET })
                .addComponent(CreditsComponent, { credits: 50_000 })
                .addComponent(DisabledComponent, { repairAt: null }));
            world.entities.set(TARGET, new Entity()
                .addComponent(ShipDataComponent, corsair)
                .addComponent(GovtComponent, { id: SYNTHETIC.govts.raiders })
                .addComponent(NpcComponent, {
                    aiType: 3, pacifiedFrom: PLAYER, pacifiedUntil: 120_000,
                }));
            const strings = (await gameData.data.StringTable
                .get(HAIL_RESPONSE_TABLE)).strings;
            const assets = {
                data: { StringTable: { get: async () => ({ strings }) } },
            } as unknown as DisplayAssetDataInterface;
            const result = await computeContext(world, gameData, assets);
            const context = result!.context;
            expect(context.heading).toBe('Class: Corsair\n(Raiders)');
            expect(strings.slice(HOSTILE_RESPONSE_FIRST_INDEX,
                HOSTILE_RESPONSE_FIRST_INDEX + 5)).toContain(context.greeting!);
            expect(commButtonSlots('ship', context))
                .toEqual(['greetings', 'assist', 'close']);
            expect(context.bribe?.purpose).toBe('assist');
            // The ship's own fuel-sale ask (no 0x8000, 50,000 credits: no
            // growth, no cap), reference "R7 bribe price, wave 22".
            expect(context.bribe?.amount).toBe(fuelSaleTerms(TARGET).base);
            expect(assistAnswer(world, TARGET, result!.replies).haggle)
                .toBeTrue();
        });
});

/**
 * Ruling #297 (Matthew, 2026-11-23): the comm channel uses the shared
 * hostility rule, "as long as it still works for players". Two halves:
 *
 *  - the record-hostility tier is the shared one too, so a criminal is
 *    judged by the law of the system the hail happens in (reference A14,
 *    ruling #376), exactly as the brackets and the NPC brain judge him;
 *  - "is this someone else's ship?" is the simulation's own predicate
 *    (hailTargetBelongsToAnotherPlayer), so in multiplayer the dialog never
 *    refuses a ship the sim would let help, or the other way round.
 */
describe('computeContext: the shared hostility rule, for players too (#297)',
    () => {
        const LAWFUL = 'test:lawful';
        const LAWFUL_SPACE = 'test:lawful-space';
        const ELSEWHERE = 'test:elsewhere';
        const NOW = 60_000;
        const MY_PEER = 'my peer';

        /** A lawful (bribe-taking) warship; the player is -500 with its
         * govt; the hail happens in `systemId`. */
        function criminalWorld(systemId: string) {
            const built = makeWorld(target => {
                target.components.set(GovtComponent, { id: LAWFUL });
                target.components.set(NpcComponent,
                    { aiType: 3, mode: 'patrol' });
            });
            const { world, gameData } = built;
            gameData.data.Govt.map.set(LAWFUL, {
                ...getDefaultGovtData(), id: LAWFUL, crimeTol: 10,
                flags: {
                    ...getDefaultGovtData().flags, warshipsTakeBribes: true,
                },
            });
            gameData.data.System.map.set(LAWFUL_SPACE, {
                ...getDefaultSystemData(), id: LAWFUL_SPACE, govt: LAWFUL,
            });
            world.resources.set(SystemIdResource, systemId);
            world.resources.set(SimulationTimeResource, {
                time: NOW, delta_ms: 16, delta_s: 0.016, frame: 3600,
            });
            const player = world.entities.get(PLAYER)!;
            // Criminal in the lawful govt's system (records per system).
            player.components.set(LegalRecordsComponent,
                new Map([[LAWFUL_SPACE, -500]]));
            player.components.set(CreditsComponent, { credits: 100_000 });
            player.components.set(DisabledComponent, { repairAt: null });
            return built;
        }

        function corners(world: World,
            gameData: Parameters<typeof computeContext>[1]) {
            return styleForTarget(TARGET, world.entities.get(TARGET)!, PLAYER,
                world.entities.get(PLAYER)!, gameData,
                uuid => world.entities.get(uuid), NOW,
                world.resources.get(SystemIdResource));
        }

        it('a criminal hailing a warship in ITS government\'s space: '
            + 'hostile, Beg For Mercy, a price — as red as its brackets',
            async () => {
                const { world, gameData } = criminalWorld(LAWFUL_SPACE);
                const context = (await computeContext(world, gameData))!
                    .context;
                expect(context.heading).toContain('Status: Hostile');
                expect(commButtonSlots('ship', context))
                    .toEqual(['greetings', 'beg', 'close']);
                expect(context.bribe?.purpose).toBe('mercy');
                expect(corners(world, gameData)).toBe('hostile');
            });

        it('the same warship where its government\'s law does not run: '
            + 'neutral (A14: the home record never counts elsewhere), so it '
            + 'refuses the disabled pilot flat (H1 wave 16)', async () => {
                const { world, gameData } = criminalWorld(ELSEWHERE);
                const result = (await computeContext(world, gameData))!;
                expect(result.context.heading).not.toContain('Status:');
                expect(commButtonSlots('ship', result.context))
                    .toEqual(['greetings', 'assist', 'close']);
                expect(assistAnswer(world, TARGET, result.replies)).toEqual({
                    line: MERCY_REFUSED_FALLBACK, dispatch: false,
                    haggle: false,
                });
                expect(corners(world, gameData)).toBe('neutral');
            });

        /** A disabled player on peer MY_PEER, hailing a friendly ship that
         * `owner` inserted. */
        function peerOwnedWorld(owner: string) {
            const built = makeWorld(target => {
                target.components.set(NpcComponent, { aiType: 3 });
                target.components.set(MultiplayerData, { owner });
                target.components.set(GovtComponent, { id: ROADSIDE });
            });
            const player = built.world.entities.get(PLAYER)!;
            player.components.set(ControlledByComponent, { peerId: MY_PEER });
            player.components.set(MultiplayerData, { owner: MY_PEER });
            player.components.set(DisabledComponent, { repairAt: null });
            return built;
        }

        it('a ship ANOTHER peer inserted refuses, as applyHail refuses it',
            async () => {
                const { world, gameData } = peerOwnedWorld('their peer');
                const result = (await computeContext(world, gameData))!;
                expect(assistAnswer(world, TARGET, result.replies)).toEqual({
                    line: ASSIST_REFUSED_FALLBACK, dispatch: false,
                    haggle: false,
                });
            });

        it('a SERVER-owned ship helps, as applyHail lets it (the dialog used '
            + 'to refuse every ship not stamped with our own peer)',
            async () => {
                const { world, gameData } = peerOwnedWorld('server');
                const result = (await computeContext(world, gameData))!;
                expect(assistAnswer(world, TARGET, result.replies).dispatch)
                    .toBeTrue();
            });

        it('our OWN peer\'s ship (a mission ship we spawned) helps',
            async () => {
                const { world, gameData } = peerOwnedWorld(MY_PEER);
                const result = (await computeContext(world, gameData))!;
                expect(assistAnswer(world, TARGET, result.replies).dispatch)
                    .toBeTrue();
            });
    });

/**
 * Reference "W1 / C1 / H1 wave 16" and "H1 wave 17", H1: a NEUTRAL ship
 * refuses a disabled pilot ("Not a chance." / "No way.") and offers a
 * fuelless one fuel — its mood line ("You're in luck, I'm in a good mood
 * today." at 1,000, "H1 / rescue leftovers, wave 21"; "I'll help you out
 * if you pay me." at 2,000-3,000; "I'm in a bad mood today ..." at
 * 3,000-4,000, reference "H1 wave 19") over a "Pay me N credits." popup with
 * Lower Price / Accept Price; Lower Price counters with 3/4 or withdraws the
 * offer ("If that's the way you feel, then you can sit here forever."), and
 * the next ask costs 1,000 more; Accept Price: "Hold on, I'll be right
 * there."
 */
describe('a NEUTRAL ship\'s answers (reference H1 waves 16 and 17)', () => {
    /** STR# 3000 and STR# 2002 as the reference reads them. */
    function assets(): DisplayAssetDataInterface {
        const ship: string[] = [];
        ship[MERCY_REFUSED_FIRST_INDEX + 2] = 'No way.';
        ship[MERCY_REFUSED_FIRST_INDEX + 4] = 'Not a chance.';
        ship[116] = "You're in luck, I'm in a good mood today.";
        ship[141] = "I'll help you out if you pay me.";
        ship[146] = "Hold on, I'll be right there.";
        ship[156] =
            "If that's the way you feel, then you can sit here forever.";
        ship[63] = "You can't fool me - you can't afford it.";
        const misc: string[] = [];
        misc[186] = 'Pay me';
        misc[32] = 'credits';
        return {
            data: {
                StringTable: {
                    get: async (id: string) => ({
                        strings: id === HAIL_RESPONSE_TABLE ? ship
                            : id === MISC_STRING_TABLE ? misc : [],
                    }),
                },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    function neutralWorld(credits = 1_000_000) {
        const built = makeWorld(target => {
            target.components.set(NpcComponent, { aiType: 1 });
            target.components.set(TargetComponent, { target: undefined });
        });
        const player = built.world.entities.get(PLAYER)!;
        player.components.set(CreditsComponent, { credits });
        player.components.set(FuelComponent,
            new Stat({ current: 0, max: 3000, recharge: 0 }));
        return built;
    }

    it('refuses a disabled pilot flat, dispatching nothing', async () => {
        const { world, gameData } = neutralWorld();
        world.entities.get(PLAYER)!.components.set(DisabledComponent,
            { repairAt: null });
        const result = (await computeContext(world, gameData, assets()))!;
        const answer = assistAnswer(world, TARGET, result.replies);
        expect(answer.dispatch).toBeFalse();
        expect(answer.haggle).toBeFalse();
        expect(['No way.', 'Not a chance.', MERCY_REFUSED_FALLBACK])
            .toContain(answer.line);
        expect(answer.line).toBe(result.replies.refusal!);
    });

    // TARGET is a good-mood ship with a 1,000 ask (hail.ts's
    // fuelSaleTerms, pinned below).
    it('the fixture ship\'s terms', () => {
        expect(fuelSaleTerms(TARGET)).toEqual({ mood: 'good', base: 1000 });
    });

    it('offers a fuelless pilot fuel: the ship\'s mood line, then "Pay me '
        + '1,000 credits." on the popup; nothing dispatched yet', async () => {
            const { world, gameData } = neutralWorld();
            const result = (await computeContext(world, gameData, assets()))!;
            const sale = result.replies.fuelSale!;
            // The good mood's line (STR# 3000 115-119), not the neutral one.
            expect(sale.mood).toBe("You're in luck, I'm in a good mood today.");
            const answer = assistAnswer(world, TARGET, result.replies);
            expect(answer.dispatch).toBeFalse();
            expect(answer.haggle).toBeTrue();
            expect(answer.line).toBe(sale.mood);
            expect(answer.offer).toEqual(jasmine.objectContaining({
                amount: 1000, canAfford: true, purpose: 'fuel',
                demand: 'Pay me 1,000 credits.',
                accepted: sale.accepted, withdrawn: sale.withdrawn,
            }));
            expect(haggleText(answer.offer)).toBe('Pay me 1,000 credits.');
        });

    it('quotes 1,000 more an ask, or the counter on the table, from the '
        + 'synced haggle or from presses the sim has not mirrored yet',
        async () => {
            const { world, gameData } = neutralWorld();
            const result = (await computeContext(world, gameData, assets()))!;
            const quote = (local?: { asks: number, countered: boolean }) =>
                assistAnswer(world, TARGET, result.replies, local).offer;
            expect(quote({ asks: 1, countered: false })?.demand)
                .toBe('Pay me 2,000 credits.');
            // A counter on the table: 3/4 of 3,000.
            expect(quote({ asks: 2, countered: true })?.amount).toBe(2200);
            world.entities.get(TARGET)!.components.set(FuelHaggleComponent,
                new Map([[PLAYER, { asks: 2, countered: false }]]));
            expect(quote()?.amount).toBe(3000);
            // The further-along of the two wins.
            expect(quote({ asks: 1, countered: false })?.amount).toBe(3000);
            expect(quote({ asks: 2, countered: true })?.amount).toBe(2200);
            // Another pilot's haggling is not ours.
            world.entities.get(TARGET)!.components.set(FuelHaggleComponent,
                new Map([['someone else', { asks: 5, countered: false }]]));
            expect(quote()?.amount).toBe(1000);
        });

    it('fuelOffer: the popup for a counter (2,000 -> 1,500)', async () => {
        const { world, gameData } = neutralWorld();
        const result = (await computeContext(world, gameData, assets()))!;
        const offer = fuelOffer(world, TARGET, result.replies.fuelSale!,
            { asks: 1, countered: true });
        expect(offer).toEqual(jasmine.objectContaining({
            amount: 1500, canAfford: true, purpose: 'fuel',
            demand: 'Pay me 1,500 credits.',
        }));
    });

    it('an ALLIED ship refuses a disabled pilot too (reference H1 wave 17, '
        + 'finding 6)', async () => {
            const { world, gameData } = neutralWorld();
            gameData.data.Govt.map.set('test:friend', {
                ...getDefaultGovtData(), id: 'test:friend', classes: [17],
            });
            gameData.data.Govt.map.set('test:host', {
                ...getDefaultGovtData(), id: 'test:host', allies: [17],
            });
            world.entities.get(PLAYER)!.components.set(GovtComponent,
                { id: 'test:friend' });
            world.entities.get(TARGET)!.components.set(GovtComponent,
                { id: 'test:host' });
            world.entities.get(PLAYER)!.components.set(DisabledComponent,
                { repairAt: null });
            const result = (await computeContext(world, gameData, assets()))!;
            const answer = assistAnswer(world, TARGET, result.replies);
            expect(answer.dispatch).toBeFalse();
            expect(answer.line).toBe(result.replies.refusal!);
        });

    it('a pilot who cannot pay is still offered the price (a poor pilot: '
        + '1,000), with the line Accept / Lower Price answer (reference P1 / '
        + 'H1 wave 18)', async () => {
            const { world, gameData } = neutralWorld(300);
            const result = (await computeContext(world, gameData, assets()))!;
            const offer = assistAnswer(world, TARGET, result.replies).offer!;
            expect(offer.amount).toBe(1000);
            expect(offer.canAfford).toBeFalse();
            expect(offer.cantAfford)
                .toBe("You can't fool me - you can't afford it.");
            expect(haggleText(offer)).toBe('Pay me 1,000 credits.');
        });

    it('quotes the pilot\'s side of the price: his cash caps the first ask, '
        + 'his record does not move it (reference H1 wave 19, findings 1 and '
        + '2)', async () => {
            // 'ship13' asks 4,000 of a rich pilot (a bad mood; hail_test).
            const quote = async (credits: number,
                records?: Map<string, number>) => {
                const { world, gameData } = neutralWorld(credits);
                world.resources.set(SystemIdResource, 'test:here');
                if (records) {
                    world.entities.get(PLAYER)!.components.set(
                        LegalRecordsComponent, records);
                }
                const result = (await computeContext(world, gameData,
                    assets()))!;
                return fuelOffer(world, 'ship13', result.replies.fuelSale!,
                    { asks: 0, countered: false });
            };
            expect((await quote(1_000_000)).amount).toBe(4000);
            expect((await quote(10_000)).amount).toBe(3000);
            const sevenK = await quote(7000);
            expect(sevenK.amount).toBe(2000);
            expect(sevenK.canAfford).toBeTrue();
            expect(sevenK.demand).toBe('Pay me 2,000 credits.');
            expect((await quote(5000)).amount).toBe(1000);
            // Records of -1, -9 here: a clean pilot's price.
            for (const record of [-1, -9]) {
                expect((await quote(1_000_000, new Map([
                    ['test:here', record], ['test:elsewhere', -900]])))
                    .amount).withContext(`${record}`).toBe(4000);
            }
        });

    it('a ränk 0x0800 of the ship\'s govt: free fuel at once, "Okay, I\'m '
        + 'on my way." with no popup; a disabled holder is refused '
        + '(reference P1 / H1 wave 18, finding 4)', async () => {
            const rankHolder = async (disabled: boolean) => {
                const built = neutralWorld();
                const { world, gameData } = built;
                world.entities.get(TARGET)!.components.set(GovtComponent,
                    { id: 'test:navy' });
                gameData.data.Govt.map.set('test:navy',
                    { ...getDefaultGovtData(), id: 'test:navy' });
                const base = getDefaultRankData();
                gameData.data.Rank.map.set('test:free', {
                    ...base, id: 'test:free', affilGovt: 'test:navy',
                    rankFlags: { ...base.rankFlags, freeRefuelAndRepair: true },
                });
                await gameData.data.Rank.get('test:free');
                world.entities.get(PLAYER)!.components.set(
                    ActiveRanksComponent, new Set(['test:free']));
                if (disabled) {
                    world.entities.get(PLAYER)!.components.set(
                        DisabledComponent, { repairAt: null });
                }
                return built;
            };
            const fuel = await rankHolder(false);
            const fuelContext = (await computeContext(fuel.world,
                fuel.gameData, assets()))!;
            expect(fuelContext.context.assist).toEqual({ free: true });
            const answer = assistAnswer(fuel.world, TARGET,
                fuelContext.replies);
            expect(answer).toEqual({
                line: "Hold on, I'll be right there.", dispatch: true,
                haggle: false,
            });

            const repair = await rankHolder(true);
            const repairContext = (await computeContext(repair.world,
                repair.gameData, assets()))!;
            expect(repairContext.context.assist).toEqual({ free: false });
            const refused = assistAnswer(repair.world, TARGET,
                repairContext.replies);
            expect(refused.dispatch).toBeFalse();
            expect(refused.line).toBe(repairContext.replies.refusal!);
        });

    it('a ränk 0x0800: an ALLY of the affiliated govt refuels for free too '
        + '(reference H1 wave 19, finding 5)', async () => {
            const { world, gameData } = neutralWorld();
            gameData.data.Govt.map.set('test:affil', {
                ...getDefaultGovtData(), id: 'test:affil', classes: [21],
            });
            gameData.data.Govt.map.set('test:ally', {
                ...getDefaultGovtData(), id: 'test:ally', allies: [21],
            });
            world.entities.get(TARGET)!.components.set(GovtComponent,
                { id: 'test:ally' });
            const base = getDefaultRankData();
            gameData.data.Rank.map.set('test:free', {
                ...base, id: 'test:free', affilGovt: 'test:affil',
                rankFlags: { ...base.rankFlags, freeRefuelAndRepair: true },
            });
            await gameData.data.Rank.get('test:free');
            world.entities.get(PLAYER)!.components.set(
                ActiveRanksComponent, new Set(['test:free']));
            const result = (await computeContext(world, gameData, assets()))!;
            expect(result.context.assist).toEqual({ free: true });
            expect(result.replies.fuelSale).toBeUndefined();
            expect(assistAnswer(world, TARGET, result.replies)).toEqual({
                line: "Hold on, I'll be right there.", dispatch: true,
                haggle: false,
            });
        });

    it('a Roadside Assistance ship helps for free instead', async () => {
        const { world, gameData } = neutralWorld();
        world.entities.get(TARGET)!.components.set(GovtComponent,
            { id: ROADSIDE });
        const result = (await computeContext(world, gameData, assets()))!;
        expect(result.replies.fuelSale).toBeUndefined();
        expect(result.replies.refusal).toBeUndefined();
        expect(assistAnswer(world, TARGET, result.replies).dispatch)
            .toBeTrue();
    });

    describe('the page machine', () => {
        const offer: NonNullable<HailContext['bribe']> = {
            amount: 1000, canAfford: true, purpose: 'fuel',
            demand: 'Pay me 1,000 credits.',
            accepted: "Hold on, I'll be right there.",
            withdrawn:
                "If that's the way you feel, then you can sit here forever.",
        };
        const main: HailPage = {
            phase: 'main',
            context: {
                variant: 'ship', heading: 'Class: Kit Assist Trader',
                image: null, body: 'Channel open.', assist: { free: false },
            },
        };
        const mood = "You're in luck, I'm in a good mood today.";

        it('Request Assistance opens the popup with the price named at the '
            + 'press', () => {
                const next = hailPress(main, {
                    kind: 'assist', answer: mood, haggle: true, offer,
                }) as HailPage;
                expect(next.phase).toBe('haggle');
                expect(next.context.body).toBe(mood);
                expect(next.context.bribe).toEqual(offer);
                expect(next.context.assist).toEqual({ free: false });
            });

        it('Lower Price: back to the main page, the offer withdrawn in the '
            + 'well, Request Assistance still there', () => {
                const haggle = hailPress(main, {
                    kind: 'assist', answer: mood, haggle: true, offer,
                }) as HailPage;
                const next = hailPress(haggle, { kind: 'lowerPrice' }) as HailPage;
                expect(next.phase).toBe('main');
                expect(next.context.body).toBe(offer.withdrawn!);
                expect(commButtonSlots('ship', next.context))
                    .toEqual(['greetings', 'assist', 'close']);
                // Not on the main page, nor for another kind of price.
                expect(hailPress(main, { kind: 'lowerPrice' })).toBe(main);
            });

        it('Lower Price COUNTERED (reference H1 wave 17): the popup stays '
            + 'with the new price, the mood line in the well', () => {
                const haggle = hailPress(main, {
                    kind: 'assist', answer: mood, haggle: true, offer,
                }) as HailPage;
                const counter = {
                    ...offer, amount: 700, demand: 'Pay me 700 credits.',
                };
                const next = hailPress(haggle,
                    { kind: 'lowerPrice', counter }) as HailPage;
                expect(next.phase).toBe('haggle');
                expect(next.context.body).toBe(mood);
                expect(next.context.bribe).toEqual(counter);
                expect(haggleText(next.context.bribe))
                    .toBe('Pay me 700 credits.');
                // The second press withdraws.
                const after = hailPress(next, { kind: 'lowerPrice' }) as HailPage;
                expect(after.phase).toBe('main');
                expect(after.context.body).toBe(offer.withdrawn!);
            });

        it('a price the pilot cannot pay: Accept Price (or Lower Price) '
            + 'closes the popup with "You can\'t fool me - you can\'t afford '
            + 'it." in the well (reference P1 / H1 wave 18)', () => {
                const broke = {
                    ...offer, canAfford: false,
                    cantAfford: "You can't fool me - you can't afford it.",
                };
                const haggle = hailPress(main, {
                    kind: 'assist', answer: mood, haggle: true, offer: broke,
                }) as HailPage;
                const next = hailPress(haggle, { kind: 'cantAfford' }) as HailPage;
                expect(next.phase).toBe('main');
                expect(next.context.body)
                    .toBe("You can't fool me - you can't afford it.");
                expect(commButtonSlots('ship', next.context))
                    .toEqual(['greetings', 'assist', 'close']);
                // Only from a fuel popup.
                expect(hailPress(main, { kind: 'cantAfford' })).toBe(main);
            });

        it('Accept Price: "Hold on, I\'ll be right there." on the main page',
            () => {
                const haggle = hailPress(main, {
                    kind: 'assist', answer: mood, haggle: true, offer,
                }) as HailPage;
                const next = hailPress(haggle, { kind: 'pay' }) as HailPage;
                expect(next.phase).toBe('main');
                expect(next.context.body).toBe("Hold on, I'll be right there.");
            });

        describe('a planet\'s bribe (reference "R7 planet bribe, wave 28")',
            () => {
                const landing: NonNullable<HailContext['bribe']> = {
                    amount: 3000, canAfford: true, purpose: 'landing',
                    demand: 'Pay us 3,000 credits.',
                    withdrawn: 'No deal, cheapskate.',
                    refused: 'Stop being an insulting little ferret.',
                };
                const port: HailPage = {
                    phase: 'main',
                    context: {
                        variant: 'planet', heading: 'Earth\nStatus: Hostile',
                        image: null, body: 'Channel open to Earth.',
                        bribe: landing,
                    },
                };

                it('Lower Price withdrawn: "No deal, cheapskate." in the '
                    + 'well, and Offer Bribe now answers the refusal', () => {
                        const haggle = hailPress(port, { kind: 'beg' }) as
                            HailPage;
                        expect(haggle.phase).toBe('haggle');
                        const next = hailPress(haggle,
                            { kind: 'lowerPrice' }) as HailPage;
                        expect(next.phase).toBe('main');
                        expect(next.context.body)
                            .toBe('No deal, cheapskate.');
                        expect(next.context.bribe).toBeUndefined();
                        expect(commButtonSlots('planet', next.context))
                            .toEqual(['greetings', 'bribe', 'close']);
                        const offered = hailPress(next, { kind: 'beg' }) as
                            HailPage;
                        expect(offered.phase).toBe('main');
                        expect(offered.context.body)
                            .toBe('Stop being an insulting little ferret.');
                    });

                it('Lower Price countered: the popup stays with 3/4 '
                    + '(3,000 -> 2,200), and Accept Price closes the '
                    + 'channel', () => {
                        const haggle = hailPress(port, { kind: 'beg' }) as
                            HailPage;
                        const counter = {
                            ...landing, amount: 2200,
                            demand: 'Pay us 2,200 credits.',
                        };
                        const next = hailPress(haggle,
                            { kind: 'lowerPrice', counter }) as HailPage;
                        expect(next.phase).toBe('haggle');
                        expect(haggleText(next.context.bribe))
                            .toBe('Pay us 2,200 credits.');
                        expect(hailPress(next, { kind: 'pay' }))
                            .toBe('close');
                        // A fuel counter is not a planet's.
                        expect((hailPress(haggle, { kind: 'lowerPrice',
                            counter: offer }) as HailPage).phase)
                            .toBe('main');
                    });
            });
    });
});
