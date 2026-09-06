import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { getDefaultPersData } from 'novadatainterface/pers_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { OwnerComponent, SourceComponent } from '../nova_plugin/fire_weapon_plugin.js';
import { GovtComponent } from '../nova_plugin/govt_component.js';
import { FormationComponent, NpcComponent } from '../nova_plugin/npc_ai_plugin.js';
import { PersComponent } from '../nova_plugin/pers_plugin.js';
import { MissionShipComponent } from '../nova_plugin/mission_ship_component.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { ShipDataComponent } from '../nova_plugin/ship_plugin.js';
import { TargetComponent } from '../nova_plugin/target_component.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { DisabledComponent } from '../nova_plugin/disabled_component.js';
import {
    ASSIST_GRANTED_FALLBACK, ASSIST_GRANTED_FIRST_INDEX,
    BUSY_RESPONSE_FALLBACK, BUSY_RESPONSE_FIRST_INDEX, CHANNEL_OPEN_FALLBACK,
    CHANNEL_OPEN_FIRST_INDEX, GENERIC_GREETING_FIRST_INDEX,
    HAIL_RESPONSE_TABLE, HOSTILE_RESPONSE_FALLBACK,
    HOSTILE_RESPONSE_FIRST_INDEX, MERCY_ACCEPTED_FALLBACK,
    MERCY_ACCEPTED_FIRST_INDEX, MISC_STRING_TABLE, miscString,
    NO_NEED_RESPONSE_FALLBACK, NO_NEED_RESPONSE_FIRST_INDEX,
    NO_RESPONSE_FALLBACK, NO_RESPONSE_INDEX, STELLAR_RESPONSE_TABLE,
} from '../nova_plugin/hail.js';
import {
    CANNOT_UPGRADE_TEXT, escortReadout, HailContext, HailPage, HailPress,
    hailPress, SALE_QUEUED_TEXT, UPGRADE_QUEUED_TEXT,
} from '../spaceport/hail_dialog.js';
import {
    commButtonSlots, escortButtonSlots,
} from '../spaceport/hail_layout.js';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { ControlBitsComponent } from '../nova_plugin/ncb_plugin.js';
import { PlayerEscortComponent } from '../nova_plugin/player_escort.js';
import { CreditsComponent } from '../nova_plugin/player_state_plugin.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation_plugin.js';
import {
    PlanetComponent, PlanetDataComponent, PlanetTargetComponent,
    StellarBribesComponent,
} from '../nova_plugin/planet_plugin.js';
import { TimePlugin, TimeResource } from 'nova_ecs/plugins/time_plugin';
import { SimulationTimeResource } from './simulation_time.js';
import { ShootAllWeaponsComponent } from '../nova_plugin/npc_plugin.js';
import {
    assistAnswer, computeContext, hailIsUnanswerable, shipIdentityBlock,
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
function makeWorld(configureTarget: (target: Entity) => void) {
    const gameData = new MockGameData();
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
            expect(escort?.pendingUpgrade).toBeFalse();
            expect(escort?.pendingSale).toBeFalse();
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
                    pendingUpgrade: UPGRADE,
                });
            });
            const escort = (await computeContext(world, gameData))
                ?.context.escort;
            expect(escort?.pendingUpgrade).toBeTrue();
            expect(escort?.pendingSale).toBeFalse();
            expect(escortReadout(escort!).split('\n')[0])
                .toBe(UPGRADE_QUEUED_TEXT);
            expect(escortButtonSlots(escort!)[0])
                .toEqual({ slot: 'cancelUpgrade', enabled: true });
        });

    it('reports a queued SALE the same way', async () => {
        const { world, gameData } = escortWorld(target => {
            target.components.set(PlayerEscortComponent, {
                player: PLAYER, parent: PLAYER, provenance: 'captured',
                pendingSale: true,
            });
        });
        const escort = (await computeContext(world, gameData))
            ?.context.escort;
        expect(escort?.pendingSale).toBeTrue();
        expect(escortReadout(escort!).split('\n')[1]).toBe(SALE_QUEUED_TEXT);
        expect(escortButtonSlots(escort!)[1])
            .toEqual({ slot: 'cancelSale', enabled: true });
    });

    it('keeps the WAGE on the escort\'s CURRENT class while an upgrade is '
        + 'queued', async () => {
            // The escort is still flying the old hull until the deal
            // settles at a shipyard, so it is still paid for the old hull.
            const { world, gameData } = escortWorld(target => {
                target.components.set(PlayerEscortComponent, {
                    player: PLAYER, parent: PLAYER, provenance: 'hired',
                    pendingUpgrade: UPGRADE,
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
        return {
            data: {
                StringTable: {
                    get: async (id: string) => id === HAIL_RESPONSE_TABLE
                        ? { strings } : { strings: [] },
                },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    /** A world whose player needs help (disabled). */
    function needyWorld(configureTarget: (target: Entity) => void) {
        const built = makeWorld(configureTarget);
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
        });
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
            pirate.flags = { ...pirate.flags, largerBribes: true };
            gameData.data.Govt.map.set('test:pirate', pirate);
            world.entities.get(PLAYER)!.components
                .set(CreditsComponent, { credits: 10_000 });

            const result = await computeContext(world, gameData, commAssets());
            expect(result!.context.bribe?.purpose).toBe('mercy');
            expect(result!.context.bribe?.accepted)
                .toBe(MERCY_ACCEPTED_FALLBACK);
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
            flags: {
                ...getDefaultPlanetData().flags,
                isStation: opts.isStation ?? false,
                canLand: opts.canLand ?? true,
                uninhabited: opts.uninhabited ?? false,
            },
        };

        const world = new World();
        const player = new Entity()
            .addComponent(PlayerShipSelector, undefined);
        if (opts.bribedUntil !== undefined) {
            player.addComponent(StellarBribesComponent,
                new Map([['nova:128', opts.bribedUntil]]));
        }
        world.entities.set(PLAYER, player
            .addComponent(CreditsComponent, { credits: opts.credits ?? 10_000 })
            .addComponent(LegalRecordsComponent,
                new Map([['nova:128', opts.record ?? 0]]))
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
            // 10% of 10,000 (this govt is not a largerBribes one).
            expect(result?.context.bribe)
                .toEqual({ amount: 1000, canAfford: true, purpose: 'landing' });
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
});
