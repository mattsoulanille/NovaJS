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
- NovaJS also has NPC carriers never fire their bays, so it is consistent.

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
- a stellar in both a jünk's SoldAt and BoughtAt lists (NovaJS shows High).

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

**Proposed fix (not applied).** Give both predicates the current system's
owner govt O (`statusGovtOf(system govt)`, gövt 128 when independent):

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

**Evidence:** `~/.local/share/novaref/evidence/20261123-a14/<cell>/<run>/`.
Each holds `recording.mp4`, `recording.events.json`, `hostility.json`, the
Tab shots, `01-map.png` (legal status) and `pilot-after`.

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
| Up/Down arrows | Thrust or reverse as usual, **and close the panel**. |
| Tab, Return | Do nothing to the panel; they don't open it either. |
| Escape | In space this always quits to the title screen (pause key), panel or not. |
| no input | The panel stays open; there is no timeout over at least 4 s. |

- `f` with no target still sets the order to Attack.
- Bay fighters: with the Kit Fighter Bay as secondary (`w`), four taps
  of the secondary fire key (Control) launched all four (the bay
  counter went 4 to 0), with no target selected. One 1.5 s hold of
  Control in the first run launched none.

**Not pinned down:**
- whether `f/d/v/c` work with the panel closed;
- whether the selection persists between openings;
- what each order makes the escorts do. The recording holds that data
  but it is not analysed. After `v` the escorts stopped following;
  after `c`, 4 s was not enough to see them return.

**NovaJS today:**
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

**Proposed fix (not applied).** The political tier of styleForTarget
(and the radar) should make AI 1/2 freighters (non-warships) neutral
unless they are actually attacking the player. The behavioural tier
already catches that case. Two things are untested:
- AI 2 (brave trader) that has been provoked: it should go red through
  the behavioural tier;
- AI 4 interceptors of a hostile govt.

**Evidence:** `~/.local/share/novaref/evidence/20261123-k9/*/`: `02-17
obs-*.png` (the target panel names the ship; the brackets are in the
space view) and `hostility.json`.

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

### Reliability notes (for anyone running the reference)

- **Sporadic exits.** About 1 run in 8 ends with the game exiting just
  after Enter Ship (`e`), with no crash report. Since wave 2, `run`
  detects this and retries the whole run (default 2 retries; README
  "Retries").
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

## Pending

| id | question | status |
|---|---|---|
| U3 | Do outfit speed/accel/turn mods use the hull scale? | Kit outfits with ModType 9/10/11 values on a Probe, then `unit_probe.json`. Not run yet. |
| U9 | Landing (and boarding) speed/distance gate | Approach Kit Port at known speeds with the inertialess Lancer (VID). Not run yet. |
| B NPC carrier | Does a bay fighter's blast near its NPC carrier make the carrier turn on it? | NPC carriers never launch (Q4). It needs a carrier that launches: try a non-mission carrier from a syst düde, or a hostile carrier with the 372-armed bombers. |
| F1 NPC fleets | Do flët escorts use the same slots? | A flët of disc hulls in a test system. |
| M1-M7 | Map questions (minimap close/persist, routes, shift-click, borders, zoom, Tab order) | Queued as one "map" session. It needs a linked multi-system test region in the kit (current Kit Range has no links). |
| K9 | IFF bracket colour vs disposition: are non-attacking hostile-govt ships yellow? | Seen in Q2b/Q2c. A dedicated check would put AI 1 and AI 3 ships of the same always-hostile govt side by side. |

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
| U3 | Outfit speed/accel/turn mods use the same scale? | `P/parsers/outfit_parse.ts:159,172,177` | CPg outfit with each ModType; VID with the Probe | M |
| U4 | Afterburner boost (×2?) and the coast back down | `N/nova_plugin/travel/afterburner_plugin.ts:14-40` | CPl + afterburner outfit, VID | M |
| U5 | Inertialess stop behaviour: does it stop instantly, decelerate at Accel, or turn the velocity? | inertialess physics in `ship_parse.ts:329` consumers | Kit Lancer, VID | M |
| U6 | How fast does a disabled ship drift to a stop? | `N/nova_plugin/ship/disabled_component.ts:63-68` | VID | L |
| U7 | spöb Gravity unit and falloff | not implemented | CPg stellar Gravity 100/500, VID drift | L |
| U8 | Hyperspace timings: spin-up, departure, arrival, when fuel is deducted | `N/nova_plugin/travel/jump_plugin.ts:36-60` | Test kit with two linked systems; VID | M |
| U9 | Landing gate: distance and speed | `N/nova_plugin/travel/planet_plugin.ts:160-162` | VID | L |
| U10 | Ship explosion damage/radius scaling | `N/nova_plugin/ship/ship_explosion.ts:85-124` | CPg heavy düde next to a known-shield ship | L |

