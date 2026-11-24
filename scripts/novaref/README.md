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
| `record start [--fps N] [--window]` / `record stop [out.mp4]` | Screen recording with ffmpeg (details below). `--window` crops to EV Nova's content before encoding. |
| `run <scenario.json> [--out dir] [--pilot local-pilot]` | Runs a scenario (details below). |
| `launch --app stock\|minimal` / `restart --app ...` | Starts the real game (default) or a named copy (see "Minimal app"). Refuses while test plug-ins are installed unless the title screen would load nothing or an experiment pilot. |
| `pilots park-last` / `pilots unpark-last` | Moves `Last Pilot` into `~/novaref/state/parked/` and back, so the title screen loads no pilot at all. |
| `pilot-make <spec.json> [out]` | Writes a pilot file from a JSON spec (see "Custom pilots"). Runs on the MacBook. |
| `plugin-make <spec.json\|spec.mjs> [out] [--data]` | Builds a plug-in from a spec (see "Custom plug-ins"). Runs on the MacBook. |
| `plugin list` / `plugin install <local> [as <name>]` / `plugin uninstall <name>... \| --all` | Manages the old Mac's Plug-ins folder. Uninstall moves files to `~/novaref/backups/<ts>-plugin-uninstall/`. Never deletes, and never touches a plug-in novaref didn't install. |
| `app list` / `app setup-minimal <data.ndat>` | Lists app bundles, or builds the minimal copy (see "Minimal app"). |
| `recover [--baseline novaref/backups/<ts>-manual]` | After a run died (power cut, crash, killed CLI): stops any EV Nova, stops a novaref recording, moves novaref plug-ins out, restores `Last Pilot` and prefs from the baseline, moves experiment pilots out (keeps `keepPilots`, default `novaref-scenario`), then verifies Matt == Pilots-backup/Matt. Everything replaced goes to `~/novaref/backups/<ts>-recover/`. `run` and a bare `launch` refuse to start while any such leftover exists (including an EV Nova macOS reopened at login). |

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

## The drive lock (one agent at a time)

Every command that drives the old Mac (everything except `status`,
`info`, `lock`, `pilot-make` and `plugin-make`) holds an exclusive lock
file on the MacBook, `~/.config/novaref/lock` (config key `lockPath`).
The file holds `{pid, owner, host, cmd, start}`; `owner` is
`$NOVAREF_OWNER` or the caller's working directory, so set
`NOVAREF_OWNER=<agent name>` to make it readable.

- A second command fails at once with `ok:false` and `lock_holder`, unless
  you pass `--lock-wait <seconds>` (or set `NOVAREF_LOCK_WAIT`), which
  waits for the holder to finish.
- A lock whose pid is dead, or reused by something that isn't novaref, is
  stale and is taken over automatically (logged to stderr).
- `novaref lock` shows the current holder and whether it is held or stale.
- A `run` holds the lock for its whole duration, so nobody can slip in
  between its steps.

The specs are `node --test scripts/novaref/test/*.test.mjs` (lock, frame
sync, flake detection; they never touch the old Mac).

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
- **Test plug-ins never meet Matthew's pilot.** A scenario with `plugins`
  (or `"app": "minimal"`) parks `Last Pilot` before launching, so the title
  screen loads no pilot, then opens the experiment pilot. It always quits
  the game, uninstalls every plug-in it installed (even after a failed
  step) and restores `Last Pilot` from its snapshot. It refuses to start if
  Plug-ins is not empty. `launch` refuses on its own when test plug-ins are
  installed and `Last Pilot` names a pilot novaref didn't push.
