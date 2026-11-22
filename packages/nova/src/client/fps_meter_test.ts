import 'jasmine';
import { FpsMeterToggle } from './fps_meter.js';

describe('FpsMeterToggle (#371 R4)', () => {
    it('hides the FPS meter by default and toggles on toggleFpsMeter start', () => {
        const dom = { style: { display: '' } };
        const meter = new FpsMeterToggle(dom);

        expect(meter.visible).toBeFalse();
        expect(dom.style.display).toBe('none');

        expect(meter.handleControlEvent({ action: 'toggleFpsMeter', state: 'start' }))
            .toBeTrue();
        expect(meter.visible).toBeTrue();
        expect(dom.style.display).toBe('');

        expect(meter.handleControlEvent({ action: 'toggleFpsMeter', state: 'start' }))
            .toBeTrue();
        expect(meter.visible).toBeFalse();
        expect(dom.style.display).toBe('none');
    });

    it('consumes toggleFpsMeter repeat and release without toggling so it never reaches the sim', () => {
        const dom = { style: { display: '' } };
        const meter = new FpsMeterToggle(dom);

        expect(meter.handleControlEvent({ action: 'toggleFpsMeter', state: 'repeat' }))
            .toBeTrue();
        expect(meter.visible).toBeFalse();
        expect(dom.style.display).toBe('none');

        expect(meter.handleControlEvent({ action: 'toggleFpsMeter', state: false }))
            .toBeTrue();
        expect(meter.visible).toBeFalse();
        expect(dom.style.display).toBe('none');
    });

    it('does not consume unrelated actions', () => {
        const dom = { style: { display: '' } };
        const meter = new FpsMeterToggle(dom);

        expect(meter.handleControlEvent({ action: 'attack', state: 'start' }))
            .toBeFalse();
        expect(meter.visible).toBeFalse();
        expect(dom.style.display).toBe('none');
    });
});
