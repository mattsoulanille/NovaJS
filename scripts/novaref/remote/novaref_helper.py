# -*- coding: utf-8 -*-
"""novaref remote helper: runs on the reference Mac (macOS 10.13, system
/usr/bin/python 2.7 + PyObjC Quartz). Uploaded to ~/novaref by the novaref
CLI; every subcommand prints exactly one JSON line on stdout.

Input is posted with CGEventPost at kCGHIDEventTap from an event source in
kCGEventSourceStateHIDSystemState, so it updates the HID key state that a
game polling the keyboard per frame (GetKeys / CGEventSourceKeyState) reads,
not just the event queue. Events go to whichever app is frontmost; the CLI
activates EV Nova first.

Coordinates are global display points, origin top-left of the main display
(the same frame as CGWindowListCopyWindowInfo bounds).

Subcommands:
  [--front <bundle-id>]      prefix: activate that app and verify it is
                             frontmost before posting any input
  info                       screen size, console user, lock/sleep state,
                             mouse position, frontmost app, EV Nova windows
  keys <json-steps>          see parse in the CLI; steps are
                             {"k": "Return", "mods": [...], "hold": ms}
                             {"down": "Up"} / {"up": "Up"}
                             {"text": "abc"} / {"wait": ms}
                             global options: {"gap": ms} between steps
  click x y [button] [count] [hold_ms]
  drag x1 y1 x2 y2 [steps] [ms]
  move x y
"""
from __future__ import print_function

import json
import sys
import time

import Quartz

# US-layout virtual key codes (HIToolbox Events.h, kVK_*).
KEYCODES = {
    'a': 0x00, 's': 0x01, 'd': 0x02, 'f': 0x03, 'h': 0x04, 'g': 0x05,
    'z': 0x06, 'x': 0x07, 'c': 0x08, 'v': 0x09, 'b': 0x0B, 'q': 0x0C,
    'w': 0x0D, 'e': 0x0E, 'r': 0x0F, 'y': 0x10, 't': 0x11, '1': 0x12,
    '2': 0x13, '3': 0x14, '4': 0x15, '6': 0x16, '5': 0x17, '=': 0x18,
    '9': 0x19, '7': 0x1A, '-': 0x1B, '8': 0x1C, '0': 0x1D, ']': 0x1E,
    'o': 0x1F, 'u': 0x20, '[': 0x21, 'i': 0x22, 'p': 0x23, 'l': 0x25,
    'j': 0x26, "'": 0x27, 'k': 0x28, ';': 0x29, '\\': 0x2A, ',': 0x2B,
    '/': 0x2C, 'n': 0x2D, 'm': 0x2E, '.': 0x2F, '`': 0x32,
    'return': 0x24, 'enter': 0x24, 'tab': 0x30, 'space': 0x31,
    'delete': 0x33, 'backspace': 0x33, 'escape': 0x35, 'esc': 0x35,
    'command': 0x37, 'cmd': 0x37, 'shift': 0x38, 'capslock': 0x39,
    'option': 0x3A, 'alt': 0x3A, 'control': 0x3B, 'ctrl': 0x3B,
    'rightshift': 0x3C, 'rightoption': 0x3D, 'rightcontrol': 0x3E,
    'function': 0x3F, 'fn': 0x3F,
    'kpenter': 0x4C, 'kp0': 0x52, 'kp1': 0x53, 'kp2': 0x54, 'kp3': 0x55,
    'kp4': 0x56, 'kp5': 0x57, 'kp6': 0x58, 'kp7': 0x59, 'kp8': 0x5B,
    'kp9': 0x5C, 'kp.': 0x41, 'kp*': 0x43, 'kp+': 0x45, 'kp-': 0x4E,
    'kp/': 0x4B, 'kp=': 0x51, 'kpclear': 0x47,
    'f1': 0x7A, 'f2': 0x78, 'f3': 0x63, 'f4': 0x76, 'f5': 0x60,
    'f6': 0x61, 'f7': 0x62, 'f8': 0x64, 'f9': 0x65, 'f10': 0x6D,
    'f11': 0x67, 'f12': 0x6F, 'f13': 0x69, 'f14': 0x6B, 'f15': 0x71,
    'help': 0x72, 'home': 0x73, 'pageup': 0x74, 'forwarddelete': 0x75,
    'end': 0x77, 'pagedown': 0x79,
    'left': 0x7B, 'right': 0x7C, 'down': 0x7D, 'up': 0x7E,
}

