import { PlanetData } from 'novadatainterface/planet_data';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import {
    makeDescTextContext, playerGender, resolveConditionalBlocks, ActiveRanksComponent,
    ControlBitsComponent,
} from '../nova_plugin/ncb/index.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent, displayName } from '../nova_plugin/core/index.js';
import {
    stellarHasTradeCenter, stellarNeedsJunksForTrade,
} from '../nova_plugin/economy/index.js';
import {
    ArmorComponent, FUEL_PER_JUMP, FuelComponent, IonizationComponent, ShieldComponent,
    ShipComponent, ShipPhysicsComponent, WeaponsStateComponent, OutfitsStateComponent,
} from '../nova_plugin/ship/index.js';
import {
    LOCATION_MAIN_SPACEPORT, LOCATION_MISSION_COMPUTER, LOCATION_OUTFIT, LOCATION_SHIPYARD,
    LOCATION_TRADING, MissionEvent, MissionMapMark, missionMapMarks, expandMissionText,
    abortMission, jettisonDockedCargo,
} from '../nova_plugin/missions/index.js';
import type { MissionInfoAbort } from './mission_info.js';
import type { PlayerInfoJettison } from './player_info.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent, PlayerNamesComponent,
} from '../nova_plugin/player/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import { DockedLiveStatus, DockedShip } from '../display/docked_ship.js';
import { hasAutoRefueller } from './auto_refuel.js';
import { Bar } from './bar.js';
import { Button } from './button.js';
import { LINE_HEIGHT } from './dialog_layout.js';
import { describeOutfitChanges, requestCheckpoint } from './checkpoint_requests.js';
import { DeployedOutfitCounts } from './deployed_outfits.js';
import {
    EscortDealEntry, escortSettlementReport, queuedUpgradeTargets,
} from './escort_deals.js';
import { escortWageReport } from './escort_wages.js';
import { LandedTransaction } from './landed_transaction.js';
import {
    departureRequested, PendingDeparture, PendingDepartureComponent,
} from './landed_departure.js';
import { statusQuoteLine } from './status_quote.js';
import {
    pickShipName, resolveSetStringSound,
} from './set_string_requests.js';
import { Menu } from './menu.js';
import { MenuControls } from './menu_controls.js';
import { MissionBoard } from './mission_board.js';
import { OfferPopup, POPUP_OKAY, presentOffers } from './offer_popup.js';
import { landingOffers } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';
import { presentVenueOffersIn } from './venue_offers.js';
import { afterNextRender } from './after_render.js';
import { Outfitter } from './outfitter.js';
import { playerIdentitySubs } from './player_identity.js';
import { runShipBuildWorld } from './ship_build_world.js';
import { Shipyard } from './shipyard.js';
import { loadEachOrSkip } from './skip_failed_loads.js';
import { OpenStarmapOptions } from './starmap.js';
import { TradeCenter } from './trade_center.js';

// The 618x517 spaceport frame (PICT 8500): the landing image fills the
// top, the stellar name and description sit in the center panel, and
// the venue buttons run down the left and right metal panels — Bar /
// Mission BBS / Trade Center on the left, Shipyard / Outfitter and
// (after a one-slot gap) Leave on the right, per the original's
// arrangement. Measured against the 1920x1080 reference screenshots
// (spaceport/earth.png): the first button row's center sits 88px below
// the frame's center, rows are 41px apart, and Leave occupies the
// fourth slot.
// Left/right column x, measured against spaceport/earth.png: the left
// column's red pill spans screen x 661-787 and the right column's 1129-1255.
// With the frame centered on x=960 these offsets land our pills on the same
// rectangles (the left column was previously 10px too far right).
const LEFT_BUTTON_X = -306;
/** The spaceport frame (PICT 8500). */
export const SPACEPORT_PICT = 'nova:8500';
/** The Mission BBS frame (PICT 8505). */
export const MISSION_BBS_PICT = 'nova:8505';
const RIGHT_BUTTON_X = 162;
const BUTTON_TOP = 75;
const BUTTON_SPACING = 41;
const BUTTON_WIDTH = 120;

// Refueling is paid: 100 credits per jump's worth of fuel
// (FUEL_PER_JUMP units), prorated for partial jumps and rounded up.
const REFUEL_COST_PER_JUMP = 100;

/** Cost in credits to fill the tank from `current` to `max`. */
export function refuelCost(fuel: { current: number, max: number }): number {
    return Math.ceil(
        (fuel.max - fuel.current) / FUEL_PER_JUMP * REFUEL_COST_PER_JUMP);
}

/**
 * The auto-refueller's purchase at touch-down: the full fill when the
 * credits pay for it, otherwise as many WHOLE units as they do (reference
 * "The Auto-recharger short of credits (E7 leftover), wave 40": 100
 * credits bought 100 units at 1 credit a unit and left 0). Zero units when
 * the tank is full or nothing is affordable.
 */
export function autoRefuelPurchase(fuel: { current: number, max: number },
    credits: number): { units: number, cost: number } {
    const missing = fuel.max - fuel.current;
    if (missing <= 0) {
        return { units: 0, cost: 0 };
    }
    const full = refuelCost(fuel);
    if (credits >= full) {
        return { units: missing, cost: full };
    }
    const units = Math.max(0, Math.min(missing,
        Math.floor(credits * FUEL_PER_JUMP / REFUEL_COST_PER_JUMP)));
    return {
        units,
        cost: Math.ceil(units / FUEL_PER_JUMP * REFUEL_COST_PER_JUMP),
    };
}

/** The entity's owned outfits as [id, count] pairs (empty when none). */
function outfitCounts(entity: Entity | undefined): [string, number][] {
    const outfits = entity?.components.get(OutfitsStateComponent);
    return outfits ? [...outfits].map(([id, { count }]) => [id, count]) : [];
}

export class Spaceport extends Menu<Entity> {
    /*
     * The four facility venues exist only where the stellar has them
     * (spöb flags; #373, Matthew 2026-11-23: "build a venue only when the
     * stellar has it"). Each is constructed in build(), once the stellar's
     * data is in, so a landing at a stellar with no shipyard never loads
     * the shipyard's art or data. Undefined before the build finishes and
     * for a facility the stellar lacks; the button for a missing facility
     * is hidden exactly as before. The Mission BBS has no spöb flag —
     * every spaceport has one — so it is built with the spaceport.
     */
    private outfitter?: Outfitter;
    private shipyard?: Shipyard;
    private missionComputer: MissionBoard;
    private bar?: Bar;
    private tradeCenter?: TradeCenter;
    /** What the venues are built with (build, after the stellar's data). */
    private readonly venueControlEvents: Observable<ControlEvent>;
    /**
     * The per-landing settings the plugin pushes (setDeployedOutfitCounts,
     * setLandedEscorts), kept so a venue built after they arrive — the
     * first landing here, while the stellar's data is still loading —
     * starts with them.
     */
    private deployedOutfitCounts?: DeployedOutfitCounts;
    private landedEscortSettings?: [roster?: () => EscortDealEntry[],
        playerUuid?: string, world?: Iterable<[string, Entity]>];
    private universe: MissionUniverse;
    /** Landing mission-offer / completion popups, shown over the
     * spaceport before it becomes interactive. */
    private offerPopup: OfferPopup;
    /** Holds keyboard focus (and mutes the global map key) while the
     * pointer-only landing popups are up. */
    private popupBlocker: MenuControls;
    private buttons: {
        bar: Button, missions: Button, tradeCenter: Button,
        shipyard: Button, outfitter: Button, refuel: Button,
        leave: Button,
    };
    private data?: PlanetData;
    /** The landing description (spöb dësc), re-expanded every landing. */
    private landingDesc?: PIXI.Text;
    /**
     * The docked-ship handle the status bar reads while docked. The spaceport
     * points its `liveStatus` at whichever venue is open so the bar tracks a
     * transaction's working credits/cargo before it commits to the entity.
     */
    private dockedShip?: DockedShip;
    /**
     * THE LANDING'S TRANSACTION (landed_transaction.ts): opened as the
     * player docks (show), the one working copy every venue is a view
     * onto, committed once at Leave (done) — or flushed by a teardown
     * (dismiss). Undefined before the landing's data is in, and for a
     * landing whose mission universe never loaded (the venues then open
     * transactions of their own, or refuse).
     */
    private transaction?: LandedTransaction;
    /**
     * The client's landed-escort roster and the docked player's uuid
     * (setLandedEscorts), for the lift-off settlement of the escort deals
     * queued against it (leave). Unset for a spaceport shown without a
     * landing (the headless specs): nothing settles.
     */
    private landedRoster?: () => EscortDealEntry[];
    private playerUuid?: string;
    /** Whether a Leave is already in progress (see leave). */
    private leaving = false;
    /**
     * What the departing hull carries to the client's lift-off (the visit's
     * `Qxxx` messages and `Mxxx` / `Nxxx` move — landed_departure.ts),
     * built by {@link leave} and put on the committed hull by {@link done}.
     */
    private liftOffDeparture?: PendingDeparture;
    /**
     * The venues, as the set the transaction is attached to per landing
     * and the set a teardown dismisses.
     */
    private get venues(): {
        transaction?: LandedTransaction, dismiss(): void,
        container: PIXI.Container,
    }[] {
        return [this.outfitter, this.shipyard, this.bar, this.tradeCenter,
            this.missionComputer].filter(<T>(venue: T | undefined):
                venue is T => venue !== undefined);
    }

