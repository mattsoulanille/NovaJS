/**
 * Human-readable labels for KeyboardEvent.code values, for the
 * preferences keybinding UI. Bindings are stored as event.code
 * strings (see controls.json); these turn them into the short glyphs
 * the original's prefs panel shows ("↑", "Space", "A", ...).
 */

const SPECIAL_LABELS: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    Enter: '↵',
    NumpadEnter: '↵',
    Tab: '⇥',
    Escape: 'Esc',
    Backspace: '⌫',
    Delete: '⌦',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: '\'',
    Comma: ',',
    Period: '.',
    Slash: '/',
    ControlLeft: '⌃',
    ControlRight: '⌃',
    ShiftLeft: '⇧',
    ShiftRight: '⇧',
    AltLeft: '⌥',
    AltRight: '⌥',
    MetaLeft: '⌘',
    MetaRight: '⌘',
    CapsLock: '⇪',
};

const MODIFIER_LABELS: Record<string, string> = {
    Control: '⌃',
    Alt: '⌥',
    Shift: '⇧',
    Meta: '⌘',
};

/** The short label for a stored event.code binding (empty for none). */
export function keyLabel(code: string | undefined): string {
    if (!code) {
        return '';
    }
    if (SPECIAL_LABELS[code]) {
        return SPECIAL_LABELS[code];
    }
    // KeyA -> A, Digit1 -> 1, F12 -> F12, Numpad5 -> Num 5
    const key = code.match(/^Key([A-Z])$/);
    if (key) {
        return key[1];
    }
    const digit = code.match(/^Digit(\d)$/);
    if (digit) {
        return digit[1];
    }
    const fkey = code.match(/^F\d{1,2}$/);
    if (fkey) {
        return code;
    }
    const numpad = code.match(/^Numpad(.+)$/);
    if (numpad) {
        return `Num ${numpad[1]}`;
    }
    return code;
}

/** The short label for a binding including any required modifier glyphs (e.g. "⌥F"). */
export function bindingLabel(
    binding: { key: string; modifiers?: readonly string[] } | undefined): string {
    if (!binding?.key) {
        return '';
    }
    const mods = (binding.modifiers ?? [])
        .map(modifier => MODIFIER_LABELS[modifier] ?? `${modifier}+`)
        .join('');
    return `${mods}${keyLabel(binding.key)}`;
}