MOD_KEYS = {
    'cmd': (0x37, Quartz.kCGEventFlagMaskCommand),
    'command': (0x37, Quartz.kCGEventFlagMaskCommand),
    'shift': (0x38, Quartz.kCGEventFlagMaskShift),
    'opt': (0x3A, Quartz.kCGEventFlagMaskAlternate),
    'option': (0x3A, Quartz.kCGEventFlagMaskAlternate),
    'alt': (0x3A, Quartz.kCGEventFlagMaskAlternate),
    'ctrl': (0x3B, Quartz.kCGEventFlagMaskControl),
    'control': (0x3B, Quartz.kCGEventFlagMaskControl),
}

SOURCE = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStateHIDSystemState)
TAP = Quartz.kCGHIDEventTap


def _host_clock():
    """Seconds on the host clock (mach_absolute_time). ffmpeg's avfoundation
    input stamps captured frames on the same clock and prints the first
    one as "start:", so an event's host time minus that start is its time
    in the recording."""
    import ctypes

    class TB(ctypes.Structure):
        _fields_ = [('numer', ctypes.c_uint32), ('denom', ctypes.c_uint32)]
    lib = ctypes.CDLL('/usr/lib/libSystem.dylib')
    lib.mach_absolute_time.restype = ctypes.c_uint64
    tb = TB()
    lib.mach_timebase_info(ctypes.byref(tb))
    scale = tb.numer / float(tb.denom) / 1e9
    return lambda: lib.mach_absolute_time() * scale


host_now = _host_clock()
# (host time, "down"/"up"/"click"/..., key or "x,y") for every input event
# this invocation posted; returned as "events_t" so a run can stamp each
# key with the recording frame it landed in.
EVENT_TIMES = []


def stamp(kind, what):
    EVENT_TIMES.append([round(host_now(), 4), kind, what])


def out(obj):
    obj = dict(obj)
    obj['t_host'] = round(host_now(), 4)
    if EVENT_TIMES and obj.get('ok'):
        obj['events_t'] = EVENT_TIMES
    print(json.dumps(obj, sort_keys=True))
    sys.stdout.flush()


def sleep_ms(ms):
    if ms > 0:
        time.sleep(ms / 1000.0)


def keycode(name):
    n = name.lower()
    if n in KEYCODES:
        return KEYCODES[n]
    raise ValueError('unknown key %r' % name)


# Modifier flags currently held down by explicit {"down": "shift"} steps,
# applied to every key event so the app sees a consistent state.
held_flags = [0]


def post_key(code, down, flags):
    ev = Quartz.CGEventCreateKeyboardEvent(SOURCE, code, down)
    Quartz.CGEventSetFlags(ev, flags | held_flags[0])
    Quartz.CGEventPost(TAP, ev)


def press(name, mods, hold_ms):
    flags = 0
    mod_codes = []
    for m in mods:
        code, flag = MOD_KEYS[m.lower()]
        flags |= flag
        mod_codes.append(code)
    stamp('press', '+'.join(list(mods) + [name]))
    press_code(keycode(name), flags, mod_codes, hold_ms)


