import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { Entity } from 'nova_ecs/entity';
import { AggressionComponent } from '../combat/aggression.js';
import { DisabledComponent } from '../ship/disabled_component.js';
import { EscortCommandComponent } from '../player/escort_command.js';
import {
    EscortHostilityContext, isHostileTo,
} from './escort_command_plugin.js';
import { FormationComponent, NpcComponent } from '../npc/npc_ai_plugin.js';
import { GovtComponent } from '../core/govt_component.js';
import { isHostileTarget, styleForTarget } from '../combat/hostility.js';
import { AggressionSuppressGovtsComponent } from '../ncb/ncb_plugin.js';
import { ShootAllWeaponsComponent } from '../npc/npc_plugin.js';
import { FiringGroupComponent } from '../ship/firing_group.js';
import { LegalRecordsComponent } from '../reputation/reputation_plugin.js';
import { ShipComponent } from '../ship/ship_plugin.js';
import { TargetComponent } from '../ship/target_component.js';

/**
 * ============================================================================
 * THE TWO HOSTILITY READERS MUST AGREE
 * ============================================================================
 *
 * There are two implementations of "is that ship hostile to me":
 *
 *   - hostility.ts's `styleForTarget` — the HUD's target corners, the
 *     first-hostile cue, and the 'r' key (through `isHostileTarget`);
 *   - escort_command_plugin's `isHostileTo` — what the owner's ESCORTS act
 *     on: which intruder 'defend' engages, which ship a formation escort's
 *     front-quadrant turrets fire at, and whether a running engagement is
 *     still justified.
 *
 * They are separate functions because they read different shapes (one takes
 * a player entity and an entity lookup, the other a per-tick context the
 * escort brain assembles once), and each is documented as matching the
 * other TIER FOR TIER. Nothing enforced that. It drifted: the corners grew
 * an escort-command tier — a rival's escort ORDERED onto you ('f', or
 * holding its leader's perimeter against you) is hostile before its first
 * shot lands — and `isHostileTo` did not, so 'defend' stood and watched a
 * ship the HUD was painting red until it opened fire and the recent-
 * aggression tier caught up half a second later. The own-flock tier was
 * missing on the escort side too.
 *
 * So: one table, both functions, every tier. A tier added to either side
 * without the other fails here.
 *
 * ---------------------------------------------------------------------------
 * THE TWO PLACES THEY LEGITIMATELY DIFFER (both pinned separately below)
 * ---------------------------------------------------------------------------
 *
 *  1. DISABLED. The corners answer 'disabled' (gray), never 'hostile', so a
 *     hulk is never "the nearest hostile". `isHostileTo` has no such tier
 *     because its two callers filter DisabledComponent out of the candidate
 *     scan themselves, and BECAUSE 'defend' needs the opposite question
 *     answered mid-engagement (attack-until-disabled ends the engagement
 *     there, which it does by checking DisabledComponent explicitly).
 *  2. ATTACKING THE ESCORT ITSELF. `isHostileTo` takes the posture tier's
 *     target gate as "the root OR this escort", a deliberate superset: a
 *     ship shooting at the escort is the escort's problem even when the
 *     owner has not been touched. The owner's corners quite correctly stay
 *     political — it is not attacking THEM.
 */

const ROOT = 'root-uuid';
const ESCORT = 'escort-uuid';
const OTHER = 'other-uuid';

function govt(over: Partial<GovtData>): GovtData {
    return { ...getDefaultGovtData(), ...over };
}

const PIRATE = govt({ id: 'nova:137' });
PIRATE.flags.xenophobic = true;
const CIVILIAN = govt({ id: 'nova:157' });
const FEDERATION = govt({ id: 'nova:128', classes: [1], allies: [1] });

const GOVTS: { [id: string]: GovtData } = {
    'nova:137': PIRATE, 'nova:157': CIVILIAN, 'nova:128': FEDERATION,
};

/** The Govt.getCached both readers use, and nothing else. */
const gameData = {
    data: { Govt: { getCached: (id: string) => GOVTS[id] } },
} as never;

