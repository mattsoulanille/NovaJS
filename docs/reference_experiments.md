# Reference experiments: questions the original EV Nova can answer

This is a running log of gameplay questions that come up while building
NovaJS, with answers measured on the original EV Nova 1.1.1. The game runs
on Matthew's reference Mac and is driven by `scripts/novaref` (see its
README for pilot-make, plugin-make, the test kit and the safety rules).

Each row says where the answer matters in our code, how the reference can
answer it, and a priority. When a question is answered, it gets a
**Finding** with the evidence path. Evidence (recordings, screenshots,
pilot diffs) lives outside the repo under
`~/.local/share/novaref/evidence/<YYYYMMDD>-<slug>/` on the MacBook.

**Experiment kinds**

- **CPl** custom pilot
- **CPg** custom plug-in (usually the test kit)
- **SS** screenshot
- **VID** recording measured frame by frame
- **PD** pilot diff before/after

**Paths:** `N/` = `packages/nova/src/`, `P/` = `packages/novaparse/src/`.

## Answered

### #316: ship and weapon unit constants (2026-11-23)

**Status:** answered for Speed, Accel, Turn and wëap Speed. GuidedTurn is
not measured yet. Confidence is high for speed and turn, and good for
accel (±3%).

**Method.** Kit Probes A/B/C were flown from rest in the sealed Kit Range
and recorded at 30 fps, cropped to the window. Their Accel/Speed/Turn are
300/300/10, 150/600/30 and 600/200/20.

- **Turn:** the period of the player's sprite sequence over one to three
  full turns, holding Left for 14 s.
- **Speed and accel:** the player is always drawn at screen centre, so
  ship velocity is minus the on-screen velocity of the static stellars.
  This was tracked two ways, by a planet template and by the median
  displacement of all stellar blobs.
- **wëap Speed:** two unguided Kit Speed Guns (Speed 300 and 600) fired
  from rest.
- **Video clock:** checked against an exact 20.140 s key interval (the
  map toggled by the remote helper). That gave 605 frames, so the
  recording runs at 30.04 fps and the video is real time.

**Findings** (real time on the reference iMac):

| quantity | 300 | 200 / 150 / 600 | per unit |
|---|---|---|---|
| shïp Turn (deg/s) | 10 → 29.11 | 20 → 58.38, 30 → 87.10 | 2.91 deg/s |
| wëap Speed (px/s) | 300 → 87.25 | 600 → 176.5 | 0.291 px/s |
| shïp Speed, top (px/s) | 300 → 130.65 | 200 → 88.25 | 0.436–0.441 px/s |
| shïp Accel (px/s²) | 300 → 51.9 | 150 → 25.9, 600 → 111 (short ramp) | 0.173 px/s² |

- **Tick rate.** Two documented units agree that the game's physics ticks
  at **29.1 Hz** on this machine, about 3% under 30. One is wëap Speed
  ("100 = 1 px/frame"); the other is shïp Turn ("10 ≈ 30°/s", i.e.
  1°/frame). The game renders at 56 fps (F12).
- **Per game frame.**
  - wëap Speed: S/100 px/frame.
  - shïp Turn: T/10 deg/frame.
  - **shïp Speed: 1.5 × S/100 px/frame.**
  - **shïp Accel: ≈ A/5000 px/frame²** (0.000204·A measured).
- A ship whose Speed equals its Accel therefore reaches top speed in about
  75 frames, i.e. **2.5 s, not 1 s**.

**What NovaJS does.**

- `P/parsers/constants.ts:9` `ShipSpeedConversionFactor = FPS/100` gives
  0.3·S px/s. The original is 0.45·S at a nominal 30 Hz (0.436·S
  measured), so **our ships are 1.5× too slow.**
- `P/parsers/constants.ts:14` `ShipAccelerationConversionFactor = FPS/100`
  gives 0.3·A px/s². The original is about 0.18·A at 30 Hz (0.173·A
  measured), so **our acceleration is about 1.67× too fast.**
- The same two factors scale outfit speed/accel mods at
  `P/parsers/outfit_parse.ts:172,177`.
- Turn (`constants.ts:17`, 3°/s per unit) and wëap Speed
  (`P/parsers/weapon_parse.ts:11`, `WEAP_SPEED_FACTOR = 3/10`) match the
  original at a nominal 30 Hz.

**Fix (applied separately).** Matthew ruled for the nominal 30 Hz, and
another agent is landing it on main:

- `ShipSpeedConversionFactor = 1.5 * FPS / 100` (0.45·Speed px/s).
- `ShipAccelerationConversionFactor` set to 0.18·Accel px/s².
- The comments are corrected.

Turn and weapon factors stay as they are. NPC AI tuning that assumed the
old speeds is worth a re-check.

**Evidence:** `~/.local/share/novaref/evidence/20261123-unit-constants/`

- `FINDINGS.txt`
- `20261123-005332-unit_probe/` (Probe A)
- `probe-b/`, `probe-c/`
- `calib/` (map timing, fps shot, gun shots)

Each run directory holds `recording.mp4`, `motion.json`, `raw_disp.txt`
and the run's own log. Re-run with `scenarios/unit_probe.json --pilot
…/novaref-probe-<a|b|c>`, then analyse with `analysis/motion.mjs`,
`world_motion.mjs` and `shots.mjs`.

### Q1: does a protect-the-player special ship retaliate when the player shoots it? (2026-11-23, partial)

**Setup.**

- mïsn 960: ShipBehav 1, ShipGoal 3, one Kit Escort of govt 360, offered
  on landing.
- The player flies Kit Lancer Lite with a record of -500 in sÿst 2100,
  i.e. criminal with govt 360, whose CrimeTol is 0.
- The player targets the escort once with Tab, watches for 24 s, then
  holds fire for 4 s with the Kit Escort Gun (30 dmg) and the Tickler,
  then watches for 40 s more.

**Findings.**

1. **Unprovoked:** the escort flew formation beside the player for more
   than 60 s and never fired at them. Its target brackets were green and
   the player's shield stayed at 100%. This is despite the player's
   criminal record with the escort's own govt. 0e701c4b matches: a ship
   in the player's flock never counts the player as hostile.
2. **Provoked:** the player's turret shots **passed through the escort**.
   The recording shows the bolts travelling on past its brackets, and its
   shield stayed at 100%. The escort never turned on the player either.
   So in the original the player cannot damage a ShipBehav-1 special ship,
   like an escort. NovaJS: `N/nova_plugin/ship/firing_group.ts`
   friendly-fire rule (flock members are only hittable when disabled)
   plus the 0e701c4b aggressor guard (`N/nova_plugin/npc/npc_decision.ts:
   ~262-288`). That **matches**.

**Still open:** whether it would retaliate if damage could land, for
example from a beam, a blast radius or a disabled escort. This probably
can't happen in the original.

**Evidence:** `~/.local/share/novaref/evidence/20261123-protect-player/q1/20261123-010954-protect_q1/`
(`recording.mp4` at about 35-39 s, `08-…19-*.png`). The earlier run
`20261123-010655-protect_q1/` provoked with no target selected.

### Q2/Q3: whom does a protect-the-player ship fight? (2026-11-23)

**Setup.**

- Scenario: `scenarios/protect_observe.json` with pilots `q2a`, `q2b`,
  `q2c`, `q3`.
- mïsn ShipBehav 1, ShipGoal 3. A Kit Escort (govt 360, AI 3, escort gun
  30 dmg ×2) plus two aux ships appear in Kit Range (owned by govt 360).
- The player is criminal there: record -500 in sÿst 2100, shown as
  "Criminal" on the map. Kit govts have CrimeTol 10 and MaxOdds 1000.
- The player never fires. Every 3.5 s for 70 s the run takes a screenshot
  after pressing Tab, so the target panel shows each ship's shield/armor
  in turn. The player's own shield/armor bars show who is being hit.

**Findings.**

| run | aux ships | what the escort did | NovaJS (0e701c4b) |
|---|---|---|---|
| Q2a | 2 Kit Raiders, govt 362 "always attacks player" (gövt 0x0004), AI 3 | Raiders attacked the player (shield 100% to 0%, then armor dropping). The escort **fought them**: raider shield 60%, then armor 82%, 39%, then **Disabled**. The escort's own shield fell to 83%. | Matches: an attacker of the protectee is a hostile (`npc_decision.ts:275-285, 391`). |
| Q2b | 2 Kit Traders, AI 1, govt 361 "nosy" (0x0002) | Traders never attacked. Their brackets were **yellow**. Every time they were targeted their shield read 100% until they left. The escort **left them alone**. | Matches: not attacking and not a govt enemy of the escort, so not hostile. |
| Q2c | 2 Kit Traders, AI 1, govt 362 "always attacks player" | Same as Q2b: yellow brackets, 100% shield every time, left alone. A ship whose govt is hostile to the player but which does not attack is **not** engaged. | Matches. |
| Q3 | 2 Kit Raiders of the **escort's own govt 360** | The raiders attacked the criminal player: shield to 0, armor nearly gone by 70 s. Their shield read 100% at every sample and the escort's stayed at 100%. The escort **did not defend the player against its own govt**, and kept green brackets the whole time. | **Mismatch.** NovaJS counts any ship attacking the protectee as a hostile (`attackingProtectee`, `npc_decision.ts:391`), including the escort's own government's ships. |

So in the original, a protect-the-player escort:
- engages ships that attack the player, as long as they are not its own
  government's;
- ignores hostile-govt ships that are not attacking;
- never turns on the player it protects (Q1).

**Fix (applied).** `npc_decision.ts` no longer counts an attacker of the protectee as a hostile when the protector's government regards the attacker's as an ally: its own govt, or one whose classes its Ally fields name (`govtDisposition(...) === 'ally'`, read from the protector's side). Spec: `mission_protector_test.ts`. Two cases are unverified:
- the protector's allies: **chosen** to be treated like the own govt. The Bible says allies "communicate your actions", and nothing else in a protector's brain makes an ally a hostile. Only the protector's own Ally fields count. A govt that names the protector's class as an ally, without the protector naming it back, is still defended against.
- ships with the same `classes`: **not** excluded. The Bible says that two govts of the same class "are not inherently allied".

Confidence is high for Q2a and Q3: both had clear, sustained combat (or none) over 70 s. Q2b/Q2c are medium: the traders spent much of the run off screen before leaving.

**Side finding, the IFF bracket colour.** Ships of the always-attacks-player govt that did not attack (AI 1 traders) showed **yellow** brackets, so the colour does not simply follow the govt's attitude. NovaJS colours by govt disposition (`N/nova_plugin/hostility.ts`). Worth a dedicated check (catalogue K9).

**Side finding, which record matters (A14).** Kit Raiders of govt 362 left a player who was -500 in Kit Range (govt 360) and -500 in govt 362's own home system **neutral** (yellow, no attack) until govt 362 got the "always attacks player" flag. The Bible's gövt flag 0x0002 text ("will attack the player in non-allied systems if he's a criminal there") implies that a govt by default only enforces the record of systems it or its allies own. The record that counts is the CURRENT system's, and only for that system's govt and its allies. NovaJS keeps per-govt records and checks them everywhere.

**Evidence:** `~/.local/share/novaref/evidence/20261123-protect-player/`

- `q2a/20261123-013524-protect_observe/`
- `q2b/20261123-013801-*`
- `q2c/20261123-014609-*`: complete. The old Mac lost power after the
  run's last step, before cleanup; it was recovered with `novaref
  recover`.
- `q3/20261123-014021-*`

Each holds `recording.mp4`, the per-Tab shots and `pilot-after`. The two
earlier q2a runs (`…012816…`, `…013143…`) are the CrimeTol-0/MaxOdds-100
attempts in which nobody attacked.

### Q4: do a protector's bay fighters follow suit? (2026-11-23)

**Finding:** the question doesn't arise in the original. A ShipBehav-1
carrier **never launched its fighters**.

- Q4 used a kit carrier with Kit Fighter Bay ×4.
- Q4b used the **stock Fed Carrier** with its stock bays.
- In both, raiders were attacking the player and the carrier for 70 s.
  Neither carrier launched anything: Tab never cycled to a fighter, and no
  small craft appear in the recording. The carriers fought with their own
  guns instead; the Fed Carrier's shield fell 100% → 48%, then armor 62%,
  then Disabled ("Mission failed").
- NovaJS: that "NPC carriers never fire their bays" note was stale. NPC
  carriers have launched at their victims since 0655408c, a protector
  included, so this was a mismatch. **Applied in f71fd85e:**
  `N/nova_plugin/npc/npc_fire_control.ts` holds the bays of a mission
  ship in a player's flock (`MissionShipComponent` plus `flockPlayer`:
  ShipBehav 1 and escort-goal ships). Its guns still fire. The player's
  own escorts in the flock (hired, captured) are not covered; they were
  not measured. Specs: `npc_bay_test.ts`,
  `npc_carrier_integration_test.ts`, `mission_carrier_fighter_test.ts`.

Confidence: medium. Two runs of 70 s each; a longer fight or a non-mission
carrier might behave differently.

**Evidence:**
- `~/.local/share/novaref/evidence/20261123-protect-player/q4/20261123-014238-*`
- `q4b/20261123-015700-*`. The `q4b/…015436…` run is a sporadic game
  exit on Enter Ship, not data.

### B-series: does blast damage hit the firer, its formation-mates or its protector, and does anyone retaliate? (2026-11-23)

**Kit.**
- wëap 370 Kit Blast Bomb: 2-frame life, detonates at end (wëap flag
  0x8000), 300 px BlastRadius, 50/50 damage. Fired by the player.
- wëap 372 Kit Blast Shell: for NPCs, since the AI only fires inside
  Speed×Duration range. 180 px reach, ProxRadius 30, 400 px blast,
  detonates at end.
- wëap 373: the 2000-damage version of 370.

| id | setup | finding | confidence |
|---|---|---|---|
| B1 (firer) | Player in Kit Lancer Lite (1500 shield, no recharge) fires the Kit Blast Bomb: one tap, then 4 s of fire. `scenarios/blast_self.json` | **The player's own blast damages the player.** The shield bar drops visibly with each bomb; nothing else was shooting. | high |
| B1 (protector) | Same run, with the mïsn 960 protect-the-player Kit Escort in formation next to the player | **The blast damages the escort:** shield 100 → 98 → 95%. Direct projectiles pass through it (Q1); blasts do not. | high |
| B2 (protector) | Same | The escort **did not retaliate**: brackets stayed green throughout and the player took no further damage. | high |
| B1 (NPC mates) | Two Kit Bomb Raiders (govt 362, always attack the player, armed only with the Kit Blast Shell) attack a passive Kit Lancer. Pilot `bnpc2.json`, `protect_observe.json` | Their shields fell steadily (100 → 96 → 90 → 85 → 79 → 76%) though the player never fired. **An NPC's own blast, or its wingmate's, damages it.** | high |
| B2 (NPC mates) | Same | No infighting in 70 s. The two kept making joint passes at the player, side by side. | medium |
| B4 | Player in Kit Lancer destroys its own mïsn-960 escort with the 2000-damage blast, then lands. `scenarios/blast_kill.json`, pilot `bkill.json` | The escort ended **Disabled** (not destroyed) and the game printed "Mission failed". After landing and re-saving, the pilot shows **no legal-record change** in sÿst 2100 (govt 360 DisabPenalty 50) and **combat rating 0**: no crime and no credit for disabling one's own escort with a blast. | medium (the escort was disabled, not killed) |
| B3 (direct hits) | Q1 | Direct projectiles from the player pass through its protect-the-player escort. | high |

**For the NovaJS bug** (an AI carrier turning hostile to its own fighter
or escort after the fighter's missile blast damaged it):

- In the original the damage itself **is possible**. A blast hurts its
  firer and the firer's own side.
- But nobody retaliated against its own side in any run:
  - the player's escort ignored the player's blasts;
  - the NPC wingmates ignored each other's.
- So "damaged by a friendly blast" must not make a ship an aggressor
  against its own leader or flock.

**Not covered.** The NPC carrier and bay-fighter case. NPC carriers never
launched (Q4), and player-launched bombers took no action:
- Kit Target is neutral, and the escort command `f` didn't send them in.
- Their 2-frame bomb has no AI range.

Kit Bombers now carry the ranged 372 shell. A retry needs a hostile target
next to the player.

**Evidence:** `~/.local/share/novaref/evidence/20261123-blast/`
- `20261123-020446-blast_self/`
- `npc/20261123-020955-protect_observe/`
- `20261123-021248-blast_kill/`: includes `pilot-landed/` and `pilot-after/`.

### F1: where do escorts fly relative to their leader? (2026-11-23)

**Kit.** Disc hulls are solid one-colour discs, 24 px across, drawn on all
36 frames. They are built with `packages/novaparse/src/plugin_kit/sprites.ts`
and given the stock Shuttle's shän with only the sprite swapped.
- Leader: white, shïp 720, Speed/Accel 300, Turn 30.
- Hired escorts: red, green, blue and yellow, shïp 721–724, Speed/Accel
  600.

**Run.** `scenarios/formation_player.json` (pilot `f1.json`):
1. 8 s at rest.
2. 4 s of thrust, then cruise at top speed (4.49 px/frame, about 135 px/s
   at 30 Hz).
3. Turn about 175° and keep drifting.
4. Thrust out the other way.

**Analysis.** `analysis/discs.mjs` finds each disc's centroid per frame
and takes the leader's direction of travel from the starfield. Offsets are
**along** the heading (+ = ahead) and **across** it (+ = left of travel).

| escort (pilot slot) | rest | accelerating | cruise A (135 px/s) | cruise B (reversed, 135 px/s) |
|---|---|---|---|---|
| red (0) | −25.7 / +24.8 | −10.3 / +22.9 | −23.9 / +16.7 | −15.2 / +27.7 |
| green (1) | −25.6 / −21.7 | −10.3 / −23.6 | −24.0 / −29.9 | −22.2 / −15.0 |
| blue (2) | −49.6 / +48.9 | −34.1 / +46.7 | −47.9 / +40.8 | −39.9 / +50.8 |
| yellow (3) | −49.3 / −45.5 | −34.0 / −44.7 | −47.6 / −53.8 | −46.2 / −39.6 |

Cells are along / across in px (medians). At rest, along/across use the
heading the leader then thrust along.

**Findings.**

- **Geometry.** The original flies a **45° V trailing the leader**. Slot
  pairs sit at (−25, ±25) and (−50, ±48) px. The first escort goes left of
  travel, the second right, the third left-outer, the fourth right-outer.
  Distances: about 35 px for the first pair, 70 px for the second.
- **Speed.** At full speed the escorts sit **on the same slots as at
  rest**. Along offsets agree within 2 px at 135 px/s. There is **no
  speed-proportional lead or lag**. While the leader accelerates, the
  escorts are about 15 px ahead of their slots, catching up.
- **NovaJS mismatch.** `N/nova_plugin/npc/npc_formation.ts`:
  - It sets the target AHEAD of the slot by `FORMATION_LOOKAHEAD_S` (0.4
    s) × leader velocity (line 26, used at about line 258). At 135 px/s
    that is 54 px ahead.
  - Its rows are 60 px astern with ±27.5 px lateral cells (lines 18-23)
    and a different shape.
- **Follow-up F1b (hub, reference Mac; evidence
  `~/.local/share/novaref/evidence/20261123-f1b/`; high confidence, ±1 px).**
  The spacing scales with sprite size. Rank k sits in row
  r = floor(k/2)+1, r·a astern and r·a out (a 45° V). Even ranks go left,
  odd ranks right.
  - The step is a = clamp(0.59 × S, 23.5, 59.5) px.
  - S is the LARGEST sprite frame width among the leader and all its
    escorts. A 24 px leader with 96/24/96/24 px escorts puts all four at the
    96 px step.
  - S is the rlëD FRAME size, not the visible pixels: a small disc drawn
    inside a 96 px frame spaces like a 96 px ship. shïp Length and the
    shän frame-size fields play no part.
  - Only square frames were tested. Rows beyond 2 are unmeasured.
- **Fix (applied).**
  - The lookahead is gone. Escorts are held exactly on their slots, with
    the leader's velocity still fed forward.
  - The slots follow the F1b rule (`formationOffset`, `formationSpacing`).
  - `ShipData.spriteFrameWidth` carries the base rlëD's frame width. It is
    read at parse time from the rlëD header.
  - FormationSystem recomputes S from the live group every tick, so an
    escort joining or leaving re-spaces everyone.
  - Spawn placement uses the leader and that escort: hired, carried and
    restored escorts. FormationSystem then settles the group step. Fleet
    escorts are placed on the whole fleet's step.
  - Ranks 4 and up extrapolate linearly (r·a). The frame WIDTH is used;
    max(width, height) is the untested alternative.
  - The per-count symmetric layouts are gone. Ranks still re-flow when an
    escort leaves, so the V has no holes.
  - The closing speed is now capped at what the hull can brake from and turn
    onto. A sweep found that the old controller left 23 stock hulls unable
    to settle within 300 s, including the Cargo Drone, the Aurora Carriers
    and the Leviathans. With the caps none fail, at each hull's own step and
    at the maximum 59.5 px. The sweep ran every stock inertial hull with the
    leader at rest, cruising, accelerating and reversing.
  - NPC fleet (flët) escorts are untested. They use the same rule.

Confidence: high for the rest/cruise slots; medium for the transient
lead while accelerating.

**Evidence:** `~/.local/share/novaref/evidence/20261123-formation/20261123-022125-formation_player/`
holds `recording.mp4`, `discs.csv` (per frame), `discs.json` and
`windows.json`.

### F1b: does escort slot spacing scale with hull size? (2026-11-23, wave 2)

**Setup.** The same rig as F1: the player leads four hired disc escorts in
Kit Range. Leaders and escorts are disc hulls with different rlëD frame
sizes (kit shïp 740-755). Every disc reuses the Shuttle's shän unchanged,
so only the sprite differs. Offsets are measured in lossless screenshots
after about 9 s at rest and at cruise, using connected components
(`analysis/disc_shot.mjs`; the recording tracker is noisy when a small
white leader overlaps the planet). Scenarios are `formation_player.json`
and `formation_rest.json`; pilots are `pilots/f1b_*.json`.

**Finding.** Rank k sits at (-k·a astern, ±k·a lateral): a 45° V, first
escort left, then right. The per-axis offset a depends only on **S, the
largest rlëD frame width among the leader and all its escorts**:

    a ≈ clamp(0.59 × S, 23.5, 59.5) px    (within 0.8 px of every point)

| run | leader frame | escort frames | group S | a (rank 1, per axis) | rank-1 / rank-2 distance |
|---|---|---|---|---|---|
| h | 12 | 24 | 24 | 23.1 | 32.6 / 66.6 |
| d | 24 (shïp Length 200) | 24 | 24 | 23.5 | 33.2 / 66.9 |
| wave 1 | 24 | 24 | 24 | 23.3 | 33.0 / 66.9 |
| j | 36 | 24 | 36 | 23.5 | 33.2 / 67.6 |
| e | 48 | 24 | 48 | 27.5 | 38.8 / 78.5 |
| k | 64 | 24 | 64 | 37.7 | 53.3 / 107.0 |
| l | 72 | 24 | 72 | 42.1 | 59.5 / 120.5 |
| a | 96 | 24 | 96 | 56.6 | 80.1 / 160.3 |
| b | 24 | 96 | 96 | about 56.6 | 80 / 161 (screenshot) |
| c | 96 | 96 | 96 | 56.6 | 80.1 / 160.7 |
| g | 24 | 96, 24, 96, 24 | 96 | 56.6 for **all four** | 80 / 160.4 |
| i | 96 frame, 22 px disc | 24 | 96 | 56.8 | 80.3 / 160.6 |
| m | 112 | 24 | 112 | 59.5 | 84.2 / 168.4 |
| n | 128 | 24 | 128 | 59.1 | 83.6 / 168.6 |
| f | 160 | 24 | 160 | about 60 (escort partly hidden) | 86 / 169 |
| o | 200 | 24 | 200 | rank 1 entirely hidden under the leader | - / 168.7 |

- **Frame, not visible size:** a 22 px disc in a 96 px frame (i) spaces
  like a full 96 px disc. The shän frame-size fields can't be the
  source, because they're identical in every run.
- **Group maximum:** two 96 px escorts push the 24 px escorts out to the
  96 px spacing too (g).
- **Not used:** shïp Length (d) and speed. Cruise shots at 135 px/s show
  the same offsets to 0.1 px.
- Rank 2 is always 2a within 1.5 px.
- Above S ≈ 100 the V stops growing, so a 200 px leader's rank-1
  escorts sit entirely under its sprite.

**NovaJS today:** fixed rows 60 px astern and ±27.5 px cells
(`N/nova_plugin/npc/npc_formation.ts:18-23`), plus the lookahead (F1).
**Proposed fix (not applied):**
- Slot k = (-k·a, ±k·a) in the leader's frame, with a from the formula
  above.
- S = max rlëD frame width over the formation's members (the shän base
  sprite size).
- No lookahead.

Untested:
- non-square or PICT sprites, and whether the frame's height counts;
- NPC fleets (F1n is queued).

**Evidence:** `~/.local/share/novaref/evidence/20261123-f1b/{a..o}/*/`.

### #321: does the pilot's priceFlux set the trade tier multiplier? (2026-11-23)

**Setup.**
- Pilots `price_{p100,a150,b150,c150,d150,a50}.json` are identical except
  for globals `priceFlux[4]`:
  - all four at 100;
  - each entry in turn at 150;
  - entry 0 at 50.
- Each lands at Kit Port and screenshots the Trade Center
  (`scenarios/trade_prices.json`).
- a150 and a50 also took off and landed twice more, two days later
  (`trade_prices_day2.json`).

**Findings.**

1. **priceFlux has no visible effect on prices.** All six pilots, and
   days 1-3, show exactly the same prices.
2. **The tiers are exactly ×0.8 / ×1 / ×1.25 of base, truncated**, at a
   stellar with no disaster:

   | commodity | tier | price |
   |---|---|---|
   | Food | Low | 60 |
   | Industrial | Med | 350 |
   | Medical | High | 937 |
   | Luxury | Low | 720 |
   | Metal | Med | 200 |
   | Equipment | High | 687 |
   | Kit Gadgets (jünk, base 150) | High | 187 |
   | Kit Widgets (jünk, base 1000) | Low | 800 |

3. **jünk semantics.** A jünk's **SoldAt** stellar shows it at the **Low**
   tier, and its **BoughtAt** stellar at the **High** tier.
4. **priceFlux is state the game advances daily.** It moves back toward
   100 each day, with small noise:
   - 150 → 115 after 2 days, and 50 → 85 (roughly halving the distance
     each day);
   - the base pilot went from [100,100,100,100] to [100,99,100,100] after
     one day.
   Taking off advances the date by one day; landing doesn't.
5. **Hypothesis for the ×1.10 captures (not tested):** öops disasters.
   The Bible says each one changes a single commodity's price at a stellar
   by PriceDelta, and the exchange dialog shows the disaster's name. Check
   the #321 captures for a disaster name next to those rows. pilot globals
   `disasterTime`/`disasterStellar` record the active ones.
6. A NovaJS that ignores priceFlux is consistent with this.

**NovaJS (checked 2026-11-23): matches.**
- `N/nova_plugin/economy/trade_logic.ts` `tierPrice` already computes
  floor(base × 0.8 / 1 / 1.25).
- `junkTradeGood` shows Low at SoldAt stellars and High at BoughtAt
  stellars.
- Nothing in pricing reads priceFlux. The pilot parser only round-trips it.
- `trade_logic_test.ts` now pins this exact Kit Port table, jünk rows
  included.

Two cases remain untested in the original:
- öops price events (`price_events.ts`: base + PriceDelta, replacing the
  tier price);
- a stellar in both a jünk's SoldAt and BoughtAt lists (wave 10: the original shows two rows, High and Low, see "#321 wave 10"; NovaJS does too since 9b0c62de).

**Evidence:** `~/.local/share/novaref/evidence/20261123-price-flux/`:
`{p100,a150,b150,c150,d150,a50}/*/02-trade.png` and `day2-{a150,a50}/`.
Each run has its `pilot-after`.

### #316b: is wëap GuidedTurn on the ship Turn scale? (2026-11-23)

**Setup.**
- The stationary player sits at Kit Port. The immobile Kit Target appears
  900 px east at Kit Market (mïsn 965, ShipStart -2).
- The player fires Kit Missile T10, T30 and T60: GuidedTurn 10/30/60,
  Speed 600, unlimited range.
- Pilot `missile.json`, `scenarios/guided_turn.json`. Analysed with
  `analysis/missile_turn.mjs`, which tracks the missile head against a
  pre-launch background frame.

**Findings.** Missile speed was 5.85 px per video frame (176 px/s), the
same as wëap Speed 600 from #316. The heading change while turning:

| missile | turn per video frame | turn per second | turn per 29.1 Hz game frame |
|---|---|---|---|
| T10 | 0.97° | 29.1°/s | 1.0° |
| T30 | 2.97° (125° in 42 frames) | 89°/s | 3.06° |
| T60 | 5.66° (136° in 24 frames) | 170°/s | 5.83° |

**GuidedTurn uses the same scale as shïp Turn: GuidedTurn/10 degrees per
frame.** NovaJS's `P/parsers/weapon_parse.ts:313` uses
`ShipTurnRateConversionFactor`, which **matches** (the IR Missile's 70
gives 210°/s).

Confidence: high for T10, which was tracked cleanly for 57 frames. T30
and T60 are good: the slopes are hand-picked over the turning arc,
because the track crosses the planet.

**Evidence:** `~/.local/share/novaref/evidence/20261123-guided-turn/20261123-024013-guided_turn/recording.mp4`.
The missile frames are about 92-148, 402-513 and 659-743.

### Minimal app (2026-11-23)

The minimal app works.

- AbsoluteMinimum was converted with `rez_to_ndat.mjs` and installed with
  `novaref app setup-minimal`. That made `~/novaref/apps/EV Nova
  Minimal.app` (21 MB): the real bundle copied without its Nova Files,
  plus the 7.8 MB `.ndat`.
- `scenarios/minimal_app.json` (pilot `minimal.json`: shïp 128 at spöb
  128) launched it, opened the pilot, entered space and landed at
  "www.evula.org/artanis", with Bar, Mission BBS, Trade Center, Shipyard
  and Outfitter buttons.
- **Evidence:** `~/.local/share/novaref/evidence/20261123-minimal-app/20261123-024321-minimal_app/`.

### A14: which legal record decides an NPC's hostility? (2026-11-23, wave 2)

**Setup** (`kits/testkit.mjs` `a14Resources`, `scenarios/a14_observe.json`,
pilots `pilots/a14_c*.json`, analysis `analysis/hostility.mjs`).

- One sealed system per matrix cell. Each spawns only warships of ONE
  government through the sÿst dude list (avgShips 2): red disc hulls, AI 3,
  a weak 5-damage turret, MaxOdds 1000.
- The player starts beside the system's only stellar in Kit Lancer Lite
  (1500 shield, no recharge) with an IFF and never fires.
- Legal records are set per system in the pilot (-500 = Criminal with a
  CrimeTol of 10; the map confirmed "Criminal" where expected).
- Each run observes for about 85 s. An attack shows as the shield bar
  draining from about 8 s on (in c6, from 54 s), and red brackets and
  visible fire in the Tab shots.

Governments: 370 Owner (CrimeTol 10) and 371 Ally are mutually allied
through classes 70/71. 372 Unrel has no relations. 373 Nosy has flag
0x0002. 374 AllyHi is an ally with CrimeTol 10000, 375 NosyHi is nosy
with CrimeTol 10000. 376 OwnerHi (CrimeTol 10000) is allied with 377
AllyLo (CrimeTol 10).

| cell | system owner | warships' govt (AI) | -500 record in | attacked? |
|---|---|---|---|---|
| c0 | Owner | Owner (3) | nowhere | no |
| c1 | Owner | Owner (3) | **this system** | **yes** (shield 138 -> 16 px) |
| c2 | Owner | Owner (3) | another Owner system | no |
| c3 | Owner | Ally (3) | this system | **yes** |
| c14 | Owner | Ally (3) | the Ally's home system | no |
| c4 | Owner | Unrel (3) | this system | no |
| c5 | Owner | Unrel (3) | Unrel's home system | no |
| c15 | Owner | Unrel (4, interceptor) | this system | no |
| c16 | Owner | Unrel (4) | Unrel's home system | no |
| c6 | Owner | Nosy (3) | this system | **yes** (twice; see note) |
| c7 | Owner | Nosy (3) | Nosy's home system | no (twice) |
| c18 | Owner | Nosy (4) | this system | **yes** |
| c17 | Owner | Nosy (4) | Nosy's home system | no |
| c8 | Owner (CrimeTol 10) | AllyHi (3), CrimeTol 10000 | this system | no |
| c9 | Owner (CrimeTol 10) | NosyHi (3), CrimeTol 10000 | this system | no |
| c12 | OwnerHi (CrimeTol 10000) | AllyLo (3), CrimeTol 10 | this system | **yes** |
| c13 | OwnerHi (CrimeTol 10000) | OwnerHi (3) | this system | no |
| c10 | independent | Unrel (3) | this system | no |
| c11 | independent | Nosy (3) | this system | **yes** |

**Finding.** A ship of government G attacks the player on sight
(record-based hostility) exactly when both of these hold:

1. **G enforces in the current system.** G owns it, G is allied with
   its owner, or G has gövt flag 0x0002 (nosy). Nosy also applies in
   independent systems. A govt with no tie to the system ignores the
   player however criminal he is there (c4, c10). AI 4 interceptors
   follow the same rule (c15 no, c18 nosy yes).
2. **The player's record IN THE CURRENT SYSTEM is below -G.CrimeTol.**
   - Only this system's record counts. A criminal record in another
     system of the same govt (c2), or in G's own home system (c5, c7,
     c14, c16, c17), changes nothing, even for nosy govts. "Enforces
     its own laws everywhere" means its own CrimeTol, applied to the
     local record.
   - The CrimeTol is the **ship's own govt's**, not the system owner's.
     A high-tolerance ally ignores a -500 player in a strict owner's
     system (c8, and c9 for nosy). A strict ally attacks in a lenient
     owner's system (c12).

Wave 1 found the always-attacks flag 0x0004 overrides all of this
(Q2a).

Notes and limits:

- **c6.** In the first run, the two nosy warships present at arrival sat
  on the planet for about 25 s without attacking, then left; two that
  jumped in later attacked at once. The repeat attacked from 8 s, like
  every other "yes" cell, so the first run's delay was incidental. c7
  was repeated too, with the same result (no attack).
- The other cells ran once each. The yes/no split is clean: every "no"
  cell kept a full shield for 85 s, and every "yes" cell lost 30-90% of
  it.
- Alliances here were mutual (each govt lists the other's class).
  One-way alliances are untested.
- How a crime spreads across systems (which systems' records a kill
  changes) is a separate question (catalogue R2).

**NovaJS today.** Records are kept per GOVERNMENT, a sanctioned
simplification of the original's per-system records. Every ship checks
the player's record with its OWN govt, in every system:

- `N/nova_plugin/reputation/govt_disposition.ts:97-103`
  (`govtDispositionTo`, used by the AI at
  `N/nova_plugin/npc/npc_decision.ts:355,385`);
- `N/nova_plugin/reputation/iff_plugin.ts:109-112` (`shipDisposition`,
  used for the brackets and radar through `combat/hostility.ts
  styleForTarget`).

Against the original this gets five cells wrong:

- c4/c10/c15: hostile in a system G does not own. NovaJS would attack if
  the player were criminal with G; the original doesn't.
- c5/c7/c16/c17: NovaJS attacks anywhere once the player is criminal
  with G (its home record); the original only does so locally.
- c3: an ally does not care in NovaJS unless the player is criminal with
  the ally itself.

**Proposed fix (applied in 13567336, ruling #376).** Give both
predicates the current system's owner govt O (`statusGovtOf(system
govt)`, gövt 128 when independent):

    enforces = G === O || alliedWith(G, O) || G.flags.nosy   // 0x0002
    hostile  = enforces && recordWith(records, O) < -G.crimeTol

In other words:

- The record comes from the status govt O, which NovaJS's per-govt
  records already use as "the record in this system".
- The tolerance comes from G.
- Keep the 0x0004/xenophobic/enemy tiers as they are.

Per-govt records cannot express c2: a criminal in one of O's systems
is criminal in all of them. That is the price of the existing
simplification, not a new error.

**Applied in 13567336** (`N/nova_plugin/reputation/local_law.ts`, with wave
5's either-direction alliance test). Every hostility reader takes the law
of its world's own system: the NPC brain, the escort brain, the brackets,
the radar, 'r', point defense and the comm channel. All 21 cells (c0-c18
here, c19/c20 from wave 5) are re-run as NovaJS specs in
`N/nova_plugin/reputation/local_law_test.ts`, as the pure rule and in a
live world (NPC brain + brackets). 20 match the original; c2 is pinned as
the known per-govt difference.

**Evidence:** `~/.local/share/novaref/evidence/20261123-a14/<cell>/<run>/`.
Each holds `recording.mp4`, `recording.events.json`, `hostility.json`, the
Tab shots, `01-map.png` (legal status) and `pilot-after`.

### M-batch: star map and `h` minimap (2026-11-23, wave 2)

**Kit.** A linked map region around sÿst 2140 Map Hub at (-700, 400)
(`kits/testkit.mjs` `mapRegion`):
- two major govts, red 379 and blue 380;
- minor green 381 (gövt Flags2 0x0002) and borderless yellow 382
  (Flags2 0x0004);
- an unlinked explored system (2149 Map Lone);
- two unexplored systems in a chain, D-U-U-D: Hub, 2143 East, 2146 Void,
  2147 Far.

The hub's link list is deliberately not in id order:
[2144, 2142, 2145, 2141, 2143].

Pilot `w2_map`; scenarios `map_explore.json` (first pass) and
`map_follow.json`. The game window is 832x604.

**M6, default zoom.** **1.77 px per map unit** when the map opens.
Measured on four systems (South, 60 units, at +106 px; Lone (60, 70) at
(+106, +124)). The minimap uses the same scale. NovaJS's full map opens
at 2.0 (`MINI_MAP_ZOOM` comment in `N/spaceport/mini_map.ts:44-50`), so
the **full map is 12.5% too zoomed in**.

**M7, Tab on the big map.** Tab cycles the current system's
neighbours in **sÿst link-slot order**, not by id, angle or distance:
- with links [2141..2145] in id order the cycle was South, NE, East,
  SW, WSW;
- with links [2144, 2142, 2145, 2141, 2143] it was SW, NE, WSW, South,
  East.

Unexplored neighbours are included. The cycle wraps with no "nothing
selected" step, and each pick is a single-jump route (thin green line).
The status bar then reads "Hyperspace / <name>", or "Unexplored
System".

**M4, routing (shift-click pins).**
- **The D-U-U-D quirk is real.** Shift-clicking East (unexplored), then
  Void (unexplored), then Far (explored) drew a strong green route
  Hub -> East -> Void -> Far. The info panel read "Destination System:
  <Unknown>" while the route ended in an unexplored system, and "Map
  Far" once Far was pinned. **NovaJS now matches (applied in db700fff):**
  Matthew reversed his explored-only ruling (2026-11-23, "D-U-D is
  allowed. Surprisingly, also D-U-U-D is allowed"). Routes pass through
  every system the map draws, explored or not, by a single shift-click
  or pin by pin. A system the map does not draw is never a hop
  (`N/spaceport/route.ts`, DRAWN SYSTEMS ONLY).
- **A shift-click on an unroutable system** (Lone, explored but with no
  links) is ignored: the route and the info panel are unchanged.
- A plain click on a non-neighbour (Lone, Far) selects it for its info
  ("Selected System: ...") and draws no route.
- The panel heading has three states: "Current System" (no selection),
  "Destination System" (end of a route) and "Selected System" (an
  info-only pick).
- Clear Route is greyed when there is no multi-jump route.

**M1-M3, the `h` minimap** (832x604 window):
- **Geometry.** A 208x206 box at (414, 151) with a 1 px RGB (8,8,8)
  outline and no background. It is centred on the current system at
  1.77 px/unit and shows only names, dots, links and the route. (The
  1920x1080 capture's box is 480 px with the same top and the same
  16 px gap to the status bar; see R8.)
- **It is a 2.2 s peek, not a toggle.** Every press of `h` shows it for
  64-66 frames (2.1-2.2 s), then it hides itself. Measured frame by
  frame from the recording's frame-sync: shown at frame 1978, hidden at
  2044, and the same after every later press. A second `h` does not
  close it.
- **Clicks work while it is hidden.** A click where it sits picks a
  destination and shows it again for 2.2 s:
  - SW: status "Hyperspace Map SW";
  - East: "Unexplored System";
  - shift-click and ctrl-click: picked WSW like a plain click (no
    multi-jump pin from the minimap);
  - a drag starting on the current system cleared the destination
    ("No Destination").
  NovaJS deliberately does NOT copy the hidden-click part (Matthew,
  2026-11-23: "`h` map preview is clickable even when hidden. bug."):
  the hidden minimap takes no pointer input and clicks there reach
  space; the click rules above apply only while it is shown
  (`N/spaceport/mini_map.ts`).
- **Neither Tab nor thrust shows it.**
- **The full map (`m`)** opens normally over it.
- **No automatic display** after landing and taking off, or after `j`
  with no destination.
- **Not tested:** whether it appears by itself during a real jump (the
  1920x1080 reference capture is "Jumping into the Tau Ceti system";
  our `j` had no destination after the drag cleared it).
- **M3:** in this install the secondary trigger is Control
  (`fireKey1` = 59), not shift. A ctrl-click with no secondary selected
  fired nothing, so this stays open.

**M5, borders (Show Borders), first pass.**
- Radiating: the explored, inhabited systems of the two majors (Hub,
  South, Lone, Island in red; NE and SW in blue).
- Not radiating:
  - Map East (blue, unexplored, its stellar not landable);
  - Map Void (red, unexplored, no stellar);
  - Map Far (Flags2 0x0004).
  East and Void each combine two factors, so which one matters is
  unresolved.
- The minor govt's system (WSW, 30 units from the hub) shows **no green
  at all**: the red hub territory covers it completely.
- Where red and blue meet, the boundary is a straight cut, as NovaJS
  models it.

**NovaJS mismatches (not fixed):**
1. Full map default zoom 2.0 vs 1.77 px/unit (`N/spaceport/starmap.ts`
   opening zoom; noted at `mini_map.ts:44-50`).
2. The minimap is a persistent toggle in NovaJS (`mini_map.ts:1-30`:
   "h toggles it, it survives jumps"). The original shows it for 2.2 s
   per `h` press or click, and clicks on its hidden area still work.
3. Shift-click on the minimap: NovaJS does nothing; the original treats
   it like a plain click (picks the system).
4. The minimap's size is fixed at 480 px (`mini_map.ts:37`). In an
   832x604 window the original uses 208 px.
5. Tab: NovaJS cycles through an extra "off" slot
   (`N/spaceport/route.ts:233-252` `cycleSingle`:
   undefined -> adj[0] -> ... -> undefined). The original wraps
   straight from the last neighbour to the first. The order (adjacency
   = link order) already matches.

**Evidence:** `~/.local/share/novaref/evidence/20261123-map/{explore,follow}/*/`
(`follow` has `recording.mp4` plus frame-sync).

### E-view: the escort command panel (`e`) (2026-11-23, wave 2)

**Setup.**
- `scenarios/esc_explore.json`, run with pilots `w2_esc` (3 hired disc
  escorts, 1 captured Kit Fighter, a 4-fighter bay) and `w2_esc0` (no
  escorts).
- `scenarios/esc_view.json`, run with pilot `w2_esc2`: one hired escort
  per shïp EscortType 0/1/2/3 (kit shïp 756-759), a hired disc with
  EscortType -1, a captured Kit Fighter, and a Kit Fighter Bay with 4
  fighters.
- Every key and click is followed by a lossless shot. Key times are in
  `log.jsonl` frame-sync and `recording.events.json`.

Key bindings in this install (from the prefs): `escortMenuKey` = e,
`escortCmdKey0-3` = f, d, v, c.

**Layout** (832x604 window; space view x 0-637):
- A floating panel with a 1 px outline of RGB (8,8,8) (cölr
  FloatingMap, the same as the minimap's), **no background** (stars
  show through). Its outer box is x 15-174, y 150-269 (160x120).
- The title "Escort Commands" is centred at the top. Then five rows,
  18 px apart:
  `1) All Ships`, `2) Fighters`, `3) Medium Ships`, `4) Warships`,
  `5) Freighters`.
- The text is white, in a small Geneva-like bitmap font. A row whose
  category has no escorts is drawn grey (with w2_esc, Warships and
  Freighters were grey).
- Rows 2-5 show their category's current order right-aligned: one of
  `Formation`, `Hold Position`, `Defend`, `Attack`. Row 1 shows none.
- The selected row has a filled bar of RGB (132,0,0) (cölr
  EscortHilite) at x 19-171 and 13 px tall. Row 1's bar is y 180-192;
  row 5's is y 252-264.
- Categories come from shïp EscortType: 0 Fighter, 1 Medium, 2 Warship,
  3 Freighter. Where EscortType -1 ships are placed is not identified.
- Brand-new escorts start on `Formation`.

**Behaviour:**

| input | effect |
|---|---|
| `e` | Toggles the panel. It opens with row 1 selected. |
| `e` with no escorts | No panel. The status line (bottom left) says "You don't have any escorts." |
| `1`-`5` | Selects that row. |
| click on a row | Selects it. Hovering does nothing. |
| `f` / `d` / `v` / `c` | Gives the selected category the order Attack / Defend / Hold Position / Formation. On row 1 it applies to every category. Example: `2` then `v` turned only Fighters to Hold Position. |
| Left/Right arrows | Turn the ship as usual. **The game does not pause**: escorts and the ship keep moving. |
| Up/Down arrows | Thrust or reverse as usual. (Wave 2 said they close the panel; **wrong**, see "Wave 4: the panel's lifetime": that close was the timer.) |
| Tab, Return | Do nothing to the panel; they don't open it either. |
| Escape | In space this always quits to the title screen (pause key), panel or not. |
| no input | The panel closes by itself **8.3 s** after it opened (wave 4; wave 2 only watched 4 s). |

- `f` with no target still sets the order to Attack.
- Bay fighters: with the Kit Fighter Bay as secondary (`w`), four taps
  of the secondary fire key (Control) launched all four (the bay
  counter went 4 to 0), with no target selected. One 1.5 s hold of
  Control in the first run launched none.

**Follow-up** (`scenarios/esc_view2.json`, pilot `w2_esc3`):
- **The selection does not persist.** Selecting row 3, closing and
  reopening shows row 1 (All Ships) selected again.
- **The order keys work with the panel closed** and apply to all
  escorts (the row-1 default). With the panel closed:
  - `v`, then opening the panel, showed every category on Hold
    Position;
  - `c` turned them all back to Formation.
- **Hold Position:** after `v` the player flew 2.5 s away and the
  escorts stayed where they were.

**Not pinned down:**
- **What Attack and Defend do in a fight.** The mïsn 961 raiders never
  showed up in this run, and `r` (nearest hostile) found nothing.
- **How fast Formation recalls held escorts.** 8 s after `c` the
  escorts, left about 900 px behind, were still off screen.

**Wave 4: the panel's lifetime** (`scenarios/escpanel_timer.json`, pilot
`w3_recall`: two hired escorts in quiet Kit Range; two runs). One
recording per run: `e` and 60 s untouched, then one trial per key (`e`,
4 s, the key, 14 s). `analysis/region_lit.mjs` times the panel from the
bright pixels of its rows; frames are recording frames (30 fps), counted
from the key's stamp.

| after `e`, at about 125 frames | panel closed, frames after `e` (run 1 / run 2) | frames after the key |
|---|---|---|
| nothing (watched 60 s) | 248 / 250 | |
| row `2` | 375 / 374 | **250 / 250** |
| row `4` | 373 / 374 | **249 / 250** |
| order `c` (Formation) | 249 / 251 | |
| order `c` again | 249 / 249 | |
| Left (turn) | 250 / 250 | |
| Up (thrust) | 249 / 250 | |
| Down (reverse/brake) | 250 / 250 | |
| Space (fire) | 250 / 250 | |
| Tab (target) | 250 / 250 | |

- The panel **closes itself 249-250 recording frames (8.3 s) after it
  opens**, i.e. about 240 game frames at 29.1 Hz (8 s nominal).
- **Selecting a row (1-5) restarts the timer**: the close comes 250
  frames after the row key. The wave-2 recording also shows a **click** on
  a row restarting it (closed 249 frames after the click).
- **Nothing else restarts or closes it**: order keys (`c`), turning,
  thrust, reverse, firing and Tab all leave the close at 250 frames after
  `e`. Wave 2's "Up/Down close the panel" was the timer (the panel had been
  open 8.3 s since its last click); the Up press there came 46 frames
  before the close.
- `e` while it is open still closes it (wave 2).

**NovaJS (9ec7a496), `N/display/escort_panel.ts`:** no timer, and
`CLOSING_ACTIONS` (line 172: accelerate, reverse) closes the panel on
thrust or reverse (lines 226-229). **Mismatch** on both. **Applied in
"Escort panel closes itself after 250 frames" (wave-4 fixes):**
`CLOSING_ACTIONS` is gone; the panel closes 250 frames (8.3 s at 30 fps,
`ESCORT_PANEL_LIFETIME_FRAMES`) after it opens or after the last row
selection (key or click); `e` still toggles. The count is client-side: the
display world's frame time, converted to 30 fps frames
(`EscortPanelController.advance`). Confidence: high (two runs, every trial
within 2 frames).

Evidence: `~/.local/share/novaref/evidence/20261123-w4/escorts/panel-timer/*/`
(`recording.mp4`, `recording.events.json`, `lit.json`).

**NovaJS today (wave 2):**
- `controls.json` binds `escorts: KeyE`, but no panel exists.
- The orders are implemented as attack/defend/formation/holdPosition/
  returnToBay (`N/nova_plugin/escorts/escort_command_plugin.ts`), with
  no per-category targeting. The original has no "return to bay" row.

**Evidence:**
- `~/.local/share/novaref/evidence/20261123-escorts/explore/*/` and
  `explore0/*/` (first pass; it also shows that Escape quits to the
  title);
- `view/*/` (35 shots plus `recording.mp4`).

### K9: what bracket colour do non-attacking ships of a hostile govt get? (2026-11-23, wave 2)

**Setup.** sÿst 2129 Kit IFF Range is owned by govt 370, and the player
has a -500 record there. Four dudes spawn at once (`scenarios/
k9_observe.json`, pilot `w2_k9`, player has an IFF):

- AI 1 green discs of always-attacks-player govt 362;
- AI 3 red A14 Warships of 362;
- AI 1 blue discs of 370, hostile by record;
- AI 3 magenta armed discs of 370.

Tab every 2.5 s for 16 shots.

**Finding.**
- The warships of both kinds (red, magenta) attacked: the player's shield
  went from 140 px to 0 and armor started dropping. Their brackets were
  **red** in every shot.
- The AI 1 traders of the same two hostile govts (green and blue) had
  **yellow** (neutral) brackets every time they were targeted. This
  holds whether the hostility comes from gövt flag 0x0004 or from the
  player's criminal record.

So the bracket colour follows whether the ship will fight the player,
not the government's attitude alone. This matches wave 1's Q2b/Q2c
traders.

**NovaJS mismatch:** `N/nova_plugin/reputation/iff_plugin.ts:101-112`
(`shipDisposition`) returns 'hostile' for any ship of an
always-attacks, xenophobic, enemy or record-hostile govt, whatever its
AI type. `combat/hostility.ts styleForTarget` paints that red.

**Fix (applied, wave 3; Matthew's ruling 2026-11-23: "IFF bracket
colors correspond to hostility regardless of govt's stance").** The
political tier of styleForTarget is now `onSightDisposition`
(`combat/hostility.ts`): red only for a ship that would attack the
player on sight, read from the NPC brain's own predicate
(`npc/on_sight.ts`'s `attacksOnSight`: AI 3/4 and
`govtDispositionTo(...) === 'enemy'`), which NpcDecisionSystem now calls
to build its hostiles list. A brainless bay fighter takes its carrier's
AI type. The radar reads styleForTarget whole, so blips match brackets
(own flock green, attackers red). The 'r' key, the comm channel's
Status line, point defense and the escort brains (`isHostileTo`) follow,
since they read the same rule. `shipDisposition` stays the government's
stance for hails and ship mission offers. The two untested cases were
chosen as:
- AI 2 (brave trader) that has been provoked: red through the
  behavioural tier (it is in mode 'attack' targeting the player);
- AI 4 interceptors of a hostile govt: treated as warships (red), as
  A14 c15/c18 showed they follow the same attack rule.

Specs: `display/target_corners_test.ts` (K9 block),
`display/status_bar_radar_test.ts` (radar matches brackets),
`combat/hostile_targeting_test.ts` (live AI and brackets agree),
`escorts/escort_hostility_agreement_test.ts` (K9 rows).

**Evidence:** `~/.local/share/novaref/evidence/20261123-k9/*/`: `02-17
obs-*.png` (the target panel names the ship; the brackets are in the
space view) and `hostility.json`.

**Wave 4 follow-up: AI 2 and AI 4** (`scenarios/k9b_observe.json`,
`k9b_observe_early.json`; kit `wave4Brackets`). One armed yellow AI Subject
Disc appears at Kit Port. The player (Kit Lancer Heavy with an IFF and the
1-damage Kit Tickler) targets it once with Tab and shoots every 2.5 s:
six shots, one 0.6 s tickle, 24 more shots (60 s). In `_early` the tickle
comes after one shot (the AI 2 trader leaves within about 18 s). Bracket
colour = the dominant colour 15-40 px around the disc in each shot
(`brackets.txt` per run); attacks from the player's shield bar.

| case (2 runs each) | before the tickle | after the tickle |
|---|---|---|
| AI 2, gövt 362 (always attacks the player) | **yellow** (2 runs where it was on screen: `ai2` and `ai2-early` run 1); it never attacked, flew off and, without a tickle in reach, left the system about 18 s in | **red** in every shot from the first after the tickle (both `_early` runs); it attacked (shield drops from 20-24 s) and was still attacking and red at the end, 60 s later |
| AI 4, gövt 362 | **red** from the first shot, 2.5 s after Tab | red throughout |
| AI 4, gövt 360, record -500 in its system | **red** from the first shot | red throughout |
| AI 4, gövt 363 (neutral control) | off screen (patrolling away; its radar dot was the neutral colour) | **red** once it came back to attack after the tickle |

The hostile interceptors had already hit the player before the recording
started (shield 146 of 148 px at the first frame, against 148 for the
neutral one): they attack the moment the player takes off, so "red before
it attacks" can't be separated for AI 4.

**Findings.**
- An AI 2 trader of an always-attacks government is **yellow** until the
  player hits it, then **red** while it fights back (and it did not stop
  within the 60 s, so whether it turns back to yellow later is
  unmeasured; wave 3 saw AI 2 keep attacking for 130 s).
- AI 4 interceptors of a hostile govt (flag 0x0004, or the local record)
  attack at once and are red at every look. A neutral AI 4 turns red when
  provoked.
- Together with wave 2 (AI 1 yellow, AI 3 red): **the bracket is red
  exactly when the ship is, or will at once be, attacking the player**:
  warships and interceptors of a hostile govt from the start; traders
  only once provoked.

**NovaJS (9ec7a496):** `N/nova_plugin/reputation/iff_plugin.ts:101-113`
paints any ship of an always-attacks / xenophobic / enemy / record-hostile
govt hostile regardless of AI type. Wrong for AI 1 and AI 2 (yellow until
they attack); right for AI 3 and AI 4. **Applied in 29237401** (the
political tier is now `combat/hostility.ts` onSightDisposition: hostile
only for AI 3/4 ships that would attack on sight; AI 1/2 are neutral and
go red through the behavioural tier once they attack). Confidence: high for AI 2 and AI 4 (two runs each, every shot
consistent).

Evidence: `~/.local/share/novaref/evidence/20261123-w4/k9b/{ai2,ai2-early,ai4h,ai4r,ai4n}/*/`
(`NN-pre-*/post-*.png`, `brackets.txt`, `hostility-yellow.json`).

### U3: do outfit speed/accel/turn mods use the hull scale? (2026-11-23, wave 2)

**Setup.** `scenarios/unit_probe.json` (14 s turn, 6 s thrust) with kit
outfits oütf 611 Kit Speed Mod (ModType 8, +300), 612 Kit Accel Mod
(ModType 7, +300) and 613 Kit Turn Mod (ModType 9, +100). Analysed with
`analysis/motion.mjs` and `world_motion.mjs`.

| pilot | hull | outfits | expected if same scale | measured |
|---|---|---|---|---|
| u3a | Probe A (Accel/Speed/Turn 300/300/10) | 1 of each | Turn 20 = 58.2°/s, Speed 600 = 261-265 px/s, Accel 600 = about 111 px/s² (wave 1, same tool) | **58.38°/s**, **264-269 px/s**, **114.7 px/s²** |
| u3b | Probe B (150/600/30) | 2 Speed, 2 Turn | Turn 50 = 145.5°/s, Accel unchanged at 26 px/s² | **145.95°/s**, **30-31 px/s²** (6 s of thrust never reaches Speed 1200) |

**Finding.** ModType 7 and 8 add to the hull's Accel and Speed in the
same units. ModType 9 adds ModVal/10 hull Turn units ("100 = 30°/s", as
the Bible says).

**NovaJS matches.**
- `P/parsers/outfit_parse.ts:168-177` uses `ShipSpeedConversionFactor`
  and `ShipAccelerationConversionFactor`.
- `outfit_parse.ts:159` uses `OutfitTurnRateConversionFactor` =
  ship turn factor / 10 (`P/parsers/constants.ts:30`).

No change needed. Confidence: high (two pilots, 1x and 2x mods).

**Evidence:** `~/.local/share/novaref/evidence/20261123-u3/{u3a,u3b}/*/`
(`recording.mp4`, `motion.json`, `world_motion.json`).

### J-series: missile jamming and asteroids (2026-11-23, wave 2)

**Setup.** `kits/testkit.mjs` `jammingKit`, `scenarios/jam_fire.json`,
pilots `pilots/w2_j*.json`.
- **Weapons.** Guided secondary missiles that differ only in JamVuln1 and
  Seeker flags: Speed 600, GuidedTurn 60, 10 s life, reload 15 frames,
  1 damage, a 25 px proximity fuse.
- **Targets.** Immobile Jam Targets with armor 100 and shield 0, so one
  hit is 1% on the target panel. They carry 0-4 "Kit Jammer 25" outfits
  (oütf ModType 33, +25 type-1 jamming each) in their shïp outfit slots.
- **Geometry.** The target appears at Kit Market, 900 px east. The
  player (Kit Lancer) takes off from Kit Port, stays put, targets it and
  holds the secondary trigger for 20 s. The armor % is read 12 s later.
- **Readout.** Hits = 100 - armor %. Every run fired the same number of
  missiles: the control's 49 hits.

Three earlier attempts are marked INVALID in the evidence:
- the missiles were primary weapons;
- there was no proximity fuse;
- the player had backed off and the geometry failed.

| config | JamVuln1 | target jamming | seeker | hits (of 49) | lost |
|---|---|---|---|---|---|
| control | 0 | 0 | 0 | **49** | 0% |
| v100_j0 | 100 | 0 | 0 | **49** | 0% |
| v100_j25 | 100 | 25 | 0 | 40 | 18% |
| v100_j50 | 100 | 50 | 0 | 43 | 12% |
| v100_j75 | 100 | 75 | 0 | 45 | 8% |
| v100_j100 | 100 | 100 | 0 | 35 | 29% |
| v50_j50 | 50 | 50 | 0 | **49** | 0% |
| turn_j50 | 100 | 50 | 0x0010 turns away | 32 | 35% |
| parent_j50 | 100 | 50 | 0x8000 may attack parent | 36 | 27% |
| rock: plain | 0 | 0 | 0, 16 asteroids | 34 | 31% |
| rock: decoy | 0 | 0 | 0x0002 decoyed by asteroids | 29 | 41% |
| rock: pass | 0 | 0 | 0x0001 passes over asteroids | **49** | 0% |

**Findings.**
1. **Jamming is far weaker than vuln x jam.**
   - At JamVuln 100 against 100% jamming, only 29% of missiles missed;
     every 25-75 level lost 8-18%.
   - With N = 49 the per-run noise is about ±7 percentage points, so
     the 25/50/75 levels can't be told apart; only 100 stands out.
   - JamVuln 50 against 50 lost nothing.
   - In this geometry (900 px, about 5 s of flight) the loss is roughly
     0.1-0.3 x vuln x jam. Whether the roll is per frame or per launch,
     and whether distance matters, is untested.
2. **Seeker 0x0010 (turns away if jammed)** loses more than a plain
   missile at the same jamming (35% vs 12%). A plain missile that is
   jammed apparently often re-acquires and still hits; a turn-away one
   doesn't.
3. **Seeker 0x8000 (may attack parent):** 27% lost. No missile was
   seen turning back on the player in the recording, and the player's
   30000 shields hide 1-damage hits, so the "attack parent" half is
   unmeasured.
4. **Asteroids.**
   - Without seeker flags, the asteroid field stopped 31% of the
     missiles: they hit rocks in the way.
   - Seeker 0x0002 (decoyed) lost 41%.
   - Seeker 0x0001 (passes over asteroids) lost **none**: asteroids are
     fully transparent to it.
   - No jamming was involved; asteroids act as blockers and decoys on
     their own.

**NovaJS today** (`N/nova_plugin/combat/jamming_plugin.ts:30-117,
299-317`).
- The single-shot lose-lock probability is P = vuln x jam per type
  (100 x 100 gives P = 1, so every missile is jammed). It is spread over
  80% of the flight, and a jammed missile never re-acquires.
- The original lost 29% at 100 x 100.
- **Proposed (not applied).**
  - Scale P down: about 0.3 x vuln x jam reproduces 100x100 = 29%,
    50x50 = 7.5% (0 observed) and 100x50 = 15% (12% observed).
  - Or let a plain jammed missile re-acquire, keeping permanent loss for
    turn-away (0x0010) missiles.
- More trials per cell are needed before choosing between the two.
- **Wave 3 update:** neither option; see "J-series wave 3". The NovaJS
  description above is also inexact: a jammed frame only flies straight for
  that one frame, so P < 1 does almost nothing and P = 1 never guides.
- The asteroid rules (blocking, and pass-over for 0x0001) match NovaJS
  (`N/nova_plugin/combat/projectile_plugin.ts:424-431`).

**Not covered:** jamming types 2-4, gövt InhJam, sÿst Interference
(0x0008), ionization (0x0020) and cloaked targets.

Confidence:
- **high:** asteroid pass-over / blocking; 100x100 vs 0;
- **medium:** the size of the jam effect (single runs, N = 49).

**Evidence:** `~/.local/share/novaref/evidence/20261123-jam/<config>/*/`
(the target panel shots 04-11 show armor %; `recording.mp4`).

### A-series: AI reactions to provocation (2026-11-23, wave 2, first pass)

**Setup.** `scenarios/ai_observe2.json`, pilots `w2_ai1..ai4`,
`w2_ai3r`.
- **Subject:** an "AI Subject Disc" (yellow 24 px disc, 1000/1000
  shield/armor, Speed 300, two Kit Raider Guns) of neutral govt 363,
  spawned beside Kit Port by mïsn 977-981. The düde sets the AI type.
- **Player:** Kit Lancer with only the Kit Tickler (a 1-damage turret
  with about 2250 px reach).
- **Sequence:** target the subject once (Tab toggles when there is only
  one ship, so it is pressed once). Idle 6 s, one 0.6 s tickle, watch
  25 s, fire for 20 s, watch 15 s. The target panel is shot every 2.5 s.
- A first version (`*-v1-flawed-tab-toggle`) pressed Tab every shot and
  lost the target; ignore it.

| AI | reaction to being tickled | brackets |
|---|---|---|
| 1 wimpy trader | Never closed in or fired. Its shield regenerated to 100%, and about 15 s after the tickle it was gone from the system (the target panel went to "No Target" for the rest of the run). | (not seen on screen) |
| 2 brave trader | Turned and closed in to fight. It stayed within 200 px of the player for most of the run (1201 frames) and fired back (the player's shield bar lost 2 px of 148 on 30000 shields). It was still engaged 15 s after the player stopped. | **red** after the tickle |
| 3 warship | The same: closed in and fought back, still engaged afterwards. | **red** |
| 3 + gövt 0x0010 (retreat below 25% shield) | The same as AI 3. The tickler never took its shield below 94%, so **the retreat threshold was not exercised**. | red |
| 4 interceptor | The same as AI 2/3 (rerun after an `open_pilot` failure): closed in and fought back (1254 frames within 200 px). | red |

**Findings.**
- A neutral AI 2 or AI 3 ship retaliates against a single 1-damage
  shot and keeps fighting after the player stops firing (for at least
  15 s).
- AI 1 leaves instead. There was no idle control of the same length,
  so "leaves because it was attacked" and "leaves anyway" (traders
  travel and land) can't be told apart for AI 1.
- Retaliating ships get red brackets (the behavioural tier, consistent
  with K9).

**NovaJS:** `N/nova_plugin/npc/npc_decision.ts` cases 1-4 model the same
split (wimpy flees, brave fights back while the odds hold, warships
retaliate as aggressors). No mismatch was observed at this level of
detail.

Open:
- the shield threshold for fleeing (AI 2 "runs away when the attacker
  is out of range"; gövt 0x0010) needs a weapon that strips shields;
- how long retaliation lasts.

**Evidence:** `~/.local/share/novaref/evidence/20261123-ai/<ai>/*/`
(`hostility.json`, the shots and `recording.mp4`).

### F1n and U9 boarding: attempts without an answer yet (2026-11-23, wave 2)

- **F1n, NPC fleet formations.** The kit has flët 1000 Kit Disc Fleet:
  a white disc lead and four coloured disc escorts, govt 363, LinkSyst
  2128. Three tries put **no fleet on screen**: 60-80 s each, with the
  radar showing only the stellars.
  - Kit Fleet Range with avgShips 0;
  - the same system with avgShips 6 and no dudes;
  - jumping in from the linked sÿst 2133 so the system is populated on
    arrival.
  So a flët isn't produced just by linking it to a quiet system. Next
  ideas: give the system ordinary dudes as well (fleets may replace
  part of the normal traffic), or loop many jumps. Evidence:
  `~/.local/share/novaref/evidence/20261123-f1n/`.
- **U9, landing.** `scenarios/u9_land.json` with Probe A (inertial) and
  the inertialess Crawler 200: fly out for 6 s, then `l`, then `l`.
  - The first `l` says "Landing request received, <ship>. Begin initial
    approach."
  - The second, from about 800 px, says **"You're too far away to land
    on this planet."**
  - **There is no auto-approach.** The ship drifted for 45 s and never
    landed.
  - NovaJS's `tooFar` message and the absence of an autopilot match
    (`N/display/status_bar_content.ts:189-191`). Wave 1's README note
    that "a second l autopilots the ship down" was wrong: it only lands
    when already in range, and is now corrected.
  - The exact distance and speed gate is still unmeasured. It needs
    stops at known distances with the inertialess hull, which **does
    stop dead when thrust is released**: the Crawler's starfield is
    static from the first frame after release (U5).
- **U9, boarding.** A derelict (gövt flag 0x0800, düde booty 0) spawned
  on Kit Port by mïsn 970. The player, an inertialess Kit Crawler 200
  at rest beside it, targeted it (the panel said "Disabled") and
  pressed `b` (boardKey): **nothing happened**. No dialog, and no
  "repelled" message either, although booty 0 should produce "repelled
  while attempting to board". Escape then quit to the title, which ended
  the run. Unresolved. Next: a ship disabled by gunfire, a booty bit
  set, and `b` pressed at a range of distances. Evidence:
  `~/.local/share/novaref/evidence/20261123-u9/explore/`.

### R8: UI rendering, original vs NovaJS (2026-11-23, wave 2, partial)

**How.**
- NovaJS: the `packages/nova/visual_compare` harness was run headless
  on port 8217 against Matthew's 1920x1080 original-hardware captures.
  It now passes `--mute-audio`, and a scenario that times out no longer
  aborts the whole run (`visual_compare/run.mjs`).
- Original: the wave-2 shots of the 832x604 game window filled in what
  those captures lack (escort panel, minimap at this window size, the
  test kit's map region).
- Output: `packages/nova/visual_compare/output/` (git-ignored) and the
  scratch logs.
- Region percentages are only a guide. Several scenarios differ in DATA,
  not rendering, and were set aside:
  - the outfitter/shipyard lists (the NovaJS server loads the canonical
    plug-ins);
  - hail portraits (a different ship);
  - bar fuel levels.

Concrete differences, most important first:

1. **Escort command panel missing.** See "E-view" above for its full
   spec. NovaJS binds `e` but draws nothing.
2. **Set Prefs dialog** (prefs_modal about 60% different).
   - **Original:** a native window titled "Preferences", 663x305, at a
     fixed y 194-498 over the title art. Five tabs (Game Settings,
     Navigation/Battle/Escort/Misc Controls). Two centred columns of
     enabled blue checkboxes (x about 786 and 998), with Sound Volume
     as a stepper under the right column.
   - **Ours:** vertically centred at y 358-722
     (`N/title/title_dialogs.ts:43`, alignItems center), 626 wide, with
     an extra "Display" tab (`title_dialogs.ts:700`, deliberate). The
     checkboxes look disabled (grey) and the columns are left-aligned.
     Sound Volume is a dropdown at the bottom left.
3. **Map Find dialog** (find panel 24%, buttons 32%).
   - **Original:** an Aqua alert with the EV Nova icon at top left, text
     indented about 65 px, a 205 px field, a white rounded Cancel button
     and a blue default Find button.
   - **Ours:** a plain white panel with no icon, the text at the left
     edge, a full-width field and grey square buttons
     (`N/spaceport/find_dialog.ts:8-17`).
4. **Star map button row** (16-18%).
   - The original's zoom controls are two round icon buttons (⊖ ⊕).
     Ours are small rectangular pills labelled "-" and "+"
     (`N/spaceport/starmap.ts:155`).
   - Find and Done sit 2-6 px off.
5. **Title-screen pilot block.**
   - The original's date reads "Nov. 27th, 1177 NC" (the map uses the
     same format, "June 23rd, 1177 NC"). Ours reads "Fri, 24 Jun 1177"
     (`N/title/title_screen.ts:444`).
   - The original wraps the ship class onto two lines ("Heavy Shuttle /
     Version A").
   - The original's font is a smaller bitmap face.
6. **Mission info header.** The original has thin grey "Currently active
   missions :" (with a space before the colon). Ours is bold white with
   no space (`N/spaceport/mission_info.ts:69`).
7. **Comm/hail button labels.** Ours are heavier and brighter than the
   original's light face (`N/spaceport/hail_layout.ts`).
8. **Minimap at another window size.** In the 832x604 window the
   original's minimap is a 208x206 box at (414, 151): top at y 151 and
   16 px clear of the status bar (x 638), the same as at 1920x1080
   (top 150, gap 16). But its size is 208, not 480, and the scale is
   still about 1.77 px per map unit.
   - NovaJS hard-codes 480
     (`N/spaceport/mini_map.ts:37-54`).
   - The original shrinks the box with the window, keeping the top and
     the gap. Two data points don't pin the rule.
9. **Harness drift.** 15 harness scenarios time out in `waitForContainer`
   (trade center, mission BBS, bar, the Sigma mission popups) and
   produced no comparison. Their selectors need updating before those
   screens can be compared again.

Untouched so far:
- the shops, trade and BBS screens (blocked by item 9);
- a fullscreen 1920x1080 capture of the original for the screens
  Matthew's set lacks.

### J-series wave 3: how jamming decides a missile's fate (2026-11-23)

**Setup.** The wave-2 rig (`scenarios/jam_fire.json`: hold the secondary
trigger about 25 s, read the 100-armor, 1-damage target's armor %),
plus:
- `scenarios/jam_fire_long.json`: the same with a 32 s watch after the
  trigger is released, for **wëap 382 JamM V100 Long** (wëap 375 with a 30 s
  life) and **383 JamM TurnAway Long** (the same with Seeker 0x0010);
- **distance**: sÿst 2150 Kit Jam Near (target 450 px away) and 2151 Kit
  Jam Far (1800 px), besides Kit Range's 900 px;
- **jammer stacking**: shïp 735 now carries ONE jammer outfit (oütf 626)
  instead of 3×Kit Jammer 25: +100 for `single_*`, +75 for `single75_*`;
- **InhJam**: a J0 target hull of gövt 364 (InhJam1 100), AI 1 for
  `inh_v100`, AI 3 for `inh_v50` and `inh3_v100`;
- **readout**: missiles launched = trigger hold (frame-stamped down/up) ×
  1.944/s (reload 15 at 29.1 Hz; the J0 controls hit 49 of 48.9-49.3);
  hits = 100 - final armor %. `analysis/panel_hits.mjs` times every hit.
- **launch heading**: the player takes off facing a random way. A jammed
  missile that flies straight would still hit if that heading pointed at
  the target, so every run's heading was checked in a crop around the
  player 2.5 s after the trigger. Three wave-3 runs launched within about
  30° of the target line (`v100_j50` at 05:58 and 07:38, `v100_j25` at
  07:40); a straight missile then misses a 900 px target by only a few
  hundred px or less, so those three may undercount. They are kept in the
  totals and called out below.

**Results** (lost = launched - hits; per-run percentages in brackets; wave
2's valid runs folded in where the setup is identical):

| cell | vuln | target jamming | runs | lost / launched | lost |
|---|---|---|---|---|---|
| J0 control (900, 1800 px) | 100 | 0 | 3 | 0 / 147 | 0% |
| v100, 1-4 × Kit Jammer 25, 900 px, 10 s missile | 100 | 25 / 50 / 75 / 100 "stacked" | 13 (w2 4, w3 9) | 145 / 641 | **23%** (8-47; 24% without the three runs launched within about 30° of the target) |
| v100, 4 × 25, long missile, 450 / 900 / 1800 px | 100 | "100" stacked | 6 | 68 / 296 | **23%** (near 25, 23; mid 33, 21; far 20, 15) |
| turn-away (0x0010), 4 × 25, long, 450 / 900 / 1800 px | 100 | "100" stacked | 3 | 46 / 148 | **31%** (34, 26, 33) |
| v50, 2 × 25 or 4 × 25 | 50 | "50" / "100" stacked | 5 (w2 1, w3 4) | 0 / 245 | **0%** |
| v100, ONE +100 jammer | 100 | 100 | 1 | 48 / 49 | **98%** |
| v50, ONE +100 jammer | 50 | 100 | 1 | 49 / 49 | **100%** |
| v50, ONE +75 jammer | 50 | 75 | 2 | 48 / 99 | **48%** (45, 51) |
| v100, ONE +75 jammer | 100 | 75 | 1 | 35 / 49 | **72%** |
| v100 vs InhJam1 100 (AI 1, AI 3 target) | 100 | govt 100 | 2 | 0 / 99 | **0%** |
| v50 vs InhJam1 100 (AI 3 target) | 50 | govt 100 | 1 | 0 / 50 | 0% |

**Findings.**
1. **One decision per missile, made at launch, and permanent.**
   - Jammed plain missiles fly **dead straight along the launch heading**
     and never turn: the 450 px recording shows them leaving on straight
     lines at the ship's heading while the others curve onto the target
     (`near_j100/*055203*`, frame 300).
   - The loss does not grow with flight time: 450 / 900 / 1800 px (2.6,
     5 and 10 s of flight) lose the same share, for plain and turn-away
     missiles alike. A per-frame hazard over the flight would lose about
     4× more at 1800 px than at 450.
   - There are no late hits: with a 30 s missile life, the last hit came
     within the direct flight time of the trigger release in every run
     (one exception in 16 runs: a double hit 11.5 s after release in
     `v100_j50/*055809*`). A jammed missile does not re-acquire.
   - So, of the two wave-2 options, **neither**: P is not a scaled
     vuln × jam, and a plain jammed missile does not re-acquire.
2. **The probability.** With J = the target's jamming and V = the
   missile's JamVuln (same type), every cell fits
       P(jammed) = clamp((J - (100 - V)) / V, 0, 1)
   i.e. a missile resists with 100 - V plus a random share of V, and is
   jammed when J beats that: V 100 gives P = J (25 → 21-23%, 75 → 72%, 100 → 98%);
   V 50 gives 0 for J ≤ 50, 50% at J 75 (48% measured) and
   100% at J 100. A plain product V·J would give 12.5% at V 50 / J 25 (0
   of 245 seen) and 50% at V 50 / J 100 (49 of 49 lost).
3. **Jammer outfits on a hull do not add up.** One, two, three or four
   Kit Jammer 25s (shïp default outfits) all behave like J = 25 (V 100 loses
   about 22% whatever the count; V 50 loses nothing even with four), while
   one +100 outfit jams 98-100%. Whether the game takes the largest outfit
   or ignores the count is not separated.
4. **Turn-away (0x0010)** loses a little more than plain (31% vs 22%, same
   J). Its jammed missiles visibly fly away from the target (wave 2
   `turn_j50`). Partly because a plain jammed missile launched roughly
   toward the target can still hit; more runs would be needed to call the
   difference real.
5. **gövt InhJam1 100 did nothing** against a V 100 missile, for an AI 1
   or AI 3 target of that government (0 of 99 lost), nor against V 50.
   Either InhJam does not apply to a ship's own jamming the way outfits do,
   or it needs something this kit lacks (an armed or moving ship, or the
   0x0080 freighter rule only halving a warship value that the AI 3 should
   have had). Open.

**NovaJS (e8d0e116), and a correction to wave 2's description.**
`N/nova_plugin/combat/jamming_plugin.ts` does NOT drop the lock for good:
`MissileJammingSystem` (line 458) clears `JamSteerComponent` every frame,
and the per-tick roll (`jamLoseLockProbability`, line 299: P spread over
`JAM_LIFETIME_FRACTION` 0.8 of the life) only makes the missile fly
straight for that one frame (`projectile_plugin.ts:294`). So:
- any P < 1 has almost no effect (a 1-frame wobble now and then);
- P = 1 (V 100 against J 100) is a missile that never guides at all;
- outfit jamming is summed (`deriveJamming`, so 4 × 25 = 100) and InhJam
  is folded in by max (`foldInhJam`).

Against the original: our 4 × 25 target would lose 100% (original 22%),
our V 100 / J 25 target almost 0% (original 22-25%), and InhJam would jam
(original: nothing seen).

**Applied in c9fc116c** (`N/nova_plugin/combat/jamming_plugin.ts`):
- Roll once when a guided missile is launched at a target (or acquires
  one), per jamming type k: jammed if J_k > (100 - V_k) + rand·V_k. A
  jammed missile keeps its launch heading for life (turn-away: steers
  directly away; parent/decoy rules as today, but decided at the same
  moment). No re-acquisition.
- J_k from the target's outfits: the largest single outfit's value, not
  the sum (the "count is ignored" alternative fits the data equally).
  (Superseded by "J wave 7": count ignored, different outfits add;
  applied in f20ecec2.)
- InhJam: leave it out of J until it is measured to do something.
  (Superseded by "J wave 7": InhJam counts through the hull's own
  InherentGovt; applied in f20ecec2.)

Confidence: high for findings 1-3 (about 1850 missiles over 38 runs, 32 of them in wave 3; clean
0/100 cells); medium for the exact formula between its anchor points (two
runs at V 50 / J 75, one at V 100 / J 75); low for 4-5. The spread
between identical runs (8-47% in the stacked-25 cell, one 47% outlier)
is wider than binomial noise alone, so single runs mean little.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w3-jam/<cell>/*/`
(each run: `recording.mp4`, `recording.events.json`, the armor shots
`NN-after-*.png`). Cells: `v100_j{0,25,50,100}`, `v50_j{50,100}`,
`{near,mid,far}_j100`, `far_j0`, `t{near,mid,far}_j100`, `single_v{100,50}`,
`single75_v{50,100}`, `inh_v{100,50}`, `inh3_v100`. The three
`far_j100/*-INVALID-rled2000-crash` dirs are the kit crash.

### E-fight: what the escort orders do with hostiles present (2026-11-23, wave 3)

**Setup.** `scenarios/efight_{formation,defend,attack}.json`, pilot
`w3_efight`.
- The player sits idle in Kit Lancer (30000 shield, recharging) at Kit
  Fight Port in sÿst 2153 Kit Fight Range. It never fires (Kit Tickler only).
- Escorts: two hired **Kit Disc Blue Armed** (shïp 764: blue 24 px discs,
  2 Kit Escort Guns, which are wëap guidance 4 "turreted, unguided",
  4000/4000).
- Hostiles: the system's own traffic, düde 612 (red A14 warship discs of
  always-attacks gövt 362, AI 3, a 5-damage turret), avgShips 2. They
  arrived within 6 s and made repeated firing passes at the player in all
  three runs.
- Each run records 95 s. `analysis/hostility.mjs --colour blue|red` gives
  every disc's distance from the player per second (files
  `hostility-{blue,red}.json` in each run).

| order (key, time) | what the escorts did |
|---|---|
| none: Formation (the default) | **Stayed in formation the whole 95 s**, 38-47 px from the player, while two raiders made passes from 300 px down to 8 px. They **fired their turrets from the slot**: frames 700-706 show a new bolt leaving a blue disc toward a red one 200+ px away. Both raiders were gone by 46 s. |
| `d` Defend at 9.5 s | Left formation about 2.5 s later and chased the raiders, out of view for long stretches. Between engagements they came back to their slots (61-71 s, 33 px, while the only red ship on screen sat still 200 px away, probably disabled), and left again when another raider arrived (72 s). |
| `r` then `f` Attack at 9.9 s | Left formation about 2.5 s later after the targeted raider and stayed on it: **both escorts were off screen from 31 to 67 s while a second raider made passes at the player** (closest 3-21 px). Re-targeting with `r` every 20 s did not visibly redirect them. |

**Findings.**
- Formation is not passive: escorts hold their slots but their full
  turrets (guidance 4) shoot at ships attacking the player.
- Defend sends them after attackers and brings them back between fights.
- Attack sends them after the player's target at the time of the order
  and they ignore other attackers meanwhile.

**NovaJS (e8d0e116).** `N/nova_plugin/escorts/escort_command_plugin.ts`:
- `case 'attack'` (line 676) and `case 'defend'` (line 704, hostiles
  within `DEFEND_RADIUS` 1000 px, attack until disabled) match what was
  seen.
- Was a mismatch: the formation branch (lines 786-803) let ONLY
  front-quadrant turrets (guidance 7) fire opportunistically, "not even full
  turrets". The original's guidance-4 turrets fired from formation.
  **Applied in ff0aa775** (`formationTurretKind`): full turrets (guidance 4,
  and turreted beams, guidance 3, by inference) fire at iff-hostile ships
  from the formation slot too.
  Not measured: fixed guns (do escorts turn to use them? the blue discs
  never left their slots) and rear-quadrant turrets.

**Formation recall** (`scenarios/esc_recall2.json`, pilot `w3_recall`,
quiet Kit Range). The player (Kit Lancer) gave `v` (Hold Position),
thrust 2.6 s, braked with Down for 2 s (an inertialess hull does not stop
by itself, see "U9 and the inertialess hulls"), waited 4 s, then `c`
("New escort orders assigned. All ships returning to formation."). The two
blue escorts (Speed/Accel 600, i.e. about 270 px/s top speed) had been
left about 900 px behind:

| time after `c` | escorts' distance from the player |
|---|---|
| 0-4.4 s | off screen |
| 4.5 s | first one on screen at 315 px, both closing at about 270 px/s |
| 5.7 s | 34 px: they **overshoot** the slot, swing out to 123 px at 6.7 s |
| 6.7-10.1 s | close in slowly (about 25 px/s) |
| 10.1 s on | on their slots (29 px, constant) |

So recall is immediate and at full speed; the whole return from about
900 px took about 10 s, a third of it settling after an overshoot. The
first recall run (`esc_recall`, and wave 2's) never got the escorts back
only because the player was still moving at 360 px/s. NovaJS's
`FormationSystem` caps the closing speed so hulls brake onto the slot
(F1 fix); it has no overshoot. Not compared frame by frame.

Confidence: high for Formation vs Defend vs Attack (one run each, but
sustained over 95 s); medium for "turrets fire in formation" (seen in one
stretch of frames; the player had no weapon that could have produced those
bolts); medium for the recall timing (one run).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w3/escorts/fight-{formation,defend,attack}/*/`
and `escorts/recall2/*/` (`hostility-{blue,red}.json` in each).

### A-series wave 3: flee thresholds, retaliation length, the AI 1 control (2026-11-23)

**Setup.**
- **Flee threshold:** an **AI Tank Disc** (shïp 762: the yellow AI Subject
  Disc with 1000 shield and 30000 armor, so it can't be disabled) of AI 2
  (düde 636), AI 3 (638) or AI 3 of gövt 383 "warships retreat below 25%
  shield" (637), at Kit Port. The player (Kit Lancer Heavy, shïp 763:
  30000 shield and armor, no recharge, so each hit shows on the shield bar)
  holds fire with a Kit Escort Gun (30 damage) for 85 s, then watches
  40 s. The target panel is shot every 4 s. `scenarios/ai_tank.json`.
- **Retaliation length:** the wave-2 AI Subject Disc (AI 2 or AI 3), one
  0.6 s tickle with the 1-damage Kit Tickler, then 130 s of watching.
  `scenarios/ai_retal.json`.
- **Idle control:** the AI 1 subject, never fired on. `scenarios/ai_idle.json`.

| subject | result |
|---|---|
| AI 2 tank | Closed in and fought. Its shield read 85, 64, 46, 28, 13% and then "Shields Down" for the rest of the run. It **never fled**: it kept making attack passes (closest 8 px) for the whole 134 s, including the 42 s after the player stopped firing. |
| AI 3 tank | The same: 88, 46, 10%, "Shields Down", and it kept attacking to the end of the run. |
| AI 3 tank, gövt 383 (retreat at 25%), take 1 | Not measured: it moved off at once and the escort gun never reached it (shield 100% in every shot). |
| AI 3 tank, gövt 383, take 2 (player also has the long-reach Kit Tickler, so the tank is provoked into range), run 1 | Closed in and fought: shield 81, 62, 47, **25%** (23.4 s, still making passes at 101 px), **9%** (27.6 s). By 28 s it was heading away (247 px), off screen from 30 s, and **gone from the system** ("No Target") by 44.5 s. It never came back. |
| the same, runs 2-4 | Shields went the same way (run 2: 34% at 23.8 s, 18% at 28.2 s; run 3: 25%, 6%; run 4: 28%, 9%), then "Shields Down", and in **all three it kept attacking for the whole run** (passes down to 12-23 px until 134 s), exactly like the AI 3 control. |
| AI 3 subject, one tickle | Attacked from about 6 s after the tickle (the shield bar starts dropping) and **kept attacking for the rest of the run: 130 s after one 1-damage shot**. |
| AI 2 subject, one tickle | The same, 130 s. |
| AI 1 subject, never fired on | It left without ever coming on screen: targeted until 30.4 s into the recording, "No Target" from 37.1 s, i.e. about 35-40 s after it appeared. Wave 2's tickled AI 1 was gone about 15 s after its tickle (about 24 s into its recording), so leaving is what AI 1 does anyway; being shot at most hurries it a little. |

**Findings.**
- A neutral AI 2 or AI 3 ship that is provoked once keeps attacking for at
  least two minutes after the player stops: no forgiveness within the
  window measured.
- Without the gövt 0x0010 flag, neither AI 2 nor AI 3 runs away at any
  shield level, even with shields gone. With it, **one run in four** broke
  off within about 4 s of passing 25% shield and left the system about
  15 s later (as the Bible says); the other three fought on with shields
  down for two minutes. So in this setup the flag mostly does nothing: it
  may be a per-decision chance, may need something the kit lacks (a
  friendly planet to retreat to, an armed escort, a lower armor fraction),
  or the one run left for another reason. The Bible's AI 2 "runs away when
  his attacker is out of range" was not exercised (the player never left).

**NovaJS (e8d0e116).** `N/nova_plugin/npc/npc_decision.ts`:
- AI 2 (line 409) fights while `oddsFavorable(maxOdds, ...)` holds, else
  flees. With MaxOdds 1000 the odds held here, so no mismatch is shown.
- AI 3 retreats only with `warshipsRetreatAt25` (line 479), always and
  at once when shield < 25%. Consistent with the control, but **likely a
  mismatch** for the flag: the original retreated in 1 of 4 runs. Not
  changed until the trigger is understood.
- `npc.aggressor` is only forgotten when the aggressor despawns, is in the
  ship's own flock, or bribes (lines 242-306), so retaliation is
  permanent: **consistent** with "at least 130 s".
- AI 1 traders roll a departure 120-300 s after spawning
  (`NPC_DEPART_MIN_MS`/`MAX`, lines 74-75) and dwell at planets. The
  original's AI 1 subject was gone in 35-40 s. Likely a mismatch in how
  long traders linger (catalogue A11), but this was one ship that may
  simply have landed; one run.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w3/ai/{tank-ai2,tank-ai3,tank-ai3r,tank-ai3r-b,retal-ai2,retal-ai3,idle-ai1}/*/`
(`hostility-yellow.json` timelines; the tank panels are in the `NN-fire-*` shots).

### F1n: NPC fleet formations (2026-11-23, wave 3)

**Why wave 2 saw no fleet.** sÿst DudeTypes place a fleet as **-128 to
-383** (the Bible's sÿst table), so a flët must have an id in 128-383.
Wave 2's flët 1000 was out of range and could never be placed. The kit now
has flët 300 (same contents: white 720 lead, one each of red/green/blue/
yellow 721-724, govt 363) and Kit Fleet Range lists it as -300 (100%,
avgShips 6).

**Run.** `scenarios/f1n_observe.json`, pilot `w2_f1n` (Probe A sitting at
Kit Fleet Port). **Two whole fleets flew past** within the first 20 s, and
fleets were on screen for most of the 80 s.
`analysis/fleet_groups.mjs` (new: assigns every escort disc to the nearest
white lead, so several fleets can be on screen) measured 129-154 samples
per colour with the lead moving at about 3.1 px per video frame:

| escort | along | across | distance | side |
|---|---|---|---|---|
| red | -22.9 | +25.0 | 32.8 | left 152 / right 2 |
| green | -24.5 | -22.9 | 32.1 | right 149 / left 1 |
| blue | -46.1 | +49.0 | 67.0 | left 141 / right 1 |
| yellow | -49.0 | -46.4 | 67.6 | right 128 / left 1 |

**Finding.** NPC fleet escorts fly the **same 45° V as player escorts**:
rank 1 at (-a, +a), rank 2 at (-a, -a), rank 3 at (-2a, +2a), rank 4 at
(-2a, -2a) with a = 23.5 for 24 px frames, i.e. the F1b formula
a = clamp(0.59·S, 23.5, 59.5). The ranks follow the order of the flët's
four escort fields (red, green, blue, yellow) in both fleets.

**NovaJS:** `N/nova_plugin/npc/npc_formation.ts:44` (`formationSpacing`)
and `:183` (`formationOffset`) already apply the F1b rule to fleet escorts
("NPC fleet (flët) escorts are untested. They use the same rule"): now
confirmed, **matches**. Untested: fleets with mixed sprite sizes, and
whether the rank order follows escort type or spawn order when types repeat.

Confidence: high (two fleets, hundreds of samples, ±2 px).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w3/f1n/observe/*/`
(`recording.mp4`, `fleet_groups.json`).

### M2 leftover: no minimap during a real jump (2026-11-23, wave 3)

`scenarios/map_jump.json`, pilot `w2_map`: at Map Hub, the big map, Tab to
Map SW (single jump), close the map, fly out 2 s, `j`. The jump completed
("Arriving in the Map SW system on June 24th, 1177 NC.", with the full
month name). A tile of every 10th frame of the minimap's area (window
x 400-640, y 140-380) from map close to the end of the recording, through
the whole jump, shows **no minimap at any point**: no system names, dots or
links. So the 2.2 s minimap peek is only triggered by `h` and clicks
(wave 2), not by jumping. The 1920x1080 reference capture with the minimap
over "Jumping into the Tau Ceti system" must have had `h` pressed by hand.
NovaJS's persistent toggle is already listed as a mismatch (M-batch item 2);
nothing new to change for jumps. Confidence: high.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w3/map/jump/*/`.

### U9 and the inertialess hulls (2026-11-23, wave 3, partial)

**Correction to wave 2.** An inertialess hull (shïp Flags2 0x0040) does
**not** stop when thrust is released: it keeps its speed and heading.
Wave 2's U5 note ("the Crawler's starfield is static from the first frame
after release") was wrong. Seen twice in wave 3:
- `esc_recall`: Kit Lancer released thrust at frame 341, and a moon kept
  sweeping across the screen at full speed for the next 2 s;
- `u9_dist`: Kit Crawler 200 released at frame 287, and Kit Port kept
  moving down the screen afterwards.

NovaJS's inertialess physics keep `targetSpeed` when no thrust is applied
and brake only on reverse (`nova_ecs/src/plugins/movement_plugin.ts:159`
and `N/nova_plugin/travel/ship_controller_plugin.ts:53-58`): **matches**.

Because of this the first U9 runs were spoiled. Down **does** brake an
inertialess hull to a stop (take 2 runs below), so the take-2 scenarios
brake after every thrust.

- **Landing distance gate** (`u9_dist2`, Kit Crawler 200, Kit Port: a
  planet sprite 140 px wide with its ring). After `l` (request), the ship
  flew out, braked, and stepped back about 40 px at a time, stopping and
  pressing `l` each time. Planet-centre distances from the frame before each
  `l` (`analysis/blob_offset.mjs`, bbox centre; the clipped bboxes
  corrected for the 140 px width):

  | `l` at | distance | answer |
  |---|---|---|
  | after flying out | 331 px | "You're too far away to land on this planet." |
  | step 0 | about 319 px | too far |
  | step 1 | about 277 px | "Kit Port traffic control reads you. Begin initial approach." (no landing) |
  | (step 2 stop, before `l`) | 235 px | **"u9c200, you're cleared to land. Welcome to Kit Port."** appeared by itself 7 frames before the `l` |
  | step 2 `l` | 235 px | **landed** (spaceport 5 frames later) |

  (Wave 4 re-measured this and ten other planets, and the speed gate:
  see "U9 wave 4". The 277 px answer was a fresh landing request, not a
  range verdict.)
  So the landing range of this planet is **between about 235 and 277 px
  from its centre**, and once a request is pending the game announces
  "cleared to land" by itself on entering that range. NovaJS lands within
  **100 px** (`N/nova_plugin/travel/planet_plugin.ts:161`
  `LAND_DISTANCE_SQUARED = 10_000`): a **mismatch**, about 2.5× too
  strict for this sprite. Whether the original's range scales with the
  planet's sprite size is untested (one planet).
- **Landing while moving** (`u9_pass`, no braking): Crawler 200 (87 px/s)
  landed at the first `l` after thrust started, about 5 frames in, still
  on top of the planet; Crawler 100 (44 px/s) did not land on any of 25
  presses from the same start ("too far" from the third). The starts
  differ, so this says nothing about a speed gate yet. **Inconclusive.**
  NovaJS requires < 54.8 px/s (`LAND_SPEED_SQUARED = 3_000`, line 162).
- **Boarding** (`u9_board` without braking, `u9_board2` with). The Kit
  Prize (armor 300) was disabled by 8 hits of the Kit Escort Gun.
  - Drifting past at full speed (87 px/s): every `b` answered **"You're
    moving too fast to board this ship."**
  - Stopped, stepping in: "You're not close enough to board this ship."
    down to about 46-80 px (the prize's own sprite was located in only one
    shot, so these distances are rough).
  - The next `b`, at roughly 36 px, answered **"You can't board this
    ship."**, and so did every later `b` even 300 px away. That generic
    refusal (STR# 2002 index 129) seems to stick once given. A likely cause
    is that the prize is a mïsn special ship (ShipGoal -1), which may not
    be boardable at all; wave 2's mission derelict gave no answer either.
  - All three strings match NovaJS's
    (`N/display/status_bar_content.ts:285-302`). NovaJS boards within
    150 px (`N/nova_plugin/ship/boarding_component.ts:227`), the original
    said "not close enough" at about 46 px: likely a **mismatch**, low
    confidence until a non-mission disabled ship is used.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w3/u9/{dist-c200,dist2-c200,pass-c200,pass-c100,board,board2}/*/`
and `escorts/recall/*/` (the first recall run is invalid for the same
reason: the player never stopped, so the escorts at 270 px/s could not
catch a 360 px/s ship; that is also why wave 2's escorts were "still off
screen 8 s after `c`").

### M5 leftover: which systems radiate borders (2026-11-23, wave 3)

**Setup.** Three unlinked systems of Map Major Blue (gövt 380), 100 map
units apart (`kits/testkit.mjs` wave 3, sÿst 2154-2156), with pilot
`w3_map` (2155 and 2156 explored, 2154 not). `scenarios/map_borders2.json`
opens the map, shows borders and zooms out once so they are in view.

| system | explored | stellar | dot | border |
|---|---|---|---|---|
| 2154 Map B Inhab | no | landable, inhabited (flags 0x43) | **not drawn at all** (unexplored and unlinked) | **none** |
| 2155 Map B Empty | yes | none | light grey ring (#c6c6c6) | **none** |
| 2156 Map B Unland | yes | inhabited but NOT landable (flags 0x02: no 0x01, no 0x20) | light grey ring (#c6c6c6) | **radiates** (full blue disc) |

**Finding.** A system radiates territory when it is explored and has an
INHABITED stellar (spöb flag 0x0020 clear), **whether or not it can be
landed on**; a system without a stellar radiates nothing. The dot, though,
is grey for the unlandable one: the dot asks "is there a port?", the
border asks "is it inhabited?".

**NovaJS:** `N/spaceport/starmap_borders.ts:9-31` radiates from "explored,
INHABITED systems — systems with a port" (landable AND not 0x0020), and
`N/spaceport/starmap_draw.ts:136-138` notes the inhabited-but-unlandable
corner as unwitnessed. The dot rule matched; the border rule was a
mismatch for that corner (the four stock Wraith systems sÿst
510/521/582/593). **Applied in 6d202ebc** (`N/core/landable.ts`
`systemHasInhabitedStellar`): territory sites = explored systems with at
least one stellar whose 0x0020 is clear; `isPort` still picks the dot
colour.

Confidence: high for the three cells (one clean screenshot each).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w3/map/borders2/*/02-zoom-out-1.png`
(and `map/borders/*/` for the unzoomed first try).

### Date strings: where "Nov. 27th" and "June 23rd" come from (2026-11-23, wave 3)

**Source.** Not the OS (no itl lookup) and not the scenario data: the
month names live in the **application's own resource file**,
`/Applications/EV Nova.app/Contents/Resources/Nova-DF.rsrc` (a data-fork
resource file), as **STR# 137 "Date/Numbers"** (209 bytes). Read-only:
`grep -a` over the app bundle found the strings only in that file, and the
repo's resource parser listed the STR#. The executable (`Ev Nova.original`,
`libNova.A.dylib`) has no month strings, and the stock `Nova Files` were
not searched (the strings were already located).

STR# 137, exactly as stored (1-based index):

| # | string | # | string |
|---|---|---|---|
| 1 | `January` | 13 | `Jan.` |
| 2 | `February` | 14 | `Feb.` |
| 3 | `March` | 15 | `Mar.` |
| 4 | `April` | 16 | `Apr.` |
| 5 | `May` | 17 | `May` |
| 6 | `June` | 18 | `June` |
| 7 | `July` | 19 | `July` |
| 8 | `August` | 20 | `Aug.` |
| 9 | `September` | 21 | `Sept.` |
| 10 | `October` | 22 | `Oct.` |
| 11 | `November` | 23 | `Nov.` |
| 12 | `December` | 24 | `Dec.` |

Then 25-28 are the ordinal suffixes `st`, `nd`, `rd`, `th`, and 29-38 the
words `one` ... `ten`.

So the short form is AP style: May, June and July are never shortened,
and September is `Sept.`. The title screen's "Nov. 27th, 1177 NC" uses
entries 13-24, and the map's "June 23rd, 1177 NC" is consistent with
either set (June is the same in both). Which screens use which set
beyond these two captures is not checked.

**NovaJS.** `N/display/status_bar_content.ts:138-141` (`FULL_MONTH_NAMES`)
matches entries 1-12, and `ordinal` there gives the same suffixes. There
is no short table: the title screen prints "Fri, 24 Jun 1177"
(`N/title/title_screen.ts:444`, R8 item 5). **Proposed (not applied):**
add the 12 short names above and use them for the title-screen pilot
block.

Evidence: `~/.local/share/novaref/evidence/20261123-w3-dates/`
(`Nova-DF.rsrc` copy and the dump).

### U9 wave 4: landing range by planet size, and the landing speed gate (2026-11-23)

**Kit.** sÿst 2160-2169 "Kit Land NN", each with one landable stellar at
(0,0) cloned from a stock spöb, so only its graphic differs (spöb Type ->
spïn 1000+Type -> sprite frame size). The player is an inertialess Kit
Crawler 100 (44 px/s). `analysis/planet_track.mjs` measures the planet's
centre in every frame (clipped sprites are centred from their free edge)
and reads the status-line message after every `l`.

**Two methods.**
- **At rest** (`scenarios/land_step.json`): fly out about 700 px, turn, then
  34 steps of 0.5 s thrust (about 24-27 px), Down to stop, `l` at rest. The
  first stop that lands is inside the range, the stop before it outside.
  This is the landing range proper.
- **Moving** (`land_range.json`, `land_range_far.json`): fly straight
  through the planet at a constant 44 px/s pressing `l` every 160 ms (one
  keys step, no gaps). It never lands (see the speed gate), but the
  answer flips from "You're too far away to land on this planet." to
  "You're moving too fast to land on this planet." and back.

| planet (sprite frame) | at rest: too far / landed | moving, approaching: too far / too fast | moving, receding: too fast / too far |
|---|---|---|---|
| Type 3, 40x40 | 99 / **72** | 87 / 77 | 74 / 84 |
| Type 6, 72x72 | 131 / **103** | (in a gap) | 160 / 170 |
| Type 16, 80x80 | 178 / **150** | | |
| Type 24, 88x88 | 210 / **182** | | |
| Type 9, 96x96 | 238 / **211** | | |
| Type 10, 112x112 | 233 / **205** | | |
| Type 0, 150x150 (Kit Port) | wave 3: 277 / **235** | 259 / 250 | 262 / 272 |
| Type 25, 250x250 | 255 / **229** | 254 / 244 | 450 / 460 |
| Type 18, 304x134 | | 249 / 239 | 524 / 534 |
| Type 39, 315x200 (station art) | 308 / **280** | | |
| Type 5, 325x325 (Jupiter) | 275 / **247** | 333 / 323 | still "too fast" at 700 |

Distances are px from the planet's centre, measured in the frame the game
read the key (4.5 frames after the stamp; at rest it doesn't matter).
Planet centres are good to about 5 px.

**Findings.**
1. **The landing range is far larger than NovaJS's 100 px.** Up to about
   110 px sprites it grows with the sprite at roughly **twice the frame
   size** (40 -> 72-99, 72 -> 103-131, 80 -> 150-178, 88 -> 182-210,
   96 -> 211-238, 112 -> 205-233: midpoints 1.6-2.3 S, mean about 2.0 S).
   From there it levels off at **about 230-260 px** (150, 250 and the
   304x134 art), a little more for the biggest art (325 -> 247-275,
   315x200 station -> 280-308). Most stock planets are 72-150 px, so most
   are in the 2 S part.
   - Candidate formula: **R ≈ min(2 S, 240)**, S = sprite frame size. It
     falls inside the measured bracket for 40, 80, 112, 150, 250 and
     304x134; it is 6-19 px short for 88 and 96, 13 px long for 72, and
     about 10-40 px short for the 315 and 325 px art. No smooth function
     of S hits every bracket (72 is low, 88-96 high), so either the frame
     size is not the input (the visible art differs per planet) or the
     brackets carry a ±15 px error from single runs.
2. **The speed gate is about 20 px/s, absolute** (`scenarios/land_brake.json`,
   `land_brake200.json`). Kit Crawler Slowbrake (Speed 100, Accel 60) and
   Slowbrake 200 (Speed 200, Accel 120) fly back into Kit Port's range and
   brake with Down while pressing `l`; the deceleration was measured
   (11.8 px/s² for Accel 60, about 0.197·Accel). The first press that
   landed was read at 19.0 px/s (Speed-100 hull; the press before it,
   21.7 px/s, said "too fast") and at 15.7 px/s (Speed-200 hull; 20.5 px/s
   before it). So the gate is **between about 19 and 20.5 px/s** for both
   hulls: not a share of the hull's top speed (that would be 22 vs 44 px/s).
   An inertialess hull at full speed never lands, even 44 px/s; wave 3's
   Crawler 200 "landing while moving" was 5 frames into its thrust, still
   slow.
3. **"Too fast" is answered first** whenever the ship is in the zone, so
   moving through a planet gives too far / too fast / too far.
4. **A receding ship stays "in" much longer** around the big planets: the
   too fast -> too far flip on the way out came at 450-530 px (250,
   304x134) and beyond 700 px (325), while the way in flipped at 240-330.
   Small planets (40, 150) were symmetric. And for the 325 px planet the
   moving zone (323-333 on the way in) is larger than the at-rest landing
   range (247-275). So the zone in which the game says "too fast" is not
   simply the landing circle; it can only matter for messages, since no
   ship that fast can land. Not explained.
5. Messages: the first `l` is answered with one of several traffic-control
   lines, e.g. "Landing request received, <ship>. Begin initial
   approach.", "<port> traffic control reads you, <ship>. Begin initial
   approach.", "Cleared to land, <ship>. Welcome to <port>." or "You are
   cleared to land. Commence final approach." (the last two when already
   in range).

**NovaJS (9ec7a496).** `N/nova_plugin/travel/planet_plugin.ts:161-162`:
`LAND_DISTANCE_SQUARED = 10_000` (100 px for every planet) and
`LAND_SPEED_SQUARED = 3_000` (54.8 px/s), checked in that order at lines
269-273 (too far, then too fast). The order matches finding 3. Both
numbers are off: the range is about 2.3x too small for a typical planet
(and too large for a 40 px moon), the speed gate about 2.7x too lenient.

**Applied in "Landing range scales with the stellar's sprite; 20 px/s
speed gate" (wave-4 fixes).**
- `LAND_SPEED_SQUARED = 400` (20 px/s).
- Landing range from the stellar's sprite frame size S (the larger of
  width and height): **R = max(min(2 S, 240), 0.8 S) px**
  (`planet_plugin.ts` `landingRange`), so the 315-325 px art gets 252-260.
  S is the new `PlanetData.spriteFrameSize`, the rlëD frame size the
  parser reads through spöb Type -> spïn 1000+Type (the spïn's xSize/ySize
  if the rlëD is missing). PlanetData is staged on every peer, so the range
  is the same everywhere. A stellar with no data, or game-data JSON without
  the field, keeps the old 100 px (S = 50).
- Superseded by "U9 wave 6": the zone is a square from the frame width,
  applied in bd344b9f.
- Keep "too far" before "too fast". The receding-ship extension (finding 4)
  is message-only and is left out.
- The touch autopilot (`N/autopilot.ts`) now aims at 90% of the stellar's
  range and half the speed² gate, with a proportional inertial burn so it
  can brake below 20 px/s.
- Not measured, but the formula applies: the small stock stations get
  small ranges (17x31 -> 62 px, 15x21 -> 42 px).
- `N/nova_plugin/escorts/player_escort_plugin.ts:196-197` (escort landing,
  300 px / 100 px/s) is a separate NovaJS-only tuning, not measured here,
  and is unchanged.

Confidence: high for the speed gate (two hulls, the same answer) and for
the at-rest ranges (each a clean too far / landed pair 26-28 px apart);
one run per planet, so a planet's exact range is good to about ±15 px.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w4/u9/`:
`step-*/` (at rest), `land-*/` (moving), `brake-150/`, `brake-200/`. Each
run holds `recording.mp4`, `recording.events.json`, `track.json` (per-frame
planet centre), `track_summary.json` (every press: distance, speed and
message id) and `msgs/` (one crop per distinct message).

### Asteroids and seeker flags, with and without jamming (2026-11-23, wave 4)

**Setup** (`kits/testkit.mjs` `wave4Rocks`; retired for it: wëap 378 JamM
Parent and 380 JamM Plain, düde 607/608 with mïsn 967/968). The wave-2/3
rig (`scenarios/jam_fire.json`: the player sits at the port, targets a
100-armor 1-damage target on the marker 900 px east and holds the
secondary trigger about 25 s, about 49 missiles; hits = 100 - armor %).
Missiles: Speed 600, GuidedTurn 60, 10 s life, proximity 25 px.
- sÿst 2132 Kit Rock Range (16 asteroids) and the new 2170 Kit Rock Range
  4 (4 asteroids); the rocks drift fast, so where they are changes from
  second to second.
- Targets: J0 (no jammer), S50 / S100 (ONE +50 / +100 type-1 jammer).
- wëap 379 JamM Decoy (Seeker 0x0002, JamVuln 0: never jammed), 378 JamM
  Decoy V100 (0x0002, JamVuln1 100), 375 JamM V100 (no seeker flags), 380
  JamM Pass V100 (0x0001, JamVuln1 100).
- Paths: the per-pixel maximum of the play area over a few seconds of
  the recording (README "Analysis helpers"): rocks leave wide streaks,
  missiles thin purple trails, a hit a pink puff. Evidence `trail-*.png`.

| cell | missile | target | rocks | hits / launched per run | lost |
|---|---|---|---|---|---|
| (a) decoy16 | 0x0002, V 0 | J0 | 16 | 14/48.7, 15/49.0, 22/48.8 | **65%** (71, 69, 55) |
| (a) decoy4 | 0x0002, V 0 | J0 | 4 | 46/49.6, 24/49.3, 29/48.7 | **33%** (7, 51, 40) |
| (b) decoyS50 | 0x0002, V 100 | S50 | 16 | 7/48.7, 14/49.7, 8/49.1 | **80%** (86, 72, 84) |
| (b) decoyS100 | 0x0002, V 100 | S100 | 16 | 0/48.9, 0/48.9, 0/49.5 | **100%** |
| (c) plainS100 | none, V 100 | S100 | 16 | 0/49.2, 0/48.5, 0/52.3 | **100%** |
| (d) passS100 | 0x0001, V 100 | S100 | 16 | 2/50.2, 1/49.4, 0/49.0 | **98%** |

Wave 2, same field, no jamming: plain V 0 lost 31% (rocks in the way),
0x0002 V 0 41%, 0x0001 V 0 0%.

**Findings.**
1. **(a) The 0x0002 decoy works with no jamming at all** (JamVuln 0,
   unjammed target): 65% of the missiles were lost in the 16-rock field
   (wave 2: 41%; a plain missile there loses about 31% to rocks in its way)
   and 33% with 4 rocks. It depends on how many rocks are
   near the missiles' paths, not on a fixed share: the 4-rock runs went
   from 7% (no rock near the line of fire) to 51% (rocks kept crossing
   it).
   - **When:** at any time in flight, not only at launch. Trails show
     missiles leaving the ship toward a rock that is near the launch point
     (about 200-260 px away), and missiles already on their way to the
     target turning sharply (up to 90°) onto a rock that drifted within
     about 150-250 px of them.
   - **Once on a rock it stays on it**: no trail was seen leaving a rock
     for the target again; each ends in a puff on the rock.
   - The exact capture range could not be pinned to better than "about
     200-260 px" from these pictures (fast-moving rocks, many missiles).
2. **(b) Jammed 0x0002 missiles go for the rocks** instead of flying
   straight: against S100 (every V100 missile jammed) 100% were lost in all three runs; their
   trails curve onto a nearby rock and end in puffs. The hit count can't
   split "went to a rock" from "flew off" (both miss the target); in the
   4 s trail of decoyS100 run 1 every trail ended on a rock, while the
   plain jammed missiles of (c) all flew straight. Against S50 (half of
   them jammed) 80% were lost, i.e. about the jammed half plus about the same
   share of the unjammed half that the no-jamming decoy lost.
3. **(c) A plain jammed missile just flies straight** along its launch
   heading (as in wave 3) and only hits a rock that happens to be on that
   line: 100% lost in all three runs, the trails straight lines off the
   screen with an occasional puff where a rock crossed them.
4. **(d) 0x0001 still passes over rocks when jammed**: the jammed missiles
   fly straight through the field with no puffs; 98% lost (the few hits came
   from launches that happened to point at the target).

**NovaJS (main c9fc116c).**
- `N/nova_plugin/combat/jamming_plugin.ts:303-318` (`decideJamReaction`)
  decoys a missile **only if it is jammed**, and then only with
  `DECOY_RETARGET_PROBABILITY` = 0.1 (line 84), onto the nearest decoy
  within `DECOY_DISTRACTION_RANGE` = 1000 px (line 134; `retargetDecoy`,
  lines 490-496). Asteroids carry `DecoyTargetComponent`
  (`asteroid_plugin.ts:372`).
- **Mismatch (a):** the original decoys unjammed 0x0002 missiles too, and
  heavily (30-70% lost in a dense field). NovaJS never does.
- **Mismatch (b):** a jammed 0x0002 missile in the original goes to a rock
  (nearly all of them when one is around); NovaJS sends only 10% to a
  decoy and flies the rest straight.
- **Matches (c)** (jammed plain missiles fly straight, `projectile_plugin.ts:429-432`
  lets guided missiles hit asteroids) and **(d)** (0x0001 passes over
  asteroids, same lines), and the decision being made once for the jam.
- **Applied in 51e4d911** (`N/nova_plugin/combat/jamming_plugin.ts`, rules
  3 and 4 of the model at the top): 0x0002 is its own per-tick check,
  independent of jamming. The first tick an asteroid is within
  `ASTEROID_DECOY_CAPTURE_RANGE` = 225 px of a guided 0x0002 missile whose
  target is not an asteroid (tracked or jammed off), the missile retargets
  onto the nearest such rock (uuid tie-break) for good. It runs right after
  the jam decision, so a rock near the launch point captures on the launch
  tick. A jammed 0x0002 missile goes for the nearest rock within
  `DECOY_DISTRACTION_RANGE` (1000 px, kept as "the field") at its jam
  decision, and with none flies straight (or veers for 0x0010) and keeps
  the 225 px check. The 10% `DECOY_RETARGET_PROBABILITY` is gone; the
  parent (0x8000) roll is unchanged. The capture range and whether it is
  a certainty or a per-tick chance still need a finer experiment (one
  missile at a time, a single slow rock); certainty is what is applied.

Confidence: high that the decoy works without jamming and that jammed
decoy missiles go to rocks (three runs per cell, clean trails); medium for
the capture range; the per-cell shares vary a lot with where the rocks
happen to be.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w4/rocks/{decoy16,decoy4,decoyS50,decoyS100,plainS100,passS100}/*/`
(`panel.png` armor before/after, `trail-2s.png`, `trail-mid.png`,
`recording.mp4`, `recording.events.json`). `decoy16/*102227*` is a launch
that died while loading (retried as `*-retry1`).

### E-fight wave 4: fixed-gun and rear-turret escorts in Formation (2026-11-23)

**Setup.** `scenarios/efight_formation.json` as in wave 3 (Kit Fight
Range, two always-attacks raiders making passes, the player idle), with
the two hired escorts swapped for blue discs carrying two **fixed guns**
(shïp 769, wëap 368 = the Kit Escort Gun with guidance -1; pilot
`w4_efix`) or two **rear-quadrant turrets** (shïp 770, wëap 369, guidance
8; pilot `w4_erear`). Both weapons retire the #316 Speed Guns. One run
each, 100 s, `analysis/hostility.mjs --colour blue|red`.

| escorts | distance from the player, every second | raiders |
|---|---|---|
| fixed guns | 39-47 px for all 100 s (the formation slots) | 2 raiders passing at 10-240 px the whole time; the escorts' shields flashed with hits |
| rear turrets | 36-39 px for all 100 s | the same, 8-247 px |

**Findings.** Escorts on Formation whose only weapons are fixed guns or
rear-quadrant turrets **never leave their slots to fight**, not even while
being hit. Whether they fire from the slot (a fixed gun when a raider
crosses the bow, a rear turret at one behind) could not be told from the
recording: bolts near the escorts can't be told from the raiders' turret
fire, and the raiders' shields were not read. A follow-up scenario that
reads the raiders' shields with `r` (`scenarios/efight_panel.json`) is
written but was not run.

**NovaJS (main, ff0aa775):** `formationTurretKind` lets only full turrets
(guidance 4, beam turrets 3) and front-quadrant turrets (7) fire from the
slot; fixed guns and rear-quadrant turrets hold fire, and "nothing pulls
the escort off its slot". **Matches** on staying in the slot; the
rear-turret firing question stays open. Confidence: high for the slots
(two runs, 100 s each), none for firing.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w4/escorts/{efix,erear}/*/`
(`hostility-{blue,red}.json`).

### J-series wave 4: jamming types 2-4 and gövt InhJam (2026-11-23)

**Kit** (`kits/testkit.mjs` `jamWave4`; retired for it: wëap 362-364, the
#316b Kit Missiles; düde 603-606 and 610 with mïsn 962, 963, 965, 966,
970). wëap 362/363/364 are the wave-3 missile (JamM V100) with JamVuln 100
in type 2, 3 or 4 instead of type 1. Each target is the immobile 100-armor
J0 hull carrying ONE +100 jammer outfit of the matching type (oütf 627-629,
ModType 34-36), at Kit Market (900 px). Same rig as wave 3
(`scenarios/jam_fire.json`): about 25 s of trigger, about 49 missiles.

| cell | missile | target | hits / launched | lost |
|---|---|---|---|---|
| jt2 | V100 type 2 | +100 type 2 | 0 / 49 | **100%** |
| jt3 | V100 type 3 | +100 type 3 | 0 / 49 | **100%** |
| jt4 | V100 type 4 | +100 type 4 | 1 / 50 | **98%** |
| jt2_vs_t1 | V100 type 2 | 4 x Kit Jammer 25, type 1 (J100) | 49 / 49 | **0%** |
| inh_ai2 | V100 type 1 | J0 hull of gövt 364 (InhJam1 100), AI 2 | 49 / 49 | 0% |
| inh_ai4 | V100 type 1 | the same, AI 4 | 49 / 49 | 0% |

**Findings.**
- Types 2-4 work exactly like type 1: V 100 against a +100 jammer of the
  same type is jammed every time (wave 3's type 1: 98%). A missile is only
  jammed by its own types: a type-2-only missile ignores type-1 jamming.
- **gövt InhJam1 100 does nothing** against a type-1 V 100 missile for a
  target of any AI type: AI 1 and AI 3 in wave 3, AI 2 and AI 4 here (0 of
  about 250 missiles lost in all). What InhJam does is still unknown; the
  brief's "player's govt side" was not tested (the player has no gövt, and
  no kit setup gives one).

**NovaJS (c9fc116c, now on main):** the per-type roll
(`jamTypeRollJams`, `rollMissileJammed`: a missile is jammed if any type
jams it, V 0 never jams) and InhJam left out of J (`deriveJamming`) **match**
all six cells. Confidence: high (clean 0/100% cells, single runs).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w4/jam/{jt2,jt3,jt4,jt2_vs_t1,inh_ai2,inh_ai4}/*/`
(target panel shots `04-target`, `09-fire-20s`, `10-/11-after-*`).

### A-series wave 4: AI 1 departure, gövt 0x0010 retreat (2026-11-23)

**How a ship leaves.** `analysis/radar_blips.mjs --tracks` follows every
moving radar dot (about 31.6 world px per radar px in Kit Range). A ship
that lands vanishes on a stellar's dot; every departure seen in waves 3 and
4 instead **accelerated hard** (from 1-4 to 30-36 radar px/s, i.e. about
1000-1150 px/s) and vanished 1250-2600 px from the nearest stellar: a
hyperspace exit, although Kit Range has no hyperlinks.

**AI 1 unprovoked departure** (`scenarios/ai_idle_long.json`, pilot
`w4_ai1x4`: mïsn 991 puts FOUR AI 1 AI Subject Discs at Kit Port; the
player never fires; 200 s recorded). Two runs, eight ships:

| run | what the radar shows | gone (recording time) | after takeoff |
|---|---|---|---|
| 1 | All four fly straight north past Kit Marker 2, one sits about 1250 px out for 6 s, then each accelerates and vanishes 2400-2500 px north of Kit Port | last blip 30.3 s (targeted one "No Target" by 36.9 s) | about 34 s |
| 2 | The same path, north | last blip 29.8 s | about 34 s |
| wave 3 | one AI 1 subject | "No Target" at 37.1 s | 35-40 s |

So an AI 1 trader that has nothing to do here (no mission, no reason to
land) **leaves by jumping out about 30-40 s after it appears**, without
landing at Kit Port or Kit Market. Nine of nine ships, very consistent.
All were mïsn special ships (ShipGoal -1, ShipBehav -1); ordinary sÿst
traffic was not tested and may visit planets first.

**NovaJS (9ec7a496):** `N/nova_plugin/npc/npc_decision.ts:74-75` rolls a
departure 120-300 s after spawning and AI 1/2 traders loop planet to
planet in between, "dwell" standing in for a landing (lines 440-470). For
mission ships like these the original leaves 3-9x sooner and never
dwells. **Applied in 902bff7c:** special ships with no goal
(ShipGoal -1), ShipBehav -1 and AI 1 (not aux ships) are marked
`passingThrough` at spawn; their first think rolls the departure 30-40 s
out (`PASS_THROUGH_DEPART_MIN_MS`/`MAX`, the same single PRNG draw) and
they go to 'depart' the moment it is due, without finishing a trip or
dwell first. Until then they fly the trader loop. Note the window is the
departure DECISION: the outbound flight and jump sequence follow it, so
they vanish some seconds later than the original's 30-40 s. The dwell
loop is kept for sÿst traffic until that is measured.
Confidence: high for these mission ships; untested for traffic.

**gövt 0x0010 retreat** (`scenarios/ai_tank.json`, `ai_tank_esc.json`). Wave
3's four runs (one Kit Escort Gun against the 1000-shield / 30000-armor
AI Tank Disc of gövt 383) plus wave 4's variations:

| run | damage | what the tank did after its shield fell below 25% |
|---|---|---|
| w3 run 1 | 1 gun | broke off within 4 s, **jumped out** 17 s after crossing 25% |
| w3 runs 2-4 | 1 gun | kept making attack passes (12-23 px) to the end, shields down |
| w4 armor 1 and 2 (AI Subject Disc of gövt 383: 1000 shield, **1000 armor**) | 1 gun | kept fighting (passes to 8-15 px) until **disabled** (both runs; run 2 was then destroyed) |
| w4 4 guns, run 1 | 4 Kit Escort Guns: shield 51% to 11% in 4 s | **stood off** 360-420 px from the player (still firing: the player's shield kept dropping) for the whole 84 s of fire, then came straight back to close passes within 4 s of the player releasing the trigger, shields still down |
| w4 4 guns, run 2 | 4 guns: 84, 50, 2% | never came within view (about 800 px out), **jumped out** 16 s after crossing 25% |
| w4 4 guns, run 3 | 4 guns | like run 1: **stood off** at 360-400 px while the player fired, back to close passes (12-50 px) once the trigger was released |
| w4 4 guns, run 4 | 4 guns: 57, 11% | **jumped out** at 29.5 s, about 16 s after crossing 25% |
| w4 escorts, run 1 | 1 gun + two hired Kit Disc Blue Armed escorts told to attack (`f`) | shields down before the first shot at 11 s; moved slowly away (to about 2600 px) with the escorts on it and **jumped out** at 92 s; the escorts then returned to formation |
| w4 escorts, run 2 | the same | shields down by the first shot; **jumped out** at 26.5 s |

All flag-less controls (wave 3: AI 2 and AI 3 tanks) fought to the end.

**Findings.**
- With the flag, an AI 3 ship whose shield is under 25% **often but not
  always** quits the fight, and when it leaves it **jumps out**, never
  lands: 5 of 12 runs jumped (about 16-17 s after crossing 25% three
  times, 26.5 s and 92 s with escorts), 2 stood off, 5 fought on. Without the flag,
  never (wave 3 controls).
- What decides it is not pinned down:
  - not the armor: both 1000-armor ships fought until disabled;
  - more firepower changes the answer: with 4 guns the tank never fought
    on (2 jumps, 2 stand-offs), with two attacking escorts it jumped both
    times, with 1 gun it fought on in 5 of 6 runs. That fits a retreat
    that weighs how much it is being hurt (or the attackers' strength,
    MaxOdds-style) rather than the shield level alone;
  - a per-decision random chance can't be ruled out.
- "Retreat" includes **standing off**: keeping 360-420 px away (still
  firing) while under heavy fire, and coming back to close passes within
  a few seconds of the firing stopping, shields still down (4-gun runs 1
  and 3).

**NovaJS (9ec7a496):** `npc_decision.ts:478-484` makes a 0x0010 warship
flee the moment its shield is under 25%, every time (and fleeing ends in
`departByJump`, which matches the exit). Against the original this is
too eager against a single weak attacker and has no stand-off.
**Applied in aa2c6aad** (`npc/npc_retreat.ts`): the < 25% shield
condition now also requires the ship to be losing, i.e. under heavy fire
(a leaky bucket of damage taken, in fractions of max shield, draining at
6%/s and tripping at 10%) or facing a fight its `oddsFavorable` calls
unfavorable. While that holds it stays in 'attack' (still firing) but
holds 360-420 px off its enemy instead of closing; after 16 s of losing
it flees, which ends in a jump; when the firing stops the bucket clears
within 4 s and it goes back to close passes. A ship held in the system
(mission goal) never commits to the jump. Every number is a named
constant marked as a guess fitted to the table above. One divergence by
design: the original's 4-gun runs 1 and 3 stood off for all 84 s of
fire without jumping; here a stand-off that long jumps at 16 s.
Confidence: high that the flag alone does not trigger a retreat and that
the exit is a jump; medium for "more firepower, more retreat"; low on
the exact rule.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w4/ai/{ai1x4,ret-armor,ret-4guns,ret-esc}/*/`
(`tracks.jsonl` radar tracks, `hostility-*.json`, the target-panel shots).
`ret-esc/20261123-083222-*` is the launch that died while loading.

### Asteroid decoy capture, finer (2026-11-23, wave 5)

**Setup.** The brief asked for one rock at known offsets (150-300 px) from
the flight line. The original gives no way to place an asteroid: sÿst
Asteroids is only a count, and the rocks drift (about 30-60 px/s here).
So the rig makes the rock come to the missiles instead, and measures every
encounter from the recording:
- sÿst 2172 Kit Decoy Range holds ONE asteroid (AsteroidTypes 0x0001, the
  small röid 128); sÿst 2174 Kit Decoy Range 3 holds three. The target (the
  100-armor J0 hull) sits on a marker 250 px east of the port, so the whole
  flight is inside the 636x604 play area (`kits/testkit.mjs` `wave5Resources`).
- The player sits at the port and fires ONE JamM Decoy missile (wëap 379:
  Seeker 0x0002, JamVuln 0, so jamming plays no part; Speed 600, GuidedTurn
  60, proximity 25 px) every 2 s for 90 s: 45 missiles a run, never two in
  flight at once (`scenarios/decoy_single.json`, pilots `w5_decoy1`,
  `w5_decoy3`).
- `analysis/decoy_track.mjs` (new) tracks every missile head and rock per
  frame and gives, per missile, where it ended and the closest any rock
  came, split by the rock's bearing off the missile's heading: ahead
  (≤ 30°), oblique (30-60°), side or behind (> 60°). Per-missile trail
  pictures (`missiles/mNN.png`, `sheet-*.png`) were checked by eye, because
  the tracker loses a missile inside the target's sprite.
- Hits are read from the target panel (armor % before, at 30 s, 60 s, end).

| run | rocks | hits / 45 | lost |
|---|---|---|---|
| decoy1 | 1 | 42 (14, 14, 14 per 30 s) | 3 (7%) |
| decoy3 | 3 | 25 (6, 7, 12) | 20 (44%) |

**Findings.**
1. **Captures happen only on rocks AHEAD of the missile.** Every capture
   seen had the rock within about 20° of the missile's heading when it
   turned (or flew straight on into it), at 20-200 px: in decoy3 four
   missiles were on a rock from launch with the rock 175-197 px dead ahead
   (3-5° off the heading); others turned onto a rock 100-120 px ahead
   (14-15° off). In decoy1 the three losses were all missiles that had
   nearly reached the target when the drifting rock was just beyond it,
   125-145 px from the missile and in its path (missile 9 passed 18 px from
   the target's centre without hitting it, then hit the rock).
2. **Rocks to the side are ignored, even very close** (the hub's question).
   Five missiles launched with a rock 59-84 px to the side of the launch
   point (78-107° off the heading): decoy3 missiles 0, 11, 20, 24 and 25.
   **None was captured; all five flew on and hit the target** (trail
   pictures: no turn toward the rock, puff on the target). A rock just
   behind the launch point (decoy1 missiles 30 and 31, 79-142 px) was
   ignored too.
3. **Captured missiles hit the rock.** In 90 missiles no trail circled a
   rock; every capture ended in a puff on it. So there is no "circle until
   expiry" in the original, and the side-rock case that makes NovaJS circle
   does not capture at all.
4. **Not every rock ahead captures.** A rock 150-260 px ahead within 20° was
   passed by several missiles (decoy3 missiles 7, 8, 18, 36; decoy1 10 and
   44). With the captures from up to about 190 px that is either a range of
   about 150-200 px with some measurement scatter, or a per-tick chance.
   Not separated.
5. More rocks, far more losses: 1 rock lost 7%, 3 rocks 44%. With 3 rocks
   one of them was ahead of a missile much more often (a rock within 30°
   ahead and under 200 px at some point: 26 of 45 missiles in decoy3, 5 of
   45 in decoy1).

**NovaJS (main 7025aac4, after 818de7af "Seeker 0x0002: asteroids capture
missiles with or without jamming").** `N/nova_plugin/combat/jamming_plugin.ts:168`
(`ASTEROID_DECOY_CAPTURE_RANGE` = 225) captures a 0x0002 missile onto any
rock within 225 px, from the launch tick on, in every direction, which is
what makes a missile circle a rock beside it; a jammed one goes for the
nearest rock within `DECOY_DISTRACTION_RANGE` 1000 px (line 155). Against
wave 5: the range is about right for rocks ahead, the missing direction
limit is a **mismatch** (5 of 5 side rocks at 60-85 px ignored in the
original). **Proposed:** capture only a rock whose bearing is within
about 30° of the missile's heading (a forward field of view), at up to
about 200 px; once captured, steer to it as to any target (it hits; with a
forward cone the rock is always reachable, so no circling). Keep the jammed
case of wave 4 (a jammed 0x0002 missile goes for a rock) under the same
cone, untested.

**Applied in "Seeker 0x0002: only rocks ahead capture a missile (25°
cone, 200 px)"** (`N/nova_plugin/combat/jamming_plugin.ts`,
`ASTEROID_DECOY_CAPTURE_HALF_ANGLE`, `ASTEROID_DECOY_CAPTURE_RANGE`):
- The cone is **25°** either side of the heading, not 30°: it keeps every
  capture seen (up to about 20°) and leaves out the 27-29° rocks at 80 px
  that did not capture, which a 30° cone would take.
- The range is **200 px** (was 225): every capture seen was at 197 px or
  less.
- Capture is still a **certainty** inside range and cone. These runs can't
  tell a 150-200 px range with scatter from a per-tick chance (finding 4).
- A jammed 0x0002 missile goes for the nearest rock inside the same cone,
  within the 1000 px field.
- With the cone the missile always hits: a rock within 25° of the heading
  is never more than r (1 - cos 25°), about 0.09 r, inside the turning
  circle of radius r. For an IR Missile (r about 110 px) the worst case
  passes about 10 px from the rock's centre.
- Specs (`jamming_test.ts`, `jamming_flight_integration_test.ts`):
  - side and behind rocks at 30-84 px are ignored;
  - a rock ahead is captured once in range;
  - with an IR Missile's 405 px/s and 210°/s, rocks at the cone's edge
    (46-199 px) and nearer the centre are all hit within 60 ticks.

Confidence: high that side rocks at 60-85 px are ignored (5 of 5, clean
pictures) and that captures hit; medium for the cone width (captures seen
up to about 20° off; 27-29° at 80 px not captured, decoy3 missiles 24 and
25) and for the range (175-197 px captured, 150-260 px sometimes not).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w5/rocks/{decoy1,decoy3}/*/`
(`recording.mp4`, `tracks.json`, `tracks_summary.jsonl`, `missiles/`,
`sheet-0..2.png`, `panel.png`, `trail-m*.png`).

### E-fight wave 5: do fixed guns and rear turrets fire from the Formation slot? (2026-11-23)

**Setup.** `scenarios/efight_panel.json` (written in wave 4, first run now):
the wave-4 E-fight rig (Kit Fight Range, two always-attacks A14 Warship
raiders, 2000 shield, making passes; the player idle with only the Kit
Tickler, never fired), and every 5.5 s `r` targets the nearest hostile and
a shot reads its shield. Escorts: two blue discs with two Kit Fixed Guns
(wëap 368, guidance -1; pilot `w4_efix`), two Kit Rear Turrets (369,
guidance 8; `w4_erear`) or, as the control, two Kit Escort Guns (365, full
turret; `w3_efight`). The Kit Escort Gun and the raiders' A14 Gun share
wëap 131's graphic, so `analysis/bolt_births.mjs` (new) tracks every bolt
and attributes each new one to the disc it appears beside (validated on
the control).

| escorts | bolts born at a blue escort | raider shields read (25 shots) |
|---|---|---|
| full turrets (control) | 68 in the first 50 s | 13%, Shields Down by 8 s; both raiders **Disabled** by 25 s |
| rear turrets | 6 clean ones in the first 6 s (flying away from the escort toward a raider behind the formation), later bursts hidden in the raiders' crossfire | 88, 83 ... 82% (one raider), 95% then **77-74%** (another): 26% = about 17 Kit Escort Gun hits |
| fixed guns | 1 (doubtful) in 100 s | 98-100% throughout |

**Findings.**
- **Rear-quadrant turrets fire from the slot** at a ship behind the
  formation (raiders passed through the formation and out behind it on
  every pass), without leaving the slot (wave 4: 36-39 px all run).
- **Fixed guns do not fire** from the slot: no escort bolts, and the
  raiders kept 98-100% shield while passing in front of the escorts many
  times. Escorts do not turn to bring a fixed gun to bear.
- Full turrets, as wave 3 saw, fire freely.

**NovaJS (main 7025aac4, unchanged since d17654fe):**
`N/nova_plugin/escorts/escort_command_plugin.ts:616-628`
(`formationTurretKind`) lets full turrets and front-quadrant turrets fire
from the slot; fixed guns hold fire (**matches**) and so do rear-quadrant
turrets (**mismatch**; the comment at lines 608-611 holds them only because
they were unmeasured). **Applied in a9e28b47:** guidance 8 is a
'rearQuadrant' kind that fires at an iff-hostile ship within ±45° of the
escort's tail (`inRearQuadrant`, the mirror of `inFrontQuadrant`, read
through the same `getQuadrant` the turret aims by), out to the shot's
speed × lifetime. Specs: `N/nova_plugin/player/escort_command_test.ts`.
Front-quadrant turrets (guidance 7) are still unmeasured; by symmetry
keeping them is right.

Confidence: high for fixed guns (100 s, no damage) and for the control;
medium-high for rear turrets (clean births in one stretch, and the panel's
26% drop with nothing else firing at the raiders but each other, which the
fixed-gun run shows is negligible).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w5/escorts/panel-{efix,erear,efight}/*/`
(`recording.mp4`, `bolt_births.jsonl`, `panels.png`, `hostility-*.json`,
`trail-drop.png`).

### A14 wave 5: one-way alliances, and which systems' records a crime changes (2026-11-23)

**One-way alliances.** `scenarios/a14_observe.json` as in wave 2 (Kit
Lancer Lite, never firing, -500 record in the current system only; AI 3 red
disc warships of ONE govt spawned by the system):
- c19 (sÿst 2002, owner 370 Owner): warships of gövt 365 "GtoO", whose
  Allies list Owner's class 70; Owner does NOT list 365's class.
- c20 (sÿst 2003, owner 367 "Owner2", whose Allies list class 78):
  warships of gövt 366 "OtoG" (class 78, no allies of its own).

| cell | who lists whom | attacked? |
|---|---|---|
| c19 run 1 | G lists O only | **yes**, late: the two warships present at arrival sat 58 px away on the planet for about 30 s and left; two that arrived later attacked from 59 s (shield 148 -> 118 by 81 s) |
| c19 run 2 | G lists O only | **yes**, from 7.6 s (shield 140 -> 14) |
| c20 | O lists G only | **yes**, from 9.6 s (shield 146 -> 24) |

(c19 run 1 is wave 2's c6 pattern again: ships already sitting on the
planet when the player arrives can stay passive; ships that arrive later
attack.)

**Finding.** A one-way alliance is enough, in either direction: G enforces
the record of a system owned by O when G lists O's class as an ally OR O
lists G's class. With wave 2 (no tie at all: never), the "G enforces here"
test of the A14 proposal is `G === O || G.allies ∩ O.classes || O.allies ∩
G.classes || G nosy`.

**Which records a crime changes.** `scenarios/crime_kill.json`, pilot
`w5_crime`: Kit Lancer with the 5000-damage Kit Beam Turret, every record
0, starts in A14 Own (sÿst 2110, owner 370), destroys one of the AI 3
warships of 370 (one beam burst; "No Target" after), lands at A14 Own Port,
leaves, and the pilot is read back (`pilot_summary.mjs`, which now lists
every non-zero record).

| pilot | date | combat rating | non-zero records |
|---|---|---|---|
| pushed | June 23 | 0 | none |
| after the kill, pulled IN the spaceport | June 23 | 0 | none (the file is not written on landing) |
| after Leave | June 24 | **10** | **sÿst 2110: -150** only |

- **Only the system where the crime happened changed.** The other nine
  systems owned by the same govt 370 (A14 Own2 2111, 2112-2116, 2126,
  2127 and 2002), the ally's home (2121, owner 371, which lists
  370's class) and the unrelated homes all stayed at 0.
- -150 = DisabPenalty 50 + KillPenalty 100: the beam disabled the ship and
  then destroyed it, and both were charged.
- Combat rating +10 for one Strength-50 kill.
- **Harness lesson:** the pilot file is written when the player LEAVES the
  spaceport (the date advances then), not on landing. Wave 4's B4 note
  ("after landing and re-saving") was the same thing; README fixed.

**NovaJS (main 7025aac4).**
- Hostility: `N/nova_plugin/reputation/govt_disposition.ts:38-65`
  (`govtDisposition`) counts an ally only from the acting govt's own Allies
  list, and the record test in `govtDispositionTo` (lines 76-105) uses the
  player's record with the ship's OWN govt. The A14 proposal should test
  the alliance both ways, as above. **Applied in 13567336**
  (`local_law.ts` `enforcesHere`).
- Crime: `N/nova_plugin/reputation/reputation.ts` `applyCrime` (around line
  148) charges the victim govt's record (which NovaJS uses everywhere that
  govt owns) and propagates half the penalty to its allies
  (`PROPAGATION_DIVISOR` 2, line 75). The original charged the CURRENT
  system only, and nothing to the ally (catalogue R2: the ally propagation
  is 0 in this test, though the ally here listed the victim's class rather
  than the other way round). Per-govt records are a sanctioned
  simplification, so the system-scope part is a known difference; the ally
  propagation is a **mismatch** worth a ruling. **Proposed:** drop the
  ally/enemy propagation (or put it behind a ruling), and charge
  DisabPenalty and KillPenalty both when a kill passes through disabled.
  **The propagation part is applied in 13567336** (ruling #376: `applyCrime`
  charges the victim's govt only; `PROPAGATION_DIVISOR` is gone). The
  Disab + Kill part is not applied.

Confidence: high for the one-way alliances (three runs, two clean) and for
the single-system charge (a clean before/after diff); medium on the ally
propagation (one ally, one direction of the alliance).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w5/a14/{c19,c20}/*/`
(`hostility.json`, the Tab shots) and `a14/crime/20261123-115810-crime_kill/`
(`pilot-landed/`, `pilot-left/`, `pilot-after/`, shots). The first crime
run (`*-NO-SAVE-pulled-before-leave`) is the one that showed the file is
not written on landing.

### A-series wave 5: AI 1 departure of ordinary sÿst traffic (2026-11-23)

**Setup.** `scenarios/traffic_watch.json`, pilot `w5_traffic`: sÿst 2000
Kit Traffic Range has two landable stellars, Traffic Port (0,0, where the
player sits, never firing) and Traffic Market (900,0), and ordinary traffic
of düde 630: the AI 1 yellow AI Subject Disc that wave 4 used as a mïsn
special ship, now as sÿst traffic (avgShips 4). 230 s recorded; radar blips
sampled every 2 s (`analysis/radar_blips.mjs`, `blips.jsonl`; Traffic Market
is the stellar dot at radar (28,0), about 32 world px per radar px) and
trail pictures of the play area.

**What the traffic did** (radar times are recording seconds):
- **It lands.** At 124-146 s three ships converged on Traffic Port from
  the north-west and north-east; their trails end ON the planet and they
  vanish there (`trail-136.png`). At 46-58 s another flew in from the west
  and vanished at the Port.
- **It takes off and leaves.** At 94-108 s a ship appeared beside the Port
  and flew straight south off the radar (`trail-94.png`).
- **It visits the other stellar and then jumps.** Ships flew to Traffic
  Market and held a blip on it (just past it, radar (31,1)) for about 20 s
  (12-34 s and 72-92 s), then accelerated east and vanished about
  2000 px out (radar 61-63) at 36 s and 94 s: the jump-out signature of
  wave 4.
- Single blips that only crossed the system were also seen; the radar
  tracker fragments too much to give each ship's full life, so no
  per-ship lifetime is claimed.

**Finding.** Ordinary AI 1 traffic is not like the AI 1 mission ships of
wave 4 (which jumped out 30-40 s after appearing, 9 of 9, never landing):
traffic flies to stellars, lands on them or lingers about 20 s beside them,
takes off again, and leaves by jumping. That is the shape NovaJS already
gives traffic.

**NovaJS (main 7025aac4):** `N/nova_plugin/npc/npc_decision.ts:78-79`
(traffic departs 120-300 s after spawning) and the AI 1/2 planet-to-planet
loop with "dwell" standing in for landing (around line 486): **matches in
shape** for traffic. The wave-4 proposal, a 30-40 s pass-through for
goal-less mïsn special ships only (lines 89-90, 104, applied in
ae017162), is confirmed as specific to mission ships: keep the dwell loop
for traffic. Not measured: the length of a
landed stay (a landed ship disappears from the radar) and the total time a
trader spends in the system.

Confidence: medium (one 230 s run; several landings and two jump-outs seen
clearly).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w5/ai/traffic/*/`
(`recording.mp4`, `blips.jsonl`, `tracks.jsonl`, `trail-94.png`,
`trail-136.png`, `NN-watch-*.png`).

### A-series wave 5: what triggers the gövt 0x0010 retreat (2026-11-23)

**Setup.** Wave 4's rig (`scenarios/ai_tank.json`: the AI 3 AI Tank Disc of
gövt 383, 1000 shield, 30000 armor, Strength 50, MaxOdds 1000; the player
holds fire about 85 s, target panel every 2.7 s; radar tracks show a
jump-out as a hard acceleration and a vanish 1700-2100 px out) with the
player hull's shïp **Strength** changed and nothing else:
- `w5_ret_weak4`: Kit Lancer Heavy **Weak** (shïp 778, Strength 1) with 4
  Kit Escort Guns: fast damage from a "weak" attacker;
- `w5_ret_strong1`: Kit Lancer Heavy **Strong** (779, Strength 10000) with 1
  gun: slow damage from a "strong" attacker;
- `scenarios/ai_tank_burst.json` with wave 4's 4-gun pilot (Strength 100):
  fire only about 13 s (shield down by about 13 s), then 85 s of watching.

| attacker (Strength, guns) | runs | what the tank did after its shield fell below 25% |
|---|---|---|
| 100, 1 gun (waves 3-4) | 6 | fought on in 5 (passes to 8-23 px until the end), jumped in 1 |
| **10000, 1 gun** | 2 | **jumped both times**: backed out of the gun's reach at once (its shield stopped falling at 14% / 8%), jumped about 20 s after crossing 25% (39 s, 42 s) |
| **1, 4 guns** | 2 | **jumped** about 10 s after crossing 25%; **stood off** at 380-420 px for the whole 85 s of fire, still firing |
| 100, 4 guns (wave 4) | 4 | jumped 2, stood off 2 |
| 100, 4 guns for 13 s, then nothing | 2 | stood off while fired on, then **came back to close passes** (14-35 px every 7 s, shields down) for the 85 s after the trigger was released; the other **jumped** 7 s after the release |
| 100, 1 gun + two attacking escorts (wave 4) | 2 | jumped both times |

**Findings.**
- The attacker's **Strength** matters: the same slow single gun that a
  Strength-100 hull fires without effect (5 of 6 fought on) made the tank
  leave both times from a Strength-10000 hull. That is the MaxOdds-style
  odds test (the tank's 50 against its attacker's strength), not the damage.
- Heavy damage makes it leave **whatever** the attacker's strength: a
  Strength-1 hull with 4 guns got the same jump/stand-off mix as the
  Strength-100 one. So the rule looks like "shield < 25% AND (losing on
  odds OR taking heavy fire)".
- What it does then is either jump out (about 10-20 s later) or stand off
  out of the attacker's reach while still shooting; once the fire stops it
  can come back to close passes with its shield still down (1 of 2), or
  leave anyway (1 of 2). Which of the two it picks looks random from run to
  run.

(Rates: the panel shots are about 4.7 s apart, not 2.7 s, because each
shot itself takes about 2 s. 4 guns took about 11% of the shield per
second off this tank, 1 gun 3-5%/s.)

**NovaJS (main 7025aac4, after ba4eee66 "gövt 0x0010 retreat: only when
losing").** `N/nova_plugin/npc/npc_retreat.ts:50-68` (`warshipRetreat`,
called from `npc_decision.ts:542`): under 25% shield AND losing, where
losing = a damage-load bucket over `HEAVY_FIRE_LOAD` (fed above
`HEAVY_FIRE_RATE_PER_S` 6%/s, line 41) OR a threat whose `oddsFavorable`
call is false; it stands off at 360-420 px and jumps after
`RETREAT_JUMP_MS` 16 s (line 57), resuming the attack once the load drains
(4 s). Against wave 5:
- the Strength cells **match**: the Strength-10000 attacker makes the
  MaxOdds call unfavorable, so it retreats even against one gun (the
  original jumped 2 of 2, about 20 s after crossing 25%);
- the heavy-fire cells **match** (Strength-1 attacker with 4 guns: jump or
  stand-off), and so does the burst run that came back after the fire
  stopped;
- the one thing NovaJS cannot give is the burst run that jumped out 7 s
  AFTER the fire had stopped, and the run-to-run choice between jumping
  and standing off: in NovaJS a stand-off always lasts 16 s before the
  jump. Not worth a random draw on two runs. No change proposed.

Confidence: medium. Two runs per new cell; the Strength effect is clean
(2 of 2 against 5 of 6 the other way), the damage-rate effect rests on
the 4-gun cells (8 runs in all, none fought on).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w5/ai/{ret-weak4,ret-strong1,ret-burst}/*/`
(`panels-fire.png`, `panels-after.png`, `hostility-yellow.json`,
`tracks.jsonl`).

### B NPC carrier wave 5: which carriers launch (2026-11-23, blast question still open)

**Setup.** `scenarios/carrier_watch.json`: the player (Kit Lancer, no
weapons) sits at a port whose only traffic is ONE AI 3 carrier of the
always-attacks gövt 362 (avgShips 1); Tab every 3.3 s for 110 s reads
whatever ship is targeted.

| carrier (traffic düde) | launched? | attacked the player? |
|---|---|---|
| Kit Bomb Carrier (shïp 712: kit hull from the Fed Carrier, 2 Kit Escort Guns, Kit Bomber Bay of 4 Kit Bombers) | **no** (Tab only ever found the carrier) | no (player's shield untouched 110 s) |
| **stock Fed Carrier** (shïp 143, stock bays) | **yes: Fed Vipers and Fed Anacondas** from the first Tab on | yes, steadily (shield 148 -> 132 px over 100 s) |
| Fed Carrier hull, its Viper bay swapped for the Kit Bomber Bay (shïp 780) | no | no |
| the same with a byte-for-byte copy of the Viper bay pointing at a Kit Bomber with EscortType 0 (wëap 237, shïp 781/782) | no | no |

**Findings.**
- An NPC carrier in ordinary traffic DOES launch (the stock Fed Carrier,
  hostile to the player). Wave 1's Q4 (ShipBehav-1 mission carriers never
  launch) is specific to protect-the-player mission ships.
- With the kit's bombers in its bay the same hull neither launched nor
  closed to attack, even with the stock bay's bytes. So it is the carried
  ship that stops the launch (the kit bomber's 180 px blast shell, its kit
  fields, or something else the NPC launch decision reads), not the bay.
  Not separated.
- Side observation from the stock run: a Fed Viper read 47% shield late in
  the run although the player had no weapons, so the carrier group's own
  fire hurt one of its fighters. Whether anyone turned on it could not be
  seen.

**Take 2, blasting Vipers** (`scenarios/carrier_watch_blast.json`: the
stock Fed Carrier again, plus `kits/viper_blast.mjs`, a test-only override
of the stock Fed Viper, shïp 144, giving it the Kit Blast Shell next to its
three guns). The carrier launched its Vipers and Anacondas as before. The
Vipers read 38% and 40% shield at 10-13 s (their own 400 px blasts, as in
B1) and were gone from the Tab cycle after about 16 s; the Anacondas went
on (one at 60%). **The carrier read 100% shield in all 16 of its panels**:
it hung back, far from where its fighters fought, so no blast reached it
and the retaliation question could not arise.

**NovaJS:** the "NPC carriers never fire their bays" note (wave 1) was
stale. `N/nova_plugin/npc/npc_fire_control.ts` has opened an attacking
NPC's bays since 0655408c, one fighter per reload, and
`NpcWingCommandSystem` (`N/nova_plugin/escorts/escort_command_plugin.ts`)
orders the wing onto the carrier's victim. Checked:
- Headless on 7972a28f (real data): a stock Fed Carrier (shïp 143) set on
  a Shuttle launched 6 fighters in 20 s.
- Browser on f71fd85e (`?ship=nova:128`, real traffic): a Shuttle fired
  one burst at a stock Fed Carrier (shïp 220) in Sol. Within a second it
  was in 'attack' on the player and launched up to 8 fighters (Vipers
  shïp 144 among them), all ordered to attack the player. Earlier runs
  of the same change saw the same from a Fed Carrier (shïp 222) and a
  Pirate Carrier (shïp 287, up to 9 fighters).

So the traffic carrier **matches**.

**Applied in f71fd85e:**
- the Q4 protector exception (see Q4);
- recovery, which the reference has not measured: once the carrier has
  stopped fighting (any NPC mode but 'attack'), its wings get
  'returnToBay', fly home and dock, refunding their rounds. Between
  victims they hold formation. A wing already flying home is not turned
  back if the carrier fights again; the carrier launches again instead,
  one per reload.

In the browser runs the dev respawn kept killing and reviving the
Shuttle, so the carrier flipped between 'attack' and 'patrol' every few
seconds. Recalled wings flew home while fresh ones launched, and the
magazine bounded the total.

**Not modelled:** the kit-bomber carriers that never launched (cause not
separated); NovaJS would launch them.

The blast-retaliation question stays open: it needs the fight brought to
the carrier (e.g. the player parked beside it, or a carrier with a short
leash). The fighters' own blasts hurting them matches B1.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w5/{carrier,carrier-fed,carrier-fedbomb,carrier-fedbomb-f,carrier-blast}/*/`
(`panels.png`, `recording.mp4`).

### Boarding a non-mission disabled ship (U9 leftover): not attempted (2026-11-23, wave 5)

Not built this wave. What it would take: the harness can only press keys
blind, and a non-mission hulk appears wherever the game puts traffic. The
cheap version is a sÿst whose only traffic is an immobile hull (Speed 0,
so it never drifts) of a govt with gövt flag 0x0800 (starts disabled),
plus a closed steering loop in `novaref`: take a window shot, find the
target's bracket offset (`analysis/blob_offset.mjs`), find the player's
heading by thrusting 0.2 s and reading the starfield shift
(`world_motion.mjs`), turn by the angle at the measured 87°/s (Turn 30),
thrust, brake with Down, repeat until within 100 px, then step in as
`land_step.json` does and press `b` at each stop. Each loop costs about 3 s
of ssh, so an approach from 1000 px is roughly 2-3 minutes; about half a
day to build and test.

### F1n wave 5: mixed sprite sizes and repeated escort types in one flët (2026-11-23)

**Setup.** `scenarios/f1n_observe.json` (Probe A sitting at the port, 80 s
recorded), `analysis/fleet_groups.mjs` (escort offsets in each white lead's
frame; along + = ahead, across + = left of travel). Two new fleets, govt
363, each placed by its own system's DudeTypes:
- flët 301 (sÿst 2005, pilot `w5_f1n_mixed`): white 24 px lead; escorts
  Kit Big Red (96 px frame), green, blue, yellow (24 px), one each;
- flët 302 (sÿst 2006, pilot `w5_f1n_repeat`): white 24 px lead; escorts
  red ×2 (min 2, max 2) then green ×2.

| fleet | escort | measured along / across (mode of the samples; median) | F1b slot with the group's S |
|---|---|---|---|
| mixed (S = 96, a = 56.6) | red, 96 px (rank 1) | -56.3 / +56.1 (median, 159 samples) | (-56.6, +56.6) |
| | green (rank 2) | -55.1 / -56.5 | (-56.6, -56.6) |
| | blue (rank 3) | about -110 / +115 (mode; median -94 / +120 with mis-assigned samples) | (-113, +113) |
| | yellow (rank 4) | about -110 / -115 (median -85 / -118) | (-113, -113) |
| repeat (S = 24, a = 23.5) | the two reds | -20 / +20 (149) and -20 / -20 (167) | ranks 1 and 2: (-23.5, ±23.5) |
| | the two greens | -50 / +50 (67+63) and -50 / -50 (76+41) | ranks 3 and 4: (-47, ±47) |

**Findings.**
- **Mixed sizes:** every slot of an NPC fleet uses the step of the
  group's LARGEST frame, including the small escorts (24 px discs at the
  96 px step), as for player escorts (F1b run g).
- **Repeated types:** ranks follow the flët's escort fields in order, all
  of a type before the next type: both reds take ranks 1-2 (left, right),
  both greens ranks 3-4.

**NovaJS (main 7025aac4):** `N/nova_plugin/spawn/npc_spawn_plugin.ts:1105-1135`
draws every escort count first, takes the spacing from the largest
`spriteFrameWidth` among the lead and the escorts actually spawned, then
places escorts type by type in field order into consecutive slots:
**matches** both. Confidence: high (two fleets of samples each, ±5 px for
the inner pair, ±10 px for the outer pair at the 96 px step).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w5/f1n/{mixed,repeat}/*/`
(`recording.mp4`, `fleet_groups.json` with every sample).

### J-series wave 5: sensor interference and attack-parent (2026-11-23)

**Setup.** The J rig (`scenarios/jam_fire.json`: about 25 s of trigger,
about 49 missiles of Speed 600 / GuidedTurn 60, the 100-armor J0 target
900 px east; hits = 100 - armor %), with two new missiles
(`kits/testkit.mjs` `jamWave5`):
- wëap 235 **JamM Interf**: Seeker 0x0008 "confused by sensor
  interference", JamVuln 0 (so no jamming at all), fired in sÿst 2007 Kit
  Static Range (**Interference 100**) and in sÿst 2009 Kit Static Control
  (Interference 0), otherwise identical (pilots `w5_static`,
  `w5_static_ctrl`);
- wëap 236 **JamM Parent V100**: Seeker 0x8000 "may attack parent ship if
  jammed", JamVuln1 100, against Jam Target S100 (ONE +100 jammer, so every
  missile is jammed) at Kit Market, fired from Kit Lancer Lite (pilot
  `w5_parent`).

| cell | launched | hits | lost |
|---|---|---|---|
| 0x0008, Interference 100 | 49.5 | 16 | **68%** |
| 0x0008, Interference 0 | 48.7 | 49 | 0% |
| 0x8000 V100 vs +100 jammer | about 49 | 0 | 100% |

**Findings.**
1. **Interference confuses 0x0008 missiles regardless of JamVuln.** A
   JamVuln-0 missile (immune to every jammer) lost 68% in a system of
   Interference 100 and nothing in the identical system of Interference 0.
2. **A confused missile circles.** Its trail is a tight loop (about 70 px
   across) repeated, drifting slowly, until it expires
   (`trail-after-release.png`: a dozen loops near the launch point); the
   others fly straight to the target and hit. It looks decided per missile
   (a missile either loops for its life or homes normally); only one
   Interference level was tried, so how the share scales is open.
3. **0x8000: most jammed missiles fly straight on; a few turn back on the
   parent.** All 49 missed the jammed target. In the trail pictures nearly
   all fly off along the launch heading; one is seen looping back, and
   pink hit puffs appear on the player (about 3 in the whole run; the
   puff detector confirmed one, the player's shield bar fell 2 px of 148,
   1-damage missiles on 1500 shield). So a minority, on the order of 5%,
   attack the parent.

**NovaJS (main 7025aac4), `N/nova_plugin/combat/jamming_plugin.ts`:**
- Interference: `effectiveJamming` (lines 214-236) adds the system's
  Interference to the RADAR jamming type (`RADAR_JAM_INDEX` 1, line 171)
  for 0x0008 missiles, which then goes through the JamVuln roll; a JamVuln-0
  missile is never affected. **Mismatch** on two counts: in the original the
  interference acts without any JamVuln, and its effect is circling, not
  the jammed straight flight. **Proposed:** at launch, a
  0x0008 missile in a system with Interference I is confused with
  probability of about I × 0.7 / 100 (one point measured: 68% at 100), and a
  confused missile turns at its full GuidedTurn in one direction for its
  whole life; leave JamVuln out of it.
  **Applied in "Seeker 0x0008: sensor interference confuses missiles into
  circles, whatever their JamVuln"** (`N/nova_plugin/combat/jamming_plugin.ts`
  rule 5, `INTERFERENCE_CONFUSION_PER_POINT_FITTED`):
  - **The odds:** P = 0.0068 × I, a line through the origin and the one
    measured point (1 - 16/49.5 = 0.677 at Interference 100), clamped to
    [0, 1]. The line between 0 and 100 is an assumption.
  - **When:** decided once, at the same moment as the jam decision, from a
    sixth PRNG draw that every guided missile now makes (so the flag never
    shifts another missile's rolls). The same draw picks the direction,
    half clockwise and half counter-clockwise; these runs didn't show
    whether the original has a preferred direction.
  - **What happens:** a confused missile turns at its full turn rate one
    way for life (`ProjectileGuidanceSystem`), ahead of any jam reaction.
    Interference no longer adds to radar jamming.
  - **Still possible:** a confused 0x0002 missile (the stock Radar Missile
    has both flags) can still be captured by a rock that its loop sweeps
    into the capture cone.
  - **Loop size, not matched:** the loops in `trail-after-release.png` are
    about 70 px across. A loop at the Kit missile's parsed turn rate (Speed
    600 -> 180 px/s, GuidedTurn 60 -> 180°/s) would be 2 v / ω, about
    115 px, and NovaJS's loops are that size. So either a confused missile
    turns about 1.6 times faster than its GuidedTurn, or NovaJS's GuidedTurn
    conversion is off for every missile. Not changed here; it needs a
    measurement of a homing Kit missile's turn. (Measured in "J wave 6: how
    tight a confused missile's loop is": 1.8x, applied in bdc43534.)
  - **Drift, not matched:** the original's loops drift slowly. NovaJS's are
    closed circles.
- Attack-parent: `ATTACK_PARENT_IF_JAMMED_PROBABILITY` = 0.1 (line 96,
  applied at lines 340-342): a jammed 0x8000 missile retargets its parent
  10% of the time. The original's few-in-49 is **consistent** (it could be
  5-10%); no change proposed.

Confidence: high for "interference works with JamVuln 0" and for the
circling (clean 68% vs 0%, trails); low for the share at other
Interference levels; medium-low for the attack-parent rate (hits on the
parent are hard to count on a 1500-shield bar).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w5/jam/{static,static-ctrl,parent}/*/`
(`panel.png`, `trail-mid.png`, `trail-after-release.png`, `trail-all.png`,
`recording.mp4`, `recording.events.json`). Not done this wave: ion damage
and cloaked targets (no time; they need an ion weapon and a cloaking
target hull).

### E-recall wave 5: the recall overshoot frame by frame (2026-11-23)

**Setup.** Wave 3's `scenarios/esc_recall2.json` again (pilot `w3_recall`:
Kit Lancer with two hired Kit Disc Blue Armed escorts, Speed/Accel 600, in
quiet Kit Range). Key stamps (video frames, 30.04 fps): `v` (Hold Position)
222, thrust 268-345, Down (brake) 365-427, **`c` (formation) 549**. Every
blue disc's distance from the player per frame is in `recall_frames.json`
(all 2079 frames; the player is stopped, so screen = world).

| frames after `c` | seconds | escort A | escort B |
|---|---|---|---|
| 0-134 | 0-4.5 | off screen (> 300 px) | off screen |
| 135 | 4.49 | enters at 312 px, closing at about 9.5 px/frame (285 px/s, its top speed) | |
| 165 / 171 | 5.49 / 5.69 | 47 px / **18 px: flies straight through the slot** | |
| 177-219 | 5.9-7.3 | 56, 101, 144, 183, 224, 259, 291, 314 px: carries on out the far side, slowing | |
| 225-272 | 7.5-9.1 | off screen again (> 315 px) | |
| 273 | 9.1 | back at 315 px, now closing at about 1.3 px/frame (40 px/s) | |
| 303 | 10.1 | 264 px | enters at 318 px, same slow approach from the same side |
| 351 / 441 / 501 | 11.7 / 14.7 / 16.7 | 204 / 124 / 59 px | 242 / 100 / 36 px |
| 546-561 | 18.2-18.7 | **settled: 28.7 px**, constant to the end | **settled: 37.4 px** |

**Finding.** Recall in the original is a full-speed dash that does NOT
brake for the slot: the first escort shot through the player at 285 px/s,
overshot by more than 300 px (off screen), turned, and came back at a slow,
nearly constant 35-45 px/s, settling about 18.5 s after `c` (wave 3's run:
10 s, overshoot to 123 px). The second escort never dashed through the
screen; it arrived late on the same slow final approach. The size of the
overshoot varies a lot between runs (123 px vs more than 315 px).

**NovaJS comparison (headless, main 7972a28f + f71fd85e; formation
steering unchanged).** Two escorts with the kit disc's converted stats
(Speed 600 = 270 px/s, Accel 600 = 108 px/s², Turn 60, 24 px frame) on
'holdPosition' 900 px behind a stopped Kit Lancer (±40 px abreast, facing
it), then ordered back to 'formation' (`c`). Distances sampled at the
recording's 30.04 fps. The two escorts started mirror-symmetric, so they
flew identical paths.

| | original (escort A) | NovaJS |
|---|---|---|
| on screen (≤ 315 px) | frame 135 (4.49 s), 285 px/s | frame 111 (3.70 s), 206 px/s |
| fastest on the way in | 285 px/s (top speed) | 225 px/s (the brake cap, √(2 · 0.5 · Accel · d)) |
| first contact (reaches the slot) | frame 171 (5.69 s), 18 px from the player | frame 156 (5.19 s), 171 px/s; closest 29.5 px |
| peak overshoot | more than 315 px from the player (off screen, frames 225-272) | 201 px from the player at frame 220 (161 px past the 40 px slot), then a second, smaller swing (99 px at frame 350) |
| return | slow, nearly constant 35-45 px/s from 315 px | up to about 90 px/s |
| settled | frames 546-561 (18.2-18.7 s), 28.7 / 37.4 px | frame 414 (13.8 s), 40.1 px |

Starting 800 or 1000 px back moves NovaJS's numbers only a little:
contact at frame 147 / 165, peak 183 / 217 px, settled at 403 / 427.

**Finding.** NovaJS overshoots too, so the "no overshoot" line above is
wrong. The shape is the same: a dash, an overshoot past the player, a
turn, a slower return, then the slot. But NovaJS:
- brakes on the way in (it never reaches top speed);
- reaches the slot about 15 frames sooner;
- overshoots about half as far;
- comes back faster;
- settles about 4.5 s sooner.

It is closer to wave 3's run (overshoot to 123 px, settled about 10 s
after `c`) than to this one. The original's second escort arrived late on
the slow approach without ever dashing through; a symmetric start in
NovaJS can't show that. No change proposed, since the two original runs
already differ this much. The script is in this wave's hand-back (the
agent's scratchpad `recall.mjs`).

Confidence: high for this run's timeline (frame-exact), low for how
typical it is (two runs so far, very different overshoots).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w5/escorts/recall/20261123-115519-esc_recall2/`
(`recording.mp4`, `recording.events.json`, `recall_frames.json`).

### R8 wave 5: fullscreen 1920x1080 captures of the spaceport venues (2026-11-23)

**Setup.** `scenarios/fullscreen_shops.json` (pilot `w4_fs`: a stock
Shuttle at Earth) with the scenario `"prefs": {"RunInAWindow": 0}`; the run
restores the prefs afterwards (`prefs-restored`). The first try failed:
in fullscreen the game window exists before the title screen is drawn, so
`open_pilot` pressed `o` too early. Scenarios now take `"title_wait"` (ms
before `open_pilot`; 12000 here).

**Captured** (full-screen PNGs, 1920x1080): title, spaceport, outfitter,
shipyard, trade center, the bar (with its mission offer up) and the star map
from the spaceport. The game ran at the desktop's 1920x1080 (window
[-1,-1,1922,1082]); no display-mode change.

**K1 / K2 (spaceport keys), new answers:**
- `o` Outfitter, `s` Shipyard, `t` Trade Center and `b` Bar open those
  venues; Escape closes the outfitter, shipyard and trade center back to the
  spaceport.
- `m` in the spaceport opens the **star map**, not the Mission BBS (Escape
  closes it). NovaJS binds `m` to the star map there too
  (`N/spaceport/spaceport.ts:155`): matches. The BBS key is still unknown;
  `scenarios/fullscreen_bbs.json` clicks the button instead (screen
  715,668), which captured the Mission BBS ("The following missions are
  available here:" with the date at top right, a list on the left, the
  selected mission's title and text on the right, Accept / Leave).
- Entering Earth's bar offered a mission at once (No / Yes), and **Escape did
  not dismiss it**: the offer was still up 2 s later. So Escape is not "No"
  in a mission offer (catalogue K2).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w5/ui/fullscreen/20261123-110717-fullscreen_shops/`
(`02-spaceport.png` ... `12-after-bar.png`, `montage.png`) and
`ui/fullscreen-bbs/20261123-115704-fullscreen_bbs/02-bbs.png`. The failed
first try is kept as `*-INVALID-o-too-early`.

### U9 wave 6: landing range of the tiny stations (2026-11-23)

**Question.** Wave 4's fix gives NovaJS R = max(min(2 S, 240), 0.8 S) with
S the LARGER frame dimension, so the stock stations of 17x31 (Type 53, the
"LP" stations) and 15x21 (Type 51) get 62 px and 42 px. Nothing that
small was measured.

**Kit** (`wave6Resources`). sÿst/spöb 2013 Kit Land 17x31 (cloned from
spöb 299 Holpa Station), 2014 Kit Land 15x21 (spöb 264), 2015 Kit Land
35x22 (Type 48, spöb 235), all with the stock station flags 0x11, and 2016
the 17x31 art as a planet (0x43). The player hull is new: Kit Crawler Mini
(shïp 783, the Crawler 50 at 22 px/s on the stock Shuttle's 24 px sprite);
the Lightning's 48 px frame that wave 4 used outshines a 15x21 station in
`planet_track.mjs`'s largest-blob search (run with `--exclude-centre 15`).
The opaque pixels of each sprite fill its frame (15x21, 17x31, 34x22,
39x38 for Type 3), so frame and visible size are the same here.

**Method** as wave 4 "at rest": `scenarios/land_step_mini.json` (request,
fly out 12 s, turn, then 0.5 s thrust steps of about 13-14 px, Down, `l` at
rest) and `land_step_fine.json` (out 5 s, then 0.25 s steps of about 8 px).
Distances are the station's centre in the frame the game read the key.
A pending landing request lapses after about 27 s (16 presses), and the
next `l` is a fresh request that is answered with a greeting ("You are
cleared to dock. Welcome to ...") without landing: those presses carry no
range verdict and are left out.

Each run approaches along one straight line, in a direction set by the
random takeoff heading, so the offsets (dx, dy) of the station from the
player at each stop are given too (screen axes, + = right / down).

| stellar (frame) | run | approach | too far at (dx, dy) | landed at (dx, dy) | NovaJS today |
|---|---|---|---|---|---|
| Type 51, 15x21, station | coarse | -24° | 33.6 (30.5, -14) | 19.7 (17.5, -9) | 42 |
| | fine | 83° | 28.4 (4.5, 28) | about 20 (one 8 px step on; the blob merged with the player) | |
| Type 53, 17x31, station | coarse | 95° | 34.5 (-6, 34) | 23.4 (-8, 22) | 62 |
| | fine | -140° | 44.0 (-34, -28) | **35.6 (-28, -22)** | |
| Type 53, 17x31, **planet** flags | fine | 118° | 39.8 (-19, 35) | 32.2 (-16, 28) | 62 |
| Type 48, 35x22, station | coarse | 52° | 88.4 (54, 70) | 61.2 (38, 48) | 70 |
| | fine | 80° | 63.8 (10, 63) | 55.7 (9, 55) | |
| Type 3, 40x40, planet, Mini hull (control) | coarse | -95° | 88.3 (-7, -88) | 61.2 (-5, -61) | 80 |

The 17x31 station landed at 35.6 px on a diagonal but was "too far" at
34.5 px straight below: no circle around the centre fits that. A square
does. Taking each stop's distance as **max(|dx|, |dy|)** (the Chebyshev
distance) and redoing wave 4's at-rest runs the same way (their
`track_summary.json` hold the offsets):

| frame width W | too far / landed, max(\|dx\|, \|dy\|) | k = R / W allowed | wave 4's circle bracket |
|---|---|---|---|
| 15 (15x21) | 28 / 20 | 1.33-1.87 | |
| 17 (17x31, three runs) | 34 / 28 | 1.65-2.00 | |
| 35 (35x22, two runs) | 63 / 55 | 1.57-1.80 | |
| 40 (wave 4; Mini control 88 / 61) | 87 / 63 | 1.58-2.17 | 99 / 72 |
| 72 | 131 / 103 | 1.43-1.82 | 131 / 103 |
| 80 | 140 / 117.5 | 1.47-1.75 | 178 / 150 |
| 88 | 167 / 146 | 1.66-1.90 | 210 / 182 |
| 96 | 175.5 / 154.5 | 1.61-1.83 | 238 / 211 |
| 112 | 201.5 / 177.5 | 1.58-1.80 | 233 / 205 |
| 250 | 235.5 / 209.5 | (cap) | 255 / 229 |
| 315 (315x200) | 229.5 / 213.5 | (cap) | 308 / 280 |
| 325 | 213 / 199 | (cap) | 275 / 247 |

**Findings.**
1. **The landing zone is a square, not a circle**: the game lands the
   ship when max(|dx|, |dy|) <= R. On the square every bracket of both
   waves agrees with **R = k x W, k between 1.66 and 1.75** (about 1.7),
   up to a **cap of about 210-215 px** (250, 315x200 and 325 art: 209.5
   landed, 213.5 landed, 213 too far, within the 2-5 px a big clipped
   sprite's centre is good to). On the circle the wave-4 planets need k
   from under 1.82 (72 px) to over 2.2 (96 px): no single k fits, which is
   why wave 4 found "no smooth function of S hits every bracket".
2. **W is the frame's WIDTH.** The tall stations land like 15 and 17 px
   objects (1.7 x 15 = 25.5 in 20-28; 1.7 x 17 = 29 in 28-34), not like 21
   and 31 px ones (36 and 53, both "too far" by then); the wide 35x22 like
   35 (59.5 in 55-63), not 22 (37: it landed at 55). (The square ones can't
   tell width from height.)
3. **The station flag (0x10) changes nothing measurable.** The 17x31 art
   as a planet (28-35 on the square) sits inside the station's 28-34.
   Stations say "dock" in every message ("You're too far away to dock at
   this station.") where planets say "land".
4. **The player's hull does not matter.** The 40x40 control with the 24 px
   Shuttle-sprite hull agrees with wave 4's 48 px Lightning hull.

**NovaJS (main 06284d69):** `N/nova_plugin/travel/planet_plugin.ts:187-190`
(`landingRange`: R = max(min(2 S, 240), 0.8 S), S = max(w, h)) and the
circular distance test against it (`distanceSquared >= range * range`, lines
308-313, before the speed gate at line 316). Against the square rule:
**mismatch** in shape (a circle of 2 W is about 18% too generous straight on
and about 17% too strict on the diagonal, where the square reaches 1.7 x
1.41 = 2.4 W), in the input (max(w, h) gives the 17x31 station 62 px where
the original allows about 29) and in the cap (240 and the 0.8 S floor give
the 315-325 px art 252-260, the original about 212). **Applied in
bd344b9f** ("Landing zone is a square from the frame width"):
`N/nova_plugin/travel/planet_plugin.ts` lands when max(|dx|, |dy|) <= R
(`landingDistance` / `inLandingZone`), R = min(1.7 x frame width, 212)
(`LAND_RANGE_PER_FRAME_WIDTH`, `LAND_RANGE_CAP`, both named as fitted);
"too far" still before "too fast", the 20 px/s gate unchanged. A stellar
with unknown data (the default 50 px frame) gets 85 px. The touch
autopilot (`N/autopilot.ts`) arrives on the same square at 90% of R.
`planet_plugin_test.ts` presses every at-rest bracket of both tables
through `AttemptLandingSystem`; the one miss is the 315x200 art's
213.5 px landing, 1.5 px past the cap, which no cap can fit together with
the 325 px art's 213 "too far" (both within the big sprites' centre
error).

Confidence: high that the zone is a square (it is the only shape that
fits the 17x31 diagonal/straight pair and all twelve brackets at once) and
that the width sets it; medium on k (1.66-1.75 from the tightest brackets)
and on the cap (three big planets, their centres +-5 px).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w6/u9/{st-17x31,st-15x21,st-35x22,st-40mini,fine-15x21,fine-17x31,fine-35x22,fine-17x31p}/*/`
(`recording.mp4`, `recording.events.json`, `track.json`,
`track_summary.json`, `msgs/` and `msgs.png`); wave 4's offsets from
`~/.local/share/novaref/evidence/20261123-w4/u9/step-*/*/track_summary.json`.

### B wave 6: NPC carriers and their fighters' blasts; why the kit bombers never launched (2026-11-23)

**1. The fight brought to the carrier.** mïsn 1001 puts the STOCK Fed
Carrier (gövt 362, always attacks the player; düde 278) at Kit Port, where
the player (Kit Lancer, no weapons, 30000 shield) sits after taking off;
`scenarios/carrier_beside.json` reads every ship with Tab every 1.3 s for
110 s. The carrier stayed about 280 px north of the player, launched its
Vipers and Anacondas, and they fought around the player, so every blast
(the 400 px Kit Blast Shell) reached the carrier too.

| run | Viper blast | carrier shield (Tab panels, in order) | Vipers | carrier's fire |
|---|---|---|---|---|
| `viper_blast.mjs` (50 damage) | 50 | 86, 69, 60, 50, 43% in the first 13 s, then 44 ... 50% (recharging) | 58%, 46%, armor 67%, then gone from the Tab cycle by about 12 s (60 shield + 30 armor: their own blasts) | on the player all run (its shield bar fell 146 -> 130 px) |
| `viper_blast1.mjs` (1 damage, new wëap 243), run 1 | 1 | 99-100% throughout | 32 Viper readings over 110 s, shields 12-99% (their own 1-point blasts at several per second), **none destroyed**: Vipers in the Tab cycle to the last panel | on the player all run (146 -> 120 px) |
| the same, run 2 | 1 | 99-100% throughout | Viper shields 1-98%, then armor 54%, 12% and two **Disabled** Vipers in the last panels: worn down a point at a time (each reading a little lower than the last), never a sudden loss; none destroyed | on the player all run (146 -> 120 px) |

**Finding.** A carrier hit by its own fighters' blasts, heavily (57% of
its shield in 13 s) or constantly (a 1-point hit several times a second
for 110 s), **does not turn on them**: its fire stayed on the player, and
in the 1-damage runs every Viper (90 points of shield and armor, a few
hits for a Fed Carrier's guns) lived to the end. In the 50-damage run the
Vipers died of their own blasts within about 12 s, as B1 would predict.

**NovaJS (main 06284d69):** `N/nova_plugin/npc/npc_targeting.ts:64-74`
(`NpcAggressionSystem`) never records a damager in the victim's own flock
as its aggressor (`sameFlock`, `N/nova_plugin/npc/allegiance.ts:157`), so a
carrier ignores its fighters' blasts: **matches**. And NPC carriers do
launch now (`N/nova_plugin/npc/npc_fire_control.ts:28-36`, "BAYS
INCLUDED"), which also matches wave 5's stock Fed Carrier; wave 5's "NPC
carriers never fire their bays" note is out of date.

**2. Why the kit bombers never launched: a kit bug, not the game.** One
factor per run (`scenarios/carrier_watch.json`, traffic carriers of gövt
362; each Fed Carrier hull kept its stock Anaconda bay as an in-run
control): the stock Viper's bytes under a new id (shïp 784), the same armed
only with the blast shell (785), the same with the kit's shipBase fields
(786). **All three launched only Anacondas.** So did the stock Viper's bytes
at shïp 415 (the first id after the stock block), except that this time the
system filled with pirates: the bay's AmmoType, written by the kit as `id -
128` = 287, named the stock **Pirate Carrier** (shïp 287), which the carrier
duly launched, and which launched its own fighters. The stock Viper Bay
(wëap 149) holds **144**, the Viper's own id: a bay's AmmoType is the
carried shïp's id itself (the Bible says so; the repo's parser,
`BayWeaponParse` at `P/parsers/weapon_parse.ts:362`, already reads it that
way). Every kit bay since wave 1 pointed at `id - 128`, a missing ship.
Fixed in the kit (and a harness spec now checks every kit bay); rerun with
the fix:

| carrier | before (id - 128) | after (AmmoType = id) |
|---|---|---|
| Kit Bomb Carrier (shïp 712) traffic, sÿst 2004 (wave 5's `w5_carrier`) | never launched (wave 5) | **launched Kit Bombers** (four in the Tab cycle) |
| Fed hull with the Kit Viper Clone bay (784) | Anacondas only | **launched Kit Viper Clones** and Anacondas |

A follow-up with the fixed kit (`scenarios/carrier_beside_kit.json`, mïsn
1007: the Kit Bomb Carrier, whose Kit Bombers carry only the 50-damage
400 px shell, beside the player) launched at once; the bombers' blasts took
the carrier to 88% and their own shields to 55, 18, 18 and 3%, but within
about 12 s the carrier had flown off north and Tab found nothing for the
remaining 95 s (carrier and bombers gone; the player was never hit). It
adds a carrier hurt by its own bombers but says nothing about retaliation.

So wave 5's "it is the carried ship that stops the launch" is withdrawn:
nothing about the bombers stopped them. Two older readings depend on the
same bug: **Q4**'s kit carrier with the Kit Fighter Bay (its "never
launched" rests on Q4b, the stock Fed Carrier, which also did not launch
for a ShipBehav-1 escort: that still stands), and **E-view**'s "four taps
launched all four" Kit Fighter Bay fighters (the bay counter went 4 to 0,
but the bay pointed at a missing shïp 577; what flew out was not checked).

**Confidence:** high for the AmmoType bug (stock bytes, a launch of the
wrong ship, and two clean reruns) and for the launch rerun; medium-high for
"no retaliation" (two blast strengths, one and two runs, sustained over 110
s; the two Vipers that ended Disabled in run 2 had been losing armor a point
at a time, which the carrier's guns would not do; a carrier's change of
target is read from its fighters surviving and its fire staying on the
player, not seen directly).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w6/carrier/{beside,beside1,launch-784,launch-785,launch-786,launch-415,kitbomb-fixed,launch-784-fixed,kitbomb-beside}/*/`
(`panels.png` where made, the `NN-obs-*.png` Tab shots, `recording.mp4`,
`hostility.json` = the player's own bars). `launch-415` is the pirate run.

### J wave 6: Seeker 0x0020 under ion fire, and missiles at cloaked targets (2026-11-23)

**Ion (Seeker 0x0020 "Can't fire if ship is ionized").** The player flies
Kit Lancer Ion (shïp 792: Kit Lancer Heavy with IonizeMax 100, Deionize 1)
and sits 6 s under the fire of an immobile hostile Ion Target (gövt 362,
AI 3, armor 100) before holding the secondary trigger for 20 s at it.
`scenarios/jam_fire_ion2.json`; the missiles differ only in the flag.

| run | target / ion gun | player ionized? | missile | hits / about 49 launched |
|---|---|---|---|---|
| take 1 (`jam_fire_ion.json`) | at Kit Market, 900 px; wëap 242 (the Tickler with Ionization 50) | **no**: no bolts ever reached the player, and it turned at full rate (about 180° in 1 s) | JamM Ion (0x0020) | 48 |
| | | | JamM V100 (control) | 48 |
| take 2 | beside the player at Kit Port; wëap 245 (the Kit Escort Gun, 1 damage, Ionization 200) | **yes**: the hull is drawn in the ion colour (blue) from the first shot, and a 1 s Left turns it only a fraction of the un-ionized turn | JamM Ion (0x0020) | **0** (armor 100% at 20 s and 12 s later) |
| | | yes, the same | JamM V100 (control) | **48** |

**Finding.** An ionized ship **cannot fire 0x0020 weapons at all** (0 of
about 49 trigger frames launched one), and fires its other missiles
normally (48 of 49 hits in the control, the same as un-ionized). The
take-1 failure is a rig lesson: an immobile AI 3 never fired a
Tickler-based turret at 900 px; the Kit Escort Gun at close range works.
Where "ionized" starts (NovaJS: above half of IonizeMax) was not measured:
200 a hit against an IonizeMax of 100 saturates it.

**NovaJS (main 06284d69):** `N/nova_plugin/combat/weapon_plugin.ts:349-352`
blocks a `cantFireWhileIonized` weapon while the ship is ionized
(`N/nova_plugin/ship/ionization_plugin.ts:24-29`: the level test, the
IonizeColor tint and the 0x0020 gate): **matches**. Confidence: high
(0 vs 48, same hull, same ion fire, the tint visible in every shot).

**Cloaked targets.** The kit's own cloak (oütf 447, ModType 17) on an AI 1
or AI 3 hull with Flags2 0x0800 never cloaked (takes 1-2: Tab found the
target without any scanner). The working target is **Cloak Target W**
(shïp 798): the immobile 100-armor J0 hull with the STOCK Wraith Cloaking
Device (oütf 266) and the stock Wraith's cloak Flags2 0x5F00, AI 3,
neutral. Each cell is fired twice, with the player carrying **oütf 449
Kit Cloak Scanner T** (ModType 30, 0x000C: may target cloaked and
untargetable ships, reveals nothing on screen or radar) and without it.
Panels: Tab, aim, then 5, 10, 15, 20 s into the trigger, 6 and 12 s after.

| target | scanner | target panel | hits |
|---|---|---|---|
| at Kit Market, 900 px (mïsn 1009) | none | 100, 100, then **No Target** from 5 s on | (target lost; the missiles fly straight off along the launch heading) |
| | 0x000C | 100, 100, 100, 85, 73, 61, 51, 51% | **49** |
| at Kit Port, player 250+ px away (mïsn 1008, `jam_fire_away.json`) | none | 100, 100, then **No Target** from 5 s on | (target lost; straight trails) |
| | 0x000C | 100, 100, 100, 88, 77, 66, 54, 51% | **49** |
| at Kit Port, beside the player | either | (missiles detonate at launch on the 25 px fuse: no test) | |

**Finding.** The Wraith-cloak target cloaks within 5 s of the trigger
(Flags2 0x4000 "cloak when preemptively attacked" is among its flags):
without a scanner the player's target drops to "No Target" and later
missiles have nothing to home on. **With a scanner that lets the player
keep a cloaked ship targeted, every missile still homes and hits** (49 of
about 49, exactly the uncloaked rate), in two geometries. The target
was off screen in both scanner runs, so "cloaked" there rests on the
identical no-scanner runs, where it vanished from the target panel at the
same moment.

**NovaJS (main 06284d69):** `N/nova_plugin/combat/projectile_plugin.ts:321-334`
("Missile lock vs cloak"): a homing missile loses its lock while its
target is cloaked, "a cloak scanner on the missile's PARENT ship does NOT
keep its missiles tracking". **Mismatch** for the scanner case: the
original's missiles kept tracking. **Applied in 2ccf6ee9** ("A parent's
cloak scanner keeps its missiles homing on a cloaked target"): when the
parent (the missile's owner, else the ship it was fired from) has a cloak
scanner that can target cloaked ships (ModType 30 flag 0x0008, the
`isTargetable` test the ship's own targeting uses), its missiles keep
homing on a cloaked target. The no-scanner case (target dropped, later
launches unguided) matches and is unchanged.
Confidence: medium (two runs per cell, clean 49-vs-lost contrast; the
cloak itself inferred from the paired runs).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w6/jam/{ion,ion-ctrl,ion2,ion2-ctrl,cloak,cloak2,cloak2-noscan,cloak3,cloak3-noscan,cloak4,cloak4-noscan,cloak-away,cloak-away-noscan}/*/`
(`06-ionized.png`, `07-turn-test-before-fire.png`, the target panels,
`recording.mp4`). `cloak`/`cloak2*` are the kit cloak that never
engaged; `cloak3*` the point-blank runs.

### Asteroid decoy capture wave 6: range or per-tick chance? (2026-11-23, not separated)

**Setup.** The brief asked for many single-missile passes with a rock dead
ahead at 150 / 200 / 250 px. The original still gives no way to place a
rock (wave 5), so this wave ran wave 5's rig twice more
(`scenarios/decoy_single.json`, pilot `w5_decoy3`: three drifting rocks,
one JamM Decoy every 2 s for 90 s, target 250 px east) and wrote
`analysis/decoy_encounters.mjs` to tabulate, from `decoy_track.mjs`'s
tracks, how long rocks sat in each (distance, bearing-off-heading) cell
before any capture: with a hard range, rocks never linger inside it
uncaptured; with a per-tick chance they do.

| run | hits / 45 | lost |
|---|---|---|
| wave 5 decoy3 | 25 | 44% |
| wave 6 run 1 | 30 (11, 12, 7 per 30 s) | 33% |
| wave 6 run 2 | 31 (13, 13, 5) | 31% |

**Finding: not separated.** The automatic tracker is not good enough for
the question: over the four decoy recordings it found 161 tracks but a
capture onset for only 16, and its "rock ahead but not captured" cases do
not survive a look at the trail pictures: wave 5's two strongest (decoy3
missiles 4 and 17, a rock 23-25 px dead ahead for 18-24 frames, "ended on
the target") both end in a puff on a rock; of this wave's four candidates
one (run 2, missile 6) passes under a rock streak and hits the target, but
the streak is the rock's whole path over 2.4 s, not where it was when the
missile passed. Settling it needs a rock that holds still or a clean
per-frame rock-to-missile geometry, which these recordings don't give.
The loss rate with three rocks varies 31-44% between identical runs.

**NovaJS (main 94771e3a "Seeker 0x0002: only rocks ahead capture a
missile (25° cone, 200 px)"):** `N/nova_plugin/combat/jamming_plugin.ts:195`
and `:221` (`ASTEROID_DECOY_CAPTURE_RANGE` 200,
`ASTEROID_DECOY_CAPTURE_HALF_ANGLE` 25°), a certainty within range and
cone: consistent with wave 5's captures; whether the original's is a range
or a chance is still open. No change proposed.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w6/rocks/decoy3/*/`
(`recording.mp4`, `tracks.json`, `tracks_summary.jsonl`, the panel shots,
`missiles/m*.png` for the checked candidates) and
`rocks/decoy3/encounters.json`.

### A wave 6: gövt 0x0010, jump or stand off? (2026-11-23)

**Setup.** Wave 4-5's `scenarios/ai_tank.json` (AI 3 AI Tank Disc of gövt
383: 1000 shield, 30000 armor; the player holds fire about 85 s, then
watches; `analysis/hostility.mjs --colour yellow` gives the tank's distance
every second; "jumped" = gone from the Tab panel for good, it can't be
killed in that time). New cells:
- `w6_ret_8guns`: 8 Kit Escort Guns (twice wave 4's damage rate);
- `w6_ret_beam`: one Kit Long Beam (new wëap 246: beam turret, 1500 px,
  every 15 frames), to strip the shield while the tank is still far out.
  At 200 damage it disabled and destroyed the 30000-armor tank within about
  17 s (a beam deals its damage on every frame of its 4-frame Duration), so
  those two runs say nothing about retreating; the runs below use 15
  (about 120 damage a second, roughly 2.7 Kit Escort Guns).

Wave 4-5's heavy-fire runs re-read for **where the tank was when its
shield crossed 25%** (shield from the panels, distance from the
hostility timelines; trigger at about 7.4 s, crossing 3-8 s later):

| run | damage | shield at the first panels | tank's distance around the crossing | outcome |
|---|---|---|---|---|
| w4 4 guns, run 1 | 4 guns | 51, 11% | 242 px at 10 s, then off screen | stood off (362-408 px) |
| w4 4 guns, run 3 | 4 guns | 45%, down | **31 px** at 10 s (in a pass), 189 at 12 s | stood off |
| w5 Strength 1, run 2 | 4 guns | 51, 8% | 240 px at 10 s | stood off (377-420 px) |
| **w6 8 guns, run 1** | 8 guns | 3%, down | **10 px** at 8 s, 172 at 10 s | **stood off** (off screen) all 85 s; back to close passes (19-34 px) about 9 s after the release |
| **w6 8 guns, run 2** | 8 guns | down | **81 px** at 10 s | **stood off** all 85 s; back to close passes (15-50 px) about 11 s after the release |
| w4 4 guns, run 2 | 4 guns | 84, 50, 2% | **never on screen** | jumped |
| w4 4 guns, run 4 | 4 guns | 57, 11% | 83 px at 6 s, **261 px at 8 s, off screen from 10 s** | jumped |
| w5 Strength 1, run 1 | 4 guns | 57, 5% | 90 px at 6 s, **267 px at 8 s, off from 10 s** | jumped |
| **w6 beam 15, run 2** | beam, 1500 px | 52, 4%, down | **never on screen** | **jumped** ("No Target" from about 17 s after the trigger; it can't have been killed by then) |
| **w6 beam 15, run 1** | beam, 1500 px | 52, 4%, down | **off screen until 32 s** (far at the crossing) | **fought on**: close passes (25-60 px) at 32-40 s and from 56 s to the end, under fire, shields down |

**Findings.**
- **Twice the firepower does not make it jump**: both 8-gun runs stood off
  for the whole 85 s of fire and came straight back afterwards. So it is
  not "more damage, more jumping" (wave 4's reading).
- **Where the tank is at the crossing sorts every run so far**: the three
  that jumped were already receding past about 260 px, or never came
  within view, when the shield went under 25%; the five that stood off
  were in or just out of an attack pass (10-240 px). So the rule looks like
  "retreat while losing: jump if already far from the attacker, else hold
  off at 360-420 px", rather than a coin toss.
- **But not without exception**: of the two beam runs, built to strip
  the shield far out, one jumped (never in view) and one, also far at the
  crossing, came back and fought on under fire for the rest of the run,
  as the 1-gun tanks mostly did. Its damage rate (about 120 a second) is
  the lowest of the heavy-fire cells, so distance and damage rate are
  still tangled, and some run-to-run randomness remains: far at the
  crossing jumped 4 times of 5, near never (0 of 5).

**NovaJS (main 06284d69):** `N/nova_plugin/npc/npc_retreat.ts:57-68` (and
`warshipRetreat`, line 109): a losing tank always stands off at 360-420 px
first and jumps after `RETREAT_JUMP_MS` (16 s) of losing. Against the
original: the stand-off cases **match** except that the original holds a
stand-off for the whole fire (85 s) without jumping, and the far-away cases
**mismatch** (the original jumps at once, without a stand-off).
**Proposed (not applied), tentative:** when the retreat condition first
holds, jump if the ship is farther than about 300 px from its attacker,
else stand off and keep standing off while the fire lasts (no 16 s jump
timer). One far run fought on instead, so a ruling may prefer to keep
some randomness. (Not applied: wave 7 showed distance does not decide it;
a random draw at the crossing was applied instead, in a6c1143b.)

Confidence: low-medium. Ten runs: near-at-the-crossing never jumped (5
of 5 stood off), far jumped 4 of 5; distance and damage rate are not
separated, and the crossing times are read from panels 4.7 s apart.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w6/ai/{ret-8guns,ret-beam15}/*/`
(`hostility-yellow.json`, the `NN-fire-*`/`NN-after-*` panels,
`after_panels.png`); wave 4-5 runs as cited in "A-series wave 5". The
`ret-beam/*-INVALID-open-pilot-failed` dir is a harness flake (the Open
panel did not close); `ret-beam/*-INVALID-beam200-killed-tank` are the
200-damage beam runs.

### E-recall wave 6: how variable the recall overshoot is (2026-11-23)

**Setup.** Wave 3's `scenarios/esc_recall2.json` three more times (pilot
`w3_recall`: Kit Lancer and two hired Kit Disc Blue Armed escorts, Speed
600, quiet Kit Range; `v`, thrust 2.5 s, brake, wait, `c`). The new
`analysis/recall_frames.mjs` links each blue disc into a track and gives,
after `c`: first frame on screen, closest pass, farthest swing-out after it
and the settling frame (steady within 2 px for 30 frames). Frames after
`c`, 30.04 fps; the player is at rest, so screen distance = world.

| run | escort | on screen (frame, px) | closest pass | swing-out after it | settled (frame, s, px) |
|---|---|---|---|---|---|
| w6 run 1 | A | 120, 424 | **9 px** at 168 (full-speed dash, about 9 px/frame) | **389 px** at 248 | 491, 16.3 s, 31 |
| | B | 125, 430 | 9 px at 179 | **298 px** at 249 | 455, 15.2 s, 29 |
| w6 run 2 | A | 135, 306 | 8 px at 171 (dash) | 46 px at 188 | 248, 8.3 s, 28 |
| | B | 141, 309 | 75 px at 170 | 146 px at 211 (briefly off the edge) | 350, 11.7 s, 27 |
| w6 run 3 | A, B | 134-140, 258-297 | **no pass**: already slowing as they came on screen (2.5, then 1.2 px/frame) | none | 305-320, 10.2-10.7 s, 40-41 |
| wave 5 | A | 135, 312 | 18 px at 171 | > 315 px (off screen) | 546-561, 18.4 s, 29 |
| wave 3 | | 4.5 s, 315 | 34 px at 5.7 s | 123 px | 10.1 s, 29 |

After the swing-out every returning escort closed at a slow, nearly
constant 1-1.6 px/frame (35-48 px/s), whatever its overshoot.

**Findings.**
- **The overshoot varies from none to about 390 px** between identical
  runs: two of five recalls dashed through the slot and swung out 300-390
  px, two overshot by 46-146 px, one came in slowly with no overshoot.
  Settling took 8.3 to 18.5 s accordingly.
- What decides it is not in these recordings: the escorts are off screen
  for the 4-4.5 s before they appear. The no-overshoot run's escorts were
  already decelerating when they came on screen, so the difference is set
  before that, probably by how they were moving when `c` was given (they
  were left on Hold Position while the player thrust away and braked).
- The slow final approach (35-48 px/s from up to 390 px out) is the
  constant part.

**NovaJS (main 06284d69):** `N/nova_plugin/npc/npc_formation.ts:49-64`
caps the closing speed at what the hull can brake from
(`FORMATION_BRAKE_FRACTION`), so a recalled escort never overshoots: it
matches run 3 and none of the others. Not worth copying a 0-390 px random
overshoot; the long, slow last approach (an escort 300 px out taking 7-10 s)
is the one systematic difference. **Proposed (not applied):** none for the
overshoot; optionally cap the final closing speed near the slot at about
40 px/s for Speed-600 escorts if the faster NovaJS settle looks wrong in
play.

Confidence: high for each run's timeline (frame-exact tracks); the spread
(five runs over three waves) is the finding.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w6/escorts/recall/*/`
(`recording.mp4`, `recording.events.json`, `recall_frames.json` with every
frame's disc distances, `recall_summary.json`).

### E-view wave 6: the escort panel while the full map is open (2026-11-23)

**Setup.** `scenarios/esc_panel_map.json`, pilot `w3_recall` (two hired
escorts, quiet Kit Range, the player at rest). Each trial opens the panel
(`e`), opens the full map (`m`) 64 frames later and closes it again with
`m`, either about 4 s later (A: before the panel's 8.3 s are up) or 10 s
later (B: after). Two of each. `analysis/region_lit.mjs` times the panel
from its rows' bright pixels (the map lights the same rect while it is up,
so only the frames after each close matter); frames are recording frames.

| trial | `e` | map open / closed | panel gone at | frames after `e` |
|---|---|---|---|---|
| A, run 1 | 117 | 181 / 299 | 366 | **249** |
| A, run 2 | 1594 | 1659 / 1775 | 1843 | **249** |
| B, run 1 | 762 | 826 / 1130 | 1142 (right after the close) | 380: gone at the close |
| B, run 2 | 2236 | 2300 / 2605 | 2616 (right after the close) | 380: gone at the close |

**Findings.**
- **The timer keeps running while the map is open.** After a short map
  visit the panel was still there and closed exactly 249 frames after `e`,
  as with no map (wave 4: 249-250); after a 10 s visit it was already gone
  when the map closed. If the map paused it, it would have stayed up until
  about 186 frames after the close.
- **The map does not close it.** In the shot taken with the map open, the
  panel is still drawn in the strip of space view left of the map window
  (`01-a00-map-open.png`, "Escort Comm..." with the All Ships bar), and it
  is back in full when the map closes early.

**NovaJS (main 06284d69):** `N/display/escort_panel_plugin.ts:237-240`
keeps advancing the 250-frame timer while the full map is up ("not
measured on the original"): **matches**. It hides the panel while the map
has focus (line 244); the original keeps drawing it where the map does
not cover it, which only matters in a window narrower than the map. No
change proposed.

Confidence: high (four trials, each within a frame of the expected close).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w6/escorts/panel-map/*/`
(`recording.mp4`, `recording.events.json`, `lit.json`, the map-open and
map-closed shots).

### U9 wave 6: boarding a non-mission disabled ship (2026-11-23)

**Rig (built this wave).** sÿst 2020 Kit Board Range (one stellar) whose
only traffic is one **Kit Hulk** (shïp 795: an immobile 24 px magenta disc,
armor 300, shield 0, crew 1, cost 50,000, cargo 50, fuel 3000; and Kit
Hulk Cheap, shïp 799 in sÿst 2022, the same at cost 20,000) of the
derelict gövt 378 (flags 0x0800: starts disabled), düde 287 with booty flags
0x0041 (food and money). It is ordinary traffic, not a mission ship, and it
appears wherever the game puts it (806-2235 px from the player at the start
of these runs). The player is a Kit Crawler 100 (inertialess, 44 px/s).
`scenarios/board_hulk.json` runs the new closed-loop step `loops/board.mjs`
(README "Boarding loop"): find the hulk (colour on screen, the radar blip
off screen), measure the heading from the shift of what is on screen after a
straight leg, turn, fly, brake, repeat; then step in (0.12-0.25 s of thrust
per step, Down to a stop, `b`, shot) until the plunder dialog opens, then
click Credits, Cargo, Abort. Distances are the disc's centre from the
player's (screen = world, the player at rest).

| run | approach | `b` at rest: "You're not close enough to board this ship." at | plunder dialog at |
|---|---|---|---|
| 1 | 2235 px, radar; the loop stopped after leg 1 (fixed: the stellar's radar square was taken for the target) | | |
| 2 | 806 px, one leg | 28.5 px (-10.5, -26.5) | **16.8 px** (-5.4, -15.8) |
| 3 | 828 px, one leg, then 10 steps of 0.12 s | 104 ... 28, **20.7 px** (-17.8, 10.6) | **15.2 px** (-14.9, -3.0) |
| 4 | on screen at 225 px, 15 steps | 155 ... 24, **16.0 px** (-15.4, -4.3) | 7.6 px (4.2, 6.3) |
| Cheap 1 (shïp 799, cost 20,000) | 4 legs | ... **18.5 px** (0.5, 18.5); at 10.1 px (-4.5, 9.1) **no answer at all** | **13.2 px** (8.4, 10.2) |
| Cheap 2 | 2 legs | ... **14.9 px** (5.6, 13.9); at 10.0 px (-7.4, 6.7) **no answer** | **12.4 px** (11.2, 5.4) |

| run | Cargo | Credits | Ammo | Energy | Capture Odds | Capture Ship |
|---|---|---|---|---|---|---|
| 2 | 46 tons of food | **1,250** | None | 2,810 | 0% | greyed |
| 3 | 44 tons of food | **1,250** | None | 590 | 0% | greyed |
| 4 | 38 tons of food | **1,250** | None | 2,310 | 0% | greyed |
| Cheap 1 (cost 20,000) | 32 tons of food | **1,000** | None | 1,590 | 0% | greyed |
| Cheap 2 | 45 tons of food | **1,000** | None | 1,650 | 0% | greyed |

Clicking Credits empties that line ("Credits: None") and greys its
button; clicking Cargo then closed the dialog.

**Findings.**
1. **Boarding needs the ships practically on top of each other: about
   13-17 px centre to centre.** Every stop from 155 down to 14.9 px said
   "not close enough"; the dialog opened at 7.6-16.8 px; the boundary
   overlaps by a couple of px between runs (16.0 failed in one run, 16.8
   opened in another; the disc centres are good to about +-1 px). That is
   about the hulk's own 12 px radius plus a few px. Two presses at about
   10 px, one in each cheap run, got no answer at all (no message, no
   dialog); the next stop a few px away answered normally. With all stops
   at rest no "moving too fast" came up; wave 3's "too fast" at 87 px/s
   stands.
2. **The money booty is fixed per hull but not a fixed share of the
   price:** 1,250 credits for the 50,000 hull (3 of 3 boards, 2.5%) and
   1,000 for the 20,000 one (2 of 2, 5%). Cargo (32-46 of the hulk's 50 tons
   of food) and energy (590-2,810 of its 3,000 fuel) vary per board.
3. **Capture odds 0% and Capture greyed** against a crew-1 hulk with a
   crew-10 player hull, every time. Why is not known (the derelict govt,
   the hulk's 0 shield, or the player's hull); not chased.
4. Wave 3's mission prize ("You can't board this ship.", sticky) was a
   mission special-ship rule: an ordinary disabled ship boards normally.

**NovaJS (main 06284d69), `N/nova_plugin/ship/boarding_component.ts`:**
`BOARD_DISTANCE_SQUARED` = 22,500 (150 px, line 227): **mismatch**, about
10x the original's reach; `CREDIT_BOOTY_FRACTION` = 0.10 (line 243): 5,000
and 2,000 credits for these hulls against the original's 1,250 and 1,000,
**mismatch**; cargo up to the victim's load and the remaining fuel as
"Energy" match in kind (the original's amounts are a random share);
`CAPTURE_CHANCE_MIN` 0.05 (line 247) would offer a capture where the
original greyed it out.
**Proposed (not applied):** a board range of about 15 px between centres
(or "the sprites overlap"; only 24 px hulks were tried). For the money, two
prices are not enough to fit a rule (a fixed share fails: 2.5% vs 5%; a
line through both is 833 + price / 120); a third and fourth price, and a
bigger hull for the range, would settle it before changing NovaJS.
**Applied in ef61904a** (ruling #378, "match the original fully"), with the
data of waves 7-8: a square range from both sprites (`boardingRange`, 12 px
for this 24 px pair), the money rule of wave 8 (`creditBooty`), and no
capture of a derelict (`capturable`). Details under wave 8.

Confidence: high for the range (five boards, about twenty "not close
enough" stops, every boundary within 2 px); high that the money is fixed
per hull (5 of 5 boards repeat their hull's amount), low on how it scales
with price (two prices).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w6/u9/{board,board-cheap}/*/`
(`NN-b-NN.png` = the status line or dialog after each `b`,
`NN-dialog-*.png`, `log.jsonl` phase `script` with every leg and stop,
`recording.mp4`). Run 1 (`*130836*`) is the radar bug.

### J wave 6: how tight a confused missile's loop is (2026-11-23)

**Question (hub).** Missiles confused by sensor interference loop about
70 px across on the original (wave 5's trail pictures); NovaJS's confused
missiles, which turn at the parsed GuidedTurn, loop about 115 px across.
Do confused missiles turn faster than GuidedTurn, or is GuidedTurn's
conversion off for every missile?

**Setup.** No new driving: wave 5's two J recordings fire the same missile
(wëap 235 JamM Interf: Speed 600, GuidedTurn 60, Seeker 0x0008, JamVuln 0)
from a player that sits still, so screen = world. In Kit Static Control
(Interference 0) every missile leaves along the player's launch heading
and turns onto the target 900 px east: that turn is an ordinary homing
turn at full rate. In Kit Static Range (Interference 100) the confused
ones loop. `analysis/decoy_track.mjs` tracked every missile head per
frame; the new `analysis/missile_circles.mjs` fits a circle to every
stretch of a track that keeps turning one way (rms under 2 px, more than
60° swept) and gives its diameter and turn rate. Frames are video frames
(30.04 fps).

| missiles | arcs fitted | turn per video frame (median, range) | circle diameter, centre line (median, IQR or range) | speed |
|---|---|---|---|---|
| ordinary homing turn (Interference 0) | 40 (one ~65° arc each) | **5.7°** (IQR 5.4-6.0) | **115 px** (IQR 109-124) | 5.85 px/frame |
| confused (Interference 100) | 16 tracks, up to 8 laps | **10.3°** (9.4-11.2) | **63 px** (60-70) | 5.85 px/frame |
| #316b's Kit Missile T60 (wave 1) | 1 | 5.66° | (118 px) | 5.85 px/frame |

**Findings.**
1. **GuidedTurn's conversion is right.** The ordinary JamM turn, 5.7° per
   video frame = 5.9° per 29.1 Hz game frame, is GuidedTurn 60 / 10 per
   frame, as #316b found with another missile; its circle would be 115 px
   across, exactly what NovaJS draws.
2. **A confused missile turns about 1.8x faster than its GuidedTurn**
   (10.3° vs 5.7° per frame at the same speed), hence the 63 px loop (wave
   5's "about 70 px" was read off the trail picture's outer edge, sparkles
   included). One GuidedTurn was measured, so "1.8x" and "GuidedTurn plus
   a constant" can't be told apart.
3. **The loops drift a little.** The four tracks followed for 2.6-8 laps
   moved their fitted centres 62-147 px over the run, about 10-25 px per
   lap, so the trail is a ring of slightly offset loops rather than one
   circle. Both directions occur (5 clockwise, 11 counter-clockwise tracks;
   some may be pieces of the same missile).

**NovaJS (main 06284d69 "Seeker 0x0008: sensor interference confuses
missiles into circles").** A confused missile turns "at the full turn rate
... for the rest of its life" (`N/nova_plugin/combat/jamming_plugin.ts` doc
at line 557, `confusedTurning` at line 582, applied in
`ProjectileGuidanceSystem`,
`N/nova_plugin/combat/projectile_plugin.ts:302-310` on main), the rate being
the parsed GuidedTurn (`P/parsers/weapon_parse.ts:313`). So its loop is the
115 px circle of finding 1, closed, with no drift. **Mismatch** on the size.
**Applied in bdc43534** ("Confused missiles turn at 1.8x their turn
rate"): a confused missile turns at `CONFUSED_TURN_RATE_FACTOR_FITTED`
= 1.8 x its turnRate, both directions (`N/nova_plugin/combat/jamming_plugin.ts`
`confusedTurning`), so the JamM loops 2 v / (1.8 w) = 63.7 px across;
GuidedTurn's conversion and ordinary guidance are unchanged, and the
drift is left out (closed loops).

Confidence: high for the two rates (40 and 16 independent arcs, tight
spreads, same missile, same rig); medium for the drift (four long tracks);
the 1.8 factor is one GuidedTurn value only.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w6/jam/turn-circles/`
(`NOTES.txt`, `static_tracks.json`, `static_circles.json`,
`ctrl_tracks.json`, `ctrl_circles.json`), from the wave-5 recordings
`20261123-w5/jam/{static,static-ctrl}/*/recording.mp4`.

### B wave 7: what the kit-bay bug invalidated, and a carrier that stays with its bombers (2026-11-23)

Wave 6 found that every kit bay pointed at a missing ship until the kit
was fixed (AmmoType = the carried shïp's id). Three readings rested on a
kit bay; each is rerun once here with the fixed kit.

**Q4 (a ShipBehav-1 protector carrier's fighters).** `scenarios/protect_observe.json`
with wave 1's pilot `q4` (mïsn 964: the Kit Carrier, govt 360, with the
Kit Fighter Bay of four Kit Fighters, now really pointing at shïp 705;
two always-attacks Kit Raiders). In 16 Tab panels over 70 s the cycle
was always Kit Carrier, Kit Raider, Kit Raider, No Target: **no fighter
ever launched**. The carrier fought with its guns (its shield 100, 81,
65, 66%; both raiders Disabled by about 50 s). **Q4 stands**: a protector
carrier keeps its bays shut, now with a kit bay that works (it is not
only the stock Fed Carrier of Q4b). NovaJS's hold on a flock mission
ship's bays (`N/nova_plugin/npc/npc_fire_control.ts:42-43`, `:163`)
**matches**.

**E-view (the player's own bay).** `scenarios/bay_launch.json`, pilot
`w7_bay` (Kit Lancer with the Kit Fighter Bay and 4 Kit Fighters, quiet
Kit Range): `w`, then four taps of Control. The bay counter went 4 to 0
and **four Kit Fighters flew out** (the stock shïp 167 art), taking up
formation around the player. Six Tab presses all read "No Target": the
player's own fighters are not Tab targets. The escort panel (`e`) showed
row 2 **Fighters** lit with **Formation**, rows 3-5 grey. The Kit Fighter
is EscortType -1 (the kit's shipBase), so a bay fighter with no
EscortType is filed under Fighters (wave 2 could not say where
EscortType -1 ships go; for bay-launched ones this is the answer). Wave
2's "four taps launched all four" therefore holds, now for the right ship.

**The carrier that stays in the fight.** Wave 6's Kit Bomb Carrier left
within 12 s, so `kits/testkit.mjs` wave 7 anchors it: shïp 800 Kit Bomb
Carrier Anchored (shïp 712 with Speed/Accel 0: two Kit Escort Guns and a
Kit Bomber Bay of four Kit Bombers, each armed only with the 400 px Kit
Blast Shell), gövt 362 (always attacks the player), mïsn 1010 at Kit Port.
One factor changed: shïp 802 / mïsn 1011, the same carrier whose bombers
(shïp 801) carry the **1-damage** shell (wëap 243). The player is Kit
Lancer Heavy (30000/30000, no recharge, no weapons), so anything that
hits it shows on its shield bar. `scenarios/carrier_anchored_kit.json`:
Tab every 1.3 s for 110 s. The carrier sat on top of the player at Kit
Port in both runs.

| run | carrier shield (Tab panels, in order) | bombers | player's shield bar |
|---|---|---|---|
| 50-damage shell (pilot `w7_carrier50`) | 83, 53, **40%** in the first 15 s, then 41-44% (recharging) | 33, 3% shield, armor 92, 69, 39%, then **Disabled** (all four by about 15 s) and still Disabled, not destroyed, at 110 s | 144 -> 108 px, falling at a constant rate (about 0.26 px/s) from 7 s to the end; trail picture at 90 s: hit puffs on the player |
| 1-damage shell (`w7_carrier1`) | 99-100% throughout | 93-99% shield, worn down a point at a time, all four flying and bombing to the end | **146 px, untouched** for 140 s |

**Finding.** With real kit bombers and a carrier that can't leave, the
carrier lost 60% of its shield to its own bombers' blasts in 15 s and
**never turned on them**: the four bombers, Disabled by their own blasts,
lay beside it for 95 s without being finished off (two Kit Escort Guns
would destroy a 500-armor bomber in seconds), and its guns went to the
player. With 1-damage blasts the bombers lived and kept flying for 110 s.
This repeats wave 6's stock-Fed-Carrier result with the kit's own
bombers. Side observation, not separated: in the 1-damage run **nothing
hit the player in 140 s**, so the carrier's two guns never fired at it,
while in the 50-damage run the player's bar fell at a constant rate from
7 s on (the carrier's guns: hit puffs on the player long after the
bombers were disabled). The only difference between the runs is the
bombers' shell.

**NovaJS (base cf893d56).** `N/nova_plugin/npc/npc_targeting.ts:73`
(`NpcAggressionSystem` skips a damager of the victim's own flock,
`sameFlock`): **matches** (no retaliation). No change proposed. The silent
guns of the 1-damage run are worth one more look (a stock carrier, more
runs) before anything is read into them.

Confidence: high for Q4 and E-view (clean single runs that show the
launch or its absence); medium-high for "no retaliation" (two runs, one
per blast strength, 110 s each, inferred from the bombers' survival and
the player's bar); the silent-guns observation is one run.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w7/{q4,bay,carrier/c50,carrier/c1}/*/`
(`panels.png`, the `NN-obs-*` / `NN-tab-*` shots, `10-panel.png` for the
escort panel, `hostility.json` = the player's bars, `recording.mp4`).

### U9 wave 7: boarding speed gate, money at five prices, a bigger hulk, capture (2026-11-23)

Wave 6's rig (sÿst 2020 Kit Board Range: one immobile 24 px magenta Kit
Hulk of the derelict gövt 378, ordinary traffic, booty food + money;
`loops/board.mjs` walks the player to it by measurement), extended.

**1. The boarding speed gate.** `loops/board.mjs` has a new `pass` mode:
the loop walks the player to rest a little way from the 50,000 Kit Hulk
(Kit Board Range, as in wave 6), aims at its centre, taps thrust (an
inertialess hull keeps the speed it has when thrust is released) and
crosses the hulk pressing `b` every 100-400 ms until it is well past,
then brakes; a dialog that opens is closed with Abort. Each press's
answer is the status line 8 frames later (`planet_track.mjs --key b`),
and the hulk's offset per frame comes from the new
`analysis/magenta_track.mjs`, which finds the magenta disc even under the
player's sprite. Speeds are measured from that track (video frames, 30.04
fps). Fast passes use Kit Crawler 25/40/50 (shïp 808, 809, 715); slow ones
Kit Crawler Soft (shïp 817: Accel 200, so a 100-290 ms tap sets the pass
speed). `scenarios/board_pass_{50,40,25,25_slowpress,soft4,soft8,soft8_fastpress,soft9}.json`.

| run | measured speed | `b` every | closest the centres came | presses | answer |
|---|---|---|---|---|---|
| Crawler 50 | 22 px/s | 100 ms | 2.4 px (line fit) | 58, from 67 px in to 69 px out | **"You're moving too fast to board this ship."** at every press, 67 px out included |
| Crawler 40 | 16 px/s | 100 ms | 3.6 px | 74, 48 px in to 70 px out | "too fast" at every press |
| Crawler 25 | 11 px/s | 100 ms | about 7-11 px | 150 (29 within 19 px) | **"You're not close enough to board this ship."** at every press, also on top of the hulk |
| Crawler 25 | 11 px/s | 400 ms | 7 px | 30 (presses at 15.1, 11.4, 10.2, 7.4, 8.8, 10.7, 13.5 px) | "not close enough" at every press |
| Soft, 290 ms tap | 9.2 px/s | 200 ms | 5.1 px | 53 | "not close enough", no dialog |
| Soft, 230 ms tap | 7.8 px/s | 100 ms | 5.7 px | 128 | "not close enough", no dialog |
| Soft, 230 ms tap | **7.3 px/s** | 200 ms | | | **plunder dialog** at about 16.5 px |
| Soft, 230 ms tap | **6.2 px/s** | 200 ms | | | **plunder dialog** at about 18.9 px (the presses at 27-20 px: "not close enough") |
| Soft, 100 ms tap | **3.4 px/s** | 200 ms | | | **plunder dialog** at about 17 px |

- **Boarding while moving needs under about 7.5-9 px/s** (boarded at 3.4,
  6.2 and 7.3; refused at 9.2 and 11, and at 7.8 with presses every
  100 ms, so the gate is between 7.3 and 9.2 px/s, possibly 7.3-7.8). That
  is far stricter than the landing gate (19-20.5 px/s, wave 4). The
  distance at which a slow ship boards (16.5-18.9 px) is the at-rest range
  of wave 6 (13-17 px) within the disc-centre error (the magenta centroid
  of a disc half under the player's sprite sits a px or two out).
- **"Too fast" is a second, higher threshold, and it is checked before
  distance**: at 16 and 22 px/s every press said "too fast", 67-70 px from
  the hulk included (at rest the same distances say "not close enough").
  Between the two thresholds (9.2 and 11 px/s) the game refuses with the
  misleading "not close enough" even with the ships on top of each other.
  So the "too fast" threshold is between 11 and 16 px/s.
- Pressing `b` every 100 ms or every 400 ms makes no difference at 11
  px/s (both refused throughout).

**NovaJS (base cf893d56), `N/nova_plugin/ship/boarding_component.ts`:**
`BOARD_REL_SPEED_SQUARED` = 3,000 (54.8 px/s, line 228), checked AFTER the
distance (`boardingBlockedReason`, lines 299-306). **Mismatch**: about 7x
too lenient, the order is reversed (NovaJS says "too far" to a fast ship
67 px out, the original "too fast"), and there is no "refused but says
not close enough" band.
**Proposed (not applied):** board only below about 8 px/s relative speed
(`BOARD_REL_SPEED_SQUARED` about 64); answer "too fast" first when the
relative speed is over about 13 px/s (the midpoint of 11-16), at any
distance; between the two, answer "not close enough" (it is what the
original prints) or, if that quirk is not wanted, "too fast".
**Applied in ef61904a** (ruling #378): `BOARD_MAX_REL_SPEED` 7.5 px/s
(boarded at 7.3, refused at 7.8); `BOARD_TOO_FAST_REL_SPEED` 13.5 px/s,
checked first at any distance; between the two the gate answers 'tooFar',
"not close enough", as the original does.

**2. Money booty, a bigger hull, capture.** `scenarios/board_hulk.json`
(wave 6's walk-and-board loop) on new hulks, each the only traffic of its
own system (`kits/testkit.mjs` wave 7: shïp 803-806 and 807, sÿst/spöb
2023-2027): the same immobile 24 px magenta Kit Hulk at other prices, a
96 px one at 50,000, and the 50,000 hulk boarded from Kit Crawler Crew
(crew 500 instead of 10). Two loop fixes came out of these runs: a step
that ends with the hulk hidden under the player's sprite used to end the
walk without a single press on top of it (it now presses there), and
stops under 12 px skipped the turn to face the hulk (it now always turns).

| hulk (price, sprite) | walks | stops and answers | dialog | Credits | Cargo / Energy | Capture |
|---|---|---|---|---|---|---|
| 2,000, 24 px | 1 | "not close enough" or no answer at 20, 15, 11, 12, 7, 13 px | at 12 px | **1,000** | 40 t food / 50 | 0%, greyed |
| 20,000 (wave 6) | 2 | | 12.4-13.2 px | **1,000** (2 of 2) | | 0%, greyed |
| 50,000 (wave 6 and this wave's passes) | 3 + 3 | | 7.6-18.9 px | **1,250** (6 of 6) | 26-46 t / 590-2,810 | 0%, greyed |
| 50,000, player crew **500** | 1 | nothing at 44, 33, 23, 17, 12 px | at 6 px | **1,250** | 26 t / 1,420 | **0%, greyed** |
| 2,000,000, 24 px | 3 | "not close enough" down to about 20 px, then no answer at 17, 13, 9, 5 and 5 px | **never** | | | |
| 50,000, **96 px** | 1 | "not close enough" at 77, 66, 55 px, then no answer at 46, 35, 25, 14, 2 px | **never** | | | |
| 100,000, 24 px | 1 | nothing at 37, 28, 20, 6, 12 px | at 8 px | **2,500** | 27 t / 670 | 0%, greyed |
| 500,000, 24 px | 2 | nothing at 57-18 px / 44-24 px | at 7 px / 18 px | **19,500** / **21,500** | 49 t / 1,150; 36 t / 2,190 | 0%, greyed |

**Findings.**
- **The money booty has a floor of 1,000 credits** (2,000 and 20,000
  hulls: exactly 1,000, three boards) and is **price / 40 in the middle**:
  1,250 at 50,000 every time (7 of 7) and 2,500 at 100,000 (one board,
  predicted from the first three prices before it was run). **At 500,000
  it is more, and it varies**: 19,500 and 21,500 in two boards (3.9% and
  4.3%, against 12,500 for price / 40). So above some price there is a
  random part (every amount seen is a multiple of 250), or a share that
  grows with the price; two boards can't say which.
- **Crew does not open capture**: 500 crew against the hulk's 1 still
  reads "Capture Odds: 0%" with Capture Ship greyed (and the same 1,250
  credits, so crew does not touch the money). What blocks capture here is
  something else: the derelict gövt (378, flag 0x0800 "starts disabled"),
  the hulk's 0 shield, or that it was never disabled by anyone. Not
  separated.
- **"No answer"**: close in, a press often gets no message and no dialog
  at all (wave 6 saw it twice at about 10 px). This wave it happened at
  most stops under about 17 px for the 24 px hulks, and from 46 px in
  for the 96 px hulk, whose radius is 48 px: there it started as soon as
  the player was inside the hulk's sprite, and no stop anywhere inside it
  (down to 2 px) opened the dialog. Three walks to the 2,000,000 hulk
  never opened it either. Whether the silent presses are a refusal with
  the message suppressed, or something about overlapping sprites, the
  runs can't say; the boards that did open came at 6-19 px.
- So: **the board range does not grow with the target's sprite** in the
  way a "sprites overlap" rule would predict (the 96 px hulk would have
  boarded from about 55-60 px); what does happen for a big hulk is not
  pinned down.

**NovaJS (base cf893d56), money and capture:** `creditBooty` (line 323,
`CREDIT_BOOTY_FRACTION` 0.10 at line 243) gives 200 / 2,000 / 5,000 for
the 2,000 / 20,000 / 50,000 hulls against the original's 1,000 / 1,000 /
1,250: **mismatch**. `captureChance` (lines 370-377: crew share, clamped
to 5-95%) would offer about 99.8% to the crew-500 player where the
original greys Capture out: **mismatch** for this kind of hulk (why the
original refuses is not known). **Proposed (not applied):** money =
max(1,000, price / 40) up to at least 100,000; for dearer ships more
boards are needed (500,000 gave 19,500-21,500); capture of a ship
that started disabled (gövt 0x0800) not offered, pending a test of a
hulk disabled by gunfire.
**Applied in ef61904a**, as refined by wave 8 (below).

Confidence: high for the speed gate's order and the two message bands
(every press of nine passes agrees), medium for the gate value (7.3
boarded, 7.8 and 9.2 refused: one run each); high for the 1,000 floor
(two prices, three boards) and the 1,250 (7 of 7), medium for price / 40
between 50,000 and 100,000 (a prediction that held), low above that;
high that crew 500 doesn't open capture (one board, but an unambiguous
0%); low for everything about the silent presses.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w7/u9/`:
`pass50`, `pass40`, `pass25`, `pass25-slowpress`, `pass-soft4`,
`pass-soft8` (two runs), `pass-soft8-fastpress`, `pass-soft9` (each:
`recording.mp4`, `recording.events.json`, `track_summary.json` with every
press's message id, `msgs/`, `magenta.json` = the hulk per frame,
`NN-pass-*.png` = the dialog or the status line after the pass);
`hulk-2k`, `hulk-2m` (the `-nodialog` walks and an `-INVALID-` one from
before the hidden-hulk fix), `hulk-big`, `crew`, `hulk-100k`, `hulk-500k`
(`NN-b-NN.png` per stop, `NN-dialog-*.png`, `log.jsonl` phase `script`).

### A wave 7: gövt 0x0010, distance and damage rate at the 25% crossing (2026-11-23)

**Setup.** `scenarios/ai_tank_hostile.json`: the AI 3 AI Tank Disc (1000
shield, 30000 armor) and a player in Kit Lancer Heavy holding a beam
turret from about 4.5 s to 56 s (1500 px reach, so the shield goes down
wherever the tank is), then watching 32 s. Target panels about every
3.6 s; the tank's distance per second from the screen (`hostility.mjs`)
or, off screen, from its radar dot (about 33 px per radar px). The same
weapon at two damage rates: **Kit Long Beam** (15 per beam frame, about
120 a second: 64% at about 7.6 s, 28% at about 11.3 s, so the 25%
crossing is at about 11.5 s) and **Kit Long Beam 50** (new wëap 248, about
400 a second: "Shields Down" in the first panel, crossing at about 6 s).
Two tanks:
- **hostile**: new gövt 368 = 0x0010 plus 0x0004 "always attacks the
  player" (düde 299), so it closes from any distance unprovoked: beside
  the player (mïsn 1012, pilots `w7_ret_near*`) or 1800 px out at Kit Jam
  Far's marker (mïsn 1013, `w7_ret_far*`);
- **neutral**: the waves 4-6 tank (gövt 383, düde 637) beside the player
  (mïsn 988) or at Kit Market, 900 px out (new mïsn 1020; pilots
  `w7_n383_*`). It does not stay where it is put (it wanders off or flies
  in before the trigger), so its distance at the crossing is what the
  recording shows, not where it started.

| tank | beam | distance at the crossing | what it did |
|---|---|---|---|
| hostile | 50 | 236-297 px, receding after a pass | stayed: 350-600 px for most of the fire, passes in to 29-34 px at 22-31 s and 45-53 s; close passes after the release |
| hostile | 50 | about 760 px, closing from 1800 | fought on: passes to 17-64 px from 16 s to the end |
| neutral | 50 | about 20 px, in a pass | fought on: passes to 9 px; one stand-off at 450-600 px (29-44 s) |
| neutral | 50 | about 25 px, in a pass | **jumped**: receded steadily from 8 s, gone at about 30 s (24 s after the crossing) |
| neutral | 50 | about 1030 px, receding (it had wandered off) | stood off **at the beam's edge** (1400-1470 px, 13-23 s), came back at 24-40 s, fought on in passes |
| neutral | 50 | about 1030 px, receding | the same: 1420-1450 px at 14-21 s, back in, passes and a 460-600 px stand-off, fought on |
| hostile | 15 | about 415 px, receding | **jumped**: receded steadily to 2600 px, gone at about 32 s (20 s after) |
| hostile | 15 | 250-300 px (its closest), then receding | **jumped**: gone at about 34 s (22 s after) |
| neutral | 15 | 540-570 px, receding | **jumped**: gone at about 29 s (18 s after) |
| neutral | 15 | about 16-26 px, in a pass | stayed: passes to 11 px, stand-offs at 370-430 px (30-38 s) and 390-550 px (48-58 s) |
| neutral | 15 | about 1320 px, receding | stood off at the beam's edge (1450-1485 px, 14-22 s), came back at 23-43 s, fought on |
| neutral | 15 | 330-360 px, standing off | stayed: stand-offs at 364-397 px and 380-578 px between passes, to the end |

**Findings.**
- **Neither distance nor damage rate sorts the runs.** Four of twelve
  jumped: 3 of 6 at the low rate, 1 of 6 at the high one; 3 of the 7
  that were receding at the crossing, 1 of the 4 that were in a pass or
  closing, 0 of the 1 already standing off.
  Wave 6's tentative rule ("far at the crossing: jump; near: stand off")
  fails both ways here (a 25 px crossing jumped; crossings at 760-1320 px
  fought on). With waves 4-6, the jump looks like a **random choice made
  around the crossing** (4 of 12 here; waves 4-6's heavy-fire cells
  jumped in about half their runs), not a function of where the tank is.
- **A jump is decided at once and carried out straight**: every jumper
  turned away within a few seconds of the crossing, receded steadily and
  vanished 18-24 s after it (waves 4-5: 16-20 s). None of the eight that
  stayed jumped later while the fire lasted (up to 50 s more).
- **"Stand-off" has two forms**: hovering a few hundred px off (350-600
  px against a 1500 px beam, so not out of its reach) between attack
  passes, and, for a tank already about 1000 px out at the crossing,
  holding **just outside the beam's 1500 px reach** (1400-1485 px) for
  8-10 s before coming back to fight. Both end in renewed passes under
  fire; neither leads to a jump.

**NovaJS (base cf893d56):** `N/nova_plugin/npc/npc_retreat.ts:109-126`
(`warshipRetreat`: shield < 25% AND losing, i.e. the damage-load bucket
over `HEAVY_FIRE_LOAD` at more than `HEAVY_FIRE_RATE_PER_S` 6%/s, line
41, or unfavourable odds) stands off at 360-420 px (lines 62-63) and jumps
after `RETREAT_JUMP_MS` 16 s of losing (line 57). Against wave 7: every
stand-off under sustained fire becomes a jump at 16 s, where the original
stayed in 8 of 12 (and never jumped late). **Mismatch.** **Proposed (not
applied), tentative:** when the retreat condition first holds, draw once
from the PRNG: about 1 in 3 to 1 in 2, flee and jump (it takes 18-24 s
to leave); otherwise stand off between passes (360-600 px, or just outside the
attacker's reach if already that far) and do not jump while the fire
lasts. Keep the Strength/odds trigger of wave 5. A ruling may prefer
keeping the deterministic 16 s jump.
**Applied in a6c1143b** ("gövt 0x0010 retreat: one jump-or-stay draw at
the crossing, no 16 s timer"): `warshipRetreat` makes one PRNG draw the
first think the condition (under 25% and losing, unchanged) holds, kept in
the synced NpcState `retreatJump`. With `RETREAT_JUMP_CHANCE_FITTED` =
13/28 (the jumps among every run of waves 4-7 where the condition held:
wave 7 4 of 12, waves 4-6 9 of 16) it flees at once and jumps out;
otherwise it stands off while losing and never jumps for it.
`RETREAT_JUMP_MS` is gone. The draw is kept while the shield stays under
25% (through stand-off / fight-on cycles) and dropped once it is back at
or above 25%, so each crossing draws once. Held ships (mission goal) still
never jump. Not done: the stand-off band stays 360-420 px (no beam-edge
form), and in the spec rig a jumper is gone about 10 s after the decision
(it starts nearer the no-jump edge than the reference's 18-24 s).

Confidence: medium that the jump is not decided by distance or damage
rate (twelve runs, both tanks, the counter-examples are clean); low on
the 1-in-3 share (4 of 12 here; the heavy-fire cells of waves 4-6 jumped
in about half their runs, with other weapons); one run per row.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w7/ai/{near50,far50,near15,far15,n383-near50,n383-far50,n383-near15,n383-far15}/*/`
(two runs in each `n383-*`; `panels.png` = fire and after panels,
`hostility-yellow.json`, `blips.json`, `recording.mp4`).

### J wave 7: InhJam lives on the hull, jammer outfits of different kinds add up, Interference 30/60, where ionization starts (2026-11-23)

**Rig.** The J rig (`scenarios/jam_fire.json`: the player sits at the
port, holds the secondary trigger about 25 s, about 49 JamM missiles of
Speed 600 / GuidedTurn 60 at the immobile 100-armor, 1-damage target
900 px east; hits = 100 - armor %; launched = trigger hold x 1.944/s).
New targets in `kits/testkit.mjs` wave 7.

| cell | missile | target | launched | hits | lost |
|---|---|---|---|---|---|
| InhJam on the hull | JamM V100 (type 1) | **shïp 811: the J0 hull with shïp InherentGovt 364** (InhJam1 100), düde govt 364 | 49.1 | 1 | **98%** |
| two different jammers, 25 then 75 | JamM V100 | shïp 812: Kit Jammer 25 + Kit Jammer 75 (one each) | 49.9 | 0 | **100%** |
| two different jammers, 75 then 25 | JamM V100 | shïp 813: the same, slots swapped | 49.7 | 0 | **100%** |

**Findings.**
1. **gövt InhJam works, through the HULL's own govt.** Waves 3-4 put the
   J0 hull (shïp govt -1) in a düde of govt 364 and lost 0 of about 250
   missiles; with the same govt written in the shïp's InherentGovt field
   the target jammed 48 of 49 (98%, the same as one +100 jammer outfit in
   wave 3). That is what the Bible's shïp InherentGovt text says: the
   "inherent attributes govt" is the one used "for inherent jamming
   ability". A düde's govt alone does not carry it. (Not split here: an
   attributes-only govt, shïp govt 1364.)
2. **Jammer outfits of different kinds add up; copies of one outfit do
   not.** Kit Jammer 25 + Kit Jammer 75 jammed every missile in both slot
   orders (V100 at J 100 is about 98% in wave 3), where the largest alone
   (J 75) gives about 72% and either one alone 22% or 72%. With wave 3
   (1, 2, 3 or 4 Kit Jammer 25s all act as J 25), the rule that fits is:
   **J = the sum over the DIFFERENT jammer outfits, each counted once**
   (capped at 100 presumably; not tested past 100).
3. **Interference at 30 and 60** (`w7_static30/60`: wëap 235 JamM Interf,
   Seeker 0x0008, JamVuln 0, in new sÿst 2028 / 2030 of Interference 30 /
   60, otherwise wave 5's rig): 49.5 launched, 38 hits (**23%** lost) at
   30; 49.0 launched, 32 hits (**35%**) at 60. With wave 5's 68% at 100 and
   0% at 0, the share is close to a line through the origin: least squares
   gives **0.0066 per point** (30 -> 20%, 60 -> 40%, 100 -> 66%; every cell
   within about 1.5 binomial standard deviations of one 49-missile run).
4. **Where ionization starts** (`scenarios/ion_threshold.json`, pilot
   `w7_ionthr`): the player hull Kit Lancer Ion Slow (IonizeMax 100,
   Deionize 1, i.e. 0.3 a second) sits beside Ion Target Green, an
   immobile green disc whose gun (wëap 249) adds Ionization 10 per hit,
   one shot every 45 game frames; the player holds the JamM Ion (0x0020)
   trigger. The recording starts in the spaceport (take 1 started after
   takeoff and the hull was already flickering blue in its first frame:
   invalid). The hull is first drawn in the ion colour **7.0 s after it
   appears in space** (frame 316; it then flickers blue every few frames
   to the end). That is after the 5th or 6th hit (one shot every 1.33-1.55
   s from takeoff; the green disc's sprite is occluded in pairs every 40
   video frames, which are probably the shots, and the tint comes 10
   frames after the 6th): **a charge of about 40-60 of IonizeMax 100**,
   i.e. about half, not "fully ionized" at 100 (that would be the 10th or
   11th hit, about 15 s in).

**NovaJS (base cf893d56), `N/nova_plugin/combat/jamming_plugin.ts`:**
- `deriveJamming` (line 255) takes the LARGEST outfit value per type
  (`strongest[i] = Math.max(...)`, line 268): **mismatch** for two
  different jammers (it gives 75, the original about 100). Wave 3's
  "largest single outfit, or count ignored" was a tie that this run
  breaks.
- InhJam is parsed but deliberately not applied (lines 45, 246-249):
  **mismatch** for a hull whose own govt has InhJam.
- Interference: `INTERFERENCE_CONFUSION_PER_POINT_FITTED` = 0.0068 (line
  236, one point at 100) against 0.0066 from three levels: **matches**; no
  change needed (the comment can cite the three points).
- Ionization: `N/nova_plugin/ship/ionization_plugin.ts:69-74`
  (`ionizedNow`: charge > IonizeMax / 2): **matches** the 40-60 window.
- **Proposed:** J_k = min(100, sum over distinct jammer
  outfit ids of that outfit's type-k value) + the hull's inherent govt
  InhJam_k (shïp InherentGovt 128-383 or 1128-1383, not the düde/combat
  govt). How InhJam and outfits combine (sum or max) is untested; sum is
  the natural reading of finding 2.
  **Applied in f20ecec2** (`deriveJamming`): J_k = the sum over the ship's
  DIFFERENT outfits (OutfitsState keys, count ignored) of their type-k
  value, plus `ShipData.inheritedJamming` (new: the InhJam1-4 of the
  attributes govt, InherentGovt 128-383 / 1128-1383, baked by the shïp
  parser; a combat-only 2128-2383 govt, no govt or a dangling id gives 0).
  The düde govt (GovtComponent) is not read. The cap is the existing
  clamp into 0-100 when a missile faces J (`effectiveJamming`), so the
  total, not the outfit sum alone, is capped at 100: the same thing for
  non-negative values, and above 100 nothing changes anyway (V 100 at
  J 100 already jams on every roll). Judgment call: the sum is signed, so
  a negative jammer outfit (none in the stock data) subtracts instead of
  being ignored. The draw count per decision is unchanged (six).
  The Interference comment now cites the three levels; no value change.

Confidence: high for the InhJam and the two-jammer cells (clean 98-100%
against the 22-72% the alternatives predict; one run each); medium for
the Interference line (one run per level, about +-7 points of binomial
noise each); low-medium for the ionization window (the shot count is
inferred from the period, not seen hit by hit).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w7/jam/{inh,j2575,j7525,static30,static60,ionthr}/*/`
(`panels.png` = the target panel from Tab to 12 s after release,
`recording.mp4`, `recording.events.json`); `inh/*-INVALID-open-pilot-failed`
is the Open-panel flake, `ionthr/*-INVALID-ionized-before-recording` take 1.

### E-fight wave 7: front-quadrant turrets from the Formation slot (2026-11-23)

**Setup.** Wave 5's `scenarios/efight_panel.json` (Kit Fight Range, two
always-attacks A14 Warship raiders making passes, the player idle and
never firing; every 5.5 s `r` targets the nearest raider and a shot reads
its shield) with two hired blue disc escorts carrying two **Kit Front
Turrets** (new wëap 250: the Kit Escort Gun with guidance 7, "front
quadrant turret"; shïp 816; pilot `w7_efront`). One run, 133 s recorded.

| escorts (wave) | distance from the player | raider shields (25 panels) | bolts born at a blue escort (`bolt_births.mjs`) |
|---|---|---|---|
| full turrets (wave 5 control) | slots | 13%, Shields Down by 8 s, both Disabled by 25 s | 68 in 50 s |
| **front-quadrant turrets (wave 7)** | **40-46 px all 133 s** (the slots) | 71, 89, 83, 68, 67, then **51-52% and 40-41%** from about 45 s on | 8 (of 432 births; 198 were the raiders') |
| rear-quadrant turrets (wave 5) | slots | 88-82%, 95 -> 74-77% | 6 clean |
| fixed guns (wave 5) | slots | 98-100% | 1 (doubtful) |

**Finding.** Escorts with only front-quadrant turrets **stay in their
slots and fire from them** at raiders that pass in front: the raiders
lost about half their shield (to 41% and 52%) with nothing else shooting
at them (wave 5's fixed-gun run is the no-fire control: 98-100%). Like
the rear turrets, they do much less than full turrets, and they stopped
scoring once the raiders' passes no longer crossed the escorts' bows
(flat from about 45 s).

**NovaJS (base cf893d56):** `N/nova_plugin/escorts/escort_command_plugin.ts:646-647,664-671`
(`formationTurretKind`: 'frontQuadrant' fires at an iff-hostile ship in
the escort's front quadrant from the slot, "Unmeasured; kept by
symmetry"): **matches**. No change; the comment can now cite this run.

Confidence: medium-high (one 133 s run; the shield drop is clean against
the wave-5 control; few bolts were attributed because the turrets fire
from inside the formation, where births overlap the player's sprite).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w7/escorts/efront/*/`
(`panels.png`, `hostility-{blue,red}.json`, `bolt_births.jsonl`,
`recording.mp4`).

### A wave 7: does an AI 2 trader run when its attacker is out of range? (2026-11-23)

**Setup.** `scenarios/ai_outrange.json`, pilot `w7_ai2_out`: the wave-2 AI
2 AI Subject Disc (yellow, 1000/1000, two Kit Raider Guns, neutral gövt
363; mïsn 978) at Kit Port. The player (Kit Lancer, the 1-damage Kit
Tickler) targets it, tickles it once (5.4 s), lets it fight for 20 s, then
thrusts straight away for 5 s (about 1800 px, far past the Kit Raider
Gun's reach), brakes and watches 80 s. Radar dots and the target panel
show where it goes. The AI 3 subject (mïsn 979, pilot `w7_ai3_out`) went through the same
script as a control.

| time | AI 2 subject |
|---|---|
| 5.4 s | tickled |
| 16-28 s | attack passes at the player, 8-237 px (the player's shield bar 148 -> 146 px) |
| 26.7-32.6 s | the player flies off about 1800 px and stops |
| 32 s | its radar dot sits among the stellars near Kit Port, about 1660 px from the player |
| 32-50 s | it flies **directly away from the player** at about 125 px/s (its top speed is about 135), out to about 3700 px, and leaves the radar at about 50 s |
| 53 s on | the target panel reads **"No Target"**: it has left the system |

The **AI 3 control** fought the same way (passes at 7-243 px from 8 s,
never hit the player's 30000 shield hard enough to show more than 2 px)
and, after the break, also did not follow: it stayed off screen and off
the radar (the radar's edge arrow kept pointing at it) for the remaining
80 s, but it **stayed in the system**: the target panel read "AI Subject
Disc, Shield: 100%" in all 20 shots to the end.

**Finding.** The Bible's "runs away when his attacker is out of range"
happens as written: once the player broke off beyond its guns' reach, the
brave trader did not follow; it turned and ran directly away from the
player at full speed and left the system about 20 s after the break
(wave 4: a departing ship accelerates hard and vanishes far from any
stellar, i.e. a jump; here it was off the radar before it vanished, so a
jump vs a landing beyond the radar can't be told, but there is no stellar
out there). It had never been hurt beyond the tickle (shield 100%). The
AI 3 warship, by contrast, broke off the chase too but stayed in the
system.

**NovaJS (base cf893d56):** `N/nova_plugin/npc/npc_decision.ts:439-455`
(case 2): a brave trader attacks its aggressor while `oddsFavorable`
holds, flees when the odds turn, and with the aggressor gone or lost goes
back to business; there is no "attacker out of range" branch, and the
aggressor stays recorded (wave 3: retaliation is permanent), so it keeps
chasing a player who flies off. **Mismatch.** **Proposed (not applied):**
for AI 2, when the aggressor is farther than the ship's longest weapon
reach (wëap speed x duration, or beam length), switch to 'flee' (run
directly away, then depart by jump). One run per AI type.
**Applied in ae475ef8** ("AI 2 brave trader runs once its attacker is out
of reach"): case 2 goes to 'flee' (away from the aggressor, then the usual
flee jump) when its aggressor is beyond its longest weapon reach (a new
synced WeaponState `reach`, `weaponReach`: projectile speed x lifetime +
proximity fuse, or beam length; bays have none), but only once that
aggressor has been within the reach in this fight (NpcState
`reachedAggressor`): waves 2 and 4 saw AI 2 traders tickled from far off
(the Kit Tickler reaches about 2250 px) close in and fight, not run. Not
committed: an attacker that comes back into reach is fought again (not
measured). Unarmed and bay-only traders keep the old chase. In the spec
rig the trader is gone about 9 s after the break (the original about 20 s;
the spec ship starts near the no-jump edge). The AI 3 control's "broke
off but stayed" is not modelled (NovaJS warships still chase).

Confidence: medium (one run per AI type, clean radar track and panels).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w7/ai/{out-ai2,out-ai3}/*/`
(`panels-out.png`, `radar3.png` / `radar4.png`, `hostility-yellow.json`,
`blips.json`, `recording.mp4`).

### Asteroid decoy capture wave 7: not attempted (2026-11-23)

The brief asked to separate range from per-tick chance if rocks could be
placed or slowed. They can't: sÿst Asteroids is a count, and the röid
resource (Bible: Strength, SpinRate, YieldType/Qty, PartCount/Color,
FragType 1-2, FragCount, ExplodeType) has no speed, mass or position
field; SpinRate is only the sprite's frame rate. Fragments of a destroyed
rock start where it was but drift like any other rock. So wave 5-6's
status stands (NovaJS's certain capture inside 25° / 200 px is consistent
with what was seen; range vs chance is open) and no runs were spent on it.

### U9 wave 7: why a receding ship stays "too fast" far out around big planets (2026-11-23, analysis only)

**Question.** Wave 4's moving runs (`land_range*.json`: an inertialess
Kit Crawler 100 crossing the planet at a constant 44 px/s, `l` every 7
frames) flipped from "too far" to "too fast" at about the landing range
on the way in, but around the big planets stayed "too fast" far beyond
it on the way out (250 px planet: 450-460 px; 304x134: 524-534; 325:
still at 700). No new driving: wave 6 showed the landing zone is a
square, so the six wave-4 recordings were re-read with each press's
offset (dx, dy) from the planet (`track.json` centres, a constant-velocity
fit, read 4.5 frames after the stamp) and the distance taken as
max(|dx|, |dy|). Message ids were re-read from the crops (the 304x134
run's ids 3-8 are one message, "too far", split by the planet drawn
behind the status line; id 9 is "land304, you're cleared to land.
Commence final approach.").

| planet (frame width W) | in: too far -> next answer, max(\|dx\|,\|dy\|) | out: too fast -> too far, max(\|dx\|,\|dy\|) | 1.7 x W | wave 6 at-rest landing square |
|---|---|---|---|---|
| 40 | 76 -> 69 ("too fast") | 70 -> 78 | 68 | 63-87 |
| 72 | 166 -> 92 (coarse) | 125 -> 132 | 122 | 103-131 |
| 150 (Kit Port) | 250 -> 240 (euclidean; slow pass) | 262 -> 272 (euclidean) | 255 | (wave 3, circle 235-277) |
| 250 | 253 -> 243 ("cleared to land. Commence final approach.", then "too fast") | **430 -> 440** | **425** | 209.5-235.5 |
| 304x134 | about 245 ("cleared ... Commence final approach") | **523 -> 533** | **517** | |
| 325 | 244 -> 236 | **still "too fast" at 394** (the run ended) | **552** | 199-213 |

**Finding (fits all six runs, not tested beyond them).** The "too fast"
answer belongs to an approach state with two edges:
- **entered** at about the landing square, min(1.7 W, cap), the cap here
  being about 240-250 rather than the at-rest 212 (the first press inside
  is answered "You are cleared to land. Commence final approach." in two
  of the three big runs);
- **left** only when max(|dx|, |dy|) exceeds about **1.7 W with no cap**
  (425 / 517 / 552 for the 250 / 304 / 325 px art: 430-440 and 523-533
  measured, and 325 still inside at 394).

For the small planets the two edges coincide (1.7 W is under the cap), so
in and out were symmetric; for art over about 140 px the exit edge is
the uncapped 1.7 W, which is why a receding ship stays "too fast" for
hundreds of px. A time-based lapse does not fit: the stay inside lasted
3.4 s for 40 px and 16-21 s for the big planets, and the request-to-exit
times (13-34 s) don't line up with the 27 s request lapse either.

**NovaJS (base cf893d56; main 92361bed has since applied the square,
bd344b9f):** `N/nova_plugin/travel/planet_plugin.ts:187` (`landingRange`,
a circle at the base; on main `inLandingZone`, the capped 1.7 W square)
and lines 314/317 at the base (345/348 on main: `tooFar`, then `tooFast`)
answer from the current distance only: no approach state, no exit edge.
It only changes which message a ship that can't land anyway is shown, so
**proposed (not applied): nothing**, unless the message fidelity is
wanted (then: remember "cleared" on entering the landing square and keep
answering "too fast" until max(|dx|, |dy|) > 1.7 x frame width,
uncapped).

Confidence: medium (one pass per planet, every edge within the 7-10 px
between presses; the cap on the entry edge, 240-250 against the at-rest
212, is not explained; a direct test would stop a receding ship between
the two edges and press `l` while creeping outward).

**Evidence:** wave 4's `~/.local/share/novaref/evidence/20261123-w4/u9/land-*/*/`
(`track.json`, `track_summary.json`, `msgs/`); the re-read is
`~/.local/share/novaref/evidence/20261123-w7/u9/flips/` (`flips.py`, `flips.txt`).

### U9 wave 8: why boards stay silent (the ships must be aligned), board range by sprite size, one board per hulk, money above 100,000, capture (2026-11-23)

**Rig.** Wave 7's hulks could only be found by colour, so neither ship's
heading was known. `kits/testkit.mjs` wave 8 adds **pointer hulls**: the
player flies Kit Ring Crawler (shïp 818: Kit Crawler 100 stats, crew 10,
drawn as a thin 24 px cyan ring with a white spoke at its nose, open in
the middle so a hulk under it stays visible) and each hulk is a 24 px
magenta disc with a green spoke from its centre to its nose (shïp 820 at
50,000; 821-824 at 200,000 / 300,000 / 750,000 / 1,000,000; 827 the same
96 px across, its shän declaring 96 x 96). All hulks are wave 7's: the
derelict gövt 378, immobile, crew 1, 300 armor, booty food + money, the
only traffic of their own system. `analysis/pointer.mjs` reads both
headings off any shot (snapped to the sheet's 10° frames) and the hulk's
offset. `loops/board.mjs` gained a **sweep**: the walk stops when a press
is answered with nothing (or within a few px), then stays on that spot,
presses `b` four times without moving, and turns about 5-10° in place
before every further press until the plunder dialog opens
(`scenarios/board_sweep.json`; `pointer.mjs --run <dir>` lists every
press). Headings below are screen degrees (0 = east, 90 = south); the
"gap" is how far the player's heading is from the hulk's axis (0 = the
same way or exactly opposite).

**1. The silent press is "not aligned".** A press the game does not
answer CLEARS the status line (the previous "not close enough" vanishes
in the frame of the press; wave 7's "no answer") and prints nothing. In
every sweep the player sat still on one spot and only its heading
changed:

| run (hulk, heading) | spot | presses that got nothing (heading: gap) | dialog |
|---|---|---|---|
| 50,000 (-160) | 1.9 px | 150 x4, 160, 170 (gap 50, 40, 30) | at 180 (gap 20) |
| 200,000 (-120) | 7.2 px | 140 x5 ... -150, -140 (gap 80 down to 20) | at about -130 (gap 10) |
| 200,000 (-90) | 12 px | 50 x6 (gap 40) | one tap later (gap about 35) |
| 750,000 (-90) | 11 px | -170/-160 x9, -140, -130, -120 x2 (gap 80 down to 30) | one tap later (gap about 25) |
| 1,000,000 (40) | 12.3 px | -20 x5, -10, 0 (gap 60, 50, 40) | one tap later (gap about 30) |
| 2,000,000 (wave 7's plain disc, heading unknown) | 8.9 px | 170 x5, then -180 ... -100 (11 presses) | at about -90: **87,000 credits** (wave 7: never boarded in three walks) |
| 24 px hulk, 96 px player ring (20) | 15.6 px | -50 x6 ... -10 x2 (gap 70 down to 30) | one tap later (gap about 25) |

Repeating the press at one spot and heading never changed the answer (four
to nine repeats per sweep); turning alone opened the dialog every time.
Facing the hulk is not it either: the walk always turned to face the hulk,
and stops facing it were silent whenever the hull's axis was off (2,000,000:
silent while pointing straight at it). Boards that opened straight from a
walk stop (the loop had turned to face the hulk) were all aligned too:

| hulk heading | player heading at the press | gap | |
|---|---|---|---|
| -80 | 87 | 13 (opposite) | 50,000 |
| 40 | -147 | 7 (opposite) | 300,000 |
| -50 | 113 | 17 (opposite) | 300,000 |
| -50 | 147 | 17 (opposite) | 50,000 |
| 110 | -94 | 24 (opposite) | 50,000 |
| 20 | 48 | 28 | 750,000 |
| -40 | 135 | 5 (opposite) | 1,000,000 |
| 50 | 50 | 0 | the live hulk (capture, below) |
| -140 | -149 | 9 | 96 px hulk |

So **boarding needs the two hulls' axes within about 25-30° of each
other, the same way or opposite** (largest gap that boarded: about 25-30,
once about 35-40 at a 1.9 px spot; smallest that stayed silent: 30, once
20; each heading is good to a 10° sprite frame). Inside the range a
misaligned press is refused with no message at all. This also explains
wave 7's 96 px hulk and 2,000,000 hulk that "never opened" (in range,
never aligned: the old loop only ever faced the hulk) and the boards that
opened after many silent stops.

**2. One board per hulk.** After the dialog was left with Abort (nothing
taken), every later press, aligned or not, said **"You can't board this
ship."** (40 presses in the first sweep). Wave 6/7's hulks were all
boarded once, so this was never seen.

**3. Range: a square around the target, about half its sprite.** From the
stops just outside and just inside the range (out = "not close enough",
in = silent or dialog; offsets are the hulk's centre from the player's):

| target / boarder sprite | in range | out of range |
|---|---|---|
| 24 px hulk / 24 px ring | (12.0, 2.7), (-10, 10) (14.2 px away), (6.9, 7.7), (-8.8, 1.6) | (3.6, 12.1) (12.7 px away), (-12.1, 10) (15.7 px), (-12.2, 4.7), (0.5, -14.2) |
| 96 px hulk (shän 96 x 96) / 24 px ring | (-38.9, -23.7) | (-47.6, -28.6) |
| 24 px hulk / 96 px ring | (10.5, -11.5) | (15.5, -17.5) |
| 24 px hulk / 48 px Lightning (waves 6-7) | about 15 | about 15.5-16 |

With the 24 px pair, (-10, 10) boarded 14.2 px away while (-12.1, 10)
(15.7 px) and (3.6, 12.1) (12.7 px) were out: the zone is max(|dx|,
|dy|) <= about 12, a square of half the target's 24 px sprite, like the
landing zone (wave 6). It grows with the target's sprite (39-47.6 for the
96 px hulk; wave 7's 96 px hulk whose shän still said 24 x 24 behaved the
same, so the sprite counts, not the shän's size field) and a little with
the boarder's (about 15 for the 48 px Lightning, between 11.5 and 17.5
for the 96 px ring: not pinned down).

**4. Money above 100,000.** One board per hulk, so one amount per run:

| price | credits (boards) | price / 40 | price / 20 |
|---|---|---|---|
| 50,000 | 1,250 (x7, waves 6-7), 1,250 (x17 this wave: 7 derelicts, the 96 px one included, and the 10 non-derelict capture hulks) | 1,250 | 2,500 |
| 100,000 | 2,500 (wave 7) | 2,500 | 5,000 |
| 200,000 | 5,000, 7,000 | 5,000 | 10,000 |
| 300,000 | 12,500, 11,500 | 7,500 | 15,000 |
| 500,000 | 19,500, 21,500 (wave 7) | 12,500 | 25,000 |
| 750,000 | 35,750, 32,750 | 18,750 | 37,500 |
| 1,000,000 | 26,000, 45,000 | 25,000 | 50,000 |
| 2,000,000 | 87,000 | 50,000 | 100,000 |

Every amount is a multiple of 250 between price / 40 and price / 20, and
from 200,000 up it varies from board to board; at 50,000 it was exactly
price / 40 on all 24 boards (a uniform draw over 1,250-2,500 would
almost never do that), and 2,000 / 20,000 gave the 1,000 floor (waves
6-7). So: **max(1,000, price / 40 + a random part)**, the random part
reaching up to about price / 40 for dear hulls and zero (or nearly) for
cheap ones. The data fit, for example, a random part drawn from 0 to
price / 40 - 1,500 (zero at 50,000 and below, up to 3,500 / 6,000 / 17,250 /
23,500 / 48,500 at 200,000 / 300,000 / 750,000 / 1,000,000 / 2,000,000:
every board is inside that), but two boards per price can't pin the
shape.

**5. Capture: a derelict is never capturable; a hulk the player disabled
is, at odds set by the crews.** Every derelict board (gövt 378, flag
0x0800 "starts disabled") read "Capture Odds: 0%" with Capture Ship
greyed: 29 boards over waves 6-8 (16 this wave), from crew 10 (and once
crew 500, wave 7), including
`cap9` where nine Kit Escort Gun shots (30 each, the hits seen in the
trail picture) had taken about 270 of the hulk's 300 armor first. So
neither crew nor damage opens it. The control is a hulk that is NOT a
derelict: shïp 829 Kit Live Pointer (the same pointer hulk, 300 armor,
crew 1) of the neutral gövt 363, AI 4, immobile, which the player
disables with the turret on the way in (`scenarios/board_capture_live*.json`:
150 px out, Space held 4.4 / 5.0 / 5.8 s for about 7 / 8 / 9 shots; the
target panel read "Disabled" after each volley); shïp 831-835 are the
same with crew 20 / 15 / 40 / 5 / 10:

| hulk | player crew | shots before boarding | Capture Odds | Capture Ship |
|---|---|---|---|---|
| derelict, crew 1 (29 boards) | 10 (500 once) | 0, or 9 (`cap9`) | **0%** | greyed |
| live, crew 1 | 10 | 8 | **75%** | enabled |
| live, crew 1 | 500 | 8 | **75%** | enabled |
| live, crew 1 | 10 | 7 | **75%** | enabled |
| live, crew 20 | 10 | 8 | **18%** | enabled |
| live, crew 20 | 10 | 9 | **17%** | enabled |
| live, crew 20 | 10 | 7 | **17%** | enabled |
| live, crew 5 | 10 | 8 | **34%** | enabled |
| live, crew 10 | 10 | 8 | **20%** | enabled |
| live, crew 15 | 10 | 8 | **18%** | enabled |
| live, crew 40 | 10 | 8 | **7%** | enabled |

So the shown odds top out at 75% (crew 10 and crew 500 against crew 1
read the same), fall fast as the defenders catch up (34% at 2 boarders
per defender, 20% at even crews) and then slowly (17-18% from 15 to 20
defenders, 7% at 40); damage did not move them (7, 8 and 9 shots against
crew 20: 17, 18, 17). No simple crew-share formula fits (a share would
give 67 / 50 / 40 / 33 / 20%); the shape needs more crews, and possibly
the player's hull (only the Kit Ring Crawler, crew 10, was used) or a
random part (17 vs 18 at the same crews). Capture itself was not
attempted.

**NovaJS, capture (base b38635bd).** `capturable` (`boarding_component.ts:359`)
refuses only a ship a player is flying, so a derelict is capturable:
**mismatch**. `captureChance` (`:370-377`, crew share clamped to 5-95%)
gives 91 / 95 / 67 / 50 / 33% for crews 10:1, 500:1, 10:5, 10:10 and
10:20 against the original's 75 / 75 / 34 / 20 / 17-18%: **mismatch**. **Proposed (not applied):** no
capture of a gövt 0x0800 derelict (Capture greyed, odds 0%); cap the
odds at 75%; below that, interpolate the measured points (10 boarders
vs 1 / 5 / 10 / 15 / 20 / 40 defenders: 75 / 34 / 20 / 18 / 17.5 / 7%)
until a formula is found.
**Applied in ef61904a** (ruling #378): `isDerelict` (gövt Flags1 0x0800,
read off the government, so a ShipGoal 5 rescue hulk is not one) makes
`capturable` false for both capture routes, and the plunder dialog shows
"Capture Odds: 0%" with Capture Ship greyed and no note. `captureChance`
interpolates `CAPTURE_ODDS_BY_CREW_RATIO` linearly in boarder / defender
crew (0 / 0.25 / 0.5 / 2/3 / 1 / 2 / 10 -> 0 / 7 / 17.5 / 18 / 20 / 34 /
75%) and caps at `CAPTURE_CHANCE_MAX` 75%; the old 5% floor is gone.

**NovaJS (base b38635bd).**
- Alignment: `N/nova_plugin/ship/boarding_component.ts:236`
  (`AXIS_ALIGN_TOLERANCE_RAD` = π/12, 15° each side of parallel and
  anti-parallel, "Matthew's spec") with `axesAligned` (`:256-261`) and the
  gate's order range, speed, alignment (`:299-306`): the rule **matches
  in kind** (both directions accepted, checked inside the range); the
  tolerance is about half the original's. The refusal message does not:
  `N/display/status_bar_content.ts:299` prints "Line up alongside the ship
  before boarding." where the original prints nothing (and clears the
  line). **Proposed (not applied):** tolerance about 30° (π/6); show no
  message for 'notAligned' (or keep the hint deliberately, as a UI
  choice).
  **Applied in ef61904a** (ruling #378): `AXIS_ALIGN_TOLERANCE_RAD` 29°
  (between the largest clean board, 28, and the repeated silence at 30),
  checked last, after range and both speed gates; 'notAligned' has no
  message (`boardingBlockedMessage` returns '', which clears the status
  line, and no cant-do beep plays).
- One board per hulk: `plunderSpent` (`boarding_component.ts:318`) and the
  'alreadyBoarded' refusal (`N/nova_plugin/encounters/boarding_plugin.ts:612-614`,
  "You can't board this ship.", `status_bar_content.ts:262`) **match**,
  including the message, and the hulk is spent the moment a session
  opens, Abort or not (`boarding_plugin.ts:656`, comment at `:716-718`),
  as in the original; the catalogue listed "one plunder per hulk" as a
  deliberate non-fidelity ruling, but the original does the same.
- Range: `BOARD_DISTANCE_SQUARED` = 22,500 (a 150 px circle,
  `boarding_component.ts:227`): **mismatch** (wave 6 said so for the 24 px
  case). **Proposed (not applied):** max(|dx|, |dy|) <= half the
  target's sprite size (plus a little for a big boarder), the landing
  zone's shape.
  **Applied in ef61904a** (ruling #378): `boardingDistance` = max(|dx|,
  |dy|) <= `boardingRange` = (7 T + B) / 16, T and B the target's and
  boarder's `spriteFrameWidth` (48 when unknown): 12 for 24/24, 43.5 for
  96/24, 16.5 for 24/96, all inside the brackets above; 13.5 for 24/48,
  1.5 px under the Lightning's rough centroid figure of about 15.
- Money: `creditBooty` (`:323`, 10% of the price): **mismatch**.
  **Proposed (not applied):** max(1,000, price / 40) plus a random part
  that is zero at 50,000 and reaches about price / 40 for dear hulls (one
  shape that fits: uniform 0 to price / 40 - 1,500, in steps of 250), from
  the seeded RandomResource like the capture roll.
  **Applied in ef61904a** (ruling #378), with a tighter shape that every
  board fits: every amount over the floor is price / 40 plus a whole
  number of thousands. `creditBooty` = max(1,000, B + 1,000 k), B = price
  / 40 rounded down to 250, k uniform in [0, floor(B / 1,000)) from ONE
  seeded draw per board (made as the plunder session opens, so the draw
  count never depends on the price). The 50,000 hull has a single step,
  hence 1,250 on all 24 boards; 750,000's 35,750 is its top step (k = 17).

Confidence: high that alignment is the silent refusal (nine sweeps, each
silent at a fixed spot until only a turn opened the dialog; nine more
boards straight from a stop all within 30° of the axis, both directions);
medium for the 25-30° tolerance (10° sprite frames on both hulls); high
for one board per hulk (40 presses); medium-high for the square range of
the 24 px pair (one diagonal board at 14.2 px against two out at 12.7 and
15.7), medium for how the range scales with sprite sizes (one or two
brackets each); for money high that it stays inside price / 40 to price / 20
and varies above 100,000 (eleven boards), low for the shape of the random
part; high that a derelict is never capturable (29 boards, one 90% shot
away) and that a hulk the player disabled is (ten boards), high for the
75% cap (three boards), medium for the lower odds (one board per crew,
except three at crew 20) and that damage plays no part.

**Running boards (notes for later waves).** A hulk boards once, so a run
measures one board; sweep from the first silent press (`startOnSilent`).
A hulk 2,000+ px out may not be Tab-targetable when the run starts (the
panel stays "No Target", and `b` with no target is silent too, which is
how the first 96 px run went wrong): `args.retarget` Tabs until the panel
names it. Of about 32 board runs, three went wrong before boarding and
were rerun: that untargeted one, "target not found" at the start (the
hulk not yet on the radar) and the known `open_pilot` flake.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w8/u9/`:
`sweep/` (four 50,000 runs; `*164452*` is the first, which found the
one-board rule), `money{200k,300k,750k,1000k}/` (two each),
`hulk2m/`, `hulkbig/` (`*-INVALID-no-target` never had the hulk
targeted: `b` with no target is answered with nothing too), `ptrbig/`,
`cap5/`, `cap9/`, `live/`; each run's `NN-b-NN.png` / `NN-sw-NN.png` are
the shots after each press, `log.jsonl` phase `script` has every stop and
sweep press, `recording.mp4` + `recording.events.json`.

### B wave 8: the anchored carrier's silent guns were not reproduced (2026-11-23)

**Question (wave 7 side observation).** With 1-damage bombers, the
anchored Kit Bomb Carrier never hit the player in 140 s, while with the
50-damage bombers its guns wore the player's shield down. Is a carrier
with live fighters out holding its guns?

**Setup.** `scenarios/carrier_anchored_kit.json` as in wave 7 (the
player Kit Lancer Heavy, 30000/30000, no recharge, no weapons, at Kit
Port; the carrier of always-attacks gövt 362 beside it, Speed/Accel 0;
Tab every 1.3 s for about 110 s; the shield bar read per frame by
`analysis/hostility.mjs`). One factor per run: a gun-only carrier (shïp
828: shïp 800's hull and two Kit Escort Guns, no bay; pilot
`w8_guncarrier`), the 1-damage bomber carrier with its bay EMPTY (shïp
830: shïp 802 with bay ammo 0; `w8_emptybay`), and wave 7's 1-damage
bomber carrier again (pilot `w7_carrier1`, unchanged).

| carrier | bombers out | player's shield bar (146 px full) | first drop |
|---|---|---|---|
| gun-only (no bay) | none | 146 -> 116 in 140 s, steady | 12.7 s |
| 1-damage bay, empty | none | 146 -> 116, steady | 13.9 s |
| 1-damage bay, 4 bombers (wave 7's run again) | yes: Tab panels show Kit Bomber 1 at 85-99% shield to the end, the carrier at 99% | 146 -> 118, steady | 13.3 s |
| wave 7: the same 1-damage carrier | yes | 146, untouched for 140 s | none |
| wave 7: 50-damage bombers | yes, disabled by about 15 s | 144 -> 108 | 6.9 s |

**Finding.** The rerun of wave 7's 1-damage carrier fired at the player
like the gun-only and empty-bay carriers (about 0.2 px of shield bar a
second, from 13 s on) while its four bombers flew around it the whole
time. So **live fighters do not hold a carrier's guns**, and wave 7's
silent run is unexplained: one run in two (it may have been a targeting
or placement quirk of that run; the carrier and the player were on top of
each other at Kit Port in both). Whether a bay is empty or there is none
makes no difference. **NovaJS (base b38635bd)** fires an NPC carrier's
guns whatever its fighters do (`N/nova_plugin/npc/npc_fire_control.ts`
holds only a protector mission ship's BAYS, lines 39-47 and 163):
**matches**; nothing to change.

Confidence: medium-high that fighters out don't silence the guns (the one
direct rerun fired steadily for 127 s); the wave-7 run stays an
unexplained outlier.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w8/b/{guncarrier,emptybay,carrier1}/*/`
(`hostility.json` = the shield bar per frame, `NN-obs-NN.png` the Tab
panels, `carrier1/*/panels.png` the contact sheet, `recording.mp4`).

### K10 wave 9: where the target bracket corners sit (2026-11-23)

**Question (Matthew, 2026-11-23).** "Let's check the planet target
corners distance, and maybe also ship target corners distances." Where are
the four corner brackets drawn around a targeted stellar or ship: how far
from the centre, square or following the sprite's w/h, tied to the frame,
the visible art or the landing square, and do they change with distance,
rotation or animation?

**Method.** `analysis/brackets.mjs` (new) finds the four corner glyphs of
one colour in a window shot (or every frame of a recording) and reports
the box through their outermost pixels, the glyph size and the largest
non-black blob inside the box (the target's visible art).
- **Stellars, from existing shots** (no new runs needed): every U9 run of
  waves 4 and 6 starts with the player on the stellar and presses `l`,
  which targets it, so each run's lossless `01-request.png` holds the
  stellar's bracket: thirteen stellars from 15x21 to 325x325, all at the
  play area's centre. The recordings carry the same bracket while the
  player flies out to about 250 px.
- **Ships, existing:** K9's shots (red / yellow around 24 px discs),
  wave 8's board sweeps (grey around the 24 px and 96 px hulks) and the
  1920x1080 reference `ui_screenshots/original_macos_screenshots/space/in_space.png`
  (a yellow Leviathan).
- **Ships, new:** pilots `w9_esc_a` / `w9_esc_b` put the Kit Ring
  Crawler in the sealed Kit Range with six stock-art escorts each (frames
  24 to 192). `scenarios/brackets_tab.json` (30 x Tab, a shot and a short
  turn each) showed that **Tab never selects an escort**: 60 Tabs in two
  runs, every panel "No Target". So `scenarios/brackets_click.json` runs
  the new `loops/click_targets.mjs`: it finds the ship sprites in a shot,
  clicks each (a click targets a ship, escorts included), parks the
  mouse and shoots, for five rounds with a turn in between so the
  escorts re-form and show other rotations (the target panel names the
  class). `w9_sol` runs `brackets_tab.json` in stock Sol for neutral
  traffic: Tab reached Leviathans, Vipers, Patrol Boats, Pegasi and a
  UFS Razorback, but only a Fed Viper was fully on screen when shot (2
  of 30).

| target | frame (w x h) | box (outer pixels) | box - frame | shots |
|---|---|---|---|---|
| stellar Type 51 station | 15x21 | 50 x 50 | 29 (from 21) | 2 |
| stellar Type 53 station, and as a planet | 17x31 | 60 x 60 | 29 (from 31) | 3 |
| stellar Type 48 station | 35x22 | 64 x 64 | 29 (from 35) | 2 |
| stellar Type 3 | 40x40 | 70 x 70 | 30 | 3 (and a kit marker, 40x40, clicked by accident in `click-b`) |
| stellar Type 6 | 72x72 | 102 x 102 | 30 | 2 |
| stellar Type 16 | 80x80 | 110 x 110 | 30 | 1 |
| stellar Type 24 | 88x88 | 118 x 118 | 30 | 1 |
| stellar Type 9 | 96x96 | 126 x 126 | 30 | 1 |
| stellar Type 10 | 112x112 | 142 x 142 | 30 | 1 |
| stellar Type 0 (Kit Port) | 150x150 | 180 x 180 | 30 | 3 |
| stellar Type 25 | 250x250 | 280 x 280 | 30 | 2 |
| stellar Type 18 | 304x134 | 334 x 334 | 30 (from 304) | 1 |
| stellar Type 39 (station art) | 315x200 | 344 x 344 | 29 (from 315) | 1 |
| stellar Type 5 (Jupiter) | 325x325 | 354 x 354 | 29 | 2 |
| Shuttle / Kit discs and hulks (green, yellow, red, grey) | 24 | 54 x 54 | 30 | 6 + 13 K9 + 4 wave 8 |
| Heavy Shuttle (escort, green); Fed Viper (Sol traffic, yellow) | 32 | 62 x 62 | 30 | 4 + 2 |
| Thunderhead | 48 | 78 x 78 | 30 | 7 |
| Fed Patrol Boat | 56 | 86 x 86 | 30 | 4 |
| Pegasus | 64 | 94 x 94 | 30 | 2 |
| Fed Destroyer | 80 | 110 x 110 | 30 | 5 |
| Kit Hulk Big (grey, disabled) | 96 | 126 x 126 | 30 | 2 |
| IDA Frigate | 100 | 130 x 130 | 30 | 5 |
| Aurora Cruiser | 120 | 150 x 150 | 30 | 8 |
| Fed Carrier | 128 | 158 x 158 | 30 | 9 |
| Leviathan | 144 | 174 x 174 | 30 | 3 (and the reference screenshot) |
| Aurora Carrier | 184 | 214 x 214 | 30 | 6 |

Every box measured the same in every shot of its target (err 0: the four
glyphs line up to the pixel). The Raven (192) never came on screen fully
enough to be clicked.

**Findings.**
1. **The box is the sprite FRAME plus 15 px on every side**: side =
   2 x floor(S / 2) + 30 (S + 30 for even S, S + 29 for odd), centred on
   the object's position. Stellars and ships follow the same rule,
   from 15 to 325 px, with no cap.
2. **It is always square, from the larger frame dimension**: the 17x31
   station gets 60 x 60, the 15x21 one 50 x 50, the 35x22 one 64 x 64,
   the 304x134 art 334 x 334, the 315x200 art 344 x 344. (Every stock
   ship frame is square, so ships can't show the difference.)
3. **The frame, not the visible art, and not the landing square.** The
   325 px planet's art is about 302 px across and still gets 354; the
   Fed Carrier's art spans anything from 103 x 107 to 133 x 98 as it
   turns, the Aurora Carrier's from 52 x 129 to 160 x 64, and the box
   stays 158 / 214 in every shot. The ship's **glow layer does not
   count**: the Leviathan's shän glow image is 180 px (it would give
   210), the box is 174 from its 144 px base frame. The landing square
   (1.7 x W, capped near 212, "U9 wave 6") is unrelated: 354 for the
   325 px planet, square from max(w, h) not w.
4. **No change with distance, rotation or animation**: a planet's
   bracket stays 102 x 102 (+-2 px of video noise) while the player flies
   from 0 to 250 px out; a turning ship's box never changes; the box's
   centre is the ship's position, not the art's (the art's bbox centre
   wanders up to 30 px from the box centre as a long hull turns). EV
   Nova has no zoom.
5. **The glyphs are fixed-size sprites, not scaled with the target.**
   Ships: 9 x 9 px, 1 px lines: a 4 px diagonal tick from the outer
   corner pointing in, and an L whose arms (5 px, one 1 px nub each) start
   4 px from the corner; neutral (255,255,0) with two (255,255,99)
   pixels, friendly green, disabled grey (115,115,115) with two
   (140,140,140). The hostile glyph is a different 8 x 8 orange-red
   shape (255,99,0 / 255,49,0 / 239,0,0 / 222,0,0). Stellars: 11 x 11
   px, a 2 px blue arc around the corner (0,0,222 shading to 0,206,255)
   with a 1 px tick pointing in. The ship and stellar brackets are
   independent: a stellar clicked while a ship is targeted shows both.
6. **The brackets fly in when a target is chosen** (the box per
   recording frame after each click or `l`, from `bracketsIn` over the
   frames: `acquire.mjs` in the evidence folder's `novajs/`). For a frame
   or two after the input there is no complete box on screen (it is larger
   than the play area), then it shows 400-580 px WIDER than its final
   size and closes over the next 3-4 recorded frames (100-130 ms at
   30 fps), e.g. Shuttle 416, 204, 72, 54; Thunderhead 456, 386, 238, -,
   78; the 112 px planet 582, 418, 274, 146, 142. The extra width is about the same
   for a 24 px Shuttle and a 112 px planet, so it is an **additive
   offset** closing at roughly 2-2.5 px/ms per side, not a scale of the
   final box.
7. **Tab skips the player's escorts** (60 Tabs, 12 escorts, never
   one); a click targets them. With only escorts present and one already
   targeted, `r` kept it targeted (twice, both runs) and Tab cleared it,
   so whether `r` would ever pick an escort (K3) is still open.
8. Nothing else is bracket-shaped: the radar marks no target (the
   targeted escort's blip looks like the others at radar scale) and the
   target panel has a plain frame (name, subtitle, the red picture,
   Shield %, govt or "Escort").

**NovaJS today (base 0a4e3f60).**
- `N/display/target_corners_plugin.ts:110-116` (`TargetCorners.step`)
  puts each corner sprite's anchor at (cos 45 deg x w / 2, sin 45 deg x h
  / 2) = (+-0.354 w, +-0.354 h) of the target's centre, and the rotations
  at lines 52-54 turn each 16 x 16 cicn so the glyph extends INWARD from
  its anchor; the glyph's outermost pixel is 1 px inside the texture's
  edge (the cicns carry a 1 px dark outline). So the glyph box is about
  0.707 x size - 2 px: **inside the sprite**, where the original is 15 px
  outside the frame.
- `size` is `targetGraphic.size` (line 180), the largest of ALL the
  shän layers (`N/display/animation_graphic.ts:147-148`), so a glow layer
  bigger than the base frame counts: Shuttle 48, Heavy Shuttle 64,
  Thunderhead 96, Fed Patrol Boat 84, Fed Destroyer 120, IDA Frigate 200,
  Aurora Cruiser 240, Fed Carrier 192, Leviathan 180, Raven 288 (measured
  live). Stellars have one layer (their frame). So NovaJS's box is too
  small for every stellar (by 44-126 px) and most ships (by 12-49 px;
  about half the size on hulls whose glow is no bigger than the frame:
  Pegasus 43 vs 94, Aurora Carrier 128 vs 214), and a little too big only
  for the IDA Frigate and Aurora Cruiser, whose glow is twice the frame.
- w and h are used separately (line 114-115), so a 17x31 station would get
  a 12 x 22 box; the original's is square from the larger side.
- Stellars use the same `step` (`N/display/planet_corners_plugin.ts:36`).
- The fly-in (`TIME_TO_TARGET = 100` ms, line 22; `scale = 1 + timeLeft /
  20`, lines 106-108) MULTIPLIES the corner offsets by 6 down to 1,
  linearly over 100 ms, so it starts at 6 x 0.354 x size per side (about
  100 px for a Shuttle, 610 px for a Raven); the original adds roughly
  the same 200-290 px per side to every target and is done in about
  100-130 ms. Duration: matches; shape: mismatch (cosmetic).
- Glyph art and colours (`packages/nova/objects/CicnImage/*.png`,
  `objects/TargetCorners/*.json`) are the original's shapes; the
  secondary pixels are a little darker (neutral 88 vs 99, disabled
  100 / 117 vs 115 / 140), probably the original's 16-bit screen
  rounding. Not worth changing.
- Tab and `r` leave the flock out (`N/nova_plugin/combat/target_plugin.ts:58-76`):
  Tab **matches**. NovaJS adds escortTarget (Alt+Tab), which the original
  doesn't have, and click targeting reaches escorts in both.

| target | original box | NovaJS glyph box (live, 0a4e3f60) |
|---|---|---|
| Shuttle (24, glow 48) | 54 | 32 |
| Heavy Shuttle (32, glow and lights 64) | 62 | 43 |
| Thunderhead (48, glow 96) | 78 | 66 |
| Fed Patrol Boat (56, glow 84) | 86 | 57 |
| Pegasus (64) | 94 | 43 |
| Fed Destroyer (80, glow 120) | 110 | 83 |
| IDA Frigate (100, glow and lights 200) | 130 | 139 |
| Aurora Cruiser (120, glow 240) | 150 | 168 |
| Fed Carrier (128, glow 192) | 158 | 134 |
| Leviathan (144, glow 180) | 174 | 125 |
| Aurora Carrier (184) | 214 | 128 |
| Raven (192, glow 288) | 222 (rule) | 202 |
| Europa / Type 3 (40) | 70 | 26 |
| Earth / Kit Port (150) | 180 | 104 |
| Jupiter (325) | 354 | 228 |

**Proposed fix: Applied in c43cddcc** (ship and stellar corners; the fly-in as an additive offset, `FLY_IN_EXTRA_WIDTH` = 490 px over `FLY_IN_MS` = 115 ms; the corner sprites also round to whole pixels so the 1 px glyphs stay crisp; headless re-shoot of the Leviathan, Fed Carrier, Fed Destroyer, Thunderhead, Shuttle, Raven, Earth (150), the 35x22 and 15x21 stations: every box measured by `analysis/brackets.mjs` equals the original's, err 0, 9 x 9 / 11 x 11 glyphs). In `TargetCorners.step` place each glyph so
its OUTERMOST pixel sits at +-(floor(S / 2) + 15) px from the target's
centre on both axes (x0 = centre - floor(S / 2) - 15, x1 = x0 + 2 x floor(S
/ 2) + 29), with S = max(w, h) of the BASE frame only: the shän base image
for ships, the spïn frame for stellars (e.g. a `baseSize` on
AnimationGraphic from `sprites.get('baseImage')`, leaving `size` alone for
its other users), and account for the cicns' 1 px outline (the anchor
goes one pixel outside the target pixel). Optionally make the fly-in an
additive offset (start about 250 px per side, close to 0 in 120 ms). A
spec can pin the table above through `TargetCorners.step` and the
container's bounds.

Confidence: high for the rule (26 frame sizes, 14 stellar and 12 ship,
in about 100 shots, every one on the rule to the pixel; four ship
colours; several hulls whose glow layer is bigger than the frame tell
frame from glow); medium for the fly-in's shape (a 100 ms animation
sampled at 30 fps, its first frames clipped by the play area).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w9/brackets/`:
`esc-a/`, `esc-b/` (the Tab runs, all No Target), `click-a/`, `click-b/`
(`NN-click-RR-K.png`, `panels.png` = the target panels with the box size
under each, `brackets.json`, `recording.mp4`), `sol/`; the stellar shots
are wave 4's and 6's `u9/{step,land,st,fine}-*/*/01-request.png`.
Side-by-side with headless NovaJS (same classes, port 8495):
`side_by_side.png`; the NovaJS shots and the live corner geometry
(`results.json`: corner sprites' bounds, every shän layer's size) in
`novajs/nj_a`, `novajs/nj_b`, with the scripts that made them.

### Submunitions wave 10: when does a shot fire its subs? (2026-11-23)

**Question (Matthew, a long-standing NovaJS bug).** NovaJS fires a
weapon's submunitions whenever its shot hits a ship. The Bible (wëap
SubCount) says subs are created "when the shot reaches the end of its
life or detonates because something wanders into its proximity radius",
which leaves a direct hit out. Matthew suspected it depends on
ProxRadius and the shot's size.

**Rig.** `kits/testkit.mjs` wave 10: sÿst 2045 Kit Sub Range. The player
(Kit Ring Crawler, at rest on Kit Sub Port) targets an immobile magenta
disc 150 px north (shïp 836, 24 px, 30000 armor; or shïp 843, the 96 px
disc, pilots `w10_sub2_big`) and fires one test parent at a time
(secondaries; `w`, a shot of the selection, `ctrl`). Every parent
carries 4 x wëap 251 Kit Sub Star (SubTheta -90, a Medium Blaster
sprite, 2 s life, 0 damage, Flags2 0x0400 planet-type so the subs pass
through the target and stay visible where they were born). Parents:
turret aim, 1 damage, Speed 600 (6 px a frame) or, for the threshold,
Speed 200 (2 px a frame), the 16 px Fusion Pulse sprite unless said.
`scenarios/sub_fire.json`, `sub_fire2.json`; the detonation point is the
parent's last position before it vanished and the centre of the
starburst, read per frame from the recording.

| parent (target 24 px unless said) | what happened | subs |
|---|---|---|
| prox 0, 16 px sprite | hit the body (vanished 19-20 px from the target's centre) | **none** |
| prox 0, 89 px sprite | hit the body (65 px from the centre) | none |
| prox 5 / 8 / 12 | hit the body at 19-20 px, like prox 0 | none |
| prox 16 / 20 / 30 / 60 | detonated short of the body, 24 / 27 / 36.5 / about 66 px from the centre | **yes**, a starburst at that point |
| prox 20, 89 px sprite | hit the body (65 px) | none |
| life 15 frames (expires about 90 px out, short of the target) | expired | yes, where it expired |
| the same with Flags2 0x0020 | expired | none (matches the Bible) |
| prox 0 with Flags2 0x0020 | hit | none |
| guided, prox 0 | hit the body edge (explosion on the rim) | none |
| guided, prox 30 | detonated about 30 px off the rim, with its explosion | yes |
| prox 60 with ProxSafety 30 | flew **through** the target untouched while the fuse was safe, detonated 32 px beyond it the moment the safety ran out | yes |
| turreted beam (300 px, wëap 261) with SubCount 4 written into its record, on the target | hit | none (the original has no beam subs: see 4) |
| the same beam with no target selected | the player's turreted beam did not fire at all | (untested) |
| **96 px target:** prox 0 / 8 / 12 / 16 / 20 | hit the body 54-56 px from the centre | none |
| 96 px target: prox 30 / 60 | detonated 61.7 / 89.5 px from the centre | yes |
| 96 px target: 89 px sprite, prox 0 / 20 | hit (62 px) | none |

**Finding.**

1. **A direct hit never fires submunitions.** Subs come from exactly two
   events: the shot expires (unless Flags2 0x0020), or its proximity fuse
   fires before it touches the body. The starburst is centred on the
   shot's position at that moment (not the target's centre), with the
   arms at ±SubTheta/2 and ±3·SubTheta/2 around the shot's heading for 4
   subs (NovaJS's `getEvenlySpacedAngles` matches).
2. **Which comes first is a race between the fuse and the body.** The
   body is touched when the shot's centre is about the target's radius
   plus half the shot's frame away (24 px disc: 19-20 px for the 16 px
   shot; 96 px disc: 54-56 px); the 89 px sprite connects even earlier
   (62-65 px). The fuse fires at about ProxRadius + 7 px from the centre
   of the 24 px target and ProxRadius + 30 px from the 96 px one: the
   bigger the target, the farther out it fires, by about two thirds of
   the extra radius. So a small ProxRadius (here 12 or less on the 24 px
   target, 20 or less on the 96 px one, 20 with the 89 px sprite) is
   always beaten by the body and never subs; Matthew's guess (it depends
   on ProxRadius and the shot's size) is right, and the target's size
   counts too.
3. **ProxSafety disarms collisions entirely**, body hits included: the
   shot passes through ships until it expires (NovaJS's
   `projectile_plugin.ts:438` skips every collision while safe:
   matches).
4. Beams: not a measurement of this rule. The original has no beam
   submunitions: in a beam's wëap record the bytes a projectile reads as
   SubCount..SubLimit (62-69) are filler (the keyed-union TMPL,
   `F00A`), so the kit's "Sub Beam" (wëap 261, SubCount 4 / SubType 251
   written there) was simply a beam that hit its target for its 8 frames
   and left nothing behind (`tiles/w9.png`). Its untargeted copy (276)
   did not fire at all (a player turret beam needs a target). Beams
   launching subs, and beams as subs, are a NovaJS extension of
   Matthew's, with their own rule (below).

**NovaJS today (base 69e8a400): mismatch.**
- `N/nova_plugin/combat/projectile_plugin.ts:511` calls
  `fireSubs(projectileData.id, uuid, false)` on EVERY collision, so a
  direct hit subs. Expiry (`:264-266`) and 0x0020 (`sub.subIfExpire`,
  `N/nova_plugin/combat/fire_weapon_plugin.ts:668`) match.
- The prox fuse and the body are one collision: a weapon with ProxRadius
  swaps its hurtbox for a circle of that radius
  (`projectile_plugin.ts:164-169`), so there is no "body first" outcome
  to tell apart.
- `N/nova_plugin/combat/beam_plugin.ts:192-194` subs every beam at its
  end when it expires. Beam subs are a NovaJS extension, so there is
  nothing on the original to match.

**Proposed fix.** Keep the sprite hitbox for every shot and
add the prox circle (ProxRadius plus part of the target's radius, see 2)
as a separate test; in `ProjectileCollisionSystem`, fire subs only when
the prox test, not the hitbox overlap, triggered the detonation. A shot
with ProxRadius 0 never subs on impact. Beams: not the original's
business (no beam subs there); keep NovaJS's own rule.

**Applied in d9e989c2.** The rule lives in one function
(`N/nova_plugin/combat/submunition_rule.ts` `submunitionFires`: a direct
hit never subs (since relaxed for ProxRadius > 0, below), a prox
detonation always does, an expiry unless Flags2 0x0020), which `fireSubs` asks per submunition entry. A prox shot keeps
its sprite hurtbox; the fuse is `ProjectileProximityFuseSystem`
(`projectile_plugin.ts`, after the collision pass, so a same-tick tie
goes to the body), firing at ProxRadius + 2/3 of the target's hull
radius (`PROX_FUSE_TARGET_RADIUS_FACTOR_FITTED`: +8 px on the 24 px
disc, +32 on the 96 px one, at or just outside every measured
detonation). Body and fuse share one strike predicate, ProxSafety
included. d9e989c2 also stopped a beam that ended with its ray on a body
from subbing, reading the "Sub Beam" row as a measurement; Matthew
corrected that (2026-11-23: "beam submunitions (beams as subs and beams
launching subs) are a new feature I added"), and the beam rule is back
to his: a beam subs at the far end of its ray when it ends, whatever it
hit, unless Flags2 0x0020 (`beam_plugin.ts` BeamSystem passes
'expired'; the `BeamState.hitLastTick` field d9e989c2 added is gone).

**NovaJS departs deliberately: a direct hit by a shot with ProxRadius > 0
fires its subs.** Matthew's ruling (2026-11-23): "I suspect that a plugin
author who sets a proximity fuse above zero would always want the
submunitions to fire. [...] Prox radius > 0 can serve as the flag that
forces subs to fire". On the original a small fuse loses the race to the
body (finding 2), so e.g. the stock Polaron Multi-Torp. (wëap 182/185,
ProxRadius 10, 5 Polaron Torps) almost never splits; in NovaJS it now
splits on the hit as well. A wëap with ProxRadius 0 (or negative) keeps
the original's rule: no subs on a direct hit. Extra Outfits' Interference
Missile (wëap 303 in "ExtraOutfits v18 Part 1": homing, ProxRadius 0,
ProxSafety 1, Flags 0x8002, Flags2 0x0000, 6 x wëap 304 Optimated IR
Missile at SubTheta 10, SubLimit 6) depends on that: its outfit text says
that if it hits a target before the IR missiles fire, they do no damage.
Flags2 0x0020 stays an expiry-only switch: a fused direct hit subs with
or without it. Of the 102 wëaps with subs in the stock data (3) and the
installed plug-ins (99), 66 have ProxRadius > 0; the ones whose hits
change in practice are those with a small fuse (33 at 20 or less, where
the body usually wins the race), e.g. the Polaron Multi-Torp., Extra
Outfits' Farseeker Missile chain (prox 2), Flak Rounds (5), Scatter
Blaster (5) and Duplicator Mine parts (10). The rule is
`N/nova_plugin/combat/submunition_rule.ts` `submunitionFires`.

Confidence: high for "no subs on a direct hit" (18 hits over three runs,
none subbed; every prox detonation and every expiry did); medium for the
fuse distances (2 px steps at Speed 200, 6 px at 600, two target sizes).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/sub/*/`
(take 1: `tiles/w0-w10.png`, one per parent), `sub2-small/*-retry1/` and
`sub2-big/*/` (take 2; `recording.mp4`, the `sel-*` shots name each
parent).

### NPC friendly fire wave 10: can an NPC's shots hurt its own or an allied govt's ships, and does the victim turn? (2026-11-23)

**Question (Matthew).** In NovaJS an NPC that accidentally hits a
same-govt ally turns hostile to it. On the original, can an NPC's bolts,
missiles, beams and blasts damage a ship of its own govt or an allied
govt at all, and does the victim retaliate?

**Rig.** sÿst 2047 Kit FF Range (`kits/testkit.mjs` wave 10). The player
(Kit Ring Tank, 30000/30000, no weapons) takes off from Kit FF Port and
sits still. An anchored shooter (red disc, 30000/30000) sits 260 px north
and fires at the player; an anchored victim (blue disc, shield 1000 with
no recharge, armor 30000, a 1-damage pea turret) sits 110 px north,
exactly on the line of fire. Both are mïsn ships: the original offers
only ONE main-spaceport (AvailLoc 3) mission per landing (the second
never showed, not even on a second landing, and a bar mission did not
show up), so the shooter is the spaceport offer and the victim a Mission
BBS job. `scenarios/friendly_fire.json`: Tab cycles victim / shooter /
none with a window shot after each press for about 45 s (the target
panel shows the victim's shield %); the recording shows where every shot
goes. Shooter weapons: Kit FF Bolt (turret, 10 damage), Kit FF Beam
(turreted beam), Kit FF Missile (guided), Kit FF Blast (the bolt with a
150 px blast). gövt 362 always attacks the player; 358 and 359 both do
and list each other's class as allies; 363 is neutral.

| shooter -> victim | victim's shield over ~45 s | what the shots did |
|---|---|---|
| bolt, gövt 362 -> 362 (same govt) | **100% throughout** | every bolt flew **through** the victim and hit the player |
| beam, 362 -> 362 | **Shields Down** within the first seconds | the beam stopped on the victim |
| guided missile, 362 -> 362 | 100% | passed it (a guided shot hits only its target, Bible) |
| blast bolt, 362 -> 362 | 89 -> 68% | the bolt passed through; its 150 px blast at the player reached the victim 110 px away |
| bolt, 358 -> 359 (mutual allies) | 84 -> 53% | the bolts **hit** the victim (it shielded the player) |
| bolt, 362 -> 363 (neutral) | 83 -> 52% | the bolts hit the victim |

**Retaliation.** None, in any run. The victim never fired at the
shooter: the bolts between the two discs moved down in 640-730 frames of
every bolt run and up in 2-8 (noise: two bolts at once), the allied and
same-govt victims kept firing their peas at the player, and the neutral
victim (not hostile to the player) never fired at all while it lost half
its shield. The shooter stayed at 100% throughout.

**Finding.**
1. **Same-govt immunity is real for projectiles, not for beams or
   blasts.** A ship's unguided shots pass through ships of its OWN
   government; its beams and blast damage do not (the beam stopped on the
   victim and took its shield down; the blast splashed it).
2. **Allies are not immune.** Mutually allied govts' bolts hit each
   other like any third party's.
3. **No retaliation** within about 45 s, from a victim of the same govt,
   an ally or a neutral, while the shooter was attacking the player (not
   the victim). A guided missile never touched a bystander.

**NovaJS today (base 69e8a400): two mismatches.**
- `N/nova_plugin/ship/firing_group.ts:75` `SAME_GOVT_FIRING_IMMUNITY =
  false` (the clause in `firingImmune`, `:167-172`, is wired but off), so
  same-govt bolts hit. The original: they pass through. Beams and blasts
  must keep hitting the same govt (the clause should apply to
  projectiles only; `beam_plugin.ts` and `blast_plugin.ts` share
  `firingImmune`).
- `N/nova_plugin/npc/npc_targeting.ts:72-74` (`NpcAggressionSystem`)
  makes any damaging non-flock source the victim's `aggressor`, so a
  stray hit from an ally, a neutral or (via beam/blast) its own govt turns
  the victim on the shooter. The original: the victim ignored it.

**Proposed fix.** Set the same-govt clause on for
projectile collisions only (a `weaponKind` argument, or a separate check
in `ProjectileCollisionSystem`), keep beams and blasts as they are; in
`NpcAggressionSystem`, record an aggressor only when the source was
TARGETING the victim (its TargetComponent names it), so stray fire aimed
at someone else provokes nothing. **The `NpcAggressionSystem` half:
Applied in 39e150d4** (an aimed hit, any hit from a player's side, or a
hit from a govt the victim's counts as an enemy still records the
aggressor; strays from its own, allied or neutral govts do not). Not
measured: whether a victim turns
when it is the shooter's own target but of the same govt, and longer
than 45 s.

**Applied in 96168bb4** (the immunity half): `SAME_GOVT_FIRING_IMMUNITY`
(`N/nova_plugin/ship/firing_group.ts`) is a per-effect table, projectile
on, beam and blast off, and `firingImmune` takes the effect kind. It
covers every projectile, guided ones and submunitions included (a
missile locked on a same-govt ship now passes through it too; not
measured). The retaliation half is the 39e150d4 entry above.

Confidence: high for 1-3 in this geometry (one run each, 45 s, 100+
shots per run).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/ff4/{same_bolt,same_beam,same_missile,same_blast,ally_bolt,neutral_bolt}/*/`
(`NN-obs-NN.png` the Tab panels, `recording.mp4`). `ff/`, `ff2/`, `ff3/`
are the attempts that showed the one-offer-per-landing limit.

### #321 wave 10: jünk prices where it is sold and where it is bought, and a stellar in both lists (2026-11-23)

**Setup.** The kit's jünk: 200 Kit Widgets (base 1000, SoldAt Kit Port,
BoughtAt Kit Market), 201 Kit Gadgets (base 150, the reverse) and, new in
wave 10, 202 Kit Doodads (base 400, in BOTH lists of Kit Port). Pilots
`w10_trade_port` / `w10_trade_market` land and open the Trade Center
(`scenarios/trade_junk.json`, `t`).

| stellar | row | tier | price | vs base |
|---|---|---|---|---|
| Kit Market (Widgets' BoughtAt) | Kit Widgets | High | 1250 | x1.25 |
| Kit Market (Gadgets' SoldAt) | Kit Gadgets | Low | 120 | x0.8 |
| Kit Port (wave 1: Widgets' SoldAt) | Kit Widgets | Low | 800 | x0.8 |
| Kit Port (wave 1: Gadgets' BoughtAt) | Kit Gadgets | High | 187 | x1.25 truncated |
| Kit Port, both lists | Kit Doodads | High | 500 | x1.25 |
| Kit Port, both lists | Kit Doodads (a second row) | Low | 320 | x0.8 |

**Finding.**
1. **Confirmed (wave 1 had the Kit Port half):** a jünk is priced at its
   SoldAt stellars (where the player buys it) at the Low tier, base x 0.8,
   and at its BoughtAt stellars (where the player sells it) at the High
   tier, base x 1.25, truncated: the same tiers as the standard goods
   (#321's 80% / 125% assumption holds for the kit's stellars, which have
   no öops price events).
2. **A stellar in both lists shows TWO rows** for that jünk, High and
   Low.
3. **The exchange lists at most 8 rows.** With Doodads' two rows, Kit
   Port's list (6 standard goods + 3 jünk = 9 candidate rows, 10 with the
   double) showed the 6 standard goods and the two Doodads rows only;
   Widgets and Gadgets, which wave 1 saw there, were gone. The jünk rows
   came in the order Doodads (202) before the others, so the 8-row cut
   seems to keep the HIGHER jünk ids; one data point.

**NovaJS (base 69e8a400).** 1 matches (`N/nova_plugin/economy/trade_logic.ts:36`
`tierPrice`, `:126-136` `junkTradeGood`). 2 is a mismatch: `junkTradeGood`
returns ONE row, High when the stellar is in BoughtAt (`:131`); the
original shows a High row and a Low row. 3 is a mismatch:
`N/spaceport/trade_center.ts:366-371` appends every jünk row with no cap.
**Proposed fix (not applied):** return two rows for a stellar in both
lists (High: sell only; Low: buy only) and cap the exchange at 8 rows,
dropping jünk rows past the cap; which jünk wins needs one more run (two
plain jünk and a double at one stellar, or ids in the other order).

**Applied in 9b0c62de** (import fixed in 9a4e14f4;
`N/nova_plugin/economy/trade_logic.ts` `junkTradeGoods`,
`junkExchangeRows`). A stellar in both lists gets a High sell-only row
and then a Low buy-only row, and the exchange keeps at most two jünk rows
below the six standard slots. The rule for which rows survive and their
order is a model that fits all three tables (wave 1 Kit Port, wave 10 Kit
Port and Kit Market): take the jünks highest id first (High row, then
Low) until both slots are full, then list High rows above Low rows. Kit
Market's Widgets High above Gadgets Low is why the order is not id order
alone. The one-more-run above would still test the model. It has a
stock-data case to test on: Schmoo (spöb 322) is in the BoughtAt list of
three jünks, Seafood Delicacies (145), Opals (146) and Durknen Girns
(149). NovaJS now lists Durknen Girns and Opals there and drops Seafood
Delicacies. A reference landing at Schmoo would confirm or refute it.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/trade/{port,market}/*/02-trade.png`
(wave 1's Kit Port table: `20261123-price-flux/`).

### #316 wave 10: strict play vs regular play, and what was already measured (2026-11-23)

**What #316 asked, and what earlier waves already have.** (b) wëap
GuidedTurn: three values were measured in "#316b" (10 / 30 / 60 ->
1.0 / 3.1 / 5.8 degrees a frame), so the two extra values the brief asks
for exist. (c) shïp Turn ("Maneuver"): three values in "#316" (10 / 20 /
30 -> 29.1 / 58.4 / 87.1 deg/s, 2.91 deg/s per unit). Both were measured
with REGULAR-play pilots (the novaref base pilot has strict play off).
New here: Matthew's note that strict play changes the player's speed.

**Setup.** Kit Probe A (Speed 300, Accel 300, Turn 10), `scenarios/unit_probe.json`
(turn in place 14 s, then thrust from rest 6 s), two pilots identical
but for the pilot's strict-play flag (`w10_probe_strict`,
`w10_probe_regular`; pilot-make `strictPlay`, globals offset 2). Speed
from the stellars' on-screen motion (`analysis/world_motion.mjs`, summed
over 20-frame windows; `analysis/motion.mjs` for the turn and the ramp).

| | regular | strict | strict / regular |
|---|---|---|---|
| turn | 29.19 deg/s | 29.19 deg/s | 1 |
| top speed | 4.2-4.5 px a video frame, about 130 px/s (wave 1: 130.65) | 2.9-3.0 px a frame, about 88 px/s | **about 0.68** |
| ramp to top speed | 76 frames | 54 frames | 0.71 |
| acceleration (motion.mjs ramp fit) | 59 px/s² | 64 px/s² | about 1 |

**Finding.** Strict play cuts the player's **top speed to about two
thirds** and leaves **acceleration and turn rate unchanged** (the ramp is
shorter in proportion to the lower top speed). So #316's speed constant
(0.45 x Speed px/s at 30 Hz) is the REGULAR-play value; a strict pilot
flies at about 0.30 x Speed. The NPC comparison (is an NPC's speed
affected?) was not run; NPCs are not part of the pilot's setting, and
every earlier NPC speed reading (F1, A-series) matched regular-play
constants.

**NovaJS (base 69e8a400): mismatch.** Strict play only means permadeath
(`N/title/client_prefs.ts:346-347`, the New Pilot checkbox in
`N/title/title_dialogs.ts:219-252`); no physics reads it. **Proposed fix
(not applied):** scale the player's max speed by 2/3 when the pilot is
strict (one more run with a second hull would pin 2/3 against 0.68).

**Applied in 0a3231f0.** A strict pilot's ship carries
`StrictPlayComponent` (`N/nova_plugin/player/player_state_plugin.ts`),
set from the profile at player start and carried across every hull
change. `EffectiveMovementPhysicsSystem`
(`N/nova_plugin/travel/afterburner_plugin.ts`) caps that ship at
`STRICT_PLAY_SPEED_FACTOR` = 2/3 of its top speed and leaves acceleration
and turn rate alone. The afterburner and the ion slowdown compose with
it. Only the player is affected; escorts and NPCs were not measured. It
rides the player's insertion record, so every peer simulates it. A room
spec covers a rollback across the thrust input and a late joiner's
restore.

Confidence: medium (one run each; the stellar tracking has 1 px steps and
gaps, but both summaries agree on 0.64-0.71).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/probe/{strict,regular}/*/recording.mp4`.

### #324 wave 10: the map after accepting a Mission BBS job while landed (2026-11-23)

**Setup.** mïsn 1032 Kit M BBS job: a Mission BBS (AvailLoc 0) job at Kit
Port to Kit BBS Dest (sÿst 2052, explored), OnAccept `b9074`. sÿst 2054
Kit BBS Shown is explored but has Visibility `b9074`. Pilot `w10_bbs`.
`scenarios/bbs_explore.json`, `bbs_accept.json`, `bbs_followup.json`:
the star map (`m` in the spaceport) before, the BBS, Accept, the map
again in the same visit, the BBS again, leave, the map in flight, land
again, the map, leave, the map in flight.

**What the original's BBS is.** A list on the left, the selected job's
text on the right, and two buttons, **Accept** and **Leave**; there is
**no map button**. Accept takes the job and closes the BBS at once (no
briefing dialog for a job without one); reopening it says "There are no
missions available here." with Okay. (Return in the BBS closed it;
whether `m` does anything inside it was not tried.)

| when | Kit BBS Dest (the job's destination) | Kit BBS Shown (Visibility b9074) |
|---|---|---|
| map before the accept | drawn, no mark | hidden |
| spaceport map right after Accept, same visit | **red mission mark** | **hidden** |
| after leaving, map in flight | mark | **hidden** |
| landed again (same day), map | mark | **drawn** |
| after the second takeoff, map in flight | mark | drawn |

**Finding.** The mission's destination mark is live: it shows on the
spaceport's map in the same visit as the accept. A system whose
Visibility test the accept's OnAccept bit makes true does NOT appear on
the map until the next landing: not in the same visit and not in flight
after leaving. So the original's map reads NCB visibility from state
that is refreshed on landing (probably on landing and on entering a
system; the jump case was not run), not from the live bits. (Legal
records were not part of this test. Side finding: a second landing on
the same day offered no new main-spaceport mission, not even one whose
only gate, b9074, was now set: offers look rolled once per day.)

**NovaJS (base 69e8a400).** #324's fix (7b779a51) makes every docked
map read the landing's working bits (`N/display/starmap_plugin.ts:207-209`
via `playerComponent`), so Kit BBS Shown would appear right after the
accept: the original is staler than that. NovaJS's BBS also has a map
control (`N/spaceport/mission_board.ts:216`, `openMap` at `:251`) that the
original's BBS does not. Marks: match. **For the maintainer:** whether
to copy the stale visibility (refresh visible systems on landing / system
entry only) is a design choice; the faithful behaviour is the stale one.

Confidence: high for what is shown (three runs, the same picture each
time); the exact refresh point (landing vs jump) is open.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/{bbs,bbs2,bbs3}/*/`.

### #320 item 2 wave 10: a govt with NEGATIVE crime penalties (2026-11-23)

**Setup.** gövt 369 Kit Negative Govt (DisabPenalty, BoardPenalty and
KillPenalty all -100, CrimeTol 10) owns sÿst 2060 Kit Negative Range.
The pilot (`w10_negpen`, record 0 everywhere, Kit Lancer with the Kit
Beam Turret, 5000 damage) lands at Kit Negative Port, accepts mïsn 1035
(a Kit Trader of gövt 369, AI 1, beside the port), takes off, targets it
and fires until it is gone, lands again, reads the map's Legal Status,
and leaves (the pilot is written). `scenarios/neg_penalty.json`.

**Result.** The trader was destroyed within the first burst (the target
panel went to "No Target"; the pulled pilot's combat rating went 0 -> 4,
so the kill was credited). The record in sÿst 2060 stayed **0** in the
pulled pilot, and the map read "Legal Status: No Record" before and
after. (A14 wave 5's positive control: the same kind of kill with
penalties 50 / 100 moved the record by -150.)

**Wave 11 caveat:** killing a goal-less MISSION trader changed no record
even with ordinary positive penalties (four runs, "A14 follow-ups wave
11"), and this run's victim was such a ship, so the result below may
come from that rule and not from the negative penalties; re-run with
system traffic as the victim before relying on it.
**Wave 12: re-run with system traffic, and refuted:** a kill of the
-100 / -100 govt's own traffic RAISED the record by 200 ("A14 with system
traffic as the victims, wave 12"); the "matches" below no longer holds.

**Finding.** A negative penalty is not applied in either direction: the
crime neither lowers nor raises the record (no "reward for the crime",
no absolute value). **NovaJS matches:** `N/nova_plugin/reputation/reputation.ts:131-140`
`crimePenalty` returns 0 for a negative field (#108). Nothing to change.
SmugPenalty was not tested.

Side finding (UI matrix): in flight, `i` opens the "Currently active
missions" dialog (Abort / Done), not a player-info screen, in this
install.

Confidence: high (one run, an unambiguous record).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/negpen/*/`
(`pilot-after/`, `02-map-before.png`, `08-map-after.png`).

### #344 wave 10: Escape (and Cmd-Q) during a hyperspace jump (2026-11-23)

**Setup.** Pilot `w2_map` at Map Hub, as in "M2 leftover": the big map,
Tab to Map SW, close it, thrust 2 s, `j`. The jump takes about 5.7 s
from `j` to the arrival message (the white flash just before it).
`scenarios/jump_escape_{1000,3500,5500}.json` press Escape 1.0 / 3.5 /
5.5 s after `j` (stamps: 1.2, 3.7, 5.7 s); `jump_cmdq_3000.json` presses
Cmd-Q at 3 s. Each then shoots, presses `e` (Enter Ship if at the title,
the escort menu if still in flight), shoots, and the run quits and pulls
the pilot. Escape in normal flight goes straight to the title screen
(reliability notes).

| key, when | what happened |
|---|---|
| Escape at 1.2 s (turning / accelerating out) | **ignored**: the jump went on, arrival in Map SW; no pause, no title, not even after arriving |
| Escape at 3.7 s | **ignored** the same way |
| Escape at 5.7 s (the frame of the arrival) | the game had just arrived ("Nav System Off" drawn) and went to the title screen 7 frames later, as from normal flight. The title showed the NEW date (June 24th); Enter Ship then put the pilot in **Map SW** ("Jumping into the Map SW system on June 24th"): the jump was kept |
| Cmd-Q at 3 s | **deferred**: the jump finished ("Arriving in the Map SW system"), and about 1 s after the arrival the usual "Are you sure you want to quit?" (Cancel / OK) appeared |

The pilot FILE was not written by any of this: every pulled pilot still
had the pushed date and last stellar (the game writes it when the player
leaves a spaceport, not on a jump or an exit to the title); the jump
survives the exit to the title in memory, which is what Enter Ship
resumed from.

**Finding.** The original refuses Escape during a jump: it is dropped,
not queued, for the whole sequence up to the arrival; the quit path is
queued until the arrival. Once arrived, Escape behaves as in flight and
the session keeps the completed jump. That supports Matthew's "likely
block Escape during the jump" (#344 option c); an exit right after the
arrival keeps the jump (option b's outcome, not option a's "jump undone").

**NovaJS (base 69e8a400): mismatch.** `N/client/client_state.ts:322-327`
`canExitToTitle` admits every transit except the startup one, so an
Escape during a jump's transit exits to the title (with the last periodic
save, up to 10 s old, standing: #344's description).
**Proposed fix (not applied):** exclude jump transits in
`canExitToTitle` (drop the key while `state.kind === 'transit'`), and
make sure the save taken at the arrival includes the jump.

**Applied in 640e3181.** `canExitToTitle` refuses Escape during the
`hyper` transit. It also refuses it in space while the player's ship is
in a departure stage (stopping, aligning, spin-up, the burn); title_flow
reads that off the display world (`displayPlayerJumping` in
`N/client/frame_pump.ts`). The key is dropped, not queued. The arrival
tick does not count, so Escape works on arrival, and the exit's save
names the new system. Gate, Mxxx-move and re-entry transits stay
interruptible; they were not measured. Cmd-Q has no in-game handler in
NovaJS, so its deferral does not apply.

Confidence: high (four runs, each unambiguous on video).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/jump/{esc1000,esc3500,esc5500,cmdq3000}/*/`
(`recording.mp4`, `recording.events.json`, `pilot-after/`).

### Route planning through unexplored systems, wave 10 (2026-11-23)

**Question (Matthew).** D-U-D and D-U-U-D are allowed; NovaJS is being
changed to route through any system the map draws. On the original: does
ONE shift-click on a far explored system make the router itself go
through unexplored systems? Does a D-U-U-U-D chain route? Can a system
the map does not draw ever be routed through?

**Setup.** The kit map region (M-batch): Hub - East (unexplored) - Void
(unexplored, no stellar) - Far - Island. Pilot `w2_map` has Far and
Island explored (D-U-U-D-D); pilot `w10_route_b` is the same without Far
(Hub D - East U - Void U - Far U - Island D). `scenarios/route_unexplored.json`:
the big map, ONE shift-click on Island, Clear Route, ONE shift-click on
Far, Clear Route, then shift-click pins East, Void, Far, Island with a
shot after each.

| pilot | one shift-click on Island | one shift-click on Far | pins East, Void, Far, Island |
|---|---|---|---|
| D-U-U-D-D (Far explored) | **ignored** (no route, panel unchanged) | **ignored** | route grows hop by hop: Hub-East, -Void, -Far, -Island (as wave 2) |
| D-U-U-U-D (Far unexplored) | ignored | ignored | Hub-East only: **Void is not drawn** (no explored neighbour), the click on its spot does nothing, and the later pins on Far (drawn: it neighbours Island) and Island add nothing |

**Finding.**
1. The original's router never plans through an unexplored system by
   itself: a single shift-click on an explored system whose only path
   crosses unexplored ones is ignored. Unexplored hops come only from
   pins, one hop at a time.
2. Pins only work on systems the map DRAWS; a system with no explored
   neighbour is not drawn, so a D-U-U-U-D chain whose middle U touches no
   explored system cannot be pinned through, and the route stops at the
   last drawn, linked hop. A D-U-U-U-D chain with every U drawn (each
   next to some explored system) was not available in the kit.
3. So: an undrawn system can never be routed through; a drawn unexplored
   one only by pinning it.

**NovaJS (base 69e8a400).** `N/spaceport/route.ts:19-29` today refuses
every route through an unexplored system (the D-U-U-D quirk is
deliberately not reproduced). The planned change ("route through any
system the map draws") matches 2 and 3 for pins; it must NOT make a
single shift-click auto-route through unexplored systems (1). Not
measured: whether the original auto-routes a single shift-click through
EXPLORED intermediate systems (the kit region has no such path).

Confidence: high (two runs, unambiguous shots).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/route/{dud,duuud}/*/`.

### M1 wave 10: the `h` minimap's fade, and how long its hidden area stays clickable (2026-11-23)

**Question (Matthew).** Wave 2 wrote "Clicks work while it is hidden"
without saying how long after the hide the click came: "Are you sure you
waited well past the fade out time?" Also: does it fade in and out, how
long, linearly?

**Setup.** Pilot `w2_map` at Map Hub. The minimap's box (window 414,151,
208 x 206) is measured per frame from the recording: the summed
brightness of the box and the count of lit pixels (the cursor, parked
outside between steps, adds a 30-pixel blip in the frames a click sits
on it). `scenarios/minimap_fade.json`: `h`, then clicks on alternating
neighbours (NE 562,178; SW 430,342; WSW 468,236; East 589,254) at growing
delays; `minimap_window.json` and `minimap_window3.json`: `h`, then clicks
7.4 / 6.8 s after the hide and later. The nav panel names the pick.

**The fade.** The map appears at full brightness within one frame of
the key (no fade-in), stays fully lit for about **60 frames (2.0 s)**,
then fades out **linearly over about 16 frames (0.53 s)** (the box's
brightness falls by a near-constant 20-28 k per frame from 366 k to the
background), so the last pixel goes about **2.5 s** after the key. The
same for every re-show by a click. (Wave 2's "64-66 frames" ended
mid-fade.)

| take | click | after the last visible pixel | after that peek was shown | picked? re-shown? |
|---|---|---|---|---|
| 1 | NE | 0.6 s | 3.1 s | yes (Hyperspace Map NE), yes |
| 1 | SW | 1.7 s | 4.2 s | yes, yes |
| 1 | WSW | 4.4 s | 6.8 s | yes, yes |
| 1 | East | 11.5 s | 14 s | **no** (still WSW), no |
| 1 | NE | 22 s | | no, no |
| 2 | SW | 7.4 s | 9.9 s | **no** (No Destination), no |
| 2 | NE / WSW / SW | 20 s and more | | no, no |
| 3 | SW | 6.8 s | 9.3 s | **no** (No Destination), no |
| 3 | NE / WSW | 18 s and more | | no, no |

**Finding.** The wave-2 claim is **confirmed for a few seconds and
overturned for long waits**: the hidden minimap keeps taking clicks (a
click picks the system and re-shows the map) for at least 4.4 s after
its last pixel faded and at most 6.8 s (6.8 to 9.3 s after the peek
began); after that its area is dead and clicks there do nothing. A
plausible reading is a click window of a fixed time (about 7-9 s) from
the show, longer than the 2.5 s the map is visible. Not tested: whether
a ship or planet under the box can be clicked or targeted during that
window (in flight a click on space did nothing visible in these runs).

**NovaJS.** The persistent-toggle mismatch is M-batch item 2; the
click-through fix being written in parallel should use: shown 2.0 s at
full alpha, a linear fade over 0.53 s, no fade-in, and clicks accepted
until somewhere between 4.4 and 6.8 s after the fade ends (6.8-9.3 s
after the show; 8 s from the show is inside both bounds), not
indefinitely.

Confidence: high for the fade and for the bounds (three runs, 12
clicks); the exact cut-off inside 6.8-9.3 s after the show is open.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/{minimap,minimap2,minimap3}/*/`
(`recording.mp4`, the click shots).

### #320 item 3 wave 10: CompReward on an auto-aborting mission (2026-11-23, immediate case only)

**NovaJS first.** `N/nova_plugin/missions/mission_accept_offer.ts:111-135`:
an auto-abort mission (Flags 0x0001) whose goal is not board/rescue
(`deferredAutoAbort`, `mission_auto_abort.ts:41-45`) runs OnAccept then
OnAbort AT ACCEPT and never becomes active; the 0x0040 "-5x CompReward
reversal on abort" is deliberately NOT applied (the comment cites the
stock enforcement squads), for the deferred kind too.

**Setup.** mïsn 1036 (Flags 0x0041) and 1037 (0x0001): one Kit Escort
special ship at ShipStart -1, no goal, CompGovt 360 (Kit Range's owner),
CompReward 20, OnAccept b9078, OnAbort b9079, offered on landing at Kit
Port. `scenarios/auto_abort.json`: accept, leave (the pilot is written:
`pilot-leave1`), 3 s in flight, Tab, `i` (active missions), land, leave
again (`pilot-leave2`). Pilots `w10_aa40` / `w10_aaplain`, record 0.

**Result (0x0041; the plain mission's earlier runs agree as far as they
went).**
- At accept and in the spaceport: b9078 (OnAccept) set, the mission
  ACTIVE (it is in the pilot written at the Leave).
- In flight, 3 s after takeoff: the special ship exists (Tab: Kit
  Escort) and `i` answers "You have no active missions.": the mission
  aborted when its special ship was created, at takeoff, not at accept.
- The pilot written at the next Leave: b9079 (OnAbort) set, the record
  in sÿst 2100 still **0**: no CompReward (+20) and **no -5x reversal
  (-100)** even with 0x0040. (The landing offered the mission again,
  since its availability bit was still set.)

**Finding.** An immediate auto-abort fires OnAccept at accept and
OnAbort when the special ships appear; CompReward is neither granted nor
reversed, 0x0040 or not. **NovaJS matches** on the record (no
reversal) and the bits; it runs OnAbort at accept rather than at the
special ships' creation (a timing difference only visible to a test that
reads the bits while still landed).

**Applied in 0cf672ea.** The timing now matches. A docked accept runs
OnAccept and queues the ships with `onAbortPending`. At the lift-off,
`runLiftoffAutoAborts` (`N/spaceport/mission_session.ts`, called from
`prepareMissionShips`) runs OnAbort once, just before the ships are
built. An in-flight accept, whose ships come with its own record, and a
mission without ships still run OnAbort at accept. OnAccept, the 0x0002
Pay, the date and the notice stay at accept; their timing was not
measured. CompReward is still neither granted nor reversed. The DEFERRED case (a board/rescue
goal, aborting when the ship is boarded) was **not run** (boarding needs
the U9 loop; left for a later wave).

Confidence: high for the immediate case (three runs; the final one
read the mission list in flight and the record after the abort).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/autoabort3/flag40/*/`
(`05-missions.png`, `pilot-leave1/`, `pilot-leave2/`); `autoabort/`,
`autoabort2/` are the earlier attempts (their second Leave never happened).

### Outfits that scale with the ship's mass (oütf Flags 0x0200 / 0x0400), wave 10 (2026-11-23)

**Setup.** Kit outfits at the top of Kit Port's outfitter: oütf 452 Kit
Mass Price (0x0200, Cost 100, Mass 0), 453 Kit Mass Mass (0x0400, Mass 10,
Cost 1000), 454 Kit Mass Both (0x0600, Cost 100, Mass 10), 455 Kit Plain
Mass (control). Player hulls Kit Mass Hull 37 / 50 / 100 / 155 / 300
(shïp 846 / 848 / 844 / 847 / 845: that Mass, 25 t free, nothing else
installed). `scenarios/outfit_mass_buy.json`: select Kit Mass Both (the
panel shows Item Price and, for an item with mass, **Item Mass** and
**Available**), buy and sell one Kit Mass Price, then press Buy on Kit
Mass Mass nine times with a shot after each (a refused buy is silent: no
dialog, nothing changes). Pilots `w10_mass_{37,50,100,155,300}`.

| hull Mass | 0x0200 Item Price (Cost 100) | charged / refunded (same visit) | 0x0400 Item Mass (Mass 10) | units that fit in 25 t | Both (0x0600) |
|---|---|---|---|---|---|
| 37 | 3,700 | 3,700 / 3,700 | **10** (not 3.7 or 4) | 2 | 3,700, 10 t |
| 50 | 5,000 | 5,000 / 5,000 | **10** (not 5) | 2 | 5,000, 10 t |
| 100 | 10,000 | 10,000 / 10,000 | 10 | 2 | 10,000, 10 t |
| 155 | 15,500 | 15,500 / 15,500 | **15** (15.5 truncated) | 1 | 15,500, 15 t |
| 300 | 30,000 | 30,000 / 30,000 | 30 | 0 | 30,000, 30 t |

**Finding.**
1. **0x0200 price = hull Mass x Cost**, exactly, charged as shown; a unit
   sold back in the same visit refunds the full price.
2. **0x0400 mass = max(oütf Mass, floor(hull Mass x oütf Mass / 100))**:
   proportional above Mass 100, truncated (155 -> 15), and never below
   the item's own Mass (37 and 50 -> 10, not 3.7 / 5). Both flags
   together combine the two rules independently.
3. "Mass" is the hull's class Mass here: the hulls carried nothing else,
   so whether a loaded ship's current mass would count, and what happens
   to an installed 0x0400 item on a trade-in, were not measured; nor was
   stock Carbon Fiber.

**NovaJS (base 69e8a400).** Price matches
(`N/spaceport/outfitter_rules.ts:447-452` `outfitPrice`). Mass is a
mismatch: `N/nova_plugin/ship/outfit_plugin.ts:77-84`
`installedOutfitMass` returns `Math.ceil(shipMass * mass / 100)`, so 37 ->
4, 50 -> 5 and 155 -> 16 where the original gives 10, 10 and 15.
**Proposed fix (not applied):** `Math.max(mass, Math.floor(shipMass * mass / 100))`.
The same-visit refund is outside this test's NovaJS reading (resale is
50% for a pre-owned unit, `outfitter_rules.ts:479-481`).

**Applied in a20de606** (`installedOutfitMass`). The five hulls are
pinned in specs for the 0x0200 price, the 0x0400 mass, the units that fit
in 25 t, and 0x0600. The same-visit refund already matched:
`sellRefund` credits the full hull-scaled price for a unit bought this
visit and 50% for a pre-owned one. That is now pinned for the five hulls
too.

Confidence: high (five hulls, every number read off the shop's own
panel and the credit count).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w10/mass/{buy37,buy50,buy100,buy155,buy300}/*/`
(and `explore100/`, the first look at the shop).

### Reviving a disabled ally, wave 11: mission ally, hired escort, plain NPC (2026-11-23)

**Question (Matthew, wave 10 item 5).** Can the player revive (repair or
recharge, by boarding or hailing) a disabled ally that a mission assigned,
and to how much shield / armor / fuel? Compare a hired escort and a plain
friendly NPC; Matthew suspects NovaJS's revive amount is wrong.

**Rig.** `kits/testkit.mjs` wave 11: shïp 849 Kit Ally Pointer, the 24 px
pointer hulk sprite on a working AI 3 hull (shield 1000, armor 3000, NO
shield or armor recharge, one Kit Escort Gun), so what a revive restores
stays on the target panel. The player (Kit Ring Tank, 30000 / 30000) taps
wëap 277 Kit Blast 600 (the muzzle blast bomb at 600 damage) one shot at
a time until the panel says Disabled (`loops/disable.mjs`), hails it
(`y`), then boards it (`loops/board.mjs`, the wave-8 sweep;
`stopWhenEnabled` ends the walk at a repair). The ship is: the mïsn 1038
ShipBehav 1 / ShipGoal 3 escort (pilot `w11_ally`), a hired escort
(`w11_hired`, targeted by a click since Tab skips escorts), the same hull
of the neutral gövt 363 with no goal (`w11_neutral`), and mïsn 1040 /
1041 / 1046 rescue ships (ShipGoal 5, which start disabled; below and in
"#320 item 3 wave 11"). `scenarios/revive_ally.json`, `revive_hired.json`,
`revive_hired2.json`, `rescue.json`.

| ally | disabled by the player? | hail when disabled | board when disabled | after |
|---|---|---|---|---|
| mission escort (ShipBehav 1, ShipGoal 3) | yes, 5 taps; **"Mission failed."** at the moment it went Disabled (`i`: "You have no active missions.") | **"No response."** on the status line, no channel | **the plunder dialog** (Energy 270, Capture Odds 13%, Cargo / Credits / Ammo grey), as any hulk | stays Disabled |
| hired escort | yes, 5 taps (panel "Disabled ... Escort") | **"No response."** | **"Escort repaired."**, no dialog, at 12 px | flies formation again; panel **"Shields Down"** (shield stays 0); ONE more 600 tap disables it again |
| mission ship with ShipBehav 1 that starts disabled (rescue, mission running) | (spawned disabled) | not tried | **"You can't board this ship."** at every press (40 presses, 220° of sweep) | stays Disabled; the mission stays active |
| plain neutral NPC (AI 1) | not reached: it flew out of the blast's reach and jumped out after 5 taps | | (wave 8: a neutral hulk the player disabled opens the plunder dialog with capture odds) | |

Before it was disabled, the mission escort answered a hail with a
channel ("What do you need?", Status: Escort, Greetings / Request
Assistance / Close Channel).

**Finding.**
1. **Only the player's own escort can be revived, and only by boarding:**
   "Escort repaired." Hailing a disabled ship (escort or not) gets "No
   response.".
2. **The repair is minimal: armor just above the disable threshold,
   shields NOT recharged.** The hull's shield stayed at 0 ("Shields Down")
   and one 600-damage blast disabled it again, so the repair left its
   armor between the 33% threshold (1000) and about 1600 (53%) of 3000.
   Fuel was not observable.
3. **A mission ally is not the player's escort.** Disabling a ShipBehav-1
   / ShipGoal-3 ship fails the mission at once, and the hulk is then an
   ordinary ship: no revive, the plunder dialog with capture. While a
   ShipBehav-1 mission ship's mission runs it cannot be boarded at all
   ("You can't board this ship.").

**NovaJS today (base 7c184cdf): four mismatches.**
- `N/nova_plugin/encounters/boarding_plugin.ts:560-590`: boarding a
  disabled ship in the player's flock (`isInFlock`) or marked
  `PlayerEscortComponent` repairs it (`repairHulk`, `:240-251`): armor to
  threshold + 10% (`N/nova_plugin/ship/disabled_component.ts:77,110`,
  1300 of 3000 here, inside the measured bound) but **shields to full**
  (`:248-250`); the original leaves the shield where it was.
- A mission ShipBehav-1 / escort-goal ship gets `FormationComponent`
  leader = the player (`N/nova_plugin/missions/mission_ship_spawn.ts:438-446`),
  so it is in the flock and NovaJS **repairs** it on boarding; the
  original fails the mission when it is disabled and then plunders it.
- `N/nova_plugin/player/mission_ship_state.ts:218-220`: the escort goal
  fails only when the ship DIES; the original fails it at the disable.
- `N/display/hail_dialog_plugin.ts:672-680`: a disabled target still
  opens a channel; the original answers "No response.".
- (Not checked in NovaJS: the "You can't board this ship." refusal for a
  live mission's ShipBehav-1 ship.)

**Proposed fix (not applied).** In `repairHulk`, leave the shield alone
(armor to just above the threshold only); restrict the own-escort repair
to hired / captured escorts and bay fighters (not mission ships); fail an
escort goal when its ship is disabled; refuse a hail to a disabled ship
with the no-response line; refuse boarding a live mission's ShipBehav-1
ship with "You can't board this ship.".

**Applied (three of the five).**
- **8dd48ba2**, the repair: `repairHulk` no longer touches the shield.
  The armor margin is unchanged, `REPAIR_MARGIN_FRACTION` (threshold +
  10% of max, 43% = 1300 of 3000 on the kit hull): inside the measured
  33%-53% bracket, and one 600 blast re-disables it as on the original.
  b0f969a1: the status line now reads "Escort repaired." (STR# 2002
  #126) instead of NovaJS's own sentence.
- **c2e3b590**, mission allies: the own-escort repair skips mission ships
  (boarding a disabled mission ally opens the plunder dialog); an escort
  goal fails the tick its ship is disabled (`shipDisabled`); the display
  prints "Mission failed." (STR# 2002 #283) when a ship goal fails in
  flight, and Mission Info hides that mission. OnFailure still runs at
  the next landing, as for every sim-marked failure. The other in-flight
  goal failures (an escorted ship killed, a disable target destroyed) get
  the same line, unmeasured. Specs in 7396f890.
- **5bb32a3d**, the hail: a disabled target gets "No response." (STR#
  2002 #52, the dead-moon line) and no channel, before any hail offer.
  Every stock derelict përs offers on boarding (0x0200), so none is lost.
- **Not applied:** "You can't board this ship." for a live mission's
  ShipBehav-1 ship. The refusal was measured on goal-5 rescue ships only
  (ShipBehav 1 and -1 alike, so ShipBehav is not its cause), and see the
  next section for why that refusal is not applied either.

Confidence: high for 1 and 3 (one run each, unambiguous messages and
dialogs); medium for the armor bound in 2 (blast damage at that distance
assumed full; one re-disable).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w11/revive/{ally,hired,hired2,neutral}/*/`
(ally `20261123-212724-*`: `10-dis-tap-06.png` "Mission failed.",
`12-hail.png`, `68-sw-54.png` the dialog; hired `42-b-31.png`; hired2
`84-repaired.png`, `87-dis-tap-01.png`), `rescue/plain/*/`.

### #320 item 3 wave 11: the board / rescue auto-abort, and rescue ships (2026-11-23)

**Question.** Wave 10 settled the immediate auto-abort (OnAbort when the
special ships appear, no CompReward and no -5x reversal). The Bible's
DEFERRED case: "If the mission is one in which a special ship replaces a
përs ship at mission start ... and the SpecialShipGoal is 2 or 5 (board
or rescue) the mission will auto-abort after the special ship is
boarded."

**Setup.** mïsn 1040: Flags 0x0001, ShipGoal 5 (rescue: the ship starts
disabled), ShipBehav 1, one Kit Ally Pointer (gövt 360) at Kit Port,
CompGovt 360 / CompReward 20, OnAccept b9084 (and clears its own
availability bit), OnAbort b9085, OnSuccess b9086; mïsn 1041 the same
without 0x0001 (ReturnStel Kit Port); mïsn 1046 = 1041 with ShipBehav -1.
No përs is involved (the kit has none). `scenarios/rescue.json`: accept,
leave (pilot `leave1`), Tab, the mission list, board the hulk
(`loops/board.mjs`), the list again, land, leave (`leave2`). Pilots
`w11_rescue_aa`, `w11_rescue`, `w11_rescue_free`.

| mission | in flight | boarding the disabled special ship | pilot after the next Leave |
|---|---|---|---|
| 1040 (0x0001, goal 5) | `i` 3 s after takeoff: "You have no active missions." | the **plunder dialog** (Energy 140, Capture Odds 9%; left with Abort) | b9084 + **b9085** (OnAbort), no b9086; **record 2100 = -50** (gövt 360's BoardPenalty) |
| 1041 (goal 5, ShipBehav 1) | active ("Kit R rescue") | **"You can't board this ship."** at every press (40 presses over 220° of heading) | still active; b9084 only; record 0 |
| 1046 (goal 5, ShipBehav -1) | active | **"You can't board this ship."** the same | still active; record 0 |

**Finding.**
1. **Without a përs replacement, a board / rescue goal does not defer
   the auto-abort**: mïsn 1040 aborted when its ship was created, exactly
   like wave 10's goal-less case (OnAbort set, no CompReward, no
   reversal). Its ship is then an ordinary hulk of its govt, and boarding
   it is a crime (BoardPenalty, -50 in the current system's record).
2. **A ShipGoal-5 special ship that is not a përs replacement could not
   be boarded at all** while its mission ran ("You can't board this
   ship.", ShipBehav 1 or -1), so these kit rescue missions could never
   complete. The deferred abort the Bible describes needs a përs with a
   LinkMission whose ship the special ship replaces; the kit has no përs,
   so that case is **still open** (a përs kit is the next step).

**NovaJS (base 7c184cdf).** `N/nova_plugin/missions/mission_auto_abort.ts:41-45`
`deferredAutoAbort` defers EVERY goal-2/5 auto-abort mission to the
board, përs or not; the original deferred none of the kit's. **Proposed
fix (not applied):** defer only when a special ship replaced a përs
(`ReplacementPlacement` present), else abort at once as for other goals.
Boarding: NovaJS lets the player board a live mission's rescue hulk
(`N/display/boarding_plugin.ts` presents board / rescue goals through the
boarding dialog); whether the original's refusal also holds for përs
rescue ships is untested, so leave that until the përs run.

**Applied in 9b3f4aab** (finding 1): `deferredAutoAbort(mission,
replacesPers)` defers only when the in-flight ship-offer accept replaced
the offering përs (përs Flags 0x0040, carried as
`MissionOffer.replacesPers`); every other board/rescue auto-abort takes
the immediate path (OnAbort at the ships' creation, no CompReward, no
reversal). The përs case keeps today's deferral: still unmeasured, and it
is every stock user (the four Refuel Traders, nova:141/650-652, offered
only by 0x0040 përs).

**Not applied** (finding 2, the boarding refusal for a live mission's
non-përs rescue ship). Stock data argues against reading it as a rule:
mïsn nova:394 "Rescue Raczak" is ShipGoal 5 with no përs and no
auto-abort, and the refusal would make it uncompletable, along with any
plug-in rescue mission offered from a board or bar. The cause is still
inferred; a run against nova:394 itself would settle whether a stock
rescue ship refuses the board the same way or whether something about
the kit missions causes it.

Confidence: high for 1 (one run, bits and record read back); medium for
2 (two runs, every press refused; the cause is inferred).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w11/rescue/{aa,plain,free}/*/`
(`pilot-leave1/`, `pilot-leave2/`, `26-b-20.png` the aa dialog).

### Mass-scaled outfits wave 11: across a trade-in, and base vs loaded mass (2026-11-23)

**Setup.** oütf 457 Kit Mass Keep (Flags 0x0404: mass-scaled AND
persistent, Mass 10, Cost 1000) and wave 10's 453 Kit Mass Mass (0x0400);
hulls shïp 850 / 851 Kit Mass Roomy 100 / 300 (Mass 100 / 300, 200 t
free, cost 100,000). Pilot `w11_mass`: Roomy 100 LOADED with 5 Kit Plain
Mass (50 t), 1 Kit Mass Keep and 50 t of food. `scenarios/mass_trade.json`
(take 2: Buy Ship is at 452,442; 371,443 is Info): the outfitter (Item
Mass of 453; buy a second Keep), the shipyard (buy Roomy 300, which asks
for the new ship's name), the outfitter on the new hull.

| reading | value |
|---|---|
| Kit Mass Mass (0x0400) Item Mass on the loaded Mass-100 hull (100 + 50 t outfits + 50 t cargo) | **10 tons** (hull class Mass 100; a loaded 200 would give 20) |
| Available before / after buying a second Keep | 140 / 130 tons |
| Roomy 300: Ship Price / Trade-In / Final | 100,000 / **27,500** / 72,500 (credits 999,000 -> 926,500) |
| after the trade-in, on Roomy 300 | the 2 Keeps came along (persistent); the 5 Plain Mass did not; Keep's **Item Mass 30 tons**, Available **140** = 200 - 2 x 30 |

**Finding.**
1. **"Mass" is the hull CLASS Mass**, not the loaded mass: outfits and
   cargo aboard do not change a 0x0400 item's mass.
2. **An installed 0x0400 item's mass follows the CURRENT hull**, not the
   hull it was bought on ("at purchase" in the Bible notwithstanding): a
   persistent Keep bought at 10 t on Mass 100 weighs 30 t on Mass 300.
   (The pilot file stores only counts, so the original has nothing else
   to go on.)
3. The trade-in was 27,500 = 25% of 110,000 with a 100,000 hull, 5,000
   of Plain Mass and 2,000 of Keeps aboard (107,000): 3,000 of value not
   accounted for (the 50 t of food? the Keeps at a mass-scaled price?);
   one data point, not pinned down.

**NovaJS (base 7c184cdf).** 1 and 2 match in shape:
`N/nova_plugin/ship/outfit_plugin.ts:77-84` `installedOutfitMass(outfit,
shipMass)` uses the current hull's class mass (the rounding is wave 10's
mismatch). 3: `N/spaceport/shipyard_rules.ts:216` `tradeInValue` =
25% x (hull + non-persistent outfits) = 26,250 here vs 27,500 measured:
**unexplained 1,250**; worth one more run (empty hold, no persistent
outfits) before changing anything.

Confidence: high for 1 and 2 (read off the shop's own panel); low for 3.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w11/mass/{trade,trade2}/*/`
(trade2: `03-mass-loaded.png`, `08-roomy300.png`, `15-keep2.png`).

### Submunitions wave 11: a beam that ends untouched, and a third target size (2026-11-23)

**Setup.** As "Submunitions wave 10" (Kit Sub Range, the player at rest
on Kit Sub Port, the target 150 px north), with shïp 852 Kit Sub Target
48 (a 48 px magenta disc, rlëD 1963, mïsn 1042). Pilot `w11_sub48`
fires, one at a time, the slow parents 269-273 (Speed 200 = 2 px a
frame, prox 8 / 12 / 16 / 20 / 30) at it, then wëap 278 Sub Beam Short (a
turreted beam 100 px long: it ends 26 px short of the target's rim) and
279 Sub Beam Fixed (guidance 0, 300 px, fired along the nose into empty
space). `scenarios/sub_fire3.json`; read from the recording, every 4th
frame after each trigger (`ffmpeg ... tile`), positions relative to the
target's centre.

| parent | 48 px target | where it ended |
|---|---|---|
| prox 8 | hit the body, **no subs** | about 33 px from the centre |
| prox 12 | hit the body, **no subs** | about 33 px |
| prox 16 | **subs** | starburst about 31-33 px out (just ahead of the body contact) |
| prox 20 | **subs** | about 35 px |
| prox 30 | **subs** | about 43 px |
| Sub Beam Short (turreted, ends short) | no subs | the beam drew for about 6 frames and vanished; nothing at its tip |
| Sub Beam Fixed (into empty space) | no subs | the same |

**Finding.**
1. **The fuse's target-size term, third point:** on the 48 px disc the
   fuse fires at about ProxRadius + 13-15 px from the centre, between the
   24 px disc's +7 and the 96 px disc's +30 (wave 10). The three sizes
   fit fuse distance ≈ ProxRadius + 0.6 x (target radius) (radius 12 / 24
   / 48 -> +7 / +14 / +29), so the race against the body (contact at
   about radius + 8-9 px for the 16 px shot) is won by the fuse when
   ProxRadius > about 0.4 x radius + 8 px: 16 px here, between wave 10's
   12-16 (24 px) and 20-30 (96 px). Resolution ±4 px (4-frame sampling,
   2 px a frame).
2. **Beams never fire subs**: neither on a hit (wave 10) nor when the
   beam ends untouched, turreted or fixed.
3. Side finding: the neutral AI 1 target's brackets turned from yellow to
   red after the first 1-damage hit (it became hostile; it cannot fire).

**NovaJS (base 7c184cdf).** 1: the prox fuse is a circle of ProxRadius
alone (`N/nova_plugin/combat/projectile_plugin.ts:164-169`); the wave-10
proposed fix (a separate prox test of ProxRadius plus part of the target's
radius) should use about 0.6 x the target's radius (half its sprite
width). 2: **mismatch**, `N/nova_plugin/combat/beam_plugin.ts:192-194`
subs every beam when it expires. **Proposed fix (not applied):** never
fire a beam's subs (drop the expiry `fireSubs` for beams).

Confidence: medium-high for 1 (one shot per parent; the yes/no is clear,
the distances ±4 px); high for 2 (two beams, every frame after the
trigger shows nothing).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w11/sub/48/*/recording.mp4`
(triggers at frames 173 / 490 / 802 / 1117 / 1435 / 1766 / 2089, the
`sel-NN` shots name each parent).

### Multi-jump routes and the `j` key, wave 11 (2026-11-23)

**Question (wave-11 seed; a NovaJS bug report says releasing `j` before
the arrival still jumps again).** With a 3-hop route, does one tap of `j`
jump once or follow the whole route; does holding `j` chain; does a
release mid-transit stop further jumps?

**Setup.** Pilot `w11_route` (Kit Lancer, every system of the kit map
region explored) at Map Hub. The big map; ONE shift-click on Map Far (two
hops beyond East and Void, all explored); Clear Route; shift-click pins
East, Void, Far (a 3-hop route, "Selected System: Map Far"); close the
map, fly out 2 s, then `scenarios/jroute_{tap,hold,release}.json`:
tap `j` once / hold `j` about 25 s / hold it 2.5 s (the jump takes about 5.7 s
from the press to the arrival, "#344 wave 10"); a window shot every ~2 s
(status line and the nav panel), the map at the end.

| `j` | what happened |
|---|---|
| one tap | **one jump**: "Arriving in the Map East system on June 24th"; the nav panel then shows Hyperspace / Map Void (the rest of the route kept, drawn dim for the first seconds after the arrival), and **no further jump** in 20 s; the map at the end: current East, destination Void |
| held about 25 s | **the whole route**: Map East (June 24th), Map Void (June 25th, "No stellar objects present"), Map Far (June 26th), each jump starting as soon as the previous one arrived (about 6-7 s apart); then "Nav System Off" (route used up) |
| held 2.5 s, released mid-transit | **one jump** (Map East), none after, as for the tap |
| one shift-click on Map Far (explored path through East and Void) | **ignored**: no route, no selection |

**Finding.** A jump needs the key: each hop of a route starts only while
`j` is down at the moment the ship can jump. A tap or a release during
the transit completes that hop and stops with the rest of the route
kept; a held key chains hop after hop at once. Side finding (route
planning, wave 10's open question): a single shift-click on a system two
hops away is ignored even when every system on the way is explored, so
a shift-click only ever pins a neighbour of the route's end (wave 10
found the same with unexplored systems on the way). A plain click was
not tried.

**NovaJS (base 7c184cdf): matches as written.** `PlayerJumpControl`
(`N/nova_plugin/travel/jump_plugin.ts:518-570`) polls the held
`hyperjump` control every tick: a held key starts the next hop as soon
as the ship arrives (outside the no-jump zone), a tap starts one hop,
and the remaining route is kept (`:115-165`). The ModType 32 multi-jump
continuation (`MultiJumpContinueSystem`) is separate and outfit-only. So
the reported "released before the arrival but jumped again" is not in
this system; if it reproduces, look at the input layer (a `hyperjump`
control left true across the arrival / world swap) rather than here.

Confidence: high (three runs, the status lines and dates are
unambiguous).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w11/jroute/{tap,hold,release}/*/`
(`02-one-shift-far.png`, `03-route3.png`, the `w-NN` shots, `map-end`).

### AppearOn on mission ships whose düde has no admissible class, wave 11 (2026-11-23)

**Setup.** düde 335 lists only shïp 853 Kit Appear A and 854 Kit Appear B
(50 / 50); their AppearOn test the unset bits b9095 / b9096. mïsn 1045
puts one ship of düde 335 at Kit Port (ShipStart -1). Pilot `w11_appear`,
`scenarios/appear_excluded.json`: accept, take off, Tab, the mission
list.

**Result.** A ship spawned: Tab named **Kit Appear B** (an excluded
class), and the mission was active.

**Finding.** When the player's bits rule out every class of a mission
düde, the original still spawns one of them. That is exactly NovaJS's
fallback (`N/nova_plugin/missions/mission_ship_spawn.ts:263-275`
`appearingDudeShips` returns the whole list when nothing passes):
**matches; the comment's "unconfirmed" can be dropped.** Not settled by
this one run: whether the original applies AppearOn to mission draws at
all (a mixed düde, one admissible class and one not, would show it).

Confidence: high for "it spawns" (one run); the class choice is one draw.

**Evidence:** `~/.local/share/novaref/evidence/20261123-w11/appear/*/04-tab1.png`.

### A14 follow-ups wave 11: whose record a kill changes (2026-11-23, inconclusive)

**Questions (wave-11 seed).** (a) A crime against govt V's ship in a
system owned by a different govt O: whose record changes? (b) Killing an
ENEMY of the system's owner: does the record go up? (c) Does a kill
through "disabled" charge DisabPenalty + KillPenalty or KillPenalty only?

**Setup.** gövt 350 Kit Victim Govt (Disab 30, Board 5, Kill 100), 351
Kit Owner Govt (Disab 7, Board 3, Kill 13), 352 Kit Law Govt and 353 Kit
Pirate Govt (each lists the other's class as an enemy; class ids 352 /
353). The victim is a mission ship beside the player's port (AI 1 Kit
Trader, ShipStart -1, no goal), killed in one burst of the Kit Beam
Turret (5000); land, leave, pull the pilot (`pilot_summary.mjs`, which
now also lists the set mission bits). `scenarios/a14_owner.json`,
`a14_enemy.json`, `a14_home3.json`, `a14_warship.json`.

| kill | where | records afterwards | combat rating |
|---|---|---|---|
| V's (350) mission trader | 2061, owned by O (351) | **none changed** (2061, 2062 V's home, 2063 O's other: 0; map "No Record") | 0 -> 4 |
| 353's mission trader (an enemy of the owner) | 2064, owned by 352 | **none changed** | 0 -> 4 |
| V's mission trader | 2062, V's own system | **none changed** | 0 -> 4 |
| V's mission trader | 2070, V's own system with V's AI 3 traffic | **none changed** (pilot after the kill) | 0 -> 4 |
| two ships Tab picked first in 2070: a stock-art "Leviathan, 3rd Model" and "Viper, Fighter Class", both tagged "Trader" on the target panel (the Kit Raiders of gövt 350 were there too; the one targeted later survived at 73% shield) | 2070 | **2070: +130**, map "Legal Status: Good Citizen" | 0 -> 26 |

**What this shows, and what it does not.**
1. **A mission ship with no goal is no crime:** killing a goal-less
   mission trader changed no record anywhere, in its own govt's system
   or not (four runs, rating credited every time). Wave 5's -150 was a
   SYSTEM-spawned AI 3 warship. This also re-reads wave 10's
   negative-penalty run, whose victim was the same kind of mission
   trader: its "no change" may come from this rule rather than from the
   negative penalties (`#320 item 2 wave 10` should be re-run with system
   traffic).
2. So (a), (b) and (c) are **not answered** by these runs; they need
   system traffic as the victim (wave 5's design).
3. The +130 in the last run is unexplained: 130 is exactly gövt 350's
   Disab 30 + Kill 100 but POSITIVE, and the ships killed were not the
   kit's gövt 350 Kit Raiders; where the stock-art "Leviathan" and
   "Viper" in a sealed kit system came from (and their govt) is not
   known. Worth a closer look before anyone relies on it: it may be the
   enemy-kill credit (b) asks about.

**NovaJS (base 7c184cdf).** `N/nova_plugin/reputation/reputation_plugin.ts:205-230`
charges the kill penalty for ANY ship with a govt, mission ship or not
(and the victim govt's record, `reputation.ts:145-152`), and nothing for
enemies; `DisableCreditSystem` (`:236-290`) charges Kill only for a
one-burst kill. Against finding 1 that is a **mismatch** for goal-less
mission ships. **Proposed fix (not applied):** exempt mission special
ships without a destroy/disable goal from crime penalties, pending a
run that checks goal ships and ShipBehav 0 ones.

Confidence: high for 1 (four runs); none yet for (a)-(c).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w11/a14/{owner,enemy,victim,home3,warship}/*/`
(`pilot-*/`, the `map` shots).

### The UI screen x key matrix, wave 11: original vs NovaJS (2026-11-23)

**Question (wave 10 item 6).** From flight, the spaceport, each venue and
their dialogs, what do `m`, `i`, `h`, `e`, preferences and Escape do
(opens / ignored / closes)? Then the same in NovaJS, headless.

**Original: setup.** Pilot `w11_ui` / `w11_ui2` (no missions; `ui2`
has mïsn 1032's Mission BBS job) at Kit Port. `scenarios/ui_matrix_a.json`
(the spaceport row, every venue's shot, the flight row, `cmd+,` in
flight), `ui_matrix_b.json` (m / i / h / e inside each venue, each from a
fresh open, followed by its own undo and the venue's own Done / Leave).
Escape was not pressed in flight (the rule; wave 10: it quits to the
title) and is known in the spaceport (leaves) and in the venues (closes
them, K1). Run B's last rows were lost (below) and re-run as
`ui_matrix_c.json`.

| screen | `m` | `i` | `h` | `e` | `cmd+,` | Escape |
|---|---|---|---|---|---|---|
| flight, no missions / escorts | opens the map; `m` closes it | **status line "You have no active missions."** (no dialog; with a mission: the dialog, wave 10) | minimap peek | status line "You don't have any escorts." | nothing visible | quits to the title (wave 10, not re-run) |
| spaceport main | opens the star map over it; `m` closes it | **ignored** (no dialog, no message) | ignored | ignored | (lost, see below) | leaves (K1) |
| outfitter | **opens the star map over the outfitter**; `m` closes it, back to the outfitter | ignored | ignored | ignored | | closes (K1) |
| shipyard | **opens the map over it**, `m` closes | ignored | ignored | ignored | | closes |
| trade center | **opens the map over it**, `m` closes | ignored | ignored | ignored | | closes |
| bar | **opens the map over it**, `m` closes | ignored | **Hire Escort**: "There are no ships available for hire." (Okay) | (lost) | | closes |
| bar's no-hire popup | ignored | ignored | ignored | ignored | ignored | **closes the popup** (back to the bar) |
| Mission BBS (a job listed) | **opens the star map over the BBS**; `m` closes it, back to the BBS | ignored | ignored | ignored | | (Return closes it, wave 10) |
| star map opened while landed | closes it (run A) | ignored | ignored | ignored | | **closes the map**, back to the spaceport (does not leave) |
| spaceport main, `cmd+,` | | | | | nothing (no preferences dialog) | |

Run B lost its last rows: the bar's `h` opened the no-hire popup, whose
Okay the scripted Leave click missed, and the popup swallowed every key
until the final Escape closed it; `ui_matrix_c.json` re-ran the BBS row,
`cmd+,` in the spaceport and the landed map's row. Preferences: neither
`cmd+,` in flight nor in the spaceport opened anything; the original's
in-game preferences key, if any, is still unknown.

**NovaJS (headless, PORT 8537, base 7c184cdf; every cell from a reload,
with screenshots; no console errors).** Key bindings:
`packages/nova/settings/controls.json` (`map` KeyM :50, `smallMap` KeyH
:51, `escorts` KeyE :41, `missions` KeyI :85, `properties` KeyP :84,
`depart` Escape :75-78, `hire` KeyH :80, `fullscreen` Enter :86).

| screen | `m` | `i` | `h` | `e` | Escape | Return |
|---|---|---|---|---|---|---|
| flight | map, `m` closes | "Currently active missions" dialog, `i` closes | minimap peek (2.2 s) | escort panel (8.25 s); none: "You don't have any escorts." | quits to the title | browser fullscreen |
| spaceport main | star map, `m` closes | missions dialog, `i` closes | ignored | ignored | takes off | fullscreen (not Leave) |
| outfitter / shipyard / trade | **ignored** | ignored | ignored | ignored | closes | fullscreen |
| bar | ignored | ignored | Hire Escort dialog | ignored | closes | fullscreen |
| Mission BBS | star map, `m` closes | ignored | ignored | ignored | closes | fullscreen |

**Mismatches (original first).**
1. `m` in the outfitter, shipyard, trade center and bar: the original
   opens the star map over the venue; NovaJS ignores it
   (`N/spaceport/menu_controls.ts:46-63` sends keys only to the topmost
   menu, and only the spaceport and the BBS handle KeyM:
   `N/spaceport/spaceport.ts:392-397`, `N/spaceport/mission_board.ts:216`).
2. `i` in the spaceport: the original ignores it; NovaJS opens the
   missions dialog (`N/spaceport/spaceport.ts:402-403`). In flight with no
   mission the original prints "You have no active missions." instead of
   a dialog (NovaJS's flight path: `N/display/mission_info_plugin.ts:105-116`;
   whether it opens an empty dialog was not checked).
3. Return: the original presses Leave in the spaceport and closes the
   outfitter and the BBS (wave 10); NovaJS toggles browser fullscreen
   everywhere (`N/display/fullscreen_plugin.ts:16-18`).
Matches: flight `m` / `h` / `e` / Escape, spaceport `m` / `h` / `e` /
Escape, Escape closing every venue and the landed map, `m` over the BBS,
`i` / `h` / `e` ignored in the BBS and on the landed map, `h` as Hire in
the bar.
**Proposed fix (not applied):** let KeyM open the star map over any venue
(as over the BBS), drop KeyI in the spaceport, print "You have no active
missions." instead of an empty mission list, and map Return to the
default button (Leave / Done / Close) per screen rather than fullscreen
(a fullscreen key could move to a modifier combination).

Confidence: high for the cells shown (one shot each, unambiguous).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w11/ui/{a,b,c}/*/`; NovaJS:
`ui/novajs/` (279 shots `shots/<row>__<key>_*.png`, `results.jsonl`, the driver `matrix.mjs`).

### S1 / I1 wave 11: contraband scanning on arrival, and idle interceptors (2026-11-23, first pass)

**Brief.** docs/npc_behavior_gaps.md S1 (runs 1 and 2 only) and I1.

**Rig.** gövt 354 Kit Customs (ScanMask 0x0001, ScanFine 500,
SmugPenalty 50, CrimeTol 10) owns sÿst 2069 Kit Scan Range (Kit Scan
Port at 0,0; traffic: düde 336, two AI 4 Kit Customs Cutters, red discs
with one Kit Escort Gun). sÿst 2068 Kit Scan Gate is its only link.
oütf 458 Kit Contraband Pod: ScanMask 0x0001, mass 0. Pilots
`w11_scan_clean` (Kit Lancer, nothing illegal) and `w11_scan_pod` (one
pod): the map, Tab to Kit Scan Range, fly out 3.5 s, hold `j` 1.5 s,
brake on arrival, then a window shot every ~2.8 s for about 2.8 min.
`scenarios/scan_watch.json` (take 1 never left the gate: 1.5 s of
thrust stayed inside the no-jump zone).

| pilot | what happened |
|---|---|
| clean | **no scan, no message**, never approached: one cutter was on screen about 300 px off at the first shot and then neither came on screen again; the shield bar stayed full throughout |
| pod | within about 3 s of the arrival a cutter beside the player: **"Kit Customs Cutter: w11-scan-pod, your posession [sic] of a kit contraband pod has been detected. You have been fined 500 credits."**, credits 1,000,000 -> 999,500, ONE fine only; from then on both cutters stayed within 100-250 px and **kept firing** at the player (the shield bar fell steadily, 149 -> 134 px over 2.7 min, against the Lancer's recharge) |

Neither run's closing landing happened (the player sat about 1000 px
from the port), so the pilot was not written and the 2069 record (the
SmugPenalty) was not read; the cutters turning hostile after the fine
fits a SmugPenalty of 50 against CrimeTol 10.

**Findings so far.**
1. A ScanMask-matching outfit is scanned on arrival in a system of the
   scanning govt, quickly (seconds), by an AI 4 ship that comes to the
   player; the message names the item ("your possession of a <item> has
   been detected") and the fine is charged once.
2. After the scan the interceptors attack (a criminal player in their
   system), so detection is a crime (SmugPenalty) for outfits, not only
   for mission cargo as the Bible's SmugPenalty text says. To confirm
   with the record read back.
3. A clean ship is not scanned, or at least not approached and not
   messaged, within 2.7 min (I1: the idle cutters stayed away from the
   player; where they park was not tracked).

**NovaJS (base 7c184cdf):** scanning is missing
(`N/nova_plugin/npc/npc_ai_plugin.ts:49-56`), SmugPenalty is not wired
(`N/nova_plugin/reputation/reputation.ts:21`); see
docs/npc_behavior_gaps.md "Law and policing". No fix proposed here
beyond the brief's.

**Left of S1-S3 / I1:** the record read-back (land from close by), a
jünk and a mission-cargo case, ScanFine 0, rescans over 5 minutes, a
criminal pilot, the pod pilot fleeing, a radar track of idle cutters
(300 s), and S2 / S3 (0x0020 missions).

Confidence: high for the pod run's message, fine and the attack (one
run); medium for "a clean ship is not scanned" (one run, 2.7 min).

**Evidence:** `~/.local/share/novaref/evidence/20261123-w11/scan/{clean,pod}/*/`
(the first run in each folder is take 1; the pod run `20261123-232524-*`: `04-w-00.png` .. `07-w-03.png` the
message, `recording.mp4`).

### The "Fight to be Thurokiir" duel, wave 12: disabled duellists, stray fire, and who fails the mission (2026-11-24)

**Question (Matthew, playing stock mïsn 674 "Fight to be Thurokiir":
5 Duellists of gövt 175, ShipGoal 1 "disable but don't destroy", ShipBehav
0).** (i) Does an NPC's bolt aimed at the player stop on a DISABLED ship
of its own govt? (ii) Does an NPC's kill of a duellist (stray bolt or
blast) fail the mission, disabled or not? (iii) Does the player killing a
duellist he already disabled fail it? (NovaJS: (i) yes, (ii) only if the
victim was not disabled yet, (iii) no.)

**Rig (`kits/testkit.mjs` wave 12, "D").** Kit FF Range (wave 10's
friendly-fire geometry): the player (Kit Ring Tank, 30000 / 30000, wëap
282 Kit Duel Gun: a 100-damage turret) at Kit FF Port; an anchored
duellist shooter of gövt 355 Kit Duellist (stock 175's 0x0002, CrimeTol
0, no penalties; ShipBehav 0, no goal) 260 px north, the spaceport offer;
the duellist under test 110 px north on its line of fire, a Mission BBS
job (mïsn 1052: shïp 856, the magenta pointer, shield 200 / armor 1500,
anchored, ShipGoal 1, ShipBehav 0, OnSuccess b9101, OnFailure b9102).
`scenarios/duel.json`: click the duellist, tap the gun until the panel
reads Disabled (`loops/disable.mjs`), watch 52 s, then fire until it is
gone, `i`, land, leave, pull. Shooters: Kit FF Shooter (10-damage bolt,
pilot `w12_duel_bolt`), Kit Duel Shooter Blast (100 damage, 150 px blast,
`w12_duel_blast`); `scenarios/duel_beam.json` with Kit Duel Shooter Beam
(ONE frame of 5000 damage, turreted; a beam stops on its own govt, wave 10)
and a shield-0 duellist (mïsn 1053, shïp 865), `w12_duel_big`.

| run | what killed the duellist | when | status line | pilot after |
|---|---|---|---|---|
| bolt | nothing for 52 s while DISABLED under the shooter's 10-damage bolts (about 1.5 a second, aimed at the player; 500 armor left would have gone in about 33 s); then the PLAYER's gun | after the player's burst | **"Mission failed."** at the kill | b9102 (OnFailure), the job gone from the `i` list; combat rating 0 -> 10 |
| blast | the shooter's 150 px BLAST aimed at the player, 110 px away | about 6 s after it went Disabled (the player had stopped firing) | **"Mission failed."** | b9102; combat rating 0 (no credit to the player) |
| beam | the shooter's one-frame beam, which stopped on the HEALTHY duellist and destroyed it in that frame (never disabled) | about 1.5 s after takeoff | **"Mission failed."** | b9102; combat rating 0 |

Bolt pass-through, frame-counted (`recording.mp4` frames 1510-3050, the
52 s while the duellist sat Disabled): orange bolt pixels on the line of
fire ABOVE the duellist in 724 frames and BELOW it (between it and the
player) in 417, about the same per pixel of strip (the bolts are slower
to cross the shorter lower strip): every bolt went through; the hulk
lived until the player's own burst.

**Finding.**
1. **(i) No: a same-govt bolt passes through a DISABLED ship of its own
   govt** just as through a live one (wave 10's same-govt immunity
   outlasts the disable). Beams and blasts hit it, disabled or not.
2. **(ii) Yes, both: any destruction of a ShipGoal-1 ship fails the
   mission**, by an NPC's blast after the disable or by an NPC's beam
   before it. Nobody's disable credit survives the kill.
3. **(iii) Yes: the player killing a duellist he had already disabled
   fails the mission** ("Mission failed." at the kill).
4. Brackets: the ShipBehav-0 duellist showed RED corners until disabled,
   grey after (matches K9 / K10).

**NovaJS today (base 621a94cf): three mismatches.**
- (i) `N/nova_plugin/ship/firing_group.ts:181-184` `firingImmune`: a
  `victimDisabled` victim loses all immunity (passed from
  `N/nova_plugin/combat/projectile_plugin.ts:453` `disabledCancelsImmunity`),
  so the duellists' own bolts stop on a disabled duellist and finish it
  off. The original keeps the same-govt projectile immunity.
- (ii) and (iii) `N/nova_plugin/player/mission_ship_state.ts:212-216`
  (`shipDied`, GOAL_DISABLE) fails the goal only when the ship dies
  before it was disabled; `shipDisabled` (`:248-254`) has already counted
  it as satisfied, whoever disabled it. The original fails the mission on
  ANY destruction of a goal-1 ship, disabled or not, whoever destroys it.

**Proposed fix.** In `firingImmune`, let the disabled
carve-out cancel only the FLOCK (group) immunity and keep the same-govt
projectile clause (`SAME_GOVT_FIRING_IMMUNITY.projectile`) for a disabled
victim; in `shipDied`, fail GOAL_DISABLE on every death (and un-count
the satisfied disable), not only before the disable. Not measured: what
happens to the mission when an NPC disables the ship and nobody kills it
(the blast run's duellist was disabled by the player's gun and the blast
together).

**Applied in 13586627** ((i): the disabled carve-out cancels only the
group immunity; the player's flock carries no govt, so the player still
finishes off his own disabled escort) **and 0dc9f2d4** ((ii) and (iii):
`shipDied` fails GOAL_DISABLE on every death and un-counts the disable;
`missions/duel_disable_goal_integration_test.ts` pins the blast after the
disable, the undisabled splash and the player's own kill).

Confidence: high (three runs, each with the status line, the OnFailure
bit and, for (i), 52 s of frame-counted bolts).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w12/duel/{bolt,blast,beam}/*/`
(the blast folder's first run is a failed take: a stock BBS job took the
Accept; the kit's BBS jobs now carry DispWeight 30000 and the scenario
clicks the first row).

### IFF of an NPC fighting another NPC, wave 12 (2026-11-24)

**Question (Matthew).** NovaJS showed the hostile orange-red bracket on a
ship attacking another NPC (which then killed it and ignored him). On the
original, what bracket does a ship get while it attacks a third party,
and does it then turn on the player?

**Rig.** gövt 356 Kit Hunter and 357 Kit Prey, each listing the other's
class as an enemy, both neutral to the player (record 0), AI 3, Kit Raider
Guns. Take 1 (`scenarios/hunt_watch.json`, sÿst 2071 Kit Hunt Range,
system traffic): the pairs fought 600-1400 px away, off screen, so no
bracket was readable. Take 2 (`hunt_arena.json`, sÿst 2077: one of each
as mission ships on the port, own AI): readable for the first seconds,
then they flew off. Take 3 (`hunt_anchored.json`, pilot `w12_arena2`):
ANCHORED copies in Kit FF Range, the hunter (yellow disc, mïsn 1060) on
the far mark and the prey (cyan, mïsn 1061) on the near mark, 150 px
apart, trading turret fire above the player (Kit Ring Tank + Kit
Tickler). Tab through them (shots, `analysis/brackets.mjs`), then target
the prey (`loops/tab_to.mjs`) and tickle it for 6 s (frame-counted: the
Tickler's bolts cross the strip between the player and the prey in 36 of
171 frames during the hold and in none before or after), Tab again, and
watch the player's shield for 16 s.

| case | hunter's corners | prey's corners | turned on the player? |
|---|---|---|---|
| each attacking the other (takes 2 and 3; shields 97 -> 82% and 99 -> 93%) | **yellow** (neutral) | **yellow** | no |
| the player tickles the prey too (6 s of 1-damage hits) | **yellow** | **yellow**, and it kept firing at the hunter | no: the player's shield bar stayed at 149 px throughout (takes 2 and 3) |

**Finding.** A neutral ship's corners stay YELLOW while it attacks
another NPC, and stay yellow while the player attacks the same victim;
an AI 3 warship busy with its enemy did not even turn on the player
when the player shot it (6 s, 1-damage hits; wave 11 saw an idle AI 1
target turn red at the first hit). Red corners are for ships attacking
the player or that will on sight (K9). Not tested: a same-govt victim (a
ship never attacks its own govt except through gövt 0x0001, which also
attacks the player) and longer or heavier provocation.

**NovaJS today.** `N/nova_plugin/combat/hostility.ts:221-233`
`onSightDisposition` and the behavioural tier (`:102-118`, red only for
a ship attacking the PLAYER) give the same yellow for a ship fighting an
NPC: matches. What Matthew saw fits the duel instead: duellists are
ShipBehav 0 (always attack the player), red on the original too (see the
duel above). Not run headless: whether NovaJS's prey turns on a player
who tickles it mid-fight (`N/nova_plugin/npc/npc_targeting.ts:217-228`
records an aimed hit's shooter as the `aggressor`); the original's did
not.

**Evidence:** `~/.local/share/novaref/evidence/20261124-w12/{hunt,hunt_arena,hunt_anchored}/*/`.

### A14 with system traffic as the victims, wave 12: whose record a kill changes, enemies, negative penalties (2026-11-24)

**Question (wave-11 leftovers).** (a) A crime against govt V's ship in a
system owned by a different govt O; (b) killing an ENEMY of the owner;
(c) a kill through "disabled" (Disab + Kill?); and wave 10's negative
penalties, all with SYSTEM traffic as the victim (wave 11 found that a
goal-less mission ship is no crime).

**Rig.** shïp 861 Kit Bare Trader (AI 1, shield 0, armor 1000) as the only
traffic of each system; the player (Kit Lancer, record 0 everywhere) at
the system's port with wëap 283 Kit One Shot (one 10000-damage bolt: the
trader dies in ONE hit) or wëap 284 Kit Gun 300 (300 damage a hit). Tab,
fire, land, map, leave, pull (`scenarios/a14_traffic.json`,
`a14_disable_kill.json`). Penalties (Disab / Board / Kill): gövt 350 Kit
Victim 30 / 5 / 100, 351 Kit Owner 7 / 3 / 13, 352 Kit Law 30 / 5 / 100
and 353 Kit Pirate 20 / 5 / 40 (each the other's enemy), 340 Kit Ally
Owner 30 / 5 / 100 listing 341 Kit Ally Victim (20 / 5 / 40) as an ally,
369 Kit Negative -100 / -100 / -100.

| system (owner) | victim's govt | kill | record afterwards (only that system changed) | rating |
|---|---|---|---|---|
| 2074 Kit Victim Traffic (350) | 350, the owner | one hit | **-130** = -(Disab 30 + Kill 100) | +4 |
| 2074 (350) | 350 | Kit Gun 300: 40% armor, then gone between two frames (off screen, the panel never read Disabled) | **-130** | +4 |
| 2080 Kit Victim Anchored (350) | 350, an IMMOBILE trader (shïp 870) | Kit Duel Gun until the panel read **Disabled** (7 hits), 8 s, then fired until it was gone | **-130** (not -160: the Disab is charged once) | +4 |
| 2078 Kit Ally Traffic (340) | 341, the owner's ally | one hit | **-60** = -(the VICTIM's Disab 20 + Kill 40) | +4 |
| 2072 Kit Owner Traffic (351) | 350, no relation to the owner | one hit | **+9** = +(the OWNER's Disab 7 / 2 + Kill 13 / 2, each truncated: 3 + 6) | +4 |
| 2073 Kit Law Traffic (352) | 353, the owner's enemy | one hit | **+65** = +(the owner's 30 / 2 + 100 / 2) | +4 |
| 2075 Kit Negative Traffic (369, penalties -100) | 369, the owner | one hit | **+200** = -(-100 + -100) | +4 |

(Kit Gun 300 take 1, wëap 282 at 100 damage: the trader fled out of reach
at 70% armor and no record changed; take 2 is the row above.)

**Finding.**
1. **A kill of the owner's own (or an allied) ship costs the VICTIM
   govt's DisabPenalty + KillPenalty** in the system's record, also when
   one hit destroys it without a visible disable (-130, -60). BoardPenalty
   is not part of it.
2. **(a) and (b): a kill of a ship whose govt is neither the system's
   owner nor its ally RAISES the system's record by half the OWNER's
   Disab + Kill** (each halved and truncated): +9 for an unrelated victim
   in Kit Owner Traffic, +65 for the owner's enemy in Kit Law Traffic. The
   victim's own penalties play no part, and enmity is not needed. This
   also explains wave 11's unexplained +130 in Kit Victim Home 3 (owner
   350): two kills of non-350 ships at +65 each.
3. **Negative penalties ARE applied, signed:** a kill of a -100 / -100
   govt's own ship raised the record by 200. Wave 10's "no change" came
   from the mission-ship exemption (wave 11), not from the sign.
4. **(c): a kill through a visible disable costs Disab + Kill once**
   (-130 after 8 s of the hulk sitting Disabled), the same as a one-hit
   kill: so "Disab + Kill on every kill", never the Disab twice. A
   disable alone was not read (two takes: no traffic in the system, then
   the trader out of the gun's reach).

**NovaJS today (base 621a94cf; per-govt records, ruling #376): four
mismatches.**
- `N/nova_plugin/reputation/reputation_plugin.ts:191-236`
  (`KillCreditSystem`) charges KillPenalty only, and
  `DisableCreditSystem` (`:251-290`) skips a ship already at armor 0
  (`:264`), so a one-hit kill costs 100 where the original takes 130 (a
  kill after a seen disable costs Disab, then Kill: -130, matches).
- `N/nova_plugin/reputation/reputation.ts:145-152` (`applyCrime`) charges
  the victim's govt for every kill and never credits anyone, so killing
  a ship of a govt that is neither the local owner nor its ally costs
  that govt standing instead of RAISING the local owner's.
- `reputation.ts:127-139` (`crimePenalty`) returns 0 for a negative
  field (#108); the original applies it signed (the crime raises the
  record).

**Proposed fix (the reward rule needs Matthew's ruling on
how it maps onto per-govt records).** Charge DisabPenalty + KillPenalty
for every kill (one entry, whether or not the disable was seen); when the
victim's govt is neither the system's owner nor an ally of it, instead
credit the owner's record with floor(Disab / 2) + floor(Kill / 2) of the
OWNER's penalties; apply negative penalties signed (revisit #108's
"negative = does not care" reading).

**Applied in e710b4e3** (findings 1, 3 and 4): `KillCreditSystem` charges
Disab + Kill, the Disab only once when the same root was charged it for
the disable (`DamageAttribution.disableChargedTo`); a kill of a ship
someone else disabled charges the killer both (unmeasured). `crimePenalty`
applies a negative field signed (the derelict Wraith nova:159, -1
everywhere, now raises its record by 2 per kill). **Not applied:**
finding 2's reward; `applyCrime` carries a TODO pointing here, and every
kill still charges the victim's govt.

Confidence: high for 1-4 (seven clean runs, each a single kill, read from
the pulled pilot); the halving rule rests on two owners' penalty sets
plus wave 11's +130.

**Evidence:** `~/.local/share/novaref/evidence/20261124-w12/a14/{victim_one,victim_dis,victim_dis2,dis3_kill,dis3_only,ally,owner,enemy,negpen}/*/`
(`pilot-after/`, `05-map.png`).

### A trader shot by the player's escort: whom does it fight? wave 12 (2026-11-24)

**Rig.** sÿst 2076 Kit Brave Range: one AI 2 Kit Brave Trader (green disc,
gövt 363 neutral, 3000 / 3000, two Kit Raider Guns). The player (Kit Ring
Tank, unarmed, 30000 shield) with one hired Kit Escort (two Kit Escort
Guns). Target the trader (`loops/tab_to.mjs` green), `f` (escorts attack
my target), then 40 s of shots (`scenarios/brave_escort.json`, pilot
`w12_brave`).

**Result.** "New escort orders assigned. All ships attacking target.";
the trader's corners turned from **yellow to RED** within a second of the
order (before it was hit much); its shield fell 94 -> 67 -> 33 -> 1% ->
"Shields Down" over 40 s as the escort chased it out of the screen; the
**player's shield bar never moved** (149 / 148 px of 161 at every shot):
the trader never fired at the player, though it sat beside the player
when the fight began.

**Finding.** A trader shot by the player's escort fights (or flees) the
ESCORT, not the player, even while its brackets read hostile.

**NovaJS today.** `N/nova_plugin/npc/npc_targeting.ts:55-60`
(`responsibleShip`): a hired escort's hits make the PLAYER (its
firing-group root) the victim's aggressor, so a provoked trader goes
after the player. **Mismatch. Proposed fix:** record the
concrete firing ship (the escort) as the aggressor for an NPC's reaction,
and keep the root for kill credit and legal records (where the original
charges the player: not measured here). The red corners match NovaJS's
"recent aggression against the player" tier only if hits by the
player's flock count as the player's; the original paints it red anyway.

**Applied in 5fcf49fe.** `responsibleShip` records the ship that fired
when the firing-group root is on a player's side (an escort's missile
lock too, `provokeGuidedLock`); NPC flocks keep their root. A bay
fighter of the player's side answers for its carrier (the player's own
fighters for the player, an escort carrier's for that escort):
unmeasured, chosen because a fighter is a weapon its carrier fires and
to keep one aggressor per carrier. The brackets stay red through a new
tier 3c (`hostility.ts` `isFightingPlayerFlock`: in attack mode on a
flock member that is its recorded aggressor), which the escort brains'
`isHostileTo` reads too; a bribe clears an aggressor in the briber's
flock. Kill credit, legal records and the player-side aggression record
keep the root.

Confidence: medium (one run; who the trader shot is inferred from the
player's untouched shield, the fight left the screen).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w12/brave/*/`
(`07-ordered.png`, `brackets.mjs` on it: red; `recording.mp4`).

### Submunition fuse vs an elongated target, wave 12 (2026-11-24)

**Question.** NovaJS sizes the target by its sprite mask's farthest point
(`PROX_FUSE_TARGET_RADIUS_FACTOR_FITTED`: fuse at ProxRadius + 2/3 of
that radius), so on a long hull the fuse fires far out. How does the
original's fuse treat a long target from the side and from the end?

**Rig.** Kit Sub Range as in "Submunitions wave 10": the slow parents
268-273 (Speed 200, 2-3 px a frame, prox 0 / 8 / 12 / 16 / 20 / 30, the
16 px sprite) fired one at a time at an immobile 76 x 14 magenta bar
150 px north, the same on every frame of its 80 x 80 sheet: lying across
the line of fire (shïp 863, pilot `w12_sub_side`) or upright, end-on
(shïp 864, `w12_sub_end`). `scenarios/sub_bar.json`; the shot's last
position and the starburst read per frame from the recording (`subtrack.py` in the
evidence folder, distances from the bar's centre along the line of fire).

| prox | side-on (face 7 px from the centre) | end-on (face 38 px from the centre) | NovaJS model (radius 38.6: fuse at prox + 25.7) |
|---|---|---|---|
| 0 | hit the body (gone by 17-20 px), no subs | hit (45.5 px), no subs | hit |
| 8 | **subs at 32.5 px** | hit (47), no subs | 33.7: side subs, end hit |
| 12 | subs at 33.5 | hit (45.5), no subs | 37.7: side subs, end hit |
| 16 | subs at 36.5 | hit (46), no subs | 41.7: side subs, end hit |
| 20 | subs at 38 | **subs at 47** (a near tie with the body) | 45.7: side subs, end tie |
| 30 | subs at 42 | subs at 55.5 | 55.7 |

**Finding.**
1. The fuse is not a circle around the centre: end-on the bar's tip is
   38 px out and the fuse reached past it only from prox 20 (fired at
   about prox + 25 px from the centre); side-on the fuse fired from prox 8
   at 32-42 px from the centre, growing only about 0.45 px per px of prox.
2. Every one of the twelve yes/no outcomes (subs or a body hit) matches
   NovaJS's model; the DISTANCES match end-on and side-on for small prox,
   but side-on the original's fuse fires 4-14 px closer than NovaJS's for
   prox 12-30 (33.5-42 vs 37.7-55.7).

**NovaJS (base 621a94cf).** `N/nova_plugin/combat/projectile_plugin.ts:619-624`:
the outcomes match; the side-on distances for larger fuses do not
(cosmetic: where the starburst appears). No fix proposed; a fit would need
more shapes than one bar.

Confidence: medium-high (one shot per cell, ±3 px).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w12/sub/{side,end}/*/recording.mp4`
(triggers at the `down ctrl` stamps in `recording.events.json`).

### Scrolling: long mission text and the shop scroll arrows, wave 12 (2026-11-24)

**Question (Matthew).** How do scrolling dialogs scroll on the original:
single arrow / Page key presses, held keys, single and held clicks on the
scroll arrows, the track, the mouse wheel; and does a shipyard /
outfitter arrow click move one row or a page?

**Rig.** Pilot `w12_scroll` at Kit Port: mïsn 1057 offers a 60-line
numbered text on landing (12 px a line; 22 lines show); mïsn 1058 is a
Mission BBS job with the same text; the kit fills the outfitter and the
shipyard (4 x 5 cells of 54 px rows). `scenarios/scroll_explore.json`
(keys, shots), `scroll_measure.json` (recorded: clicks, 3 s holds on the
arrows with novaref's new `click --hold-ms`, Down held 3 s, Page keys),
`scroll_wheel.json` (novaref's new `wheel`). Offsets frame by frame from
the recording (`scrolltrack.py` in the evidence folder: the row profile's
shift between frames) and from shots (`bands.py`).

**Original.**

| widget | input | effect |
|---|---|---|
| mission offer text (arrows right of No / Yes; no track, no thumb) | one click on an arrow (60 ms down) | **5 px** (2-3 frames of the glide below), no jump |
| | arrow HELD 3 s | starts 3 frames after the press, **2 px every video frame (about 60 px/s), steady, no delay, no acceleration**, stops at the release (181 px in 90 frames) |
| | Down / Up key | **10 px** a press |
| | Down HELD 3 s | **10 px once: no key repeat** |
| | PageDown / PageUp | **250 px** (about 21 lines); clamped at the end |
| | Home / End | top / bottom |
| | mouse wheel (1 and 3 notches, line units) | nothing |
| outfitter grid (arrows at its bottom-left) | one click | **one ROW (54 px), on the RELEASE** |
| | held 3 s | still one row, at the release: **no auto-repeat** |
| | wheel, PageDown, End | nothing (Down moves the selection) |
| shipyard grid | one click / held 3 s | one row on the release / one row on the release |
| Mission BBS job text | Down, PageDown | nothing: the text is clipped at 8 lines, with no arrows (it never scrolls) |
| arrows at either end | | drawn dark (disabled): the up arrow at the top, the down arrow at the bottom |

**NovaJS (headless, PORT 8557, run on 2b744c80 and again on 621a94cf with the same numbers but for the grid wheel, new pilot landed at nova:164;
`showOfferPopup` with the same 60 lines; no console errors).**

| widget | input | NovaJS | original |
|---|---|---|---|
| offer text | one click | **12 px jump** (one line) on the press | 5 px (glide only) |
| | held | 12 px jump, then **after 300 ms** a glide at 60 px/s (Line 16 after 3 s) | no jump, no delay, 60 px/s from the press |
| | Down / Up | 12 px | 10 px |
| | Down held (OS key repeat) | **repeats** (12 px per repeat) | no repeat |
| | PageDown / PageUp / Home / End | **nothing** | 250 px / 250 px / top / bottom |
| | wheel | nothing | nothing (matches) |
| outfitter / shipyard grid | one click | **a PAGE (5 rows)** on the release | one ROW on the release |
| | held | one page on the release | one row on the release (no repeat: matches in kind) |
| | wheel / PageDown / End | nothing on 2b744c80; since 621a94cf (d28c4b29) the wheel moves the grid by rows: a deliberate NovaJS Enhancement ("Scroll wheel in shops", `docs/novajs_enhancements.md`), which this run confirms the original lacks | nothing |

Code: `N/spaceport/item_grid.ts:571-585` (`scrollUp` / `scrollDown` move
`BOX_COUNT[1]` rows), `N/spaceport/offer_popup.ts:324-357`
(`bindScrollButton`: a `POPUP_SCROLL_STEP` jump on press, then the hold),
`N/spaceport/popup_layout.ts:94-98` (`POPUP_SCROLL_STEP` = a line,
`POPUP_SCROLL_HOLD_DELAY` 300 ms, `POPUP_SCROLL_HOLD_SPEED` 60 px/s),
`N/spaceport/menu_controls.ts:22` (`REPEATABLE` up / down: OS key repeat).

**Proposed fix (not applied).** Grid arrows: one row per click
(`scrollUp` / `scrollDown` by 1, still on the release, no hold). Offer
text arrows: no jump and no delay, a 60 px/s glide from the press to the
release; arrow keys 10 px a press without repeat (drop up / down from
`repeatableActions` on the popup); add PageUp / PageDown (250 px) and
Home / End. (The BBS text not scrolling at all is not checked in NovaJS.)

**Applied in 777ff782 (the text), 760fc81d (the grids) and 39f5805d (the
BBS).** Offer / briefing text: the arrows glide at 60 px/s from the press
(timed by the clock, so a slow frame catches up), a quick click moves 5 px
in all, Up / Down move 10 px without repeat, PageUp / PageDown 250 px,
Home / End the ends (read off the DOM: the control set has no page
actions). The wheel scrolls text only under a new NovaJS Enhancement,
"Scroll wheel in mission text" (`enhTextScrollWheel`, default ON, three
lines a notch; off = the original's nothing). Grids: one row a click, on
the release, no repeat. BBS: NovaJS never scrolled the job text; its pane
clips after seven lines and the top of an eighth, as the original's.
Headless check (PORT 8563, the same 60-line popup): click 5, held about 5
s 300 (60 px/s), Down 10 / 20, Down + 10 OS repeats 10, PageDown 250 /
468 (end), PageUp 218, End 468, Home 0, wheel 36 a notch (0 with the
toggle off); outfitter and shipyard one row a click, held 3 s: nothing
until the release, then one row; the BBS at Schmoo: Down / PageDown /
End / wheel leave the text where it is. No console errors.

Confidence: high for the step sizes and the release timing (frame
counts); the 60 px/s glide is 2 px per 30 fps video frame, so the game's
own rate is 1 px per rendered frame or 2 px per physics tick. The wheel
result rests on synthetic line-unit wheel events (the harness cannot show
that a real mouse's events differ).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w12/scroll/{explore,measure,wheel}/*/`
(`measure`: the input stamps in `recording.events.json`); NovaJS:
`scroll/novajs/` (`scroll.log`, `base621/scroll.log`, `shots/`, the driver `scroll.mjs`).

### Trade center at Schmoo, and the trade-in's outfits, wave 12 (2026-11-24)

**Schmoo (stock spöb 322).** Stock data, no plug-in, record 0; land and
open the exchange (`scenarios/trade_schmoo.json`; take 3,
`trade_schmoo_ok2.json`, closes a random stock notice first). Schmoo is in
the BoughtAt list of jünk 145 Seafood Delicacies, 146 Opals and 149
Durknen Girns (BuyOn `b43`, SellOn empty); none of them is SoldAt there.

| pilot | rows shown | NovaJS model (9b0c62de) |
|---|---|---|
| `w12_schmoo` (bit 43 clear) | Food (Med 75), Medical Supplies (Med 750), Luxury Goods (High 1125), blank slots for the other three standard goods, then **Opals (High 1500) only** | Durknen Girns + Opals |
| `w12_schmoo43` (bit 43 set) | the same goods, then **Durknen Girns (High 3750) only**: Opals is gone | Durknen Girns + Opals |

**Finding.**
1. **The exchange has ONE High (sell-here, BoughtAt) jünk row and ONE
   Low (buy-here, SoldAt) jünk row**, each taken by the highest-id jünk
   that qualifies. This fits every table so far: Kit Port wave 1
   (Widgets Low + Gadgets High), Kit Port wave 10 (Doodads High + Low;
   Widgets 200 and Gadgets 201 lose their slots to Doodads 202), Kit
   Market (Widgets High + Gadgets Low) and both Schmoo takes (three
   BoughtAt jünks, one row).
2. **A jünk's BuyOn gates its row at a stellar in its BoughtAt list**
   (the stellar buys it): Durknen Girns (BuyOn b43) qualifies only with
   b43 set, and then pushes Opals out. (SellOn presumably gates the SoldAt
   row; not tested.)

**NovaJS (base 621a94cf): two mismatches.**
`N/nova_plugin/economy/trade_logic.ts:185` `junkExchangeRows` keeps the
two highest-id jünk rows of either tier (Schmoo: two High rows), and
`:131` / `:141` gate a BoughtAt row with `sellOn` and a SoldAt row with
`buyOn`. **Proposed fix (not applied):** one High slot (BoughtAt rows that
pass `buyOn`) and one Low slot (SoldAt rows that pass `sellOn`), each the
highest jünk id that qualifies, High listed above Low.
**Applied in e5f64f8d** (supersedes 9b0c62de's two-slot model). Headless
check at Schmoo (bit 43 clear): Food Med 75, Medical Supplies Med 750,
Luxury Goods High 1125, three blank slots, Opals High 1500, nothing else.

**Trade-in (wave 11's 27,500 vs NovaJS's 26,250).** Pilots on Kit Mass
Roomy 100 (100,000), each buying Kit Mass Roomy 300 at Kit Port
(`scenarios/tradein_food.json`, the confirm dialog's Trade-In):

| aboard | Trade-In |
|---|---|
| 50 t of food, no outfits (`w12_tradein_food`) | **25,000** (cargo does not count) |
| 5 Kit Plain Mass (Cost 1,000 each), empty hold (`w12_tradein_plain`) | **27,500** |
| 2 Kit Mass Keep (persistent 0x0404, Cost 1,000), empty hold (`w12_tradein_keep`) | **25,000** (persistent outfits stay with the pilot and do not count) |

**Finding.** Trade-in = 25% of the hull's price + **50%** of the
non-persistent outfits' price (25,000 + 2,500): the outfits at their
resale value, the hull at a quarter. Wave 11's 27,500 is the same sum.
**NovaJS (`N/spaceport/shipyard_rules.ts:216-228` `tradeInValue`):
25% of hull + outfits = 26,250. Mismatch. Proposed fix (not applied):**
`floor(0.25 x hull + 0.5 x outfits)` (the rounding of each part not
measured).
**Applied in 9b5f6047** (the sum floored once; Player Info's "Ship
trade-in value" line uses the same fractions). Headless check: a new pilot
in the Shuttle (10,000) with its Light Blaster (5,000) is quoted a 5,000
Trade-In on the Viper (2,500 + 2,500).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w12/trade/{schmoo,schmoo43*,tradein,tradein_plain,tradein_keep}/*/`.

### S1 and S2 wave 12: scanned without a jump, the record after a scan, illegal mission cargo (2026-11-24)

**S1 run 3 + the record.** Pilot `w12_scan_inside` (Kit Lancer + one Kit
Contraband Pod, ScanMask 0x0001) STARTS beside Kit Scan Port in Kit Scan
Range (no jump): "Kit Customs Cutter: w12-scan-inside, your posession of
a kit contraband pod has been detected. You have been fined 500
credits." on the status line in the first 1.5 s after Enter Ship; after
landing and leaving, credits 1,000,000 -> 999,500 and **the 2069 record
-50** (gövt 354's SmugPenalty 50). So a scan does not need an arrival by
jump, and a detected illegal OUTFIT costs ScanFine and SmugPenalty
(wave 11's inference confirmed). `scenarios/scan_inside.json`.

**S2: illegal MISSION cargo.** Pilots `w12_s2a` / `w12_s2b` (Kit Lancer,
nothing illegal aboard) land at Kit Scan Port and accept 1 t of food with
ScanMask 0x0001 for Kit Scan Gate Port (mïsn 1062 with Flags 0x0020,
1063 without; CompGovt 354, CompReward 10), take off and wait 24 s
(`scenarios/s2_scan.json`), then land and leave.

| mission | status line (within about 4 s of takeoff) | credits | mission | records |
|---|---|---|---|---|
| 0x0020 | **"Your ship has been scanned - mission failed."** | unchanged (no fine) | failed: OnFailure b9114 set, gone from the list | none changed |
| plain | **"Kit Customs Cutter: w12-s2b, your attempt to smuggle illegal cargo through this system has been detected. You have been fined 500 credits."** | -500 | still active | **none changed** (no SmugPenalty) |

**Finding (S1 + S2).** A scan finds what the govt's ScanMask matches, in
outfits and mission cargo alike, as soon as an interceptor reaches the
player (no jump needed). An illegal OUTFIT: "your possession of a <item>"
+ ScanFine + SmugPenalty on the system's record. Illegal mission cargo of
a 0x0020 mission: the mission fails at once ("Your ship has been scanned
- mission failed.") and nothing else happens (no fine, no record).
Illegal mission cargo of an ordinary mission: "your attempt to smuggle
illegal cargo" + ScanFine, the mission continues, and **no SmugPenalty**
(the Bible's SmugPenalty text speaks of mission cargo; the record moved
only for the outfit). Not tested: ScanFine 0, rescans, S3 (a scanner
whose ScanMask does not match the cargo).

**NovaJS:** scanning is not implemented (wave 11's entry).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w12/scan/{inside,s2a,s2b}/*/`.

### P1 run 1 wave 12: a police interceptor watching the player attack a third party (2026-11-24, first pass)

**Rig.** sÿst 2079 Kit Police Range, owned by gövt 342 Kit Police (AI 4
red discs, one Kit Escort Gun), with traffic of gövt 343 Kit Shipping (AI 1
green discs, 3000 / 3000, unarmed); no relations between them; the player
(Kit Lancer + Kit Tickler) at the port. Tab survey, target a Kit Shipping
(`tab_to` green, found on screen about 160 px away), hold the trigger
15 s, Tab again, watch 16 s, land, leave (`scenarios/p1_police.json`,
pilot `w12_p1`).

**Result.** Every Kit Police corner read was YELLOW, before and after
(nine shots); the player's shield bar never moved; the 2079 record stayed
0 and the rating 0. The targeted trader left the screen within a second
of the trigger and was gone ("No Target") by the end of the hold, so the
number of Tickler hits is not known (1-damage hits on a 3000 shield do not
move the panel). **Read as:** a police AI 4 of the system's owner did not
react to the player shooting at a ship of an unrelated govt, with no crime
recorded (gövt 343's ShootPenalty is 0); the brief's other runs (disable
and board, distress calls, 0x0020 / Flags2 0x0008, fleet escorts) are
still open, and this one should be repeated with a hit that registers.

**Evidence:** `~/.local/share/novaref/evidence/20261124-w12/p1/run1/*/`.

### Aborting a mission in flight from the `i` dialog, wave 13 (2026-11-24)

**Question.** The `i` dialog's Abort in flight: is there a confirmation,
does the dialog close, and what happens to the mission's special ships?

**Rig.** Hand-driven (`loops/interactive.mjs`, new this wave) after
`scenarios/w13_offer_interactive.json` (land at Kit Port, accept the
offer, take off recording). mïsn 1064 (pilot `w13_abort_escort`): the
wave-11 Kit Ally Pointer as a ShipBehav 1 / ShipGoal 3 escort; mïsn 1065
(`w13_abort_raiders`): two Kit Abort Raiders (magenta pointer, mobile AI 3,
1-damage pea) with ShipBehav 0 / ShipGoal 0. Both CompGovt / CompReward 10
and OnAbort / OnSuccess / OnFailure bits. `i`, click Abort (window
287,362), shots, then land, leave, pull.

| mission | the click on Abort | the special ships afterwards | pilot |
|---|---|---|---|
| 1064, escort ally | **no confirmation; the whole dialog closes at once**; `i` then: "You have no active missions." | brackets GREEN (escort) before, **YELLOW (neutral) at once** after; it left the player, drifted about 1000 px east at about 100 px/s, stopped, accelerated and **jumped out about 17 s after the abort** (radar track: it vanished away from every stellar) | OnAbort b9118; no record change |
| 1065, two ShipBehav-0 raiders | the same: no confirmation, the dialog closes | **still RED and still shooting at the player** 3, 8, 21 and 40 s after the abort; gone only after the player landed and took off again | OnAbort b9122; no record change |

**Finding.**
1. Abort acts at once, without an "are you sure?", and closes the
   mission dialog (it does not stay open with a shorter list).
2. The special ships are NOT removed. They lose their mission role and
   fall back to their own AI and govt: the escort becomes an ordinary
   neutral ship of its govt and leaves the system (here by jumping);
   attackers (ShipBehav 0) stay hostile and keep attacking for as long as
   the player stays in the system.
3. OnAbort runs; with Flags 0 the CompReward is neither paid nor
   reversed (as wave 10's immediate auto-abort).

**NovaJS today (base 84e53aab): two mismatches, one match.**
- Match: `N/spaceport/mission_info.ts:97-102` acts at once, no
  confirmation.
- `N/spaceport/mission_info.ts:358-389` (`doAbort` / `afterAbort`)
  keeps the dialog open and redraws the shortened list; the original
  closes it.
- `N/nova_plugin/missions/mission_ship_plugin.ts:408-433`
  (`MissionShipCleanupSystem`) deletes every special ship the tick the
  mission leaves the player's list, so an aborted escort vanishes in
  place and aborted attackers disappear mid-fight.

**Proposed fix (not applied).** Close the dialog after Abort. On an
abort, untether the special ships instead of deleting them (the
`untethered` path `mission_accept.ts:600-606` already exists): drop the
mission role (formation / ShipBehav), keep the ship under its own AI and
govt, so an escort departs as ordinary traffic and an attacker keeps
fighting until the player leaves the system. (Not measured: an aborted
ship of a goal that holds it in the system, e.g. a rescue hulk.)

**Applied in 492345b2.** Abort closes the dialog. `applyAbortMission`
releases the aborted mission's ShipBehav 0 and 1 special ships before the
mission leaves the list (`N/nova_plugin/missions/mission_ship_release.ts`):
they turn `untethered` (deleted only when the owner leaves the system) and
lose the mission holds, and no goal, failure check or respawn roster counts
them; a ShipBehav-1 ship also leaves the owner's flock and decides to depart
11 s later, so a warship is gone about 17 s after the abort (pinned in
`mission_ship_release_test.ts`; a trader's run out takes longer). ShipBehav
-1 and 2 and aux ships were not measured and are still deleted. A rescue
hulk released this way stays a hulk (now an ordinary derelict).

Confidence: high (two runs, unambiguous shots; the escort's jump-out from
the radar track, frames 1235-1655 of its recording).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w13/abort/{escort,raiders}/*/`
(escort `05-missions.png` / `06-after-abort.png`, raiders `06-missions.png` /
`07-after-abort.png`; `pilot-after/`, `recording.mp4`).

### Boarding a rescue ship: stock "Rescue Raczak" (nova:394), wave 13 (2026-11-24)

**Question (wave 11's open refusal).** Wave 11's kit rescue ships
(ShipGoal 5, no përs) answered every board with "You can't board this
ship.", so they could never complete. Is that a rule, or something about
the kit missions? Board the special ship of stock mïsn nova:394 "Rescue
Raczak" (ShipGoal 5, no përs, no auto-abort).

**Stock run.** Pilot `w13_raczak` (Kit Lancer; the kit is loaded only
for the hull) at Heraan (spöb 360) with b192: the bar offered the
mission (Okay only: cantRefuse), the minimap jump to Heraan Astra
(sÿst 346) worked, and Tab found the special ship as **"UFS Excalibur,
Heavy Fighter Variant", status "Waiting"** (not "Disabled"), off screen.
Before the walk could reach it the mission had gone ("You have no
active missions." about 1.5 min after arrival): the mission's ten
infinite Moash war-ship aux ships were fighting in the system and the
Excalibur was most likely destroyed. Not completed
(`scenarios/rescue_raczak.json`).

**Kit copies.** mïsn 394 moved to Kit Port with every field as stock
(the stock Raczak düde 258, ShipNameID 25002, ShipGoal 5, ShipBehav -1,
Flags 0x1214, Flags2 0x0001, cargo 27 x1 with PickupMode 2 / DropOffMode
1, CompGovt 144) except AvailStel / AvailLoc 3 / AvailBits / ReturnStel /
OnSuccess, and no aux ships (`kits/testkit.mjs` wave 13, "R"). The board
is `loops/board.mjs`, which now steers by the target's brackets
(`locateBy: "bracket"`), sweep mode. `scenarios/w13_offer_board.json`,
`w13_offer_board_auto.json`.

| mission | the special ship | the presses | afterwards |
|---|---|---|---|
| 1071: the stock fields, ShipStart -1 (on Kit Port) | "UFS Dauntless" (a random name from the STR#), **Disabled** | silent (the alignment gate) for 16 presses, then at the 17th **"You retrieved Admiral Raczak from this ship."**, NO dialog, cargo "Special: Raczak" 1 t; every later press "You can't board this ship." | the hulk stays Disabled; the mission stays active; landing at Kit Port dropped the cargo and **succeeded** (OnSuccess b9134) |
| 1072: the same without the mission cargo (CargoType -1, PickupMode -1) | "UFS Excalibur", Disabled | **"You can't board this ship." from the first press** (19 presses) | the mission stays active after landing (never completes) |
| 1073: 1072 with the kit's düde 330 | not reached: the 24 px hull sat under the player and the bracket walk lost it | | |
| 1070: the stock fields, ShipStart 2 | not run | | |

**Finding.**
1. **A ShipGoal-5 rescue ship can be boarded only to take its mission
   cargo** (PickupMode 2). The board is not a plunder: no dialog, the
   status line "You retrieved <cargo> from this ship.", the cargo is
   loaded, and the hulk stays disabled; once taken, every press is "You
   can't board this ship.". The mission completes when the cargo is
   dropped off (here at ReturnStel), not at the board.
2. **Without mission cargo the rescue ship cannot be boarded at all**,
   with the stock düde too (1072). Wave 11's refusals were this rule, not
   a kit artefact; a goal-5 mission without PickupMode-2 cargo cannot be
   completed by boarding (whatever else completes it, if anything, is
   untested: a hail's Request Assistance?).
3. The stock special ship in its own system showed "Waiting" on the target
   panel (ShipStart 2, "appear randomly, cloaked") where the copies showed
   "Disabled"; what "Waiting" means was not followed up.
4. Side finding: the mission's CompReward 10 for gövt 144 changed MANY
   systems' records at the success: +10 in the four systems gövt 144
   (Wild Geese) owns (sÿst 185, 762-764), +5 in 173 others and -5 in 121
   (presumably its allies' and enemies' systems at plus / minus half; not
   mapped), unlike a crime (see the A14 section below).

**NovaJS today (base 84e53aab): mismatch.** Any board of a goal-5 special
ship counts as the rescue (`N/nova_plugin/missions/mission_ship_plugin.ts:293-305`
calls `pickUpOnBoarding` and `rescueBoarded`), and `rescueBoarded`
(`:198-215`) lifts the hulk state so the rescued ship flies off; the
boarding dialog path is the plunder dialog unless a ShipDoneText or offer
applies (`N/display/boarding_plugin.ts:300-318`; not driven headless).
**Proposed fix (not applied):** refuse the board of a live mission's
goal-5 ship with "You can't board this ship." unless it carries
PickupMode-2 cargo not yet loaded; that board loads the cargo with "You
retrieved <cargo name> from this ship." (no dialog, no plunder) and leaves
the ship disabled; the goal then completes through the cargo's drop-off.
Wave 11's "not applied" refusal can now be applied in this narrower form
(mïsn nova:394 itself carries cargo, so it stays completable). The
CompReward spread (finding 4) is a separate check against
`N/nova_plugin/missions/` reputation code (not done).

**Applied in 14a3a450** (findings 1 and 2), in
`N/nova_plugin/encounters/rescue_board.ts`, after the ordinary gate and
before bay capture / repair / plunder. The retrieval credits the rescue
goal (the drop-off then completes the mission); its line is STR# 2002
105-107 with the Bible's '*' rule. Left on the plunder path: the deferred
auto-abort rescue (përs replacement, the Refuel Traders), still untested.
Choices not measured: a full hold refuses the board (the cargo stays
retrievable), and a non-owner is refused.

Confidence: high for 1 and 2 (one run each, explicit messages, the pilot
read back); the stock run in Heraan Astra did not complete.

**Evidence:** `~/.local/share/novaref/evidence/20261124-w13/raczak/*/`
(`13-t3.png` "Waiting", `42-missions.png`), `raczak_kit/{b,nocargo,kitdude}/*/`
(b: `23-sw-18.png` the retrieval line, `pilot-after/`).

### An NPC disables a mission ship (goal 1 and goal 3), wave 13 (2026-11-24)

**Questions (wave-12 leftovers).** What does an NPC's DISABLE (not kill)
of a ShipGoal-1 ("disable") ship do to the mission? Does an ENEMY's
disable of a ShipGoal-3 escort ally fail the mission like the player's
disable?

**Rig.** Kit FF Range (`scenarios/w13_ndis.json`). Goal 1: pilot
`w13_ndis_goal1`; the spaceport offer mïsn 1066 puts Kit Disabler (red
disc, gövt 362, anchored, ONE 1200-damage bolt: reload 30000) on the far
mark; it fires at the player through the wave-12 goal-1 duellist on the
near mark (mïsn 1053: armor 1500, shield 0, so one hit leaves 300:
disabled, alive). The player never fires. Goal 3: mïsn 1075 (pilot
`w13_ndis_escort2`) a ShipBehav-1 / ShipGoal-3 anchored ally of gövt 348,
and mïsn 1074 a hater of gövt 349 (enemy of 348's class, neutral to the
player); take 1 used the one-shot Kit Disabler, take 2 (shïp 879 Kit Hater)
a 50-damage gun once a second.

| case | what happened | status line | pilot after landing at Kit FF Port |
|---|---|---|---|
| goal 1, the disabler's one bolt | the duellist **Disabled** (panel), never killed | nothing | **OnSuccess b9101**; the job gone from the list (the NPC's disable completed the player's goal) |
| goal 3, take 1 (one-shot disabler) | the ally took a formation slot beside the player (off the line of fire; anchored ShipBehav-1 ships do not stay on their nav default); the disabler's single bolt went at the player during takeoff (its brackets were RED: the ally's enemy treated the player as one) | nothing | OnSuccess b9128 (the ally survived): no answer |
| goal 3, take 2 (the hater's gun) | the hater shot the ally down: **"Mission failed." at frame 764**, the ally still there until frame 1053 (9.6 s later: the 10 more hits from Disabled at 33% to dead) | "Mission failed." | **OnFailure b9141** |

**Finding.**
1. **An NPC's disable of a goal-1 ship completes the goal for the
   player**, as the player's own disable would: OnSuccess at the next
   landing at ReturnStel.
2. **An enemy NPC disabling a goal-3 ally fails the mission at the
   disable**, the same as the player disabling it (wave 11): "Mission
   failed." about 10 s before the ally died.
3. Side findings: the enemy kept shooting the disabled ally until it died
   (an NPC finishes off a disabled ship it is fighting); a govt that is the
   enemy of the player's escort's govt turned RED to the player too.

**NovaJS today (base 84e53aab): matches.** `N/nova_plugin/player/mission_ship_state.ts:256-269`
(`shipDisabled`) counts a GOAL_DISABLE ship as satisfied and fails a
GOAL_ESCORT on ANY disable, whoever disabled it (called from
`N/nova_plugin/missions/mission_ship_plugin.ts:293`). No fix proposed
(wave 12's proposal for a goal-1 ship's later death still stands).

Confidence: high for 1 (one run, panel + pilot), high for 2 (one run, the
status line timed against the ally's disappearance in the recording).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w13/ndis/{goal1,escort,escort2,escort3}/*/`
(escort3 = take 2: `recording.mp4`, `13-w-08.png` "Mission failed.").

### A guided missile at a same-govt ship: NPCs never target their own govt, wave 13 (2026-11-24)

**Question (wave-12 leftover).** Does a guided missile locked on a ship of
the shooter's own govt pass through it (wave 10: unguided projectiles do)?

**Rig.** Kit FF Range, `scenarios/w13_xeno.json`: a shooter (anchored red
disc, a guided missile with about 210 px reach) on the far mark and an
unarmed victim of the SAME govt (anchored blue disc, shield 1000) on the
near mark 150 px away; the player sits at the port, 260 px from the
shooter (out of its reach). Take 1 gövt 344 Kit Xeno (0x0001, xenophobic:
"attack everyone except their allies"), pilot `w13_xeno`; take 2 gövt 339
Kit Self Hater (its own class listed as an enemy), pilot `w13_selfhate`.
Tab panels every 2 s for about 45 s, the recording's trail picture.

**Result.** In both takes the shooter's brackets were RED (it was hostile
to the player), the victim's YELLOW, and **not one missile was fired** in
80 s; the victim stayed at 100% shield.

**Finding.** A ship never targets a ship of its own govt, not even when
the govt is xenophobic or lists its own class as an enemy. So a guided
missile locked on a same-govt ship cannot arise from NPC targeting, and
the question is moot (the projectile pass-through of wave 10 stands for
stray shots).

**NovaJS today:** `N/nova_plugin/reputation/govt_disposition.ts:40-48`
(`govtDisposition`) returns 'ally' for the same govt before the enemy and
xenophobic tests: **matches**.

Confidence: high (two runs, 80 s each).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w13/{xeno,selfhate}/*/`.

### A14: a disable alone, a third reward data point, and records spreading to linked systems, wave 13 (2026-11-24)

**Questions.** (wave-12 leftover) What does a disable alone, without a
kill, charge? (item 4) Confirm the reward rule (a kill of a ship of a
govt that is neither the system's owner nor its ally RAISES the local
record by floor(Disab / 2) + floor(Kill / 2) of the OWNER's penalties)
with a third, odd penalty set, and whose record it is.

**Disable alone.** Pilot `w13_a14_dis_beam` (Kit Lancer + the Kit Long
Beam, 60 damage a tap) in sÿst 2080 Kit Victim Anchored (owner and victim
gövt 350: Disab 30, Kill 100): 12 taps took the immobile trader from 100%
to 34% and the 13th to **Disabled** (never killed; still Disabled 6 s
later); land, leave, pull: **2080 -30** (DisabPenalty alone), combat
rating unchanged (0). `scenarios/w13_space_interactive.json`.

**The reward rule, third owner.** gövt 345 Kit Odd Owner (Disab 11, Board
3, Kill 25: per-term halving gives 5 + 12 = 17, halving the sum would give
18) owns sÿst 2082 Kit Odd Traffic (traffic: gövt 350's bare traders) and
2083 Kit Odd Home. The player kills one trader with Kit One Shot
(`w13_a14_odd`, hand-driven: `p`, the map, land, leave, pull, then jump
to 2083 and `p` there). Take 2 (`w13_a14_odd2`, `scenarios/a14_traffic.json`)
added two more systems: 2084 Kit Odd Neighbour (owned by the neutral
gövt 363: Disab 50, Kill 100), linked to 2082, and 2081 Kit Odd Far (owned
by 345), linked only to 2083 (two jumps from the kill). Map positions:
2083 and 2084 are 40 map units from 2082, 2081 is 80.

| system | owner | jumps from the kill | take 1 | take 2 | the owner's halves |
|---|---|---|---|---|---|
| 2082 Kit Odd Traffic (the kill) | 345 | 0 | **+17** | **+17** | 5 + 12 = 17 |
| 2083 Kit Odd Home | 345 | 1 | **+11** | **+11** | 17 |
| 2084 Kit Odd Neighbour | 363 | 1 | (not in the kit yet) | **+48** | 25 + 50 = 75 |
| 2081 Kit Odd Far | 345 | 2 | (not in the kit yet) | **+7** | 17 |

The `p` screen (General) reads "System: Kit Odd Traffic / Legal Status:
Citizen" after the kill and "System: Kit Odd Home / Legal Status: Citizen"
in 2083 (the screen shows the CURRENT system's record; both values read
"Citizen"); the map's Legal Status for the current system the same.

**Finding.**
1. **A disable alone charges DisabPenalty** (-30), at the disable;
   with wave 12, a kill through a disable charges Disab once plus Kill.
2. **The reward is per term: floor(Disab / 2) + floor(Kill / 2) of the
   owner's penalties** (+17, not +18): four owners now (351: +9, 352:
   +65, 345: +17, and 342 Kit Police +75 for a Kit Shipping killed in
   P1 run 1c below); a disable + board of an unrelated ship in
   342's system gave +50 = floor(Disab / 2) + floor(Board / 2), so the reward
   covers every crime type, P1 run 2).
3. **A legal-record change spreads to the systems linked to the one where
   it happened**, about 0.65 per jump, and **each system's amount is
   computed with that system's OWN owner**: +11 (17 x 0.65) and +7 (17 x
   0.65 x 0.65) in 345's other systems one and two jumps away, +48 (75 x
   0.65, the neutral owner's own halves) in the neighbour owned by gövt
   363. Every value fits floor(base x 0.65^jumps); the falloff follows
   jumps, not map distance: wave 12's traffic systems sat 40 map units
   apart, unlinked, and only the kill's system changed. Waves 5, 11 and 12
   saw "only the current system changed" because every kit crime system
   was unlinked. Not measured: how far it spreads (2 jumps still +7), the
   exact factor, whether a penalty (a kill of the owner's own ship)
   spreads the same way, and how an ally / enemy owner of a neighbouring
   system computes its share.
4. **Whose record:** a per-SYSTEM record (the pilot holds no per-govt
   record), shown for the current system on `p` and the map.

**NovaJS today (base 84e53aab; per-govt records, ruling #376).**
- Disable alone: `N/nova_plugin/reputation/reputation_plugin.ts:235-290`
  (`DisableCreditSystem`) charges DisabPenalty at the disable: **matches**.
- The reward rule and the spread: `N/nova_plugin/reputation/reputation.ts:145-152`
  (`applyCrime`) charges the victim's govt for every kill and credits
  nobody; NovaJS keeps one record per govt, so neither the per-system
  reward nor the jump falloff exists. **Mismatch.**

**Proposed fix (not applied; it needs Matthew's ruling on how per-system
spreading maps onto NovaJS's per-govt records).** For a kill (or disable)
in system S: for every system T within N jumps of S, with T's owner O_T,
compute the change from O_T's view (O_T's own or allied victim: minus the
victim govt's Disab + Kill; any other victim: plus floor(Disab_O / 2) +
floor(Kill_O / 2) of O_T's penalties), scale by 0.65^jumps (floor), and
apply it to T's record. On per-govt records the nearest analogue is to
apply the S-owner's amount to the owner's govt record and the scaled
amounts to the govts owning the neighbouring systems, which double-counts
a govt owning several of them; hence the ruling.

Confidence: high for 1 and 2 (clean single kills / disables read back
from the pilot); medium-high for 3 (two takes agree to the unit, four
systems; the 0.65 factor fits three values, not measured over more
jumps).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w13/{a14_disonly,a14_odd,a14_odd2}/*/`
(`pilot-after*/`, `04-p1.png` / `09-p2.png` the `p` screens, `05-map.png`).

### P1 wave 13: police watching the player hit and kill a third party; fleet escorts defending their leader (2026-11-24)

**Rig.** Wave 12's Kit Police Range (owner gövt 342 Kit Police, default
penalties 50 / 50 / 100, AI 4 red discs; Kit Shipping AI 1 green discs of
gövt 343, no relations). Hand-driven (`scenarios/w13_space_board.json`,
`w13_space_interactive.json`), pilots on a Kit Lancer:
- run 1b `w13_p1_beam` (Kit Long Beam, 60 damage a shot, 1500 px): Tab to
  a Kit Shipping beside the port, beam it 3 s and 4 s, Tab through the
  police, watch 15 s, land, leave, pull;
- run 1c `w13_p1_kill` (Kit Beam Turret, one burst kills a 3000 / 3000
  Kit Shipping): Tab to a Kit Shipping on screen near the port, ONE burst
  (dead: "No Target", combat rating +10), Tab through the police, watch
  16 s, land, leave, pull;
- run 2 `w13_p1_board` (wëap 288 Kit Disable Gun: 3000 shield / 2100 armor
  a hit): two hits DISABLED a Kit Shipping beside the port (grey brackets),
  then the player walked onto it and boarded it (the plunder dialog:
  Energy 120, Capture Odds 15%; Abort) with three police within about
  150 px, watched 16 s, landed, left, pulled;
- run 6 `w13_convoy` (Long Beam) in sÿst 2094 Kit Convoy Range (gövt 363):
  flët 303 Kit Convoy of gövt 343, a green AI 1 lead and two yellow AI 3
  guards (one Kit Escort Gun each); Tab to the lead at once, beam it 2.5 s,
  watch.

| run | provocation | police / escorts | the player's shield bar | record |
|---|---|---|---|---|
| 1b | the Kit Shipping to **88% shield**; a stray beam also took a police ship to 84% | every police bracket **YELLOW** (two read, including the one hit) | never moved (149 px) | 2079: 0 |
| 1c | a Kit Shipping **destroyed** in sight of the port | three police gathered beside the player at the port within 10 s, brackets **YELLOW**, never fired | never moved (149 px) | **2079: +75** (the A14 reward: the owner 342's 25 + 50) |
| 2 | a Kit Shipping **disabled and boarded** beside three police | police brackets **YELLOW** after the board, never fired | never moved (149 px) | **2079: +50** (25 + 25: half the owner's Disab and Board) |
| 6 | the convoy lead to **90% shield**; its brackets turned RED | **both guards turned back at the player within about 4 s and fired at it** (orange Escort Gun bolts towards the player in frames 22-30 s of the recording), one flying past over the player; the convoy then jumped out | 149 -> 147 px (a 30000-shield hull with recharge) | (not read) |

No status-line message during or after any of these attacks (only the
takeoff and landing lines; `region_lit.mjs` over run 1b's whole
recording): **no distress call** from the Kit Shipping (gövt 343 has
Flags2 0, so distress is not disabled).

(Run 6 take 1: the convoy was already departing; it jumped out as the
first beam fired, unhit.)

**Finding.**
1. **AI 4 police of the system's owner did not react to the player
   attacking, killing, or disabling and BOARDING a ship of an unrelated
   govt in front of them**, nor to a stray hit on themselves (16% shield); the kill RAISED
   the owner's record by the A14 reward (+75), and the disable + board
   by +50 (half the owner's Disab and Board: the reward rule covers every
   crime type), so in the original's terms attacking a non-ally of the
   owner is not a crime here at all, which may be why the police ignored
   it. Still open: a victim the police govt cares about (its own or an
   ally's ship: then it is a crime anyway).
2. **Fleet escorts defend their leader:** the two guards attacked the
   player within seconds of the player's first hits on the lead, though
   they had not been hit themselves (their govt is neutral to the player).
3. No distress messages were seen in any run.

**NovaJS:** no piracy police (docs/npc_behavior_gaps.md "Law and
policing"): matches 1 so far. For 2, `N/nova_plugin/npc/npc_targeting.ts:55-74`
records an aggressor only on the ship that was hit, so a fleet's escorts
do not join their leader's fight: **mismatch**. **Proposed fix (not
applied):** when a fleet leader (or any member) records an aggressor,
give the same aggressor to the other members of its flët group (the
npc_formation leader / followers), so the escorts attack too; and the
other direction (escorts' attackers drawing the leader) is untested.
**Applied (wave-13 fixes):** `npc_targeting.ts`'s NpcAggressionSystem
records an attack on a ship on its formation followers too
(`provokeFleet`: NPCs with a FormationComponent naming it and no escort
command), with the aggressor the leader's hit resolved to, so the stray
rule and the player-side rule (the player's escort, not the player) carry
over unchanged, and a bribe of an escort is voided as a hit on it would
void it. A hit on an escort still provokes only that escort (untested
direction left as it was). Spec: `combat/fleet_escorts_defend_integration_test.ts`.

Confidence: medium-high for 1 (three runs: hits, a kill, a board); medium for 2 (one
run, bolts seen heading for the player and a shield dip, the guards'
brackets not read).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w13/{p1,p1_kill,p1_board,convoy,convoy2}/*/`
(p1 `06-f1.png` 88%, `09-p2.png` the police at 84%; p1_board `07-u1.png` Disabled, `26-sw10.png` the dialog, `pilot-after/`; p1_kill `05-b1.png`,
`pilot-after/`; convoy2 `03-f1.png`, `recording.mp4` 18-30 s).

### T1: the life cycle of ordinary traffic, wave 13 (2026-11-24, first pass)

**Rig.** sÿst 2085 Kit Life Range (owner gövt 346 Kit Life Traders):
Life Port (0,0) and Life Market (1000,0) of 346, an uninhabited Life
Marker (0,1000), a Life Hostile Port (-1000,0) of gövt 347 (346 and 347
list each other's class as enemies). Traffic: AI 1 green-disc Kit Life
Traders of 346, avgShips 6. Pilot `w13_life` (Kit Ring Tank, unarmed)
enters at Life Port and sits still for 583 s, recorded at 10 fps
(`scenarios/w13_watch.json`). Read with `analysis/radar_blips.mjs
--tracks` (123 tracks of 1.5 s or more; the radar's t is in 30 fps units,
x3 for this recording) and a per-frame count of green disc AREA in the
play area (`~/.local/share/novaref/evidence/20261124-w13/tools/_w13_disccount.mjs`: merged or
overlapping discs still count).

**Result.**
- **Arrival:** by jumping in, 1700-2000 px out (radar tracks start 50-60
  radar px away; 32 tracks came in from 45+ radar px), then a straight flight to Life Port; 16 such tracks
  ended at the port.
- **At the port:** 2.3 trader discs on screen on average (0-6), most of the
  time sitting on or beside the planet and overlapping each other. **Not
  one trader vanished on the planet or appeared from it in 583 s**: every
  change of the disc count away from the screen's edge (9) was two discs
  merging or separating over the planet, checked frame by frame.
- **Departure:** 29 tracks left the port straight out and crossed the
  radar's edge at about 40 radar px a real second (1300 px/s: the
  hyperspace run-up), i.e. a jump out from beside the port; 25 more such
  exits (54 in all) started elsewhere.
- **Stay:** by Little's law (2.3 ships on screen / about 0.05 departures a
  second) about 45 s from arriving on screen to leaving it; individual
  stays could not be followed (identical discs).
- **The other stellars:** a few tracks reached the Hostile Port (3), the
  Market (1) and the Marker (3) and left again; with the player at Life
  Port nothing shows whether they landed there.

**Take 2 (the player at the Hostile Port, sÿst 2085 spöb 2088, pilot
`w13_life_hostile`).** A network drop cut the run after 17 shots (5.5 min;
the recording was lost, `novaref recover` cleaned up): traders were on
screen in only 3 of the 17 shots, always 200-300 px or more from the
Hostile Port, and none stopped at it.

**Finding (first pass).** Ordinary AI 1 traffic jumped in, flew to the
friendly port, stopped beside it (no visible landing; several ships
parked together) for something like 45 s, and jumped out from beside it.
This run shows **no real landing or take-off at the port the player sits
on**; wave 5's "vanish on Traffic Port / appear beside it" (from radar
dots) may have been ships hidden in the stellar's radar square. Still
open: landings at the Market, and whether a hostile-govt stellar is ever
a destination (take 2 suggests not, from 5.5 minutes of shots).

**NovaJS today.** `N/nova_plugin/npc/npc_steering.ts:36` /
`:353-358`: a 12 s `dwell` beside the stellar, then the next leg or a
departure (`N/nova_plugin/npc/npc_decision.ts` trader loop); the shape
(jump in, park beside a stellar, jump out) **matches**; the parked time
looks longer on the original (about 45 s on screen, including the
approach). No fix proposed on one run.

**Evidence:** `~/.local/share/novaref/evidence/20261124-w13/watch/life/*/`
(`recording.mp4` 10 fps, `radar_tracks.jsonl`, `green_count.jsonl`,
`w-NN.png` every 20 s).

### N2: in-system shuttles (shïp Flags3 0x0002 without a scoop), wave 13 (2026-11-24)

**Rig.** sÿst 2089 Kit Shuttle Range: T1's layout (Shuttle Port (0,0) and
Shuttle Market (1000,0) of gövt 346, an uninhabited Shuttle Marker
(0,1000), a Shuttle Hostile Port (-1000,0) of the enemy gövt 347); traffic
the AI 1 blue-disc Kit Life Shuttle (Flags3 0x0002, no mining scoop),
avgShips 6. Pilot `w13_shuttle`, 584 s at Shuttle Port, 10 fps; the same
analysis as T1 (T1 is the control: the same hull without the flag).

| | T1 traders (no flag) | N2 shuttles (Flags3 0x0002) |
|---|---|---|
| radar tracks of 1.5 s or more | 123 | 154 |
| tracks leaving across the radar's edge (jump-outs) | **54** | **0** |
| tracks coming in from 45+ radar px out (jump-ins) | 32 | **0** |
| the farthest any track went | the radar's edge (88 radar px) | **35 radar px** (just past the Market) |
| trips between Port, Market and the Marker | rare | **constant**: port <-> space 40, market <-> space 36, marker 13, port -> market 11, ... |
| the Hostile Port (-1000, 0) | 3 tracks reached it | **never** (no track west of -10 radar px) |

**Finding.** A Flags3-0x0002 hull without a scoop is a true in-system
shuttle: it **never jumped in or out** in nearly 10 minutes, shuttled
between the friendly stellars, **including the uninhabited marker**,
and **never went to the stellar of an enemy govt**. As in T1, no landing
(vanish on a planet) could be told apart from discs overlapping over the
player's port.

**NovaJS today.** `P/parsers/ship_parse.ts:336-344, 510-512` parses
`shuttlesBetweenStellars` (Flags3 0x0002 without a mining scoop), but no
NPC code reads it: shuttle hulls fly the ordinary trader loop and depart
(`N/nova_plugin/npc/npc_decision.ts` trader loop). **Mismatch** (as
docs/npc_behavior_gaps.md predicted). **Proposed fix (not applied):** for
`shuttlesBetweenStellars` ships, the trader loop never departs and picks
destinations among the system's stellars whose govt is not an enemy of
the ship's (uninhabited ones included); a shuttle spawns in the system
(genesis) rather than by jump-in.

Confidence: high for "never jumps" and "never the enemy stellar" (one
584 s run, against a control run of the same hull); medium for "the
uninhabited marker counts" (13 tracks touching it; whether they stopped
there or passed by was not separated).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w13/watch/shuttle/*/`
(`radar_tracks.jsonl`, `blue_count.jsonl`, `recording.mp4`).

### N1: does the Asteroid Miner mine? wave 13 (2026-11-24, first pass)

**Rig.** sÿst/spöb 2093 Kit Mine Range (16 metal asteroids, AstTypes
0x000F); traffic AI 1 cyan-disc Kit Miner (a copy of the stock Asteroid
Miner, shïp 379: Flags3 0x0003, the stock Asteroid Scoop oütf 271 and
four of the stock miner gun wëap 181), gövt 363, avgShips 3. Pilot
`w13_mine`, 584 s at Kit Mine Port, 10 fps (`scenarios/w13_watch.json`).
The AI 2 / AI 3 / AI 4 (Zephyr) variants of the brief were not run.

**Result.** Frame by frame around 186-196 s (and in the trail pictures of
the whole run): two miners close on a rock, **fire green bolts at it**,
the rock **breaks with an explosion into debris**, and a miner **flies over
the debris**; the trail pictures show the miners circling and looping
between rocks rather than flying the trader's straight legs. Miners also
**leave**: 39 radar tracks crossed the radar's edge at jump speed (no slow
exits), so the traffic turns over (inbound tracks from far out: only 3,
so arrivals were mostly not visible as long tracks). Whether a miner
lands, and how long it mines before leaving, were not separated.

**Finding.** The original's AI 1 Flags3-0x0003 miner with a scoop really
mines: it targets asteroids, shoots them apart and steers over the
debris, then eventually jumps out like other traffic.

**NovaJS today.** Asteroids, debris and the scoop exist
(`N/nova_plugin/combat/asteroid_plugin.ts:148-170`, ScoopSystem around
`:656-673`), and `P/parsers/ship_parse.ts:336-344, 510-512` parses the
Flags3 bits, but no NPC steers to a rock, fires at it or seeks debris:
**missing** (docs/npc_behavior_gaps.md "Asteroids"). **Proposed (not
applied):** the brief's AI 1/2 mining mode for Flags3 0x0001 (+ scoop for
0x0002): target the nearest asteroid, fire until it breaks, steer over the
debris, depart after a while as other AI 1 traffic.

Confidence: medium (one run; the shoot / break / scoop sequence seen
directly in one stretch and consistent with the trails elsewhere).

**Evidence:** `~/.local/share/novaref/evidence/20261124-w13/watch/mine/*/`
(`recording.mp4` 186-196 s, `radar_tracks.jsonl`, `cyan_count.jsonl`).

### Reliability notes (for anyone running the reference)

- **The old Mac dropped off the network once (wave 13, about 03:05):**
  "ssh: connect to host 10.77.0.2 port 22: Operation timed out" ended a
  run mid-watch with EV Nova still running and the kit installed; a
  queued run failed at once. `novaref status` saw it again a minute
  later and `novaref recover` restored everything (Matt == backup). The
  remote recording of the cut run went to the recover backup folder.
- **Legal records spread to LINKED systems (wave 13).** A crime or a
  reward also changes the records of the systems linked to the one where
  it happened (about 0.65 per jump, each with its own owner's view; see
  the A14 wave 13 section). Every A14 rig before wave 13 used unlinked
  kit systems, which is why only one system ever changed; a rig with
  hyperlinks must read every system's record.
- **Hand-driven steps inside a run (wave 13).** `loops/interactive.mjs`
  keeps a run (lock, plug-ins, recording) alive and executes steps
  appended to an inbox file, so a driver can look at each shot before
  the next click (README "Hand-driven steps"). Never delete the inbox of
  a live run (a second queue's setup did once, and the run died; the loop
  now tolerates it). `waitready`-style polling must count the "ready"
  lines, not just find one: an old outbox already holds one.
- **A ShipBehav-1 mission ship does not stay on its nav default (wave
  13)**, even anchored (Speed 0): it takes a formation slot beside the
  player at takeoff. Rigs that need it on a mark must use another
  ShipBehav.
- **Mission aux ships can destroy the special ship before the player gets
  there (wave 13):** stock "Rescue Raczak"'s ten infinite Moash war ships
  took the UFS Excalibur within about 1.5 minutes of the player's arrival.

- **Kit hulls had their running lights on until wave 11 (Matthew).**
  Every kit shän is a clone of a stock one, so most of them carried the
  stock RUNNING LIGHTS (101 of its 145 shäns): the Shuttle's shän 128 behind every disc,
  pointer, ring and shareRled hull (rlëD 1955-1999 sprites) has
  LightImage 1600 blinking in mode 1, and most stock-art kit hulls
  (Kit Escort, Kit Target and their copies) have their own lights.
  Since wave 11 `kits/testkit.mjs` switches them off on every kit shän
  (`withoutRunningLights`: LightImage / LightMask -1, BlinkMode 0; the
  engine glow while thrusting is kept). Blinking light pixels can pass
  for shots, sparkles or bracket pixels and shift
  lit-pixel counts and centroids. **Measurements that could have been
  touched** (none re-run; a 60-frame zoom around a lit pointer hull and
  the player's ring in the wave-11 `revive/ally` recording showed no
  visible light pixel, so the effect is probably small): the blob-based
  readings near a kit hull, i.e. `discs.mjs` escort offsets (F1, F1b,
  F1n), `bolt_births.mjs` (wave 5: a light inside the 26 px radius could
  count as a bolt birth), `decoy_track.mjs` (saturated red/blue
  "missile heads" near the targets), `brackets.mjs`'s "largest blob
  inside the box" (K10; the corner glyphs themselves are unaffected),
  `click_targets.mjs` blob picks, `hostility.mjs` bracket colours (K9),
  and `motion.mjs`'s centre-crop turn template (#316 Turn). Readings off
  the status bar, the target panel, the radar and the stellars
  (`panel_hits`, `region_lit`, `radar_blips`, `world_motion`,
  `planet_track`) are unaffected.

- **BBS jobs: a stock job can sit above the kit's (wave 12).** The
  Mission BBS lists stock random jobs too, and Accept takes the selected
  (first) row: in the first duel take a "Delivery to Earth" got the
  Accept. The kit's BBS jobs now carry DispWeight 30000 and the scenarios
  click the first row (window 213,238) before Accept.
- **System traffic is placed anywhere in the system (wave 12).** Fights
  between traffic happen 600-1400 px away, off screen (no brackets to
  read), and an AvgShips-1 system can come up empty. Put the ships under
  test on marks as mission ships (or anchored hulls) when the picture
  matters; kit target panels show only a NAME, no picture
  (`loops/tab_to.mjs` reads the brackets instead).
- **Tab never targets the player's own escorts (wave 9).** To target an
  escort, click it: `loops/click_targets.mjs` finds the ship sprites in a
  shot and clicks each. A click on a stellar sets the nav target instead
  (blue bracket) and leaves the ship target alone. Park the mouse before
  a shot (the cursor sprite is red).

- **Boarding at rest close in is flaky (wave 7).** Under about 17 px
  (inside the sprite of a 96 px hulk) a `b` often gets no answer at all;
  a walk may need several stops, or never opens the dialog (the
  2,000,000 hulk, three walks). `loops/board.mjs` now presses once more
  when the hulk ends up hidden under the player and always turns to face
  it; the slow `pass` mode boarded more reliably than stops.
- **Kit-placed neutral ships wander (wave 7).** A mïsn ship with
  ShipStart -1 or -2 of a neutral gövt moves off or flies in during the
  3-4 s of takeoff, so "where it was put" is not where it is when the
  recording starts; read its distance from the recording (radar dots
  for off-screen ones).
- **Start the recording before Leave when the first seconds matter (wave
  7).** A hostile ship placed beside the player starts shooting during
  takeoff (the ionization take 1 was already ionized in its first frame).

- **Kit bays pointed at the wrong ship (waves 1-5, fixed in wave 6).** A
  bay's AmmoType is the carried shïp's id itself; the kit wrote `id - 128`,
  so every kit bay named a missing ship (or, at shïp 415, the stock Pirate
  Carrier). Any old result that relied on a kit bay launching is suspect;
  "B wave 6" lists the ones that did. A harness spec now checks every kit
  bay.
- **A landing request lapses after about 27 s (wave 6).** The next `l` is
  a fresh request, answered with a greeting even when in range, so step
  scenarios must not read that press as a verdict.
- **Measure near the player, not with the Lightning sprite (wave 6).** For
  stellars under about 40 px use a small player hull (Kit Crawler Mini) and
  `planet_track.mjs --exclude-centre 15`.
- **`open_pilot` can fail with the Open panel still up (wave 6, once in
  about 45 runs).** The run cleans up but is not retried; rerun it.
- **Several `run` queues wait on the lock unfairly**: whichever queue starts
  its next run the moment the lock frees wins every time, so a second
  queue can starve past its `--lock-wait`. Use one queue.
- **One main-spaceport mission offer per landing, rolled per day (wave
  10).** With two AvailLoc 3 missions available only the lower id was
  offered; a second landing the same day offered nothing new (not even a
  mission whose bit had just been set), and a bar (AvailLoc 1) mission
  did not pop up. To place two mission ships, make the second a Mission
  BBS job (AvailLoc 0: BBS button at window 182,430, Accept 476,384;
  Accept closes the BBS).
- **Keys in the spaceport (wave 10).** Return in the outfitter and in the
  BBS closes them (it does not buy or accept); Escape in the spaceport
  itself LEAVES (takes off). A pilot is written when the player leaves;
  a scenario that needs the state after something in flight must land
  and leave again, with generous waits (`l wait 1500 l wait 1500 l wait
  10000`), and pull after that.

- **Launch can die while loading (wave 4).** Once in about 90 wave-4 runs
  EV Nova never showed a window ("no EV Nova window within 30 s", no
  process left); the kit loaded fine in every other run. `run` now
  retries that like the Enter Ship flake.
- **The escort panel closes itself 8.3 s after opening (wave 4)**, so a
  scenario that shoots it must do so within that time or reselect a row.
- **Planets and the message line overlap.** `planet_track.mjs` reads the
  status line at grey > 200 so a planet drawn behind the text does not
  split one message into many.

- **Sporadic exits.** About 1 run in 8 ends with the game exiting just
  after Enter Ship (`e`), with no crash report. Since wave 2, `run`
  detects this and retries the whole run (default 2 retries; README
  "Retries"). In wave 2 it fired once in about 60 runs: the game died
  during the landing step just after `e`, and the run cleaned up and
  reran as `...-retry1`
  (`evidence/20261123-jam/v100_j50/20261123-043646-*`).
- **Escape in space quits to the title screen.** It is the pause key in
  this install. Scenarios must never press it in flight.
- **Lock and frame sync (wave 2).** Every driving command holds
  `~/.config/novaref/lock`, so only one agent drives the old Mac at a
  time. Every key, click and in-recording shot is stamped with the
  recording frame it landed in (`log.jsonl` `frame-sync` lines,
  `recording.events.json`). The game shows a key's effect 4-5 frames
  (about 150 ms) after the stamp. See the README.
- **Display sleep kills recordings.** A sleeping display has no
  "Capture screen 0" device; `record start` now wakes it first.
- **Plug-in not loaded.** Once, the game said the pilot referenced a
  plug-in that was not loaded. A rerun worked.
- **Custom graphics crash the game.** A from-scratch shän crashed it on
  Enter Ship every time. An rlëD with the synthetic data set's row
  encoding failed an assertion on load. The kit therefore clones the
  stock Shuttle shän and encodes rlëD rows the stock way
  (`encodeRled(..., { original: true })`).
- **Power cut.** A power cut rolled back the last seconds of file
  operations on the old Mac's HFS+ disk. `novaref recover` handled that.
- **rlëD ids above 1999 crash the game at load (wave 3).** The first
  wave-3 kit made EV Nova quit while loading, three times in a row
  (`run` reported `game_exited` on every attempt). A bisect over the
  kit's sections pinned it on two disc hulls' rlëD 2000 and 2001;
  renumbered to 1977/1978 the same kit loads. `plugin-make` now refuses
  ids past the game's limits (README "Id limits"). Evidence:
  `~/.local/share/novaref/evidence/20261123-w3-bisect/NOTES.txt`.
- **sÿst DudeTypes can place fleets (wave 3).** The Bible's -128..-383
  entries are flët ids, so a flët must use an id in 128-383 to be placed
  by a system. Wave 2's flët 1000 could never appear.
- **Takeoff heading is random.** The J-series player sits where it took
  off, facing wherever the game put it. A jammed missile that flies
  straight still hits when that heading points at the target, so every
  jamming run's launch heading was checked in the recording (none of the
  jammed cells pointed at the target).

## Pending

| id | question | status |
|---|---|---|
| U9 | Landing and boarding speed/distance gates | **Wave 6:** the landing zone is a SQUARE, max(\|dx\|, \|dy\|) <= about 1.7 x the frame WIDTH, capped near 212 px (fits all 12 at-rest brackets of waves 4 and 6; the tiny 15x21 / 17x31 stations land at about 25 / 29 px; applied in bd344b9f). **Wave 7:** boarding while moving needs under about 7.5-9 px/s (boarded at 3.4-7.3, refused at 9.2-11 with "not close enough", "too fast" from 16 px/s at any distance, checked before distance; NovaJS 54.8 px/s, after distance); money booty max(1,000, price / 40) from 2,000 to 100,000 (1,000 / 1,000 / 1,250 / 2,500), but 19,500 and 21,500 at 500,000; crew 500 still 0% capture; a 96 px hulk and a 2,000,000 one never opened the dialog (presses close in often get no answer). The receding "too fast" fits an approach state left only outside the UNCAPPED 1.7 W square (wave-4 re-read). **Wave 8:** the silent presses are the ALIGNMENT gate: in range, a press is refused with no message (the status line is cleared) unless the two hulls' axes are within about 25-30° of each other, the same way or opposite (nine sweeps that only a turn in place opened; NovaJS 15°, and it prints a hint); one board per hulk (after an Abort every press says "You can't board this ship."; matches); the range is a SQUARE, max(\|dx\|, \|dy\|) <= about half the target's sprite (12 for 24 px, 39-47.6 for 96 px; a little more with a bigger boarder); money stays between price / 40 and price / 20, exactly price / 40 at 50,000 (24 boards) and random from 200,000 up (5,000-87,000 over 11 boards); capture: a derelict (gövt 0x0800) never (29 boards, 0%, also 90% shot away), a hulk the player disabled is capturable, odds capped at 75% and falling with the defenders' crew (10 boarders vs 1 / 5 / 10 / 15 / 20 / 40: 75 / 34 / 20 / 18 / 17-18 / 7%; NovaJS a crew share, 5-95%, and derelicts capturable: mismatch). Still open: the exact shape of the money's random part and of the odds below the 75% cap; the range's boarder-size term. |
| B NPC carrier | Does a bay fighter's blast near its NPC carrier make the carrier turn on it? | **Answered (waves 6, 7): no.** Wave 6: a stock Fed Carrier beside the player took 57% shield from its Vipers' blasts, or 1-point blast hits for 110 s, and kept firing at the player. Wave 7: an anchored Kit Bomb Carrier lost 60% of its shield to its Kit Bombers' blasts in 15 s and never finished off the four bombers its blasts had disabled; with 1-damage blasts its bombers flew 110 s unharmed by it. The kit-bay rechecks: Q4 stands (a protector carrier with a working kit bay never launched) and the player's own bay launches real Kit Fighters (E-view). **Wave 8:** not reproduced: the same 1-damage carrier fired at the player steadily with its four bombers out the whole run, as did a gun-only and an empty-bay carrier; live fighters don't hold a carrier's guns (matches NovaJS). |
| J leftovers | What InhJam actually does (nothing on targets of AI 1-4); ion, cloak, max-vs-ignore-count for stacked jammers; Interference at other levels | **Wave 6:** an ionized ship cannot fire 0x0020 missiles at all and fires others normally (matches); missiles keep homing on a cloaked target while the parent's scanner keeps it targeted (applied in 2ccf6ee9); a confused (Interference) missile turns about 1.8x its GuidedTurn (applied in bdc43534). **Wave 7:** InhJam works through the HULL's inherent govt (shïp govt 364: 98% jammed; a düde govt alone: nothing); different jammer outfits ADD (25 + 75 jammed 100% in either order; copies of one outfit count once); Interference 30 / 60 confuse 23% / 35% (with 100 -> 68%: 0.0066 per point, matches); ionization starts at about half of IonizeMax (matches). NovaJS took the largest outfit and ignored InhJam: mismatch, applied in f20ecec2 (distinct outfits summed, plus the hull's InherentGovt InhJam). Asteroid range vs chance: not answerable (röid has no speed or position field). |
| A leftovers | AI 2 "runs away when the attacker is out of range"; the exact 0x0010 thresholds; how long traffic stays | **Wave 7:** an AI 2 trader whose attacker flew out of its guns' reach ran directly away and left the system about 20 s later (the AI 3 control broke off too but stayed); NovaJS kept chasing (applied in ae475ef8). gövt 0x0010: twelve runs at two beam damage rates, hostile and neutral tanks: neither distance nor rate sorts jump vs stay (4 of 12 jumped, one crossing at 25 px; far crossings at 760-1320 px fought on); every jump came at once (gone 18-24 s after the crossing), no late jumps; NovaJS jumped every 16 s stand-off (one draw at the crossing instead, 13 of 28 jump: applied in a6c1143b). |
| E leftovers | Front-quadrant turrets (guidance 7) from the slot; recall overshoot vs NovaJS | **Wave 6:** the recall overshoot ranges from none to about 390 px over five runs (settling 8.3-18.5 s), so only the slow 35-48 px/s final approach is systematic. The escort panel's 8.3 s timer keeps running under the full map, which does not close it (matches). **Wave 7:** front-quadrant turret escorts stay in their slots and fire from them (raiders to 41-52% shield; matches). |
| K10 | Where the target bracket corners sit (stellars and ships) | **Wave 9: answered.** Box = the BASE sprite frame + 15 px on every side (side 2 x floor(S / 2) + 30), square from max(w, h), for stellars (15x21 to 325) and ships (24 to 184) alike; not the art, not the glow layer, not the landing square; constant with distance and rotation; fixed-size glyphs (ships 9 x 9, stellars 11 x 11); a ~100-130 ms additive fly-in. NovaJS draws the glyphs at +-0.354 x the largest LAYER (glow included), w and h apart: inside the sprite, mismatch (fix applied in c43cddcc). Tab skips escorts (matches); whether `r` picks an escort is still open. |
| A14 leftovers | Ally propagation when the VICTIM's govt lists the ally (the reverse of wave 5's case); enemies' records | **Wave 5:** one-way alliances enforce in either direction; a kill changes only the current system's record (DisabPenalty + KillPenalty), not the owner's other systems or the ally's. Both applied in 13567336 (ruling #376). Still open: whether a kill of an enemy of the system's owner raises the local record (NovaJS now credits nothing), and which record a crime against V changes in a system owned by O != V (NovaJS charges V's). **Wave 12 (traffic victims):** the owner's or an ally's ship costs the VICTIM govt's Disab + Kill in the system's record; any other govt's ship (enemy or not) RAISES it by floor(Disab / 2) + floor(Kill / 2) of the OWNER's penalties (explains wave 11's +130); negative penalties apply signed. **Wave 13:** per term (owner 345, 11 / 25: +17, not +18; four owners fit); a disable alone costs Disab; and every record change SPREADS to the linked systems at about 0.65 per jump, each computed with that system's own owner (+11 / +7 one / two jumps away in the owner's systems, +48 in a neutral owner's neighbour): see "A14 ... wave 13". |
| Wave 10 leftovers | Submunitions: the fuse-distance formula's target-size term (two sizes measured). Friendly fire: does a same-govt or allied victim turn when it IS the shooter's target, and after more than 45 s. #321: which jünk rows survive the 8-row cap. #316: strict play on a second hull (2/3 vs 0.68), an NPC. #324: does a jump (not only a landing) refresh NCB-gated system visibility. #320.3: the DEFERRED auto-abort (board / rescue goal). Item 11: an installed 0x0400 item on a trade-in; base vs loaded mass; stock Carbon Fiber. M1: the click window's exact end (6.8-9.3 s after the show); ships or planets under the hidden minimap. Not started: brief items 5 (reviving a disabled mission ally) and 6 (the UI screen/key matrix; side findings so far: `i` in flight opens "Currently active missions", Escape in the spaceport leaves, Return in the outfitter closes it, in the BBS Return closes it, the BBS has no map button) | **Wave 10** (items 0, 0b, 1-4, 7-11 answered above: "Submunitions wave 10" ... "Outfits that scale with the ship's mass") |
| Wave 11 leftovers | #320.3: the DEFERRED auto-abort needs a përs whose ship a goal-2/5 special ship replaces (the kit has no përs; non-përs goal-5 ships could not be boarded at all). A14 (a)-(c): mission ships with no goal are no crime, so re-run with SYSTEM traffic as the victim (and re-check wave 10's negative-penalty run the same way); explain the +130 after killing a stock-art Leviathan / Viper in Kit Victim Home 3. Trade-in 27,500 vs 26,250 (one run with an empty hold). AppearOn: a mixed düde (one admissible class). UI matrix: the original's in-game preferences key (neither `cmd+,` in flight nor in the spaceport opened anything); `e` with escorts from inside a venue. Item 6 (npc_behavior_gaps.md): only S1 / I1 started (see "S1 / I1 wave 11"); T1, N2, N1, P1 not started. The plain-NPC revive case (an AI 1 neutral fled the blast; wave 8's plunder dialog stands). | **Wave 11** |
| Wave 12 leftovers | Duel: what an NPC's DISABLE (not kill) of a goal-1 ship does to the mission. IFF: a long or heavy provocation of a busy NPC; the same-govt victim case. A14: a disable alone (Disab charged at the disable?); the reward rule's mapping onto NovaJS's per-govt records (needs a ruling). Escort vs trader: a second run with the fight on screen; who pays the legal penalty for an escort's kill. Subs: more shapes for a side-on fit; whether a guided missile locked on a same-govt ship passes through it (an NPC locks its own govt only through gövt 0x0001; not set up). Scrolling: the bar / hire-escort lists, a real mouse's wheel (the BBS in NovaJS: checked, 39f5805d). Trade: SellOn on a SoldAt row; the trade-in's rounding. S1-S3: ScanFine 0, rescans, S3, the clean pilot's I1 radar track (300 s). P1: runs 2-6 and run 1 with registered hits; T1, N2, N1 not started. | **Wave 12** (duel, IFF, A14 (a)-(c) + negative penalties, escort vs trader, subs vs a bar, scrolling, Schmoo, trade-in, S1 / S2, P1 run 1: the "... wave 12" sections above) **Wave 13** answered: the NPC disable of a goal-1 ship (completes it), a disable alone (-Disab), the same-govt missile (moot: no own-govt targeting), P1 run 1 with hits and a kill, P1 run 6, T1 / N2 / N1 first passes. |
| Wave 13 leftovers | Abort: an aborted ship held in the system by its goal (a rescue hulk). Rescue: what "Waiting" means on the stock special ship (ShipStart 2), mïsn 1070 (stock fields, ShipStart 2) and 1073 (the kit düde with cargo) not run, how a goal-5 mission without cargo can complete, the CompReward spread across allies' / enemies' systems (+5 / -5). A14 spread: how far (2 jumps still +7), the exact factor (about 0.65), penalties (a kill of the owner's own ship) spreading, an ally / enemy owner of a neighbour. P1: runs 3-5 (raiders vs traders, 0x0020, Flags2 0x0008), a victim the police govt cares about; the guards' bracket colours in run 6. T1: landings at the other stellars (park at the Market; the Hostile Port watch was cut at 5.5 min by a network drop), stay times per ship. N1: AI 2 / AI 3 / AI 4 (Zephyr) miners, mining time before leaving. S1-S3, W1, C1, H1 untouched. | **Wave 13** (the "... wave 13" sections above) |

## Catalogue

Sources: Forgejo open issues (all 116 skimmed; #321, #316, #320, #373,
#358, #297 and #140 read in full), code comments that mark Bible-silent or
guessed behaviour, the hub's protect-the-player questions, and Matthew's
categories (NPC AI state transitions, UI hotkeys, edge cases).

Priority: **H** affects common gameplay or blocks an issue; **M**; **L**
cosmetic or rare.

### Physics and units

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| U1 | shïp Speed/Accel/Turn units | `P/parsers/constants.ts:9-21` | **answered above, and the fix has landed** (Matthew ruled for nominal 30 Hz: 0.45·Speed px/s, 0.18·Accel px/s²) | H |
| U2 | wëap GuidedTurn scale | `P/parsers/weapon_parse.ts:313` | **answered above (#316b)**: GuidedTurn/10 °/frame, the same as shïp Turn. NovaJS already matches; no change needed. | H |
| U3 | Outfit speed/accel/turn mods use the same scale? | `P/parsers/outfit_parse.ts:159,172,177` | **answered (wave 2)**: yes, and NovaJS matches | M |
| U4 | Afterburner boost (×2?) and the coast back down | `N/nova_plugin/travel/afterburner_plugin.ts:14-40` | CPl + afterburner outfit, VID | M |
| U5 | Inertialess stop behaviour: does it stop instantly, decelerate at Accel, or turn the velocity? | inertialess physics in `ship_parse.ts:329` consumers | **answered (wave 3)**: it does NOT stop; it keeps its speed until braked (Down). Wave 2's "static from the first frame" was wrong. NovaJS matches (see "U9 and the inertialess hulls") | M |
| U6 | How fast does a disabled ship drift to a stop? | `N/nova_plugin/ship/disabled_component.ts:63-68` | VID | L |
| U7 | spöb Gravity unit and falloff | not implemented | CPg stellar Gravity 100/500, VID drift | L |
| U8 | Hyperspace timings: spin-up, departure, arrival, when fuel is deducted | `N/nova_plugin/travel/jump_plugin.ts:36-60` | Test kit with two linked systems; VID | M |
| U9 | Landing gate: distance and speed | `N/nova_plugin/travel/planet_plugin.ts:187-190,308-316` | **answered (waves 4, 6)**: a square zone, max(\|dx\|, \|dy\|) <= about 1.7 x frame width (cap about 212), speed gate about 20 px/s. Applied in bd344b9f (was a circle of 2 x max(w, h)) | L |
| U10 | Ship explosion damage/radius scaling | `N/nova_plugin/ship/ship_explosion.ts:85-124` | CPg heavy düde next to a known-shield ship | L |

### NPC AI and state transitions (Matthew's category)

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| A1 | Q1: does a protect-the-player ship retaliate when shot? | `N/nova_plugin/npc/npc_decision.ts:247-288` | **answered above** (shots pass through; it never turns) | H |
| A2 | Q2: does it engage attackers only, or any hostile? | `npc_decision.ts:391` | **answered**: attackers only. Matches. | H |
| A3 | Q3: does it fight its own govt's ships? | `npc_decision.ts:391` | **answered**: no. **Mismatch**; fix proposed above. | H |
| A4 | Q4: do its bay fighters follow suit? | `N/nova_plugin/escorts/bay_plugin.ts` | **answered (waves 1, 7)**: protector carriers never launch: Q4b (the stock Fed Carrier) and, rerun with the fixed kit bay in wave 7, the Kit Carrier (16 panels, no fighter) | M |
| A5 | Do NPCs of the same govt pass through each other's shots? | `N/nova_plugin/ship/firing_group.ts:62-67` | CPg crossfire, VID | M |
| A6 | Warship (AI 3) vs interceptor (AI 4) engagement thresholds against a criminal player (MaxOdds, strength) | `npc_decision.ts` odds logic | CPg govt MaxOdds variants, CPl rating/strength | M |
| A7 | Brave/wimpy trader transitions: flee vs fight back, and when they calm down | `npc_decision.ts` cases 1/2 | **mostly (waves 3, 7)**: AI 2 fights to shields-down and keeps attacking 130 s after one tickle; AI 1 leaves within 35-40 s even unprovoked; AI 2 whose attacker flies out of reach runs away and leaves the system (wave 7). The last was a mismatch (NovaJS chased); applied in ae475ef8 | M |
| A8 | How long a ship bribe lasts (NovaJS: 2 min) | `N/nova_plugin/encounters/hail_plugin.ts:228-233` | VID after bribing | M |
| A9 | Do pirates board a disabled player, and what do they take? | `N/nova_plugin/npc/npc_plunder.ts:45-108` | CPl weak ship, VID, PD | M |
| A10 | Does a disabled player ever recover unaided? | `N/nova_plugin/ship/disabled_component.ts:76-95` | VID 3 min | M |
| A11 | When do NPCs leave a system, and how often do they respawn? (AvgShips ±50%?) | `N/nova_plugin/spawn/npc_spawn_plugin.ts:138,833` | **partly (waves 4-5)**: AI 1 mission ships jump out 30-40 s after appearing (9 of 9); AI 1 traffic lands, lingers about 20 s at a stellar and jumps (wave 5) | M |
| A12 | Do mission goal ships (other than chase-off) linger after the goal completes? | `N/nova_plugin/missions/mission_ship_spawn.ts:95-105` | CPg, VID | L |
| A13 | Does a hostile Flags 0x0020 AI use its afterburner? Is a Flags2 0x0004 ship skipped by NPC targeting? | `P/parsers/ship_parse.ts` | CPg, VID | L |
| A14 | Which legal record decides a ship's hostility: the player's record in the CURRENT system, or in the ship's govt's systems? | `N/nova_plugin/reputation/reputation.ts`, `hostility.ts` | **answered (A14, wave 2)**: the current system's record, enforced by the owner, its allies and nosy govts, against the ship's own CrimeTol. **Mismatch**; applied in 13567336 (ruling #376). | H |

### Reputation, missions and economy

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| R1 | #321 trade tier multiplier k / priceFlux | `N/nova_plugin/economy/trade_logic.ts:33` | **answered above**: priceFlux has no effect, tiers are exact ×0.8/1/1.25, and öops disasters are the likely ×1.1 | H |
| R2 | #320.1 ally/enemy record propagation size (NovaJS penalty/2) | `N/nova_plugin/reputation/reputation.ts:75,156` | **partly (wave 5, A14 wave 5)**: a kill changed only the current system's record (-150 = Disab 50 + Kill 100); the ally's home (an ally listing the victim's class) got 0. The reverse alliance direction and enemies are untested. Propagation removed in 13567336 (ruling #376) | H |
| R3 | #320.2 negative gövt penalty = none? | `reputation.ts:127-139` | CPg govt KillPenalty -5, PD | H |
| R4 | Engine default when a penalty is 0 (NovaJS 5/2/3) | `reputation.ts:63-67` | CPg govt with zero penalties, PD | M |
| R5 | Combat-rating multiplier (NovaJS raw Strength sum) | `reputation.ts:46-50`, `reputation_plugin.ts:185-220` | Kill one known-Strength ship, PD rating | M |
| R6 | Who gets kill credit for an escort or fighter kill (NovaJS: group root) | `N/nova_plugin/reputation/reputation_plugin.ts:44-48` | CPl with escorts (pilot-make `escorts`), PD | M |
| R7 | Bribe price (NovaJS 10%/30% of cash, minimum 500) | `N/nova_plugin/reputation/hail.ts:83-93` | CPl with exact cash at 2-3 levels, SS | H |
| R8 | Planet bribe price, duration and persistence | `N/nova_plugin/travel/planet_plugin.ts:149-156` | CPl, SS | L |
| R9 | Outfit resale (NovaJS 50%), and same-visit buy+sell refund | `N/spaceport/outfitter_rules.ts:408-416`, `outfitter.ts:206` | CPl at Kit Port, PD credits | H |
| R10 | Ship trade-in (25%: are stock outfits double-counted? ammo? clamp?) | `N/spaceport/shipyard_rules.ts:88-121` | CPl buy a kit hull, PD | H |
| R11 | Cargo when the new hull's hold is smaller | `shipyard_rules.ts:327-340` | CPl full hold, PD | L |
| R12 | Escort daily wage formula | `N/spaceport/escort_fees.ts:62-80` | CPg hulls differing in one field, SS/PD | M |
| R13 | TravelStel -2 destination selection | `N/nova_plugin/missions/mission_offer.ts:119` | CPg, repeat offers | M |
| R14 | Is a mission with no offer dësc auto-accepted? | `mission_offer.ts:35-62` | CPg AvailLoc 3 mïsn without dësc | L |
| R15 | In-flight `S` starts: ShipSyst -6 spawn timing | `N/display/ship_mission_offer_plugin.ts:295-330` | CPg, VID | L |
| R16 | Auto-abort ships, DatePostInc on deferred auto-abort | `N/nova_plugin/missions/mission_ship_spawn.ts:479-492` | CPg, PD date | L |
| R17 | Mission destination always lands (bad record, MinStatus 32767)? | `N/nova_plugin/reputation/stellar_clearance.ts:53-75` | CPl + kit stellar with MinStatus 32767 | L |
| R18 | Tribute: rating threshold, defence-fleet waves, reset on jump-out (#353) | not implemented | CPl rating per Appendix I tier, VID | M |
| R19 | Reinforcements (MaxOdds trigger, delay, cooldown) | not implemented | CPg govt + syst ReinfFleet, VID, PD | L |
| R20 | Plunder money (NovaJS 10% of price) and capture odds | `N/nova_plugin/ship/boarding_component.ts:227,243,247` | **mostly (waves 6-8)**: max(1,000, price / 40) up to 100,000 (exactly, 24 boards at 50,000), then a random amount between price / 40 and price / 20 (200,000 to 2,000,000, wave 8); cargo and energy a random share; capture never for a derelict (gövt 0x0800), odds capped at 75% and falling with the defenders' crew for a hulk the player disabled; one board per hulk (matches). **Mismatch** (10%, 150 px circle, 54.8 px/s gate, 15° alignment, crew-share odds, derelicts capturable) | M |
| R21 | Scanning: what happens with illegal cargo (#308)? | not implemented | CPg illegal jünk + interceptor govt, VID, PD | M |
| R22 | BuyRandom roll period | `N/spaceport/day_roll.ts:39-62` | CPg BuyRandom 50 outfit, repeat landings | L |

### Blast, formation and map (added 2026-11-23)

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| B1-B4 | Blast damage to the firer, its flock and its protector; retaliation; record/rating for blasting one's own escort | NovaJS AI aggressor rules; `N/nova_plugin/combat/` blast damage | **answered above** (B-series) | H |
| F1 | Escort slot geometry, and lead/lag with speed | `N/nova_plugin/npc/npc_formation.ts:18-26,258` | **answered above**: a 45° V with no lookahead. **Mismatch** | H |
| U3 | Do outfit speed/accel/turn mods use the hull scale? | `P/parsers/outfit_parse.ts:159,172,177` | **answered (wave 2)**: yes, and NovaJS matches | M |
| U9 | Landing and boarding speed/distance gates | `N/nova_plugin/travel/planet_plugin.ts:187-190`, `N/nova_plugin/ship/boarding_component.ts:227-228` | **landing answered (waves 4, 6: a square zone), applied in bd344b9f**; boarding: speed gate about 7.5-9 px/s with "too fast" first from about 13 px/s (wave 7); range a square of about half the target's sprite (12 px for 24 px; wave 8); hulls aligned within about 25-30°, either way, else a silent refusal (wave 8) | M |
| M1 | What closes the `h` minimap, and does it persist across jumps or landing? Is it shown over the big map? | `N/spaceport/mini_map.ts` | **answered (wave 2)**: a 2.2 s peek per `h` or click. **Mismatch** | L |
| M2 | Minimap clicks with a multi-jump route; non-neighbour clicks; drag/zoom; borders | NovaJS minimap/routing | Same | L |
| M3 | Does a shift-click on the minimap also fire secondaries? | input handling | Same, with a secondary weapon | L |
| M4 | Shift-click on an unroutable system; the D-U-U-D exploration quirk | known-systems routing | **answered (wave 2)**: D-U-U-D routes; an unroutable shift-click is ignored. D-U-U-D applied in db700fff (routes pass through every drawn system) | M |
| M5 | Faction borders: minor govts, two majors meeting, uninhabited and unlandable systems | NovaJS border drawing | **answered (wave 3)**: explored + inhabited stellar radiates even if unlandable; no stellar or unexplored: nothing. Applied in 6d202ebc | M |
| M6 | Big-map default zoom (px per map unit) | NovaJS map (2.0 vs about 1.778) | **answered (wave 2)**: 1.77. **Mismatch** | L |
| M7 | Tab cycling order on the big map | `N/spaceport/route.ts:233-252` | **answered (wave 2)**: link-slot order, no "off" step. **Mismatch** (the extra off slot) | M |
| K9 | Bracket colour of non-attacking ships of a hostile govt | `N/nova_plugin/combat/hostility.ts` (onSightDisposition) | **answered (waves 2 and 4)**: red exactly when the ship attacks or will at once: AI 3/4 of a hostile govt from the start, AI 1/2 only once provoked. Applied in 29237401 | M |

### UI navigation and hotkeys (Matthew's category)

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| K1 | Spaceport hotkeys (Bar/Mission BBS/Trade/Shipyard/Outfitter/Leave): which letters, and does Return = Leave? (Return = Leave **confirmed**; `o` = Outfitter confirmed) | `N/spaceport/spaceport.ts` key handling | **mostly (wave 5)**: `o` `s` `t` `b` open Outfitter, Shipyard, Trade, Bar; `m` opens the star map (not the BBS); Escape closes each back to the spaceport. The BBS key is unknown | H |
| K2 | Mission offer dialog keys: Return = Yes (**confirmed** for AvailLoc 3), Escape = No? | spaceport mission offer | **answered (wave 5)**: Escape does NOT dismiss a bar mission offer | M |
| K3 | Tab with one ship toggles target ↔ none (**observed**). Does `r` skip friendly escorts? | `N/nova_plugin/hostility.ts` targeting | SS. **Wave 9:** Tab never selects the player's escorts (60 presses, 12 escorts; matches NovaJS's flock rule); a click does. With only escorts in the system and one targeted, `r` kept it (inconclusive) | M |
| K4 | Map (`m`) keys: zoom +/-, Find, Escape | map dialog | SS | L |
| K5 | Hail dialog (`y`) keys and buttons per govt flags (#297, Flags2 0x0001) | `N/nova_plugin/reputation/hail.ts:118-151,242` | CPg govts with each flag, SS | M |
| K6 | Venue buttons when a stellar lacks a venue: hidden or greyed? (#373) | `N/spaceport/spaceport.ts:1037-1050` | CPg Kit Market (no outfitter/shipyard): SS its spaceport | H |
| K7 | Escort command keys (escortCmd 0-3 = f/d/v/c, escort menu e), from the prefs | escort commands | **answered (wave 2, E-view)** | M |
| K8 | Radar centre arrow range and hypergate ring vs dot (#358) | `N/display/status_bar_radar.ts:209-225,646-668` | VID flying out from a kit stellar | L |
| K10 | Target bracket corners: distance from the centre, shape, what sets them | `N/display/target_corners_plugin.ts:98-117,180`, `N/display/planet_corners_plugin.ts:36` | **answered (wave 9)**: base frame + 15 px per side, square from max(w, h), fixed glyphs, additive fly-in. **Mismatch** (NovaJS: +-0.354 x the largest layer, inside the sprite); fix applied in c43cddcc | L |

### Edge cases

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| E1 | Negative shïp Shield (×5 "super shields"?) in combat | `P/parsers/ship_parse.ts:316` | CPg Shield -10000, VID | L |
| E2 | Fixed-angle (negative Inaccuracy) firing side | `N/nova_plugin/combat/fire_weapon_plugin.ts:211-231` | CPg, SS | L |
| E3 | Weapon readiness right after a spawn or jump (#135) | `fire_weapon_plugin.ts:85,510` | CPg slow-reload weapon, VID | L |
| E4 | planetType weapons vs normal ships (#136/#150) | wëap planetType | CPg, VID | L |
| E5 | Jamming odds and retargeting | `N/nova_plugin/combat/jamming_plugin.ts:96-166` | **answered (J-series wave 3)**: one roll per missile at launch, P = clamp((J-(100-V))/V, 0, 1), no re-acquire, jammer outfits don't add up (wave 7: copies of one outfit don't, DIFFERENT outfits do, and gövt InhJam counts through the hull's own govt; applied in f20ecec2). Applied in c9fc116c | L |
| E6 | Ionization thresholds and slow factor (NovaJS 0.6) | `N/nova_plugin/ship/ionization_plugin.ts:25-59` | **mostly (waves 6, 7)**: an ionized hull is drawn in the ion colour, turns a fraction of its normal rate and cannot fire Seeker 0x0020 weapons; ionization starts at about half of IonizeMax (40-60 of 100, wave 7). All match; the slow factor is not measured | M |
| E7 | Auto-refuel rate (ModType 19) | `N/nova_plugin/ship/health_plugin.ts:40-48` | CPl fuel 0, timed PD | L |
| E8 | Bay fighter launch speed (#200) | `N/nova_plugin/escorts/bay_plugin.ts:245,313` | VID Kit Carrier | L |
| E9 | shïp AppearOn residuals (#140): which entities it gates, asteroid re-roll | `N/nova_plugin/spawn/spawn_bits.ts` | CPg, CPl bit on/off | L |
| E10 | Beam decay and projectile fade curves | `N/display/beam_display_plugin.ts:32-50` | CPg, VID | L |
| E11 | Ship-info Accel/Maneuver rating-word bands | `N/spaceport/ship_info.ts:63-92` | Kit shipyard with stepped hulls, SS | L |

### Not answerable here (or not needed)

- **NovaJS-only design:** netcode, determinism, rollback, multiplayer
  sharing rulings (#374, #354, #362, #361, #349, #350, #342, #338, #345,
  #346, #332, #344). The original can only supply single-player
  baselines.
- **Layout already pinned** from the 1920×1080 captures in
  `ui_screenshots/original_macos_screenshots`.
- **Deliberate non-fidelity rulings:** player self-repair, one plunder per
  hulk, the boarding alignment rule, murk distance, and the
  deployed-fighters trade block.

## Side findings

- The reference Mac's `Nova Data 4.ndat` differs from the repo's
  canonical copy in two places:
  - wëap 146 "Pulse Laser" byte 15 (the low byte of the Graphic field at offset 14).
  - An extra dsïg 128 resource.

  So the reference runs slightly different stock data than our tests.
- `Enter Ship` starts the pilot in space beside its last stellar. It does
  not start landed.
