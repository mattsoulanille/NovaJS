import 'jasmine';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import {
    NO_SHIPS_FOR_HIRE, NO_SHIPS_FOR_HIRE_INDEX, NO_SHIPS_FOR_HIRE_TABLE,
} from '../../spaceport/hire_escort.js';
import {
    ALREADY_BOARDED_MESSAGE, boardingBlockedMessage, CAPTURE_REPELLED_MESSAGE,
} from '../../display/status_bar_content.js';
import {
    busyResponseText, BUSY_RESPONSE_COUNT, BUSY_RESPONSE_FALLBACK,
    BUSY_RESPONSE_FIRST_INDEX, channelOpenText, CHANNEL_OPEN_COUNT,
    CHANNEL_OPEN_FALLBACK, CHANNEL_OPEN_FIRST_INDEX, genericGreetings,
    GENERIC_GREETING_COUNT, GENERIC_GREETING_FALLBACK,
    GENERIC_GREETING_FIRST_INDEX, greetingText, HAIL_RESPONSE_TABLE,
    HOSTILE_RESPONSE_COUNT, HOSTILE_RESPONSE_FALLBACK,
    HOSTILE_RESPONSE_FIRST_INDEX, mercyAcceptedText, MERCY_ACCEPTED_COUNT,
    MERCY_ACCEPTED_FALLBACK, MERCY_ACCEPTED_FIRST_INDEX, MISC_STRING_TABLE,
    NO_NEED_RESPONSE_COUNT, NO_NEED_RESPONSE_FALLBACK,
    NO_NEED_RESPONSE_FIRST_INDEX, NO_RESPONSE_FALLBACK, NO_RESPONSE_INDEX,
} from '../reputation/hail.js';
import {
    CANNOT_UPGRADE_TEXT, SALE_QUEUED_TEXT, UPGRADE_QUEUED_TEXT,
} from '../../spaceport/hail_dialog.js';

