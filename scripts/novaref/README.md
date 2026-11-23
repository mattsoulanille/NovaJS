# novaref: drive the original EV Nova on the reference Mac

`novaref` runs scripted experiments against the original EV Nova 1.1.1 on
Matthew's reference Mac (iMac11,3, macOS 10.13.6, 1920x1080 desktop). Use it
as ground truth for gameplay logic. It is a single node script with no
dependencies outside the node standard library. Everything goes from the
MacBook to the old Mac over ssh/scp, because the old Mac is on an isolated
VLAN with no internet and cannot connect back.

```sh
node scripts/novaref/novaref.mjs status
alias novaref="node $PWD/scripts/novaref/novaref.mjs"   # optional
```

Every subcommand prints **one JSON line** on stdout (`{"ok":true,"cmd":...}`).
Diagnostics go to stderr. The exit code is 0 when `ok` is true and 1 otherwise.

## Config

The first run creates `~/.config/novaref/config.json` from defaults. Edit it
to change any of these:

| key | default |
|---|---|
| `host` / `user` | `10.77.0.2` / `matthew` |
| `identityFile` | `~/.ssh/fox`, used with `IdentitiesOnly=yes`, `BatchMode=yes` |
| `remoteDir` | `novaref` (`~/novaref` on the old Mac; nothing is installed anywhere else) |
| `app` / `bundleId` | `/Applications/EV Nova.app` / `com.AmbrosiaSW.EV_Nova` |
| `pilotsDir` | `Library/Application Support/EV Nova/Pilots` |
| `keyHoldMs` / `keyGapMs` | `80` / `60` |
| `ffmpeg` | `novaref/bin/ffmpeg` (the hub-built ffmpeg; do not replace it) |

ssh connections are multiplexed through a ControlMaster socket in
`~/.config/novaref/cm/` that persists for 120 s, so a call costs about 0.1 s
once the socket is up. The remote helper (`remote/novaref_helper.py`, which
runs on the system Python 2.7 with PyObjC Quartz) is uploaded to `~/novaref`
on first use and again whenever its sha1 changes.

## Subcommands

| command | what it does |
|---|---|
| `status` | Reachability, ssh round-trip time, console user, screen lock, display sleep, whether EV Nova is running (and its PIDs), the frontmost app, screen size in points and pixels, EV Nova's window and content rects, and the mouse position. |
| `shot [out.png] [--window \| --rect x,y,w,h]` | Lossless PNG from `screencapture -x`, copied back with scp. `--window` crops to EV Nova's content area. |
| `keys "<seq>" [--hold ms] [--gap ms] [--any-app]` | Posts exact key events (grammar below). It first activates EV Nova and checks that EV Nova is frontmost, so keys can never land in another app. `--any-app` turns that check off. |
| `click x y [--win] [--right] [--double]` | Mouse click. Coordinates are screen points, or EV Nova content coordinates with `--win`. |
| `drag x1 y1 x2 y2 [--win] [--ms N]` | Left-button drag sent as 20 interpolated drag events. |
| `move x y [--win]` | Moves the mouse. Use it to park the cursor out of a shot. |
| `launch` / `quit [--force]` / `restart` | Launches with `open -a` and waits for the window. Quits with an AppleScript `quit` and confirms the game's own "Are you sure you want to quit?" alert with Return. If the game still won't quit, it kills only PIDs that novaref launched; `--force` lets it kill any EV Nova PID. |
| `pilots list` | Lists pilots with data and resource-fork sizes, mtimes, and which ones novaref manages. |
| `pilots pull <name> [dest] [--raw]` | Copies a pilot back with its resource fork and FinderInfo (bsdtar on both ends). `--raw` also writes `<dest>.rsrc`, which holds the bare fork as a data fork. |
| `pilots push <local> [as <name>]` | Pushes a Mac pilot (a file with a resource fork, or a raw `.rsrc`). See the safety rules below. |
| `pilots rm <name>` | Moves a pilot that novaref pushed into `~/novaref/backups/<ts>-rm/`. It never deletes, and it refuses pilots novaref didn't push. |
| `pilots backup` | Copies the Pilots folder and the prefs to `~/novaref/backups/<ts>-manual/`. |
| `record start [--fps N]` / `record stop [out.mp4]` | Screen recording with ffmpeg (details below). |
| `run <scenario.json> [--out dir] [--pilot local-pilot]` | Runs a scenario (details below). |

To read a pulled pilot with the repo's parser (novaparse `readPilot`), run:

```sh
node scripts/novaref/pilot_summary.mjs ./Matt
# {"pilot_name":"Matt","nickname":"Hawkeye","ship_name":"Starbridge 525","credits":3260303,
#  "ship_class":"Starbridge","last_stellar":"Earth","system":"Sol",...}
```

It resolves names against the stock data in `packages/nova/Nova_Data`, so run
`scripts/setup_worktree.sh` first so that data is linked and `dist/` is built.

### Key sequence grammar

Tokens are separated by whitespace.

- `Return` `Escape` `Tab` `Space` `Delete` `Up` `Down` `Left` `Right` `F1`…`F15`
  `Home` `End` `PageUp` `PageDown` `kp0`…`kp9` `kpEnter`, plus any single
  character on the US layout (`a`, `1`, `;`, …). Letter keys are
  case-insensitive, so `A` is the same key as `a`. To send a capital letter,
  write `shift+a`.
- Modifiers: `cmd+q`, `shift+Tab`, `cmd+shift+g` (also `opt`/`alt` and `ctrl`).
- `Space@500` holds the key for 500 ms. The default hold is 80 ms, because the
  game polls keys once per frame and might miss a 1-frame tap.
- `Down*3` presses the key 3 times.
- `wait 500`, `wait:500` and `500ms` all pause.
- `down:Up … up:Up` presses a key and releases it later, for long holds while
  other steps run (for example thrust for 2 s: `down:Up wait 2000 up:Up`).
- `text:"~/some path"` types literal ASCII text with real keycodes. Use it for
  file dialogs. The PyObjC on 10.13 can't call
  `CGEventKeyboardSetUnicodeString`, so text is limited to ASCII.
- `hold:120` and `gap:100` change the default hold time and the gap between
  keys from that point on.

Events are posted at `kCGHIDEventTap` from a `kCGEventSourceStateHIDSystemState`
source. That updates the HID key state the game polls, not just the event
queue. Modifier keys are posted as real key-down and key-up events around the
key.

### Coordinate frame

- All coordinates are **screen points with the origin at the top-left of the
  main display**. This is the CGEvent / `CGWindowListCopyWindowInfo` frame.
- The display is 1920x1080 points and 1920x1080 pixels (scale 1, not HiDPI),
  so **a full `shot` pixel (x, y) is the screen point (x, y)**. `status`
  reports both `screen_points` and `screen_pixels`. If they ever differ,
  multiply points by `pixels/points`.
- EV Nova runs **windowed** (pref "Run in a window"). Its window was at
  `[544,226,832,626]` (x, y, w, h) every time it launched in this session.
  The 22 pt title bar sits above an **832x604 content area at (544,248)**.
  `status` reports `nova_window` and `nova_content`, which come from the live
  window list.
- `shot --window` captures exactly `nova_content`. **A pixel (x, y) in a
  `--window` shot is the point `click x y --win`**, so you can read
  coordinates straight off a window shot. In fullscreen mode (a window that
  covers the screen) the title-bar offset is 0.

## Safety rules (maintainer rulings)

- **Pilots are copies.** `push` copies the whole Pilots folder (with
  `ditto`, which keeps resource forks) and `defaults export`s EV Nova's
  prefs to `~/novaref/backups/<ts>-push/` before it writes anything. It
  refuses to overwrite a pilot that novaref didn't push itself (tracked in
  `~/novaref/state/managed_pilots.txt`). It also refuses the name `Last Pilot`.
  Use dedicated names such as `novaref-<experiment>`.
- **The game's own bookkeeping.** EV Nova rewrites `Pilots/Last Pilot` (an
  alias to the pilot it loaded) on every launch and quit, and when it opens a
  pilot. `run` snapshots the Pilots folder and the prefs first. After quitting,
  it restores `Last Pilot` from the snapshot and compares the prefs
  semantically (`plutil -p`). If the prefs changed, it puts them back with
  `defaults import` into EV Nova's own domain. The result line reports
  `restored: ["last-pilot-restored","prefs-unchanged"]`. A bare
  `launch`/`quit` with Matthew's pilot loaded only changes runtime junk in
  the resource-map header of `Last Pilot`, so the alias stays the same.
