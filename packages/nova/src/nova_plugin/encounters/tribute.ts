import { PlanetData } from 'novadatainterface/planet_data';
import { Entity } from 'nova_ecs/entity';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SimulationGameDataResource, SystemIdResource } from '../core/index.js';
import {
    DominatedComponent, hasDominated, withDominated, withoutDominated,
} from '../player/index.js';
import {
    applyRecordSpread, CombatRatingComponent, crimeGeography, GovtsResource,
    LegalGeographyResource, LegalRecordsComponent,
} from '../reputation/index.js';
import {
    DefenseFleetComponent, emptyDefenseFleet, PlanetComponent,
    PlanetDataComponent, sortedWith, stellarTakesDemands,
} from '../travel/index.js';
import {
    DEFENSE_FIRST_LAUNCH_MS, DefenseFleetsResource,
} from '../spawn/index.js';

/**
 * ============================================================================
 * Demand Tribute: stellar defence fleets, domination and the daily tribute
 * (#353 sections 1 and 3)
 * ============================================================================
 *
 * MEASURED on the original (docs/reference_experiments.md, "Tribute (R18),
 * wave 38" as corrected by "... wave 39"), single player:
 *  - a demand from a combat rating BELOW 12,800 (Appendix I's "Deadly")
 *    is laughed off (STR# 3002 5-9, 0-based) and launches nothing;
 *  - from 12,800 with defence ships left it answers "...our defense
 *    fleet..." (STR# 3002 10-14) and launches them; once they are all
 *    destroyed the next demand is accepted, "All right, all right
 *    already!  The planet agrees to pay you tribute." (25; a station's
 *    26), and the stellar is dominated; a stellar with no fleet gives in
 *    at once;
 *  - every demand that is not laughed at costs -600 legal record in the
 *    stellar's system (spread 0.65 per jump); the defenders' kills cost
 *    nothing and add no combat rating;
 *  - a dominated stellar pays its Tribute (the field when 1 or more, else
 *    1,000 x TechLevel: PlanetData.domination.tribute, already decoded) at
 *    every day's advance, wherever the pilot is, until Release ("You
 *    release the planet from its debt to you.", 35; a station's 36).
 *
 * MATTHEW'S RULING (#353, admin1 2026-10-03), FOLLOWED WHERE IT DIFFERS
 * from the measured original, because it was made for multiplayer:
 *  - THE FLEET IS SHARED AND NOT KEPT. The original keeps each stellar's
 *    defence ships LEFT in the pilot file, across visits and days, and
 *    launches them in DefCount's waves. Here "the player must defeat all
 *    the defence fleet ships in one go. Jumping away stops the ships
 *    spawning and resets it": one fleet per stellar for everyone
 *    demanding (travel/defense_fleet.ts), counted only while one of them
 *    stays in the system.
 *  - NO TRUE WAVES: up to 6 defenders per demanding player are up at once
 *    (18 at most), "a new defender spawns once one dies", until the whole
 *    DefCount total has launched. DefCount's wave digit is not used.
 *  - DOMINATION AT THE DEFEAT: "if it's defeated, all the players are
 *    considered to have dominated the planet". The original wants a second
 *    demand after the fleet is gone (and charges a second -600 for it);
 *    here every demander dominates the moment the last defender goes down
 *    ("All right, all right already! ..." on his status line,
 *    StellarDominatedEvent), so a won fight costs one -600, not two.
 *  - WHO THE DEFENDERS FIGHT: "only the dominating player and their
 *    escorts unless otherwise provoked, even if their govt would make them
 *    attack another player", an equal share prioritising each demander
 *    (npc/npc_decision.ts's defender branch, ship/stellar_defender.ts).
 *  - "Defence fleet ships can not be disabled" (their bay fighters can).
 *  - WHICH STELLARS: "Any planet that can be hailed and responds to hails
 *    (opens hail dialog where you can say greetings) can be dominated":
 *    every port that is not a gate (the hail dialog's own gate,
 *    display/hail_dialog_plugin.ts's hailIsUnanswerable).
 *  - THE THRESHOLD: the ruling said "'deadly', with a note to check on
 *    this later" if undocumented; wave 38 measured it at exactly 12,800,
 *    which is Deadly.
 *  - THE TRIBUTE is income "using the same system as ranks", shown on the
 *    player-info screen (spaceport/daily_budget.ts).
 *
 * NOT IMPLEMENTED (follow-ups): the spöb OnDominate / OnRelease set
 * strings (no ECS system runs an NCB set string; every set-string site is
 * player-local, ncb/ncb.ts), Flags2 0x0020 "always dominated" (no stock
 * stellar sets it), planetary weapons and their "provoked" mode (#353
 * section 2).
 *
 * WHERE THE PIECES ARE: the rules and the hail actions here; the fleet
 * itself (its genesis staging, launches, stand-down and the domination at
 * its defeat) in spawn/defense_fleet_system.ts; the fleet's shared state
 * in travel/defense_fleet.ts; a defence ship's marker in
 * ship/stellar_defender.ts and its brain in npc/npc_decision.ts's
 * defenderDecision; the pilot's dominated set in player/dominated.ts; the
 * daily tribute in spaceport/daily_budget.ts.
 *
 * Determinism: the demand and the release are hail input records
 * (hail_plugin.ts's applyHail), re-derived from synced state on every
 * peer; the fleet's launches draw from the seeded Random with ids from the
 * IdFactory, from düdes staged at genesis; every list is sorted.
 */