    private font = {
        title: {
            fontFamily: "Geneva", fontSize: 18, fill: 0xffffff,
            align: 'center'
        } as const,
        // The landing description is the original's body text, Geneva 9
        // on a 12px pitch, like every other landed pane (dialog_layout.ts):
        // at 9px/11px ours ran ~2.5% narrow and a line short every 11, so
        // Earth's text wrapped a word late on most lines and ended at
        // y719 where the R8 wave-5 capture (02-spaceport.png) ends at
        // y738. 9.4px reproduces that capture's breaks line for line.
        desc: {
            fontFamily: "Geneva", fontSize: 9.4, fill: 0xffffff,
            align: 'left', wordWrap: true, wordWrapWidth: 301,
            lineHeight: LINE_HEIGHT,
        } as const,
    };

    constructor(displayAssets: DisplayAssetDataInterface,
        simulationData: SimulationGameDataInterface, private id: string,
        controlEvents: Observable<ControlEvent>,
        /** Opens the starmap over the spaceport (the 'm' key), so the
         * player can check mission destinations while docked. */
        private openStarmap?: (options?: OpenStarmapOptions)
            => Promise<unknown>,
        /** Opens the player-info dialog over the spaceport (the 'p'
         * key) — it works both in flight and docked. The docked ship
         * entity is passed explicitly: while docked it is out of the
         * world, held by this menu; so is the Jettison Cargo that edits
         * the landing's working copy. */
        private openPlayerInfo?: (entity: Entity,
            jettison?: PlayerInfoJettison) => Promise<unknown>,
        /** Opens the mission-info dialog over the spaceport (the 'i'
         * key; display/mission_info_plugin.ts OpenMissionInfoResource),
         * for the hull docked here and with the Abort that edits the
         * landing's working copy. */
        private openMissionInfo?: (entity: Entity,
            abort?: MissionInfoAbort) => Promise<unknown>) {
        super(displayAssets, simulationData, SPACEPORT_PICT, controlEvents);
        this.container.name = 'Spaceport';

        const buttonY = (slot: number) =>
            BUTTON_TOP + slot * BUTTON_SPACING;
        this.buttons = {
            bar: new Button(displayAssets, "Bar", BUTTON_WIDTH,
                { x: LEFT_BUTTON_X, y: buttonY(0) }),
            missions: new Button(displayAssets, "Mission BBS", BUTTON_WIDTH,
                { x: LEFT_BUTTON_X, y: buttonY(1) }),
            tradeCenter: new Button(displayAssets, "Trade Center", BUTTON_WIDTH,
                { x: LEFT_BUTTON_X, y: buttonY(2) }),
            shipyard: new Button(displayAssets, "Shipyard", BUTTON_WIDTH,
                { x: RIGHT_BUTTON_X, y: buttonY(0) }),
            outfitter: new Button(displayAssets, "Outfitter", BUTTON_WIDTH,
                { x: RIGHT_BUTTON_X, y: buttonY(1) }),
            // The refuel button, captioned "Recharge" as in the original
            // (reference "... (R9) and the Trade Center (K6), wave 37",
            // the refuel button's label; its key is `r`), occupies the
            // right column's third slot, but only exists while the
            // player's fuel isn't full — it disappears when full (e.g. an
            // auto-refueller outfit) and greys out when the player can't
            // afford the fill. The reference screenshot
            // (spaceport/earth.png) shows the gap because that capture's
            // player had full fuel.
            refuel: new Button(displayAssets, "Recharge", BUTTON_WIDTH,
                { x: RIGHT_BUTTON_X, y: buttonY(2) }),
            leave: new Button(displayAssets, "Leave", BUTTON_WIDTH,
                { x: RIGHT_BUTTON_X, y: buttonY(3) }),
        };
        const buttons = this.buttons;

        this.onMainScreenClick(buttons.leave, () => void this.leave());
        this.onMainScreenClick(buttons.refuel, () => this.refuel());

        this.venueControlEvents = controlEvents;
        // (A ship change from an OnPurchase set string is published off
        // the landing's transaction, like every venue's — see show.)
        const showOutfitter = async () => {
            // No stellar data yet (the spaceport's keys go live before its
            // build finishes — see show) or no such venue here (#373: it
            // is built only where the stellar has it): nothing to open.
            // The same rule guards every venue below.
            const outfitter = this.outfitter;
            if (!outfitter) {
                return;
            }
            if (!this.enterVenue()) {
                return;
            }
            // The outfitter mutates the ship's outfits and the
            // player's control bits.
            this.setLiveStatus(() => outfitter.dockedStatus());
            // Taken as each visit opens — again at the reopen after the
            // entry offers — so an accept's `Gxxx` grant is not announced
            // as a purchase.
            let outfitsBefore = outfitCounts(this.input);
            // Outfitter (AvailLoc 6) mission offers over it: the Federation
            // string opens here (nova:428). See openVenue.
            this.input = await this.openVenue(outfitter, LOCATION_OUTFIT,
                () => { outfitsBefore = outfitCounts(this.input); });
            this.setLiveStatus(undefined);
            // An OnPurchase `Hxxx` (stock 314 "Chrome Valk Upgrade") may
            // have swapped the hull mid-visit; its stat providers are
            // still running, exactly as after a shipyard purchase.
            await this.shipBuild;
            this.announcePurchases(outfitsBefore);
            // Delete these so they are re-created with the new outfits.
            // Nothing re-derives them while docked (the entity is out of
            // the world, so no ChangeEvent can fire — see the note in
            // nova_plugin/ship/ship_plugin.ts): the relaunch rebuilds both.
            // Anything that must show outfitted physics WHILE STILL
            // LANDED therefore has to re-derive it for display rather
            // than read the component — see player_info.ts's
            // dialogShipPhysics. (Tracker issue: Provide re-derivation on
            // in-place mutation would make this delete unnecessary.)
            this.input.components.delete(WeaponsStateComponent);
            this.input.components.delete(ShipPhysicsComponent);
            // Outfits can change fuel capacity (fuel tanks), which
            // affects the Refuel button.
            this.refreshRefuelButton();
            this.rebindControls();
            this.departIfAsked();
        };
        this.onMainScreenClick(buttons.outfitter, showOutfitter);

        this.universe = MissionUniverse.shared(simulationData);
        this.offerPopup = new OfferPopup(displayAssets, controlEvents);
        this.popupBlocker = new MenuControls(controlEvents);
        this.missionComputer = new MissionBoard(displayAssets, simulationData,
            controlEvents, this.universe, id, LOCATION_MISSION_COMPUTER,
            MISSION_BBS_PICT, "Mission BBS", this.openStarmap
            && (options => this.openStarmap!({
                ...options,
                // A landed M / N has already moved the player (see
                // LandedTransaction.movedToSystem).
                currentSystemId: this.transaction?.movedToSystem,
            })));
        const showMissionComputer = async () => {
            if (!this.enterVenue()) {
                return;
            }
            // The board mutates missions, cargo, credits, control
            // bits, and (through Gxxx grants) outfits.
            this.input = await this.missionComputer.show(this.input);
            // An accept that emptied the board closed it (#324); its
            // briefing goes up over the spaceport instead of in the
            // board's pane.
            const briefing = this.missionComputer.takeClosingBriefing();
            if (briefing && this.stillDocked()) {
                this.popupBlocker.bind();
                try {
                    await this.offerPopup.show(briefing.text,
                        { accept: POPUP_OKAY },
                        { pict: briefing.pict, style: 'briefing' });
                } finally {
                    this.popupBlocker.unbind();
                }
            }
            // An accepted mission's `Hxxx` may have swapped the hull (see
            // show); its stat providers may still be running.
            await this.shipBuild;
            this.refreshRefuelButton();
            this.rebindControls();
            this.departIfAsked();
        };
        this.onMainScreenClick(buttons.missions, showMissionComputer);

        const showBar = async () => {
            const bar = this.bar;
            if (!bar) {
                return;
            }
            if (!this.enterVenue()) {
                return;
            }
            // The bar mutates missions, credits (gambling, hire fees),
            // cargo, bits, and records hired escorts.
            this.setLiveStatus(() => bar.dockedStatus());
            this.input = await bar.show(this.input);
            this.setLiveStatus(undefined);
            // As at the BBS: an accepted mission may have changed ships.
            await this.shipBuild;
            this.refreshRefuelButton();
            this.rebindControls();
            this.departIfAsked();
        };
        this.onMainScreenClick(buttons.bar, showBar);

        const showTradeCenter = async () => {
            const tradeCenter = this.tradeCenter;
            if (!tradeCenter) {
                return;
            }
            if (!this.enterVenue()) {
                return;
            }
            // The trade center mutates cargo and credits.
            this.setLiveStatus(() => tradeCenter.dockedStatus());
            // Trading (AvailLoc 4) mission offers over it (Tutorial
            // 002-004, United Shipping 5). See openVenue.
            this.input = await this.openVenue(tradeCenter, LOCATION_TRADING);
            this.setLiveStatus(undefined);
            this.refreshRefuelButton();
            this.rebindControls();
            this.departIfAsked();
        };
        this.onMainScreenClick(buttons.tradeCenter, showTradeCenter);

        const showShipyard = async () => {
            const shipyard = this.shipyard;
            if (!shipyard) {
                return;
            }
            if (!this.enterVenue()) {
                return;
            }
            // Shipyard (AvailLoc 5) mission offers over it: the Sigma
            // Shipyards string (nova:555/897/898), Pirate 009a (709). See
            // openVenue.
            // Any purchase inside the visit has already been adopted (and
            // has already set this.input); this just picks up the entity the
            // menu closes on, which is the same one.
            this.input = await this.openVenue(shipyard, LOCATION_SHIPYARD);
            // The new hull's stat providers are still running: hold the
            // spaceport's controls until they finish, exactly as awaiting
            // runShipBuildWorld here used to.
            await this.shipBuild;
            // A traded-in hull's tank is not the new one's: the Refuel
            // button has to be re-judged against the ship now docked.
            this.refreshRefuelButton();
            this.rebindControls();
            this.departIfAsked();
        };
        this.onMainScreenClick(buttons.shipyard, showShipyard);
        this.addButtons(buttons);

        this.controls = new MenuControls(controlEvents, {
            outfitter: showOutfitter,
            shipyard: showShipyard,
            missionBBS: showMissionComputer,
            bar: showBar,
            tradeCenter: showTradeCenter,
            recharge: this.refuel.bind(this),
            // The starmap and player info bind their own controls on
            // top of the focus stack while open, so the spaceport keys
            // stay quiet under them and 'd' backs out of just the
            // overlay.
            map: () => this.openDockedMap(),
            properties: () => void this.openDockedPlayerInfo(),
            // 'i': the mission dialog, with a working Abort, as on the
            // original's spaceport (reference "#324 mission BBS after an
            // accept, wave 21", finding 6); nothing with no missions
            // (wave 11). The venues ignore it (wave 11). The in-flight
            // handler stands down while a menu holds the keyboard.
            missions: () => void this.openDockedMissionInfo(),
            depart: () => void this.leave(),
        });
        // Return presses Leave, the original's default button here (K1,
        // and the wave-11 UI key matrix): the same leave() as the click,
        // so the escort-deal settlement and the commit run once.
        this.controls.defaultButton = () => void this.leave();
    }

