import * as PIXI from 'pixi.js';
import {
    disablePixiAccessibility, pixiAccessibilityRegistered,
} from './pixi_accessibility.js';

describe('disablePixiAccessibility', () => {
    afterEach(() => {
        // Leave the registry as the other specs found it.
        if (!pixiAccessibilityRegistered()) {
            PIXI.extensions.add(PIXI.AccessibilityManager);
        }
    });

    it('unregisters the renderer plugin that Tab would activate', () => {
        // PIXI registers it on import, so every renderer would get one.
        expect(pixiAccessibilityRegistered()).toBeTrue();
        disablePixiAccessibility();
        expect(pixiAccessibilityRegistered()).toBeFalse();
    });

    it('is idempotent', () => {
        disablePixiAccessibility();
        disablePixiAccessibility();
        expect(pixiAccessibilityRegistered()).toBeFalse();
    });
});
