import * as t from 'io-ts';
import { GovtData } from 'novadatainterface/govt_data';
import { Component } from 'nova_ecs/component';
import { Plugin } from 'nova_ecs/plugin';
import { ProvideFromCache } from '../core/index.js';
import { registerEntityDeriver } from '../core/index.js';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { SimulationGameDataResource } from '../core/index.js';
import { CloakDrainSystem, OutfitsState, OutfitsStateComponent } from '../ship/index.js';
import { LegalRecords } from './reputation.js';
import { criminalHere, LocalLaw } from './local_law.js';
import { StellarClearance } from './stellar_clearance.js';

/**
 * A ship's IFF (Identify Friend or Foe) capability, derived from its owned
 * IFF-decoder outfits (oütf ModType 14, "IFF / colorized radar"). When the
 * player owns one, radar blips are coloured by each ship's disposition toward
 * the player instead of the flat dim colour (EVN Bible: "having an IFF outfit
 * will override [the radar] colors"; the outfit "colorizes" the radar).
 *
 * This is derived from outfits and re-derived on snapshot restore (like
 * CloakComponent), so it is NOT snapshotted. `hasIff` is true iff at least one
 * IFF outfit is present. The capability itself carries no configuration — the
 * ModVal is ignored per the Bible — so this is just a presence flag, but it is
 * modelled as a component for symmetry with the cloak / cloak-scanner
 * capabilities and so display systems can query it per ship.
 */
export const IffCapabilityType = t.type({ hasIff: t.boolean });
export type IffCapability = t.TypeOf<typeof IffCapabilityType>;

export const IffComponent = new Component<IffCapability>('IffComponent');

/**
 * True iff the ship owns at least one IFF outfit. Returns undefined only when
 * outfit game data is not yet cached (retry next step), matching the
 * ProvideFromCache contract.
 */
export function deriveIff(outfits: OutfitsState,
    gameData: SimulationGameDataInterface): IffCapability | undefined {
    for (const [id, state] of outfits) {
        if (state.count <= 0) {
            continue;
        }
        const outfit = gameData.data.Outfit.getCached(id);
        if (!outfit) {
            return undefined;
        }
        if (outfit.iff) {
            return { hasIff: true };
        }
    }
    return { hasIff: false };
}

/**
 * A ship's disposition toward the player: hostile, friendly or neutral.
 * shipDisposition below fills it from the GOVERNMENT's stance alone; the IFF
 * colour (target brackets and radar blips) fills it from how the SHIP stands
 * toward the player (combat/hostility.ts's styleForTarget and its
 * onSightDisposition tier), so a trader of a hostile government is
 * 'neutral' there until it attacks.
 *  - 'hostile': hostile to the player.
 *  - 'friendly': allied with the player's government.
 *  - 'neutral': neither — the default for a govt-less ship or one with no
 *    relationship to the player.
 */
export type Disposition = 'hostile' | 'friendly' | 'neutral';

/** Whether two class-number lists share any value. */
function intersects(a: readonly number[], b: readonly number[]): boolean {
    return a.some(x => b.includes(x));
}

/**
 * Computes a ship's GOVERNMENT's stance toward the player from the ship's
 * government and the player's government (both optional GovtData;
 * undefined = no government). Pure and total.
 *
 * This is the government's attitude, NOT the IFF colour. It decides what a
 * ship of that government will do for the player — answer a hail
 * (hail.ts's canRequestAssistance), offer a mission (ship_mission_offer) —
 * whatever the individual ship is doing. The brackets and radar ask a
 * different question, whether THIS ship is hostile (Matthew, 2026-11-23:
 * "IFF bracket colors correspond to hostility regardless of govt's
 * stance"), and answer it in combat/hostility.ts's onSightDisposition from
 * the NPC brain's own predicate: an AI 1 trader of a government this
 * function calls hostile is yellow there until it attacks (reference K9).
 *
 * Hostility, in priority order:
 *  1. The ship's govt flags mark it hostile to the player
 *     (alwaysAttacksPlayer, or xenophobic which "attacks everyone except
 *     allies"). neverAttacksPlayer overrides these to non-hostile.
 *  2. The ship's govt `enemies` classes intersect the player's govt classes.
 *  3. The ship's govt enforces the law of the CURRENT system and the
 *     player's record there is below its -CrimeTol (local_law.ts's
 *     criminalHere, reference A14 / ruling #376) — the same rule the
 *     sim's target selection uses (govtDispositionTo). `law` is the law
 *     in force where the player is (localLawIn for the world's system).
 *  4. The ship's govt detected contraband aboard the player on this stay
 *     in space (`playerDetectedBy`; reference "Contraband wave 14").
 * Friendliness (only if not hostile): the ship's govt `allies` classes
 * intersect the player's govt classes, or ship and player share a government.
 * Everything else is neutral.
 */
