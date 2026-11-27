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
| `click x y [--win] [--right] [--double] [--hold-ms N]` | Mouse click. Coordinates are screen points, or EV Nova content coordinates with `--win`. `--hold-ms` keeps the button down N ms (default 60); a hold over 200 ms also stamps the release (`clickup`) for frame sync (wave 12, held scroll arrows). |
| `wheel x y dy [--win] [--count N] [--gap ms]` | Mouse wheel (wave 12): N scroll-wheel events of `dy` LINES each at (x, y), `gap` ms apart; positive dy scrolls up. Each event is stamped (`wheel`). |
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
- `{"click": [x, y], "win": true, "right": false, "double": false}`; `"hold_ms": N` holds the button (wave 12)
- `{"wheel": [x, y, dy], "win": true, "count": N, "gap": ms}` (wave 12)
- `{"drag": [x1, y1, x2, y2], "win": true}`
- `{"open_pilot": "name"}`
- `{"record": "start" | "stop"}`
- `{"launch": true}`
- `{"quit": true}`
- `{"move": [x, y], "win": true}`. `{"move": true}` parks the mouse at (40, 40), outside the game window.
- `{"record": "start", "window": true}` crops the recording; `"fps": 10` (wave 13) lowers the frame rate for long watches. `{"record": "stop", "label": "x"}` writes `recording-x.mp4`.
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
  dominated, priceFlux, and stellarShipCount (spöb id -> defence ships
  left). Ids are resource ids, not indexes.
- **Defence fleets** (wave 39): the pilot file keeps every stellar's
  defence ships LEFT. The base pilot predates the kit, so it holds 0 for
  every kit stellar, which the original reads as "fleet destroyed" (a
  12,800 tribute demand is then accepted at once). A tribute or defence
  experiment must set `"stellarShipCount": {"<spöb id>": <DefCount
  total>}`.
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