def press_code(code, flags, mod_codes, hold_ms):
    # Modifier keys go down as real key events first (a polling game sees
    # them in the HID state), then the key with the flags set.
    for mc in mod_codes:
        post_key(mc, True, 0)
    if mod_codes:
        sleep_ms(15)
    post_key(code, True, flags)
    sleep_ms(hold_ms)
    post_key(code, False, flags)
    if mod_codes:
        sleep_ms(15)
    for mc in reversed(mod_codes):
        post_key(mc, False, 0)


SHIFTED = {
    '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6',
    '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[',
    '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
}


def char_key(ch):
    """(keycode, shift) for a printable ASCII char on the US layout."""
    if ch == ' ':
        return KEYCODES['space'], False
    if ch == '\n':
        return KEYCODES['return'], False
    if ch == '\t':
        return KEYCODES['tab'], False
    if ch in SHIFTED:
        return KEYCODES[SHIFTED[ch]], True
    if ch.isupper() and ch.lower() in KEYCODES:
        return KEYCODES[ch.lower()], True
    if ch in KEYCODES:
        return KEYCODES[ch], False
    raise ValueError('cannot type %r (US-layout ASCII only)' % ch)


def type_text(text, hold_ms, gap_ms):
    """Types text for text fields (file dialogs, pilot names) as real
    keycodes on the US layout, with shift where needed. (The PyObjC on 10.13
    cannot call CGEventKeyboardSetUnicodeString, so no non-ASCII.)"""
    for ch in text:
        code, shift = char_key(ch)
        press_code(code, Quartz.kCGEventFlagMaskShift if shift else 0,
                   [KEYCODES['shift']] if shift else [], hold_ms)
        sleep_ms(gap_ms)


def cmd_keys(spec):
    steps = json.loads(spec)
    gap = 60
    hold = 80
    posted = 0
    for st in steps:
        if 'gap' in st:
            gap = st['gap']
            continue
        if 'hold_default' in st:
            hold = st['hold_default']
            continue
        if 'wait' in st:
            sleep_ms(st['wait'])
            continue
        if 'text' in st:
            stamp('text', st['text'][:40])
            type_text(st['text'], min(hold, 30), min(gap, 30))
            posted += len(st['text'])
        elif 'down' in st or 'up' in st:
            down = 'down' in st
            name = st['down'] if down else st['up']
            stamp('down' if down else 'up', name)
            n = name.lower()
            if n in MOD_KEYS:
                code, flag = MOD_KEYS[n]
                if down:
                    held_flags[0] |= flag
                else:
                    held_flags[0] &= ~flag
                post_key(code, down, 0)
            else:
                post_key(keycode(name), down, 0)
            posted += 1
        else:
            for _ in range(st.get('repeat', 1)):
                press(st['k'], st.get('mods', []), st.get('hold', hold))
                posted += 1
                sleep_ms(gap)
            continue
        sleep_ms(gap)
    out({'ok': True, 'cmd': 'keys', 'events': posted})


BUTTONS = {
    'left': (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp,
             Quartz.kCGEventLeftMouseDragged, Quartz.kCGMouseButtonLeft),
    'right': (Quartz.kCGEventRightMouseDown, Quartz.kCGEventRightMouseUp,
              Quartz.kCGEventRightMouseDragged, Quartz.kCGMouseButtonRight),
}


def mouse(kind, x, y, button):
    ev = Quartz.CGEventCreateMouseEvent(SOURCE, kind, (x, y), button)
    return ev


def cmd_move(x, y):
    Quartz.CGEventPost(TAP, mouse(Quartz.kCGEventMouseMoved, x, y, 0))
    out({'ok': True, 'cmd': 'move', 'x': x, 'y': y})


