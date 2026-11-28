/**
 * The title screen's button roll-in: the original's sequence, measured on
 * the reference Mac and read from its code (docs/reference_experiments.md,
 * "Title button roll-in").
 *
 * Every time the main screen appears (first open and every return from the
 * game) the original plays three "slide" filmstrips over the centre panel,
 * one per button row (PICTs 8030 "Slide upper", 8031 "Slide middle", 8032
 * "Slide lower"; spïn 608-610 give their 1 x 11 / 1 x 10 / 1 x 11 grids).
 * The red button blanks slide in from the panel's outer edges; when a row's
 * strip ends, that row's real buttons (rlëD 8050-8055, with their labels)
 * are drawn instead. The centre emblem (rlëD 8020) stays hidden until all
 * three rows are done and then fades in.
 *
 * The clock is the Mac's TickCount (60.15 Hz). EV Nova's
 * LoadMainScreenAnim gives the rows starting indices -1, trunc(-1 - 11/2)
 * = -6 and trunc(-6 - 10/2) = -11 (each row starts half the previous
 * row's frame count after it: 5 ticks), and MainScreenAnimIdle then, once
 * a tick, advances every unfinished row by one: a row whose index is 0
 * plays snd 602 ("Menu button start") as it steps, and a row that reaches
 * its frame count plays snd 603 ("Menu button end"). A negative index
 * draws nothing (the background's empty slot shows). So:
 *
 *   tick  1: upper strip frame 0 shows
 *   tick  2: 602 (upper)            tick 12: 603 (upper), 602 (lower)
 *   tick  7: 602 (middle)           tick 16: 603 (middle)
 *                                   tick 22: 603 (lower): all done
 *
 * and the emblem's alpha (0..32, 4 a tick: MainScreenRolloverIdle) runs
 * up from that last tick, full at tick 29. 22 ticks is 0.37 s, which the
 * recordings match frame for frame.
 *
 * Input (MainScreenMouse / MainScreenKey): a mouse-down anywhere in the
 * window SKIPS the roll-in (every row jumps to done, with no 603) and is
 * then tracked as a button press as usual; keys never skip, but the six
 * hotkeys act at once. When the app is in the background as the screen
 * appears (`inBackground`), there is no roll-in at all and the emblem is
 * shown at full strength.
 *
 * Pure (no Pixi, no DOM), so the sequencing is unit-testable; TitleScreen
 * draws it and plays the sounds.
 */

/** One Mac tick (TickCount runs at 60.15 Hz). */
export const MAC_TICK_MS = 1000 / 60.15;

/** One button row's slide filmstrip and where it is drawn. */
export interface SlideRow {
    /** PICT holding the vertical filmstrip. */
    pict: string;
    /** Frames in the strip (spïn 608-610 yTiles). */
    frames: number;
    /** Frame size in pixels. */
    width: number;
    height: number;
    /** Top-left in background-local (PICT 8000, 1024x768) coordinates,
     * measured against the reference recordings. */
    x: number;
    y: number;
}

/** The original's three rows, top to bottom. */
export const SLIDE_ROWS: readonly SlideRow[] = [
    { pict: 'nova:8030', frames: 11, width: 338, height: 63, x: 343, y: 399 },
    { pict: 'nova:8031', frames: 10, width: 351, height: 64, x: 337, y: 462 },
    { pict: 'nova:8032', frames: 11, width: 351, height: 65, x: 337, y: 526 },
];

/** snd played as a row starts sliding / as it lands. */
export const ROLL_IN_START_SOUND = 'nova:602';
export const ROLL_IN_END_SOUND = 'nova:603';

/** rolloverAlpha's full strength and its step a tick. */
export const EMBLEM_ALPHA_MAX = 32;
const EMBLEM_ALPHA_STEP = 4;

/** A sound cue raised by one tick. */
export interface RollInCue {
    kind: 'start' | 'end';
    row: number;
}

/**
 * The rows' starting indices: -1 for the first, then each the previous
 * one plus half the previous row's frame count, truncated toward zero
 * (the original multiplies by the double -0.5 and converts with cvttsd2si).
 */
export function initialSlideIndices(frameCounts: readonly number[]): number[] {
    const indices: number[] = [];
    frameCounts.forEach((_count, i) => {
        indices.push(i === 0 ? -1
            : Math.trunc(indices[i - 1] + frameCounts[i - 1] * -0.5));
    });
    return indices;
}