// These assertions run against the real Nova game data (Nova_Data). They
// pin the STR# and dësc resources the title screen and the bar read their
// text from, so a regression in the string-table accessor shows up here
// rather than as a blank dialog in the game.
describe('StringTable against real Nova data', () => {
    it('pins STR# 2002 ("misc strings")', async () => {
        const gameData = await getIntegrationGameData();
        const table = await gameData.data.StringTable.get('nova:2002');
        expect(table.name).toBe('misc strings');
        expect(table.strings.length).toBe(396);
    });

    it('sources the hire message from STR# 2002 index 223', async () => {
        const gameData = await getIntegrationGameData();
        const table = await gameData.data.StringTable.get(
            NO_SHIPS_FOR_HIRE_TABLE);
        expect(table.strings[NO_SHIPS_FOR_HIRE_INDEX])
            .toBe('There are no ships available for hire.');
        // The hardcoded fallback must stay in step with the data.
        expect(table.strings[NO_SHIPS_FOR_HIRE_INDEX])
            .toBe(NO_SHIPS_FOR_HIRE);
    });

    it('sources the boarding messages from STR# 2002 (124, 129, 130, 131)',
        async () => {
            // The one-plunder ruling's refusal is the original's catch-all
            // boarding refusal at index 129 (Matthew's ruling); index 125
            // ("Target ship has been boarded.") is the SUCCESS confirmation
            // among the boarding outcomes at 124-128 and must not be
            // confused with it.
            const gameData = await getIntegrationGameData();
            const table = await gameData.data.StringTable.get('nova:2002');
            expect(table.strings[129]).toBe(ALREADY_BOARDED_MESSAGE);
            expect(table.strings[125]).toBe('Target ship has been boarded.');
            expect(table.strings[124]).toBe(CAPTURE_REPELLED_MESSAGE);
            // The two proximity refusals, quoted verbatim from the same
            // table, so a data change shows up here rather than as
            // drifting wording. (The too-far line reads "not close
            // enough" in stock Nova, not "too far away".)
            expect(table.strings[130]).toBe(boardingBlockedMessage('tooFar'));
            expect(table.strings[131]).toBe(boardingBlockedMessage('tooFast'));
        });

    it('keeps the shipyard sibling at index 222 distinct', async () => {
        const gameData = await getIntegrationGameData();
        const table = await gameData.data.StringTable.get('nova:2002');
        // The hire string has no trailing "here"; index 222 does.
        expect(table.strings[222])
            .toBe('There are no ships available for purchase here.');
    });

    it('sources the unanswered-hail status line from STR# 2002 index 52',
        async () => {
            // What the original prints on the bottom-left status line when a
            // hail goes unanswered — which is what hailing an UNINHABITED
            // stellar (Jupiter, a dead hypergate) gets instead of a comm
            // dialog. This is the MISC table's status-line group, not STR#
            // 3000's ship "no response" group (5-9); the neighbour at 53
            // pins that reading.
            const gameData = await getIntegrationGameData();
            const table = await gameData.data.StringTable.get(MISC_STRING_TABLE);
            expect(table.strings[NO_RESPONSE_INDEX]).toBe('No response.');
            // The hardcoded fallback must stay in step with the data.
            expect(table.strings[NO_RESPONSE_INDEX]).toBe(NO_RESPONSE_FALLBACK);
            expect(table.strings[NO_RESPONSE_INDEX + 1]).toBe(
                'Unable to send hail - target ship is entering hyperspace.');
        });

    it('pins the CHANNEL-OPEN group a ship answers a fresh hail with '
        + '(STR# 3000, indices 0-4)', async () => {
            // hail/hail.png: a freshly hailed Terrapin's response well reads
            // "Channel open." with the Greetings button still unpressed.
            // Opening a channel is not a greeting — this is the group the
            // ship comm now OPENS with, the twin of STR# 3002's stellar
            // channel-open group.
            const gameData = await getIntegrationGameData();
            const table =
                await gameData.data.StringTable.get(HAIL_RESPONSE_TABLE);
            const open = table.strings.slice(CHANNEL_OPEN_FIRST_INDEX,
                CHANNEL_OPEN_FIRST_INDEX + CHANNEL_OPEN_COUNT);
            expect(open).toEqual([
                'Channel open.',
                'Communications channel open.',
                'Communications interlink established.',
                'Hailing frequencies open.',
                'Hailing channel ready.',
            ]);
            // The hardcoded fallback must stay in step with the data.
            expect(table.strings[CHANNEL_OPEN_FIRST_INDEX])
                .toBe(CHANNEL_OPEN_FALLBACK);
            // The NEXT group is "No response." — an off-by-five would open
            // every channel by telling the player nobody answered.
            expect(table.strings[CHANNEL_OPEN_FIRST_INDEX + 5])
                .toBe('No response.');
            // Every seed lands on a real line of the group.
            for (const seed of [0, 1, 2, 3, 4, 987654]) {
                expect(open).toContain(channelOpenText(table.strings, seed));
            }
        });

    it('pins the generic greeting group the Greetings button falls back on '
        + '(STR# 3000, indices 45-49)', async () => {
            // hail/greetings.png: the SAME Terrapin, after Greetings is
            // pressed, answers "Greetings." — index 47 here. It carries no
            // government, so this stock group is where a govt-less ship's
            // greeting has to come from.
            const gameData = await getIntegrationGameData();
            const table =
                await gameData.data.StringTable.get(HAIL_RESPONSE_TABLE);
            const group = table.strings.slice(GENERIC_GREETING_FIRST_INDEX,
                GENERIC_GREETING_FIRST_INDEX + GENERIC_GREETING_COUNT);
            expect(group).toEqual([
                'Nice to meet you.',
                'Hello there.',
                'Greetings.',
                'Hi there.',
                'Howdy.',
            ]);
            expect(group).toContain('Greetings.');
            expect(table.strings[GENERIC_GREETING_FIRST_INDEX])
                .toBe(GENERIC_GREETING_FALLBACK);
            // The neighbours are the dismissive replies (50-54, "Whatever.")
            // and the "wasting my time" group (65-69) — an off-by-five would
            // make every friendly hello a brush-off.
            expect(table.strings[GENERIC_GREETING_FIRST_INDEX + 5])
                .toBe('Whatever.');
            // And a govt-less ship really does reach the reference's line
            // through greetingText, not through the synthetic fallback.
            expect(greetingText({
                genericGreetings: genericGreetings(table.strings),
                talkative: true, seed: 2,
            })).toBe('Greetings.');
        });

    it('pins the bribe-accepted group (STR# 3000, indices 135-139)',
        async () => {
            // What a ship says once a beg-for-mercy demand is PAID. The comm
            // dialog shows it in place of closing the channel, so the player
            // hears the deal land and the Beg For Mercy button survives its
            // own press.
            const gameData = await getIntegrationGameData();
            const table =
                await gameData.data.StringTable.get(HAIL_RESPONSE_TABLE);
            const group = table.strings.slice(MERCY_ACCEPTED_FIRST_INDEX,
                MERCY_ACCEPTED_FIRST_INDEX + MERCY_ACCEPTED_COUNT);
            expect(group).toEqual([
                "Okay, I'll leave you alone.",
                "All right, I'll leave you alone.",
                "Okay, I'll leave you alone.",
                "All right, I'll leave you alone.",
                "Okay, I'll leave you alone.",
            ]);
            expect(table.strings[MERCY_ACCEPTED_FIRST_INDEX])
                .toBe(MERCY_ACCEPTED_FALLBACK);
            // The group BEFORE is the "Huh?" confusion set and the one after
            // is the paid-help offer — an off-by-five would have a bribed
            // pirate answer "Huh?" or demand money all over again.
            expect(table.strings[MERCY_ACCEPTED_FIRST_INDEX - 5]).toBe('Huh?');
            expect(table.strings[MERCY_ACCEPTED_FIRST_INDEX + 5]).toBe(
                "All right, I'll give you some help, but it'll cost you.");
            for (const seed of [0, 1, 2, 3, 4, 987654]) {
                expect(group)
                    .toContain(mercyAcceptedText(table.strings, seed));
            }
        });

    it('pins the ship-comm busy responses (STR# 3000, indices 80-84)',
        async () => {
            // The stock comm-response table runs in groups of five
            // interchangeable variants. The group at 75-79 GRANTS assistance
            // ("All right, I'll help you."); the group at 80-84 is the BUSY
            // refusal a ship in the middle of a fight answers with, which is
            // what hail.ts's busyResponseText draws from.
            const gameData = await getIntegrationGameData();
            const table =
                await gameData.data.StringTable.get(HAIL_RESPONSE_TABLE);
            const busy = table.strings.slice(BUSY_RESPONSE_FIRST_INDEX,
                BUSY_RESPONSE_FIRST_INDEX + BUSY_RESPONSE_COUNT);
            expect(busy).toEqual([
                "I'm busy.",
                "I'm a little busy right now.",
                "I'm too busy to help you.",
                'I have other business.',
                "I've got other things to do.",
            ]);
            // The hardcoded fallback must stay in step with the data.
            expect(table.strings[BUSY_RESPONSE_FIRST_INDEX])
                .toBe(BUSY_RESPONSE_FALLBACK);
            // The neighbouring group is the ACCEPTANCE, not another refusal —
            // an off-by-five in the index would land the dialog there.
            expect(table.strings[BUSY_RESPONSE_FIRST_INDEX - 5])
                .toBe("All right, I'll help you.");
        });

    it('answers every busy seed with a real line from the stock table',
        async () => {
            const gameData = await getIntegrationGameData();
            const table =
                await gameData.data.StringTable.get(HAIL_RESPONSE_TABLE);
            const busy = table.strings.slice(BUSY_RESPONSE_FIRST_INDEX,
                BUSY_RESPONSE_FIRST_INDEX + BUSY_RESPONSE_COUNT);
            for (const seed of [0, 1, 2, 3, 4, 987654]) {
                expect(busy).toContain(busyResponseText(table.strings, seed));
            }
        });

    it('pins the "you don\'t need help" responses (STR# 3000, indices 70-74)',
        async () => {
            // What a ship answers a POINTLESS assistance request with — the
            // player asked for aid they don't need. Matthew: "it should show
            // request assistance even if there's no reason for you to request
            // it (they usually just tell you that you don't need help)."
            const gameData = await getIntegrationGameData();
            const table =
                await gameData.data.StringTable.get(HAIL_RESPONSE_TABLE);
            const noNeed = table.strings.slice(NO_NEED_RESPONSE_FIRST_INDEX,
                NO_NEED_RESPONSE_FIRST_INDEX + NO_NEED_RESPONSE_COUNT);
            expect(noNeed).toEqual([
                "You're not in any trouble.",
                "You're in no danger.",
                "You don't have any problems.",
                'It looks like you\'re sitting pretty from here.  Try helping '
                + 'yourself.',
                "There's no danger to you right now.",
            ]);
            // The hardcoded fallback must stay in step with the data.
            expect(table.strings[NO_NEED_RESPONSE_FIRST_INDEX])
                .toBe(NO_NEED_RESPONSE_FALLBACK);
            // The group immediately AFTER is the acceptance ("All right, I'll
            // help you.") — an off-by-five would agree to a pointless errand.
            expect(table.strings[NO_NEED_RESPONSE_FIRST_INDEX + 5])
                .toBe("All right, I'll help you.");
        });

    it('pins the hostile hail responses (STR# 3000, indices 10-14)',
        async () => {
            // A hostile ship answers a hail from this GLOBAL group, not from
            // its government's greeting STR# (7000 + govtId - 128, which holds
            // only friendly greetings). hail/hail_hostile.png shows a hostile
            // Fed Destroyer answering "What is it?" — index 12/13 here.
            const gameData = await getIntegrationGameData();
            const table =
                await gameData.data.StringTable.get(HAIL_RESPONSE_TABLE);
            const hostile = table.strings.slice(HOSTILE_RESPONSE_FIRST_INDEX,
                HOSTILE_RESPONSE_FIRST_INDEX + HOSTILE_RESPONSE_COUNT);
            expect(hostile).toEqual([
                'What is it you want?',
                'What do you want?',
                'What is it?',
                'What is it?',
                'What?',
            ]);
            expect(hostile).toContain('What is it?');
            // The hardcoded fallback must stay in step with the data.
            expect(table.strings[HOSTILE_RESPONSE_FIRST_INDEX])
                .toBe(HOSTILE_RESPONSE_FALLBACK);
            // The neighbours are the "no response" group (5-9) before — under
            // it the "channel open" group (0-4) — and the hostile TAUNTS
            // (15-19) after. An off-by-five would answer a hostile hail with
            // "No response." or a taunt aimed at a mercy plea.
            expect(table.strings[HOSTILE_RESPONSE_FIRST_INDEX - 5])
                .toBe('No response.');
            expect(table.strings[HOSTILE_RESPONSE_FIRST_INDEX - 10])
                .toBe('Channel open.');
            expect(table.strings[HOSTILE_RESPONSE_FIRST_INDEX + 5])
                .toBe('Calling to beg for your life?');
        });

    it('keeps the per-govt greeting tables friendly (STR# 7000 = Federation)',
        async () => {
            // Why the hostile line cannot come from the govt greetings: the
            // govt tables are ten LINES OF GREETING, one table per government
            // (7000 + govtId - 128), with nothing hostile in them.
            const gameData = await getIntegrationGameData();
            const table = await gameData.data.StringTable.get('nova:7000');
            expect(table.name).toBe('Federation');
            expect(table.strings.length).toBe(10);
            expect(table.strings[1])
                .toBe('Greetings from the government of the Federation.');
            expect(table.strings).not.toContain('What is it?');
        });

    it('pins the ESCORT BOX\'s readout lines (STR# 2002, 291-296)',
        async () => {
            // The escort management box's upper well (PICT 8513) is built
            // out of six consecutive misc strings, and the table keeps them
            // in exactly the row order the references draw them in:
            // the upgrade slot (a price, or one of the two status lines),
            // then the sale slot, then the wage.
            //
            // The two "Will be ..." lines are what replace a price when the
            // player queues that deal — hail/hail_escort_upgrading.png and
            // hail/sell_captured_escort.png — and 293 is what the upgrade
            // slot says for a class that has nowhere to go. All three are
            // reproduced VERBATIM by spaceport/hail_dialog.ts; this is the
            // spec that keeps them in step with the data.
            const gameData = await getIntegrationGameData();
            const table = await gameData.data.StringTable.get(
                MISC_STRING_TABLE);
            expect(table.strings.slice(291, 297)).toEqual([
                'Will be upgraded at next shipyard',
                'Upgrade Cost:',
                'This ship class cannot be upgraded.',
                'Will be sold off at next shipyard',
                'Sell Price:',
                'Pay:',
            ]);
            expect(table.strings[291]).toBe(UPGRADE_QUEUED_TEXT);
            expect(table.strings[293]).toBe(CANNOT_UPGRADE_TEXT);
            expect(table.strings[294]).toBe(SALE_QUEUED_TEXT);
        });

    it('pins the escort box\'s BUTTON CAPTIONS, including the two Cancel '
        + 'twins (STR# 150, 51-54)', async () => {
            // The toggle is the original's: 51/52 are the same button
            // before and after the deal is queued, and 53/54 likewise.
            const gameData = await getIntegrationGameData();
            const table = await gameData.data.StringTable.get('nova:150');
            expect(table.name).toBe('button labels');
            expect(table.strings.slice(51, 55)).toEqual([
                'Upgrade Escort',
                'Cancel Upgrade',
                'Sell Escort',
                'Cancel Sale',
            ]);
            // ...and the other two rows of the column.
            expect(table.strings[31]).toBe('Release');
            expect(table.strings[20]).toBe('Close Channel');
        });

    it('keeps the DEFERRED settlement\'s own messages in the table, which '
        + 'is where the sums are named (STR# 2002, 297-300)', async () => {
            // The evidence that the money moves at the SHIPYARD rather than
            // over the comm channel: the original's report of a settled
            // deal is assembled from these, and it is printed when the
            // player lands, not when they press the button. See
            // spaceport/escort_deals.ts.
            const gameData = await getIntegrationGameData();
            const table = await gameData.data.StringTable.get(
                MISC_STRING_TABLE);
            expect(table.strings.slice(297, 301)).toEqual([
                'escort was',
                'escorts were',
                'sold for a profit of',
                'upgraded at a cost of',
            ]);
        });

    it('exposes string tables in the id list', async () => {
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        expect(ids.StringTable).toContain('nova:2002');
    });
});