def cmd_click(x, y, button='left', count=1, hold_ms=60, mods=''):
    """Click; `mods` ("shift", "ctrl+opt", ...) holds those modifier keys
    down as real key events around the click and sets their flags on the
    mouse events, so a polling game sees them too."""
    down_t, up_t, _, btn = BUTTONS[button]
    flags = 0
    mod_codes = []
    for m in [m for m in mods.split('+') if m]:
        code, flag = MOD_KEYS[m.lower()]
        flags |= flag
        mod_codes.append(code)
    Quartz.CGEventPost(TAP, mouse(Quartz.kCGEventMouseMoved, x, y, btn))
    sleep_ms(40)
    for mc in mod_codes:
        post_key(mc, True, flags)
    if mod_codes:
        sleep_ms(60)
    for i in range(count):
        for kind in (down_t, up_t):
            ev = mouse(kind, x, y, btn)
            Quartz.CGEventSetIntegerValueField(
                ev, Quartz.kCGMouseEventClickState, i + 1)
            if flags:
                Quartz.CGEventSetFlags(ev, flags)
            if kind == down_t:
                stamp('click', '%s%s,%s' % (mods + '-' if mods else '', x, y))
            elif hold_ms > 200:
                # A long press (wave 12, held scroll arrows): stamp the
                # release too, so a recording can be cut at both ends.
                stamp('clickup', '%s,%s' % (x, y))
            Quartz.CGEventPost(TAP, ev)
            sleep_ms(hold_ms if kind == down_t else 40)
    if mod_codes:
        sleep_ms(60)
    for mc in reversed(mod_codes):
        post_key(mc, False, 0)
    out({'ok': True, 'cmd': 'click', 'x': x, 'y': y, 'button': button,
         'count': count, 'mods': mods})


def cmd_wheel(x, y, dy, count=1, gap_ms=100):
    """Mouse wheel (wave 12): moves the pointer to (x, y), then posts
    `count` scroll-wheel events of `dy` LINES each (positive = up/away from
    the user, the macOS convention for a non-natural wheel), `gap_ms`
    apart. Each event is stamped."""
    Quartz.CGEventPost(TAP, mouse(Quartz.kCGEventMouseMoved, x, y, 0))
    sleep_ms(40)
    for i in range(count):
        ev = Quartz.CGEventCreateScrollWheelEvent(
            SOURCE, Quartz.kCGScrollEventUnitLine, 1, int(dy))
        Quartz.CGEventSetLocation(ev, (x, y))
        stamp('wheel', '%s@%s,%s' % (dy, x, y))
        Quartz.CGEventPost(TAP, ev)
        if i + 1 < count:
            sleep_ms(gap_ms)
    out({'ok': True, 'cmd': 'wheel', 'x': x, 'y': y, 'dy': dy,
         'count': count})


def cmd_drag(x1, y1, x2, y2, steps=20, ms=400):
    down_t, up_t, drag_t, btn = BUTTONS['left']
    Quartz.CGEventPost(TAP, mouse(Quartz.kCGEventMouseMoved, x1, y1, btn))
    sleep_ms(40)
    stamp('drag', '%s,%s' % (x1, y1))
    Quartz.CGEventPost(TAP, mouse(down_t, x1, y1, btn))
    sleep_ms(60)
    for i in range(1, steps + 1):
        x = x1 + (x2 - x1) * i / float(steps)
        y = y1 + (y2 - y1) * i / float(steps)
        Quartz.CGEventPost(TAP, mouse(drag_t, x, y, btn))
        sleep_ms(ms / float(steps))
    Quartz.CGEventPost(TAP, mouse(up_t, x2, y2, btn))
    out({'ok': True, 'cmd': 'drag', 'from': [x1, y1], 'to': [x2, y2]})


def frontmost_app():
    try:
        from AppKit import NSWorkspace
        app = NSWorkspace.sharedWorkspace().frontmostApplication()
        return {'name': app.localizedName(), 'pid': app.processIdentifier(),
                'bundle': app.bundleIdentifier()}
    except Exception as e:  # pragma: no cover
        return {'error': str(e)}