/** What a row draws right now. */
export type RowView =
    /** Nothing: the background's empty slot (index still negative). */
    | { kind: 'hidden' }
    /** This frame of the slide strip. */
    | { kind: 'slide', frame: number }
    /** Done: the row's real buttons. */
    | { kind: 'buttons' };

export class TitleRollIn {
    private readonly counts: number[];
    private indices: number[];
    /** 0..EMBLEM_ALPHA_MAX. */
    private alpha: number;

    /**
     * @param background The page is in the background as the title
     *     appears: no roll-in, emblem at full strength (the original's
     *     `inBackground` path).
     */
    constructor(rows: readonly SlideRow[] = SLIDE_ROWS, background = false) {
        this.counts = rows.map(row => row.frames);
        this.indices = background ? [...this.counts]
            : initialSlideIndices(this.counts);
        this.alpha = background ? EMBLEM_ALPHA_MAX : 0;
    }

    /** Every row has landed (its buttons are drawn). */
    get rowsDone(): boolean {
        return this.indices.every((index, i) => index >= this.counts[i]);
    }

    /** Nothing left to animate: rows done and the emblem at full strength. */
    get finished(): boolean {
        return this.rowsDone && this.alpha >= EMBLEM_ALPHA_MAX;
    }

    /** The centre emblem's opacity, 0..1. */
    get emblemOpacity(): number {
        return this.alpha / EMBLEM_ALPHA_MAX;
    }

    row(i: number): RowView {
        const index = this.indices[i];
        if (index >= this.counts[i]) {
            return { kind: 'buttons' };
        }
        return index < 0 ? { kind: 'hidden' } : { kind: 'slide', frame: index };
    }

    /**
     * One Mac tick: advance every unfinished row (MainScreenAnimIdle) and,
     * once all rows are done, the emblem fade (MainScreenRolloverIdle).
     * Returns the sound cues this tick raised, in the original's order.
     */
    tick(): RollInCue[] {
        const cues: RollInCue[] = [];
        this.indices = this.indices.map((index, row) => {
            if (index >= this.counts[row]) {
                return index;
            }
            if (index === 0) {
                cues.push({ kind: 'start', row });
            }
            const next = index + 1;
            if (next === this.counts[row]) {
                cues.push({ kind: 'end', row });
            }
            return next;
        });
        // RolloverIdle runs right after the slide step in the same idle,
        // with lastRolloverAnimTime zeroed by LoadMainScreenAnim, so the
        // fade's first step lands on the very tick the last row does.
        if (this.rowsDone) {
            this.alpha = Math.min(EMBLEM_ALPHA_MAX,
                this.alpha + EMBLEM_ALPHA_STEP);
        }
        return cues;
    }

    /**
     * A click during the roll-in: every row jumps to done with no end
     * sound (MainScreenMouse sets each index to 32000). The emblem then
     * fades in as usual. Returns whether anything was still sliding.
     */
    skip(): boolean {
        const wasRunning = !this.rowsDone;
        this.indices = [...this.counts];
        return wasRunning;
    }
}

/**
 * Turns frame time into whole Mac ticks. At most `maxTicks` are returned
 * per call so a long stall (a hidden tab) cannot fire a burst of sounds
 * in one frame; the remainder is dropped rather than queued.
 */
export class TickClock {
    private carry = 0;

    constructor(private readonly tickMs = MAC_TICK_MS,
        private readonly maxTicks = 4) {}

    advance(deltaMs: number): number {
        this.carry += Math.max(0, deltaMs);
        const ticks = Math.floor(this.carry / this.tickMs);
        this.carry -= ticks * this.tickMs;
        if (ticks > this.maxTicks) {
            this.carry = 0;
            return this.maxTicks;
        }
        return ticks;
    }

    reset() {
        this.carry = 0;
    }
}

/** The logo (PICT 8010, spïn 606, 7 frames) changes every 5 ticks. */
export const LOGO_TICKS = 5;

/**
 * The logo's next frame: MainScreenAnimIdle draws Rand(frames) until it
 * differs from the current one, so the flames flicker at random rather
 * than cycling in order. `random` returns [0, 1).
 */
export function nextLogoFrame(current: number, frames: number,
    random: () => number = Math.random): number {
    if (frames <= 1) {
        return 0;
    }
    // One draw over the other frames: the same distribution as redrawing
    // until it differs, without the loop.
    const pick = Math.min(frames - 2, Math.floor(random() * (frames - 1)));
    return pick >= current ? pick + 1 : pick;
}