    /**
     * True while the player is on the spaceport's own main screen — i.e.
     * docked here AND no venue (outfitter/shipyard/trade/bar/BBS) or overlay
     * (starmap/player-info/mission-info/landing popup) is on top. Each venue
     * unbinds the spaceport's controls and binds its own on top of the
     * MenuControls focus stack (and overlays do the same), so the spaceport's
     * controls are only the focused ones on the bare main screen. Used by the
     * display's spaceport-ambient-sound system to play the ambient only on the
     * main screen and pause it inside a venue.
     */
    get onMainScreen(): boolean {
        return this.container.visible && MenuControls.focused === this.controls;
    }

    /**
     * Wires one of the spaceport's own buttons so it acts only on the bare
     * main screen ({@link onMainScreen}) and never during a Leave. The
     * original's venues and dialogs are modal: nothing behind one reacts
     * until it closes. The venue's shield (modal_shield.ts) already keeps
     * the pointer off these buttons; this is the rule itself, so a button
     * can never open a second venue over the first — with the Outfitter
     * open, the Trade Center button below its frame used to, and the trade
     * center's Done then handed the keyboard back to the spaceport UNDER
     * the outfitter: its 'd' left the planet with the outfitter still
     * bound, and the ship would not fly until a third 'd' closed it
     * (Matthew's 2026-11-27 playtest). The keys need no such gate: the
     * focus stack only ever hands them to the surface on top.
     */
    private onMainScreenClick(button: Button, act: () => unknown) {
        button.click.subscribe(() => {
            if (this.onMainScreen && !this.leaving) {
                act();
            }
        });
    }

    /**
     * Gives the keyboard back from OUTSIDE: the owning display world is
     * being torn down with the player still docked here (display/
     * spaceport_plugin.ts's remove). Everything the visit may have bound
     * on the focus stack goes — the venue on top (through Menu.dismiss,
     * which also commits what the visit did there), the landing popup and
     * its blocker, and the spaceport's own keys — and the spaceport's and
     * blocker's controls are released for good, because show()'s own
     * chain and every venue's caller re-bind them after an await (see
     * MenuControls.release).
     *
     * Deliberately NOT Menu.dismiss's "resolve show()": for the spaceport
     * that resolution IS the departure — the plugin turns it into
     * LeaveSpaceportEvent, which the client answers by relaunching the
     * ship and recording a "Departed" checkpoint. A teardown is not a
     * departure, so show() is left unsettled (nothing holds it; it is
     * collected with the spaceport) and the ship stays docked in the
     * client's eyes.
     */
    override dismiss() {
        for (const venue of this.venues) {
            venue.dismiss();
        }
        // Whatever the landing edited so far reaches the held entity —
        // the venue dismissed above released its visit, and this catches
        // an offer sequence still running blind — so the exit-to-title
        // save sees the visit. The transaction stays open: the ship is
        // still docked in the client's eyes (see above), and a release
        // that arrives later flushes onto the same hull. One already
        // committed (the spaceport is reused per stellar, so the teardown
        // after a Leave dismisses it too) has nothing left to flush: the
        // hull lifted off with the commit, and writing it again would be
        // exactly the stray write commit() refuses (loudly) — so not here.
        if (this.transaction && !this.transaction.isClosed) {
            this.transaction.flush();
        }
        this.offerPopup.dismiss();
        this.popupBlocker.release();
        this.controls.release();
    }

    /**
     * Opens the star map over the spaceport or over one of its venues
     * (the 'm' key; Menu.onMapKey). The docked entity is out of the
     * display world, so its date, mission marks, control bits (NCB system
     * visibility) and legal records (the Legal Status line) all ride along
     * to the map (#29) — read through the landing's working copy like
     * every docked reader (playerComponent), so a venue's purchases and
     * accepted missions show at once.
     */
    private openDockedMap() {
        void this.openStarmap?.({
            date: this.playerComponent(GameDateComponent),
            missionMarks: this.activeMissionMarks(),
            playerBits: this.playerComponent(ControlBitsComponent),
            legalRecords: this.playerComponent(LegalRecordsComponent),
            // A landed M / N without a Q has moved the player already: the
            // map reads the destination as the Current System while he is
            // still docked here (MEASURED, reference "M / N without Q
            // while landed (ncbops)").
            currentSystemId: this.transaction?.movedToSystem,
        });
    }

    /**
     * The orange active-mission map marks for the docked ship (the
     * entity is out of the display world while docked, so the starmap
     * plugin can't derive these itself).
     */
    private activeMissionMarks(): MissionMapMark[] {
        const missions = this.playerComponent(MissionsComponent);
        if (!missions) {
            return [];
        }
        const bits = this.playerComponent(ControlBitsComponent) ?? new Set();
        return missionMapMarks(missions.values(),
            missionId => this.universe.getMission(missionId),
            planetId => this.universe.systemIdOfPlanet(planetId, bits));
    }

    /**
     * One of the docked player's components as it stands right now: the
     * landing transaction's working copy once it is open
     * (LandedTransaction.playerComponent — what DockedShip.component reads
     * for the status bar and the starmap plugin), the held hull before.
     */
    private playerComponent<T>(component: Component<T>): T | undefined {
        return this.transaction
            ? this.transaction.playerComponent(component)
            : this.input?.components.get(component);
    }