const NOW = 100_000;

/** One row of the matrix: a world, and what both readers should say. */
interface Row {
    name: string;
    /** Builds the ships. `other` is the candidate; `root` is the owner. */
    build(): { other: Entity, root: Entity, extra?: [string, Entity][] };
    hostile: boolean;
}

const ROWS: Row[] = [
    // --- Politics (tier 4) ---
    {
        name: 'a xenophobic pirate, minding its own business',
        hostile: true,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:137' })
                .addComponent(NpcComponent, { aiType: 3, mode: 'travel' }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a civilian trader going about its business',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 1, mode: 'travel' }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a govt-less ship (another player, an ex-escort)',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER).addComponent(ShipComponent,
                { id: 'nova:1' }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a govt whose ENEMIES include the owner\'s class',
        hostile: true,
        build: () => {
            const enemy = govt({ id: 'nova:900', enemies: [1] });
            GOVTS['nova:900'] = enemy;
            return {
                other: new Entity(OTHER)
                    .addComponent(ShipComponent, { id: 'nova:1' })
                    .addComponent(GovtComponent, { id: 'nova:900' }),
                root: new Entity(ROOT)
                    .addComponent(GovtComponent, { id: 'nova:128' }),
            };
        },
    },
    {
        name: 'an ALLY of the owner\'s government (friendly, not hostile)',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:128' }),
            root: new Entity(ROOT)
                .addComponent(GovtComponent, { id: 'nova:128' }),
        }),
    },
    {
        name: 'a govt the owner is CRIMINAL with (legal record below '
            + '-CrimeTol)',
        hostile: true,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' }),
            root: new Entity(ROOT)
                .addComponent(LegalRecordsComponent,
                    new Map([['nova:157', -30_000]])),
        }),
    },
    {
        name: 'a pirate the owner\'s ränk 0x0100 suppresses',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:137' }),
            root: new Entity(ROOT)
                .addComponent(AggressionSuppressGovtsComponent,
                    new Set(['nova:137'])),
        }),
    },

    // --- Bought off (tier 2b) ---
    {
        name: 'a pirate the OWNER bribed, inside the reprieve',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:137' })
                .addComponent(NpcComponent, {
                    aiType: 3, pacifiedFrom: ROOT,
                    pacifiedUntil: NOW + 10_000,
                }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a pirate whose bribe has LAPSED',
        hostile: true,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:137' })
                .addComponent(NpcComponent, {
                    aiType: 3, pacifiedFrom: ROOT,
                    pacifiedUntil: NOW - 1,
                }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a pirate that bribed SOMEBODY ELSE',
        hostile: true,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:137' })
                .addComponent(NpcComponent, {
                    aiType: 3, pacifiedFrom: 'somebody-else',
                    pacifiedUntil: NOW + 10_000,
                }),
            root: new Entity(ROOT),
        }),
    },

    // --- NPC posture (tier 3a) ---
    {
        name: 'a neutral trader currently ATTACKING the owner',
        hostile: true,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 1, mode: 'attack' })
                .addComponent(TargetComponent, { target: ROOT }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a neutral trader FLEEING the owner (posture, not target)',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 1, mode: 'flee' })
                .addComponent(TargetComponent, { target: ROOT }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a neutral warship attacking SOMEBODY ELSE',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 3, mode: 'attack' })
                .addComponent(TargetComponent, { target: 'a third party' }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'the legacy dev-enemy ShootAllWeapons marker, aimed at us',
        hostile: true,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(ShootAllWeaponsComponent, undefined)
                .addComponent(TargetComponent, { target: ROOT }),
            root: new Entity(ROOT),
        }),
    },

    // --- ESCORT COMMAND (tier 3a's second reading) — F4's finding ---
    {
        name: 'a RIVAL\'S ESCORT ordered to ATTACK us (\'f\'), before its '
            + 'first shot',
        hostile: true,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(FormationComponent,
                    { leader: 'rival', slot: 0 })
                .addComponent(EscortCommandComponent,
                    { command: 'attack', target: ROOT })
                .addComponent(TargetComponent, { target: ROOT }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a rival\'s escort DEFENDING its leader against us',
        hostile: true,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(FormationComponent,
                    { leader: 'rival', slot: 0 })
                .addComponent(EscortCommandComponent,
                    { command: 'defend', target: ROOT })
                .addComponent(TargetComponent, { target: ROOT }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a rival\'s escort defending against SOMEBODY ELSE',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(FormationComponent,
                    { leader: 'rival', slot: 0 })
                .addComponent(EscortCommandComponent,
                    { command: 'defend', target: 'a third party' })
                .addComponent(TargetComponent, { target: 'a third party' }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a rival\'s escort on \'defend\' with NO intruder found',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(FormationComponent,
                    { leader: 'rival', slot: 0 })
                .addComponent(EscortCommandComponent, { command: 'defend' })
                .addComponent(TargetComponent, { target: undefined }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a rival\'s escort merely flying FORMATION, targeting us',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(FormationComponent,
                    { leader: 'rival', slot: 0 })
                .addComponent(EscortCommandComponent,
                    { command: 'formation' })
                .addComponent(TargetComponent, { target: ROOT }),
            root: new Entity(ROOT),
        }),
    },

    // --- Recent aggression (tier 3b) ---
    {
        name: 'a govt-less RIVAL PLAYER that shot us seconds ago',
        hostile: true,
        build: () => ({
            other: new Entity(OTHER).addComponent(ShipComponent,
                { id: 'nova:1' }),
            root: new Entity(ROOT).addComponent(AggressionComponent,
                new Map([[OTHER, { at: NOW - 5_000, damage: 100, hostile: true }]])),
        }),
    },
    {
        name: 'a rival player whose aggression has AGED OUT',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER).addComponent(ShipComponent,
                { id: 'nova:1' }),
            root: new Entity(ROOT).addComponent(AggressionComponent,
                new Map([[OTHER, { at: NOW - 120_000, damage: 100, hostile: true }]])),
        }),
    },

    // --- Own flock (tier 2) ---
    {
        name: 'the owner\'s OWN escort, govt-less as every capture leaves it',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(FormationComponent, { leader: ROOT, slot: 0 }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'the owner\'s own escort that somehow KEPT a hostile govt '
            + '(the guard, not a live path)',
        hostile: false,
        build: () => ({
            other: new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:137' })
                .addComponent(FormationComponent, { leader: ROOT, slot: 0 }),
            root: new Entity(ROOT),
        }),
    },
    {
        name: 'a bay fighter two hops down the owner\'s own flock',
        hostile: false,
        build: () => {
            const carrier = new Entity('carrier')
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(FormationComponent, { leader: ROOT, slot: 0 });
            return {
                other: new Entity(OTHER)
                    .addComponent(ShipComponent, { id: 'nova:1' })
                    .addComponent(GovtComponent, { id: 'nova:137' })
                    .addComponent(FiringGroupComponent, { group: 'carrier' }),
                root: new Entity(ROOT),
                extra: [['carrier', carrier]],
            };
        },
    },
];