export function shipDisposition(shipGovt: GovtData | undefined,
    playerGovt: GovtData | undefined,
    playerRecords: LegalRecords | undefined,
    law: LocalLaw,
    /**
     * ränk 0x0100 for THIS ship's government ("Ships of the affiliated
     * government will not automatically attack the player when he has this
     * rank"). The AI's twin of this test lives in govt_disposition's
     * govtDispositionTo; both read the same rank set so the corners and the
     * ship shooting at you cannot disagree.
     */
    rankSuppressesAggression?: boolean,
    /**
     * The government whose contraband scan detected something aboard the
     * player on this stay in space (npc/contraband_target.ts's
     * contrabandDetectedBy): hostile beside the criminal record, as in
     * govtDispositionTo.
     */
    playerDetectedBy?: string): Disposition {
    if (!shipGovt) {
        return 'neutral';
    }
    const flags = shipGovt.flags;
    if (!flags.neverAttacksPlayer && !rankSuppressesAggression) {
        if (flags.alwaysAttacksPlayer || flags.xenophobic) {
            return 'hostile';
        }
        if (playerGovt && intersects(shipGovt.enemies, playerGovt.classes)) {
            return 'hostile';
        }
        if (playerRecords && criminalHere(shipGovt, playerRecords, law)) {
            return 'hostile';
        }
        if (playerDetectedBy !== undefined
            && playerDetectedBy === shipGovt.id) {
            return 'hostile';
        }
    }
    if (playerGovt) {
        if (shipGovt.id === playerGovt.id
            || intersects(shipGovt.allies, playerGovt.classes)) {
            return 'friendly';
        }
    }
    return 'neutral';
}

/**
 * Radar blip colours for each disposition when the player has IFF. Nova's IFF
 * uses red for hostile, green for friendly, and yellow for neutral ships; the
 * exact palette is a display choice (the Bible only says IFF "colorizes" and
 * "overrides" the default radar colours).
 */
export const IFF_HOSTILE_COLOR = 0xff2222;
export const IFF_FRIENDLY_COLOR = 0x22ff22;
export const IFF_NEUTRAL_COLOR = 0xffff44;

/** The IFF radar colour for a disposition. */
export function dispositionColor(disposition: Disposition): number {
    switch (disposition) {
        case 'hostile': return IFF_HOSTILE_COLOR;
        case 'friendly': return IFF_FRIENDLY_COLOR;
        case 'neutral': return IFF_NEUTRAL_COLOR;
    }
}

/**
 * A DISABLED ship's radar blip. Grey, the same grey an unlandable stellar's
 * blip uses ({@link PLANET_UNLANDABLE_COLOR}) and the same story the gray
 * 'disabled' corner set tells (cicn 10020-10023, hostility.ts's
 * styleForTarget): dead in space trumps every allegiance, so it is a fact
 * about the ship rather than about the pilot looking at it.
 */
export const SHIP_DISABLED_COLOR = 0x808080;

/**
 * A ship's radar blip colour, or undefined when the status bar's flat
 * dimRadar colour should be used (that colour is ïntf data the status bar
 * owns, so it is not named here).
 *
 * DISABLED is grey with OR without IFF and takes precedence over hostile
 * red — the same priority the target corners give it. Otherwise, without an
 * IFF outfit there is nothing to colorize and every ship stays flat; with
 * one, the blip takes its disposition's colour.
 */