    /**
     * Landing bookkeeping happens before the spaceport is shown: the
     * player's date advances one day, and every active mission is
     * checked against this stellar (completion + payment, deadline
     * failures, travel-leg cargo transfer). The entity is out of the
     * simulation while docked, so mutating its components here is the
     * standard spaceport commit pattern.
     */
    override async show(input: Entity): Promise<Entity> {
        // Own the keyboard immediately, before the landing processing below.
        // That processing awaits the mission universe, which on the very
        // first landing can still be loading (~thousands of resources); until
        // super.show() runs, the spaceport isn't the focused MenuControls
        // layer, so the first docked 'p' (player info) / mission keypress
        // falls through to the in-flight handlers — which can't serve the
        // docked entity (it's out of the world while docked). Binding here
        // makes MenuControls.focused the spaceport from the moment it opens;
        // super.show() re-binds (idempotent) and unbinds on depart. The
        // input is set first so handlers that read it (e.g. 'p' passing the
        // docked entity to player info) work during the gap too.
        this.setInput(input);
        this.controls.bind();
        // Built lazily, on the first landing here (display/
        // spaceport_plugin.ts), so the stellar's data may still be on its
        // way. The VENUE keys read it — which venues exist, the outfitter's
        // and shipyard's tech level — and each stands down until it is in
        // (see showOutfitter and friends); the keys that don't need it
        // ('p', 'm', depart) are live from the first frame, as above.
        // Quick — the stellar has been in the display world all along, so
        // its record is cached — unlike the mission-universe load below.
        await this.buildPromise;
        // THE LANDING'S TRANSACTION: one working copy for the whole visit,
        // seeded from the ship as it touched down and attached to every
        // venue and to the docked handle (the status bar and the save
        // writer read it there). Its landing pass
        // advances the date a day and checks every active mission against
        // this stellar (completion + payment, deadline failures, travel-leg
        // cargo transfer) — on the ship entity, which is out of the
        // simulation while docked.
        let events: MissionEvent[] = [];
        try {
            this.transaction = await LandedTransaction.open(input,
                this.simulationData, this.universe, this.id);
        } catch (e) {
            console.warn('Landing transaction failed to open:', e);
            this.transaction = undefined;
        }
        for (const venue of this.venues) {
            venue.transaction = this.transaction;
        }
        if (this.dockedShip) {
            this.dockedShip.transaction = this.transaction;
        }
        if (this.transaction) {
            // A `Cxxx` / `Exxx` / `Hxxx` in ANY set string the landing
            // runs — a mission's OnSuccess here in the landing pass, its
            // OnAccept at a popup, the bar or the BBS, its OnAbort from the
            // mission-info dialog, an outfit's OnPurchase — swaps the hull
            // through the transaction, and is published here exactly as a
            // shipyard purchase is (see adoptPurchasedShip).
            this.transaction.onShipChanged(
                ship => this.adoptPurchasedShip(ship, 'Changed ship to'));
            // Money from outside the venues (the status bar's debug grant
            // while docked, DockedShip.applyExternalCredits): every
            // readout and afford gate on screen re-reads the balance —
            // the Recharge button here, and whichever venue is open.
            this.transaction.onCreditsChanged(
                () => this.creditsChangedOutside());
            // A landed `Pxxx` plays as its string runs (arpia's mïsn 983
            // OnSuccess `P5000`, under its completion text).
            this.transaction.onSound = sound => void this.playSetStringSound(sound);
            try {
                events = await this.transaction.processLanding();
            } catch (e) {
                console.warn('Mission landing processing failed:', e);
            }
            // Every location's offers are fixed by the touch-down, after
            // the landing pass (#324): a venue opened later in the visit
            // offers nothing an accept made available meanwhile.
            try {
                this.transaction.rollOfferSets();
            } catch (e) {
                console.warn('Landing offer roll failed:', e);
            }
        }
        // The hull the landing pass left the player in (a completion's
        // set string can have changed it).
        input = this.transaction?.ship ?? input;
        // The landing text against the bits the landing pass left.
        this.refreshLandingDesc();
        // An auto-refueller (oütf ModType 19) fills the tank at touch-down,
        // at the port's price, so the Refuel button is gone (reference
        // "The Auto-recharger (E7), wave 39"; spaceport/auto_refuel.ts);
        // short of credits it buys what they pay for (wave 40).
        try {
            if (await hasAutoRefueller(input,
                id => this.simulationData.data.Outfit.get(id))) {
                this.buyFuel(input, true);
            }
        } catch (e) {
            console.warn('Auto-refuel on landing failed:', e);
        }
        this.refreshRefuelButton(input);

        // The spaceport is shown (super.show binds controls + reveals the
        // frame); its returned promise resolves only when the player
        // departs. Before it becomes interactive, the original presents —
        // over the spaceport — any mission completion/failure text and
        // then any main-spaceport (AvailLoc 3) offers, exactly as the
        // bar presents its offers on entry. The blocker holds keyboard
        // focus (and mutes the global map key) while the pointer-only
        // popups are up.
        const result = super.show(input);
        try {
            await this.buildPromise;
            this.controls.unbind();
            this.popupBlocker.bind();
            try {
                await this.presentLandingPopups(input, events);
                // A landing offer's `Hxxx` (stock nova:197, 320, 361, 748)
                // may have swapped the hull: its stat providers finish
                // before the spaceport is interactive.
                await this.shipBuild;
            } finally {
                this.popupBlocker.unbind();
                // Guarded: if the spaceport was departed while the popups
                // were up, an unconditional bind here left its controls
                // focused for the rest of the session — no flying, no
                // hailing, no Escape to the title (#28).
                this.rebindControls();
            }
        } catch (e) {
            console.warn('Spaceport landing popups failed:', e);
        }
        // A completion's `Qxxx` — the main strings' finales, `M472 Q25048`
        // (mïsn nova:686 and its siblings) — or a landing offer's: the
        // popups were the dialog it ran under, and the player leaves now.
        this.departIfAsked();
        return result;
    }

    /**
     * A set string run this visit asked the player to leave the stellar
     * (`Qxxx`, landed_departure.ts): once the dialog it ran under is
     * closed, the spaceport departs through its ordinary Leave — the
     * escort settlements, the commit, the same lift-off and checkpoint.
     * Called wherever the spaceport gets the keyboard back (after the
     * landing popups, after every venue); a no-op otherwise, and while a
     * Leave is already under way.
     */
    private departIfAsked(): void {
        void this.settleSetStrings();
    }

    /**
     * Once the dialog a set string ran under is closed: its `Txxx` names
     * the ship (set_string_requests.ts; the stock OnAccepts of mïsn
     * nova:197, 320, 361, 709 and 748 — "Dart", "Arrow", ... with their
     * change of ship), and then a `Qxxx` departs.
     */
    private async settleSetStrings(): Promise<void> {
        try {
            await this.applyShipNames();
        } catch (e) {
            console.warn('A set string\'s ship name could not be applied:', e);
        }
        const transaction = this.transaction;
        if (!transaction?.mustLeave || transaction.isClosed || this.leaving
            || !this.stillDocked()) {
            return;
        }
        void this.leave();
    }

    /**
     * The visit's `Txxx`s so far: the last one's STR# names the hull the
     * player is in now ("change the name (title) of the player's ship to a
     * string randomly selected from STR# resource ID xxx"). The hull is
     * held out of every world while docked, so the name is written on it
     * directly, as the shipyard's naming prompt writes one, and rides the
     * lift-off's insertion.
     */
    private async applyShipNames(): Promise<void> {
        const transaction = this.transaction;
        if (!transaction || transaction.isClosed) {
            return;
        }
        const picks = transaction.takeShipNames();
        const name = await pickShipName(this.displayAssets, picks);
        if (name === undefined || transaction.isClosed) {
            return;
        }
        const ship = transaction.ship;
        ship.components.set(PlayerNamesComponent, {
            ...ship.components.get(PlayerNamesComponent), ship: name,
        });
    }

    /** Plays a landed `Pxxx` on the UI channel (setUiSoundPlayer). */
    private async playSetStringSound(
        sound: { soundId: number, prefix: string }): Promise<void> {
        const id = await resolveSetStringSound(this.displayAssets, sound);
        if (id) {
            this.uiSoundPlayer?.(id);
        } else {
            console.warn(`Set string P${sound.soundId}: no such sound.`);
        }
    }

    private uiSoundPlayer?: (id: string) => void;

    /** How the spaceport plays a one-shot UI sound (a set string's Pxxx):
     * the display plugin hands it the display world's UI channel. */
    setUiSoundPlayer(play: (id: string) => void): void {
        this.uiSoundPlayer = play;
    }

    /**
     * Takes the spaceport's controls back after a venue or the landing
     * popups — but only while the spaceport is still on screen. Menu.show()
     * hides the container and unbinds the controls the moment Leave fires,
     * and a venue/popup sequence that was still running at that moment
     * used to rebind them unconditionally on its way out, leaving a
     * departed spaceport as MenuControls.focused forever: browser.ts routes
     * every keydown to the focused menu layer, so the ship could not be
     * flown, hailed, or Escaped from until a page reload (review finding
     * #28).
     */
    private rebindControls() {
        if (this.container.visible) {
            this.controls.bind();
        }
    }

    /**
     * The 'p' key on the main screen. Like 'i', the landing's working copy
     * is flushed onto the docked hull first, and Jettison Cargo empties
     * that working copy under a savepoint released at once (the hold, and
     * the missions whose cargo was aboard fail: missions/
     * mission_transitions.ts jettisonDockedCargo). MEASURED: docked, the
     * original dumps the hold as in flight, with no message (reference
     * "Jettison cargo, wave 55" runs 2 and 5). Without a transaction the
     * button stays greyed.
     */
    private async openDockedPlayerInfo() {
        const transaction = this.transaction && !this.transaction.isClosed
            ? this.transaction : undefined;
        transaction?.flush();
        const jettison: PlayerInfoJettison | undefined = transaction
            ? () => {
                if (transaction.isClosed) {
                    return false;
                }
                const visit = transaction.savepoint('jettison');
                try {
                    jettisonDockedCargo(transaction.session.machinery,
                        transaction.outfits);
                } finally {
                    transaction.release(visit);
                }
                return true;
            }
            : undefined;
        await this.openPlayerInfo?.(transaction?.ship ?? this.input, jettison);
    }

    /**
     * The 'i' key on the main screen. The dialog reads the player's state
     * off an entity, so the landing's working copy is flushed onto the
     * docked hull first (accepts and purchases this visit included), and
     * its Abort runs on that working copy under a savepoint released at
     * once — OnAbort, the mission cargo, the removal — so the venues and
     * the lift-off see it like any other edit of this landing. Without a
     * transaction (the landing's data never loaded) Abort stays greyed.
     */
    private async openDockedMissionInfo() {
        const transaction = this.transaction && !this.transaction.isClosed
            ? this.transaction : undefined;
        transaction?.flush();
        const abort: MissionInfoAbort | undefined = transaction
            ? async (missionId: string) => {
                if (transaction.isClosed) {
                    return false;
                }
                const visit = transaction.savepoint('abort');
                try {
                    abortMission(transaction.session.machinery, missionId,
                        transaction.outfits);
                } finally {
                    transaction.release(visit);
                }
                return true;
            }
            : undefined;
        await this.openMissionInfo?.(transaction?.ship ?? this.input, abort);
    }

