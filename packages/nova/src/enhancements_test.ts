import 'jasmine';
import {
    currentEnhancements, defaultEnhancements, enhancementEnabled,
    ENHANCEMENTS, invalidateEnhancements, onEnhancementsChanged,
    overrideEnhancements,
    resolveEnhancements, setEnhancementsSource, StoredEnhancements,
} from './enhancements.js';
import { PilotProfile, PrefsStorage } from './title/client_prefs.js';
import {
    createPilot, exportPilot, importPilot, loadPilotSettings, selectPilot,
    savePilotSettings,
} from './title/pilot_registry.js';

class MemoryStorage implements PrefsStorage {
    private map = new Map<string, string>();
    getItem(key: string) { return this.map.get(key) ?? null; }
    setItem(key: string, value: string) { this.map.set(key, value); }
    removeItem(key: string) { this.map.delete(key); }
}

function profile(name: string): PilotProfile {
    return { name, nickname: name, gender: 'male', strict: false };
}

describe('NovaJS Enhancements', () => {
    afterEach(() => {
        setEnhancementsSource(() => undefined);
        overrideEnhancements({});
    });

    it('lists every toggle once, each with a label and an original line',
        () => {
            const keys = ENHANCEMENTS.map(e => e.key);
            expect(new Set(keys).size).toBe(keys.length);
            for (const spec of ENHANCEMENTS) {
                expect(spec.label.length).toBeGreaterThan(0);
                expect(spec.original.length).toBeGreaterThan(0);
                expect(spec.novajs.length).toBeGreaterThan(0);
            }
        });

    it('defaults every toggle ON (the NovaJS behaviour)', () => {
        expect(Object.values(defaultEnhancements()).every(v => v))
            .toBeTrue();
        expect(resolveEnhancements(undefined)).toEqual(defaultEnhancements());
        expect(resolveEnhancements({})).toEqual(defaultEnhancements());
    });

    it('reads a stored false as OFF and ignores non-boolean values', () => {
        const resolved = resolveEnhancements({
            enhMapAutoRoute: false,
            enhShopSearch: 'no',
            soundVolume: 'loud',
        } as StoredEnhancements);
        expect(resolved.enhMapAutoRoute).toBeFalse();
        expect(resolved.enhShopSearch).toBeTrue();
        expect(resolved.enhLiveTargetView).toBeTrue();
    });

    it('tells its listeners when the values may have changed (the turret '
        + 'aim toggle must be sent to the simulation)', () => {
        let calls = 0;
        const stop = onEnhancementsChanged(() => { calls++; });
        expect(enhancementEnabled('enhAccurateTurretAim')).toBeTrue();
        overrideEnhancements({ enhAccurateTurretAim: false });
        expect(calls).toBe(1);
        expect(enhancementEnabled('enhAccurateTurretAim')).toBeFalse();
        invalidateEnhancements();
        expect(calls).toBe(2);
        stop();
        overrideEnhancements({});
        expect(calls).toBe(2);
    });

    it('is ON everywhere with no source (node specs, the worker)', () => {
        for (const { key } of ENHANCEMENTS) {
            expect(enhancementEnabled(key)).toBeTrue();
        }
    });

    it('persists with the active pilot and applies on the next read', () => {
        const store = new MemoryStorage();
        const pilot = createPilot(profile('Toggler'), store);
        selectPilot(pilot.id, store);
        setEnhancementsSource(() => loadPilotSettings(store));
        expect(enhancementEnabled('enhShopScrollWheel')).toBeTrue();

        savePilotSettings({ ...loadPilotSettings(store),
            enhShopScrollWheel: false }, store);
        // The registry write invalidated the cache: no reload needed.
        expect(enhancementEnabled('enhShopScrollWheel')).toBeFalse();
        expect(enhancementEnabled('enhShopSearch')).toBeTrue();
        expect(loadPilotSettings(store).enhShopScrollWheel).toBeFalse();
    });

    it('is per pilot: switching pilots switches the values', () => {
        const store = new MemoryStorage();
        const a = createPilot(profile('A'), store);
        selectPilot(a.id, store);
        savePilotSettings({ enhLiveTargetView: false }, store);
        const b = createPilot(profile('B'), store);
        selectPilot(b.id, store);
        setEnhancementsSource(() => loadPilotSettings(store));
        expect(enhancementEnabled('enhLiveTargetView')).toBeTrue();
        selectPilot(a.id, store);
        expect(enhancementEnabled('enhLiveTargetView')).toBeFalse();
    });

    it('travels with an exported pilot', () => {
        const store = new MemoryStorage();
        const pilot = createPilot(profile('Exported'), store);
        selectPilot(pilot.id, store);
        savePilotSettings({ enhMapAutoRoute: false }, store);
        const text = exportPilot(pilot.id, store)!;
        const other = new MemoryStorage();
        const imported = importPilot(text, other);
        if (!imported.ok) {
            fail(imported.reason);
            return;
        }
        selectPilot(imported.pilot.id, other);
        setEnhancementsSource(() => loadPilotSettings(other));
        expect(enhancementEnabled('enhMapAutoRoute')).toBeFalse();
    });

    it('session overrides win over stored values and are dropped with {}',
        () => {
            setEnhancementsSource(() => ({ enhShopSearch: false }));
            expect(enhancementEnabled('enhShopSearch')).toBeFalse();
            overrideEnhancements({ enhShopSearch: true,
                enhMapAutoRoute: false });
            expect(enhancementEnabled('enhShopSearch')).toBeTrue();
            expect(currentEnhancements().enhMapAutoRoute).toBeFalse();
            overrideEnhancements({});
            expect(enhancementEnabled('enhShopSearch')).toBeFalse();
            expect(enhancementEnabled('enhMapAutoRoute')).toBeTrue();
        });

    it('caches the stored values until invalidated', () => {
        let reads = 0;
        let stored: StoredEnhancements = {};
        setEnhancementsSource(() => { reads++; return stored; });
        enhancementEnabled('enhMapAutoRoute');
        enhancementEnabled('enhShopSearch');
        expect(reads).toBe(1);
        stored = { enhMapAutoRoute: false };
        expect(enhancementEnabled('enhMapAutoRoute')).toBeTrue();
        invalidateEnhancements();
        expect(enhancementEnabled('enhMapAutoRoute')).toBeFalse();
        expect(reads).toBe(2);
    });

    it('treats a throwing source as all ON', () => {
        setEnhancementsSource(() => { throw new Error('no storage'); });
        expect(enhancementEnabled('enhMapAutoRoute')).toBeTrue();
    });
});
