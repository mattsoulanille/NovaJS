import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import * as fs from 'fs';
import * as path from 'path';
import {
    Controls, getActions, SavedControls,
} from '../nova_plugin/core/index.js';
import { isReturnPress } from '../input_focus.js';
import { SAVE_KEY, setActiveSaveKey } from '../nova_plugin/pilot/index.js';
import {
    ControlsOverride, mergeControls, migrateControlsOverride, PrefsStorage,
} from '../title/client_prefs.js';
import {
    createPilot, loadPilotControls, savePilotControls,
} from '../title/pilot_registry.js';
import {
    browserKeyboardLock, FullscreenButton, FullscreenEventDocument,
    fullscreenShortcutLabel, handleFullscreenKey, installEscapeKeyLock,
    isMacPlatform, toggleFullscreen, wireFullscreenButton,
} from './fullscreen.js';

/**
 * Fullscreen on Option+Return / Alt+Enter (Matthew 2026-11-24), the
 * migration of saved plain-Return bindings, and the Preferences button.
 */

function servedControlsJson(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(
        path.resolve(process.cwd(), 'settings/controls.json'), 'utf8'));
}

function decode(json: Record<string, unknown>): Controls {
    const decoded = SavedControls.pipe(Controls).decode(json);
    if (isLeft(decoded)) {
        throw new Error('Failed to decode controls');
    }
    return decoded.right;
}

interface FakeKey {
    type: string;
    code: string;
    key: string;
    repeat: boolean;
    altKey: boolean;
    defaultPrevented: boolean;
    getModifierState(m: string): boolean;
    preventDefault(): void;
}

/** A KeyboardEvent stand-in. Option on a Mac reports as Alt too. */
function key(code: string, opts: { alt?: boolean, shift?: boolean,
    type?: string, repeat?: boolean } = {}): FakeKey {
    const ev: FakeKey = {
        type: opts.type ?? 'keydown', code,
        key: code === 'Enter' ? 'Enter' : code, repeat: opts.repeat ?? false,
        altKey: !!opts.alt, defaultPrevented: false,
        getModifierState: (m: string) => (m === 'Alt' && !!opts.alt)
            || (m === 'Shift' && !!opts.shift),
        preventDefault() { ev.defaultPrevented = true; },
    };
    return ev;
}

class MemoryStorage implements PrefsStorage {
    private map = new Map<string, string>();
    getItem(k: string) { return this.map.get(k) ?? null; }
    setItem(k: string, v: string) { this.map.set(k, v); }
    removeItem(k: string) { this.map.delete(k); }
}