    /**
     * Hands the keyboard to a venue: false (and nothing opens) unless the
     * spaceport is on screen. The controls are bound before super.show()
     * reveals the frame — from the moment of landing, so 'p'/'m' work while
     * the mission universe loads — and during that gap a venue key used to
     * open its venue INVISIBLY over the landing processing (two sessions
     * committing absolute maps over the same entity), whose exit then
     * rebound the spaceport's controls whether or not it was still docked.
     */
    private enterVenue(): boolean {
        // Nor while a Leave is settling (see leave): the departure would
        // go through with the venue still up.
        if (!this.container.visible || this.leaving) {
            return false;
        }
        this.controls.unbind();
        return true;
    }

    /**
     * Whether a venue's entry offers may still go up, or the venue reopen,
     * after the awaits its entry makes (openVenue: the venue's first frame,
     * the offer popups): a departure hides the container (Menu.show) and a
     * world teardown destroys it (Spaceport.dismiss, then
     * spaceport_plugin's remove) meanwhile. Either way the venue must not
     * open over a spaceport that is gone — it would draw destroyed
     * graphics and take a keyboard nobody gives back (the mid-visit
     * teardown spec) — the same guard rebindControls applies on the way
     * out.
     */
    private stillDocked(): boolean {
        return this.container.visible && !this.container.destroyed;
    }

    /**
     * The on-landing popup sequence, over the already-visible spaceport:
     * first each mission completion/failure text (the completion dësc,
     * per the "_succeed" references; nothing is repeated on the spaceport
     * itself afterwards — the popups ARE the notice), then the
     * main-spaceport (AvailLoc 3) mission
     * offers, each with its custom accept/refuse buttons and continuation
     * pages for long text (the kont-probe reference).
     */
    private async presentLandingPopups(entity: Entity,
        events: MissionEvent[]) {
        // Completion / failure text as popups (the completion dësc),
        // expanded like any other mission text: dësc conditionals against
        // the player's real bits/gender, then wildcards. The event carries
        // no resolved mission shape, so only the identity tags, <PAY>, and
        // the return-stellar tags get real values — and since these popups
        // fire at the planet the player just landed on (the mission's
        // return stop), <RST>/<RSY> resolve to "here".
        // The player's data through the landing's working copy, like every
        // docked reader (playerComponent); the landing pass has just
        // flushed it, so it is also what the hull holds. The bits name
        // the copy of a stacked system that is active for this player
        // (<DSY>/<RSY>, #325).
        const bits = this.playerComponent(ControlBitsComponent)
            ?? entity.components.get(ControlBitsComponent) ?? new Set();
        const ctx = makeDescTextContext(bits, playerGender());
        const identity = await playerIdentitySubs(this.universe,
            entity.components.get(ShipComponent)?.id, undefined,
            this.playerComponent(ActiveRanksComponent)
                ?? entity.components.get(ActiveRanksComponent),
            entity.components.get(PlayerNamesComponent));
        for (const event of events) {
            if (!event.text) {
                continue;
            }
            if (event.type === 'completed' || event.type === 'failed'
                || event.type === 'autoAborted' || event.type === 'shipDone'
                || event.type === 'cargoLoaded'
                || event.type === 'cargoDropped') {
                // Where "here" fits in the mission's shape depends on the
                // event: completion/failure text fires at the mission's
                // RETURN stop, so <RST>/<RSY> mean "here" — but the cargo
                // texts fire at the TRAVEL stop, where "here" is
                // <DST>/<DSY> and the return tags must name the mission's
                // actual return planet (still in the player's active
                // state, since a cargo transfer doesn't end the mission).
                // (A DropOffMode 1 drop fires at the RETURN stop, right
                // before completion, and reads like a completion.)
                const cargoEvent = (event.type === 'cargoLoaded'
                    || event.type === 'cargoDropped')
                    && event.stop !== 'return';
                const active = (this.playerComponent(MissionsComponent)
                    ?? entity.components.get(MissionsComponent))
                    ?.get(event.missionId);
                const here = {
                    stellar: this.universe.planetName(this.id),
                    system: this.universe.systemNameOfPlanet(this.id, bits),
                };
                const text = expandMissionText(event.text, {
                    ...identity,
                    ...(cargoEvent ? {
                        destinationStellar: here.stellar,
                        destinationSystem: here.system,
                        ...(active?.returnPlanet ? {
                            returnStellar: this.universe.planetName(
                                active.returnPlanet),
                            returnSystem: this.universe.systemNameOfPlanet(
                                active.returnPlanet, bits),
                        } : {}),
                    } : {
                        returnStellar: here.stellar,
                        returnSystem: here.system,
                    }),
                    payment: event.payment,
                    // <SN>: carried on the event, since the mission is
                    // already gone from the player's state by the time
                    // its completion/failure text is shown.
                    specialShipName: event.specialShipName,
                }, ctx);
                // Show the result dësc's graphic beside the text when the
                // mission set one (completion/fail/shipDone/brief pict);
                // OfferPopup falls back to the plain briefing frame when
                // pict is absent.
                await this.offerPopup.show(text, { accept: POPUP_OKAY },
                    { pict: event.pict, style: 'briefing' });
            }
        }

        // Main-spaceport mission offers, on the landing's transaction: the
        // (post-landing) working copy rolls them and, on accept, holds the
        // mission — released below, so it is on the entity before any
        // venue opens.
        const transaction = this.transaction;
        // A completion's `Qxxx` (landed_departure.ts): the player leaves
        // after its text, and nothing further is put to them.
        if (!transaction || transaction.mustLeave) {
            return;
        }
        const session = transaction.session;
        // The system visit's rolls (mission_offers.ts OfferRolls): a
        // second landing in this system sees the same AvailRandom answers.
        const rolls = transaction.offerRolls;
        // The visit's set (landingOffers, #324), like every location's.
        const offers = landingOffers(transaction.offerSets, session,
            this.universe, LOCATION_MAIN_SPACEPORT, rolls)
            .filter(offer => offer.acceptable);
        if (offers.length === 0) {
            return;
        }
        const visit = transaction.savepoint('landing offers');
        try {
            await presentOffers(this.offerPopup, session, this.universe,
                offers, rolls);
        } finally {
            // RELEASED WHATEVER HAPPENS. presentOffers awaits a popup per
            // offer, and every accept has already mutated the working copy
            // by the time the NEXT offer's text is expanded — so a throw
            // anywhere down that loop (a missing dësc, a PIXI failure) used
            // to drop the whole visit on the floor, mission and all, with
            // show()'s outer catch swallowing the error. The player had
            // accepted; the mission simply vanished.
            //
            // Releasing early is harmless in the other direction: a throw
            // BEFORE any acceptance leaves the working copy identical to
            // the entity (presentOffers reaches its first await before it
            // touches anything, and only acceptOffer/refuseOffer write),
            // so the flush writes back equal values and advances no date.
            // A throw from INSIDE acceptOffer's own set string is the one
            // genuinely half-mutated case, and there releasing is still
            // right — it is the same "the visit is the unit of work" rule
            // the bar follows, where the visit is released at Leave
            // however the offer sequence ended.
            //
            // The release flushes the credits as a DELTA, like every
            // venue's: the offer popups above await the player, and the
            // refuel button (and a Leave pressed under a blind popup, whose
            // escort settlement goes through the same transaction) can move
            // the balance meanwhile. See spaceport/credit_commit.ts.
            transaction.release(visit);
        }
    }

    /**
     * Opens a venue that makes mission offers as the player walks in (mïsn
     * AvailLoc 4 trading, 5 shipyard, 6 outfitter), and resolves with the
     * entity it closes on, as the venue's own show() does.
     *
     * THE OFFERS GO UP OVER THE VENUE, once its screen has been drawn
     * (Matthew's 2026-11-26 playtest ruling: "shipyard mission offer should
     * appear after the shipyard screen renders"). They used to be put to
     * the player over the spaceport, before the venue opened at all.
     *
     * So the venue opens first, and the offers wait for its `shown` (an
     * async show() — the trade center's, the outfitter's — gets there a few
     * awaits after the call) and then for its first frame
     * (afterNextRender). The popup blocker is bound in the same step the
     * venue goes up, so no key reaches the venue under the popups.
     *
     * AN ANSWERED OFFER REOPENS THE VENUE. The venue built its view from
     * the working copy as it stood at entry; an accept can move any of it
     * — bits that open or close grid entries (the Sigma string), the hold
     * (PickupMode 0 cargo), credits, a `Gxxx` outfit, the hull itself (an
     * `Hxxx`, stock nova:709). Rather than teach each venue to re-read all
     * of that, the untouched first visit (nothing could be done in it: the
     * keyboard was blocked and the popup shields the pointer) is closed —
     * its savepoint released, the offers' nested in it — and the venue
     * reopened on the spaceport's current hull, through exactly the entry
     * it always had after the offers. Both happen between two frames, so
     * the player sees the venue stay up. `beforeOpen` runs before each
     * open (the outfitter's purchase baseline).
     *
     * A venue whose show() gives up before it goes up (a failed load) still
     * has its offers put, over the spaceport, as before.
     */
    private async openVenue(venue: Menu<Entity>, location: number,
        beforeOpen?: () => void): Promise<Entity> {
        let settle!: (shown: boolean) => void;
        const shownOrClosed = new Promise<boolean>(resolve => {
            settle = resolve;
        });
        // Subscribed before show(): the shipyard's goes up synchronously.
        const subscription = venue.shown.subscribe(() => settle(true));
        beforeOpen?.();
        let visit = venue.show(this.input);
        visit.then(() => settle(false), () => settle(false));
        const shown = await shownOrClosed;
        subscription.unsubscribe();
        const presented = await this.presentVenueOffers(location,
            shown ? venue : undefined);
        if (this.transaction?.mustLeave) {
            // An entry offer's `Qxxx`: the venue closes behind its dialog
            // and the spaceport departs (departIfAsked, in the caller).
            if (shown && venue.container.visible) {
                venue.dismiss();
            }
            return visit;
        }
        if (presented && shown && this.stillDocked()
            && venue.container.visible) {
            venue.dismiss();
            await visit;
            if (this.stillDocked()) {
                beforeOpen?.();
                visit = venue.show(this.input);
            }
        }
        return visit;
    }

