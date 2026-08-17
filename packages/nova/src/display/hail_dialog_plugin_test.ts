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
import { MissionShipComponent } from '../nova_plugin/mission_ship_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { ShipDataComponent } from '../nova_plugin/ship_plugin.js';
import { TargetComponent } from '../nova_plugin/target_component.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { DisabledComponent } from '../nova_plugin/disabled_component.js';
import {
    ASSIST_GRANTED_FALLBACK, ASSIST_GRANTED_FIRST_INDEX,
    BUSY_RESPONSE_FALLBACK, BUSY_RESPONSE_FIRST_INDEX, HAIL_RESPONSE_TABLE,
    HOSTILE_RESPONSE_FALLBACK, HOSTILE_RESPONSE_FIRST_INDEX,
    MISC_STRING_TABLE, miscString, NO_NEED_RESPONSE_FALLBACK,
    NO_NEED_RESPONSE_FIRST_INDEX, NO_RESPONSE_FALLBACK, NO_RESPONSE_INDEX,
    STELLAR_RESPONSE_TABLE,
} from '../nova_plugin/hail.js';
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