def nova_windows():
    wins = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly
        | Quartz.kCGWindowListExcludeDesktopElements, Quartz.kCGNullWindowID)
    res = []
    for w in wins or []:
        owner = w.get('kCGWindowOwnerName') or ''
        if 'nova' not in owner.lower() or 'graphics' in owner.lower():
            continue
        b = w.get('kCGWindowBounds')
        res.append({
            'owner': owner, 'pid': int(w.get('kCGWindowOwnerPID')),
            'name': w.get('kCGWindowName') or '',
            'layer': int(w.get('kCGWindowLayer')),
            'bounds': [int(b['X']), int(b['Y']), int(b['Width']),
                       int(b['Height'])],
        })
    return res


def cmd_info():
    did = Quartz.CGMainDisplayID()
    b = Quartz.CGDisplayBounds(did)
    mode = Quartz.CGDisplayCopyDisplayMode(did)
    sess = Quartz.CGSessionCopyCurrentDictionary() or {}
    loc = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    out({
        'ok': True, 'cmd': 'info',
        'screen_points': [int(b.size.width), int(b.size.height)],
        'screen_pixels': [int(Quartz.CGDisplayModeGetPixelWidth(mode)),
                          int(Quartz.CGDisplayModeGetPixelHeight(mode))],
        'console_user': sess.get('kCGSSessionUserNameKey'),
        'on_console': bool(sess.get('kCGSSessionOnConsoleKey')),
        'screen_locked': bool(sess.get('CGSSessionScreenIsLocked', False)),
        'display_asleep': bool(Quartz.CGDisplayIsAsleep(did)),
        'mouse': [round(loc.x, 1), round(loc.y, 1)],
        'frontmost': frontmost_app(),
        'nova_windows': nova_windows(),
    })


def ensure_front(bundle_id):
    """Activates the app with bundle_id and waits until it is frontmost, so
    posted input cannot land in some other app."""
    from AppKit import NSRunningApplication, \
        NSApplicationActivateIgnoringOtherApps
    apps = NSRunningApplication.runningApplicationsWithBundleIdentifier_(
        bundle_id)
    if not apps:
        raise RuntimeError('%s is not running' % bundle_id)
    for _ in range(20):
        if frontmost_app().get('bundle') == bundle_id:
            return
        apps[0].activateWithOptions_(NSApplicationActivateIgnoringOtherApps)
        sleep_ms(150)
    raise RuntimeError('could not bring %s to the front (frontmost: %s)'
                       % (bundle_id, frontmost_app().get('name')))


def main(argv):
    front = None
    if argv[:1] == ['--front']:
        front, argv = argv[1], argv[2:]
    if not argv:
        raise SystemExit(__doc__)
    cmd, args = argv[0], argv[1:]
    try:
        if front:
            ensure_front(front)
        if cmd == 'info':
            cmd_info()
        elif cmd == 'keys':
            cmd_keys(args[0])
        elif cmd == 'click':
            cmd_click(float(args[0]), float(args[1]),
                      args[2] if len(args) > 2 else 'left',
                      int(args[3]) if len(args) > 3 else 1,
                      int(args[4]) if len(args) > 4 else 60,
                      args[5] if len(args) > 5 else '')
        elif cmd == 'drag':
            cmd_drag(float(args[0]), float(args[1]), float(args[2]),
                     float(args[3]),
                     int(args[4]) if len(args) > 4 else 20,
                     int(args[5]) if len(args) > 5 else 400)
        elif cmd == 'move':
            cmd_move(float(args[0]), float(args[1]))
        elif cmd == 'wheel':
            cmd_wheel(float(args[0]), float(args[1]), int(args[2]),
                      int(args[3]) if len(args) > 3 else 1,
                      int(args[4]) if len(args) > 4 else 100)
        elif cmd == 'clock':
            out({'ok': True, 'cmd': 'clock'})
        else:
            out({'ok': False, 'error': 'unknown helper command %s' % cmd})
            return 2
    except Exception as e:
        out({'ok': False, 'cmd': cmd, 'error': '%s: %s' % (
            type(e).__name__, e)})
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