describe('isHostileTo agrees with styleForTarget, tier for tier', () => {
    /** Both readers over the same world. */
    function verdicts(row: Row) {
        const { other, root, extra } = row.build();
        const entities = new Map<string, Entity>([
            [OTHER, other], [ROOT, root], ...(extra ?? []),
        ]);
        const getEntity = (uuid: string) => entities.get(uuid);
        const ctx: EscortHostilityContext = {
            rootGovt: root.components.get(GovtComponent)
                ? GOVTS[root.components.get(GovtComponent)!.id] : undefined,
            gameData,
            rootEntity: root,
            rootRecords: root.components.get(LegalRecordsComponent),
            now: NOW,
            getEntity,
        };
        return {
            corners: styleForTarget(OTHER, other, ROOT, root, gameData,
                getEntity, NOW),
            scan: isHostileTarget(OTHER, other, {
                viewerUuid: ROOT, viewerEntity: root, entities,
                gameData, now: NOW,
            }),
            escorts: isHostileTo(other, OTHER, ROOT, ESCORT, ctx),
        };
    }

    for (const row of ROWS) {
        it(`${row.name}: ${row.hostile ? 'HOSTILE' : 'not hostile'} to `
            + 'both', () => {
                const { corners, scan, escorts } = verdicts(row);
                expect(corners === 'hostile').withContext('target corners')
                    .toBe(row.hostile);
                expect(scan).withContext('the \'r\' key scan')
                    .toBe(row.hostile);
                expect(escorts).withContext('the escort brains')
                    .toBe(row.hostile);
            });
    }

    it('covers every tier the two rules claim to share', () => {
        // A cheap tripwire: the table is the deliverable, so notice if it
        // is ever gutted down to the political rows.
        expect(ROWS.length).toBeGreaterThanOrEqual(20);
    });
});

