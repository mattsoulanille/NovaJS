import 'jasmine';
import { displayName, govtTargetName } from './display_name.js';

describe('displayName', () => {
    it('drops the "; developer note" suffix', () => {
        // Real mïsn names from Nova Data 1 (space after the ';').
        expect(displayName('Delivery to Earth; Vellos1'))
            .toEqual('Delivery to Earth');
        expect(displayName('Rescue Rebel; Vellos8a')).toEqual('Rescue Rebel');
        // ...and without the space (Polaris string chain).
        expect(displayName('Transport Mu\'Randa;Polaris1'))
            .toEqual('Transport Mu\'Randa');
    });

    it('handles govt and rank names too', () => {
        // Nova Data 1 govt / Nova Data 2 rank names carry the same suffix.
        expect(displayName('Federation;hates Temmin Shard'))
            .toEqual('Federation');
        expect(displayName('T5; Vell-os 1')).toEqual('T5');
    });

    it('leaves plain names untouched', () => {
        expect(displayName('Starbridge')).toEqual('Starbridge');
        expect(displayName('Laser Cannon')).toEqual('Laser Cannon');
    });

    it('trims whitespace around the visible part', () => {
        expect(displayName('Viper ; internal')).toEqual('Viper');
        expect(displayName('  Spaced Out  ')).toEqual('Spaced Out');
    });

    it('yields an empty string when the note is the whole name', () => {
        expect(displayName(';dev-only')).toEqual('');
    });
});

describe('govtTargetName', () => {
    it('prefers the short Target Code over the full name', () => {
        // Real gövt data: Pyrogenesis Skymining (nova:173).
        expect(govtTargetName({
            targetCode: 'Pyro', name: 'Pyrogenesis Skymining',
        })).toEqual('Pyro');
    });

    it('trims the Target Code\'s leading padding', () => {
        // Several stock target codes are space-padded in the data.
        expect(govtTargetName({ targetCode: ' Fed.', name: 'Federation' }))
            .toEqual('Fed.');
        expect(govtTargetName({ targetCode: ' Vell-os', name: 'Vell-os' }))
            .toEqual('Vell-os');
    });

    it('strips a "; note" suffix from either field', () => {
        expect(govtTargetName({
            targetCode: 'Pyro;internal', name: 'Pyrogenesis',
        })).toEqual('Pyro');
        expect(govtTargetName({
            targetCode: '', name: 'Federation;hates Temmin Shard',
        })).toEqual('Federation');
    });

    it('falls back to the full name when the code is empty or blank', () => {
        expect(govtTargetName({ targetCode: '', name: 'Rebel Alliance' }))
            .toEqual('Rebel Alliance');
        expect(govtTargetName({ targetCode: '   ', name: 'Rebel Alliance' }))
            .toEqual('Rebel Alliance');
    });
});