- **Display sleep.** The old Mac's display sleeps after 10 idle minutes,
  and WindowServer then reports `loginwindow` as frontmost. Every
  input-posting call wakes it with a user-activity assertion
  (`caffeinate -u`, no password involved). `run` holds `caffeinate -d -u`
  for its whole duration (capped at 2 h) and kills it at the end. No
  energy-saver setting is changed.
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
- `{"move": [x, y], "win": true}`. `{"move": true}` parks the mouse at (40, 40), outside the game window.
- `{"record": "start", "window": true}` crops the recording. `{"record": "stop", "label": "x"}` writes `recording-x.mp4`.
- `{"pull": "label"}` pulls the scenario pilot mid-run into `pilot-<label>/`. The game writes the pilot when the player LEAVES the spaceport (the date advances then), not on landing: pull after `Return` (Leave), wave 5.
- `{"script": "../loops/x.mjs", "args": {...}}` (wave 6) runs a closed-loop
  step: the module (resolved against the scenario's folder) default-exports
  `async (api, args) => ({ok, ...})`. `api.step(s)` runs any ordinary step
  inside the run (same lock, same shot numbering; its keys and shots are
  frame-stamped under the script step's index), `api.dir` is the run folder
  and `api.log(obj)` appends a `{"phase":"script"}` line to `log.jsonl`. A
  script cannot press Escape (refused). `loops/board.mjs` steers to a target
  by measurement and boards it (see "Boarding loop" below).
- `{"repeat": N, "steps": [...]}` runs its steps N times (`steps.mjs`). Every
  `{i}` in a string of the inner steps becomes the iteration number, padded
  to two digits, so `{"shot": "watch-{i}"}` gives watch-00, watch-01, ...
  Repeats nest. Each step is its own ssh call (a shot takes about 2 s), so
  for evenly spaced key presses put them in ONE `keys` string instead.

Scenario keys added for experiments:

- `"plugins": ["../kits/testkit.mjs", "some-built-plugin"]`. A `.json`
  or `.mjs` spec is built with `plugin-make` into `<run dir>/plugins/`
  first. Built plug-ins are installed as they are. All of them come out
  again at the end.
- `"app": "minimal"` launches the minimal copy instead of the real game.
- `"park_last_pilot": true` parks `Last Pilot` even without plug-ins.
- `"prefs": {"RunInAWindow": 0}` writes EV Nova's own prefs for this run
  only (numbers as `-int`, booleans `-bool`, strings `-string`). They are
  written after the snapshot, so the post-quit prefs check finds the
  difference and imports the snapshot back (`prefs-restored`). Wave 4
  used it for fullscreen captures; it never touches system settings.
- `"title_wait": 12000` waits that long (ms) after launch before
  `open_pilot`. Needed in fullscreen (`RunInAWindow` 0): the game's window
  exists before the title screen is drawn, and an early `o` is lost (wave 5).
  Fullscreen runs at the desktop's 1920x1080; `shot` without `--window`
  then captures the whole game.

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

`record start` wakes the display first: a sleeping display has no
"Capture screen 0" device and ffmpeg fails with "Invalid device index".

### Input/frame sync (which frame did a key land in?)

The remote helper stamps every key press, `down:`/`up:`, click, drag and
(during a recording) screenshot with the old Mac's **host clock**
(`mach_absolute_time`). ffmpeg's avfoundation input stamps captured frames
on the same clock and logs the first one ("start:"); `record start`
returns it as `start_host`. The mp4 keeps the capture's variable frame
timing, so an event's time in the video is `host - start_host`.

In a `run`:

- every step logged while recording carries `rec.video_t` (seconds into
  the recording of its first event);
- after `record stop`, the run probes the mp4's per-frame pts (ffprobe)
  and appends one `{"phase":"frame-sync","i":<step>,"events":[{kind, what,
  video_t, frame}]}` line per step to `log.jsonl`, and writes
  `recording.events.json` with every event. `frame` is the index of the
  frame on screen when the event was posted, counted the way ffmpeg
  decodes the file (what `analysis/*.mjs` call a frame).

Checked on 2026-11-23 against a map toggle: `m` stamped at frames 56 and
163, the map visibly opened at 61 and closed at 167. The game itself takes
4-5 frames (about 150 ms) to show a key's effect, so the stamps are exact
to the frame and the remaining gap is the game's input latency.

### Retries (the "exits right after Enter Ship" flake)

About one run in eight ends with EV Nova quitting just after `e`, with no
crash report. `run` checks the game is still running right after any step
that presses `e`. If the game has gone when the scenario still needed it
(not quit by a `quit` step), the attempt is marked `game_exited`, cleaned
up like any failed run (quit, plug-ins out, Last Pilot and prefs restored,
a running recording stopped and kept as `recording-aborted.mp4`) and run
again from scratch in a new `<ts>-<name>-retry<N>/` dir. `--retries N`
(or the scenario's `"retries"`) bounds it; the default is 2. The result
lists every attempt under `attempts`. Since wave 4 a launch that never
shows a window and leaves no EV Nova process (it died while loading, seen
once in wave 4 with a kit that loads fine otherwise) is retried the same
way.

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
  ("Landing request received, <ship>. Begin initial approach."). A
  second `l` lands only when the ship is already close. There is **no
  auto-approach** (wave 2): from about 800 px out it says "You're too
  far away to land on this planet." and nothing else happens. Enter Ship
  starts the player on the stellar, so `l l` lands at once there.
  Wave 4: the second `l` lands only inside the planet's landing range
  (80-330 px, depending on the planet) AND below about 20 px/s; otherwise
  "too far" or "You're moving too fast to land on this planet.". An
  inertialess Crawler at full speed never lands: brake with Down first.
- In the spaceport, `o` opens the Outfitter and Escape closes it. The other
  spaceport keys have not been tested.
- Quitting in-game brings up "Are you sure you want to quit?" (OK is the
  default). `quit` handles it.
- `e` (Enter Ship) puts the loaded pilot **in space** next to its last
  stellar. It does not open the spaceport. Landing there takes `l`
  (target it and request clearance) and then `l` again (lands at once
  from the start position; the landing animation takes a few seconds).
- Escape in space is the pause key and quits to the title screen. Never
  send it in flight.
- Key bindings in this install (prefs `ShortcutRecorder *`): e escort
  menu, f/d/v/c escort orders (attack, defend, hold, formation), b board,
  h hyperspace minimap, `\` select hyperspace destination, j jump,
  r nearest target, w next secondary, s weapon safe, z afterburner,
  u cloak, y hail, k dump cargo, x eject, a autopilot (untested),
  Control = secondary fire, Space = primary fire.
- A mission with AvailLoc 3 is offered as soon as you land, in a dialog
  with **No / Yes**. `Return` presses Yes. In the spaceport, `Return` presses
  Leave. The spaceport buttons are Bar, Mission BBS, Trade Center,
  Shipyard, Outfitter and Leave.
- `Tab` cycles targets. With a single other ship it toggles between that
  ship and "No Target", so press it once and leave it.
- `m` opens and closes the map. `F12` toggles an fps readout in the corner,
  and the game renders at about 56 fps on this iMac. Physics ticks run at
  about 29.1 Hz (see docs/reference_experiments.md).
- The New Pilot dialog flow is: `n`, then Return to confirm replacing the
  loaded pilot, then the name/nickname fields (Tab between them), then
  Return, then the ship-name field, then Return. The pilot file is written
  at once. The stock game starts a new pilot in a Shuttle with 25,000
  credits at a random starting stellar.

## Custom pilots (`pilot-make`)

```sh
novaref pilot-make scripts/novaref/pilots/probe_a.json
```

```json
{ "name": "novaref-probe-a",
  "base": "~/.local/share/novaref/pilots/novaref-base.rsrc",
  "edits": { "ship": 700, "stellar": 2100, "credits": 1000000, "fuel": 3000,
             "clearMissions": true, "clearMissionBits": true, "clearLegal": true,
             "missionBits": {"9001": true}, "legal": {"2100": -500},
             "weapons": {"361": {"count": 1, "ammo": 0}}, "outfits": {"601": 1},
             "nickname": "Probe", "shipName": "Probe A" } }
```

- Edits are `PilotEdits` in `packages/novaparse/src/pilot/pilot_write.ts`.
  The keys are: ship, stellar, credits, fuel, date, cargo, outfits, weapons
  (+ammo), legal (**per sÿst id**, because EV Nova keeps legal records per
  system), clearLegal, explored/exploreAll, missionBits/clearMissionBits,
  clearMissions, escorts, fighters, rating, nickname, shipName, strictPlay,
  dominated, and priceFlux. Ids are resource ids, not indexes.
- The **base** is a pilot the game created itself (title screen > New
  Pilot), so every field the spec leaves alone holds a value the original
  wrote. The base used on 2026-11-23 is
  `~/.local/share/novaref/pilots/novaref-base(.rsrc)` on the MacBook (a
  stock Shuttle at Snowmelt). Recreate it with the New Pilot flow above.
- A pilot can only reference shïp ids up to 895, oütf up to 639, wëap up
  to 383 and sÿst/spöb up to 2175 (the pilot's array sizes).
- Writing **active missions** is not supported. Give the pilot a mission
  bit and let a plug-in mïsn offer the mission on landing (AvailLoc 3)
  instead. The pilot then holds a mission the game set up itself.
- The output is `<out>` (empty data fork, resource fork, FinderInfo
  `NpïL`/`Nvä`) plus `<out>.rsrc`. Both are read back with the repo's
  parser. Push either with `pilots push` or a scenario's `pilot.push`.

## Custom plug-ins (`plugin-make`)

A spec lists resources. Each resource is built in one of these ways:

- `"clone": "shïp:128"` copies a stock resource's bytes from
  `~/.local/share/novaref/stock`. That folder holds copies of the old Mac's
  `Nova Data N.ndat` / `Nova Ships N.ndat`. Its Nova Data 4 differs from
  the repo's canonical copy only in wëap 146 byte 15 (the Graphic field) and an extra dsïg 128.
- `"fill": 255` starts from a blank template.
- `"hex"` gives raw bytes.
- `"strings"` builds an STR#.
- `"text"` builds a dësc.

Add `"set": {field: value}` to change named fields after that. The names
are in `packages/novaparse/src/plugin_kit/resource_fields.ts`, and the
spec checks every offset against the repo's own resource parsers. Raw
fields work too, as `"@offset:i16"`. `plugin-make` refuses to override a
stock id unless the resource says `"override": true`. The output is a Mac
plug-in: an empty data fork, a resource fork (data at offset 256) and
FinderInfo `Npïf`/`Nvä`. `--data` writes a data-fork `.ndat` instead.

**Id limits** (`ID_LIMITS` in `plugin_make.mjs`). `plugin-make` also
refuses ids the game can't use: wëap/gövt/flët above 383, oütf/düde above
639, mïsn above 1127, shïp above 895, sÿst/spöb above 2175 (the Bible's
"Max ..." table, ids starting at 128), and **rlëD above 1999**. That last
one is empirical: in wave 3, a plug-in with rlëD 2000/2001 made the game
quit while loading, and 1999 works (bisect in
`~/.local/share/novaref/evidence/20261123-w3-bisect/NOTES.txt`). Add
`"unsafeId": true` to a resource to build it anyway. The test kit has used
the last free wëap (382, 383) and düde (635-639) ids of ITS ranges, but
the ranges between the stock ids and the kit's are free and allowed
(wave 5 uses them): wëap 235-359 (stock wëap stop at 234), oütf 444-599
(stock 443), düde 275-599 (stock 274), gövt 196-359, flët 256-383 except
300, sÿst/spöb 2000-2099 (stock sÿst 1127, spöb 1420). Stock shïp ids are scattered up to 895; plugin-make refuses a stock id, so just try one (778/779 were free).

**Caches:** the game reads Plug-ins only at launch, so a plug-in change
always needs a fresh launch (`run` does this). Pilots are read when they
are opened and written when the player leaves a spaceport (wave 5: not on landing). The prefs domain
(`com.AmbrosiaSW.EV_Nova`) and `Last Pilot` are rewritten on quit, and
`run` restores both.

## Test kit (`kits/testkit.mjs`)

Build it with `novaref plugin-make scripts/novaref/kits/testkit.mjs`, or
list it in a scenario's `"plugins"`.

| ids | what |
|---|---|
| sÿst 2100 Kit Range (govt 360) | A sealed test system with no hyperlinks, no traffic, no asteroids. sÿst 2101/2102/2103 are empty "home" systems of govts 361/362/363, so a pilot can carry a record with each govt. |
| spöb 2100 Kit Port (0,0) | Land, trade, outfitter, shipyard and bar. It sells the kit (specialTech 9000) and has MinStatus -32767, so you can always land. |
| spöb 2101 Kit Market (900,0) | Land, trade and bar, with the opposite trade tiers to Kit Port. |
| spöb 2102-2107 | Uninhabited markers on a 600 px grid, for motion tracking. |
| shïp 700/701/702 Kit Probe A/B/C | Accel/Speed/Turn of 300/300/10, 150/600/30 and 600/200/20, for unit checks. |
| shïp 703 Kit Lancer | Inertialess (flags2 0x40), fast, with 30000/30000 shield and armor. |
| shïp 710 Kit Lancer Lite | Inertialess, 1500 shield with no recharge, so damage shows on the HUD. |
| shïp 704 Escort, 705 Fighter, 706 Carrier (fighter bay), 707 Raider, 708 Trader, 709 Target (immobile, 30000 armor) | NPC hulls. |
| wëap 360 Beam Turret (5000 dmg, 1500 px), 361 Tickler (1 dmg turret), 362/363/364 Missile with GuidedTurn 10/30/60, 365 Escort Gun (30 dmg turret), 366 Fighter Bay (705), 367 Raider Gun, 368 Fixed Gun, 369 Rear Turret (wave 4; until then the #316 Speed Guns 300/600) | Weapons. |
| oütf 600-607 | Player outfits for wëap 360, 361, 362, 363, 364, 368, 369 and 365. |
| gövt 360 Escort, 361 Trader (flags 0x0002 "nosy"), 362 Raider (0x0004 "always attacks player"), 363 Neutral | No classes, allies or enemies. KillPenalty 100, CrimeTol 10, MaxOdds 1000. A CrimeTol-0 / MaxOdds-100 version left a -500 player "neutral" and the raiders holding off. A govt enforces only the record of systems it owns unless it is nosy. |
| düde 600 escort, 601 carrier escort, 602 raiders (362), 603 traders (361), 604 own-govt raiders (360), 605 target | Dudes. |
| mïsn 960-965 | Offered on landing at Kit Port (AvailLoc 3) while bit 9001-9006 is set. 960-964 are ShipBehav 1 / ShipGoal 3 escort missions: alone, vs raiders, vs traders, vs own-govt raiders, and a carrier vs raiders. 965 spawns the target. Offer text is dësc 4000+id-128. |
| mïsn 966-969 | 966: escort + traders of govt 362 (bit 9007). 967: stock Fed Carrier escort + raiders (9008). 968: NPC Kit Bomb Carrier (9009). 969: two Kit Bomb Raiders (9010). |
| wëap 370 Kit Blast Bomb (2-frame life, detonates at end, 300 px blast), 372 Kit Blast Shell (NPC-usable: 180 px reach, 400 px blast), 373 Kit Big Blast (2000 dmg), 371 Kit Bomber Bay; oütf 608-610; shïp 711 Kit Bomber, 712 Kit Bomb Carrier, 713 Kit Bomb Raider | Blast experiments (B-series). |
| shïp 720 Kit Disc Leader (white, Speed/Accel 300, Turn 30), 721-726 Kit Disc Red/Green/Blue/Yellow/Magenta/Cyan (Speed/Accel 600, Turn 60); rlëD 1970-1976 | **Trackable hulls**: a solid one-colour disc (24 px) on all 36 frames, built by `packages/novaparse/src/plugin_kit/sprites.ts`. `analysis/discs.mjs` finds each centre by colour. The shän is the stock Shuttle's with only the sprite swapped: a from-scratch shän crashed the game on Enter Ship. The rlëD must use the stock row encoding (`encodeRled(..., {original: true})`). The synthetic data set's default encoding made the game fail an assertion on load. |
| jünk 200 Kit Widgets (base 1000), 201 Kit Gadgets (base 150) | Bought at one kit port and sold at the other. |
| wave 4 additions | sÿst/spöb 2160-2169 Kit Land 40/72/250/325/304x134/96/112/315x200/80/88 (one landable stellar each, cloned from stock spöbs of those sprite sizes), shïp 771/772 Kit Crawler Slowbrake (inertialess, slow Accel, for the landing speed gate), mïsn 991 (bit 9032: four AI 1 subjects), wëap 368 Kit Fixed Gun / 369 Kit Rear Turret (they **replace the #316 Speed Guns**; oütf 605/606 now install them) and shïp 769/770 blue disc escorts carrying them. Jamming types 2-4 (wëap 362-364, oütf 602-604 and 627-629, shïp 773-775, mïsn 962/963/965/966/970), asteroid tests (wëap 378 JamM Decoy V100, 380 JamM Pass V100, oütf 630/631 single +50/+100 jammers, shïp 776/777, mïsn 967/968/992, sÿst 2170 Kit Rock Range 4) and K9 brackets (düde 609/613/614, mïsn 993-995). **Retired** for these: wëap 362-364 (#316b missiles), 368/369 (#316 speed guns), 378/380 (JamM Parent / Plain); düde 603-610 and 613/614 with mïsn 962-970 (Q2b, Q3, Q4b, Q2c, #316b target, B bomb carrier/raiders, the wave-2 derelict, K9's record-hostile ships). Old pilots that name them now get the new resources. See `wave4Resources`. |
| wave 5 additions (`wave5Resources`, `jamWave5`; nothing retired) | sÿst/spöb 2172-2175 Kit Decoy Range (1 rock) and Kit Decoy Range 3 (3 rocks), target on a marker 250 px east (mïsn 996/997, bits 9037/9038); sÿst 2000 Kit Traffic Range (AI 1 traffic, two landable stellars); shïp 778/779 Kit Lancer Heavy Weak/Strong (Strength 1 / 10000); gövt 365-367, düde 275/276, sÿst 2002/2003 (A14 one-way alliances); düde 277 + sÿst 2004 Kit Carrier Range (AI 3 Kit Bomb Carrier traffic of gövt 362); flët 301/302 + sÿst 2005/2006 (fleets with mixed sprite sizes / repeated escort types); wëap 235 JamM Interf (0x0008) + oütf 444, sÿst 2007 Kit Static Range (Interference 100) and 2009 Kit Static Control (0), mïsn 998/999; wëap 236 JamM Parent V100 (0x8000) + oütf 445, mïsn 1000 (S100 target at Kit Market); düde 278 + sÿst 2011 (hostile STOCK Fed Carrier traffic), shïp 780-782, wëap 237, düde 279 + sÿst 2012 (Fed hull with kit bombers: never launched). `kits/viper_blast.mjs` is a separate test-only plug-in overriding the stock Fed Viper (shïp 144) to carry the Kit Blast Shell. |
| wave 6 additions (`wave6Resources`; nothing retired, ids above the stock ones) | U9 tiny stellars: sÿst/spöb 2013 Kit Land 17x31 (stock station Type 53), 2014 15x21 (Type 51), 2015 35x22 (Type 48), all with the stock station flags 0x11, and 2016 the 17x31 art as a planet (0x43); shïp 783 Kit Crawler Mini (Crawler 50 on the Shuttle's 24 px sprite). B carrier: mïsn 1001 (bit 9042) puts the stock Fed Carrier of gövt 362 (düde 278) at Kit Port beside the player, mïsn 1002 (9043) an anchored copy (shïp 790, düde 283); wëap 243 Kit Blast Shell 1 (1 damage) for `kits/viper_blast1.mjs`; launch factors: Viper clones shïp 784 (stock bytes, new id), 785 (blast shell only), 786 (kit shipBase), 415 (stock bytes at the first free low id) in Fed Carrier hulls 787/788/789/796 (bays wëap 238/239/240/244, Anaconda bay kept), traffic of sÿst 2017/2018/2019/2021 (düde 280-282, 288). J: wëap 241 JamM Ion (Seeker 0x0020) + oütf 446, shïp 792 Kit Lancer Ion (IonizeMax 100, Deionize 1), shïp 793 Ion Target firing wëap 242 Kit Ion Turret (düde 285, mïsn 1003, bit 9044); shïp 794 Cloak Target (oütf 447 Kit Cloak, Flags2 0x0800; düde 286, mïsn 1004, bit 9045), oütf 448 Kit Cloak Scanner (ModType 30, 0x000F). U9 boarding: shïp 795 Kit Hulk (immobile magenta disc), düde 287 of the derelict gövt 378, sÿst/spöb 2020 Kit Board Range. Later in the wave: shïp 415 Kit Viper Low (carrier 796, bay 244, sÿst 2021), mïsn 1007 (bit 9048) the Kit Bomb Carrier beside the player, wëap 245 Kit Ion Gun / shïp 797 / mïsn 1005 (bit 9046), mïsn 1006 (bit 9047) + oütf 449 (cloak take 2), wëap 246 Kit Long Beam (15 damage per beam frame) + oütf 450, mïsn 1008/1009 (bits 9049/9050) the stock-cloak Cloak Target W (shïp 798) beside the player / at Kit Market, shïp 799 Kit Hulk Cheap (cost 20,000) in sÿst/spöb 2022. **Kit-wide fix:** a bay's AmmoType is the carried shïp's id itself (stock wëap 149 holds 144); until wave 6 the kit wrote id - 128, so every kit bay pointed at a missing ship (or a stock one) and never launched what it was meant to. A harness spec now checks it. |
| wave 7 additions (`wave7Resources`; nothing retired) | B: shïp 800 Kit Bomb Carrier Anchored (shïp 712 with Speed/Accel 0, gövt 362, düde 292, mïsn 1010 / bit 9051 beside the player) and shïp 802 the same with wëap 247 Kit Bomber Bay 1 -> shïp 801 Kit Bomber 1 (1-damage shell; düde 293, mïsn 1011 / 9052). U9: Kit Hulk at 2,000 / 100,000 / 500,000 / 2,000,000 (shïp 803-806, düde 294-297, sÿst/spöb 2023-2026), shïp 807 Kit Hulk Big (96 px magenta disc, rlëD 1979, 50,000; düde 298, sÿst/spöb 2027); player hulls shïp 808/809 Kit Crawler 25/40, 810 Kit Crawler Crew (crew 500), 817 Kit Crawler Soft (Accel 200: a thrust tap sets the pass speed). A: gövt 368 Kit Retreat Hostile (0x0010 + 0x0004), düde 299, mïsn 1012 (9053, beside the player) / 1013 (9054, Kit Jam Far's marker, 1800 px), mïsn 1020 (9061: the gövt 383 tank at Kit Market); wëap 248 Kit Long Beam 50 + oütf 451. J: shïp 811 Jam Target Inh (shïp govt 364; düde 300, mïsn 1014 / 9055), shïp 812/813 Jam Target 25+75 / 75+25 (düde 301/302, mïsn 1015/1016, bits 9056/9057), sÿst 2028 Kit Static 30 / 2030 Kit Static 60 (mïsn 1017/1018, bits 9058/9059), shïp 814 Kit Lancer Ion Slow, wëap 249 Kit Ion Gun 10, shïp 815 Ion Target Green (düde 303, mïsn 1019 / 9060). E: wëap 250 Kit Front Turret (guidance 7), shïp 816 Kit Disc Blue Front. |
| wave 8 additions (`wave8Resources`; nothing retired) | **Pointer hulls** (`pointerFrames`/`pointerShip`: a heading you can read off a shot, frame 0 north, clockwise; the shän carries the real frame size, unlike `discShip`'s 24 x 24). rlëD 1955 Kit Ring 24 (2 px cyan ring, white nose spoke, open centre), 1957 Kit Ring 96, 1959 Kit Hulk Pointer (24 px magenta disc, green spoke centre to nose), 1961 its 96 px version: free ids between the stock 1952 and the kit's 1970. Player hulls (Kit Crawler 100 stats): shïp 818 Kit Ring Crawler, 819 Kit Ring Crawler Big (Ring 96), 826 Kit Ring Crawler Crew (crew 500). Hulks (derelict gövt 378, booty food + money, one per system): shïp 820 Kit Hulk Pointer 50,000 (düde 304, sÿst/spöb 2032 Kit Board Pointer), 821-824 at 200,000 / 300,000 / 750,000 / 1,000,000 (düde 305-308, sÿst/spöb 2033-2036), 825 crew 20 (düde 309, 2037), 827 Kit Hulk Pointer Big (96 px, düde 310, 2038). Capture: shïp 829 Kit Live Pointer (the pointer hulk of the neutral gövt 363, AI 4: NOT a derelict, the player disables it; düde 312, sÿst/spöb 2039), 831-835 the same with crew 20 / 15 / 40 / 5 / 10 (düde 314-318, 2040-2044). B: shïp 828 Kit Gun Carrier Anchored (shïp 800 without the bay), düde 311, mïsn 1021 (bit 9062); shïp 830 Kit Empty Bay Carrier Anchored (shïp 802, bay ammo 0), düde 313, mïsn 1022 (bit 9063); both beside the player. |
| wave 2 and 3 additions | A14 hostility cells, the map region, the jamming kit, the AI subjects, F1b disc sizes and the wave-3 resources (jamming at 450/1800 px, long-life and turn-away missiles, InhJam target, AI tank discs, Kit Lancer Heavy, armed blue disc escorts and Kit Fight Range, flët 300 in Kit Fleet Range, Kit Prize, Map B border systems). Each block's doc comment in `kits/testkit.mjs` lists its ids. |

## Boarding loop (`loops/board.mjs`, wave 6)

A `script` step (`scenarios/board_hulk.json`) that brings the player to a
target it can only see in screenshots, then boards it:

- The target is a magenta disc (kit shïp 795 Kit Hulk), found by colour in
  a window shot; off screen, the one radar blip that is neither the player
  nor the stellar the player started on (its blip is dead-reckoned).
- The heading is measured, not assumed: an inertialess hull stops dead on
  Down, so a leg of thrust followed by Down moves the player in a straight
  line, and the target's (or, on the first leg, the stellar's) shift on
  screen is minus that displacement. Turns between legs are dead-reckoned
  at the hull's turn rate (Turn 30 = 87.1 deg/s) and re-measured after
  every leg.
- Within `near` px it steps in `stepMs` of thrust at a time, presses `b` at
  every stop and shoots the status line. The plunder dialog (it lights
  about 5% more of the play area than the shot before the press) ends the
  walk: `dialogClicks` ([x, y, label] window points; Credits 340,353, Cargo
  418,327, Abort 418,380 in the 832x604 window) are clicked with a shot
  after each, or Return is pressed.
- The result (`log.jsonl` phase `script`, and the step's result) lists
  every leg and every stop's distance; the `b-NN` shots carry the answers.

- **Pass mode (wave 7, `args.pass`).** Instead of stopping and pressing
  `b`, the loop brings the player to rest about `pass.fromPx` from the
  target, aims at its centre, taps thrust for `pass.thrustMs` (an
  inertialess hull keeps the speed it reaches) and presses `b` every
  `pass.pressGapMs` until it is `pass.overPx` past, then brakes
  (`passKeys`, spec in `test/harness.test.mjs`); a dialog is closed with
  `dialogClicks`. Read each press's answer from the recording with
  `analysis/planet_track.mjs --key b --exclude-centre 30` and the target's
  offset with `analysis/magenta_track.mjs`. `pass.speedPxS` is the pass
  speed for the press count; `args.brakeMs` (default 400) is how long Down
  is held (1600 for Kit Crawler Soft). `scenarios/board_pass_*.json`.
- Wave 7 fixes: a step that ends with the target hidden under the
  player's sprite now presses `b` there once (it used to end the walk);
  every stop turns to face the target (`args.faceMinPx`, default 3 px;
  it was 12); a target half under the player still counts (12 px of
  magenta, was 30).
- **Sweep mode (wave 8, `args.sweep`).** A hulk boards only ONCE: after
  the dialog has opened (even left with Abort) every press answers "You
  can't board this ship.". So the walk records whether each stop's press
  was answered (`silent`: the game CLEARS the status line and prints
  nothing), and with `sweep.startOnSilent` (or within `sweep.atPx`) it
  stays at that spot: `repeat` presses without moving, then a `turnMs`
  tap of Right (about 10 degrees) or `between` keys before every press,
  until a dialog (`stopAfter`) or `presses`. `sweepKeys` (spec in
  `test/harness.test.mjs`) builds each press. `args.fineBelowPx` /
  `args.fineStepMs` shorten the steps near the target; `args.fire`
  (`{atPx, keys}`) runs keys once on the way in (the capture runs fire
  the turret at the hulk). `scenarios/board_sweep.json`,
  `board_capture_{5,9}.json`; read them with `analysis/pointer.mjs --run`.

## Minimal app (tested 2026-11-23: launches, enters space, lands)

`/Applications/EV Nova/AbsoluteMinimum.rez` on the MacBook is the smallest
data set that launches the game. The Mac build does not load a `.rez`, so
convert it with `node scripts/novaref/rez_to_ndat.mjs <in.rez> <out.ndat>`.
The conversion produces 190 resources (1 sÿst, 1 spöb, 1 shïp, plus
interface art) and is verified by reading it back. It is identical,
resource for resource, to `plugconvert -data`.

`novaref app setup-minimal <out.ndat>` then makes the copy:

- `rsync -aE` copies `/Applications/EV Nova.app` to
  `~/novaref/apps/EV Nova Minimal.app` without its Nova Files (the real
  bundle is only read).
- The `.ndat` is put in the copy's Nova Files.

Use `"app": "minimal"` in a scenario. The copy shares Pilots, Plug-ins and
prefs with the real game, so the same parking, uninstall and restore rules
apply.

## Analysis helpers (`analysis/`, MacBook, need ffmpeg)

- `motion.mjs <rec.mp4>`: player turn period (from the sprite crop at
  the centre) and a planet template track.
- `world_motion.mjs <rec.mp4> [--from F]`: player velocity from the median
  displacement of all stellar blobs. `RAW=1` prints per-frame
  displacements to stderr.
- `shots.mjs <rec.mp4> --bg F --from F --to F`: projectile speed from a
  stationary ship.
- `discs.mjs <rec.mp4> [--csv out.csv]`: disc-hull centroids per frame and escort offsets along and across the leader's direction of travel (taken from the starfield).
- `frame_events.mjs <rec.mp4> [--threshold 3]`: abrupt whole-frame
  changes. Used to check the video clock against `keys "m wait 20000 m"`.
- `panel_hits.mjs <rec.mp4> [--rect x,y,w,h] [--events recording.events.json]`:
  times every redraw of a small static region, by default the target
  panel's "Armor: NN%" digits, so each change is a hit on a 100-armor,
  1-damage target. With `--events` it also gives each change relative to
  the trigger's `down`/`up` stamps (the late-hit tail of the J-series). Two
  hits in the same frame make one change, so take the total from the
  start and end values in the shots; use the changes for timing.
- `planet_track.mjs <rec.mp4> --events recording.events.json [--from F --to F] [--msg-dir d]`:
  the planet's distance at every `l` press (U9 landing runs). The planet is
  the largest bright blob; a blob clipped by the play-area edge is centred
  from its free side using the size seen in the first frames. `fit` is a
  constant-velocity line through --from..--to read 4.5 frames after the
  press (when the game acts on it), `at_read` the per-frame value (use it
  for stop-and-go runs). Each press also gets a status-line message id;
  `--msg-dir` writes one crop per distinct message to read by eye.
  `land_frame` is the first spaceport frame.
- `radar_blips.mjs <rec.mp4> [--every 5] [--tracks]`: radar dots per frame
  (radar px from the player, about 31.6 world px each in Kit Range), or
  with `--tracks` the moving ones linked into tracks with their first/last
  time and position and their speed at the end: a ship that vanishes away
  from every stellar after accelerating hard jumped out, one that vanishes
  on a stellar's dot landed. h264 strips the colour from 1-pixel dots, so
  tracks link blips of any hue.
- `region_lit.mjs <rec.mp4> [--rect x,y,w,h] --events recording.events.json`:
  when a rect holds white text (an overlay is open): every lit/unlit flip
  with the key events before it. The default rect is the escort panel's
  rows; wave 4 timed the panel's 8.3 s self-close with it.
- Missile paths as one picture (wave 4 asteroid runs): the per-pixel
  maximum of the play area over a few seconds,
  `ffmpeg -ss <t> -t 3 -i recording.mp4 -vf "crop=636:604:0:0,lagfun=decay=1" -update 1 trail.png`
  (t from the trigger's `down` stamp in `recording.events.json`). Rocks
  leave wide streaks, missiles thin purple trails, hits a pink puff.
- `decoy_track.mjs <rec.mp4> [--target x,y] [--out tracks.json]` (wave 5):
  missile heads (saturated red/blue sprites, the white sparkle trail is
  ignored) and asteroids (grey/brown blobs) per frame of a rig where the
  player sits still; each missile's track, where it ended (target, rock,
  edge, lost) and the closest any rock came ahead (≤ 30° off its
  heading), oblique (30-60°) or to the side/behind. The tracker loses a
  missile inside the target's static sprite, so check the ends against
  per-missile trail pictures (lagfun over the track's frames).
- `bolt_births.mjs <rec.mp4> [--radius 26]` (wave 5): every bolt of
  wëap 131's orange graphic tracked from where it first appears, and
  attributed to the red or blue disc it appeared beside: which ship is
  firing when two sides share a weapon graphic.
- `recall_frames.mjs <rec.mp4> --events recording.events.json [--key c]`
  (wave 6): every blue escort disc's distance from the player per frame,
  linked into one track per escort, and per escort the shape of its return
  after the `c` press: first frame on screen, closest pass, the farthest
  swing-out after it (and whether it left the screen), and when it settled
  (steady within 2 px for 30 frames). E-recall runs (`esc_recall2.json`).
- `decoy_encounters.mjs tracks.json...` (wave 6): from `decoy_track.mjs`
  outputs, the rock-in-cell exposure (distance band x bearing off the
  missile's heading) before any capture, the captures per cell, and the
  "misses inside" (a rock 10 deg ahead under 160 px, nearer than the target,
  for 3+ frames, and no capture). The tracker's ends and onsets are noisy:
  check every listed missile against its trail picture.
- `pointer.mjs <shot.png>... [--big] [--hulk-big]` / `pointer.mjs --run <run dir>`
  (wave 8): the player's and the hulk's headings off the pointer hulls
  (snapped to the sheet's 10-degree frames), the hulk's offset, and
  whether the status line holds a message; `--run` lists every stop and
  sweep press of a board run with its answer (dialog / msg / silent).
- `magenta_track.mjs <rec.mp4> --from F --to F [--events recording.events.json] [--key b]`
  (wave 7): the magenta Kit Hulk's offset from the player per frame (found
  by colour, so also under the player's sprite), its median speed, and its
  offset at every `b` press (read 4.5 frames after the stamp).
- `blob_offset.mjs <shot.png>...`: the largest bright blob's offset from
  the play-area centre (where the player is drawn) in a window shot: how far
  the planet or a target ship is (U9 gates).