**Wave 15 opened new ranges** (every kit spöb id 2000-2175 was taken):
sÿst / spöb **1500-1599** (above the stock maxima 1127 / 1420, below the
kit's 2000; loads and lands fine on the original) and shïp **416-699**
(stock shïp ids are 128-414 plus 895; the kit had used only 415). Use
these for new kit systems, stellars and hulls.

**Wave 20 opened sÿst 1128-1499 / spöb 1421-1499** (1500-1599 filled up in
wave 19; no stock or kit resource used these, checked against the stock
.ndat files and the kit). Wave 20 used sÿst 1130-1147 and spöb 1421-1438; it
loads and lands like the 1500 range. Wave 21 used sÿst 1148-1159, spöb
1439-1450, shïp 497 and mïsn 930-940. Wave 22 used sÿst 1160-1173, spöb
1451-1475, shïp 498-510, düde 445-453, gövt 302-305, wëap 291-293 and mïsn
941-955; next free: sÿst 1174, spöb 1476, shïp 511, düde 454, mïsn 956 (the
stock gap ends at 959), wëap 294, oütf 466, gövt 301 and below.
Wave 23 used sÿst 1174-1179, spöb 1476-1481, shïp 511-514, gövt 301 and flët
307; next free: sÿst 1180, spöb 1482, shïp 515, düde 454, mïsn 956, wëap 294,
oütf 466, gövt 300 and below, flët 308.
Wave 24 used sÿst 1180-1188 / 1190-1194, spöb 1482-1494 / 1497 / 1498, düde
454, gövt 300 and flët 308-309; next free: sÿst 1189 and 1195, spöb 1495 /
1496 / 1499 (then the 1421-1499 range is FULL: open a new spöb range, e.g.
1600-1999 after checking the stock files), shïp 515, düde 455, mïsn 956,
wëap 294, oütf 466, gövt 299 and below, flët 310.
**Wave 25 opened spöb 1600-1999** (checked unused in the old Mac's stock
files, whose spöb stop at 1420, and in the kit: 1421-1599 are full) and
used sÿst 1189 / 1195 / 1196, spöb 1600-1602, shïp 515-516 and düde 455;
next free: sÿst 1197, spöb 1603 (spares 1495 / 1496 / 1499), shïp 517,
düde 456, mïsn 956, wëap 294, oütf 466, gövt 299 and below (stock gövt stop
at 195; the kit uses none of 196-299), flët 310.
Wave 26 used sÿst 1197-1203, spöb 1603-1609, shïp 517-528, düde 456-460,
gövt 299, flët 310-311 and mïsn 956 (bit 9242); next free: sÿst 1204, spöb
1610 (spares 1495 / 1496 / 1499), shïp 529, düde 461, mïsn 957-959 (then the
stock gap is used up: find a new mïsn range), wëap 294, oütf 466, gövt 298
and below, flët 312.
Wave 27 used sÿst 1204-1213, spöb 1610-1618, shïp 529-535, düde 461-466,
gövt 298, wëap 294, oütf 466 and mïsn 957 (bit 9243); next free: sÿst 1214,
spöb 1619 (spares 1495 / 1496 / 1499), shïp 536, düde 467, mïsn 958-959 (then
the stock gap 919-959 is used up: find a new mïsn range), wëap 295, oütf 467,
gövt 297 and below, flët 312. Check a new system's map position against the
kit's others (wave 27 put two at one spot; a snippet in the kit comment).
Wave 28 used sÿst 1214-1221, spöb 1619-1626, shïp 536-541, düde 467-472,
ränk 204 and mïsn 958 (bit 9244); next free: sÿst 1222, spöb 1627 (spares
1495 / 1496 / 1499), shïp 542, düde 473, ränk 205, mïsn 959 (then find a new
mïsn range), wëap 295, oütf 467, gövt 297 and below, flët 312.
Wave 29 used sÿst 1222-1253, spöb 1627-1689, shïp 542-544, düde 473-474,
flët 312-313 and the LAST free kit mïsn ids, 959 / 969 / 1125 / 1126 / 1127
(bits 9245-9249); next free: sÿst 1254, spöb 1690 (spares 1495 / 1496 /
1499), shïp 545, düde 475, ränk 205, mïsn **none** (retire an old kit
mission to add one), wëap 295, oütf 467, gövt 297 and below, flët 314, bits
9250.
Wave 30 used sÿst 1254-1277, spöb 1690-1743, shïp 545-546, düde 475-476
and flët 314-316 (no mïsn); next free: sÿst 1278, spöb 1744 (spares 1495 /
1496 / 1499), shïp 547, düde 477, ränk 205, mïsn **none**, wëap 295, oütf
467, gövt 297 and below, flët 317, bits 9250. A spöb's Type picks its art
(spïn 2000 + Type): keep the clone's Type to keep its graphic.
Wave 31 used sÿst 1278-1300, spöb 1744-1800, shïp 547, düde 477 and oütf
467 (no mïsn); next free: sÿst 1301, spöb 1801 (spares 1495 / 1496 / 1499),
shïp 548, düde 478, ränk 205, mïsn **none**, wëap 295, oütf 468, gövt 297
and below, flët 317, bits 9250. The kit's self-fed wëap 289 is not
plunderable ammo; use a stock launcher / ammo pair (wave 31's Kit Hulk IR).
Wave 32 used sÿst 1301, spöb 1801, shïp 548-551, düde 478-479, gövt
296-297 and flët 317 (no mïsn); next free: sÿst 1302, spöb 1802 (spares
1495 / 1496 / 1499), shïp 552, düde 480, ränk 205, mïsn **none**, wëap 295,
oütf 468, gövt 295 and below, flët 318, bits 9250.
Wave 33 used sÿst 1302-1303, spöb 1802-1803, shïp 552-556, düde 480-482
and oütf 468-469 (no mïsn); next free: sÿst 1304, spöb 1804 (spares 1495 /
1496 / 1499), shïp 557, düde 483, ränk 205, mïsn **none**, wëap 295, oütf
470, gövt 295 and below, flët 318, bits 9250. gövt MaxOdds also gates
NPC-vs-NPC fights: a side whose Strength sum is far below its enemies'
never starts one (wave 32's hunters).
Wave 34 used sÿst 1304-1338, spöb 1804-1872, shïp 557-562 and düde 483-487
(no mïsn); next free: sÿst 1339, spöb 1873 (spares 1495 / 1496 / 1499),
shïp 563, düde 488, ränk 205, mïsn **none**, wëap 295, oütf 470, gövt 295
and below, flët 318, bits 9250. Wormhole rigs: clone stock spöb 465 (Flags
0x21, Flags2 0x2200) and give HyperLinks the destination WORMHOLE's spöb id.
Wave 35 used sÿst 1339-1364, spöb 1873-1911, shïp 563-573, düde 488-496
and flët 318-320 (no mïsn); next free: sÿst 1365, spöb 1912 (spares 1495 /
1496 / 1499), shïp 574, düde 497, ränk 205, mïsn **none**, wëap 295, oütf
470, gövt 295 and below, flët 321, bits 9250. A flët placed by a system
(DudeTypes -id) gives an NPC fight a fixed side; `scenarios/w35_space_early.json`
records from before Enter Ship (a traffic fight's first seconds).
Wave 36 used sÿst 1365-1375, spöb 1912-1928, shïp 574-575, düde 497-501,
gövt 294-295 and flët 321-322 (no mïsn); next free: sÿst 1376, spöb 1929
(spares 1495 / 1496 / 1499), shïp 576, düde 502, ränk 205, mïsn **none**,
wëap 295, oütf 470, gövt 293 and below, flët 323, bits 9250. A flët with
no escorts (counts 0) places a single ship; an UNARMED AI 3 hull of an
always-hostile govt does not close on the player (arm it with a harmless
gun). `scenarios/w36_board_take.json` is the slow-pass board with a take.
Wave 37 used sÿst 1376-1385, spöb 1929-1938, shïp 576-589, düde 502-508,
gövt 291-293, wëap 295, flët 323 and jünk 204 (no mïsn); next free: sÿst
1386, spöb 1939 (spares 1495 / 1496 / 1499), shïp 590, düde 509, ränk 205,
mïsn **none**, wëap 296, oütf 470, gövt 290 and below, flët 324, jünk 205,
bits 9250. A bribed MOBILE warship leaves within seconds (watch a bribe on
the anchored sÿst 1384 rig); an AI 3 armed only with a one-shot weapon
(Reload 30000) never fires it at the player; Tab does not target hired
escorts; `down:ctrl wait 200 up:ctrl` fires the secondary (`ctrl@120` did
not). `scenarios/w37_space_interactive.json` / `w37_space_early.json`
(inbox `w37.jsonl`).
Wave 38 used sÿst 1386-1399, spöb 1939-1954, shïp 590-592, düde 509-511,
gövt 288-290 and bits 9250-9254, and RETIRED wave 7's mïsn 1010-1020 and
wave 6's mïsn 1001 for its own (1001 A8 mission warship, 1010 / 1019 / 1020
A9 pirates, 1011-1018 R13 offers; the old ships and düdes stay); next free:
sÿst 1400, spöb 1955 (spares 1495 / 1496 / 1499), shïp 593, düde 512, ränk
205, mïsn **none** (retire another old kit mission), wëap 296, oütf 470,
gövt 287 and below, flët 324, jünk 205, bits 9255. A pirate (gövt 0x1000)
must be XENOPHOBIC (0x0001, as every stock pirate govt) to attack the
player: 0x1000 | 0x0004 never did; place it by a mission on the player's
port. Weapons are locked once `j` is pressed (a self-disable cannot cut a
jump short). `scenarios/w38_space_interactive.json` / `w38_space_early.json`
(inbox `w38.jsonl`).
Wave 39 used sÿst 1400-1407, spöb 1955-1962, shïp 593-598, düde 512-517,
gövt 285-287 (no mïsn: it reused wave 6's mïsn 1005 ion target and wave
12's mïsn 1039); next free: sÿst 1408, spöb 1963 (spares 1495 / 1496 /
1499), shïp 599, düde 518, ränk 205, mïsn **none**, wëap 296, oütf 470,
gövt 284 and below, flët 324, jünk 205, bits 9255. Set
`stellarShipCount` for any kit stellar whose defence fleet matters (see
"Custom pilots"). `scenarios/w39_space_interactive.json` /
`w39_space_early.json` (inbox `w39.jsonl`).
Wave 40 used sÿst 1408-1427, spöb 1963-1986, shïp 599-627, düde 518-522,
wëap 296-304, oütf 470-486 and bits 9255-9265, and RETIRED wave 10's
friendly-fire mïsn 1024-1031 (bits 9065-9072; the ships and düdes stay),
using 1024-1030 for its own; it also linked wave 39's sÿst 1402 to its
record-spread chain 1424-1427. Next free: sÿst 1428, spöb 1987 (spares
1495 / 1496 / 1499), shïp 628, düde 523, ränk 205, mïsn 1031 (then retire
another old kit mission), wëap 305, oütf 487, gövt 284 and below, flët 324,
jünk 205, bits 9266. A player's fighter bay is a SECONDARY: select it with
`w` before `down:ctrl` (wave 40's first E8 runs launched nothing).
`scenarios/w40_space_interactive.json` / `w40_space_early.json` (inbox
`w40.jsonl`).
Wave 41 used sÿst 1428-1440, spöb 1987-1999 plus the spares 1495 / 1496,
shïp 628-685, düde 523-531, gövt 284, wëap 305-308, oütf 487-489 and bits
9266-9275, and RETIRED wave 10's mïsn 1032-1037 (bits 9073-9080) and wave
11's 1038 / 1040 (bits 9081 / 9083; the ships and düdes stay), using
1031-1038 and 1040 for its own. Next free: sÿst 1441, spöb **none in
1421-1999** (the last spare is 1499: open a new spöb range, checking the
stock files and the kit; the kit holds 2000-2175), shïp 686, düde 532, ränk
205, mïsn **none** (retire another old kit mission), wëap 309, oütf 490,
gövt 283 and below, flët 324, jünk 205, bits 9276. Lessons: the play area
is x 0-639 with the player at (318, 302) (the HUD starts at 640; a click
meant for a stellar 300 px east hit the HUD); a click on a stellar selects
it for `l`; Deionize 0 is NOT "no drain". `scenarios/w41_space_interactive.json`
/ `w41_space_early.json` / `w41_space_early10.json` (10 fps, long watches) /
`w41_r5_title.json` (title-screen reads of several pushed pilots, no
plug-in; inbox `w41.jsonl`).
Wave 42 OPENED spöb **1000-1399**: stock spöb are 128-517 and 1400-1420, so
518-1399 was never used by the stock files or the kit (checked against the
stock .ndat files; the kit's new stellars load and land like the 1421+
ones). It used sÿst 1441-1449, spöb 1000-1010, shïp 686-698, düde 532-536,
përs 1151 (the kit's first person), wëap 309-311, oütf 490-491 and bits
9276-9283, and RETIRED wave 11's mïsn 1041-1044 (bits 9087-9090; the ships
and düdes stay), using them for its own. Next free: sÿst 1450, spöb
1011-1399 (and 518-999), shïp 699 (then stock gaps such as 719 / 727-729 /
888-894), düde 537, ränk 205, mïsn **none** (retire another old kit
mission; wave 11's 1039 is still used by `w39_k3`), përs **none the base
pilot marks alive** (its personAlive array holds only përs 128-643 and 1151;
`pilot-make` has no person edit, so override a stock përs), wëap 312, oütf
492, gövt 283 and below, flët 324, jünk 205, bits 9284. Lessons: the star
field moves in two speed clusters, so a 1 s mean of the star shift reads a
speed RATIO low; `l` does not fly the ship in from beyond the landing window (a landing
after a jump needs the port where the ship arrives, about 1,350 px out, and
Down held about 1.5 s on arrival). Scenarios
`scenarios/w42_space_interactive.json` / `w42_space_early.json` (inbox
`w42.jsonl`) and `w42_pers_board.json` (a përs hail and accept, then
`loops/board.mjs` on the special ship, then hand-driven again).
Wave 43 used sÿst 1450-1456, spöb 1011-1034, shïp 699 (Kit Probe E, Speed
1000) / 719 / 727-729, düde 537-538, oütf 492-496 (long item names), rlëD
1109 / 1111 (two 100 px discs) and bits 9284-9285, and RETIRED wave 12's mïsn
1049 / 1050 (bits 9097 / 9098; düde 339 / 340 stay), using them for its own.
Next free: sÿst 1457, spöb 1035-1399 (and 518-999), shïp 738-739 / 761 /
766-768 / 791 / 888-894 (and 416-419), düde 539, ränk 205, mïsn **none** (retire another old
kit mission), përs: a sÿst Person slot places a person, but the kit's 1151
never appears; override a STOCK përs in a run-only plug-in
(`kits/w43_pers225.mjs`), wëap 312, oütf 497, gövt 283 and below, flët 324,
jünk 205, bits 9286, rlëD 1113 (and the odd ids 1001-1107). The **ruler**:
sÿst 1450 Kit Ruler Start (a decoration 2,000 px out) jumps into 1451 Kit
Ruler, whose 15 moon decorations every 500 px along y = 80 give the ship's
world x per frame (evidence `tools/ruler.mjs`), so speeds need no star
field; read them as slopes over 0.5 s or more (single-frame steps jump
1-6 px even for stellars). Scenarios `scenarios/w43_space_interactive.json`
/ `w43_space_early.json` (inbox `w43.jsonl`), `w43_pers_board.json` (përs
1151 in sÿst 1455's Person slot) and `w43_pers225_board.json` (with
`kits/w43_pers225.mjs`; board.mjs by colour, sweeping at 10 px).
Wave 44 used sÿst 1457-1472, spöb 1035-1101, shïp 738-739 (Kit Probes F / G)
/ 761 / 766-768 / 791 / 888, düde 539, wëap 312, oütf 497-499 and bits
9286-9287, and RETIRED wave 12's mïsn 1051 / 1053 (bits 9099 / 9103; düde
341 / 350 stay), using them for its own. Next free: sÿst 1473, spöb
1102-1399 (and 518-999), shïp 889-894 (and 416-419; then look for other
stock gaps below 895), düde 540, ränk 205, mïsn **none** (retire another
old kit mission), përs: override a stock one (`kits/w43_pers225.mjs`,
`kits/w44_pers225.mjs`), wëap 313, oütf 500, gövt 283 and below, flët 324,
jünk 205, bits 9288, rlëD 1113. New rulers: sÿst 1457 **Kit Accel Pad** (a
decoration start with 14 moons on a 200 x 300 px grid around it: the
ship's position from rest in ANY direction, evidence `tools/grid2d.py`
grid "pad"), 1463 Kit Ion Pad (the same around a port), and 1458 / 1459 Kit
Gravity 5 / 10 Moons (moon starts with reference moons). A **route** in the
map: Find the end system (it centres on it), then SHIFT-click each hop in
turn (`{"click":[x,y],"win":true,"mods":"shift"}`); a Find or a plain click
alone plots nothing. Scenarios `scenarios/w44_space_interactive.json` /
`w44_space_early.json` (inbox `w44.jsonl`), `w44_pers225_board.json` and
`w44_pers225big_board.json` (with `kits/w44_pers225.mjs`: the person in sÿst
1468 Kit Pers Big, whose 250 px port lets the player land after the board).
Wave 45 used sÿst 1473-1481, spöb 1102-1143, shïp 889-894 / 416, düde
540-543, wëap 313-315, oütf 500-505 and bits 9288-9292, and RETIRED wave
12's mïsn 1052 (bit 9100) and 1054 (bit 9104; düde 338 / 342 stay), using
them for its own. Next free: sÿst 1482, spöb 1144-1399 (and 518-999), shïp
417-419 (then look for other stock gaps below 895), düde 544, ränk 205,
mïsn **none** (wave 12's 1059 / 1061-1063 can still be retired; 1060 is
wave 41's A13 hunter), përs: override a stock one, wëap 316, oütf 506,
gövt 283 and below, flët 324, jünk 205, bits 9293, rlëD 1113. A **capture
rig** (`scenarios/w45_capture_use.json`): a live mission's ship cannot be
boarded, so the prize is a ShipBehav-1 / ShipGoal-3 protector placed ON the
port, disabled with the Kit Blast Bomb by `loops/disable.mjs` (the mission
fails and leaves an ordinary hulk), then `loops/board.mjs` and hand-driven
steps; "Use As My Ship" is at (415, 309), and its rename alert takes
`text:` and Return. A captured slow inertial hull lands with the evidence
tool `tools/inertland.mjs`. Scenarios `w45_space_interactive.json` /
`w45_space_early.json` (inbox `w45.jsonl`).
Wave 46 used sÿst 1482-1483, spöb 1144-1161 (1161 added to wave 45's
sÿst 1477 by `wave46Patches`), shïp 417-419, düde 544-547, wëap 316-318 and
bits 9293-9295, and RETIRED wave 12's mïsn 1059 (bit 9105), 1061 (bit 9111)
and 1062 (bit 9112) and wave 10's shïp 846 (Kit Mass Hull 37), using them
for its own. Next free: sÿst 1484, spöb 1162-1399 (and 518-999), shïp
**none** (retire an old kit hull: wave 10's 847 / 848 are unused), düde 548,
ränk 205, mïsn: wave 12's 1063 only (then retire another old kit mission),
përs: override a stock one, wëap 319, oütf 506, gövt 283 and below, flët 324,
jünk 205, bits 9296, rlëD 1113. A **knockback pad** (sÿst 1482 Kit Knock
Pad): a mission with ShipStart -2 puts an immobile AI 3 shooter on the
marker 250 px west of the port, the player takes off at rest and is pushed
east along a moon ruler; an immobile shooter needs a Turn (a Turn-0 one
250 px away never fired). Scenarios `w46_space_interactive.json` /
`w46_space_early.json` / `w46_capture_use.json` (inbox `w46.jsonl`).
Wave 47 used sÿst 1484-1485, spöb 1162-1164, düde 549, wëap 319-321, oütf
506-509 and bits 9296-9305, and RETIRED wave 13's mïsn 1070 (bit 9131),
1071 (bit 9133) and 1072 (bit 9135) and wave 10's shïp 844 / 847 / 848 (Kit
Mass Hull 100 / 155 / 50), using them for its own. Next free: sÿst 1486,
spöb 1165-1399 (and 518-999), shïp **none** (retire an old kit hull: wave
10's 843 Kit Sub Target Big is unused), düde 548 / 550, ränk 205, mïsn:
wave 12's 1063 and wave 13's 1073 (then retire another old kit mission),
përs: override a stock one, wëap 322, oütf 510, gövt 283 and below, flët
324, jünk 205, bits 9306, rlëD 1113. A **blind-spot spin** (sÿst 1484 Kit
Blind Spin): the player spins on the port with Left and Space held, its
turret's bolts read where they leave the planet's disc
(`tools/spinsum.mjs`). An **in-flight bit reader** (sÿst 1485 Kit Flight
Bits): traffic half ungated green, half magenta with AppearOn on the bits
under test. Escort deals: a pilot can hold a CAPTURED escort
(`escorts: [{ship}]`); the escort hail's buttons in the window are Upgrade
Escort (306, 327), Sell Escort (305, 355), Release (306, 383), Close
Channel (306, 411). Scenarios `w47_space_interactive.json` /
`w47_space_early.json` (inbox `w47.jsonl`).
Wave 48 used sÿst 1486-1489, spöb 1165-1169, shïp 843, düde 548, wëap
322-324, oütf 510-511 and bits 9306-9318, and RETIRED wave 12's mïsn 1063
(bit 9113), wave 13's 1064-1067 (bits 9117 / 9121 / 9125 / 9126) and 1073
(bit 9137), and wave 10's shïp 843 (Kit Sub Target Big) with its düde 328,
using them for its own. Next free: sÿst 1490, spöb 1170-1399 (and
518-999), shïp **none** (retire an old kit hull), düde 328 / 550, ränk 205,
mïsn **none** (retire another old kit mission: wave 13's 1074-1084 are
one-off rigs), përs: override a stock one, wëap 325, oütf 512, gövt 283 and
below, flët 324, jünk 205, bits 9319, rlëD 1113. An **in-flight bit
reader**: sÿst 1488 Kit Bits Person lists the stock përs 225 in its Person
slot; the run-only `kits/w48_pers225.mjs` makes it an invincible immobile
hulk whose hail offers mïsn 1066 only while the bits under test are set
(scenario `w48_pers_interactive.json`). A **rock-push field**: sÿst 1486 /
1487 Kit Rock Push Small / Huge (16 rocks of one stock röid) with a start
decoration at the centre; the Kit Plain Ring spins there with a forward
Kit Rock Knock (`tools/rockpts.mjs`, `tools/kinks.py` in the wave-48
evidence). `w48_capture_cargo.json` is wave 46's capture rig with a Mission
BBS job taken first and a hand-driven break for the Leave. Scenarios
`w48_space_interactive.json` (inbox `w48.jsonl`).

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
| wave 10 additions (`wave10Resources`; nothing retired) | Submunitions: sÿst/spöb 2045 Kit Sub Range (port) + 2046 Kit Sub Mark (150 px north), shïp 836 Kit Sub Target (24 px magenta disc) / 843 the 96 px one, düde 319 / 328, mïsn 1023 / 1033 (bits 9064 / 9075); wëap 251 Kit Sub Star (the sub: planet-type, passes through ships) and test parents 252-262, 268-276 (secondaries). Friendly fire: sÿst 2047 Kit FF Range (port, marks 2048 / 2049 at 110 / 260 px north), shïp 837 / 840 / 841 / 842 Kit FF Shooter (bolt / beam / missile / blast, wëap 263-266), 838 Kit FF Victim (wëap 267 pea), 839 Kit Ring Tank (player), gövt 358 / 359 (mutual allies), düde 320-327, mïsn 1024-1031 (bits 9065-9072; shooters offered on landing, victims are Mission BBS jobs). jünk 202 Kit Doodads (both lists at Kit Port). #324: sÿst/spöb 2052 Kit BBS Dest, 2054 Kit BBS Shown (Visibility b9074), mïsn 1032 (BBS job, bit 9073, OnAccept b9074), 1034 (bit 9074). Negative penalties: gövt 369, sÿst/spöb 2060, düde 329, mïsn 1035 (bit 9076). Auto-abort: mïsn 1036 / 1037 (bits 9077 / 9080). Mass-scaled outfits: oütf 452-455, shïp 844-848 Kit Mass Hull 100 / 300 / 37 / 155 / 50 (25 t free). |
| wave 11 additions (`wave11Resources`; nothing retired) | **Running lights off on every kit shän** (`withoutRunningLights`: LightImage / LightMask -1, BlinkMode 0; until wave 11 most kit hulls blinked the stock lights). Revive: shïp 849 Kit Ally Pointer (pointer-hulk sprite, AI 3, shield 1000 / armor 3000, no recharge), wëap 277 Kit Blast 600 + oütf 456, düde 330 / 331, mïsn 1038 (b9081, ShipBehav 1 / goal 3), 1039 (b9082, neutral, no goal), 1040 / 1041 / 1046 (b9083 / 9087 / 9092: goal-5 rescues, 1040 with 0x0001). Mass: oütf 457 Kit Mass Keep (0x0404), shïp 850 / 851 Kit Mass Roomy 100 / 300 (first in the shipyard). Subs: wëap 278 Sub Beam Short, 279 Sub Beam Fixed, shïp 852 Kit Sub Target 48 (rlëD 1963), düde 332, mïsn 1042 (b9088). A14: gövt 350-353, sÿst/spöb 2061 / 2064 / 2067 (in sÿst 2062) / 2070, sÿst 2062 / 2063 / 2065 / 2066, düde 333 / 334 / 337, mïsn 1043 / 1044 / 1047 / 1048 (b9089 / 9090 / 9093 / 9094). AppearOn: shïp 853 / 854, düde 335, mïsn 1045 (b9091). S1: gövt 354 Kit Customs, shïp 855 Kit Customs Cutter (red disc, AI 4), düde 336, sÿst/spöb 2068 Kit Scan Gate -> 2069 Kit Scan Range, oütf 458 Kit Contraband Pod (ScanMask 0x0001). The wave-11 missions clear their own availability bit on accept. |
| wave 12 additions (`wave12Resources`; nothing retired) | Duel (D): gövt 355 Kit Duellist (stock 175's 0x0002, no penalties), in Kit FF Range: shooters as the spaceport offer (ShipBehav 0, far mark) mïsn 1049 / 1050 / 1051 (bits 9097-9099: Kit FF Shooter bolt, shïp 858 + wëap 281 Kit Duel Blast, shïp 857 + wëap 280 Kit Duel Beam, one 5000-damage frame); the duellist as a BBS job (ShipGoal 1, ShipBehav 0, near mark, OnSuccess b9101 / OnFailure b9102): mïsn 1052 (9100, shïp 856, shield 200 / armor 1500) and 1053 (9103, shïp 865, shield 0); wëap 282 Kit Duel Gun + oütf 459; düde 338-341, 350. **BBS jobs carry DispWeight 30000** so they list first (a stock job took the Accept once). IFF (H): gövt 356 Kit Hunter / 357 Kit Prey (mutual enemies), shïp 859 / 860 (yellow / cyan discs), düde 342 / 343, traffic of sÿst 2071 Kit Hunt Range; sÿst/spöb 2077 Kit Hunt Arena with mïsn 1054 / 1059 (bits 9104 / 9105); anchored copies shïp 866 / 867, düde 352 / 353, mïsn 1060 / 1061 (bits 9110 / 9111) on Kit FF Range's marks. A14 (A): shïp 861 Kit Bare Trader (AI 1, shield 0), traffic systems sÿst/spöb 2072 Kit Owner Traffic (351 owns, 350's traders, düde 344), 2073 Kit Law Traffic (352, 353's: düde 345), 2074 Kit Victim Traffic (350, its own), 2075 Kit Negative Traffic (369, düde 346), 2078 Kit Ally Traffic (gövt 340 owns, allied 341's traders: düde 351); wëap 283 Kit One Shot (10000) + oütf 460, wëap 284 Kit Gun 300 + oütf 461. Escort vs trader (W): sÿst/spöb 2076 Kit Brave Range, AI 2 shïp 862 (green disc), düde 347. Subs (S): shïp 863 / 864 Kit Sub Bar Side / End (rlëD 1965 / 1967: a 76 x 14 bar, the same on all frames), düde 348 / 349, mïsn 1055 / 1056 (bits 9106 / 9107). Scrolling (U): mïsn 1057 (9108, a 60-line offer text at Kit Port), 1058 (9109, the same as a BBS job). S2: mïsn 1062 / 1063 (bits 9112 / 9113: 1 t of ScanMask 0x0001 food from Kit Scan Port, with / without Flags 0x0020; OnFailure b9114 / b9115). P1: gövt 342 Kit Police / 343 Kit Shipping, shïp 868 / 869, düde 354 / 355, sÿst/spöb 2079 Kit Police Range. |
| wave 13 additions (`wave13Resources`; nothing retired) | Abort (X): mïsn 1064 (b9117, the Kit Ally Pointer as a ShipBehav 1 / goal 3 escort), 1065 (b9121, two shïp 871 Kit Abort Raiders, düde 357, ShipBehav 0 / goal 0). NPC disables (N), in Kit FF Range: wëap 285 Kit Disabler (one 1200-damage bolt, reload 30000) on shïp 872, düde 358, mïsn 1066 (b9125, far mark); shïp 873 Kit Ally Anchored + düde 359 / mïsn 1067 (b9126, BBS, goal 3); gövt 348 Kit Ally Class / 349 Kit Ally Hater (enemy of 348), düde 365 (shïp 879 Kit Hater: wëap 287, 50 damage a second) / 366, mïsn 1074 (b9139) / 1075 (b9140, goal 3, ShipBehav 1). Same-govt missile (G): gövt 344 Kit Xeno (0x0001), 339 Kit Self Hater (its own class an enemy), wëap 286 Kit Xeno Missile, shïp 874 / 875, düde 360 / 361 / 367 / 368, mïsn 1068 / 1069 (b9129 / 9130), 1076 / 1077 (b9143 / 9144). Rescue (R): stock mïsn nova:394 moved to Kit Port, mïsn 1070 (b9131, ShipStart 2), 1071 (b9133, ShipStart -1), 1072 (b9135, no mission cargo), 1073 (b9137, the kit düde 330). A14: gövt 345 Kit Odd Owner (11 / 3 / 25), sÿst/spöb 2082 Kit Odd Traffic (linked to 2083 / 2084), 2083 Kit Odd Home (345, linked to 2082 / 2081), 2084 Kit Odd Neighbour (363), 2081 Kit Odd Far (345). Traffic (T / S / M): gövt 346 Kit Life Traders / 347 Kit Life Hostile (mutual enemies), shïp 876 Kit Life Trader (green), 877 Kit Life Shuttle (blue, Flags3 0x0002), 878 Kit Miner (cyan, Flags3 0x0003, stock scoop oütf 271 + four wëap 181), düde 362-364; sÿst 2085 Kit Life Range and 2089 Kit Shuttle Range (a port and a market of 346, an uninhabited marker, a port of 347; avgShips 6), 2093 Kit Mine Range (16 metal rocks, avgShips 3). P1 run 6: flët 303 Kit Convoy (shïp 880 lead, two 881 guards, gövt 343) in sÿst/spöb 2094 Kit Convoy Range. P1 run 2: wëap 288 Kit Disable Gun (3000 shield / 2100 armor a hit: two hits disable a 3000 / 3000 hull) + oütf 462. |
| wave 14 additions (`wave14Resources`; nothing retired) | A14 spread (A): gövt 338 Kit Spread Owner (Disab 2 / Board 2 / Kill 8000; ally 337, enemy 336) owns sÿst/spöb 2095 Kit Spread Kill (traffic düde 344, gövt 350's bare traders) and the chain 2096-2099, 2108, 2109 (one to six jumps); 2135 / 2136 / 2137 (owned by 337 / 336 / 350) are linked to 2095; 2138 is reached only through a hypergate (spöb 2129 in 2095), 2139 only through a wormhole (spöb 2146). Penalty: gövt 335 (2 / 2 / 8000; ally 334, enemy 333) owns 2158 (its own bare traders, düde 369) and 2159; 2050 (334) and 2051 (333) are linked to 2158. mïsn 1079 (b9145): CompGovt 338, CompReward 1000 at Kit Port. Contraband (S): mïsn 1078 (b9147, Kit Scan Port) / 1081 (b9152, Kit Scan Tolerant Port): kit copies of stock mïsn 441 (Flags 0x0020, ScanMask 0, 10 t of food); customs govts with two AI 4 cutters each (shïp 855): 332 Tolerant (CrimeTol 30000) in 2053, 331 Free (ScanFine 0) in 2055, 329 Percent (ScanFine -5) in 2058, 330 Nosy (0x0002, home 2056) flying in 2057 (owner 363) and sÿst 2029 / spöb 2066 (owner 322 Kit Smug Owner, SmugPenalty 70); jünk 203 Kit Contraband (ScanMask 0x0001) sold at Kit Scan Port (one Buy click buys 10 t). Police (P): sÿst/spöb 2059 Kit Raid Range (342 police, 343 shipping, 327 Kit Shipping Quiet Flags2 0x0008 blue shïp 883, 328 Kit Raider P yellow shïp 882); sÿst 2001 / spöb 2062 Kit Nosy Range (326 Kit Police Nosy 0x0002, 343, 325 Kit Shipping Ignored 0x0020 cyan shïp 884); sÿst 2008 / spöb 2063 Kit Friend Range (323 Kit Police Allied, its ally 324's blue traders). Miners (M): sÿst 2010 / spöb 2065 Kit Mine Mixed (16 metal rocks): the Kit Miner hull as AI 2 green (shïp 885), AI 3 yellow (886), and an AI 4 Flags3-0x0001 red without a scoop (887). Rescue (R): mïsn 1080 (b9150) = wave 13's 1071 with the kit düde 330. Late: sÿst 2031 / spöb 2156 Kit Scan Tolerant Gate (gövt 363, linked to 2053, for a rescan after a jump), mïsn 1082 (b9155, Kit Port: CompGovt 338, CompReward 100, Flags 0x0040, for the abort's -5R). düde 369-382. |
| wave 15 additions (`wave15Resources`, `wave15Patches`; nothing retired; new ranges sÿst/spöb 1500-1599, shïp 416-699) | Colour-coded traffic (T / S): sÿst 1500 Kit Square Range (owner 346), stellars in list order 1501 Square Hostile (220,220, gövt 347), 1502 Square Market (220,0), 1500 Square Port (0,0, the player), 1503 Square Neutral (0,220, gövt 363), 1504 Square Marker (-220,0, uninhabited): all on screen from the port; AI 1 traders shïp 420-423 (red / orange / yellow / green, düde 383) and Flags3-0x0002 shuttles 424-427 (azure / blue / purple / magenta, düde 384), avgShips 6; new disc rlëDs 1956 orange, 1958 azure, 1960 purple. Added during the wave: sÿst 1550 Kit Square Traders Range (spöb 1551 / 1552 / 1550 / 1553 / 1554, the same layout and list order) with the traders only. Miners (M): sÿst/spöb 1505 Kit Mine Colour (16 rocks), AI 1 Kit Miner hulls shïp 428-431 (red / yellow / blue / magenta, düde 385), avgShips 2. A14: sÿst/spöb 1510 Kit Spread Unowned (govt -1, gövt 350's bare traders) linked to 2095 (patched) and to 1511 Kit Spread Beyond (338, no stellar); mïsn 1083 (b9160, Kit Port: CompGovt 338, CompReward 1000, TimeLimit 1, ReturnStel Kit Market). Contraband: gövt 321 Kit Smug Ally Owner (Smug 70) owns sÿst/spöb 1515 Kit Scan Ally, patrolled by its ally 320 Kit Customs Ally's cutters (düde 386); jünk 203 also sold at 2053 (patched); mïsn 1084 (b9163, at 2053: 1 t of ScanMask-0x0001 food, Flags 0x0020). Police: sÿst/spöb 1520 Kit Nosy Gate linked to 2001 (patched); 1525 Kit Friend Ign Range (gövt 319 police, its 0x0020 ally 318's blue traders, düde 387 / 388); 1530 Kit Distress Range (raiders 374, Kit Shipping 355, possible answerers: orange guard of 343 shïp 432 / düde 389, blue ally 317 shïp 433 / düde 390, cyan bystander 316 shïp 434 / düde 391, red bystander police 315 düde 392). Status bar: mïsn 1085 (b9166, offer) and 1086 (b9167, BBS) carry 3 t of cargo 7 "Military Stores", 1087 (b9168, BBS) 3 t of cargo 11 "Money Train". W1: sÿst/spöb 1535 Kit Hull Flags Range, hostile (362) AI 3 discs shïp 435 red Flags2 0x0080 + wëap 289 Kit Ammo Missile (5 rounds), 436 green control, 437 yellow 0x0002, 438 blue 0x0001, 439 magenta Flags 0x0040 (düde 393-397). C1: sÿst/spöb 1540 Kit Cloak Range, stock Wraith cloak (oütf 266) on discs: 440 green AI 1 0x0800, 441 blue AI 1 0x0400, 442 orange AI 1 0x2000, 443 yellow AI 3 0x4000, 444 red hostile AI 3 0x1800 (düde 398-402). H1: sÿst/spöb 1545 Kit Assist Range: Kit Raiders (düde 602), blue neutral AI 3 shïp 445 (düde 403), green neutral AI 1 shïp 446 (düde 404). |
| wave 16 additions (`wave16Resources`; nothing retired; map row y = -1060) | Distress answerers (D): sÿst/spöb 1560 Kit Answer Range (363, no traffic; mark 1561 at 160,0): offers put an ANCHORED (Speed 0, 30000 / 30000) green victim of 343 on the mark, AI 1 / 2 / 3 (shïp 447-449, düde 405-407, mïsn 1088-1090, b9170-9172), BBS jobs a Kit Raider P on the mark (1091, b9173) and one candidate at the port (1092-1095, b9174-9177: düde 389 / 390 / 391 / 392); added: shïp 452 thin (shield 300) / 453 mobile victims (düde 415 / 416, 1107 / 1108, b9189 / 9190), sÿst/spöb 1582 Kit Call Range A (traffic raiders, 1109 / b9191) and 1584 Kit Call Range B (traffic Kit Shipping, a mission raider 1110 / b9192). Police (W): sÿst 1562 Kit Watch Range (owner 326 nosy), markers 1563-1565 at 300 / 1000 / 2500 px, offer 1097 (b9179) the anchored victim at the port, BBS 1098-1100 (b9180-9182) an ANCHORED nosy police (shïp 450, düde 408) on a marker, 1101 (b9183) a 362 Kit Raider, 1096 (b9178) a mobile nosy police and 1106 (b9188) a Kit Raider P at the port. A14: gövt 314 Kit Victim Odd (400 / 7 / 70), düde 409, sÿst/spöb 1566 Kit Spread Kill 3 (338) -> 1567 Kit Spread Unowned 3 (-1) -> 1568 Kit Spread Beyond 3 (-1). Contraband: gövt 313 Kit Customs Big (ScanFine 5000) owns sÿst/spöb 1569 (düde 410). Shuttles: one-hull düdes 411-414 (shïp 424-427); sÿst 1570 Kit Lane Range (stellars 1571 East, 1572 North, 1570 Port, 1573 Centre at uneven distances), 1574 Kit Lane One (one own port, two enemy ports 1575 / 1576), 1577 Kit Lane None (two enemy ports, 1578). W1: sÿst/spöb 1579 Kit Hull Flags 2. C1: sÿst/spöb 1580 Kit Cloak Provoke, offer 1102 (b9184, the 0x4000 yellow), BBS 1103 / 1104 (b9185 / 9186, 0x0400 blue, 0x2000 orange). H1: sÿst/spöb 1581 Kit Assist Calm, offer 1105 (b9187) the anchored Kit Disabler at the port; shïp 451 Kit Fragile (shield 0, armor 1500). Scenarios `w16_space_interactive.json` (hand-driven, 10 fps) and `w16_stock_interactive.json` (NO plug-in, Last Pilot parked: the stock-Sol census). |
| wave 17 additions (`wave17Resources`; nothing retired; map row y = -1100; the first kit ränk) | P1: sÿst 1585 Kit Self Defence (owner 326 nosy, no traffic), spöb 1585 port, markers 1586 (300,0), 1587 (0,150), 1588 (5000,0), 1589 (-9000,0); offer 1111 (b9193) shïp 454 Kit Shooter Anchored (düde 417, gövt 362, a 1-damage turret: it never fired first), offer 1124 (b9209) the Kit Disabler (düde 358) on 1587, BBS 1112 (b9194) the anchored nosy police on 1586; offer 1113 (b9195) the anchored victim at the port, BBS 1114 / 1115 (b9196 / 9197) the police on 1588 / 1589; AI 4 allies düde 418 (317, blue) / 419 (343, orange) as BBS 1116 / 1117 (b9198 / 9199) at 1560. H1: ränk 200 Kit Assist Rank (AffilGovt 363, Flags 0x0400; built by cloning ränk 128 with raw `@offset` fields: plugin-make has no ränk field names) given by offer 1118 (b9200, OnAccept K200) at 1545; shïp 456 Kit Fragile Ally (InherentGovt 317) and offer 1123 (b9208, the Kit Disabler) at 1584. C1: sÿst/spöb 1590 Kit Cloak Anchor, marker 1591 (200,0), offer 1119 (b9201) shïp 455 (the 0x4000 yellow, anchored; düde 420). Contraband: sÿst/spöb 1592 Kit Scan Clean (313's four cutters). Rescue: mïsn 1120 / 1121 / 1122 (b9202 / 9204 / 9206) at Kit Port, ships on marker 2102 (about 3,000 px out: too far for `loops/board.mjs`) / ShipStart 2. Scenarios `w17_space_interactive.json`, `w17_stock_interactive.json` (no plug-in), `w17_rescue_board.json`. |
| wave 18 additions (`wave18Resources`; nothing retired; map row y = -1140; **mïsn 919-924**: the kit's mïsn ids past 1124 stop at the game's 1127, so wave 18 uses the free ids 919-959 between the stock missions, 128-918, and the kit's 960) | A14: gövt 312 Kit Spread Disab (400 / 800 / 2000, CrimeTol 30000) owns sÿst 1593 Kit Disab Owner (port spöb 1593) and 1594 Kit Disab One (no stellar); sÿst 1595 Kit Disab Unowned (govt -1, port spöb 1594); links 1595 - 1593 - 1594; traffic of 1593 / 1595: 312's AI 1 magenta pointer hulks (shïp 466, 3000 / 3000, düde 424: two Kit Disable Gun hits disable, three kill). Traffic: sÿst 1596 Kit Traffic AI2 (port spöb 1595; AI 2 traders of 363 with a gun, red / orange / yellow / green shïp 457-460, düde 421) and 1597 Kit Traffic AI3 (port spöb 1596; AI 3 warships of 363, azure / blue / purple / magenta shïp 461-464, düde 422), avgShips 4 each. W1: sÿst 1598 Kit Burn One (port spöb 1597): the magenta 0x0040 hull (düde 397) alone, avgShips 1. P1: shïp 465 Kit Pest Anchored (anchored red, gövt 362 via düde 423, the Kit Raider Gun turret), offer 919 (b9210) on 1587 in Kit Self Defence. H1: offer 920 (b9211) at Kit Assist Calm (1581): OnAccept K200 (ränk 0x0400) and a Kit Raider at the port; ränk 201 Kit Free Repair Rank (AffilGovt 363, Flags 0x0800) by BBS 921 (b9212) at 1581. Rescue on Kit Self Defence's 300 px marker 1586: offers 922 (b9213, the kit düde 330 with the Raczak cargo), 923 (b9215, no cargo), 924 (b9217, the kit düde with ShipStart 2), ReturnStel 1585. Scenarios `w18_census_watch.json` (20 min, a 20-Tab census every 2 min), `w18_plain_watch.json` (8 min), `w18_burn_watch.json` (4 min at 30 fps), `w18_space_interactive.json`, `w18_rescue_board.json`. |
| wave 19 additions (`wave19Resources`; nothing retired; map row y = -1180; **the wave-15 sÿst / spöb range 1500-1599 is now full**: wave 19 used sÿst 1599 and the gaps 1506-1509 / 1512, spöb 1506-1509 / 1598 / 1599; a later wave needs a new range, e.g. sÿst 1128-1499 / spöb 1421-1499 above the stock maxima; mïsn 925-928 from the free stock gap 919-959) | Fleets (T): flët 304 Kit Stay Fleet (gövt 363: lead shïp 467 Kit FS Lead, cyan, AI 3; escorts 468-471 Kit FS Red / Orange / Yellow / Green, 0-1 each) the only traffic of sÿst 1599 Kit Fleet Stay (port spöb 1598), avgShips 2. Reinforcements (R19): gövt 311 Kit Reinf Owner (MaxOdds 100, MediumName "Kit Reinf", CrimeTol 30000) owns sÿst 1506 Kit Reinf Range (port spöb 1506; ReinfFleet 305, ReinfTime 300, ReinfIntrval 0) and 1507 Kit Reinf Slow (port 1507; ReinfTime 900, ReinfIntrval 1), linked; traffic 311 AI 1 Kit RV Trader (shïp 474, magenta pointer, 30000 / 30000, düde 425), avgShips 2; flët 305 Kit Reinf Fleet (lead shïp 472 purple, two 473 blue guards, gövt 311, LinkSyst 1594 so it never roams here); sÿst 1512 Kit Reinf Rank (port spöb 1599, 311 AI 4 warships shïp 481 / düde 429) with offer 928 (b9224: ränk 203 AffilGovt 311 Flags 0x0400 + a Kit Raider). H1: sÿst 1509 Kit Assist Stay (port 1509): AI 4 warships of 363 (shïp 475-478, düde 426), avgShips 6, staying, to hail many ships per case; offer 925 (b9221: ränk 200 + a Kit Raider). ränk 0x0800 with an ally: gövt 310 Kit Rank Affil / 309 Kit Rank Ally (mutual allies), ränk 202 (AffilGovt 310, 0x0800), sÿst 1508 Kit Ally Assist (port 1508; AI 4 blue 309 shïp 479 / düde 427 and purple 310 shïp 480 / düde 428), BBS 926 (b9222, K202), offer 927 (b9223, the Kit Disabler). Scenarios `w19_census_watch.json`, `w19_space_interactive.json`. Rescue and A14 boarding were driven by hand with the Kit Ring Crawler (818): TARGET the hulk (Tab) before `b`. |
| wave 20 additions (`wave20Resources`; nothing retired; map row y = -1220; **a new sÿst / spöb range 1128-1499 / 1421-1499** above the stock maxima 1127 / 1420 (checked unused); used: sÿst 1130-1147, spöb 1421-1438; mïsn 929 from the stock gap) | Reinforcement fleets (R19, second pass): every system is owned by a fleet govt with one kind of traffic, avgShips 1 (1142: 2). Victims on the magenta pointer sprite, 30000 / 30000, NO shield recharge: slow AI 1 (Speed 20) shïp 482-487 Kit RV Anchor S50 / S110 / S150 / S200 / S300 / S400 (düde 430-435) in sÿst 1130-1134 Kit Odds 110 / 150 / 200 / 300 / 400 (gövt 311, flët 305, ReinfTime 300); the AI 4 stayer shïp 494 Kit RV Guard S50 (Kit Escort Gun; düde 441 of 311, 442 of 308) in sÿst 1135-1138 Kit Reinf T600 / T1800 / T1200 / T150, 1139 Kit Reinf Int2 (ReinfIntrval 2), 1140 Kit Reinf Base and 1141 Kit Reinf Ally (owner gövt 307 Kit Reinf Owner B, MediumName "Kit Reinf B", flët 306; victims of its ally gövt 308); 1142 Kit Reinf Pair (two S50), 1143 Kit Reinf Mobile (shïp 488, Speed 300, düde 437); one-hit points shïp 489-491 S400 Sh3000 / S400 Sh6000 / S1000 Sh3000 (düde 438-440, sÿst 1144-1146). Player: wëap 290 Kit Pulse Beam (turreted beam, one 3000 / 2100 frame, reload 60, beamLength 5000) + oütf 463; oütf 464 / 465 Kit Reinf Inhibitor (ModType 44, ModVal 311 / -1); shïp 492 / 493 Kit Lancer S300 / S50; sÿst 1147 Kit Reinf Chase (a fast AI 4 victim, shïp 495, düde 443, ReinfTime 1800). Rescue: mïsn 929 (b9225, Kit Self Defence) = wave 18's ShipStart-2 rescue with shïp 496 Kit Cloak Rescue (stock Wraith cloak oütf 266, Flags2 0x5F00; düde 444). **An anchored (Speed 0) victim never calls the fleet**, and an AI 1 victim that jumps out before the arrival gets none: use a victim that stays (AI 4). Scenario `w20_space_interactive.json`; drivers in the wave-20 evidence `tools/` (`onehit.sh`, `pulse2.mjs`, `days.sh`). |
| wave 21 additions (`wave21Resources`; nothing retired; map row y = -1260; sÿst 1148-1159, spöb 1439-1450, shïp 497, gövt 306, mïsn 930-940 from the stock gap, bits 9227-9232) | #324 (the BBS, venues and map after an accept in the same visit): sÿst 1148 Kit Live Range, port spöb 1439 (PORT_FLAGS: bar, trade center, outfitter, shipyard), linked to 1152 Kit Live Next (no stellar); BBS jobs 930 A (!b9227, OnAccept "b9227 b9228", destination spöb 1440), 931 B (!b9227, OnAccept b9227), 932 C (b9228), offers 933 (trade center, AvailLoc 4) and 934 (bar, AvailLoc 1) on b9228; sÿst 1149 Kit Live Shown (Visibility b9228) / 1150 Kit Live Hidden (!b9228). A record change: gövt 306 Kit Live Owner (CrimeTol 30000) owns sÿst 1151 Kit Live Record (port 1442); BBS 935 (Flags 0x0040, CompGovt 306, CompReward 100: an abort costs -500), 936 (AvailRecord 50), 937 (AvailRecord -100), 938 (OnAccept "A935"). R19: sÿst 1153 / 1154 Kit Reinf Far A / B (ReinfTime 150, the only port at (6000, 0); AI 4 guard düde 441 / mobile AI 1 düde 437), 1155 Kit Reinf Two (two slow AI 1 S50, ReinfTime 600), 1156 Kit Reinf Leave One (one), 1159 Kit Reinf Slow 300; 1158 Kit Reinf Far M (port at (3000, 0)) with offer 940 (b9232, the guard as a mission ship: never appeared); shïp 497 Kit Ring Lancer (pointer sprite, Lancer stats). H1: sÿst 1157 Kit Rank Calm (363 AI 4 warships, port 1447, marker 1448 at 3500 px), offer 939 (b9231: ränk 200 and a Kit Raider). Scenario `w21_space_interactive.json`; drivers in the wave-21 evidence `tools/` (`onehit.sh`, `pulse2.mjs`, `waitnear.mjs`, `fuelrun.sh`). |
| wave 22 additions (`wave22Resources`; nothing retired; map row y = -1300; sÿst 1160-1173, spöb 1451-1475, shïp 498-510, düde 445-453, gövt 302-305, wëap 291-293, mïsn 941-955, bits 9233-9241) | R19 (one change at a time from the mobile S50 488; every system gövt 311 / flët 305 / ReinfTime 300, port at (0,0)): shïp 498 AI 2, 499 AI 3, 500 AI 4, 501 an attributes govt with Flags2 0x0008 (gövt 305 Kit Quiet Attr via InherentGovt 1305), 502 Speed 20 (düde 445-449, sÿst 1160-1164, ports 1451-1455); sÿst 1165 Kit Reinf Far C (port 1456 at (3000, 0), markers 1457 at the centre and 1458 1,000 px off the port). Mission ships: sÿst 1166 Kit Ship Test (port 1459), BBS 941 (düde 441); BBS 942-944 at Kit Reinf Far M's port. #324: sÿst 1167 Kit Live Refilter (port 1460, PORT_FLAGS) linked to 1168 (no stellar); BBS 945 X, bar offer 946 Y (falsifies X), BBS 947 Z, BBS 950 setter, shipyard 948 / outfitter 949 offers (AvailLoc 5 / 6), BBS 951-954 at AvailRandom 50. H1: offer 955 (ränk 200, no raider) at Kit Rank Calm. R7 bribes: gövt 304 Kit Bribe Plain (0x4000 / 0x2000 / 0x0200), 303 Kit Bribe Large (0x8000), 302 Kit Bribe Large Ships (0x8000 / 0x0200), CrimeTol 10; sÿst 1169 / 1170 / 1173 with ports 1461 / 1462 / 1475 (MinStatus 0) and AI 3 Kit Bribe Warships (shïp 503; düde 450 / 452 / 453; shïp 504 / düde 451 a freighter, unused). K8: sÿst 1171 Kit Radar Shapes (port 1463, planets 1464-1469 of spöb Type 1 / 6 / 19 / 24 / 26 / 17) and 1172 Kit Radar Station (port 1470; 1471-1474: Types 1, 17, 6 as stations, 26 as a planet). F1c: hired disc escorts shïp 505 orange / 506 azure / 507 purple; disc fighters 508-510 (red / green / blue) launched by wëap 291-293 Kit F1c Bay Red / Green / Blue. Scenarios `w22_space_interactive.json`, `w22_stock_interactive.json` (no plug-in); drivers in the wave-22 evidence `tools/` (`r19.sh` with `hitat.mjs` and `lines.mjs`, `bribe2.sh`, `f1c2.sh` with `comps.mjs`, `fuelrun.sh`, `counters.mjs`). |
| wave 23 additions (`wave23Resources`; nothing retired; map rows y = -1340 to -1470; sÿst 1174-1179, spöb 1476-1481, shïp 511-514, gövt 301, flët 307) | Fleet scans: gövt 301 Kit Scan Fleet (ScanMask 0x0001, CrimeTol 30000) owns sÿst 1174 Kit Fleet Scan (port 1476); its only traffic flët 307 (cyan AI 3 lead shïp 511, red / green AI 4 escorts 512 / 513). R1 map dots: sÿst 1175 Kit Map Hub (port 1477) linked to 1176 Kit Map Attacks (gövt 362, 0x0004), 1177 Kit Map Xeno (gövt 344, 0x0001), 1178 Kit Map Wanted (gövt 360; its only stellar spöb 1480 a STATION on the Type-1 gate art, MinStatus 0: also the hostile animated-station hail) and 1179 Kit Map Clean; 1176 - 1177 linked. Escort cap: shïp 514 Kit Hire Disc (HireRandom 100, TechLevel 1; wave 23 read the bar's pool as gated by TechLevel only, wave 25 refuted it: a SpecialTech match is hired too). Scenarios `w23_space_interactive.json`, `w23_stock_interactive.json` (no plug-in); `analysis/sprite_match.mjs` (where and at what scale a stock rlëD frame sits in a shot); drivers in the wave-23 evidence `tools/` (`start.sh`, `watch.sh`, `discshot.mjs`, `ring.mjs`, `bbox.mjs`, `leaver.mjs`, `fireleave3.mjs`, `tabpanel.sh`). |
| wave 24 additions (`wave24Resources`; nothing retired; map rows y = -1530 to -1640; sÿst 1180-1188 / 1190-1194, spöb 1482-1494 / 1497 / 1498, düde 454, gövt 300, flët 308-309) | Gate map (G): kit hypergates cloned from stock HG-V01 (spöb 1400: Type 1, Flags 0x11, the 42-frame art) but usable (govt -1, MinStatus -32767, Flags2 0x1000 only), each alone in a gövt-363 system with no hyperlinks: network A spöb 1482 Kit Gate A1 (sÿst 1180) <-> 1483 A2 (1181); network B 1484 B1 (1182) <-> 1485 B2 (1183); network C with a ONE-WAY lane 1486 C1 (1184) -> 1487 C2 (1185), C2 <-> 1488 C3 (1186). Map dots (M): sÿst 1187 Kit Map Mixed (gövt 360; refusing planet spöb 1489 MinStatus 0 + open 1490), 1188 Kit Map Picky (363; port 1491 MinStatus 100), 1193 Kit Map Wanted Planet (360; planet 1497 MinStatus 0), linked 1187 - 1188 - 1193. Scan controls (S): sÿst 1190 Kit Lone Scan (gövt 301, port 1492; düde 454 = the AI 4 shïp 512 alone), gövt 300 Kit Scan Fleet Strict (301 with CrimeTol 10) and its flët 309 in sÿst 1194 (port 1498). Disabled ships (D): sÿst 1191 Kit Lone Leaver (port 1493; wave 18's düde 424 at avgShips 1), flët 308 Kit Big Fleet (lead 467 + one each of 468-471) in sÿst 1192 Kit Fleet Big (port 1494, avgShips 5). Scenarios `w24_space_interactive.json`, `w24_stock_interactive.json`; drivers in the wave-24 evidence `tools/` (`boardhand.mjs`: walk, align and board by hand with the Kit Ring Lancer; `steerland.mjs`: a radar-steered landing after a jump; `tablead.mjs`: Tab to a named target; `fireparked.mjs` / `fireleave4.mjs`). |
| wave 25 additions (`wave25Resources`; nothing retired; map row y = -1700; **new spöb range 1600-1999**; sÿst 1189 / 1195 / 1196, spöb 1600-1602, shïp 515-516, düde 455) | Hire pool (H): TechLevel-0 ports with land, commodities, shipyard and bar: spöb 1600 Kit Hire Special Port (sÿst 1189 Kit Hire Special, SpecialTech 9100) and 1601 Kit Hire None Port (sÿst 1195 Kit Hire None, no SpecialTech); shïp 515 Kit Hire Special Disc (shïp 514 with TechLevel 9100: reachable only through the SpecialTech; HireRandom / BuyRandom 100). Coast (C): shïp 516 Kit Coast Trader (wave 18's magenta pointer trader with Speed / Accel 100), düde 455 (AI 1, gövt 312), the only traffic of sÿst 1196 Kit Coast Range (port spöb 1602), avgShips 1. Scenarios `w25_space_interactive.json`, `w25_plunder_live{,_b,_c}.json` (wave 8's live-hulk capture run with the plunder dialog clicked in three orders: the self-destruct series); drivers in the wave-25 evidence `tools/` (`coast.sh`, `fleetlead.sh`, `plunder.sh`, `takes.mjs`: which takes tripped). |
| wave 26 additions (`wave26Resources`; nothing retired; map rows y = -1760 / -1800; sÿst 1197-1203, spöb 1603-1609, shïp 517-528, düde 456-460, gövt 299, flët 310-311, mïsn 956) | R19: shïp 517 Kit RV Mobile S50 AI3 Armed (wave 22's AI 3 victim with the Kit Escort Gun; düde 456), the only traffic of sÿst 1197 Kit Reinf AI3 Armed (gövt 311, flët 305, ReinfTime 300; port spöb 1603); mïsn 956 (b9242, offered on landing at Kit Reinf Far M's 3,000 px port, spöb 1449): one düde 441 guard with ShipBehav 0 (attacks the player). Fleet lead: gövt 299 Kit Shots Pass Attr (Flags 0x0008; as an ATTRIBUTES InherentGovt it did NOT let shots pass), shïp 518 Kit TF Lead (cyan, AI 3, 3000 / 3000), 519 / 520 Kit TF Red / Green (InherentGovt 1299), flët 310 in sÿst 1198 Kit Fleet Pass (port 1604); shïp 521 / 522 Kit TS Red / Green (Speed 40), flët 311 in sÿst 1199 Kit Fleet Slow (port 1605). Plunder damage: shïp 523 Kit Ring Crawler Fragile (100 shield / 300 armor) and 528 Kit Ring Crawler Tough (100 / 3000); live (AI 4, gövt 363) hulks shïp 524 Kit Hulk Pointer Heavy (5,000 t, DeathDelay 60; düde 457, sÿst 1200 / spöb 1606), 526 Heavy Quick (5,000 t, DeathDelay 10; düde 459, sÿst 1202 / spöb 1608), 527 Massive (30,000 t; düde 460, sÿst 1203 / spöb 1609). Coast: shïp 525 Kit Coast Fast Trader (Speed / Accel 250; düde 458), the only traffic of sÿst 1201 Kit Coast Fast Range (port 1607). Scenarios `w26_space_interactive.json`, `w26_stock_interactive.json` (no plug-in), `w26_plunder_live.json` (disable, board, Credits / Cargo / Energy, Abort, shots after), `w26_plunder_derelict.json` (the derelict version: its hulk sat out of reach); drivers in the wave-26 evidence `tools/` (`farm2.sh`, `fleetpass.sh`, `fireapproach2.mjs`, `coast2.sh`, `bars.mjs`: the player's shield / armor bar lengths, `droptime.sh`: when they change after a click, `dots.mjs`: map dot colours). |
| wave 27 additions (`wave27Resources`; nothing retired; map rows y = -1860 / -1920; sÿst 1204-1213, spöb 1610-1618, shïp 529-535, düde 461-466, gövt 298, wëap 294, oütf 466, mïsn 957) | Gate map: sÿst 1204 Kit Gate N1 (gate spöb 1610, HyperLinks 1611 + 1612; hyperspace links 1205 / 1207 / 1208), 1205 Kit Gate N2 (gate 1611; also N1's hyperspace neighbour), 1206 Kit Gate N3 (gate 1612; not a neighbour), 1207 Kit Gate Lane (no stellar). Travel permit: gövt 298 Kit Permit Owner (Require 0x1) owns sÿst 1208 Kit Map Permit (-820,-1920; port spöb 1613). Plunder blast: live (AI 4, gövt 363, DeathDelay 10) hulks shïp 535 / 534 / 529 / 530 / 531 Kit Hulk Pointer 100 / 200 / 500 / 1000 / 2000 (düde 466 / 465 / 461-463, sÿst 1213 / 1212 / 1209-1211, ports spöb 1618 / 1617 / 1614-1616); shïp 532 Kit Ring Crawler Fragile Ten (100 / 300, Flags 0x0010). Fleet lead: wëap 294 Kit Disable Missile (guided, 3000 / 2100, one shot) + oütf 466. R19: shïp 533 Kit RV Guard S50 Unarmed, düde 464 (gövt 311), mïsn 957 (b9243) puts it at Kit Reinf Far M's far port with ShipBehav 0. Scenarios `w27_space_interactive.json` (inbox `w27.jsonl`), `w27_plunder_live.json` (Cargo clicked first); drivers in the wave-27 evidence `tools/` (`fleetmissile.sh`, `farm_unarmed.sh`, `tripsum.sh` / `tripframes.sh`: every click's bar change and the frames at a trip, `pix.mjs`: pixel colours / box histograms). |
| wave 28 additions (`wave28Resources`; nothing retired; map row y = -1920, x -300 .. 0, plus (-700,-1920) and (-660,-1920); sÿst 1214-1221, spöb 1619-1626, shïp 536-541, düde 467-472, ränk 204, mïsn 958) | Blast cut-off: live (AI 4, gövt 363, DeathDelay 10) hulks shïp 536-541 Kit Hulk Pointer 60 / 70 / 80 / 90 / 95 / 99 (düde 467-472, sÿst 1214-1219 Kit Board 60 ... 99, ports spöb 1619-1624; only 90 and 99 driven). Gate refusal: sÿst 1220 Kit Gate Deny, hypergate spöb 1625 (gövt 363, MinStatus 100, HyperLinks 1610). ränk 0x0200: ränk 204 Kit Land Anywhere Rank (AffilGovt 363) by offer 958 (b9244) at Kit Mixed Open (1490), beside Kit Map Picky. Hail pane: sÿst 1221 Kit Hail Jupiter, spöb 1626 (stock Jupiter's 325 x 325 art on a landable port). Scenarios `w28_space_interactive.json` (inbox `w28.jsonl`), `w28_death_beside.json` (board, Abort, shoot the hulk dead beside it), `w28_death_far.json` / `w28_death_at{60,75,82,95,150,165,300}.json` (the board loop's `near` / `fire.atPx` set the kill distance); drivers in the wave-28 evidence `tools/` (`killdist.sh`: the bar change and the hulk's last position at a kill, `gaterun.sh` / `gatecycle.sh`: hypergate request lines, `pbribe.sh`: repeated planet bribe offers, `slsheet.sh`: stacked status lines). |
| wave 29 additions (`wave29Resources`; nothing retired; map rows y = -1980 (x -800 .. -480), -2040 (x -800 .. -480), -2100 (x -800 .. -280); sÿst 1222-1253, spöb 1627-1689, shïp 542-544, düde 473-474, flët 312-313, mïsn 959 / 969 / 1125 / 1126 / 1127) | Blast at a chosen distance: sÿst 1222-1227 / 1233 / 1234 / 1240-1243 Kit Blast d (a port at (0, 0), an uninhabited marker at (d, 0)); a mission accepted on landing (ShipStart -2) puts one live hulk exactly on the marker: mïsn 959 2,000 t (b9245), 969 5,000 t DD 10 (b9246), 1125 5,000 t DD 60 (b9247), 1126 10,000 t (new shïp 542 / düde 473, b9248), 1127 2,000 t with the Fed Carrier art (shïp 544 / düde 474, b9249); the boarder carries only the Kit Pulse Beam; shïp 543 Kit Big Boarder (Fed Carrier art). Gate `l` range: Kit Gate Far d (a decoration stellar at (0, 0), a usable gate at (d, 0); d 150-2000 and two diagonals). Request lines: sÿst 1231 / 1232 (a port / a station 1,000 px off). Bribe withdrawal: sÿst 1246 Kit Bribe Stay (refusing port 1675, open port 1677) linked to 1247 Kit Bribe Away. NPC fleets of 6 / 9: flët 312 / 313 in sÿst 1252 / 1253 (`f1n_observe.json`). Scenario `w29_space_interactive.json` (inbox `w29.jsonl`, 30 fps); drivers in the wave-29 evidence `tools/` (`blastrun.sh` / `blastq.sh`: land, accept, take off, beam the hulk, bars; `posxy.mjs`: hulk and player centroids; `gatefar.sh`: `l` presses from a stopped ship; `fleetcells.mjs`: fleet_groups samples by lattice cell; `mkpilots.mjs`: every wave-29 pilot). |
| wave 30 additions (`wave30Resources`; nothing retired; map row y = -2160 (x -800 .. 120); sÿst 1254-1277, spöb 1690-1743, shïp 545-546, düde 475-476, flët 314-316; no mïsn) | Gate radius / entry zone: Kit Gate Far 492-498, 206-248 and the (180, 180) diagonal (wave 29's rig); Kit Gate Small 140 / 230 (sÿst 1273 / 1276: the gate with a 72 px art; a spöb's Type picks the art, so it keeps the clone's). Moving `l`: sÿst 1266 Kit Gate Toward (gate at (1100, 0), moon rulers at (300 .. 800, 60)) and 1267 Kit Gate Away (gate at (-300, 0), rulers at (100 .. 300, 60)); the Kit Ring Lancer is turned with the evidence `tools/move.mjs` and read with `tools/navsel.mjs` (nav panel, status line, rulers per frame). NPC fleets of 10 / 12 / 13: flët 314-316 in sÿst 1268-1270 (`f1n_observe.json`). Plunder: 50 t live hulks shïp 545 Kit Hulk Ammo (wëap 289, 5 rounds; sÿst 1274) and 546 Kit Hulk Crew 50 (sÿst 1275), scenarios `w30_plunder_ammo.json` / `w30_plunder_crew.json`. R7: sÿst 1277 Kit Bribe Freighters (gövt 304, wave 22's AI 1 düde 451 as traffic). Scenario `w30_space_interactive.json` (inbox `w30.jsonl`); drivers in the wave-30 evidence `tools/` (`gatefar.sh` with `LATE=0`, `moverun.sh`, `firstoffer.sh`, `freshrefuse.sh`, `batch2.sh` / `batch3.sh`, `mkpilots.mjs`). |
| wave 31 additions (`wave31Resources`; nothing retired; map row y = -2220 (x -800 .. 80); sÿst 1278-1300, spöb 1744-1800, shïp 547, düde 477, oütf 467; no mïsn) | Every rig: the pilot at rest on a decoration stellar at (0, 0) beside ONE stellar at (d, 0). Planet / station clearance vs landing window: sÿst 1278-1280 Kit Land P72 140 / 230 / 260 (stock spöb 138's 72 px art), 1281-1283 Kit Land P250 230 / 245 / 260 (spöb 176's 250 px art), 1284 / 1285 Kit Land S17 140 / 230 (Holpa Station's 17 x 31 art, a station), 1286 / 1287 Kit Land S315 230 / 260 (Gladius Shipyards' 315 x 200 art, a station). Coasting in with a standing request: sÿst 1288 / 1289 Kit Land Toward P72 / P250 (the port at (1100, 0), moon rulers at (300 .. 800, 60), as wave 30's Kit Gate Toward). Gate clearance zone / entry window by art: sÿst 1290-1292 Kit Gate S17 140 / 245 / 255, 1293-1295 Kit Gate J325 245 / 255 / 300 (Jupiter's 325 px art), 1296 / 1297 Kit Gate M96 155 / 172 (Sirius Prime's 96 px art), 1298 / 1299 Kit Gate Small 245 / 255 (72 px art). oütf 467 Kit Ammo Launcher (installs wëap 289 as an outfit; its Ammo take still did nothing). Plunder Ammo: shïp 547 Kit Hulk IR (the live 50 t hulk with the stock IR Missile, wëap 134 x1 / 10 rounds; düde 477, sÿst 1300 Kit Board IR, port spöb 1800); the boarder carries oütf 134 + wëap 134. Scenarios `w31_space_interactive.json` (inbox `w31.jsonl`), `w31_plunder_crew7.json` / `w31_plunder_crew9.json` (the crew-50 hulk disabled by exactly 7 / 9 turret taps); drivers in the wave-31 evidence `tools/` (`gatefar.sh` + `batch1.sh`, `lsheet.sh`: status-line sheets, `moverun.sh`, `walkout2.sh`: a cleared ship backs away and presses once, `odds.sh`: plunder dialogs, `freight.sh`). |
| wave 32 additions (`wave32Resources`; nothing retired; map row y = -2280 (x -800); sÿst 1301, spöb 1801, shïp 548-551, düde 478-479, gövt 296-297, flët 317; no mïsn) | Capture odds by crew pair: wave 26's Kit Ring Crawler Tough (528, crew 10) as shïp 548 Kit Ring Crawler Crew 20 and 549 Kit Ring Crawler Crew 50, against wave 8's live crew 1 / 5 / 10 / 20 hulks (sÿst/spöb 2039 / 2043 / 2044 / 2040) with `w31_plunder_crew7.json`. R19 an NPC of the fleet's side attacking another NPC: gövt 297 Kit Reinf Hunter (wave 19's 311 settings, Enemies 296) and 296 Kit Reinf Prey, flët 317 (wave 19's purple lead + two blue guards, gövt 297), shïp 550 Kit RH Hunter (red pointer, AI 3, armed, Strength 10) / 551 Kit RH Prey (green pointer, AI 1, unarmed, 30000 / 30000, Strength 500, Speed 20), düde 478 / 479, the only traffic (hunter 60 / prey 40, avgShips 6) of sÿst 1301 Kit Reinf Hunt (ReinfFleet 317, ReinfTime 150; port spöb 1801 at the centre). Scenarios `w32_space_interactive.json` (inbox `w32.jsonl`), `w32_plunder_ir.json` (wave 31's IR Ammo board with the secondary weapon shown before and after); drivers in the wave-32 evidence `tools/` (`lapse.sh`: the clearance-lapse cascade, `oneshot.sh`: one exact keys step, `gatelapse.sh`, `awayback.sh`, `freshjump.sh`, `hunt.sh`, `q1.sh`-`q4.sh`). |
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

## Disabling a target (`loops/disable.mjs`, wave 11)

A `script` step that targets a magenta pointer / disc ship (`target: "tab"`, or `"click"` for the player's own escorts, which Tab skips) and taps `fireKeys` (default a 100 ms Space) every `waitMs` until the target panel reads **Disabled** (`board.mjs` `disabledWord`: the white word left of x 690 with nothing white past x 705, so "Shields Down" and "No Shields" do not count; the older `targetDisabledShown` also fires on "Shield: 100%"). `board.mjs` takes `stopWhenEnabled: true` (walk and sweep) to stop at the first press after which the target is no longer Disabled: boarding one's own escort repairs it with "Escort repaired." and no dialog. `scenarios/revive_*.json`, `rescue.json`.

## Hand-driven steps (`loops/interactive.mjs`, wave 13)

A `script` step `{"script": "../loops/interactive.mjs", "args": {"inbox":
"~/.local/share/novaref/inbox/w13.jsonl"}}` keeps the run alive (its
lock, plug-ins, recording and frame stamps) and executes ordinary steps
appended to the inbox, one JSON step per line, so a driver can look at a
shot before choosing the next click or key. Each result is appended to
`<inbox>.out` (`{"i", "step", "result"}`; a shot's result has its local
`path`); the first line it writes is `{"ready": true, "dir"}`. Only lines
appended after the step starts run; `{"done": true}` ends it (back to the
scenario's next step), as does `args.maxMs` (default 20 min). A failed
step is reported and does not end the loop; the usual script rules hold
(no Escape, no nested scripts). A removed or truncated inbox starts over
(a second queue must still never delete a live run's inbox). Wave 13 used
it for the in-flight Abort, the A14 kills, P1 and the stock Raczak run
(`scenarios/w13_*_interactive.json`, `w13_offer_board.json`,
`w13_space_board.json`, `rescue_raczak.json`).

## Board a stock ship (`board.mjs` `locateBy: "bracket"`, wave 13)

`board.mjs` finds its target by colour (the kit's magenta hulks). With
`args.locateBy: "bracket"` it finds it by its TARGET BRACKETS instead
(`analysis/brackets.mjs`, colours `args.bracketColours`, default
`["grey"]`, a disabled ship), so it can walk to and board a stock hull;
off screen it still falls back to the radar. A 24 px target hidden under
the player's sprite loses its brackets (wave 13's kit-düde rescue run).

## Tab to a colour (`loops/tab_to.mjs`, wave 12)

A `script` step that presses Tab (up to `tries`, `waitMs` apart, a window
shot after each) until the bracketed target is a disc hull of `colour`
(yellow / cyan / green / magenta / red / blue). The target panel shows only
the NAME of a kit hull (no picture), so it finds the ship brackets in the
play area (`analysis/brackets.mjs`) and counts that colour within 8 px of
the box's centre (`minN`, default 20). Off-screen targets have no brackets,
so it can only pick ships on screen. Returns `{found, tabs, bracket}`.

## Click targeting (`loops/click_targets.mjs`, wave 9)

Tab never selects the player's own escorts, but a click on a ship
targets it. This `script` step (`scenarios/brackets_click.json`) shoots
the window, takes the ship sprites in it (bright blobs of `minN`+ pixels
away from the player and the play area's edge, largest first), and for up
to `perRound` of them clicks the blob pixel nearest its centroid, parks
the mouse outside the window, waits `settleMs` and shoots
(`click-RR-K`); `turnKeys` between `rounds` let escorts re-form and turn.
`keysShots` ([[keys, label], ...]) run once after the first round with a
shot each. Read the shots with `analysis/brackets.mjs`.

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
- `brackets.mjs <shot.png>... [--colour blue|yellow|red|green|grey|any] [--corners] [--glyphs]`
  or `--video rec.mp4 [--from F --to F --every N]` (wave 9): the target
  brackets: per colour, the box through the four corner glyphs' outermost
  pixels (size, centre, half extents), the glyph size, the largest
  non-black blob inside the box (the target's art) and, with `--glyphs`,
  each glyph as text rows with its colours. Stellars are blue, ships
  yellow / red / green / grey by disposition.
- `sprite_match.mjs <shot.png> <rledId> --rect x0,y0,x1,y1 [--frames all] [--scales 1,0.95] [--clip x0,y0,x1,y1]`
  (wave 23): slides a stock rlëD frame (nearest-neighbour scaled) over a
  window shot and prints the best offset, frame and scale by RMSE over the
  frame's opaque pixels (clipped to `--clip`): the hail well's 1:1 clipping
  and frame 0 were read with it.
- `blob_offset.mjs <shot.png>...`: the largest bright blob's offset from
  the play-area centre (where the player is drawn) in a window shot: how far
  the planet or a target ship is (U9 gates).