export function shipBlipColor(disposition: Disposition, hasIff: boolean,
    disabled = false): number | undefined {
    if (disabled) {
        return SHIP_DISABLED_COLOR;
    }
    return hasIff ? dispositionColor(disposition) : undefined;
}

/**
 * A STELLAR's disposition toward the player, the planet-side counterpart of
 * shipDisposition. It is not a second opinion about politics: it is exactly a
 * reading of `stellarClearance` (stellar_clearance.ts), so the radar blip, the
 * planet comm dialog and the landing gate can never disagree about whether a
 * port is open.
 *
 *  - 'neutral': the port will let you land (Matthew: "Neutral spobs let you
 *    land and show up as blue on iff").
 *  - 'forbidden': the port is shut — MinStatus 32767, or a gövt travel permit
 *    the player doesn't hold. The original's word for the state is "Forbidden"
 *    (STR# 2002 index 172).
 *  - 'hostile': the player's legal record is below the stellar's MinStatus.
 *    The original's word is "Hostile" (STR# 2002 index 173).
 *
 * The travel-permit denial folds into 'forbidden' rather than earning a fourth
 * colour: it is the same "you are not allowed in here" state, and Matthew's
 * palette has three entries.
 */
export type PlanetDisposition =
    'neutral' | 'forbidden' | 'hostile' | 'unlandable';

/**
 * The stellar disposition implied by a clearance decision, plus the
 * static "can this ever be landed on" fact (landable.ts — the spöb can-land
 * bit: Jupiter and the other 41 stock scenery worlds, and the destroyed
 * hypergates). An UNLANDABLE stellar is unlandable regardless of anyone's
 * record, so that tier is checked FIRST and reads the same to every pilot.
 */
export function planetDisposition(clearance: StellarClearance,
    isLandable = true): PlanetDisposition {
    if (!isLandable) {
        return 'unlandable';
    }
    if (clearance.cleared) {
        return 'neutral';
    }
    return clearance.reason === 'hostile' ? 'hostile' : 'forbidden';
}

/**
 * Stellar blip colours.
 *
 * WITHOUT an IFF outfit the radar draws every landable stellar — inhabited
 * or not — in the status bar's flat dimRadar grey, exactly as ship blips
 * fall back to it: the Bible says an IFF outfit "colorizes" the radar and
 * "overrides" its colours (ïntf DimRadar: "having an IFF outfit will
 * override these colors"), so with no IFF there is nothing to colorize.
 * Matthew's ruling (2026-11-21): "Inhabited planets should still show up
 * grey until the player has an iff sensor." That grey is ïntf data the
 * status bar owns (stock #808080 on all nine stock/Arpia ïntfs), so
 * {@link planetBlipColor} returns undefined for it rather than naming it.
 * The Windows no-add-ons radar recordings (#358) agree: stellar rings,
 * ship blips and the centre arrow are one grey there.
 *
 * WITH IFF the palette is Matthew's (2026-08-15): NEUTRAL (you may land)
 * YELLOW, FORBIDDEN orange, HOSTILE red. The yellow is the #FFFF00 of the
 * original-hardware captures (ui_screenshots/original_macos_screenshots/
 * space/*.png); those pilots carry IFF — their ship blips are colourised
 * green / blue / yellow / red — so the captures show the IFF palette, not
 * the no-IFF one. UNLANDABLE (Jupiter, scenery worlds, dead gates — the
 * spöb can-land bit) is GREY with or without IFF, a fact about the stellar
 * rather than about allegiance; the captures' unlandable ring is #808080.
 * The cölr resource does NOT carry these — its colour fields are
 * menu/button/list/progress-bar chrome only (EVN Bible, "The cölr
 * resource"); orange was not sampled (no capture shows a forbidden blip).
 */
export const PLANET_NEUTRAL_COLOR = 0xffff00;
export const PLANET_FORBIDDEN_COLOR = 0xff7f00;
export const PLANET_HOSTILE_COLOR = 0xff0000;
export const PLANET_UNLANDABLE_COLOR = 0x808080;

