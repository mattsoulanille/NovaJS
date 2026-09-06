import { ControlSinks } from './autopilot.js';
import { ControlAction } from './nova_plugin/core/controls.js';

/**
 * On-screen touch controls, sized for tablets:
 * - A virtual joystick (left thumb): direction turns the ship toward
 *   the stick's heading, deflection past a deadzone is throttle. Sent
 *   as analog input, which the simulation applies via the same
 *   turnTo/accelerating machinery the digital controls use.
 * - Fire buttons (right thumb) with gestures: hold fires normally,
 *   double-tap latches fire on, a single tap turns it off.
 * - Target cycle and secondary-weapon cycle buttons.
 *
 * Buttons emit the same ControlEvents the keyboard produces ('start'
 * on press, false on release), so held and edge-triggered actions work
 * without special casing.
 */

export interface TouchControlsOptions {
    sinks: ControlSinks;
    /** Notified on any movement input, so an autopilot can cancel. */
    onMovementInput?: () => void;
}

/** ?touch=1 / ?touch=0 override detection, for testing on desktop. */
export function wantsTouchControls(): boolean {
    const query = new URLSearchParams(window.location.search);
    const touchParam = query.get('touch');
    if (touchParam !== null) {
        return touchParam !== '0' && touchParam !== 'false';
    }
    return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

const JOYSTICK_SIZE = 180;
const KNOB_SIZE = 72;
/** Max knob travel from center, px. */
const JOYSTICK_TRAVEL = (JOYSTICK_SIZE - KNOB_SIZE) / 2 + 12;
/** Below this deflection the stick is direction-only (no thrust). */
const THROTTLE_DEADZONE = 0.35;
/** Below this deflection the stick does nothing (jitter guard). */
const HEADING_DEADZONE = 0.12;
/** Don't resend analog state for changes smaller than these. */
const HEADING_EPSILON = 0.01;
const THROTTLE_EPSILON = 0.02;

/** A press shorter than this is a tap; longer is a hold. */
const TAP_MS = 250;
/** Two taps within this interval are a double-tap. */
const DOUBLE_TAP_MS = 350;

const STYLE = `
/* While docked the spaceport UI owns the screen. */
.nova-docked .nova-touch-cluster,
.nova-docked .nova-joystick {
    display: none;
}
.nova-touch-cluster {
    position: fixed;
    bottom: calc(24px + env(safe-area-inset-bottom, 0px));
    display: grid;
    gap: 14px;
    z-index: 10;
    pointer-events: none;
}
.nova-touch-cluster.nova-touch-right {
    /* Clear the status bar, which occupies the right edge. */
    right: calc(220px + env(safe-area-inset-right, 0px));
    grid-template-columns: auto auto;
    justify-items: center;
    align-items: end;
}
.nova-touch-button {
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    width: 84px;
    height: 84px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.4);
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
    font: 600 20px system-ui, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
}
.nova-touch-button.nova-touch-small {
    width: 60px;
    height: 60px;
    font-size: 16px;
}
.nova-touch-button.nova-touch-pressed {
    background: rgba(255, 255, 255, 0.35);
}
.nova-touch-button.nova-touch-latched {
    background: rgba(255, 120, 60, 0.35);
    border-color: rgba(255, 160, 90, 0.8);
}
.nova-joystick {
    position: fixed;
    left: calc(28px + env(safe-area-inset-left, 0px));
    bottom: calc(28px + env(safe-area-inset-bottom, 0px));
    width: ${JOYSTICK_SIZE}px;
    height: ${JOYSTICK_SIZE}px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.05);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    z-index: 10;
}
.nova-joystick-knob {
    position: absolute;
    left: ${(JOYSTICK_SIZE - KNOB_SIZE) / 2}px;
    top: ${(JOYSTICK_SIZE - KNOB_SIZE) / 2}px;
    width: ${KNOB_SIZE}px;
    height: ${KNOB_SIZE}px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.15);
    pointer-events: none;
}
`;

function makeJoystick(options: TouchControlsOptions): HTMLElement {
    const base = document.createElement('div');
    base.classList.add('nova-joystick');
    const knob = document.createElement('div');
    knob.classList.add('nova-joystick-knob');
    base.appendChild(knob);

    let activePointer: number | undefined;
    let lastHeading: number | null = null;
    let lastThrottle: number | null = null;

    function send(heading: number | null, throttle: number | null) {
        const headingChanged = heading === null || lastHeading === null
            ? heading !== lastHeading
            : Math.abs(heading - lastHeading) > HEADING_EPSILON;
        const throttleChanged = throttle === null || lastThrottle === null
            ? throttle !== lastThrottle
            : Math.abs(throttle - lastThrottle) > THROTTLE_EPSILON;
        if (!headingChanged && !throttleChanged) {
            return;
        }
        lastHeading = heading;
        lastThrottle = throttle;
        options.sinks.analogControl({ heading, throttle });
    }

    function update(event: PointerEvent) {
        const rect = base.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const distance = Math.hypot(dx, dy);
        const clamped = Math.min(distance, JOYSTICK_TRAVEL);
        const scale = distance > 0 ? clamped / distance : 0;
        knob.style.transform =
            `translate(${dx * scale}px, ${dy * scale}px)`;

        const deflection = clamped / JOYSTICK_TRAVEL;
        if (deflection < HEADING_DEADZONE) {
            send(null, 0);
            return;
        }
        // Screen +y is down; Vector.angle convention is atan2(x, -y)
        // (0 = up, clockwise positive), which matches directly.
        const heading = Math.atan2(dx, -dy);
        const throttle = deflection < THROTTLE_DEADZONE ? 0
            : (deflection - THROTTLE_DEADZONE) / (1 - THROTTLE_DEADZONE);
        send(heading, throttle);
    }

    base.addEventListener('pointerdown', event => {
        event.preventDefault();
        if (activePointer !== undefined) {
            return;
        }
        activePointer = event.pointerId;
        try {
            base.setPointerCapture(event.pointerId);
        } catch {
            // Release still arrives via pointerup/pointercancel.
        }
        options.onMovementInput?.();
        update(event);
    });
    base.addEventListener('pointermove', event => {
        if (event.pointerId !== activePointer) {
            return;
        }
        update(event);
    });
    const release = (event: PointerEvent) => {
        if (event.pointerId !== activePointer) {
            return;
        }
        activePointer = undefined;
        knob.style.transform = '';
        // Hand both axes back to the digital controls.
        send(null, null);
    };
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);
    base.addEventListener('contextmenu', event => event.preventDefault());
    return base;
}