describe('where the two readers legitimately differ', () => {
    const entitiesOf = (other: Entity, root: Entity) =>
        new Map<string, Entity>([[OTHER, other], [ROOT, root]]);

    function ctxFor(root: Entity, entities: Map<string, Entity>):
        EscortHostilityContext {
        return {
            rootGovt: undefined, gameData, rootEntity: root,
            rootRecords: undefined, now: NOW,
            getEntity: (uuid: string) => entities.get(uuid),
        };
    }

    it('DISABLED: the corners say \'disabled\', and the escort brains rely '
        + 'on their callers\' own filter instead', () => {
            const hulk = new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:137' })
                .addComponent(DisabledComponent, { repairAt: null, hulk: true });
            const root = new Entity(ROOT);
            const entities = entitiesOf(hulk, root);

            // The HUD paints it gray, and 'r' never picks it.
            expect(styleForTarget(OTHER, hulk, ROOT, root, gameData,
                u => entities.get(u), NOW)).toBe('disabled');
            expect(isHostileTarget(OTHER, hulk, {
                viewerUuid: ROOT, viewerEntity: root, entities, gameData,
                now: NOW,
            })).toBeFalse();

            // isHostileTo still calls the pirate a pirate — which is why
            // BOTH its callers (the defend intruder scan and the turret
            // scan) skip DisabledComponent before ever asking, and why the
            // running-engagement check tests it explicitly. Pinned so the
            // difference stays a documented one.
            expect(isHostileTo(hulk, OTHER, ROOT, ESCORT,
                ctxFor(root, entities))).toBeTrue();
        });

    it('ATTACKING THE ESCORT ITSELF: hostile to the escort, political to '
        + 'the owner\'s corners', () => {
            const attacker = new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 3, mode: 'attack' })
                // Shooting the ESCORT, and the owner not at all.
                .addComponent(TargetComponent, { target: ESCORT });
            const root = new Entity(ROOT);
            const entities = entitiesOf(attacker, root);

            expect(styleForTarget(OTHER, attacker, ROOT, root, gameData,
                u => entities.get(u), NOW)).toBe('neutral');
            // A deliberate superset: a ship shooting the escort is the
            // escort's business whether or not the owner has been touched.
            expect(isHostileTo(attacker, OTHER, ROOT, ESCORT,
                ctxFor(root, entities))).toBeTrue();
        });

    it('and the same escort-command tier applies to a ship attacking the '
        + 'ESCORT under orders', () => {
            const ordered = new Entity(OTHER)
                .addComponent(ShipComponent, { id: 'nova:1' })
                .addComponent(EscortCommandComponent,
                    { command: 'attack', target: ESCORT })
                .addComponent(TargetComponent, { target: ESCORT });
            const root = new Entity(ROOT);
            const entities = entitiesOf(ordered, root);
            expect(isHostileTo(ordered, OTHER, ROOT, ESCORT,
                ctxFor(root, entities))).toBeTrue();
        });
});