### NPC AI and state transitions (Matthew's category)

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| A1 | Q1: does a protect-the-player ship retaliate when shot? | `N/nova_plugin/npc/npc_decision.ts:247-288` | **answered above** (shots pass through; it never turns) | H |
| A2 | Q2: does it engage attackers only, or any hostile? | `npc_decision.ts:391` | **answered**: attackers only. Matches. | H |
| A3 | Q3: does it fight its own govt's ships? | `npc_decision.ts:391` | **answered**: no. **Mismatch**; fix proposed above. | H |
| A4 | Q4: do its bay fighters follow suit? | `N/nova_plugin/escorts/bay_plugin.ts` | **answered**: protector carriers never launch. | M |
| A5 | Do NPCs of the same govt pass through each other's shots? | `N/nova_plugin/ship/firing_group.ts:62-67` | CPg crossfire, VID | M |
| A6 | Warship (AI 3) vs interceptor (AI 4) engagement thresholds against a criminal player (MaxOdds, strength) | `npc_decision.ts` odds logic | CPg govt MaxOdds variants, CPl rating/strength | M |
| A7 | Brave/wimpy trader transitions: flee vs fight back, and when they calm down | `npc_decision.ts` cases 1/2 | CPg traders + tickler | M |
| A8 | How long a ship bribe lasts (NovaJS: 2 min) | `N/nova_plugin/encounters/hail_plugin.ts:228-233` | VID after bribing | M |
| A9 | Do pirates board a disabled player, and what do they take? | `N/nova_plugin/npc/npc_plunder.ts:45-108` | CPl weak ship, VID, PD | M |
| A10 | Does a disabled player ever recover unaided? | `N/nova_plugin/ship/disabled_component.ts:76-95` | VID 3 min | M |
| A11 | When do NPCs leave a system, and how often do they respawn? (AvgShips ±50%?) | `N/nova_plugin/spawn/npc_spawn_plugin.ts:138,833` | Stock busy system, VID 10 min | M |
| A12 | Do mission goal ships (other than chase-off) linger after the goal completes? | `N/nova_plugin/missions/mission_ship_spawn.ts:95-105` | CPg, VID | L |
| A13 | Does a hostile Flags 0x0020 AI use its afterburner? Is a Flags2 0x0004 ship skipped by NPC targeting? | `P/parsers/ship_parse.ts` | CPg, VID | L |
| A14 | Which legal record decides a ship's hostility: the player's record in the CURRENT system, or in the ship's govt's systems? | `N/nova_plugin/reputation/reputation.ts`, `hostility.ts` | **partly answered** (see Q2/Q3): a non-owning govt ignored a -500 player in Kit Range until given flag 0x0002 or 0x0004. A dedicated run is still to do. | H |