/**
 * A stellar's radar blip colour, or undefined when the status bar's flat
 * dimRadar grey should be used — the same contract as
 * {@link shipBlipColor}. Unlandable is grey with or without IFF; otherwise,
 * without IFF every stellar is the flat grey (an IFF outfit "colorizes" the
 * radar), and with one it takes its landing-clearance colour.
 */
export function planetBlipColor(disposition: PlanetDisposition,
    hasIff: boolean): number | undefined {
    if (disposition === 'unlandable') {
        return PLANET_UNLANDABLE_COLOR;
    }
    if (!hasIff) {
        return undefined;
    }
    switch (disposition) {
        case 'hostile': return PLANET_HOSTILE_COLOR;
        case 'forbidden': return PLANET_FORBIDDEN_COLOR;
        case 'neutral': return PLANET_NEUTRAL_COLOR;
    }
}

/**
 * Which corner-bracket set (TargetCornersData.images key) a targeted SHIP
 * gets. THE HOSTILITY RULE, in priority order:
 *
 *  1. DISABLED: a disabled ship (DisabledComponent) shows the gray
 *     'disabled' corner set (cicn 10020-10023) regardless of iff or
 *     politics — dead in space trumps every allegiance.
 *  2. Behavioral: a ship that is *currently attacking the player* shows
 *     hostile corners regardless of politics — a brave trader fighting the
 *     player back, or a neutral-govt warship the player provoked, is hostile
 *     in every sense that matters to the pilot. "Currently attacking" is
 *     derived display-side from synced state: the target's own
 *     TargetComponent points at the player AND its AI is in an attacking
 *     posture (NpcComponent mode 'attack', or the legacy dev-enemy
 *     ShootAllWeapons marker). A ship merely *fleeing* the player keeps its
 *     political corners.
 *  3. Political: hostility.ts's onSightDisposition — hostile and
 *     friendly map to their corner sets.
 *  4. Everything else: neutral.
 *
 * Planets use their own corner instance (planet_corners_plugin) and are
 * unaffected.
 */
/**
 * The target-corner set drawn around a selected ship: a political
 * disposition, or the gray "dead in space" set for a disabled hulk. Keys
 * the TargetCorners images (display/target_corners_plugin).
 */
export type TargetCornerStyle = Disposition | 'disabled';
export function targetCornerStyle(disposition: Disposition,
    attackingPlayer: boolean, disabled = false): TargetCornerStyle {
    if (disabled) {
        return 'disabled';
    }
    return attackingPlayer ? 'hostile' : disposition;
}

export const IffProvider = ProvideFromCache({
    name: 'IffProvider',
    provided: IffComponent,
    update: [OutfitsStateComponent],
    args: [OutfitsStateComponent, SimulationGameDataResource] as const,
    factory: deriveIff,
    // #237 pin: the pair no longer shares state (the provider declares
    // its write with SetComponent now), but the edge carries the
    // transitive order — IffPlugin registers after CloakPlugin.
    after: [CloakDrainSystem],
});

export const IffPlugin: Plugin = {
    name: 'IffPlugin',
    build(world) {
        world.addComponent(IffComponent);

        // NOTE: IffComponent is NOT delta-registered. The radar runs in the
        // display world (not the sim worker), and delta-syncing a
        // snapshot-skipped derived component would break wire-snapshot
        // fidelity (the rollback snapshot skips it, so a wire snapshot taken
        // from a rollback snapshot would omit it while a direct wire snapshot
        // would include it). Instead the display's DrawRadar derives the
        // player's IFF locally from the delta-synced OutfitsStateComponent via
        // deriveIff — the same source of truth, no cross-world component.

        // Re-derive the capability wherever a full entity is built (staged
        // insertion, snapshot restore), like the cloak capability.
        registerEntityDeriver(world, {
            name: 'IffDeriver',
            provided: IffComponent,
            requires: [OutfitsStateComponent],
            derive: (entity, gameData) => deriveIff(
                entity.components.get(OutfitsStateComponent)!, gameData),
        });

        world.addSystem(IffProvider);
    },
};
