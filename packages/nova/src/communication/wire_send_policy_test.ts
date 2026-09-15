import 'jasmine';
import {
    defaultWireSendPolicy, isWireSendPolicy, reportUncarriable,
    UncarriableMessageError, wireSendPolicyFor,
} from './wire_send_policy.js';

/**
 * The ruling on #272: an outgoing message the wire schema cannot carry
 * is a hard error in development and a dropped-with-a-warning in
 * production, and the switch is NODE_ENV (`npm run start:prod`).
 */
describe('wire send policy', () => {
    it('is strict unless NODE_ENV is production', () => {
        expect(wireSendPolicyFor(undefined)).toBe('strict');
        expect(wireSendPolicyFor('')).toBe('strict');
        expect(wireSendPolicyFor('development')).toBe('strict');
        expect(wireSendPolicyFor('test')).toBe('strict');
        expect(wireSendPolicyFor('production')).toBe('recover');
    });

    it('is strict under the spec runner (not a production build)', () => {
        expect(process.env.NODE_ENV).not.toBe('production');
        expect(defaultWireSendPolicy()).toBe('strict');
    });

    it('follows NODE_ENV in this process', () => {
        const nodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            expect(defaultWireSendPolicy()).toBe('recover');
        } finally {
            if (nodeEnv === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = nodeEnv;
            }
        }
        expect(defaultWireSendPolicy()).toBe('strict');
    });

    it('recognizes its own values and nothing else', () => {
        expect(isWireSendPolicy('strict')).toBeTrue();
        expect(isWireSendPolicy('recover')).toBeTrue();
        expect(isWireSendPolicy('production')).toBeFalse();
        expect(isWireSendPolicy(undefined)).toBeFalse();
        expect(isWireSendPolicy(null)).toBeFalse();
    });

    describe('reportUncarriable', () => {
        it('throws under strict, naming the message and the way out', () => {
            const warn = jasmine.createSpy('warn');
            expect(() => reportUncarriable('strict', warn, 'Not sending X: bad tick'))
                .toThrowMatching(error => error instanceof UncarriableMessageError
                    && /Not sending X: bad tick/.test(error.message)
                    && /npm run start:prod/.test(error.message));
            expect(warn).not.toHaveBeenCalled();
        });

        it('warns under recover and returns', () => {
            const warn = jasmine.createSpy('warn');
            expect(() => reportUncarriable('recover', warn, 'Not sending X: bad tick'))
                .not.toThrow();
            expect(warn).toHaveBeenCalledOnceWith('Not sending X: bad tick');
        });
    });
});