interface TouchButton {
    action: ControlAction,
    label: string,
    size: 'large' | 'small',
    /** Hold to fire, double-tap to latch on, tap to turn off. */
    latchable?: boolean,
    /** Movement-affecting: pressing it cancels the autopilot. */
    movement?: boolean,
}

function makeButton(button: TouchButton,
    options: TouchControlsOptions): HTMLElement {
    const element = document.createElement('div');
    element.classList.add('nova-touch-button');
    if (button.size === 'small') {
        element.classList.add('nova-touch-small');
    }
    element.textContent = button.label;
    const { sinks } = options;

    let latched = false;
    let pressStart = 0;
    let lastTapTime = -Infinity;
    // A button counts as held while any pointer is down on it, so two
    // overlapping fingers don't release the control early.
    const pointers = new Set<number>();

    function setLatched(value: boolean) {
        latched = value;
        element.classList.toggle('nova-touch-latched', value);
    }

    element.addEventListener('pointerdown', event => {
        event.preventDefault();
        // Keep receiving this pointer's up event even if the finger
        // slides off the button. Capture can fail for pointers that
        // are already gone; the pointercancel handler covers those.
        try {
            element.setPointerCapture(event.pointerId);
        } catch {
            // Release still arrives via pointerup/pointercancel.
        }
        pointers.add(event.pointerId);
        if (pointers.size !== 1) {
            return;
        }
        if (button.movement) {
            options.onMovementInput?.();
        }
        element.classList.add('nova-touch-pressed');
        pressStart = performance.now();
        if (!latched) {
            sinks.controlEvents([{ action: button.action, state: 'start' }]);
        }
    });
    const release = (event: PointerEvent) => {
        if (!pointers.delete(event.pointerId)) {
            return;
        }
        if (pointers.size !== 0) {
            return;
        }
        element.classList.remove('nova-touch-pressed');
        const now = performance.now();
        const isTap = now - pressStart < TAP_MS;

        if (!button.latchable) {
            sinks.controlEvents([{ action: button.action, state: false }]);
            return;
        }
        if (!isTap) {
            // A hold fires while pressed and stops on release.
            setLatched(false);
            sinks.controlEvents([{ action: button.action, state: false }]);
            return;
        }
        if (latched) {
            // Single tap turns latched fire off.
            setLatched(false);
            sinks.controlEvents([{ action: button.action, state: false }]);
        } else if (now - lastTapTime < DOUBLE_TAP_MS) {
            // Double-tap: keep firing (the press already started it).
            setLatched(true);
        } else {
            sinks.controlEvents([{ action: button.action, state: false }]);
        }
        lastTapTime = now;
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    // Long-press context menus would interrupt held controls.
    element.addEventListener('contextmenu', event => event.preventDefault());
    return element;
}

export function installTouchControls(options: TouchControlsOptions): void {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    document.body.appendChild(makeJoystick(options));

    const cluster = document.createElement('div');
    cluster.classList.add('nova-touch-cluster', 'nova-touch-right');
    const buttons: TouchButton[] = [
        { action: 'nextTarget', label: 'TGT', size: 'small' },
        { action: 'nextSecondary', label: 'SEC', size: 'small' },
        { action: 'firePrimary', label: '✹', size: 'large', latchable: true },
        { action: 'fireSecondary', label: '◆', size: 'large', latchable: true },
    ];
    for (const button of buttons) {
        cluster.appendChild(makeButton(button, options));
    }
    document.body.appendChild(cluster);
}