/** The combat rating a demand needs not to be laughed off (MEASURED,
 * reference "Tribute (R18), wave 38": 12,799 refused, 12,800 not). */
export const TRIBUTE_COMBAT_RATING = 12_800;

/** The legal-record change of a demand that is not laughed off, in the
 * stellar's system, spread 0.65 per jump (MEASURED, wave 39, finding 7;
 * GUESS that it is fixed, not 6 x KillPenalty). */
export const TRIBUTE_DEMAND_RECORD = -600;

/** What a demand gets (see the module comment). */
export type TributeOutcome = 'laugh' | 'fleet' | 'dominate';

/**
 * The answer to a demand, a pure function of synced state, so the hail
 * dialog shows the answer the simulation then applies: a rating below
 * TRIBUTE_COMBAT_RATING is laughed off; a stellar with a defence fleet
 * sends it (or, already up, adds this demander to it); one without gives
 * in.
 */
export function tributeDemandOutcome(rating: number, hasFleet: boolean)
    : TributeOutcome {
    if (rating < TRIBUTE_COMBAT_RATING) {
        return 'laugh';
    }
    return hasFleet ? 'fleet' : 'dominate';
}


// --- STR# 3002 ("Stellar Comm Strings"), 0-based, verbatim fallbacks ---

export const TRIBUTE_LAUGH_FIRST_INDEX = 5;
export const TRIBUTE_LAUGH_FALLBACK = "Don't make us laugh.";
export const TRIBUTE_FLEET_FIRST_INDEX = 10;
export const TRIBUTE_FLEET_FALLBACK =
    'Our defense fleet will make short work of you.';
export const TRIBUTE_ACCEPTED_PLANET_INDEX = 25;
export const TRIBUTE_ACCEPTED_PLANET_FALLBACK =
    'All right, all right already!  The planet agrees to pay you tribute.';
export const TRIBUTE_ACCEPTED_STATION_INDEX = 26;
export const TRIBUTE_ACCEPTED_STATION_FALLBACK =
    'Okay, you win!  The station agrees to pay you tribute.';
export const TRIBUTE_RELEASED_PLANET_INDEX = 35;
export const TRIBUTE_RELEASED_PLANET_FALLBACK =
    'You release the planet from its debt to you.';
export const TRIBUTE_RELEASED_STATION_INDEX = 36;
export const TRIBUTE_RELEASED_STATION_FALLBACK =
    'You release the station from its debt to you.';
const TRIBUTE_GROUP_SIZE = 5;

function line(strings: readonly string[] | undefined, index: number,
    fallback: string): string {
    const text = strings?.[index];
    return text && text.trim() !== '' ? text : fallback;
}

/**
 * The stellar's answer to a demand (STR# 3002): a laugh (5-9) or the
 * fleet (10-14), one of five by `seed`; giving in, 25 for a planet and 26
 * for a station (MEASURED, wave 39's "#26" one-based).
 */
export function tributeResponseText(strings: readonly string[] | undefined,
    outcome: TributeOutcome, isStation: boolean, seed = 0): string {
    const pick = (first: number, fallback: string) =>
        line(strings, first + ((seed >>> 0) % TRIBUTE_GROUP_SIZE), fallback);
    switch (outcome) {
        case 'laugh':
            return pick(TRIBUTE_LAUGH_FIRST_INDEX, TRIBUTE_LAUGH_FALLBACK);
        case 'fleet':
            return pick(TRIBUTE_FLEET_FIRST_INDEX, TRIBUTE_FLEET_FALLBACK);
        case 'dominate':
            return isStation
                ? line(strings, TRIBUTE_ACCEPTED_STATION_INDEX,
                    TRIBUTE_ACCEPTED_STATION_FALLBACK)
                : line(strings, TRIBUTE_ACCEPTED_PLANET_INDEX,
                    TRIBUTE_ACCEPTED_PLANET_FALLBACK);
    }
}