    /**
     * How {@link openVenue} waits for a venue's first frame. A seam: the
     * specs, which have no renderer, hold it or release it at will.
     */
    private venueDrawn: (container: PIXI.Container) => Promise<void> =
        container => afterNextRender(container);

    /**
     * The venue-entry mission offers (mïsn AvailLoc 4 trading, 5 shipyard,
     * 6 outfitter; see venue_offers.ts), put to the player over `venue`
     * once it has been drawn — or over the spaceport when there is no venue
     * on screen to wait for. Resolves true when offers were put (see
     * openVenue: the venue is then reopened). The blocker holds the
     * keyboard while the pointer-only popups are up, as the landing
     * sequence's does — bound only when there is something to offer, so a
     * venue with nothing to offer is interactive at once. The rolls are the
     * system visit's (mission_offers.ts OfferRolls), shared with the bar
     * and the BBS.
     */
    private async presentVenueOffers(location: number,
        venue?: Menu<Entity>): Promise<boolean> {
        const transaction = this.transaction;
        if (!transaction) {
            return false;
        }
        let asked = false;
        let bound = false;
        try {
            await presentVenueOffersIn(transaction, this.offerPopup,
                location, undefined, async () => {
                    this.popupBlocker.bind();
                    bound = true;
                    if (venue) {
                        await this.venueDrawn(venue.container);
                        // Left or torn down while it drew: no offers over
                        // a venue that is gone.
                        if (!venue.container.visible) {
                            return false;
                        }
                    }
                    asked = this.stillDocked();
                    return asked;
                });
            // A shipyard offer's `Hxxx` (stock nova:709) may have swapped
            // the hull the venue is about to reopen on.
            await this.shipBuild;
        } catch (e) {
            console.warn('Venue mission offers failed:', e);
        } finally {
            if (bound) {
                this.popupBlocker.unbind();
            }
        }
        return asked;
    }

    /**
     * Announces an outfitter visit's net purchases/sales as a pilot-history
     * checkpoint ("Bought Battery Pack ×3; Sold Blaster ×1"), comparing
     * the docked ship's outfits before and after the visit. Nothing is
     * announced for a browse that bought nothing. Outfit names come from
     * the warm cache (the outfitter just displayed them); an unloaded one
     * falls back to its id.
     */
    private announcePurchases(before: [string, number][]) {
        const label = describeOutfitChanges(before, outfitCounts(this.input),
            id => this.simulationData.data.Outfit.getCached(id)?.name);
        if (label) {
            requestCheckpoint({
                label, kind: 'purchase', entity: this.input, stellar: this.id,
            });
        }
    }

    /**
     * ADOPTS A SHIP BOUGHT AT THE SHIPYARD (or changed by an outfit's set
     * string), the moment the Buy button is pressed — the one place the
     * docked hull the SPACEPORT holds is replaced. The venue has already
     * handed the hull to the transaction (LandedTransaction's
     * adoptPurchasedShip / adoptChangedShip, which is where the working
     * copy follows it); this is the UI's half.
     *
     * A purchase does not mutate the docked entity: `buildPurchasedShip`
     * charges the trade-up price and returns a WHOLE NEW entity carrying
     * the player's credits, cargo, missions, ranks, records and pending
     * escorts across. Until this ran at Leave, the client kept holding the
     * traded-in hull for the rest of the visit, and everything that writes
     * to the docked entity between the trade and the lift-off wrote into a
     * ship nobody would ever fly:
     *
     *  - THE ESCORT DEALS SETTLING AT LEAVE. Queued upgrades and sales are
     *    paid into the landing's ledger as the player departs
     *    (spaceport/escort_deals.ts), after any trade. A 40,000-credit sale
     *    used to be paid into the old hull and vanish at lift-off — the
     *    escort was gone from the roster all the same.
     *  - EVERY OTHER DOCKED READER. The status bar's docked readouts, the
     *    player-info 'p' dialog, the mission-info dialog, the periodic save
     *    and the checkpoint writer all resolve the docked ship through the
     *    same handles this updates, and so all showed the traded-in ship's
     *    credits, cargo and stats.
     *
     * NOTHING IS COPIED HERE: buildPurchasedShip has already moved the
     * player-scoped state onto the new entity (see CARRIED_COMPONENTS), so
     * the swap really is just the reference. The one thing that is still
     * catching up is the new hull's DERIVED stats — physics, weapons,
     * shield/armor/fuel — which the outfit providers fill in through
     * `runShipBuildWorld`. That is deliberately not awaited before the
     * publish: the money must move to the new hull at the instant of the
     * trade, whereas a stats readout that lags by one build is cosmetic.
     * `shipBuild` is what the shipyard visit awaits before handing control
     * back, so the spaceport is never interactive over a half-built ship.
     *
     * Multiplayer/determinism: all of this is client-local. The docked
     * entity is out of every world (the sim removed it at landing) and
     * re-enters only as the lift-off's `addEntity` record, so no peer sees
     * either hull until then.
     */
    private adoptPurchasedShip(ship: Entity, verb = 'Bought') {
        this.input = ship;
        // The client's handle on the docked ship — the status bar and the
        // save writer read it.
        this.dockedShip?.swapEntity(ship);
        // A ship purchase is a checkpoint (pilot_history.ts). The NEW
        // entity is passed explicitly rather than left to the recorder's
        // own lookup, so the snapshot is the ship just bought even if the
        // client keeps no docked handle at all.
        const shipId = ship.components.get(ShipComponent)?.id;
        const name = shipId
            ? this.simulationData.data.Ship.getCached(shipId)?.name
                ?.split(';')[0].trim() ?? shipId
            : 'a ship';
        requestCheckpoint({
            label: `${verb} ${name}`, kind: 'purchase',
            entity: ship, stellar: this.id,
        });
        // Construct a fake system and run providers so that outfits of the
        // new ship are provided (see ship_build_world.ts — extracted so a
        // spec pins that the scratch world's resource set stays sufficient
        // for SystemPlugin). Kept as a promise the shipyard visit awaits:
        // a rejection must not strand the spaceport with its controls
        // unbound, which is what an unguarded throw here used to do.
        this.shipBuild = runShipBuildWorld(ship, this.simulationData,
            this.displayAssets).catch(e =>
                console.warn('Failed to build the purchased ship:', e));
    }

    /**
     * The in-flight stat rebuild for the most recently purchased hull (see
     * adoptPurchasedShip). Awaited before the spaceport takes its controls
     * back, so a second purchase in the same visit simply replaces it.
     */
    private shipBuild?: Promise<void>;

    /** Points the status bar at the docked ship for this landing. */
    setDockedShip(dockedShip: DockedShip) {
        this.dockedShip = dockedShip;
    }

    /**
     * Tells the outfit-trading venues which owned outfits are NOT aboard
     * for this landing — bay fighters still in flight or landed as escorts
     * (see spaceport/deployed_outfits.ts). Set per-landing, like
     * setDockedShip, because it closes over the docked ship's uuid.
     * Left unset, both venues assume everything owned is aboard.
     *
     * The SHIPYARD needs it too: a trade-in hands over the hull with its
     * bays, so it refuses to sell while a fighter is out (shipyard_rules
     * judgment call 8) exactly as the outfitter refuses to sell the bay.
     */
    setDeployedOutfitCounts(counts?: DeployedOutfitCounts) {
        this.deployedOutfitCounts = counts;
        this.outfitter?.setDeployedOutfitCounts(counts);
        this.shipyard?.setDeployedOutfitCounts(counts);
    }

    /**
     * Points the trade center at the client's landed-escort roster, so
     * cargo-carrying escorts (shïp InherentAI 1/2) contribute their holds
     * to the exchange's fleet cargo space (spaceport/fleet_cargo.ts). Set
     * per-landing, like setDeployedOutfitCounts, because it closes over
     * the docked ship's uuid.
     */
    setLandedEscorts(roster?: () => EscortDealEntry[],
        playerUuid?: string, world?: Iterable<[string, Entity]>) {
        this.landedEscortSettings = [roster, playerUuid, world];
        this.tradeCenter?.setLandedEscorts(roster, playerUuid);
        // ...and the bar, whose hire dialog counts the fleet against the
        // escort cap (nova_plugin/escorts/escort_cap.ts) — from the roster AND
        // the display world, where the escorts still on approach are.
        this.bar?.setLandedEscorts(roster, playerUuid, world);
        // ...and the shipyard, whose hangar swaps with, stores and assigns
        // captured escorts on the roster (ship storage), under the same cap.
        this.shipyard?.setLandedEscorts(roster, playerUuid, world);
        // ...and the Leave, which settles the deals queued against the
        // roster's escorts as the player departs (leave). The roster is
        // the client's own array, MUTATED by a settled sale (the escort
        // is spliced off so it does not lift off).
        this.landedRoster = roster;
        this.playerUuid = playerUuid;
    }