- **Never enter the game with a real pilot loaded.** At launch the title
  screen auto-loads the last pilot (Matthew's `Matt`). `Enter Ship` followed
  by a landing would save over that pilot. Always load an experiment pilot
  first (`run` does this through `open_pilot` and aborts if it can't verify
  the load).
- No system settings are touched. `launchctl asuser` is not used: plain ssh
  reaches the console user's WindowServer on 10.13, and `asuser` fails there
  with "Could not switch to audit session". Nothing is installed outside
  `~/novaref`.

## Scenarios (`run`)

```json
{
  "name": "land_outfitter",
  "pilot": { "as": "novaref-scenario" },
  "steps": [
    { "shot": "title-with-pilot", "window": true },
    { "keys": "e wait 4000" },
    { "keys": "l wait 1000 l wait 8000" },
    { "shot": "spaceport", "window": true },
    { "keys": "o wait 2000" },
    { "shot": "outfitter", "window": true },
    { "keys": "Escape wait 1500" }
  ],
  "pull": true
}
```

```sh
novaref run scripts/novaref/scenarios/land_outfitter.json --pilot ./Matt.rsrc --out /some/results
```

A run goes through these steps in order:

1. If EV Nova is running, quit it (unless `"allow_running": true`).
2. Snapshot the Pilots folder and the prefs.
3. Push `pilot.push` (or `--pilot`) as `pilot.as`.
4. Launch the game.
5. Run `open_pilot` (skip it with `"pilot": {"open": false}`).
6. Run the steps.
7. Quit (unless `"quit": false`).
8. Pull the pilot back (`"pull": true` pulls `pilot.as`, or give a name instead of `true`).
9. Restore the game's bookkeeping.

Everything goes into `<out>/<timestamp>-<name>/`: `scenario.json`,
`log.jsonl` (one line per phase or step, with that step's result),
`NN-<label>.png`, `pilot-after/<name>` (and its `.rsrc`) and `result.json`.
If a step fails, the run takes an `error` shot, then still quits, pulls and
restores.

Step types:

- `{"keys": "..."}`, with an optional `"hold"`
- `{"wait": ms}`
- `{"shot": "label", "window": true}`
- `{"click": [x, y], "win": true, "right": false, "double": false}`
- `{"drag": [x1, y1, x2, y2], "win": true}`
- `{"open_pilot": "name"}`
- `{"record": "start" | "stop"}`
- `{"launch": true}`
- `{"quit": true}`

`open_pilot` works like this. It presses `o` on the title screen, which opens
an NSOpenPanel (a second EV Nova window named "Open", layer 8). It presses
`cmd+shift+g`, types the pilot's full path, and presses `Return` to select the
pilot and `Return` again to open it. It checks each stage against the window
list, so a key that is dropped can never type a path into the title screen,
where single letters trigger Enter Ship and Quit. It then verifies that
`Last Pilot` names the requested pilot.

## Recording

`record start` runs the hub-built `~/novaref/bin/ffmpeg` detached with nohup
and keeps a pid file in `~/novaref/rec/`. It records avfoundation device `1`
("Capture screen 0"); device 0 is the iSight camera and must never be
captured. The capture has no audio and uses `h264_videotoolbox -allow_sw 1`,
because this 2010 iMac has no hardware H.264. The output is 1920x1080 at
30 fps and roughly 1.5–2 MB/s, written as a fragmented mp4, so even an unclean
stop leaves a playable file. `record stop` sends SIGINT, waits up to 10 s,
copies the file back and deletes it from the old Mac. To crop to the game,
run ffmpeg on the MacBook, for example
`ffmpeg -i rec.mp4 -vf crop=832:604:544:248 game.mp4` (take the values from
`status`'s `nova_content`).

## EV Nova key facts (this install)

- `/Applications/EV Nova.app` is 1.1.1. `Contents/MacOS/EV Nova` is the usual
  community shell wrapper: it sets `DYLD_INSERT_LIBRARIES=libNova.A.dylib`
  and runs `Ev Nova.original` (i386). So there are two PIDs (`sh` and the
  game), and `pgrep -f "/Applications/EV Nova.app/Contents/MacOS/"` matches
  both.
- Pilots live in `~/Library/Application Support/EV Nova/Pilots/` as
  zero-byte data forks. The content is in the resource fork (`NpïL` 128/129),
  and the FinderInfo is type `NpïL`, creator `Nvä`. Copy them with
  `ditto`/bsdtar, never with a plain copy that drops the fork.
- Title-screen keys verified so far: `o` Open Pilot, `e` Enter Ship, `p` Set
  Prefs (Escape cancels), `a` About (click Okay at content (315,406) to close
  it). `n` (New Pilot) and `q` (Quit) are probably the same pattern but have
  not been tested.
- In space, the first `l` targets the nearest planet and requests landing
  ("Cleared to land"). A second `l` autopilots the ship down. Tested from
  the start position near Earth, where landing took under 8 s.
- In the spaceport, `o` opens the Outfitter and Escape closes it. The other
  spaceport keys have not been tested.
- Quitting in-game brings up "Are you sure you want to quit?" (OK is the
  default). `quit` handles it.