### Reputation, missions and economy

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| R1 | #321 trade tier multiplier k / priceFlux | `N/nova_plugin/economy/trade_logic.ts:33` | **answered above**: priceFlux has no effect, tiers are exact ×0.8/1/1.25, and öops disasters are the likely ×1.1 | H |
| R2 | #320.1 ally/enemy record propagation size (NovaJS penalty/2) | `N/nova_plugin/reputation/reputation.ts:75,156` | CPg govt KillPenalty 100 + ally/enemy govt owning home systems; kill one; PD legalStatus | H |
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
| R20 | Plunder money (NovaJS 10% of price) and capture odds | `N/nova_plugin/ship/boarding_component.ts:239-243,370-377` | CPl, board kit ships of known Cost/crew, PD | M |
| R21 | Scanning: what happens with illegal cargo (#308)? | not implemented | CPg illegal jünk + interceptor govt, VID, PD | M |
| R22 | BuyRandom roll period | `N/spaceport/day_roll.ts:39-62` | CPg BuyRandom 50 outfit, repeat landings | L |

### Blast, formation and map (added 2026-11-23)

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| B1-B4 | Blast damage to the firer, its flock and its protector; retaliation; record/rating for blasting one's own escort | NovaJS AI aggressor rules; `N/nova_plugin/combat/` blast damage | **answered above** (B-series) | H |
| F1 | Escort slot geometry, and lead/lag with speed | `N/nova_plugin/npc/npc_formation.ts:18-26,258` | **answered above**: a 45° V with no lookahead. **Mismatch** | H |
| U3 | Do outfit speed/accel/turn mods use the hull scale? | `P/parsers/outfit_parse.ts:159,172,177` | Kit outfit with each ModType on a Probe, VID | M |
| U9 | Landing and boarding speed/distance gates | `N/nova_plugin/travel/planet_plugin.ts:160-162` | Approach at known speeds with the inertialess Lancer, VID | M |
| M1 | What closes the `h` minimap, and does it persist across jumps or landing? Is it shown over the big map? | NovaJS minimap | Linked kit region, SS | L |
| M2 | Minimap clicks with a multi-jump route; non-neighbour clicks; drag/zoom; borders | NovaJS minimap/routing | Same | L |
| M3 | Does a shift-click on the minimap also fire secondaries? | input handling | Same, with a secondary weapon | L |
| M4 | Shift-click on an unroutable system; the D-U-U-D exploration quirk | known-systems routing | CPl exploration bits | M |
| M5 | Faction borders: minor govts, two majors meeting, uninhabited and unlandable systems | NovaJS border drawing | CPg map region with known govt colours | M |
| M6 | Big-map default zoom (px per map unit) | NovaJS map (2.0 vs about 1.778) | SS with known positions | L |
| M7 | Tab cycling order on the big map | NovaJS map | CPg system with links at known angles and ids | M |
| K9 | Bracket colour of non-attacking ships of a hostile govt | `N/nova_plugin/hostility.ts` | Seen yellow in Q2b/Q2c; needs a dedicated check | M |

### UI navigation and hotkeys (Matthew's category)

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| K1 | Spaceport hotkeys (Bar/Mission BBS/Trade/Shipyard/Outfitter/Leave): which letters, and does Return = Leave? (Return = Leave **confirmed**; `o` = Outfitter confirmed) | `N/spaceport/spaceport.ts` key handling | SS after each key | H |
| K2 | Mission offer dialog keys: Return = Yes (**confirmed** for AvailLoc 3), Escape = No? | spaceport mission offer | SS | M |
| K3 | Tab with one ship toggles target ↔ none (**observed**). Does `r` skip friendly escorts? | `N/nova_plugin/hostility.ts` targeting | SS | M |
| K4 | Map (`m`) keys: zoom +/-, Find, Escape | map dialog | SS | L |
| K5 | Hail dialog (`y`) keys and buttons per govt flags (#297, Flags2 0x0001) | `N/nova_plugin/reputation/hail.ts:118-151,242` | CPg govts with each flag, SS | M |
| K6 | Venue buttons when a stellar lacks a venue: hidden or greyed? (#373) | `N/spaceport/spaceport.ts:1037-1050` | CPg Kit Market (no outfitter/shipyard): SS its spaceport | H |
| K7 | Escort command keys (escortCmd 0-3 = f/d/v/c, escort menu e), from the prefs | escort commands | CPl with escorts, SS | M |
| K8 | Radar centre arrow range and hypergate ring vs dot (#358) | `N/display/status_bar_radar.ts:209-225,646-668` | VID flying out from a kit stellar | L |

### Edge cases

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| E1 | Negative shïp Shield (×5 "super shields"?) in combat | `P/parsers/ship_parse.ts:316` | CPg Shield -10000, VID | L |
| E2 | Fixed-angle (negative Inaccuracy) firing side | `N/nova_plugin/combat/fire_weapon_plugin.ts:211-231` | CPg, SS | L |
| E3 | Weapon readiness right after a spawn or jump (#135) | `fire_weapon_plugin.ts:85,510` | CPg slow-reload weapon, VID | L |
| E4 | planetType weapons vs normal ships (#136/#150) | wëap planetType | CPg, VID | L |
| E5 | Jamming odds and retargeting | `N/nova_plugin/combat/jamming_plugin.ts:96-166` | CPg, many shots | L |
| E6 | Ionization thresholds and slow factor (NovaJS 0.6) | `N/nova_plugin/ship/ionization_plugin.ts:25-59` | CPg ion weapon, VID | M |
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