    /**
     * Routes an open venue's live working state to the status bar (or clears
     * it, so the bar falls back to the docked entity's own components). A
     * venue's `dockedStatus()` reads its working copy, so the credits/cargo
     * readouts follow each transaction before Done commits it.
     */
    private setLiveStatus(source?: () => DockedLiveStatus) {
        if (this.dockedShip) {
            this.dockedShip.liveStatus = source;
        }
    }

    /**
     * Re-evaluates the Refuel button's visibility (hidden when the tank
     * is full) and greyed state (when the fill is unaffordable). The
     * original's spaceport shows no persistent credits/date line here, so
     * this no longer draws any text — it only drives the button.
     */
    private refreshRefuelButton(input?: Entity) {
        const entity = input ?? this.input;
        if (!entity) {
            return;
        }
        this.updateRefuelButton(entity);
    }

    /** See the onCreditsChanged subscription in the landing's setup. */
    private creditsChangedOutside() {
        this.refreshRefuelButton();
        this.outfitter?.creditsChanged();
        this.shipyard?.creditsChanged();
        this.tradeCenter?.creditsChanged();
        this.bar?.creditsChanged();
    }

    /** Hidden when fuel is full; greyed when unaffordable. */
    private updateRefuelButton(entity: Entity) {
        const button = this.buttons.refuel;
        const fuel = entity.components.get(FuelComponent);
        if (!fuel || fuel.current >= fuel.max) {
            button.container.visible = false;
            return;
        }
        button.container.visible = true;
        const credits = entity.components.get(CreditsComponent);
        button.state = credits && credits.credits >= refuelCost(fuel)
            ? 'normal' : 'grey';
    }

    private refuel() {
        const entity = this.input;
        if (!entity) {
            return;
        }
        this.buyFuel(entity, false);
        this.refreshRefuelButton();
    }

    /** Fills the tank at the port's price when it is not full and the
     * fill is affordable (the Refuel button's purchase). With `partial`
     * (the auto-refueller at touch-down) a fill the credits fall short of
     * buys as much as they pay for instead (autoRefuelPurchase). */
    private buyFuel(entity: Entity, partial: boolean) {
        const fuel = entity.components.get(FuelComponent);
        const credits = entity.components.get(CreditsComponent);
        // Re-check rather than trusting button state: clicking flips a
        // Button to 'clicked'/'normal' regardless of greying.
        if (!fuel || fuel.current >= fuel.max || !credits) {
            return;
        }
        const purchase = partial
            ? autoRefuelPurchase(fuel, credits.credits)
            : { units: fuel.max - fuel.current, cost: refuelCost(fuel) };
        const cost = purchase.cost;
        if (purchase.units <= 0 || credits.credits < cost) {
            return;
        }
        // A writer outside the venues: through the landing's ledger, so
        // the working balance, the live component and the sync point move
        // together (landed_transaction.ts's applyExternalCredits). Before
        // the transaction exists (the landing gap, while the venue keys are
        // dead but this one is live) the entity is written directly, and
        // the transaction seeds from it.
        if (this.transaction) {
            this.transaction.applyExternalCredits(-cost);
        } else {
            credits.credits -= cost;
        }
        // Fuel is not part of the working copy (nothing a venue does while
        // docked changes it), so the entity is the one place it lives.
        fuel.current = purchase.units >= fuel.max - fuel.current
            ? fuel.max : fuel.current + purchase.units;
    }

    /**
     * Expands the stellar's landing description against the docked
     * player's control bits (the landing's working copy once it is open)
     * and the pilot's gender. Before the first landing there are no bits:
     * every bit test reads clear.
     */
    private refreshLandingDesc() {
        if (!this.landingDesc || !this.data) {
            return;
        }
        const bits = this.playerComponent(ControlBitsComponent) ?? new Set<number>();
        this.landingDesc.text = resolveConditionalBlocks(this.data.landingDesc,
            makeDescTextContext(bits, playerGender()));
    }

    override async build() {
        await super.build();
        const data = await this.simulationData.data.Planet.get(this.id);
        this.data = data;
        // The jünks are loaded only where they can decide the Trade Center
        // (a flagged port with no commodity tier: stellarHasTradeCenter).
        const junks = stellarNeedsJunksForTrade(data)
            ? await loadEachOrSkip('Spaceport', 'junk',
                (await this.simulationData.ids).Junk,
                id => this.simulationData.data.Junk.get(id))
            : [];
        const hasTradeCenter = stellarHasTradeCenter(data, junks);
        this.buildVenues(data, hasTradeCenter);
        const title = new PIXI.Text(displayName(data.name), this.font.title);
        title.anchor.x = 0.5;
        // "Earth"'s ink spans x940..982 on the R8 wave-5 capture
        // (02-spaceport.png), centred on x961; at -2 ours centred on 957.5.
        title.position.x = 1;
        title.position.y = 39;
        this.container.addChild(title);

        // Landing descriptions may carry dësc conditionals (e.g. the {G}
        // gender text in stellar 472). The spaceport is built once per
        // stellar and reused, so the text is expanded again on every
        // landing (refreshLandingDesc) against that landing's control bits:
        // the original's landing text reads the player's real bits
        // (reference "dësc test operators, wave 54").
        const desc = new PIXI.Text('', this.font.desc);
        desc.position.x = -149;
        desc.position.y = 70;
        this.container.addChild(desc);
        this.landingDesc = desc;
        this.refreshLandingDesc();


        // Venue buttons only appear where the stellar offers the
        // service (spöb flags), hidden in their fixed slots (reference
        // "Spaceport venue buttons (K6, #373), wave 36", finding 1); the
        // Trade Center needs something to trade as well (finding 2).
        if (!data.flags.hasBar) {
            this.buttons.bar.container.visible = false;
        }
        if (!hasTradeCenter) {
            this.buttons.tradeCenter.container.visible = false;
        }
        if (!data.flags.hasOutfitter) {
            this.buttons.outfitter.container.visible = false;
        }
        if (!data.flags.hasShipyard) {
            this.buttons.shipyard.container.visible = false;
        }

        const spaceportPict = this.displayAssets.spriteFromPict(data.landingPict)
        spaceportPict.position.x = -306;
        spaceportPict.position.y = -256;
        this.container.addChild(spaceportPict)
        for (const venue of [this.outfitter, this.shipyard, this.tradeCenter,
            this.missionComputer, this.bar]) {
            if (venue) {
                this.container.addChild(venue.container);
            }
        }
        // The landing popups render over everything else on the spaceport.
        this.container.addChild(this.offerPopup.container);
    }

    /**
     * Builds the facility venues this stellar has (#373) — and only those:
     * a venue's construction is what loads its art and data, so a
     * facility the stellar lacks costs the landing nothing. Runs once,
     * from build(), with the stellar's data and whether it has a Trade
     * Center (stellarHasTradeCenter: the 0x02 flag and a price tier).
     */
    private buildVenues(data: PlanetData, hasTradeCenter: boolean) {
        const { displayAssets, simulationData } = this;
        const controlEvents = this.venueControlEvents;
        if (data.flags.hasOutfitter) {
            this.outfitter = new Outfitter(displayAssets, simulationData,
                controlEvents);
            // The outfitter stocks by this stellar's tech level /
            // SpecialTech and honours its "buys anything" flag (see
            // outfitter_rules.ts).
            this.outfitter.setPlanet(data);
        }
        if (data.flags.hasShipyard) {
            this.shipyard = new Shipyard(displayAssets, simulationData,
                controlEvents);
            // A purchase announces itself AT THE CLICK, not at the
            // shipyard's exit — see adoptPurchasedShip.
            // The hangar's swaps (ship storage) come the same way, with
            // their own checkpoint wording.
            this.shipyard.onShipPurchased =
                (ship, verb) => this.adoptPurchasedShip(ship, verb);
            // The shipyard stocks ships by the same tech level /
            // SpecialTech (see shipyard_stock_rules.ts) and rolls the
            // per-day BuyRandom pool against this stellar's id. govt is
            // not a stock gate; it is what a ränk PriceMod is matched
            // against (price_mod.ts).
            this.shipyard.setPlanet(
                {
                    techLevel: data.techLevel, specialTech: data.specialTech,
                    govt: data.govt,
                },
                this.id);
        }
        if (data.flags.hasBar) {
            this.bar = new Bar(displayAssets, simulationData, controlEvents,
                this.universe, this.id);
        }
        if (hasTradeCenter) {
            this.tradeCenter = new TradeCenter(displayAssets, simulationData,
                controlEvents, this.id);
        }
        // 'm' opens the star map over each venue as over the spaceport
        // (the BBS opens its own, with the selected listing's marks).
        for (const venue of [this.outfitter, this.shipyard, this.bar,
            this.tradeCenter]) {
            if (venue) {
                venue.onMapKey = () => this.openDockedMap();
            }
        }
        // The landing's settings may have arrived before the stellar's
        // data (the first landing here): hand them on.
        if (this.deployedOutfitCounts) {
            this.setDeployedOutfitCounts(this.deployedOutfitCounts);
        }
        if (this.landedEscortSettings) {
            this.setLandedEscorts(...this.landedEscortSettings);
        }
    }