/** The Release line (STR# 3002 35, a station's 36). */
export function tributeReleasedText(strings: readonly string[] | undefined,
    isStation: boolean): string {
    return isStation
        ? line(strings, TRIBUTE_RELEASED_STATION_INDEX,
            TRIBUTE_RELEASED_STATION_FALLBACK)
        : line(strings, TRIBUTE_RELEASED_PLANET_INDEX,
            TRIBUTE_RELEASED_PLANET_FALLBACK);
}

/**
 * The tribute a pilot's dominated stellars pay him per day: the sum of
 * their PlanetData.domination.tribute (already decoded, the Bible's
 * "1,000 x Tech Level" for a Tribute of 0 / -1). A stellar the data set
 * cannot resolve pays nothing.
 */
export function dailyTribute(dominated: Iterable<string> | undefined,
    getPlanet: (id: string) => Pick<PlanetData, 'domination'> | undefined)
    : number {
    let total = 0;
    for (const id of dominated ?? []) {
        total += Math.max(0, getPlanet(id)?.domination.tribute ?? 0);
    }
    return total;
}

// --- The demand and the release (hail input records) ---

/**
 * The tribute's record change through the world's staged geography (every
 * sÿst: makeSystem), or the current system alone without it.
 */
function chargeDemand(world: World, player: Entity, systemId: string) {
    const records = player.components.get(LegalRecordsComponent);
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!records || !gameData) {
        return;
    }
    applyRecordSpread(records, crimeGeography(
        world.resources.get(LegalGeographyResource), systemId, gameData,
        world.resources.get(GovtsResource)), systemId, TRIBUTE_DEMAND_RECORD);
}

/** Records the domination of `planetId` on `player` (a new array). */
export function dominate(player: Entity, planetId: string) {
    player.components.set(DominatedComponent, withDominated(
        player.components.get(DominatedComponent), planetId));
}

/**
 * DEMAND TRIBUTE, from `player` (`playerUuid`) at the stellar entity
 * `planet` (`planetUuid`): the outcome re-derived from synced state
 * (tributeDemandOutcome), then
 *  - a laugh: nothing here (the channel alone turns hostile);
 *  - the fleet: -600, and the player joins the stellar's demanders (the
 *    fleet starts DEFENSE_FIRST_LAUNCH_MS later if it was not up);
 *  - giving in: -600, and the stellar is dominated.
 * A stellar the player already dominates, or one that takes no demands,
 * ignores it.
 */
export function applyTributeDemand(world: World, player: Entity,
    playerUuid: string, planet: Entity, planetUuid: string): void {
    const planetData = planet.components.get(PlanetDataComponent);
    const planetId = planet.components.get(PlanetComponent)?.id;
    const systemId = world.resources.get(SystemIdResource);
    if (!planetData || planetId === undefined || systemId === undefined
        || !stellarTakesDemands(planetData)
        || hasDominated(player, planetId)) {
        return;
    }
    const staged = world.resources.get(DefenseFleetsResource)
        ?.get(planetUuid);
    const outcome = tributeDemandOutcome(
        player.components.get(CombatRatingComponent)?.kills ?? 0,
        staged !== undefined);
    if (outcome === 'laugh') {
        return;
    }
    chargeDemand(world, player, systemId);
    if (outcome === 'dominate') {
        dominate(player, planetId);
        return;
    }
    const fleet = planet.components.get(DefenseFleetComponent);
    const now = world.resources.get(TimeResource)?.time ?? 0;
    if (!fleet) {
        planet.components.set(DefenseFleetComponent, {
            ...emptyDefenseFleet(),
            demanders: [playerUuid],
            nextLaunch: now + DEFENSE_FIRST_LAUNCH_MS,
        });
        return;
    }
    if (fleet.demanders.includes(playerUuid)) {
        return;
    }
    if (fleet.demanders.length === 0) {
        fleet.nextLaunch = Math.max(fleet.nextLaunch,
            now + DEFENSE_FIRST_LAUNCH_MS);
    }
    fleet.demanders = sortedWith(fleet.demanders, playerUuid);
}

/**
 * RELEASE, from `player` at the stellar `planet`: it is no longer
 * dominated (and pays no more tribute). Nothing else changes.
 */
export function applyTributeRelease(player: Entity, planet: Entity): void {
    const planetId = planet.components.get(PlanetComponent)?.id;
    if (planetId === undefined || !hasDominated(player, planetId)) {
        return;
    }
    player.components.set(DominatedComponent, withoutDominated(
        player.components.get(DominatedComponent), planetId));
}