describe('fullscreen', () => {
    describe('the binding (settings/controls.json)', () => {
        const controls = decode(servedControlsJson());

        it('is Enter with the Alt modifier', () => {
            expect(servedControlsJson()['fullscreen'])
                .toEqual({ key: 'Enter', modifiers: ['Alt'] });
        });

        it('fires fullscreen, and only fullscreen, on Alt+Enter', () => {
            expect(getActions(controls,
                key('Enter', { alt: true }) as unknown as KeyboardEvent))
                .toEqual(['fullscreen']);
        });

        it('fires nothing on plain Enter', () => {
            expect(getActions(controls,
                key('Enter') as unknown as KeyboardEvent)).toEqual([]);
        });

        it('fires nothing on Shift+Enter', () => {
            expect(getActions(controls,
                key('Enter', { shift: true }) as unknown as KeyboardEvent))
                .toEqual([]);
        });
    });

    describe('handleFullscreenKey', () => {
        const controls = decode(servedControlsJson());

        it('toggles and consumes Alt+Enter', () => {
            const toggle = jasmine.createSpy('toggle');
            const ev = key('Enter', { alt: true });
            expect(handleFullscreenKey(ev as unknown as KeyboardEvent,
                controls, toggle)).toBeTrue();
            expect(toggle).toHaveBeenCalledTimes(1);
            expect(ev.defaultPrevented).toBeTrue();
        });

        it('leaves plain Enter alone', () => {
            const toggle = jasmine.createSpy('toggle');
            const ev = key('Enter');
            expect(handleFullscreenKey(ev as unknown as KeyboardEvent,
                controls, toggle)).toBeFalse();
            expect(toggle).not.toHaveBeenCalled();
            expect(ev.defaultPrevented).toBeFalse();
        });

        it('swallows a held chord\'s repeats without toggling again', () => {
            const toggle = jasmine.createSpy('toggle');
            const ev = key('Enter', { alt: true, repeat: true });
            expect(handleFullscreenKey(ev as unknown as KeyboardEvent,
                controls, toggle)).toBeTrue();
            expect(toggle).not.toHaveBeenCalled();
        });

        it('ignores the release and a page with no bindings yet', () => {
            const toggle = jasmine.createSpy('toggle');
            handleFullscreenKey(key('Enter', { alt: true, type: 'keyup' }) as
                unknown as KeyboardEvent, controls, toggle);
            handleFullscreenKey(key('Enter', { alt: true }) as
                unknown as KeyboardEvent, undefined, toggle);
            expect(toggle).not.toHaveBeenCalled();
        });

        it('follows a rebinding', () => {
            const toggle = jasmine.createSpy('toggle');
            const rebound = decode(mergeControls(servedControlsJson(),
                { fullscreen: 'F11' }));
            handleFullscreenKey(key('F11') as unknown as KeyboardEvent,
                rebound, toggle);
            handleFullscreenKey(key('Enter', { alt: true }) as
                unknown as KeyboardEvent, rebound, toggle);
            expect(toggle).toHaveBeenCalledTimes(1);
        });
    });

    describe('isReturnPress (the dialogs\' default-button key)', () => {
        it('is plain Return only', () => {
            expect(isReturnPress({ key: 'Enter' })).toBeTrue();
            expect(isReturnPress({ key: 'Enter', altKey: false })).toBeTrue();
            expect(isReturnPress({ key: 'Enter', altKey: true })).toBeFalse();
            expect(isReturnPress({ key: 'Escape' })).toBeFalse();
        });
    });

    describe('toggleFullscreen', () => {
        function fakeDoc(fullscreen: boolean) {
            const doc = {
                fullscreenElement: fullscreen ? {} : null,
                documentElement: {
                    requestFullscreen: jasmine.createSpy('request')
                        .and.returnValue(Promise.resolve()),
                },
                exitFullscreen: jasmine.createSpy('exit')
                    .and.returnValue(Promise.resolve()),
            };
            return doc;
        }

        it('requests fullscreen on the whole document when windowed', () => {
            const doc = fakeDoc(false);
            toggleFullscreen(doc);
            expect(doc.documentElement.requestFullscreen).toHaveBeenCalled();
            expect(doc.exitFullscreen).not.toHaveBeenCalled();
        });

        it('exits when already fullscreen', () => {
            const doc = fakeDoc(true);
            toggleFullscreen(doc);
            expect(doc.exitFullscreen).toHaveBeenCalled();
            expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
        });

        it('logs a refusal rather than throwing', async () => {
            const doc = fakeDoc(false);
            doc.documentElement.requestFullscreen.and.returnValue(
                Promise.reject(new Error('no user activation')));
            const warn = spyOn(console, 'warn');
            expect(() => toggleFullscreen(doc)).not.toThrow();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(warn).toHaveBeenCalled();
        });
    });

    describe('wireFullscreenButton (Preferences > Display)', () => {
        function fakeButton(): FullscreenButton & { click(): void } {
            const clicks: (() => void)[] = [];
            return {
                textContent: '', disabled: false, title: '',
                isConnected: true,
                addEventListener: (_type, listener) => { clicks.push(listener); },
                click() { for (const c of clicks) { c(); } },
            };
        }
        function fakeDoc(supported = true) {
            const listeners = new Set<() => void>();
            const doc = {
                fullscreenElement: null as unknown,
                documentElement: supported
                    ? { requestFullscreen: () => Promise.resolve() } : {},
                addEventListener: (_t: string, l: () => void) => {
                    listeners.add(l);
                },
                removeEventListener: (_t: string, l: () => void) => {
                    listeners.delete(l);
                },
                fire() { for (const l of [...listeners]) { l(); } },
                listeners,
            };
            return doc as typeof doc & FullscreenEventDocument;
        }

        it('toggles inside the click handler', () => {
            const button = fakeButton();
            const doc = fakeDoc();
            const toggle = jasmine.createSpy('toggle');
            wireFullscreenButton(button, doc, toggle);
            expect(toggle).not.toHaveBeenCalled();
            button.click();
            expect(toggle).toHaveBeenCalledOnceWith(doc);
        });

        it('labels itself from the document\'s fullscreen state', () => {
            const button = fakeButton();
            const doc = fakeDoc();
            wireFullscreenButton(button, doc, () => undefined);
            expect(button.textContent).toBe('Fullscreen');
            doc.fullscreenElement = {};
            doc.fire();
            expect(button.textContent).toBe('Exit Fullscreen');
            doc.fullscreenElement = null;
            doc.fire();
            expect(button.textContent).toBe('Fullscreen');
        });

        it('stops listening once the button has left the page', () => {
            const button = fakeButton();
            const doc = fakeDoc();
            wireFullscreenButton(button, doc, () => undefined);
            expect(doc.listeners.size).toBe(1);
            (button as { isConnected: boolean }).isConnected = false;
            doc.fire();
            expect(doc.listeners.size).toBe(0);
        });

        it('is disabled where the browser cannot fullscreen', () => {
            const button = fakeButton();
            const toggle = jasmine.createSpy('toggle');
            wireFullscreenButton(button, fakeDoc(false), toggle);
            expect(button.disabled).toBeTrue();
            button.click();
            expect(toggle).not.toHaveBeenCalled();
        });

        it('names the shortcut per platform', () => {
            expect(fullscreenShortcutLabel('MacIntel')).toBe('Option+Return');
            expect(fullscreenShortcutLabel('iPad')).toBe('Option+Return');
            expect(fullscreenShortcutLabel('Win32')).toBe('Alt+Enter');
            expect(fullscreenShortcutLabel('Linux x86_64')).toBe('Alt+Enter');
            expect(isMacPlatform(undefined)).toBeFalse();
        });

        describe('the Escape key lock (Matthew 2026-11-27)', () => {
            function fakeKeyboard() {
                return {
                    lock: jasmine.createSpy('lock')
                        .and.returnValue(Promise.resolve()),
                    unlock: jasmine.createSpy('unlock'),
                };
            }
            const settle = () => new Promise(r => setTimeout(r, 0));

            it('locks Escape on entering fullscreen and unlocks on leaving',
                () => {
                    const doc = fakeDoc();
                    const keyboard = fakeKeyboard();
                    installEscapeKeyLock(doc, keyboard);
                    // Not fullscreen at install: nothing locked.
                    expect(keyboard.lock).not.toHaveBeenCalled();
                    doc.fullscreenElement = {};
                    doc.fire();
                    expect(keyboard.lock).toHaveBeenCalledOnceWith(['Escape']);
                    // A second change while still fullscreen: no relock.
                    doc.fire();
                    expect(keyboard.lock).toHaveBeenCalledTimes(1);
                    doc.fullscreenElement = null;
                    doc.fire();
                    expect(keyboard.unlock).toHaveBeenCalledTimes(1);
                    // Leaving again (no lock held) unlocks nothing more.
                    doc.fire();
                    expect(keyboard.unlock).toHaveBeenCalledTimes(1);
                    // And it locks again on the next entry.
                    doc.fullscreenElement = {};
                    doc.fire();
                    expect(keyboard.lock).toHaveBeenCalledTimes(2);
                });

            it('installs nothing without navigator.keyboard.lock (Safari, '
                + 'Firefox)', () => {
                    const doc = fakeDoc();
                    installEscapeKeyLock(doc, undefined);
                    expect(doc.listeners.size).toBe(0);
                    installEscapeKeyLock(doc, {});
                    expect(doc.listeners.size).toBe(0);
                    // The page's own detection, in node: no navigator.keyboard.
                    expect(browserKeyboardLock()?.lock).toBeUndefined();
                });

            it('logs a refused lock and tries again next time', async () => {
                const doc = fakeDoc();
                const keyboard = fakeKeyboard();
                keyboard.lock.and.returnValue(
                    Promise.reject(new Error('not allowed')));
                const warn = spyOn(console, 'warn');
                installEscapeKeyLock(doc, keyboard);
                doc.fullscreenElement = {};
                doc.fire();
                await settle();
                expect(warn).toHaveBeenCalled();
                // The refusal holds no lock: leaving does not unlock...
                doc.fullscreenElement = null;
                doc.fire();
                expect(keyboard.unlock).not.toHaveBeenCalled();
                // ...and the next entry asks again.
                doc.fullscreenElement = {};
                doc.fire();
                expect(keyboard.lock).toHaveBeenCalledTimes(2);
            });

            it('uninstalling stops following and releases a held lock',
                () => {
                    const doc = fakeDoc();
                    const keyboard = fakeKeyboard();
                    const uninstall = installEscapeKeyLock(doc, keyboard);
                    doc.fullscreenElement = {};
                    doc.fire();
                    uninstall();
                    expect(keyboard.unlock).toHaveBeenCalledTimes(1);
                    expect(doc.listeners.size).toBe(0);
                });
        });
    });

    describe('migrating saved plain-Return bindings', () => {
        // createPilot moves save_game's module-level active save key.
        afterEach(() => setActiveSaveKey(SAVE_KEY));

        it('drops an override that restates the old default', () => {
            for (const old of ['Enter', ['Enter'], [{ key: 'Enter' }],
                [{ key: 'Enter', modifiers: [] }]] as ControlsOverride[string][]) {
                const migrated = migrateControlsOverride(
                    { fullscreen: old, accelerate: 'KeyW' });
                expect(migrated).toEqual({ accelerate: 'KeyW' });
            }
        });

        it('so the merged controls fire fullscreen on Alt+Enter only', () => {
            const controls = decode(mergeControls(servedControlsJson(),
                migrateControlsOverride({ fullscreen: 'Enter' })));
            expect(getActions(controls,
                key('Enter') as unknown as KeyboardEvent)).toEqual([]);
            expect(getActions(controls,
                key('Enter', { alt: true }) as unknown as KeyboardEvent))
                .toEqual(['fullscreen']);
        });

        it('leaves a binding the player chose alone', () => {
            const chosen: ControlsOverride[] = [
                { fullscreen: 'F11' },
                { fullscreen: '' },
                { fullscreen: [] },
                { fullscreen: [{ key: 'Enter', modifiers: ['Shift'] }] },
                { fullscreen: ['Enter', 'F11'] },
            ];
            for (const override of chosen) {
                expect(migrateControlsOverride(override)).toBe(override);
            }
        });

        it('leaves other actions on Enter alone', () => {
            const override: ControlsOverride = { land: 'Enter' };
            expect(migrateControlsOverride(override)).toBe(override);
        });

        it('applies to a pilot record and the legacy slot', () => {
            const store = new MemoryStorage();
            // Legacy single slot (no pilot yet).
            store.setItem('novajs:controls',
                JSON.stringify({ fullscreen: 'Enter', hail: 'KeyQ' }));
            expect(loadPilotControls(store)).toEqual({ hail: 'KeyQ' });

            createPilot({
                name: 'Old Hand', nickname: 'OH', gender: 'male',
                strict: false,
            }, store);
            savePilotControls({ fullscreen: 'Enter', board: 'KeyX' }, store);
            expect(loadPilotControls(store)).toEqual({ board: 'KeyX' });

            savePilotControls({ fullscreen: 'F11' }, store);
            expect(loadPilotControls(store)).toEqual({ fullscreen: 'F11' });
        });
    });
});