    /**
     * LEAVE, from the button or the 'depart' key: first the escort deals
     * the player queued over the comm channel are SETTLED (Matthew's
     * ruling #249/#253 — as the player departs, from any spaceport, if
     * funds suffice), then the landing day's escort WAGES are paid, and an
     * escort the player cannot pay defects (escort_wages.ts; reference
     * "Escort wages (R12), wave 37"). If anything settled, a dialog says how
     * many escorts were upgraded and how many sold and for how much; if an
     * escort defected, "Due to lack of pay, one of your escorts has
     * defected." follows (the original's, at Leave, with an Okay). Only
     * once the player closes them does {@link done} commit the landing and
     * resolve show(). The client answers that resolution with the
     * lift-off's insertion records, so nothing is in space until the
     * dialog is closed; a deal the working balance cannot cover stays
     * queued and rides on, unreported.
     *
     * Re-entrant presses are dropped while a Leave is in flight (the
     * settlement awaits the upgrade targets' data, and the dialog awaits
     * the player), the spaceport's own keys are given up for the whole
     * Leave so a second 'depart' closes the dialog rather than leaving
     * again and no venue opens under the departure, and a
     * spaceport torn down under the dialog (exit to title) leaves nothing
     * to depart: done() is not called, exactly as dismiss() does not.
     */
    private async leave() {
        if (this.leaving) {
            return;
        }
        this.leaving = true;
        // The keyboard is the Leave's from here on: the settlement awaits
        // the upgrade targets' data, and a venue or overlay key pressed
        // meanwhile would open over a spaceport that is about to depart,
        // still bound when the ship flew off.
        this.controls.unbind();
        this.popupBlocker.bind();
        try {
            let reports: (string | undefined)[] = [];
            try {
                reports.push(await this.settleEscortDealsAtLiftOff());
            } catch (e) {
                console.warn('Escort deals failed to settle at lift-off:', e);
            }
            // The landing day's tribute comes in before its wages go out
            // (GUESS on the order: the original advances the date at the
            // Leave and pays both there).
            this.settleTributeAtLiftOff();
            reports.push(this.settleEscortWagesAtLiftOff());
            reports = reports.filter(report => report !== undefined);
            for (const report of reports) {
                if (!this.stillDocked()) {
                    break;
                }
                await this.offerPopup.show(report!, { accept: POPUP_OKAY },
                    { style: 'briefing' });
            }
        } catch (e) {
            console.warn('Escort settlement failed at lift-off:', e);
        }
        try {
            this.liftOffDeparture = await this.buildLiftOffDeparture();
        } catch (e) {
            console.warn('The visit\'s departure request failed to build; '
                + 'lifting off here:', e);
            this.liftOffDeparture = undefined;
        } finally {
            this.popupBlocker.unbind();
            this.leaving = false;
        }
        if (!this.alive) {
            return;
        }
        // Nothing of the visit may outlive the departure on the focus
        // stack, or the ship cannot be flown. The main-screen gate keeps a
        // venue from being open here at all (onMainScreenClick, and the
        // focus stack for the keys); should one be, it is closed first —
        // its done() releases its visit onto the transaction synchronously,
        // before the commit below — rather than left holding the keyboard.
        // Only one that is up: a shipyard's dismiss releases its hangar's
        // keys for good (a teardown's), and the spaceport is reused at the
        // next landing here.
        for (const venue of this.venues) {
            if (venue.container.visible) {
                venue.dismiss();
            }
        }
        this.done();
    }

    /**
     * What this visit's set strings asked of the lift-off
     * (landed_departure.ts), in the form the client acts on: the move,
     * and each `Qxxx`'s message picked from its STR# and expanded. The
     * Bible: the message "is parsed for mission text tags (e.g. <PSN> and
     * <PRK>) but not text-selection tags like those above (e.g. {G "he"
     * "she"})" — so the identity tags are expanded and no dësc
     * conditional is resolved. Undefined when nothing was asked.
     */
    private async buildLiftOffDeparture(): Promise<PendingDeparture | undefined> {
        // A `Txxx` the Leave caught before its dialog's settle did.
        await this.applyShipNames();
        const transaction = this.transaction;
        if (!transaction || transaction.isClosed
            || !departureRequested(transaction.departure)) {
            return undefined;
        }
        const { move, quotes } = transaction.departure;
        const statusMessages: string[] = [];
        if (quotes.length > 0) {
            const ship = transaction.ship;
            const identity = await playerIdentitySubs(this.universe,
                ship.components.get(ShipComponent)?.id, undefined,
                this.playerComponent(ActiveRanksComponent),
                ship.components.get(PlayerNamesComponent));
            for (const { stringId, prefix } of quotes) {
                const line = await statusQuoteLine(this.displayAssets,
                    stringId, prefix);
                const text = line === undefined ? ''
                    : expandMissionText(line, identity).trim();
                if (text) {
                    statusMessages.push(text);
                }
            }
        }
        return { ...(move ? { move: { ...move } } : {}), statusMessages };
    }

    /**
     * The lift-off settlement (escort_deals.ts has the rules), through
     * the landing's transaction: loads the classes the queued upgrades
     * need, settles against the working balance, logs, and returns the
     * dialog text — undefined when nothing settled, or when there is no
     * transaction or roster to settle over (the deals then simply stay
     * queued). The spaceport may have been torn down during the load; the
     * deals stay queued then too, for the next departure.
     */
    private async settleEscortDealsAtLiftOff(): Promise<string | undefined> {
        const transaction = this.transaction;
        const roster = this.landedRoster?.();
        const player = this.playerUuid;
        if (!transaction || transaction.isClosed || !roster || !player) {
            return undefined;
        }
        // The target classes have to be BUILT to refit against, and the
        // settlement itself is synchronous (it mutates the roster the
        // client's frame loop owns), so they are loaded first.
        await Promise.all(queuedUpgradeTargets(roster, player)
            .map(id => this.simulationData.data.Ship.get(id)
                .catch(() => undefined)));
        if (!this.alive || transaction.isClosed) {
            return undefined;
        }
        const settled = transaction.settleEscortDeals(roster, player,
            id => this.simulationData.data.Ship.getCached(id));
        for (const sale of settled.sold) {
            console.log(`Escort ${sale.uuid} sold off for ${sale.value} `
                + 'credits on departure.');
        }
        for (const upgrade of settled.upgraded) {
            console.log(`Escort ${upgrade.uuid} upgraded to ${upgrade.toShip} `
                + `at a cost of ${upgrade.cost} credits on departure.`);
        }
        return escortSettlementReport(settled);
    }

    /**
     * The landing day's TRIBUTE at lift-off (landed_transaction.ts's
     * settleTribute): every dominated stellar pays its day, from the
     * mission universe's planet data (loaded with the landing). Nothing
     * without a transaction.
     */
    private settleTributeAtLiftOff(): void {
        const transaction = this.transaction;
        if (!this.alive || !transaction || transaction.isClosed) {
            return;
        }
        const paid = transaction.settleTribute(
            id => this.universe.getPlanet(id));
        if (paid > 0) {
            console.log(`Tribute of ${paid} credits paid on departure.`);
        }
    }

    /**
     * The landing day's escort wages at lift-off (escort_wages.ts has the
     * rules), through the landing's transaction, after the deals: returns
     * the defection message, or undefined when everyone was paid (or there
     * is no transaction or roster: nothing is charged then).
     */
    private settleEscortWagesAtLiftOff(): string | undefined {
        const transaction = this.transaction;
        const roster = this.landedRoster?.();
        const player = this.playerUuid;
        if (!this.alive || !transaction || transaction.isClosed || !roster
            || !player) {
            return undefined;
        }
        const settled = transaction.settleEscortWages(roster, player);
        for (const gone of settled.defected) {
            console.log(`Escort ${gone.uuid} defected on departure for lack `
                + `of pay (${gone.wage} credits owed).`);
        }
        return escortWageReport(settled);
    }

    /**
     * THE COMMIT, reached from {@link leave}. The landing's working copy
     * lands on the hull — once — and that hull is what LeaveSpaceportEvent
     * carries to the client's lift-off, which encodes it into the
     * insertion record every peer applies. Then the pad's own effects:
     * parked on the stellar, repaired, de-ionized.
     */
    protected override done() {
        if (this.transaction) {
            this.input = this.transaction.commit();
        }
        const departure = this.liftOffDeparture;
        this.liftOffDeparture = undefined;
        if (departure) {
            this.input.components.set(PendingDepartureComponent, departure);
        } else {
            this.input.components.delete(PendingDepartureComponent);
        }
        if (this.data) {
            const movement = this.input.components.get(MovementStateComponent);
            if (movement) {
                movement.position = new Position(...this.data.position);
                movement.velocity = new Vector(0, 0);
            }
            const shield = this.input.components.get(ShieldComponent);
            if (shield) {
                shield.current = shield.max;
            }
            const armor = this.input.components.get(ArmorComponent);
            if (armor) {
                armor.current = armor.max;
            }
            const ionization = this.input.components.get(IonizationComponent);
            if (ionization) {
                ionization.current = 0;
            }
        }
        super.done();
    }
}
