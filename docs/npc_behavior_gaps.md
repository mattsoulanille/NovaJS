# NPC behaviour: what the original has that NovaJS lacks

Matthew (2026-11-23): "Can we implement more NPC behavior, like scanning for
contraband, mining asteroids, 'trading' between planets in the same system,
etc?"

This document lists every NPC behaviour the original EV Nova documents or
has been measured doing. For each one it says what NovaJS does today, what is
still unknown and has to be measured on the reference Mac, and roughly how
big the work is. It ends with a recommended order and a reference-Mac brief
for each step. No game code was changed.

## Sources and conventions

- **B:n** is a line of `packages/nova/EVN_Bible.txt` (the 2006 text
  revision).
- **R:** is a section of `docs/reference_experiments.md`, the log of
  measurements on the original.
- **N/** is `packages/nova/src/`, **P/** is `packages/novaparse/src/`, and
  **D/** is `packages/novadatainterface/src/`. Line numbers are at main
  69e8a400.
- **Stock** counts come from the base "Nova Files" (no plug-ins), read
  through novaparse's resource parsers by a throwaway census script (not
  committed). Resource ids are stock ids.
- Text marked **guess** is my reading and has not been measured.
- **Sizes:** **S** is a day or less in one module. **M** needs new synced
  state, several modules and new specs. **L** is a new subsystem touching
  sim, display, data plumbing and multiplayer rules.

## Matthew's three examples

**Contraband scanning.** The original has it. AI 4 interceptors "buzz
incoming ships to scan them for illegal cargo" (B:867-868). Contraband is
anything whose ScanMask matches the scanning government's ScanMask: jünk
(B:1168), oütf (B:2027) or mission cargo (B:1364). The game's own strings
spell out the flow (stock STR# 2002 indices 373-382 and 389): "prepare to be
scanned", "hold position for a cargo inspection", "your attempt to smuggle
... illegal cargo ... through this system ... has been detected", "You have
been fined", "Have a nice day." In the stock data **every gövt has ScanFine
0** ("no fine, just a warning", B:983), so stock consequences are:

- SmugPenalty on the legal record (B:987; 1-25 in 40 stock govts);
- failure of the 75 stock missions with mïsn Flags 0x0020 (B:1550), with
  "Your ship has been scanned - mission failed." (STR# 2002 #285);
- an attack instead of a scan, if the player's record is already below
  CrimeTol (B:977-980).

AI 4 düdes are 50 of 147 and appear as traffic in 483 of 545 systems, so
scanning would be everywhere. NovaJS had **none of it** when this was
written (no scan event, no fine, SmugPenalty unused, mission flag 0x0020
inert). **Since 2026-11-24 it has** (see the inventory row below and
"Contraband scan: guesses to measure"). Size **L**.

**Mining.** The original documents it, as hull flags rather than an AI type:

- shïp Flags3 0x0001 "Ship destroys asteroids";
- shïp Flags3 0x0002 "Ship scoops asteroid debris", which needs a mining
  scoop (oütf ModType 31) in DefaultItems (B:2645-2651).

In stock, the only real miner is **shïp 379 Asteroid Miner**: both flags plus
the Asteroid Scoop (oütf 271) as a default item. It flies in four Civvies
trader düdes (129, 132, 148, 175; AI 1 or 2, 5-17% of each) across 83
systems. Two Mu'Hari Zephyr hulls (375, 376, AI 4 düdes 200/201) carry 0x0001
alone. The Bible says nothing about **how** a miner behaves: whether it hunts
rocks, how long it mines, whether it lands its haul. NovaJS has the pieces
(asteroids, debris boxes, and a ScoopSystem that works for any ship carrying
a scoop: N/nova_plugin/combat/asteroid_plugin.ts:144-170, 658), but Flags3
0x0001/0x0002 are not parsed and no AI seeks asteroids. Size **M**, after a
measurement. **Since 2026-11-24 miners mine** (R: "N1 wave 13"; see the
inventory row and "Shuttles and miners: guesses to measure").

**Trading between planets in the same system.** Also documented, as the
other half of Flags3 0x0002: without a mining scoop, "the ship will instead
shuttle back and forth between friendly stellars in the system" (B:2648-2650,
an Appendix V addition).

- **Stock shuttles:** shïp 391 Shuttle, 392 Heavy Shuttle, 393 Cargo Drone
  (all named "economy at work") and 394 Sprite.
- **Their düdes:** 247-250 (AI 1; govts Pyrogenesis Skymining, Sigma
  Shipyards, Civvies, Polaris).
- **Where they fly:** Sol, Nesre Primus and Secundus, Fomalhaut, Arcturus,
  Rautherion, South Manchester, and ten Polaris systems (Tri'lipra, Kel'ariy
  and others).

Ordinary AI 1 traffic also visits stellars, lands, lingers about 20 s and
jumps out (R: "A-series wave 5"). NovaJS already flies AI 1/2 traders
planet to planet with a 12 s "dwell" standing in for a landing, then sends
them out after 120-300 s (N/nova_plugin/npc/npc_decision.ts:508-557,
N/nova_plugin/npc/npc_steering.ts:31-33). (Since 2026-11-24, to R: "Shuttles
and T1 traders, wave 15": one 15 s park at one non-enemy port, then out;
the original's traffic never lands.) So traffic looks like trading
today, but:

- shuttle hulls are not told apart: they leave like any trader, and
  "friendly" stellars are not checked;
- nobody lands for real: the ship never vanishes and never takes off again.

Neither game moves goods. Nothing in the Bible says NPC trading changes
prices; düde Flags 0x0001-0x0040 only decide what a plundered ship yields
(B:840-847). Size **S** for the shuttles; **M** for real landing and
take-off. **Since 2026-11-24 shuttles shuttle** (R: "N2 wave 13"; see the
inventory row). Real landing is not wanted after all: wave 15 saw no
trader or shuttle land in 32 minutes of watching (R: "Shuttles and T1
traders, wave 15").

## Inventory

### Law and policing

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **Contraband scan by AI 4** ("buzzes incoming ships to scan them for illegal cargo") | B:867-868 (AI 4); gövt ScanFine B:977-986, SmugPenalty B:987-988, ScanMask B:1116-1119; jünk ScanMask B:1168-1173; oütf ScanMask B:2027-2032; mïsn ScanMask B:1364-1367; status strings STR# 2002 374-379, 392-393, 285 | **Done (2026-11-24),** to the S1/S2 measurements and waves 14-15 (R: "S1 / I1 wave 11", "S1 and S2 wave 12", "Contraband wave 14", "A14 / contraband wave 15"). Rules: N/nova_plugin/npc/contraband.ts; who is buzzed and the scanned marker: contraband_target.ts; the scan: contraband_scan.ts (ContrabandScanSystem); AI 4 decision case 4 in npc_decision.ts, mode 'scan' steered in npc_steering.ts; the status line: N/display/status_bar_content.ts `contrabandScanMessage`. An AI 4 of a govt with a ScanMask that enforces here (local_law.ts) flies at an unscanned, non-criminal PLAYER ship within 3000 px that carries something illegal to it, and scans it within 150 px. Illegal outfit: "…your posession of a <LCName> has been detected. You have been fined N credits.", ScanFine, SmugPenalty. Illegal jünk: "…your attempt to smuggle <LCName> through this system…", ScanFine, SmugPenalty. Plain mission cargo: "…your attempt to smuggle illegal cargo through this system…", ScanFine, no SmugPenalty. ScanFine 0 and below: no fine, no fine sentence (not the Bible's percent of cash; Matthew 2026-11-24: match the original). SmugPenalty by the A14 rule: the owner or its ally scanning costs the scanner's SmugPenalty, anyone else (nosy) raises the record by half the owner's; no spread. A detection turns the scanning govt's hunters on the pilot until he lands or leaves, whatever its CrimeTol. One scan per stay between arrivals by jump, unless the ship carries contraband its last scan did not find (the marker remembers what it found): a landing does not reset it, but taking off with new illegal cargo brings a rescan (wave 15). Several finds: one line naming the hold's cargo before an outfit (the jünk over the pod, measured), one fine, one record change; a 0x0020 mission among them fails silently. An ally of the owner scanning charges its own SmugPenalty (measured, wave 15). A 0x0020 mission fails only on a scan that finds its cargo illegal. A CLEAN ship is approached and scanned too, once a visit, in silence, and the interceptors sit on any ship they have scanned for the WHOLE VISIT (MEASURED, R: "Contraband / W1 / C1, wave 18": four cutters, 8+ minutes; applied 2026-11-24, `holdingScan` is the scanned marker), until it lands or jumps, or an enemy, an aggressor (piracy) or a ship still due a scan calls them off. They hold the SPOT, not the ship: a cutter does not follow a scanned ship that flies off (MEASURED, R: "Contraband / rescue / A14, wave 19"; applied 2026-11-24: NpcState `scanSatOn`, at most CONTRABAND_SIT_SPEED after it, let go at CONTRABAND_SIT_LEASH 300 px, GUESS for the distance). A fine above the pilot's cash takes all the cash and no more, and the line names the whole ScanFine with a thousands separator ("fined 5,000 credits", wave 16). Per player: each pilot is scanned, charged and told separately. Status bar: jünk shows on the "Special:" line by its Abbrev when no mission cargo is aboard, never as a commodity row (wave 15). | Guesses left below ("Contraband scan: guesses to measure"): plain mission cargo vs an outfit on the line, contraband gained in space, the leash distance (a cutter does not follow a ship that flies off: measured, wave 19), the unimplemented "prepare to be scanned" line. | (done) |
| **Mission fails if scanned** (mïsn Flags 0x0020) | B:1550; STR# 2002 #285 | **Done:** a scan that finds the mission's cargo illegal fails it ("Your ship has been scanned - mission failed."), no fine, no record (R: "S1 and S2 wave 12"), not even the CompGovt's -R/2 of CompReward (6b38f9bf: the sim marks the failure `failCause` 'scan', and compRewardDelta's 'scanned' outcome is 0). ScanMask and the flag are frozen onto the ActiveMission at accept (mission_accept_offer.ts). | Does ANY scan fail it, or only a matching one? (S3.) **51 stock 0x0020 missions have ScanMask 0**, so they can never fail by scan under the current reading. | (done) |
| **SmugPenalty** (record loss when detected smuggling) | B:987-988 | **Done** for an illegal OUTFIT and illegal JÜNK, as measured (waves 11-15): the record of the system the scan happened in (records are per system since ruling #380; no spread), by the A14 rule (the owner or its ally scanning: minus the scanner's SmugPenalty; a nosy scanner elsewhere: plus half the owner's). Not for mission cargo (measured). | A nosy scanner in an independent system (guess: no change). | (done) |
| **Piracy police** (AI 4 attacks "any ship that fires on or attempts to board another, non-enemy ship while the interceptor is watching") | B:868-871 | **Done (2026-11-24),** to "P1 wave 13" and "P1 wave 14" (R). N/nova_plugin/npc/piracy_police.ts (`policeDefendVictim`, `piracyWitnesses`), called from NpcAggressionSystem (N/nova_plugin/npc/npc_targeting.ts) through the same `provoke` / `provokeFleet` path a hit uses. When a PLAYER-side ship attacks an NPC, every AI 4 in the system (MEASURED, waves 16-17: police 300, 2500, 5000 and 9000 px away all reacted at once; applied 2026-11-24, no range test) records the attacker as its aggressor if its govt defends the victim: a NOSY govt (gövt 0x0002) for any non-enemy victim without 0x0020; any govt for its own or an ally's ship (local_law.ts's `alliedEitherWay`). The record lasts until the attacker leaves the world (lands, jumps, dies): measured in "P1 wave 15" (still hostile after 60 s, gone after a jump out and back; pinned in 9e56b637). Non-nosy police ignore an unrelated victim (wave 13). No record change. A hostile's posture is no excuse (wave 16: a non-firing 0x0004 raider shot by the player still drew nosy police), nor is a hit long past (wave 17: a 0x0004 ship that hit the player once, 72 s before, still hostile: policed), nor one firing at the player at that moment (wave 18: a bolt every 1.2 s, the last about 1 s before the beam: policed). So there is NO self-defence exemption (applied 2026-11-24: `SELF_DEFENCE_WINDOW_MS` and NpcState `aggressorHitAt` are gone; escorts included, GUESS). NPC raiders are not policed (MEASURED, wave 16); the victim's own and allied warships and interceptors defend it instead (N/nova_plugin/npc/allied_defenders.ts, see the distress row; an allied AI 4 measured in wave 17). | The **guesses** below ("Piracy police and distress calls: guesses to measure"). | (done) |
| **Nosy-ignore** (gövt 0x0020: "Nosy ships of other non-allied governments ignore ships of this govt that are under attack") | B:1063-1064 | **Done (2026-11-24)** with the piracy police: nosy police ignore an attack on a ship whose govt sets 0x0020 (R: "P1 wave 14", finding 2). "Nosy" is gövt 0x0002 (measured). It does not shield a victim from an ALLIED govt's police (measured: R "P1 wave 15", finding 2, pinned in 9e56b637), nor, by the Bible's "non-allied", from its own govt's (GUESS). | The own-govt case with 0x0020 (untested). | (done) |
| **Nosy enforcement** (gövt 0x0002: attacks a criminal player in non-allied systems) | B:1055-1058 | **Done** (13567336, ruling #376; per-system records since ruling #380): N/nova_plugin/reputation/local_law.ts. A govt enforces where it owns the system, is allied with the owner either way, or is nosy; it attacks when the player's record IN THE CURRENT SYSTEM is below its own CrimeTol (R: "A14", "A14 wave 5": all 21 cells, c2 included). | — | (done) |
| **Legal records per system, the crime spread, the Good Citizen reward** (B: "your legal status in a system", Appendix II; gövt Disab/Board/KillPenalty, InitialRec) | B:977-1004, 3473-3500; chär Status1-4 B:519-524 | **Done (2026-11-24, rulings #380 and #379):** N/nova_plugin/reputation/system_records.ts. The record is kept per sÿst; an absent entry reads as the system's status govt's InitialRec (gövt 128 when independent). A kill (Disab + Kill), disable or boarding in system S changes every system T S reaches over hyperlinks, n jumps out: each penalty field scaled by 0.65^n and truncated; the victim's scaled fields off T's record when the victim is T's owner's or an ally's ship, else half T's OWNER's scaled fields ON (the #379 reward). The walk goes by map position (stacked systems are one place). CompReward is govt-wide (every system of the CompGovt; +R/2 allies', -R/2 enemies' and xenophobes'); failure / abort hits every CompGovt system. Smuggling stays in its system. Saves v6 (old per-govt records seed each system by its status govt); the original-pilot importer maps the file's per-system values straight across. | Guesses below ("Legal records per system: guesses to measure"). An unowned neighbour takes minus a quarter of the victim's scaled fields (R: "A14 / contraband wave 16": -76 / -49 / -20, applied). MEASURED in "A14 wave 18" (NovaJS already matched; comments updated): a disable alone spreads like a kill (-400 / -260 / -65), a crime inside an unowned system is charged there by the quarter rule at 0 jumps (-600), and the map shows a selected destination's own record. | (done) |
| **Distress calls** (ships "send distress messages" unless gövt Flags2 0x0008) | B:1095-1098; stock STR# 5003 "Ship Help Messages" ("Mayday, Mayday! We're under attack! ...", 20 lines) | **Done (2026-11-24)**, to "P1 waves 14-16" (R): a NON-MISSION trader (AI 1/2) hit in an attack by an NPC that is not on a player's side sends "<ship name>: <random STR# 5003 line>" to the status line of every player in the system, at most once per 8 s per ship (the life of one line), never when its govt sets Flags2 0x0008 or its hull inherits it. Mission ships never call (wave 16: seven silent mission victims). N/nova_plugin/npc/distress.ts (rules, DistressCallEvent), NpcAggressionSystem (the trigger and the PRNG draw), N/display/status_message_plugin.ts `ShowDistressCallMessage` (the line; 8 s, then cleared at once, no fade). **Nobody answers a call** (MEASURED, wave 16): the help comes from the alliance, call or no call: the victim's own govt's warships join against its NPC attacker at once, an allied govt's after 20 s (N/nova_plugin/npc/allied_defenders.ts; unrelated warships and police, nosy or not, ignore it). The player's own victims never call where no fleet answers: measured in five runs (R "P1 wave 15", finding 1; pinned in 9e56b637); in a system with a reinforcement fleet, a trader victim that CALLS it sends its line with the call (R "R19 reinforcement fleets, wave 21"; applied 2026-11-24, N/nova_plugin/spawn/reinforcements.ts). | Whether AI 4s of the own or an allied govt defend (GUESS: yes); the defenders' range (none) and the ally's delay (one run). Guesses below. | (done) |
| **Reinforcement fleets** (sÿst ReinfFleet, called in when allied ships are losing past MaxOdds) | B:3050-3060; gövt MaxOdds B:1005-1018, MediumName B:1130-1132; oütf ModType 44 B:1924-1930; ränk 0x0400 "call in reinforcements on the player's behalf" B:2257-2260 | **Done, third pass (2026-11-24),** to R: "R19 reinforcement fleets, wave 19", "..., wave 20", "..., wave 21" and "..., wave 22" (fourth pass: a trader victim, AI 1 / AI 2, calls only when the shooter is within 600 px, a GUESS between the measured 475 and 700; speed plays no part; the call sends no distress line). N/nova_plugin/spawn/reinforcements.ts. A PLAYER's hit (or his flock's) on a non-disabled, non-anchored (hull Speed > 0) NPC of the fleet's govt or an ally calls the fleet when the odds exceed the govt's MaxOdds: the caller's side's Strength sum over every non-disabled NPC of the govt's side in the system, each at 30-100% by shield, read after the hit (`ReinforcementCallSystem`; measured: 100 against two 50s calls it at the first hit, 1 does not). An NPC's hit never does; nothing calls it on a player's behalf (ränk 0x0400 included, measured). Once per system per game day (ReinfIntrval 0 or 1), else every ReinfIntrval days: the day is kept per pilot per system (player/reinforcement_calls.ts, saved with the pilot as `reinforcementCalls`), and a call stamps only the caller (Matthew's ruling 2026-11-24: the day is private to each player). ReinfTime / 39 s later (no cap) the whole flët comes in 1,800 px from the VICTIM's position at the call, heading there (`ReinforcementArrivalSystem`), unless the victim has left the system (jumped, landed, destroyed) by then (a GUESS since wave 21), and every player hears "Sensors detect <MediumName> reinforcement fleet approaching." (STR# 2002 306 / 307, N/display/status_message_plugin.ts). It stays for the visit (SystemHold 'reinforcement'), is not traffic (`trafficCount`), and goes for the caller when an NPC of its side still holds him as its aggressor. A pilot in the system carrying an oütf ModType 44 for the govt's class (or -1) stops calls. 344 of 545 stock systems have one. | The **guesses** below ("Reinforcement fleets: guesses to measure"). | (done) |
| **Planet defence fleets and tribute** (spöb DefenseDude/DefCount, in waves) | B:2823-2836 | **Parsed only:** D/planet_data.ts:34-40 (tracker #353). 289 of 411 stock stellars have one; their düdes are mostly AI 3 (16), some AI 4 (4). | R18 in the catalogue. | L |

### Traffic, trading, landing

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **Traders visit stellars** (AI 1 "visits planets and runs away when attacked"; AI 2 fights back) | B:861-864 | **Done (2026-11-24),** to R: "T1 wave 13", "T1 / N1 wave 14" and "Shuttles and T1 traders, wave 15". An AI 1/2 trader jumps in, flies to ONE port and parks beside it for 15 s (`TRADER_DWELL_MS`, N/nova_plugin/npc/npc_steering.ts; measured median 15.2 s over 70 parks), then jumps out (npc_decision.ts trader loop; its 120-300 s departure roll no longer applies). Its destinations (`traderDestinations`, npc_decision.ts) are the landable non-wormhole ports not owned by an enemy of its govt, one uniform draw: own and neutral govts' ports alike (measured 21 / 25 / 24), never the enemy's, never an uninhabited marker. A held ship (system_hold.ts) goes on to another port instead of leaving. Flee and fight-back: R: A7, A wave 7 (applied). | The **guesses** below ("Shuttles and miners: guesses to measure", 10-12): AI 2 makes one stop like AI 1; a fixed 15 s park; wave 14's unvisited Market (1000 px out). | (done) |
| **Real landing and take-off** (traffic vanishes on a stellar and later takes off from one) | Not in the Bible; seen in R: "A-series wave 5" (ships converge on Traffic Port and vanish; one appears beside the Port and flies off) | **Not what the original does** (R: "T1 wave 13", "T1 / N1 wave 14", "Shuttles and T1 traders, wave 15": in 32 minutes of colour-tracked traffic no trader or shuttle vanished on a stellar or appeared from one; every ship arrived by jump-in). NovaJS's park beside the stellar (`dwell`) is the measured behaviour, not a stand-in. NPCs spawn scattered at genesis or jump in at the edge (N/nova_plugin/spawn/npc_spawn_plugin.ts `jumpInState`). Wave 5's "vanish" was ships hidden in the stellar's radar square. | — | (done) |
| **In-system shuttles** (Flags3 0x0002 without a scoop: "shuttle back and forth between friendly stellars in the system") | B:2646-2650 | **Done (2026-11-24),** to R: "N2 wave 13" and "Shuttles and T1 traders, wave 15". N/nova_plugin/npc/npc_shuttle.ts; the AI 1/2 trader loop in npc_decision.ts. A shuttle arrives like any traffic (genesis scatter, or a respawn's jump-in) and then NEVER LEAVES: no jump out, no landing, whatever its departure roll. It keeps ONE LANE between two of its stops (`shuttleStops`: every non-gate stellar not owned by an enemy govt, landable or not, the uninhabited marker included): the first stop is one draw, the other end the stop nearest to it (`shuttleLaneEnd`; measured in R: "Shuttles wave 16", a tie one more draw), and it flies back and forth, turning 70 px short of each centre towards the other end (`shuttleTurnPoint`) after a 4 s pause (`SHUTTLE_DWELL_MS`; measured median 3.7 s). On a lane too short for two turn points (under about 170 px here, about 150 px measured) it stands still between the stellars: a pausing shuttle brakes to a standstill (`SHUTTLE_REST_SPEED`). With ONE stop it visits it once (6 s, `SHUTTLE_ONE_STOP_DWELL_MS`) and jumps out; with none it jumps out at once (wave 16). The lane is NpcState `laneEnd`. So the shuttles a system's respawns draw hold their slots for good and, as the other traffic leaves, fill the system (as measured: avgShips 6, half shuttles, no trader after 2 minutes). Stock: shïp 391-394 in düdes 247-250 (17 systems). | The **guesses** below ("Shuttles and miners: guesses to measure"). | (done) |
| **Freighter cargo** (düde Flags 0x0001-0x0040 "carries food / industrial / ... / money"; flët 0x0001 random cargo) | B:840-847, B:924-925 | **Not plumbed:** D/dude_data.ts:23-24; D/fleet_data.ts:41-42. A boarded NPC yields its CargoComponent (N/nova_plugin/ship/boarding_component.ts:27-36), but spawned traders carry nothing. 29 stock düdes set carry flags; no stock flët sets 0x0001. | Amounts per flag (R20 covers money). | S |

### Asteroids

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **NPC mining** (Flags3 0x0001 destroys asteroids, 0x0002 scoops debris, with oütf ModType 31) | B:2645-2651, B:1900; röid YieldType/YieldQty B:2303-2315 | **Done (2026-11-24),** to R: "N1 wave 13" (closes on a rock, shoots it apart, flies over the debris, later jumps out). N/nova_plugin/npc/npc_mining.ts: an AI 1/2 hull with Flags3 0x0001 and a weapon with a reach shoots the nearest rock (mode 'mine', fired by npc_fire_control.ts: its asteroid-miner weapons if it has any, held until the rock is within reach and, for a fixed gun, under the nose); with 0x0002 and a scoop aboard it first flies over debris boxes (mode 'scoop'; ScoopSystem does the scooping); it STAYS while it has rocks to work, whatever its departure roll (R: "Stock traffic, wave 17": the stock Asteroid Miner never left Sol or Tau Ceti in 20+ minutes; applied 2026-11-24); with nothing to mine (or a full hold) it flies the trader loop, one stop and out. Nothing was missing underneath: rocks take weapon damage and break into debris, and debris scoops into the hold (N/nova_plugin/combat/asteroid_plugin.ts). The Asteroid/Debris components moved to N/nova_plugin/core/asteroid_components.ts so the NPC brain can read them. | The **guesses** below; the AI 4 Zephyr variant (Flags3 0x0001 alone) was not run, so AI 3/4 hulls do not mine. | (done) |

### Combat AI

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **Warship hunting and MaxOdds** (AI 3) | B:865-866, B:1005-1023 | **Done, simplified.** N/nova_plugin/npc/npc_decision.ts:558-662 compares strength per pair; the Bible sums friends against enemies. | A6 in the catalogue. | — |
| **gövt 0x0010 retreat** | B:1061-1062 | **Done, fitted** (N/nova_plugin/npc/npc_retreat.ts:138; R: A waves 4-7). | The exact rule (A leftovers). | — |
| **Interceptor patrol** ("parks in orbit around a planet if he can't find any" enemies) | B:867-868 | **Approximation:** AI 4 circles its nearest landable stellar at 400 px (npc_steering.ts `steerOrbit`) and engages within 1800 px of itself or that stellar (N/nova_plugin/npc/npc_decision.ts, case 4). **Stays (2026-11-24):** an AI 4 of ordinary traffic never leaves on its departure roll (R: "Stock Sol, wave 16": three Fed interceptors stayed 21+ minutes while an AI 3 destroyer left within 5; applied in 4e5a888e); only a `passingThrough` one (a released mission ship, a përs sent on its way) leaves on its clock. So a system's slots end up with interceptors as well as shuttles and the traffic freezes, as in the original (NovaJS's stock Sol: six or seven AI 4 and none or one shuttle by 4-16 minutes; the original's: three AI 4, two shuttles and a miner by 5). R: "Stock traffic, wave 17" confirmed it in Arcturus and Tau Ceti (five more AI 4, none leaving), and that a system fills to EXACTLY AvgShips and freezes there: the population target is AvgShips, no +/- 50% roll (N/nova_plugin/spawn/npc_spawn_plugin.ts `populationTarget`, applied 2026-11-24; see "Traffic population: guesses to measure" below). | Does it really "park" (sit still) or circle? At what distance? "AI 4 never leaves" rests on one run (three ships); do mission-spawned goal-less AI 4 ships stay too (here they do, like their düde)? Brief **I1**; cheap to add to S1. | S |
| **Out of ammo: run away or dock** (shïp Flags2 0x0080) | B:2576-2577 | **Done, first pass (2026-11-24),** to R: "W1 / C1 / H1 wave 15" (a missile-only hull left after its five rounds; gun hulls stayed). N/nova_plugin/npc/npc_out_of_ammo.ts `outOfAmmo`, read in npc_decision.ts before the AI-type switch: a ship of such a hull whose EVERY mounted weapon draws from an outfit magazine and finds it empty departs (the ordinary jump-out) on its next think, whatever its AI type; not while held, already fleeing, or protecting a player. 278 of 288 stock hulls set it. | The **guesses** below ("Hull AI flags and NPC cloaking: guesses to measure"): the literal Bible reading (all missiles spent, guns or not), "dock", bays. | (done) |
| **Swarming** (Flags2 0x0001) and **prefers standoff** (Flags2 0x0002) | B:2569-2570 | **0x0002 done (2026-11-24),** to R: "W1 / C1 / contraband / the shipyard prompt, wave 17" (the Tab-targeted 0x0002 hull held still about 450 px from the player for 80 s): an NPC of a standoff hull attacks from `STANDOFF_HULL_DISTANCE` 450 px +/- 30 (N/nova_plugin/npc/npc_steering.ts, the retreat's `steerStandoff` with that band), never closing; a commanded escort keeps the escort framework's approach (GUESS). **Swarming missing:** every other attacker uses one approach (`ATTACK_STANDOFF` 250 px). Stock: 155 hulls swarm, 142 prefer standoff. R: "W1 / C1 / H1 wave 15" (first pass): the 0x0001 hull sat a little closer than the control (median 147 vs 175 px from the player; 35% vs 27% of the time under 100 px, one run); no 0x0002 ship was ever on screen in 6 minutes. Too weak to build on: no change. R: "W1 / C1 / H1 wave 16": again no 0x0002 ship on screen (35% of the draws), and two motionless radar contacts sat about 500 px from the player for five minutes (radar only, colour lost, not targeted): GUESS 9 below, confirmed and applied in wave 17. | Swarming's geometry (range, orbiting, passes); whether a 0x0002 hull fires from 450 px (a long-range weapon) or only waits (GUESS 9). | M |
| **AI afterburner** (shïp Flags 0x0040 "always has afterburner (for AIs only)"; përs 0x0002 "uses escape pod & has afterburner") | B:2521, B:2156 | **Done for shïp 0x0040, first pass (2026-11-24),** to R: "W1 / C1 / H1 wave 15" (the frame track of the flagged hull: strafing runs at 1.6x the control's top speed, never over it while hanging close). N/nova_plugin/npc/npc_afterburner.ts: an NPC of such a hull burns for its WHOLE attack, thrusting or coasting (revised 2026-11-24 to "W1 / C1 / H1 wave 16": the flagged hull's MEDIAN speed was 1.9x the control's, so it flies boosted most of the time, not only on the closing leg as the first pass had it), at `AI_AFTERBURNER_FACTOR` 1.6 on top speed and acceleration, no fuel; `NpcAfterburnerSystem` applies it after travel's EffectiveMovementPhysicsSystem. 67 stock hulls. përs 0x0002 and shïp 0x0020 (advanced rating) are not read. | The **guesses** below: fleeing and travelling burns, fuel, the acceleration boost, the player's own afterburner factor (U4: still the unmeasured 2x). | (done) |
| **NPC cloaking** (Flags2 0x0100-0x4000: cloak on burst reload, when running, when hyperspacing, when flying around, stay cloaked until close, when docking, when preemptively attacked; mïsn ShipStart 2 "appear randomly, cloaked") | B:2578-2585, B:1445 | **0x0800 for traders done, first pass (2026-11-24);** the other bits missing. R: "W1 / C1 / H1 wave 15": the 0x0800 trader was seen only pulling away from the port (4-5 s each time), never parked or arriving; hostile 0x0800 + 0x1000 warships were VISIBLE the whole time they attacked; 0x0400 / 0x2000 / 0x4000 ships were never seen cloaked. N/nova_plugin/npc/npc_cloak.ts `updateNpcCloak` (run by NpcSteeringSystem every tick): an AI 1/2 ship of a 0x0800 hull with a working cloak is cloaked while travelling, parked ('dwell') and departing, visible for 4 s after each stay ends, and uncloaked while fleeing, fighting, mining, under attack or disabled. Warships are never cloaked by it (they fight visible, which NovaJS already did). Stock 0x0800 hulls are only the Wraith (Adult) and (Youth), shïp 168/169 (with the Wraith Cloaking Device): as AI 2 in the "Wraith (nice)" düdes 143 and 187 they now travel cloaked; as AI 4 in "Wraith (nasty)" 144 they are unchanged. ShipStart 2 does not cloak (N/nova_plugin/missions/mission_ship_spawn.ts; a ShipStart-2 RESCUE ship waits live, wave 19; whether a ship with a cloak starts cloaked is open). 45 stock hulls carry cloak bits; 6 missions use ShipStart 2. R: "J wave 6" saw a stock-Wraith-flagged target cloak within 5 s of being fired on (0x4000 or 0x0200). R: "W1 / C1 / H1 wave 16" read a 0x4000 AI 3 ship beamed by the player as cloaking at once ("No Target" in the panel); R: "W1 / C1 / contraband / the shipyard prompt, wave 17" CORRECTED that: an anchored 0x4000 ship provoked by the player did NOT cloak in 30 s, it turned hostile and fought, visible, and the "No Target" is the player's target clearing the moment the target turns hostile. So 0x4000 is not a cloak on being attacked first; NovaJS does not read it, which matches (GUESS 10 below). | The **guesses** below; J wave 6's cloak within 5 s of being fired on (0x0200, "when running away", now the likelier bit), 0x1000's reveal distance, 0x0400 / 0x2000 at a jump / landing; whether the player's target clears when it turns hostile (wave 17; NovaJS not checked). | M |
| **përs traits:** grudge (0x0001), Aggress 1-3 (how close before attacking), Coward (flee % of shield), ShieldMod, extra weapons, escape pod (0x0002 / gövt 0x0100) | B:2094-2102, B:2129-2134, B:2153-2156; gövt 0x0100 B:1069 | **Spawning only.** N/nova_plugin/spawn/pers_plugin.ts:21-40 lists them as gaps (its "hailing and boarding do not exist" line is stale: both exist now). 148 of 516 stock përs hold grudges. | Aggress's ranges; whether Coward replaces gövt 0x0010; a grudge's memory across systems and saves (a per-player question in multiplayer). | M |
| **Escape pods** (shïp PodCount, decorative) | B:2535-2539 | **Missing** (not parsed). | Cosmetic only. | S |

### Boarding, assistance, hails

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **NPC plunder** (gövt 0x1000: warships plunder trader-type enemies, the player included, before destroying them) | B:1078-1079 | **Done**, with ruled guesses: N/nova_plugin/npc/npc_plunder.ts (rules; credits taken from a player :109), N/nova_plugin/npc/npc_plunder_board.ts:74. mïsn 0x8000 "fails if boarded by pirates" is wired (N/nova_plugin/encounters/boarding_plugin.ts:1479). | A9: do pirates board a disabled player, and what do they take? | — |
| **Bribes** (gövt 0x0200 / 0x2000 / 0x4000 / 0x8000) | B:1071-1086 | **Done**, numbers guessed: N/nova_plugin/reputation/hail.ts:64-104 (10% / 30% of cash, minimum 500), N/nova_plugin/encounters/hail_plugin.ts:233 (2 min reprieve). | R7 (price) and A8 (duration). | — |
| **Greetings and hail answers** (gövt CommName, greetings STR#, Flags 0x0400, Flags2 0x0001/0x0008) | B:1072, B:1088-1098, Appendix III | **Done** (ruling #297): N/nova_plugin/reputation/hail.ts. | — | — |
| **Request assistance: repair / refuel** (and Roadside Assistance, Flags2 0x0010; ränk 0x0800) | B:1099-1100, B:2261-2262 | **Done:** the helper flies over and restores armor, shield and fuel to full (N/nova_plugin/encounters/hail_plugin.ts AssistBehaviorSystem; willingness N/nova_plugin/reputation/hail.ts `assistWillingness`) — for FREE help only: a Roadside Assistance govt, a ränk 0x0800, a ränk 0x0400's warship (GUESS). **A non-hostile ship, applied 2026-11-24** to R "W1 / C1 / H1 wave 16" and "H1 wave 17" (H1; de713e35): it refuses a disabled pilot flat (STR# 3000 95-99, "Not a chance." / "Yeah, right!"), at record +2000 and when his hull is of an ALLIED govt too, and SELLS a fuelless one a jump of fuel, trader or warship: its mood line (good 115-119 at 1,000; neutral 140-144 at 2,000-3,000; bad 120-124 at 3,000) over a "Pay me N credits." popup with Lower Price / Accept Price; every repeated ask adds 1,000; Lower Price counters with floor(0.75 x P / 100) x 100 or withdraws the offer ("If that's the way you feel ...", 155-159), and always withdraws a counter; Accept Price takes the price on the table at once ("Okay, I'm on my way.", 145-149) and the ship comes over with 100 fuel, no repair (`lowerPrice` hail input, FuelHaggle on the NPC). A ränk 0x0400 trader refuses. **Applied 2026-11-24** to R "P1 / H1 wave 18" and "H1 wave 19": each mood asks one of two steps (neutral 2,000-3,000, bad 3,000-4,000; the good mood only 1,000 since R "H1 / rescue leftovers, wave 21", applied 2026-11-24) and the first ask is capped by the pilot's cash, min(own ask, max(1,000, cash / 3 to a 1,000)), with no record term (`fuelAskingBase`; the divisor a GUESS); a price the pilot cannot pay keeps Accept Price live and answers "You can't fool me - you can't afford it." (60-64), taking nothing and not counting as an ask; a ränk 0x0800 refuels for free at once ("Okay, I'm on my way.", no popup) from the affiliated govt's ships AND its allies' (wave 19) and does NOT repair. | The **guesses** in "Assistance from a neutral ship: guesses to measure" below. | — |
| **Battle assistance** (ränk 0x0400 "request battle assistance ... who will also call in reinforcements"; STR# 3000 "Help is on the way.", "I'm busy.") | B:2257-2260 | **Missing** with a ränk 0x0400: assistance is repair/refuel only; a willing warship does not fight the player's attackers. **Without the ränk, measured and applied** (R "W1 / C1 / H1 wave 15", H1; 13c164af): a healthy player under attack who asks a neutral ship for help is turned down from STR# 3000 95-99 ("Yeah, right!", "No way."), whatever his record, and nothing happens (N/display/hail_dialog_plugin.ts `assistAnswer`, hail.ts `underFireRefusalText`); with nobody attacking him the answer stays 70-74. | A ränk 0x0400 WARSHIP refuses a healthy holder under attack from 95-99 (MEASURED in R "H1 wave 19" and applied 2026-11-24; its TRADER too, R "H1 wave 17", de713e35); no battle assistance has been seen at all; a disabled or fuelless pilot under attack (busy, then the neutral refusal / fuel sale of wave 16, unmeasured under fire). Brief **H1**. | S-M |
| **Hail info** (düde InfoTypes: good prices, disaster info, specific advice STR# 7500+, generic hails; përs 0x8000 disaster info) | B:832-839, B:2184 | **Not plumbed** (D/dude_data.ts:23-24). 130 of 147 stock düdes and 76 përs set it. | Where the text appears (the comm dialog's greeting?). One look at a stock trader's hail settles it. | S |
| **përs HailQuote / CommQuote / LinkMission** | B:2139-2185 | **Done:** N/display/ship_mission_offer_plugin.ts:418-570, N/spaceport/ship_mission_offer.ts:140-180. | — | — |
| **Fleet arrival quote** (flët Quote) | B:919-922 | **Not plumbed** (D/fleet_data.ts:41-42). No stock flët uses it (0 of 128). | — | S |
| **Rescue / refuel-a-ship missions** (ShipGoal 5, përs Flags2 0x0001 zero fuel) | B:1423-1427, B:2202 | **Done** for missions (N/nova_plugin/missions/mission_ship_spawn.ts, system holds). A ShipStart-2 rescue ship is LIVE and WAITING ("Waiting" on the target pane, holding still, full shields), is boarded where it sits and flies off after the retrieval (MEASURED, R "Contraband / rescue / A14, wave 19", finding 4; applied 2026-11-24: system_hold.ts `waitingForRescue`, rescue_board.ts); other ShipStarts start as hulks. NPCs never help other NPCs. The Bible documents no NPC-to-NPC rescue. | (none documented) | — |

### Fleets, movement, misc

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **Fleets in formation** (flët lead + escorts) | B:885-925 | **Done and measured:** R: "F1n" waves 3 and 5 match (N/nova_plugin/npc/npc_formation.ts:44, N/nova_plugin/spawn/npc_spawn_plugin.ts:1105-1135). | Escorts defending their leader: measured in R: "P1 wave 13" (the guards attacked the player within about 4 s of its first hit on the lead) and applied (N/nova_plugin/npc/npc_targeting.ts `provokeFleet`: an aggressor recorded on a ship is recorded on its formation followers). Still unmeasured: whether a hit on an ESCORT draws the leader and the other escorts (NovaJS: no). | — |
| **Mission ship behaviour** (ShipBehav 0 attack player, 1 protect, 2 attack enemy stellars) | B:1431-1435 | **0 and 1 done** (R: Q1-Q4). **2 missing** (N/nova_plugin/missions/mission_ship_spawn.ts:62-63); no stock mission uses it (0 of 791). | — | M, low value |
| **Nav-default starts** (ShipStart -1..-16) | B:1441-1449 | **Missing:** ships are scattered instead (N/nova_plugin/missions/mission_ship_spawn.ts:50-51). 11 stock missions use it. | — | S |
| **Hypergate / wormhole preference** (gövt Flags2 0x0020 never, 0x0040 prefer gates, 0x0080 prefer wormholes) | B:1101-1106 | **Missing:** NPCs only leave by jumping; wormholes are excluded from destinations (N/nova_plugin/npc/npc_decision.ts:145-161). Most stock govts set 0x0020; Pirate and others 0x0080; Rebellion 0x0040. | How an NPC uses a gate (flies in and vanishes?). | M |
| **Derelicts** (gövt 0x0800) | B:1075-1077 | **Done** (N/nova_plugin/spawn/npc_spawn_plugin.ts:930). | — | — |
| **Defensive perimeter** (Speed 0 + Accel 0 warship rings the first stellar) | B:2357-2360 | **Missing**; no stock hull has Speed 0, so plug-ins only. | — | S, low value |
| **Surrender / NPC begging** | Not in the Bible. Beg For Mercy is the player begging a hostile. STR# 3000 165-179 ("Here, take it and go!") read like an NPC paying the player off. | — | **Guess:** an unused or EV-legacy group. Nothing in the Bible or the comm dialog triggers it. | — |

## Recommended order

The order weighs Matthew's ask, how often the behaviour shows in stock play,
and how much NovaJS already has to build on. Each step names the
reference-Mac experiments to run first. Briefs follow.

1. **Contraband scanning**, including mission 0x0020 and SmugPenalty
   (S1, S2, S3, and I1 as a free control). This is Matthew's first example,
   and AI 4 traffic is in nearly every system.
   - **Data first:** carry ScanMask on jünk and oütf (D/junk_data.ts,
     D/outfit_data.ts and their parsers) and SmugPenalty into the reputation
     plugin.
   - **Dependency:** the consequences should share the A14 "who enforces
     here" rule now being reworked in reputation/.
   - **Multiplayer:** a scan is per player (cargo, outfits, credits and
     records are each player's own), so it is an NPC decision against one
     player ship plus a per-player event.
2. **Shuttles, and real landing and take-off for traffic** (T1, N2).
   **Done 2026-11-24** (see the inventory rows): shuttles keep a lane and
   never leave; traders make one stop. Real landing is dropped: the
   original's traffic never lands (R: "Shuttles and T1 traders, wave 15").
   - The shuttle is small: parse Flags3, give shuttle hulls a trader loop
     that never departs and only picks friendly stellars.
   - Real landing (vanish, later take off) replaces the dwell stand-in, and
     needs a respawn-from-stellar path beside `jumpInState`.
3. **Mining** (N1), **done 2026-11-24** (see the inventory row): an AI 1/2 mode, chosen by Flags3 0x0001/0x0002 plus a
   scoop. It targets the nearest AsteroidComponent, fires until it breaks,
   then steers over DebrisComponents.
   - Shared state: rock health and debris are already shared-sim state.
   - Sequence: build it after the measurement and after step 2, because
     what a miner does when full is probably "land".
4. **Piracy police, distress calls and 0x0020 nosy-ignore** (P1), **done
   2026-11-24** (P1 waves 13-14; wave 15's own-victims, 0x0020-ally and
   visit-long hostility already matched and are pinned; see the inventory
   rows). Who answers a distress call: nobody; the victim's own and
   allied warships defend it, call or no call (P1 wave 16, applied).
   (Fleet escorts defending their leader is done: P1 wave 13.)
5. **Hull AI flags** (W1, C1), **first pass done 2026-11-24** (see the
   inventory rows and "Hull AI flags and NPC cloaking: guesses to
   measure"):
   - **cheap, common:** out-of-ammo flee (278 hulls), AI afterburner:
     done;
   - **bigger:** swarm (155) and standoff (142): still open (one weak
     swarm measurement, no standoff one);
   - **NPC cloaking** (45 hulls, 6 missions): 0x0800 for traders done; the
     other bits and ShipStart 2 open.
6. **Battle assistance and hail info** (H1, plus one look at a stock
   trader's hail for InfoTypes). Both extend the existing hail dialog.
   H1's first pass is applied (a healthy player under attack is refused
   from 95-99), and wave 16's (a disabled pilot is refused, a fuelless
   one is sold a jump of fuel); wave 19 measured the ränk 0x0400 case (an
   affiliated warship refuses a healthy holder under attack: applied).
   Battle assistance itself has never been seen.
7. **Reinforcements and planet defence fleets / tribute** (R19, R18 in the
   catalogue; #353). These are large, already catalogued, and mostly about
   attacking planets. They come after the traffic behaviours above.
8. **përs traits** (grudge, Aggress, Coward, ShieldMod, weapons, pods).
   Grudges need a per-player ruling for multiplayer.
9. **Last:** hypergate/wormhole preferences, nav-default ShipStart,
   ShipBehav 2, fleet Quote and the zero-speed perimeter. Stock data barely
   uses them.

### Contraband scan: guesses to measure

The scan (N/nova_plugin/npc/contraband*.ts) follows S1/S2 and wave 14
where they measured something. Everything below not marked MEASURED is a
sensible default, marked GUESS in the code, and wants a reference run:

1. **Who scans:** any AI 4 of a govt with a non-zero ScanMask, only where
   that govt ENFORCES (owns the system, is allied with the owner, or is
   nosy: local_law.ts's enforcesHere). Measured for the owner, (wave
   14) a nosy govt in another govt's system and (wave 15) the owner's
   ally.
2. **Who is scanned:** player ships only; NPCs and the player's escorts
   are never scanned. A pilot who is already a criminal here is attacked,
   not scanned (B:977-980).
3. **Seek range 3000 px, scan range 150 px,** the approach at top speed,
   the scan instant. Measured: "within about 3 s", "a cutter beside the
   player".
4. **Rescans:** MEASURED (waves 14-15, applied): the marker remembers
   what its scan found; a ship is scanned again on the same visit only
   when it carries contraband that scan did not find (wave 15: rescanned
   at takeoff with newly bought jünk and an illegal 0x0020 mission; wave
   14: not rescanned with nothing new), and a new arrival by jump starts
   afresh. Still guesses: a hull bought at the port keeps the marker;
   contraband gained in space (plunder) counts as new too; a second
   scanning govt with another ScanMask scans for what the first did not
   find. Wave 15 saw no scan in 33 s after a jump out and back where wave
   14 saw one within 10 s; NovaJS keeps the crossing reset.
5. **ScanFine 0 and -N:** MEASURED (wave 14, applied): both are the
   detection line without its fine sentence and no money; SmugPenalty is
   still charged. The Bible's "N% of cash" is not what 1.1.1 does.
   MEASURED (wave 16, applied): a fine above the pilot's cash takes all of
   it and no more, and the line names the whole ScanFine with a thousands
   separator ("fined 5,000 credits"). Still a guess: a pilot with no cash
   at all hears the same line.
6. **Jünk:** MEASURED (wave 14, applied): "your attempt to smuggle
   <LCName> through this system", ScanFine AND SmugPenalty.
7. **S3:** MEASURED for ScanMask 0 (wave 14): a 0x0020 mission fails
   only on a scan that finds its cargo illegal. Still guesses: a mission
   with no cargo at all is illegal while active, one with cargo only once
   it is aboard.
8. **Several finds in one scan:** MEASURED (wave 15, applied): one line,
   one fine; the line named the jünk, not the pod; a 0x0020 mission among
   the finds failed with no line of its own. Still guesses: a plain
   mission's "illegal cargo" is named over an outfit too (the line takes
   the jünk, else "illegal cargo", else the outfit); one record change;
   whether the line named the jünk because cargo outranks an outfit or
   because the pod was already found this visit (the run cannot tell);
   the "<scanner>: <pilot>, prepare to be scanned." line the original
   printed (twice) before the rescan is not implemented.
8a. **After a detection** (wave 14, applied: the scanning govt's hunters
   attack until a landing, whatever its CrimeTol): a scan that only fails
   a 0x0020 mission is no detection; never-attacks and a ränk 0x0100
   suppress the hostility as they do a criminal record.
8b. **SmugPenalty by the A14 rule** (wave 14, applied): an ALLY of the
   owner as the scanner charges its own SmugPenalty (MEASURED, wave 15:
   -50, not the owner's 70; pinned by a spec). Still a guess: a nosy
   scanner in an independent system changes no record.
9. **A clean ship** MEASURED (wave 16, applied): a cutter came to a
   clean pilot and sat on it (0-10 px) for 30+ s, and nothing was said;
   NovaJS scans every ship once a visit, clean or not, silently when
   nothing is found. MEASURED (wave 17: four of four cutters; wave 18:
   the same four sat 23-51 px off, not moving, for 8+ minutes; applied
   2026-11-24): the interceptors sit on a scanned ship for the WHOLE
   VISIT (`holdingScan`: the ship carries the scanned marker; the 30 s
   CONTRABAND_SCAN_HOLD_MS is gone), until it lands or jumps. MEASURED
   (wave 19, applied 2026-11-24): the cutter does NOT follow a ship that
   flies off (the pilot flew 2,700 px north; the cutters stayed with the
   port and none came after him in 50 s): once it has come up to the ship
   (`scanSatOn`) it moves after it at CONTRABAND_SIT_SPEED at most and
   lets go at CONTRABAND_SIT_LEASH. Still guesses: the 300 px leash; a
   cutter still on its way to a ship another one scanned keeps closing at
   any distance; a ship due a scan (a second
   pilot) and an enemy or aggressor (piracy) call a sitting cutter off; a
   passing-through AI 4 does not sit past its departure time; after a
   landing the cutters do not come back to the pilot (not due a scan);
   an interceptor arriving after the scan does not come to sit. (Wave
   14's w14_s3_clean also had both cutters parked beside a clean pilot;
   wave 11's "never approached" pilot sat 1000 px from the port.)
10. **The scanner's name** on the line is the target pane's (a përs's or
    mission ship's own name, else the ship class); the pilot's is the
    profile name.
11. **A FLEET's AI 4 escort** (a stock Heraan Firebird or Phoenix holding
    a slot on its AI 3 Aurora Cruiser; Matthew's playtest 2026-11-24,
    "trying to scan me, but he never succeeds, and he flies strangely"):
    BUG fixed 2026-11-24: FormationSystem held a 'scan' escort on station
    while the scan arm flew it at the pilot, so it never came within
    150 px and swung about near its slot all visit (one exemption list,
    npc_formation.ts `offFormationBusiness`, now serves both). GUESSES
    since: a fleet escort scans like any interceptor (peels off at top
    speed), and after the scan goes BACK TO ITS SLOT instead of sitting
    on the ship (lone cutters sat, waves 16-19; nothing measured a fleet).
    Reference run wanted: a kit flët (an AI 3 lead, two AI 4 escorts of a
    ScanMask govt) in the govt's system, a clean pilot and a pod pilot
    still beside the port as the fleet passes: do the escorts leave the
    formation to scan, does the lead wait or scan, and after the scan do
    the escorts sit on the pilot or rejoin the lead?

### Legal records per system: guesses to measure

The per-system records (N/nova_plugin/reputation/system_records.ts, ruling
#380) follow the A14 sections of waves 2-15 where they measured something.
Everything below is a choice the measurements did not make, marked as a
guess in the code:

1. **An independent system's share of a crime:** MEASURED for neighbours
   (R: "A14 / contraband wave 16", finding 1; applied): minus a quarter of
   the VICTIM's scaled fields, each halved twice and truncated (-76 / -49
   / -20). MEASURED too (R: "A14 wave 18", finding 2; NovaJS already
   matched): a crime IN an independent system is charged there by the
   same quarter at 0 jumps (Disab 400 + Kill 2000: -600), its owned
   neighbours by the own-victim rule (-1560 / -1014). Gövt 128 still gives
   an independent system its InitialRec and CrimeTol (Bible, Appendix II).
2. **"The owner's or an ally's ship"** counts an alliance in either
   direction (local_law.ts's alliedEitherWay); only the owner listing the
   victim's class was measured (wave 12's 340 / 341).
3. **A zero penalty field** takes the engine default (DEFAULT_*_PENALTY)
   in the owner's reward halves as well as in a victim's penalty.
4. **A negative field** scales truncated toward zero (C integer
   arithmetic); only the crime system's own +200 was measured.
5. **The spread's walk** follows the parsed sÿst links (including the
   backlinks the parser adds) and ignores sÿst Visibility: a hidden story
   variant of a system is walked like any other, and every system stacked
   on one map position (270 of 545 in stock) is that place's jump count
   away, 0 for the crime system's own twins.
6. **A disable alone and a boarding spread like a kill:** MEASURED for
   the disable (R: "A14 wave 18", finding 1; NovaJS already matched): Disab
   400 alone gave -400 at 0 jumps, -260 one jump out and -65 in the unowned
   neighbour. Still a guess for a boarding (the board loop failed).
7. **A CompReward never touches an independent system**, even with
   CompGovt 128; a PayVal or oütf ModType 21 cleaning of a govt cleans the
   systems that govt (and its allies / classmates) OWNS, never an
   independent one; ModType 21 with -1 cleans every system.
8. **chär Status1-4** set the systems a govt and its allies own, negated
   in its enemies' (the Bible's wording); independent systems keep gövt
   128's InitialRec.
9. **mïsn AvailRecord** reads the record in the system of the stellar the
   mission is offered at (Bible: "your legal record in this system").
10. **spöb MinStatus** reads the current system's record whoever owns the
    stellar (Bible: "the point on your record in the current system"); the
    stellar's own govt still decides the travel permit and the ränk 0x0200
    override.
11. **The map's Legal Status** shows the record of the system the panel
    describes: the current one (measured, wave 13) or a selected
    destination (its own record, against its own govt: MEASURED, R: "A14
    wave 18", finding 3; NovaJS already matched). The `p` screen shows the
    current system's (measured). A system with no stellar reads
    "Uninhabited System" (STR# 2002 333, white, in the Government slot)
    and nothing else: no Government, no legal line (MEASURED, "A14 wave
    18"; applied 2026-11-24 in N/spaceport/starmap_properties.ts). Still
    guesses: a system whose stellars are all uninhabited keeps its groups;
    the original's title "Selected System:" for that click (one sample;
    NovaJS keeps "Destination System:").
12. **Hails and the comm dialog** judge hostility by the current system's
    record (local_law.ts), as the AI does; the ränk and outfit / ship
    requirements read no record.
13. **A nosy scanner in an independent system** changes no record (kept
    from the contraband work; unlike a crime's spread, which does reach
    independent systems by gövt 128).
14. **Old saves** (v5 and before) seed each system from the per-govt record
    of its status govt; **imported original pilots** keep every per-system
    value that differs from what an absent entry would read.

### Shuttles and miners: guesses to measure

The shuttles (N/nova_plugin/npc/npc_shuttle.ts) and miners
(N/nova_plugin/npc/npc_mining.ts) follow N2 and N1 where they measured
something. Everything below is marked GUESS in the code and wants a
reference run:

1. ~~**A shuttle lands.**~~ **Measured (R: "Shuttles and T1 traders,
   wave 15"): it never does, and none takes off.** Shuttles now never
   leave and respawns jump in, so shuttles fill a system's traffic as on
   the original. On stock data (shïp 391-394, düdes 247-250) that takes
   minutes: see the wave-15 entry's "Applied" note for the measured fill
   times. Genesis shuttles are scattered like other traffic (GUESS).
2. **Which stellars are stops:** every stellar not owned by an enemy of
   the shuttle's govt, uninhabited and non-landable ones included
   (measured: the marker and a NEUTRAL govt's port, wave 15), but no
   hypergate or wormhole (the rigs had none). An allied govt's port counts
   (unmeasured).
3. ~~**A shuttle with one stop** goes back to it.~~ **Measured (R:
   "Shuttles wave 16"): it visits it once, about 6 s, and jumps out**
   (applied: `SHUTTLE_ONE_STOP_DWELL_MS`). **With none** (every stellar an
   enemy's) it jumps out like a trader (radar only in the original: it
   never came on screen), and a respawn jumps in. A HELD one-stop shuttle
   (system_hold.ts) goes back to its stop (GUESS).
4. **A shuttle that is attacked** flees like any AI 1 trader, which can
   end in a jump out at the rim. Neither rig had attacks. Back from a
   flight it resumes its lane.
5. ~~**The lane's two stops.**~~ **Measured (R: "Shuttles wave 16"): a
   stellar and its NEAREST neighbour**, whatever the list order or the
   player's stellar (an uneven rig, the player off the centre: every lane
   ran through the stellar nearest the others). NovaJS's guess was this
   rule: the first stop is one draw among the stops, the other end the
   stop nearest to it. Still a guess: a TIE is one more draw (the rigs'
   ties were not followed ship by ship). A lane under about 150 px stands
   still at its midpoint (measured, two of four shuttles for 10-19
   minutes); NovaJS's turn points close up within the arrival radius from
   about 170 px down and the pausing shuttle brakes to a standstill.
6. **Who mines:** AI 1 and AI 2 hulls with Flags3 0x0001 (the stock
   Asteroid Miner). An AI 4 Zephyr (Flags3 0x0001, AI 4 düdes 200/201)
   keeps the interceptor brain: N1's AI 2/3/4 variants were not run.
7. **The miner's numbers:** rocks within 3000 px, debris within 800 px,
   debris before rocks, a standoff of 0.6 of its shortest weapon reach,
   firing a fixed gun only within 0.25 rad of the rock. Which weapons
   fire: its asteroid-miner weapons (wëap Flags2 0x8000) if it has any,
   otherwise guns, beams and turrets, never guided weapons or bays.
8. ~~**How long a miner mines:** until its ordinary departure time.~~
   **Measured (R: "Stock Sol, wave 16" and "Stock traffic, wave 17"): the
   stock Asteroid Miner (shïp 379, AI 1) never left Sol or Tau Ceti in
   20+ minutes;** applied: a miner with rocks to work ignores its
   departure roll. Still a guess: why the wave-15 KIT miners (the same
   AI 1, Flags3 0x0003, scoop and Mining Blasters) were gone after 3-4
   minutes. AI type, flags and outfits did not differ; the work did (the
   kit hull flew 300 / accel 300 against the stock 135 / 36, among 16 rocks
   against Sol's 2 and Tau Ceti's 3), so NovaJS reads it as a FULL HOLD
   (9). Their departure itself was never seen (they went off the radar,
   and nothing replaced them for 9 minutes at avgShips 2, which also fits
   two miners still out in the field). To measure: one kit miner in a
   16-rock field, its hold read by boarding it or from its leaving time
   against a 10-rock and a 2-rock field.
9. **A full hold:** a scooping miner whose hold is full stops mining and
   flies the trader loop: one stop and out. Since wave 17 this is the
   only way a miner with a field to work leaves (GUESS, 8).
10. **T1, measured (wave 15):** traders park 15.2 s (median of 70; NovaJS
    15 s fixed, not drawn from the measured 12.2-17.9 s spread) at ONE port
    per visit, then jump out.
11. **AI 2 traders make one stop too** (the trader loop is shared; the
    rigs only flew AI 1). A HELD trader (system_hold.ts) goes on to another
    port instead of leaving, as before.
12. **Wave 14's Market** (1000 px out, no visit in 526 s) is unexplained:
    the uniform draw over the non-enemy ports (Port and Market there)
    would have sent about half of the traffic to it. Wants a rig with the ports at unequal
    distances.

### Traffic population: guesses to measure

R: "Stock Sol, wave 16" and "Stock traffic, wave 17" measured three stock
systems filling to exactly AvgShips (6 / 6, 4 / 4, 4 / 4, never above in
any census) and freezing there with nothing arriving. Applied: the
population target is AvgShips (N/nova_plugin/spawn/npc_spawn_plugin.ts
`populationTarget`), refilled one ship every 15 s while below it. Still
GUESSES:

1. **The refill rate** (`NPC_RESPAWN_INTERVAL_MS` 15 s): the censuses were
   minutes apart, so arrival timing below that is unmeasured.
2. **A fleet arrives whole** and can overshoot AvgShips by its escorts
   until ships leave: MEASURED (R: "Traffic wave 19": five ships of one
   fleet, and two fleets at once, with avgShips 2; NovaJS matches). Open:
   whether the target counts fleets or ships with a whole-fleet overshoot.
3. **Who else stays:** MEASURED (waves 18-19): AI 2 traders, AI 3
   warships and FLEETS all leave; the Arcturus Fed Destroyer that stayed 21
   minutes is a reinforcement fleet's (R19). **A fleet leaves whole**
   (wave 19: several whole fleets inside one 17 s burst, an escort
   outliving its lead by a few seconds): applied 2026-11-24, an escort in
   formation on a live NPC leader no longer leaves on its own roll and
   follows the leader out at its next think (N/nova_plugin/npc/
   npc_decision.ts `fleetLeaderLeaving`). GUESS: what an escort does when
   its leader is destroyed rather than gone (its own AI and roll, as
   before).

### Reinforcement fleets: guesses to measure

R: "R19 reinforcement fleets, wave 19" measured the trigger at two
strengths, the delay at two ReinfTimes, the line, the once-a-day rule for
ReinfIntrval 0 and 1, an NPC attacker and a ränk 0x0400 pilot; "...,
wave 20" measured the odds at eleven points, the delay at four
ReinfTimes, ReinfIntrval 2, an ally as the victim, the inhibitor, where
the fleet comes in, anchored and departing victims; "..., wave 21"
paired an AI 1 victim's call with its distress line and found slow AI 1
hulls never calling; "..., wave 22" found both were the shooter's
DISTANCE (a trader calls from near only) and the line a separate chance.
Applied in N/nova_plugin/spawn/reinforcements.ts (wave-20, -21 and -22
fixes 2026-11-24); what is still a GUESS there is marked below:

1. **The threshold:** MEASURED (wave 20: ten of eleven points fit, the
   player's Strength 100 / 300 against S50-S400 at 0-90% shield): the
   odds must EXCEED MaxOdds, read AFTER the hit lands, the caller's ship
   plus his flock as the enemies. Still GUESSES: the sums over the whole
   system (no range), every non-disabled NPC of the fleet govt or an ally
   as a friend. (The trader's CALL has a range: item 18.) OPEN: one call against S150 at 90% (ratio 0.72) that two
   repeats did not give; not modelled.
2. **The delay:** MEASURED (wave 20): ReinfTime / 39 s, linear, no cap
   (300 -> 7.7 s, 600 -> 15.2, 900 -> 23-25, 1800 -> 45.7-46.8; applied
   2026-11-24, replacing min(ReinfTime / 30, 24) s).
3. **ReinfIntrval above 1:** every N days after the call. MEASURED for 2
   (wave 20: day d and d + 2, not d + 1); GUESS above 2.
4. **Allies:** MEASURED (wave 20): a hit on an ALLY's ship calls the fleet
   govt's fleet, with that govt's MediumName. GUESS: either direction of
   the alliance (one measured).
5. **The cooldown in a room is a RULING, not a guess** (Matthew,
   2026-11-24): kept per pilot, per system, saved with the pilot, and
   private to each player: a call stamps only the caller (the pilot whose
   hit, or whose flock's hit, called it) with his own day, so another
   pilot can call the fleet on his own date the same day. What remains a
   CHOICE (the original is single-player, nothing to measure): while any
   pilot's fleet is pending, another pilot's hit calls nothing and stamps
   nobody (one fleet en route per system); once it is present, his hit
   calls a second fleet only if his odds still exceed MaxOdds, the
   present fleet's ships counting among the govt's friends.
6. **Escorts:** a hit by the player's flock counts as his.
7. **Hulks:** a hit on a disabled ship calls nothing.
8. **Where it comes in:** 1,800 px from the VICTIM's position at the
   call on a random bearing, heading there at the lead's top speed
   (applied 2026-11-24, replacing "around the player"). MEASURED: not
   around the player (none came within 2,750 px of a player 600+ px from
   the victim and the port); 1,770-1,960 px out on random bearings. GUESS:
   the victim rather than the system's centre (they were together in
   every run: AI 4 victims hold their station by the port), its position
   at the call rather than at the arrival, and the kinematics. To
   measure: an AI 1 victim far from the port with a short ReinfTime.
9. **Disposition:** each fleet ship takes the caller as its aggressor
   when some NPC of the govt's side still holds him (or his flock) as
   ITS aggressor; else its govt's politics decide. MEASURED for the
   hostile half (wave 20: hostile every time the victim still held the
   player as its attacker). OPEN: wave 19's neutral fleet in 1507 (no NPC
   holding the player? a calmed or begging victim), whether a neutral
   fleet ever leaves.
10. **It stays** for the visit (SystemHold 'reinforcement'); the original's
    stayed 2.5+ minutes (wave 19) and 2+ minutes firing (wave 20), until
    the player left. GUESS: for the whole visit.
11. **Not traffic:** with AvgShips 2 a new trader came in beside the
    three-ship fleet, so the fleet does not fill the population's slots.
12. **The oütf ModType 44 inhibitor:** any pilot in the system carrying
    one whose class is in the fleet govt's Class1-4 (or -1) stops every
    call. MEASURED (wave 20) for the class and -1, single-player; GUESS in
    a room: any pilot's (stock: the Transmission Jammer, oütf 441, -1).
13. **The line goes to every player in the system,** not only the caller;
    MediumName empty falls back to the govt's name.
14. **flët AppearOn is not read** for a reinforcement fleet.
15. **Anchored victims:** MEASURED (wave 20, four runs): a victim whose
    hull has Speed 0 never calls (its AI does not run). Applied
    2026-11-24; no stock hull has Speed 0.
16. **A victim that leaves:** a pending call is cancelled when the victim
    is no longer in the system at the arrival (jumped out, landed,
    destroyed or dying), the call being the victim's own. A GUESS with NO
    supporting run: wave 20's one run (an AI 1 victim jumped out 10.4 s
    after the hit, ReinfTime 600, no fleet) was reread in R: "R19
    reinforcement fleets, wave 21" as no call at all (a slow AI 1 hull,
    which never called even when it stayed 60-90 s). Kept, since it costs
    nothing while no victim leaves. The caller's day stamp stays spent
    either way. Applied 2026-11-24.
17. **The caller's distress line: NOT the call** (wave 22, finding 3:
    seven near calls by AI 1, 2 and 4 came with no line, and a far hit
    drew "We're being attacked! Someone please help us!" with no fleet;
    3 of 20 trader victims over waves 21-22 sent one). Wave 21's pairing
    (applied in e7beca08) was the distance, and is withdrawn (2026-11-24):
    the call sends no line, and the player's own victims stay silent as
    npc/distress.ts had it before. NOT MODELLED: the line's own chance
    (about 3 in 20 victims, near or far). A Flags2-0x0008 victim still
    calls (finding 5).
18. **Who calls: a trader only from near** (EXPLAINED, wave 22, finding
    1: the slow S50 that never called in wave 21 called at once from about
    150 px; the mobile S50 that always called did not from about 700, 925
    or 1,080 px, even three hits deep; calls from 40-475 px, AI 1 and 2,
    the first day). Applied 2026-11-24: an AI 1 / AI 2 victim calls only
    when the hit's responsible ship is within
    `REINFORCEMENT_TRADER_CALL_RANGE`, 600 px, a GUESS between 475 (calls)
    and 700 (does not); measuring from the responsible ship (an escort's
    own distance for its hit) is a GUESS too. AI 3 / AI 4 victims have no
    range (AI 4 called from 1,600+ px once, wave 21; AI 3 open). Speed and
    day are not factors (the old "KNOWN MISMATCH" is closed). To measure:
    a point inside 475-700 (e.g. 600), an escort's hit, an AI 3 victim.

### Hull AI flags and NPC cloaking: guesses to measure

W1 and C1 were first passes on the reference (one run each). What they
measured is applied (N/nova_plugin/npc/npc_out_of_ammo.ts,
npc_afterburner.ts, npc_cloak.ts); everything below is marked GUESS in the
code and wants a second run:

1. **0x0080, which ammo counts:** a ship leaves only when EVERY weapon it
   mounts draws from an empty outfit magazine. The Bible ("out of ammo for
   all ammo-using weapons") could also mean "all its missiles are spent,
   whatever guns it has", which would send most stock warships home after
   their last missile. To measure: the red W1 hull with a gun added.
2. **0x0080, where it goes:** it departs by the ordinary jump-out (flies
   out from the system centre and jumps). The reference ship flew
   straight off screen; whether it jumped or landed ("dock") was not seen.
3. **0x0080, when:** on its next think after the last round (about 1 s);
   the reference ship circled the player once more first. Bays never
   count as spent (a carrier's fighters are out, not gone); a ship
   protecting a player never leaves for it.
4. **0x0040, when it burns:** MEASURED (wave 18, one hull alone,
   7,651 frame pairs): the whole attack, close passes included (97-100%
   of frames boosted within 250 px), slow only at its turnarounds about
   350 px out; wave 15's slow 36 s was two magenta hulls confused. NovaJS
   burns for the whole attack: matches. The original's attack geometry
   (passes out to about 350 px and back) is not NovaJS's 250 px
   stand-off coast, a separate gap. Fleeing, travelling and patrolling
   never burn (not measured).
5. **0x0040, how much:** 1.6x top speed (measured: 5.6 vs 3.5 px a
   frame), and 1.6x acceleration (guess, as the player's afterburner
   boosts both). No fuel is burned. The player's afterburner keeps its
   unmeasured 2x (U4).
6. **0x0800, who:** AI 1/2 traders only. Warships and interceptors with
   0x0800 are never cloaked by it: the C1 hostiles fought visible, and J
   wave 6's idle neutral AI 3 Wraith-flagged target was targetable until
   fired on. Whether an idle, moving warship cloaks was not seen.
7. **0x0800, when:** cloaked while travelling, parked at a stellar and
   departing; visible for 4 s after each stay ends (fitted to the two
   sightings of 4-5 s from the port to the screen edge), and whenever it
   flees, fights, mines, has an aggressor or is disabled. A device that
   drains fuel or shield is engaged only above half of that resource.
8. **The other bits** (0x0100 burst reload, 0x0200 running away, 0x0400
   hyperspacing, 0x1000 until close, 0x2000 docking, 0x4000 when attacked)
   are not implemented: none was seen cloaking in C1 (0x4000 was not
   provoked), and J wave 6's target with all of them cloaked within 5 s of
   being fired on.
9. **0x0002 (prefers standoff), MEASURED in wave 17, applied:** the
   Tab-targeted 0x0002 hull's (white) radar blip sat still about 450 px
   from the player from 40 s to 120 s while the other hulls circled; it
   never came on screen (three runs). NovaJS: STANDOFF_HULL_DISTANCE 450,
   held within +/- 30 px at the retreat's hold speed. Still GUESSES:
   whether it fires from there (the rig's hull had short guns and the
   player was never hit by it), what it does against a moving target (it
   keeps the 450 px on the line to it here), and that a player's commanded
   escort of such a hull keeps the escort approach.
10. ~~**0x4000 (cloak when preemptively attacked), GUESS from wave 16:**
   a beamed 0x4000 ship was lost at once.~~ **Corrected by wave 17:** an
   ANCHORED 0x4000 AI 3 ship (the Wraith cloak aboard) provoked by the
   player did not cloak in 30 s: it turned hostile and fought, fully drawn
   and targetable. Wave 16's "No Target" was the player's target clearing
   when it turned hostile (the reference's reliability notes). NovaJS does
   not read 0x4000, which matches; GUESS: a MOBILE one does not cloak
   either (wave 16's ship may simply have flown off radar).

### Assistance from a neutral ship: guesses to measure

H1 waves 16 and 17 measured three pilots (record 0, record +2000, a hull of
an allied govt) against one neutral govt's traders and warships. Applied in
N/nova_plugin/reputation/hail.ts (`assistWillingness`, `fuelSaleTerms`,
`fuelSalePrice`, `lowerFuelPrice`) and encounters/hail_plugin.ts. Measured
and applied (wave 17, de713e35): the price is a per-ship base by mood
(good 1,000; neutral 2,000-3,000; bad 3,000; widened by wave 19 to two
steps a mood, capped by the pilot's cash: items 1 and 6) plus 1,000 for
every repeated ask; Lower Price counters with floor(0.75 x P / 100) x 100 or withdraws, and
always withdraws a counter; Accept takes the price on the table; warships
sell too; a +2000 record changes nothing; a disabled pilot is refused even
by an ally's ship; a ränk 0x0400 trader refuses. What is still marked GUESS
in the code:

1. **The ship's own ask:** MEASURED (R: "H1 wave 19", finding 2, 34 first
   asks over waves 17-19; applied 2026-11-24): the neutral and bad moods
   ask one of two steps, neutral 2,000-3,000, bad 3,000-4,000
   (`fuelSaleTerms`); the good mood asks 1,000 (R: "H1 / rescue leftovers,
   wave 21", finding 1: every good ask since wave 19 was 1,000, at records
   0, -8 and -9; applied 2026-11-24, dropping the even 1,000 / 2,000
   draw). OPEN: wave 18's one good 2,000 at record -5 is unexplained and
   not modelled. GUESSES: moods drawn 1 : 2 : 1 (seen 6 : 19 : 9) and the
   neutral / bad step an even draw, both from one hash of the ship's
   uuid; the original's draw (ship class? fuel needed?) is open.
2. **Which first Lower Price counters:** about 40% (5 of 13 measured), here
   a hash of ship, pilot and ask. The original's rule is open.
3. **An accepted offer counts as an ask** (the next one costs 1,000 more);
   only withdrawn offers were followed by another ask.
4. **The counter's well:** the mood line stays in the response well while
   the popup shows the countered price (the captures read the popup).
5. **How much fuel:** one jump (100), read off the fuel bar twice (0 to
   about 3% of 3000): medium confidence.
6. **The pilot's side of the price:** MEASURED (R: "H1 wave 19", finding
   1, four cash levels and 14 ships with waves 17-18; applied 2026-11-24
   as `fuelAskingBase`, replacing wave 18's "under 10,000 the lowest base,
   +1,000 below record 0"): the first ask is min(the ship's own ask,
   max(1,000, cash / 3 rounded down to 1,000)) — 7,000 credits: 2,000 from
   every mood; 10,000: bad 3,000, neutral 2,000 / 3,000; 5,000 and 300:
   1,000. NO RECORD TERM (finding 2: records -1, -5 and -9 asked a clean
   pilot's prices; finding 3: Lower Price counters there too). GUESSES:
   the divisor 3 (the data need a fraction in [0.3, 0.334) with wave
   20's 8,000 -> 2,000). MEASURED (wave 20): a bad mood asks 4,000 at a
   clean record too, so no record term there either. A good mood asks
   1,000 at a clean record (wave 21, twice): item 1.
   The 160-164 group ("Okay, since your reputation is so good.") is
   unused.
7. **Allies:** a disabled pilot is refused (measured); a fuelless pilot is
   sold fuel like by a neutral ship (unmeasured).
8. **A ränk 0x0400 warship:** MEASURED (R: "H1 wave 19", finding 4;
   applied 2026-11-24): four AI 4 warships of the affiliated govt refused
   a healthy holder under attack ("No way." / "Not a chance." / "You
   wish.", STR# 3000 95-99), as without the ränk; the dialog no longer
   drops that refusal for a ränk holder. Still a GUESS: it helps a
   DISABLED or fuelless holder for free (unmeasured); its trader refuses
   (measured).
9. **A disabled pilot with no fuel** is refused (being disabled decides).
10. **A pilot who cannot pay:** MEASURED (wave 18, one warship, 300
   credits; applied): Accept Price is NOT greyed; Accept Price and Lower
   Price answer "You can't fool me - you can't afford it." (STR# 3000
   60-64), the popup closes, nothing is taken, nobody comes, and the next
   ask names the same price. GUESS: which line of the group is a hash of
   the ship, like every other comm line; affordability is judged against
   the price on the table when the popup opened.
11. **A withdrawn seller turning hostile** (the pirate's 150-154 "Die,
   cheapskate!"): never seen in 13 withdrawals; NovaJS never does.
12. **ränk 0x0800:** MEASURED (wave 18, applied): ships of the affiliated
   govt refuel a fuelless holder for free at once ("Okay, I'm on my way.",
   no popup) and REFUSE a disabled one (three warships: "You wish." / "No
   way." / "Not a chance."). MEASURED (wave 19, finding 5; applied
   2026-11-24, `ranksGiveFreeFuel`): an ALLY of the affiliated govt
   refuels for free too ("Hold on, I'll be right there.", no price), and
   neither an ally nor the affiliated govt repairs a disabled holder.
   Still guesses: either direction of the alliance counts (alliedEitherWay,
   as wave 5's one-way alliances); a Roadside Assistance govt still
   repairs and refuels for free, with the granted line.

### Piracy police and distress calls: guesses to measure

The piracy police (N/nova_plugin/npc/piracy_police.ts) and distress calls
(N/nova_plugin/npc/distress.ts) follow P1 waves 13-15 where they measured
something. Everything below is marked GUESS in the code and wants a
reference run:

1. ~~**Watching range.**~~ **MEASURED: the whole system** (wave 16: 2500
   px; wave 17: 5000 and 9000 px, all hostile at the first hail).
   Applied: no range test.
2. **Only player-side attackers are policed:** MEASURED (wave 16: a nosy
   police in its own system flew round a raider attacking a non-enemy
   trader and never fired).
3. **Only firing counts, not boarding.** Wave 13's board drew nothing from
   non-nosy police; nosy police were not tested with a board.
4. **Every hit that provokes the victim provokes the witnesses,** stray
   player hits included.
5. ~~**Self-defence is not piracy.**~~ **MEASURED: there is no
   self-defence exemption.** A hostile's posture is no excuse (wave 16: a
   0x0004 raider standing off 500 px that had not fired), nor a hit 72 s
   old (wave 17), nor a hostile firing at the player at that very moment
   (wave 18: the Kit Pest put a bolt toward the player every 1.2 s, the
   last about 1 s before his beam, and the nosy police turned hostile).
   Applied 2026-11-24: `SELF_DEFENCE_WINDOW_MS`, `selfDefence` and NpcState
   `aggressorHitAt` are gone. Still a GUESS: a player's ESCORT has no
   exemption either (unmeasured; one rule for every player-side
   attacker, since the police evidently do not look at what the victim is
   doing).
6. **Alliances:** a one-way alliance counts (the A14 enforcement rule;
   only a two-way one was measured), and 0x0020 does not shield a victim
   from its own govt's police (the ALLY's police: measured in P1 wave 15).
7. **The police never defend against an attacker of their own or an
   allied govt** (a player's escort of that govt).
8. **Distress rate:** at most one call per ship per 8 s, the first at the
   first hit. MEASURED (wave 16, applied): a line lasts 8.0-8.2 s and the
   calls came in bursts 8.0 s apart, the next the moment the line
   cleared (wave 14's "21-25 s" was two or three lines back to back).
   Still a guess: that one ship calls every 8 s (the callers could not be
   told apart).
9. **Who calls:** AI 1 and AI 2 traders (only AI 1 was measured), under
   NPC attack (MEASURED: none in five runs with the player attacking,
   P1 wave 15, in systems with no reinforcement fleet), or on the player's
   hit when it calls a reinforcement fleet (MEASURED for AI 1, R "R19
   reinforcement fleets, wave 21"; applied 2026-11-24, see "Reinforcement
   fleets: guesses to measure" 17), never a MISSION ship (MEASURED, wave
   16, applied). Warships never call.
10. **Nobody answers** a distress call (MEASURED, wave 16). The status
    line holds every line 8 s and clears it at once (MEASURED, wave 16,
    applied; the original's take-off line, which NovaJS does not print,
    lasted about 4.5 s).
11. **Allied defenders** (wave 16, applied: an own-govt AI 3 fought the
    raider at once, an allied AI 3 joined about 20-25 s in; wave 17,
    applied: an allied AI 4 was already fighting at the first look, 10 s
    in, and destroyed the raider within two minutes). GUESSES: an allied
    AI 4 joins AT ONCE (only "within 10 s" was seen) while an allied AI 3
    waits 20 s (`alliedDefenceDelay`): one run each, so whether the two
    delays differ by rule (an interceptor watches like the police) or by
    chance is open; the own govt's AI 4s defend too (unmeasured); no range
    limit (the candidates sat 160-300 px off); a PLAYER attacking an
    own-govt ship draws only the police and the record, not the govt's
    AI 3s (unmeasured).

## Reference-Mac briefs

All of these use the existing tool chain: `kits/testkit.mjs` (a new
`wave9Resources` block), `pilot-make`, scenario JSON, and the
`analysis/` helpers (`radar_blips.mjs --tracks`, `discs.mjs`, `planet_track.mjs`
message crops, pilot diffs).

Kit constraints that shape these briefs (from `scripts/novaref/README.md`):

- `pilot-make` can write the six standard commodities but **not jünk**. A
  pilot gets contraband one of three ways: an illegal **outfit** (pilot
  `outfits`); buying a kit jünk at Kit Port inside the scenario; or extending
  `pilot_write.ts` with jünk quantities (novaparse already reads them for the
  pilot import).
- Mission cargo comes from an AvailLoc 3 mïsn offered on landing, unlocked
  by a mission bit.

Ids below are suggestions; check them against the kit's free ranges.

### S1: who gets scanned, when, and what it says

**Kit:**
- **Govt:** gövt "Kit Customs" with ScanMask 0x0001, ScanFine 500, SmugPenalty
  50, CrimeTol 10, MaxOdds 1000, no classes.
- **Interceptors:** a düde of AI 4 Kit Disc Red (trackable) of that govt.
- **Systems:** two linked systems, "Kit Scan Gate" (empty) and "Kit Scan
  Range" (owned by Kit Customs, Kit Port clone at (0,0), traffic: that düde,
  avgShips 2). Linked so the player can **arrive by jump** ("incoming
  ships").
- **Contraband:** oütf "Kit Contraband Pod" (ScanMask 0x0001, no ModType
  effect, mass 0) and jünk "Kit Contraband" (ScanMask 0x0001) sold at the
  Kit Port clone.

**Pilots:**
- clean;
- with the pod;
- record -500 in Kit Scan Range (the "already criminal" case).

**Runs** (record 120 s each; shots every 2 s; status-line crops):
1. The clean pilot jumps in from Kit Scan Gate and sits still.
2. The pod pilot does the same.
3. The pod pilot starts in Kit Scan Range beside the port (Enter Ship, no
   jump).
4. The pod pilot lands, buys nothing, takes off.
5. The pod pilot flies away at full speed as soon as an interceptor turns
   towards it.
6. The criminal pod pilot jumps in.
7. The pod pilot sits in the system for 5 minutes: does it get rescanned?

**Watch:**
- the interceptor's track relative to the player (`discs.mjs`): range, a
  pass or a hold alongside, the time from arrival to scan;
- every status line, in order (match against STR# 2002 373-389);
- credits and the Kit Scan Range record (pilot diff);
- whether the interceptor's brackets turn red, and whether it fires;
- whether the clean pilot is scanned at all, and what it is told.

### S2: what a scan does to mission cargo and SmugPenalty

**Kit:** on top of S1, two AvailLoc 3 mïsn at the Kit Port clone, unlocked
by bits. Both carry 1 ton of cargo to Kit Market with ScanMask 0x0001.
- Mission A has Flags 0x0020.
- Mission B does not.
- Give both a CompGovt/CompReward, so a failure's record hit shows.

**Runs:** accept each, take off, wait for a scan.

**Watch:**
- the failure message (STR# 2002 #285);
- the mission state after landing;
- every govt's record in the pilot diff (SmugPenalty: which govt, which
  system);
- whether ScanFine 500 is charged on top.

**Repeat with ScanFine 0** (the stock value): warning only?

### S3: does any scan fail a 0x0020 mission?

**Kit:** S2's mission A, with the scanner govt's ScanMask set to 0x0002, so
it does not match the cargo's 0x0001.

**Watch:** whether the interceptor still buzzes the player, and whether the
mission fails.

**Also:** run once with the illegal pod and a matching jünk. Does the
message name the item ("your possession of" vs "your attempt to smuggle")?

### I1: what an idle interceptor does

**Run:** with no contraband and no enemies, track the S1 interceptors for
300 s.

**Watch:**
- whether they sit still near the stellar ("parks in orbit") or circle;
- the distance from the stellar;
- whether they ever land or jump out.

This is the S1 clean run, extended. NovaJS today circles at 400 px and,
since wave 16's stock Sol (three AI 4 for 21+ minutes), never leaves.

### T1: the life cycle of ordinary traffic

**Kit:** Kit Traffic Range (sÿst 2000, AI 1 disc traffic, Traffic Port and
Traffic Market) with avgShips raised to 6. Add one uninhabited marker and
one stellar of a govt hostile to the traders.

**Runs:** two of 600 s each, the player parked between the stellars (the
radar covers both).

**Watch** (`radar_blips.mjs --tracks`):
- per ship: does it arrive by jump-in or by take-off from a stellar?
- the landed duration (from the blip vanishing on a stellar to one
  appearing there);
- the stops alongside without landing (wave 5's ~20 s);
- whether the hostile or uninhabited stellar is ever visited;
- the total time in the system, and how it leaves.

### N2: in-system shuttles

**Kit:** T1's system, with traffic of an AI 1 trackable disc hull that has
Flags3 0x0002 and no scoop. **Control:** the same düde without the flag.

**Run:** 600 s, twice.

**Watch:**
- whether shuttles ever jump out;
- which stellars they use: own govt, the hostile stellar, the uninhabited
  marker;
- whether they land or only stop alongside.

**Optionally:** a stock check in Nesre Secundus (sÿst 133: Pyrogenesis and
Sigma shuttles, 20% + 10% of 5 ships) with a stock pilot sitting there.

### N1: does the Asteroid Miner mine?

**Kit:** "Kit Mine Range" (Kit Rock Range clone, Asteroids 16, AstTypes
metal only) with traffic of a trackable copy of shïp 379:
- Flags3 0x0003;
- DefaultItems the stock Asteroid Scoop (oütf 271) and its stock gun;
- one düde for each of AI 1, AI 2 and AI 3.

Add a variant hull with Flags3 0x0001 only, in an AI 4 düde (the Zephyr
case).

**Runs:** 300 s per variant, the player parked and passive.

**Watch:**
- whether the miner turns towards rocks and fires at them (trail pictures,
  the rock count);
- whether it steers over the resource boxes;
- how long it stays, and whether it lands, jumps, or keeps mining;
- whether the 0x0001-only interceptor shoots rocks while idle.

**Optionally:** a stock look, with a pilot parked in a system that lists
düde 132 (Archenar, sÿst 142: 32% of 2 ships).

### P1: piracy police, distress calls, nosy-ignore, escorts defending a leader

**Kit:**
- **Police:** an AI 4 trackable disc of a neutral govt A.
- **Victims:** AI 1 traders of govt B, no relations with A. A variant B'
  sets gövt 0x0020; another variant sets Flags2 0x0008.
- **Raiders:** AI 3 of govt C, an enemy of B only (B and C share an enemy
  class).
- **A fleet:** a flët lead with two escorts, of govt B.

**Runs:**
1. **The player shoots a trader** with the Kit Tickler, the interceptor at
   300 / 1000 / 2500 px.
2. **The player disables and boards a trader** (a disableable hull) while
   the interceptor watches.
3. **Raiders attack traders** while the player only watches.
4. Run 1 with **B'** (0x0020).
5. Run 1 with **0x0008** (no distress).
6. **The player tickles the fleet lead** and watches its escorts.

**Watch:**
- the interceptor's reaction: red brackets, attack, distance;
- the player's records with A and B (pilot diff);
- any distress line (STR# 5003), who sends it and how often;
- whether any other ship (B warships, A interceptors) comes to help;
- the escorts' reaction to an attack on their lead.

### W1: hull AI flags

**Kit:** hostile (gövt 0x0004) AI 3 trackable discs, each with one flag.

**Variants:**
- **(a)** Flags2 0x0080 with only an ammo-limited missile (5 rounds);
- **(b)** Flags2 0x0001, a group of four (swarm);
- **(c)** Flags2 0x0002 (standoff), against a control without it;
- **(d)** shïp Flags 0x0040 plus an afterburner outfit.

**The player:** Kit Lancer Heavy, passive.

**Watch:**
- **(a):** what happens when the ammo is gone: flee, jump, or fly to the
  stellar and land ("dock")?
- **(b, c):** the attack geometry (`discs.mjs`: range distribution, passes
  vs circling);
- **(d):** speed spikes and when they happen.

### C1: NPC cloaking

**Kit:** the working stock-cloak target from J wave 6 (Cloak Target W,
shïp 798: stock Wraith Cloaking Device oütf 266). Make one copy per Flags2
cloak bit: 0x0100, 0x0200, 0x0400, 0x0800, 0x1000, 0x2000, 0x4000. Put the
0x1000 copy on an AI 3 hostile, so it has a target to close on. Add one
mïsn with ShipStart 2.

**Watch:**
- the target panel and radar for when each copy cloaks and uncloaks;
- for 0x1000, the distance at which it uncloaks;
- for ShipStart 2, whether the ship is cloaked from the first frame.

### H1: battle assistance

**Kit:** gövt 362 raiders attacking the player beside a neutral AI 3 warship
and a neutral AI 1 trader (Kit Range).

**Runs:** hail each and press Request Assistance.

**Watch:**
- the answer line (STR# 3000 75-89 / 145-149 / 180-184);
- whether the warship then attacks the raiders or only comes alongside;
- what it restores.

**Repeat** with a ränk 0x0400 for the warship's govt, granted by a mission
bit: does it call reinforcements?

## Notes for whoever implements these

- Everything in the Bible's NPC model is per government and per AI type.
  Scanning, police and distress all need to know **who is near whom**, so
  they can share one per-tick spatial pass (in sim, deterministic, uuid
  tie-breaks), not one query each.
- Consequences land on a **player** (fine, record, mission failure). In
  multiplayer they must go to the scanned player's own components and
  records, the same way NPC plunder takes credits from the plundered player
  only (N/nova_plugin/npc/npc_plunder_board.ts:51-62).
- Every number the measurements leave open should be a named constant
  marked as a guess, as npc_retreat.ts does.