describe('About text against real Nova data', () => {
    // The About box text is NOT in a STR# table: the original reads it
    // from dësc 32767 (credits) and dësc 32766 (special thanks).
    it('pins the credits dësc (nova:32767)', async () => {
        const gameData = await getIntegrationGameData();
        const desc = await gameData.data.Description.get('nova:32767');
        expect(desc.text.startsWith('Escape Velocity:  Nova')).toBeTrue();
        expect(desc.text).toContain('(c)1996-2008 Ambrosia Software, Inc.');
        expect(desc.text).toContain('Engine Programming:');
        expect(desc.text).toContain('Matt Burch');
        expect(desc.text).toContain('ATMOS Software Productions');
    });

    it('pins the special-thanks dësc (nova:32766)', async () => {
        const gameData = await getIntegrationGameData();
        const desc = await gameData.data.Description.get('nova:32766');
        expect(desc.text).toContain('ATMOS would like to thank Ambrosia');
    });

    it('normalizes classic-Mac line endings to \\n', async () => {
        const gameData = await getIntegrationGameData();
        const desc = await gameData.data.Description.get('nova:32767');
        expect(desc.text).not.toContain('\r');
        expect(desc.text).toContain('\n');
    });

    it('carries the <REG> placeholder the dialog substitutes', async () => {
        const gameData = await getIntegrationGameData();
        const desc = await gameData.data.Description.get('nova:32767');
        expect(desc.text).toContain('<REG>');
    });
});
