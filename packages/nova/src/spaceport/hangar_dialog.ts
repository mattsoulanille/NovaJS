import { ShipData } from 'novadatainterface/ship_data';
import {
    ShipAccelerationConversionFactor, ShipSpeedConversionFactor,
} from 'novaparse/parsers/constants';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent, displayName } from '../nova_plugin/core/index.js';
import {
    cappedEscortCount, CarriedEscortEntry, MAX_ESCORTS,
} from '../nova_plugin/escorts/index.js';
import { StoredShip } from '../nova_plugin/player/index.js';
import {
    cargoUsed, deriveShipPhysics, FUEL_PER_JUMP, OutfitsState,
    OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { v4 } from 'uuid';
import { Button } from './button.js';
import { requestCheckpoint } from './checkpoint_requests.js';
import { PendingEscortsComponent } from './pending_escorts.js';
import { HIRE } from './dialog_layout.js';
import { HIRE_DIALOG_PICT } from './hire_escort.js';
import { ItemGrid, ItemTile } from './item_grid.js';
import { MenuControls } from './menu_controls.js';
import { FONT } from './outfitter.js';
import { ScrollArrow } from './scroll_arrow.js';
import {
    escortToStorage, escortWingOut, snapshotHull, STORAGE_REFUSAL_TEXT,
    StorageLookups, StorageRefusal, storableEscort, storedShipsOf,
    storedToEscort, swapWithEscort, swapWithStored,
} from './ship_storage.js';

/**
 * ============================================================================
 * The shipyard's hangar: "Your Ships" (ship storage, docs/ship_storage.md)
 * ============================================================================
 *
 * Opened from the shipyard's Your Ships button. On the hire dialog's frame
 * (PICT 8501, the shop frame with the small price pane) and in the
 * shipyard's own layout: the ships in a tile grid on the left, the selected
 * ship's figures in the description pane, its picture top right, its
 * whereabouts in the pane below. The tiles are captioned like the
 * shipyard's, with the grey second line the original uses for "- used -"
 * saying where each ship is: "- flying -", "- stored -", "- escort -".
 * The escorts are the CAPTURED ones that have landed with the player (on
 * the client's landed roster): a hired pilot's ship was never the
 * player's, and an escort still flying down to the pad is not here yet.
 *
 * Every button is one storage operation (ship_storage.ts), done at the
 * click and handed to the shipyard (HangarContext.adoptHull), which adopts
 * a new hull exactly as it adopts a purchase. There is no Cancel: like the
 * shipyard's Buy, each press is the transaction.
 */

/** What a tile stands for. */
export type HangarEntryKind = 'current' | 'stored' | 'escort';

/** One tile: the ItemGrid fields plus what it stands for. */
export interface HangarEntry {
    /** Unique per grid build (the grid is rebuilt on every change). */
    id: string;
    name: string;
    shortName: string;
    desc: string;
    pict: string;
    kind: HangarEntryKind;
    /** The record, for a stored ship. */
    stored?: StoredShip;
    /** Its index in the pilot's list, for a stored ship. */
    index?: number;
    /** Its landed-roster uuid, for an escort. */
    uuid?: string;
    /** The hull's class id. */
    shipId: string;
}

/**
 * Everything the hangar needs from the shipyard that opened it. The hull is
 * read through `hull()` every time — after a swap it is the new one.
 */
export interface HangarContext {
    /** The docked hull right now. */
    hull(): Entity;
    /** The docked stellar's global id: where a ship put away is stored. */
    stellarId: string;
    /**
     * Whether any of the player's own bay fighters are out (deployed or
     * landed as escorts): nothing may take the hull away from them then
     * (shipyard_rules judgment call 8).
     */
    fightersOut(): boolean;
    /** Hands a NEW hull to the shipyard, which adopts it like a purchase. */
    adoptHull(hull: Entity, label: string): void;
    /**
     * The client's landed-escort roster — the live array, which the escort
     * operations edit in place (as the lift-off's deal settlement does) —
     * and the docked player's uuid its entries are filed under. Absent (a
     * shipyard shown without a landing): the hangar lists no escorts.
     */
    roster?(): CarriedEscortEntry[];
    playerUuid?: string;
    /** The display world, where escorts still on approach are. */
    world?(): Iterable<[string, Entity]>;
    /** Mints the roster uuid of an escort out of storage (default v4). */
    mintUuid?(): string;
}

/** A caption's first line: the ship's ShortName without its subtitle. */
function captionName(ship: ShipData | undefined, fallback: string): string {
    const short = ship?.shortName?.split(/\\n|\n/)[0]?.trim();
    return short || (ship ? displayName(ship.name) : fallback);
}

/** A whole-number readout. */
function n(value: number): string {
    return Math.round(value).toLocaleString();
}

/**
 * The description pane's text for a ship: its name, where it is, and its
 * key figures with its outfits fitted, then the outfits themselves. Pure
 * over the cached game data, so the specs pin it without PIXI.
 */
export function hangarDescription(entry: {
    name: string, where: string, shipId: string,
    outfits: [string, number][], cargo: [string, number][], fuel: number,
}, gameData: SimulationGameDataInterface): string {
    const ship = gameData.data.Ship.getCached(entry.shipId);
    const lines = [entry.name, entry.where, ''];
    if (ship) {
        const outfitsState: OutfitsState = new Map(entry.outfits
            .map(([id, count]) => [id, { count }]));
        const physics = deriveShipPhysics(ship, gameData, outfitsState)
            ?? ship.physics;
        lines.push(
            `Shields: ${n(physics.shield)}    Armor: ${n(physics.armor)}`,
            `Speed: ${n(physics.speed / ShipSpeedConversionFactor)}    `
            + `Accel: ${n(physics.acceleration
                / ShipAccelerationConversionFactor)}    `
            + `Turn: ${n(physics.turnRate * 180 / Math.PI)}`,
            `Cargo: ${n(cargoUsed(new Map(entry.cargo)))} / `
            + `${n(physics.freeCargo)} tons`,
            `Fuel: ${n(entry.fuel)} / ${n(physics.energy)} `
            + `(${(entry.fuel / FUEL_PER_JUMP).toFixed(1)} jumps)`,
        );
    } else {
        lines.push('(This ship\'s data is not available.)');
    }
    if (entry.outfits.length > 0) {
        lines.push('', 'Outfits:');
        for (const [id, count] of entry.outfits) {
            const outfit = gameData.data.Outfit.getCached(id);
            const name = outfit ? displayName(outfit.name) : id;
            lines.push(count > 1 ? `  ${name} x${count}` : `  ${name}`);
        }
    }
    return lines.join('\n');
}

/**
 * The tiles, in order: the ship being flown, the stored ships in storage
 * order, then the captured escorts on the landed roster in roster order.
 * Pure, for the specs.
 */
export function hangarEntries(hull: Entity, lookups: StorageLookups,
    gameData: SimulationGameDataInterface,
    stellarName: (id: string) => string | undefined,
    stellarId: string, roster: readonly CarriedEscortEntry[] = [],
    player?: string): HangarEntry[] {
    const entries: HangarEntry[] = [];
    const tile = (record: StoredShip, kind: HangarEntryKind,
        where: string, subtitle: string, extra: Partial<HangarEntry>) => {
        const ship = lookups.getShip(record.ship);
        entries.push({
            id: `${kind}:${extra.uuid ?? extra.index ?? 0}`,
            name: record.name,
            shortName: `${captionName(ship, record.name)}\n${subtitle}`,
            desc: hangarDescription({ ...record, shipId: record.ship, where },
                gameData),
            pict: ship?.pict ?? '',
            kind, shipId: record.ship, ...extra,
        });
    };
    if (hull.components.get(ShipComponent)) {
        tile(snapshotHull(hull, stellarId, lookups), 'current',
            'Your ship (flying)', '- flying -', {});
    }
    storedShipsOf(hull).forEach((record, index) => {
        const at = stellarName(record.storedAt) ?? record.storedAt;
        tile(record, 'stored', `Stored (put away at ${at})`, '- stored -',
            { stored: record, index });
    });
    if (player !== undefined) {
        roster.forEach((entry, index) => {
            if (!storableEscort(entry, player)) {
                return;
            }
            tile(snapshotHull(entry.entity, stellarId, lookups), 'escort',
                'Captured escort (landed with you)', '- escort -',
                { uuid: entry.uuid, index });
        });
    }
    return entries;
}

export class HangarDialog {
    readonly container = new PIXI.Container();
    private controls: MenuControls;
    private closed = new Subject<void>();
    private context?: HangarContext;
    private itemGrid?: ItemGrid<HangarEntry>;
    private gridContainer = new PIXI.Container();
    private pictContainer = new PIXI.Container();
    private scrollUpArrow = new ScrollArrow('up');
    private scrollDownArrow = new ScrollArrow('down');
    private text = {
        description: new PIXI.Text('', { ...FONT.normal, wordWrapWidth: 196 }),
        storedLabel: new PIXI.Text('Stored:', FONT.normal),
        storedValue: new PIXI.Text('', FONT.normal),
        escortsLabel: new PIXI.Text('Escorts:', FONT.normal),
        escortsValue: new PIXI.Text('', FONT.normal),
        message: new PIXI.Text('', { ...FONT.normal, wordWrapWidth: 196 }),
    };
    /**
     * swap: fly the selected ship. move: the selection's other move — a
     * stored ship goes along as an ESCORT, an escort goes into STORAGE (the
     * caption follows the selection). done: back to the shipyard.
     */
    readonly buttons: { move: Button, swap: Button, done: Button };
    /** Rebuilds in flight, so a press cannot act on a stale grid. */
    private busy = false;

    constructor(private displayAssets: DisplayAssetDataInterface,
        private simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>) {
        this.container.name = 'HangarDialog';
        this.container.visible = false;
        const background = displayAssets.spriteFromPict(HIRE_DIALOG_PICT);
        background.anchor.set(0.5);
        background.interactive = true;
        this.container.addChild(background);

        this.buttons = {
            // Where the shipyard's Info pill is (SHIPYARD_BUTTONS.info).
            move: new Button(displayAssets, 'Escort', 63,
                { x: -129, y: HIRE.button.y }),
            swap: new Button(displayAssets, 'Swap', HIRE.button.hireWidth,
                { x: HIRE.button.hire, y: HIRE.button.y }),
            done: new Button(displayAssets, 'Done', HIRE.button.hireWidth,
                { x: HIRE.button.done, y: HIRE.button.y }),
        };
        this.buttons.swap.click.subscribe(() => void this.swap());
        this.buttons.move.click.subscribe(() => void this.move());
        this.buttons.done.click.subscribe(() => this.closed.next());
        for (const button of Object.values(this.buttons)) {
            this.container.addChild(button.container);
        }

        // The shipyard's panes (shipyard.ts / hire_escort.ts).
        this.gridContainer.position.set(-373, -153);
        this.pictContainer.position.set(174, -152.5);
        this.text.description.position.set(-27, -150);
        this.text.message.position.set(-27, 76);
        // The hire dialog's two-row pane ("Hiring Price:" / "You Have:").
        this.text.storedLabel.position.set(HIRE.label.x, HIRE.label.y);
        this.text.storedValue.position.set(HIRE.valueX, HIRE.label.y);
        this.text.escortsLabel.position.set(HIRE.label.x,
            HIRE.label.y + HIRE.labelPitch);
        this.text.escortsValue.position.set(HIRE.valueX,
            HIRE.label.y + HIRE.labelPitch);
        this.container.addChild(this.gridContainer, this.pictContainer);
        this.scrollUpArrow.container.position.set(-229, 138.5);
        this.scrollDownArrow.container.position.set(-199, 138.5);
        this.scrollUpArrow.click.subscribe(() => {
            this.itemGrid?.scrollUp();
            this.updateArrows();
        });
        this.scrollDownArrow.click.subscribe(() => {
            this.itemGrid?.scrollDown();
            this.updateArrows();
        });
        this.container.addChild(this.scrollUpArrow.container,
            this.scrollDownArrow.container);
        for (const t of Object.values(this.text)) {
            this.container.addChild(t);
        }

        this.controls = new MenuControls(controlEvents, {
            left: () => { this.itemGrid?.left(); this.updateArrows(); },
            right: () => { this.itemGrid?.right(); this.updateArrows(); },
            up: () => { this.itemGrid?.up(); this.updateArrows(); },
            down: () => { this.itemGrid?.down(); this.updateArrows(); },
            depart: () => this.closed.next(),
        });
    }

    /** The synchronous game-data lookups, over what {@link preload} warmed. */
    protected get lookups(): StorageLookups {
        return {
            getShip: id => this.simulationData.data.Ship.getCached(id),
            getOutfit: id => this.simulationData.data.Outfit.getCached(id),
        };
    }

    /** The ship classes this hangar may show or build, loaded. */
    protected shipIdsToLoad(): string[] {
        const hull = this.context?.hull();
        const ids = new Set<string>();
        const current = hull?.components.get(ShipComponent)?.id;
        if (current) {
            ids.add(current);
        }
        for (const record of hull ? storedShipsOf(hull) : []) {
            ids.add(record.ship);
        }
        for (const { entity } of this.escorts()) {
            const id = entity.components.get(ShipComponent)?.id;
            if (id) {
                ids.add(id);
            }
        }
        return [...ids];
    }

    /** The landed roster's entries the hangar can act on. */
    protected escorts(): CarriedEscortEntry[] {
        const player = this.context?.playerUuid;
        return player === undefined ? []
            : (this.context?.roster?.() ?? [])
                .filter(entry => storableEscort(entry, player));
    }

    /**
     * Warms every class the hangar shows and every outfit aboard them, so
     * the operations (synchronous) and the figures can read the cache.
     */
    private async preload(): Promise<void> {
        const shipIds = this.shipIdsToLoad();
        await Promise.all(shipIds.map(id =>
            this.simulationData.data.Ship.get(id).catch(() => undefined)));
        const outfitIds = new Set<string>();
        const hull = this.context?.hull();
        for (const record of hull ? storedShipsOf(hull) : []) {
            for (const [id] of record.outfits) {
                outfitIds.add(id);
            }
        }
        for (const { entity } of this.escorts()) {
            for (const id of entity.components.get(OutfitsStateComponent)
                ?.keys() ?? []) {
                outfitIds.add(id);
            }
        }
        await Promise.all([...outfitIds].map(id =>
            this.simulationData.data.Outfit.get(id).catch(() => undefined)));
        await Promise.all([...new Set(this.stellarIds())].map(id =>
            this.simulationData.data.Planet.get(id).catch(() => undefined)));
    }

    private stellarIds(): string[] {
        const hull = this.context?.hull();
        return hull ? storedShipsOf(hull).map(record => record.storedAt) : [];
    }

    /** The tiles for the hangar as it stands. */
    protected entries(): HangarEntry[] {
        const context = this.context!;
        return hangarEntries(context.hull(), this.lookups,
            this.simulationData,
            id => this.simulationData.data.Planet.getCached(id)?.name,
            context.stellarId, context.roster?.() ?? [], context.playerUuid);
    }

    /** Rebuilds the grid, selecting `select` (an entry id) if it exists. */
    protected async refresh(select?: string): Promise<void> {
        await this.preload();
        const entries = this.entries();
        this.gridContainer.removeChildren();
        const grid = new ItemGrid(this.displayAssets, entries);
        this.itemGrid = grid;
        this.gridContainer.addChild(grid.container);
        grid.activeTile.subscribe(tile => this.setSelected(tile));
        const selected = entries.find(entry => entry.id === select)
            ?? entries[0];
        if (selected) {
            grid.selection = selected;
        }
        grid.drawGrid();
        this.updateArrows();
        this.text.storedValue.text = String(
            entries.filter(entry => entry.kind === 'stored').length);
        this.text.escortsValue.text =
            `${this.escortCount()} of ${MAX_ESCORTS}`;
        this.refreshButtons();
    }

    private updateArrows() {
        this.scrollUpArrow.enabled = this.itemGrid?.canScrollUp ?? false;
        this.scrollDownArrow.enabled = this.itemGrid?.canScrollDown ?? false;
    }

    private setSelected(tile: ItemTile<HangarEntry> | undefined) {
        this.pictContainer.removeChildren();
        this.text.description.text = tile?.item.desc ?? '';
        if (tile?.largePict) {
            this.pictContainer.addChild(tile.largePict);
        }
        this.refreshButtons();
    }

    /** What the Swap button would be refused for, for the selection. */
    protected swapRefusal(entry: HangarEntry): StorageRefusal | undefined {
        if (this.context?.fightersOut()) {
            return 'fightersDeployed';
        }
        if (!this.lookups.getShip(entry.shipId)) {
            return 'notLoaded';
        }
        if (entry.kind === 'escort' && entry.uuid !== undefined
            && escortWingOut(entry.uuid, this.context?.roster?.() ?? [],
                this.context?.world?.())) {
            return 'wingDeployed';
        }
        return undefined;
    }

    /** What the move button would be refused for, for the selection. */
    protected moveRefusal(entry: HangarEntry): StorageRefusal | undefined {
        if (!this.lookups.getShip(entry.shipId)) {
            return 'notLoaded';
        }
        if (entry.kind === 'stored' && this.escortCapFull()) {
            return 'escortCap';
        }
        if (entry.kind === 'escort' && entry.uuid !== undefined
            && escortWingOut(entry.uuid, this.context?.roster?.() ?? [],
                this.context?.world?.())) {
            return 'wingDeployed';
        }
        return undefined;
    }

    /**
     * Whether the player already has MAX_ESCORTS escorts: the one count
     * the bar's hire dialog and the plunder capture share (escort_cap.ts),
     * over the display world, the landed roster and this landing's hires.
     */
    protected escortCapFull(): boolean {
        return this.context?.playerUuid !== undefined
            && this.escortCount() >= MAX_ESCORTS;
    }

    /** The player's escorts as the cap counts them (escortCapFull). */
    protected escortCount(): number {
        const context = this.context;
        const pending = context?.hull().components
            .get(PendingEscortsComponent)?.length ?? 0;
        if (!context || context.playerUuid === undefined) {
            return pending;
        }
        return cappedEscortCount(context.playerUuid, {
            world: context.world?.(), carried: context.roster?.(), pending,
        });
    }

    protected refreshButtons() {
        const entry = this.itemGrid?.selection;
        this.buttons.swap.state = entry && entry.kind !== 'current'
            && this.swapRefusal(entry) === undefined ? 'normal' : 'grey';
        this.buttons.move.setLabel(entry?.kind === 'escort' ? 'Store' : 'Escort');
        this.buttons.move.state = entry && entry.kind !== 'current'
            && this.moveRefusal(entry) === undefined ? 'normal' : 'grey';
    }

    /**
     * ESCORT (a stored ship) / STORE (an escort): moves the selected ship
     * between storage and the landed roster. The hull does not change, so
     * nothing is adopted; the change is recorded as a checkpoint.
     */
    private async move() {
        const entry = this.itemGrid?.selection;
        const context = this.context;
        if (!entry || !context || this.busy || entry.kind === 'current') {
            return;
        }
        const refusal = this.moveRefusal(entry);
        if (refusal) {
            this.say(STORAGE_REFUSAL_TEXT[refusal]);
            return;
        }
        let select = 'current:0';
        await this.act(() => {
            const roster = context.roster?.();
            const player = context.playerUuid;
            if (!roster || player === undefined) {
                throw new Error('No landed roster to move escorts on');
            }
            const hull = context.hull();
            if (entry.kind === 'stored' && entry.index !== undefined) {
                const uuid = (context.mintUuid ?? v4)();
                roster.push({
                    player, uuid,
                    entity: storedToEscort(hull, entry.index, player,
                        this.lookups),
                });
                select = `escort:${uuid}`;
                this.checkpoint(`Took ${entry.name} out of storage as an escort`);
                this.say(`The ${entry.name} will fly escort when you lift off.`);
            } else if (entry.kind === 'escort') {
                const at = roster.findIndex(row => row.uuid === entry.uuid);
                if (at < 0) {
                    throw new Error(`Escort ${entry.uuid} left the roster`);
                }
                escortToStorage(hull, roster[at].entity, context.stellarId,
                    this.lookups);
                roster.splice(at, 1);
                select = `stored:${storedShipsOf(hull).length - 1}`;
                this.checkpoint(`Put escort ${entry.name} into storage`);
                this.say(`The ${entry.name} is in storage.`);
            }
        }, () => select);
    }

    /** A pilot-history checkpoint for a change that keeps the hull. */
    private checkpoint(label: string) {
        const context = this.context!;
        requestCheckpoint({
            label, kind: 'purchase', entity: context.hull(),
            stellar: context.stellarId,
        });
    }

    /** Reports a refusal, or the result of a press, under the figures. */
    protected say(message: string) {
        this.text.message.text = message;
    }

    /**
     * SWAP: fly the selected ship. The hull being flown takes its place —
     * the stored ship's slot in storage.
     */
    private async swap() {
        const entry = this.itemGrid?.selection;
        const context = this.context;
        if (!entry || !context || this.busy || entry.kind === 'current') {
            return;
        }
        const refusal = this.swapRefusal(entry);
        if (refusal) {
            this.say(STORAGE_REFUSAL_TEXT[refusal]);
            return;
        }
        await this.act(async () => {
            if (entry.kind === 'stored' && entry.index !== undefined) {
                const hull = swapWithStored(context.hull(), entry.index,
                    context.stellarId, this.lookups);
                context.adoptHull(hull, 'Switched to');
                this.say(`You are now flying the ${entry.name}; your old `
                    + 'ship is in storage.');
            } else if (entry.kind === 'escort') {
                const roster = context.roster?.();
                const at = roster?.findIndex(row => row.uuid === entry.uuid)
                    ?? -1;
                if (!roster || at < 0 || context.playerUuid === undefined) {
                    throw new Error(`Escort ${entry.uuid} left the roster`);
                }
                const swapped = swapWithEscort(context.hull(),
                    roster[at].entity, context.stellarId,
                    context.playerUuid, this.lookups);
                // The old hull takes the escort's place on the roster, under
                // its roster uuid: the fleet is the same size as before.
                roster[at] = {
                    player: roster[at].player, uuid: roster[at].uuid,
                    entity: swapped.escort,
                };
                context.adoptHull(swapped.hull, 'Switched to');
                this.say(`You are now flying the ${entry.name}; your old `
                    + 'ship is flying escort.');
            }
        });
    }

    /**
     * Runs one operation with the buttons held, then rebuilds the grid on
     * the ship now flown. A throw (data that vanished under the press) is
     * reported, not swallowed into a half-drawn dialog.
     */
    protected async act(operation: () => Promise<void> | void,
        select: () => string = () => 'current:0'): Promise<void> {
        this.busy = true;
        try {
            await operation();
        } catch (e) {
            console.warn('Hangar operation failed:', e);
            this.say('That could not be done.');
        } finally {
            this.busy = false;
        }
        await this.refresh(select());
    }

    /** Shows the hangar over the shipyard until Done. */
    async show(context: HangarContext): Promise<void> {
        this.context = context;
        this.say('');
        await this.refresh();
        this.container.visible = true;
        this.controls.bind();
        await firstValueFrom(this.closed);
        this.controls.unbind();
        this.container.visible = false;
    }

    /** Closes the hangar from outside (the shipyard is being dismissed). */
    dismiss() {
        if (this.container.visible) {
            this.closed.next();
        }
    }
}
