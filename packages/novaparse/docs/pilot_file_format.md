# EV Nova pilot (saved-game) file format

Parsed by `src/pilot/` (`readPilot`, `parsePilotResources`, `parsePltPilot`,
`simpleCrypt`). This note summarizes the format and where our knowledge of it
comes from.

## Sources

- **Byte layout authority:** "EV Nova Pilot File Format"
  (<https://andrews05.github.io/evstuff/guides/pilotformat.txt>), the EV
  community's reverse-engineered field map. All absolute offsets in the
  parser comments come from it.
- **Cross-check:** vasi's evnova-utils pilot reader
  (<https://github.com/vasi/evnova-utils>,
  `Scripts/lib/Nova/Old/pilot/read.pl`) — same layout, and the source of the
  SimpleCrypt key-schedule details, the classic/override resource types
  (`MpïL`/`OpïL`, key 0xABCD1234), and the .plt padding differences.
- Background: the OpenNova blog's NpïL writeup
  (<https://opennovablog.wordpress.com/2019/05/27/player-data-the-npil-resource/>).
- Verified against real saves: the stock scenario pilots in
  `/Applications/EV Nova/Scenarios/Pilots` (Mac resource forks) and
  Windows-format `.plt` saves in `/Applications/EV Nova/Pilots`.

## Containers

A Nova pilot is two encrypted blobs plus the ship name:

| | Mac pilot | Windows `.plt` |
|---|---|---|
| container | resource fork | flat data-fork file |
| player blob | `NpïL` id 128, name "Pilot Data", 59826 bytes | 59730 bytes (see below) |
| globals blob | `NpïL` id 129, 26366 bytes | 26366 bytes |
| ship name | the *name* of resource 129 | trailing NUL-terminated string |
| field endianness | big | little |

The `.plt` layout is `[uint32le size][player blob][uint32le size][globals
blob][ship name NUL]`; the size prefixes and ship name are **not**
encrypted. Each `.plt` MissionData drops three unused Mac padding runs
(2 + 1 + 3 bytes), making it 2278 bytes instead of 2284; 16 missions × 6
bytes = the 96-byte difference in the player blob.

EV Classic / Override pilots use `MpïL` / `OpïL` resources with different
table sizes and key 0xABCD1234; the parser rejects them explicitly.

## Encryption

Andrew Welch's **SimpleCrypt**, seed `0xB36A210F`, applied per blob
(the key stream restarts for each resource). Over big-endian 32-bit words:

```
word ^= key
if (key >= 0x21524110) key -= 0x21524111  // == carry-free key += 0xDEADBEEF
else                   key += 0xDEADBEEF
key ^= 0xDEADBEEF
```

A trailing partial word (both blobs are 2 bytes past a word boundary) is
XORed with the leading bytes of the final key. The transform is a pure XOR
stream, so the same function encrypts and decrypts.

Verification: encrypting zeros yields the key stream
`b36a210f 4cba6111 f5c5...`, and those exact words appear verbatim in real
pilot files wherever the plaintext is zero (e.g. empty cargo slots near the
start of NpïL 128). Decrypted saves show sane dates (Nova starts in 1177),
`" NC"` date suffixes, valid stock ship/mission ids, and readable strings.

## Field map

Indexes throughout are `resourceId - 128` (e.g. `exploration[i]` is sÿst
`128 + i`; a pilot flying shïp 332 stores `shipClass = 204`). Verified
empirically: mission slots store the mïsn *index* too.

**NpïL 128 — PlayerFileDataStruct** (offsets are Mac): lastStellar (0x0),
shipClass (0x2), cargo[6] (0x4), unused shield (0x10), fuel (0x12),
month/day/year (0x14), exploration[2048] (0x1a; 1 = visited, 2 = landed),
outfitCount[512] (0x101a), legalStatus[2048] (0x141a), weapCount[256]
(0x241a), ammo[256] (0x261a), cash (0x281a), MissionObjectives[16] (0x281e),
MissionData[16] (0x295e), missionBit[10000] (0xb81e), stelDominated[2048]
(0xdf2e), escortClass[64] (0xe72e; -1 empty, 0-767 captured, 1000-1767
hired), fighterClass[64] (0xe7ae), escortUpgrade[64] (0xe82e),
escortSale[64] (0xe8ae), escortVoiceMode[64] (0xe92e), rating (0xe9ae).

**NpïL 129 — AltPlayerFileDataStruct**: versionInfo (0x0; 300 in 1.0.10 and
1.1.1 saves), strictPlayFlag, gender, stelShipCount[2048] (0x6),
personAlive[1024] (0x1006), personGrudge[1024] (0x1806), unused[64]
(0x2006), stelAnnoyance[2048] (0x2086), seenIntroScreen (0x3086),
unknown byte (0x3087), disasterTime[256] (0x3088), disasterStellar[256]
(0x3288), junkQty[128] (0x3488), priceFlux[2][2] (0x3588),
cronDuration[512] (0x3590), cronHoldOff[512] (0x3990),
reinforcements[2048] (0x3d90), stelDestroyed[2048] (0x4d90),
escortOrders[4] (0x5d90), nickname (0x5d98, pascal, cap 63),
shipColor RGB (0x5dd8, each 0-32), rankActive[128] (0x5dde),
datePrefix/dateSuffix (0x5ede/0x5eee, C strings, cap 16),
unknown[1024] (0x5efe).

### Unknowns / raw regions

Kept as documented raw fields rather than interpreted:
`PilotMissionData.unknownShorts` (64 shorts per mission at MissionData
+0x869), `PilotGlobalsData.rawUnused0x2006`, `unknown0x3087`, and
`rawUnknownTail` (0x5efe, zero in every observed save). Fields the doc
marks unused (shield, MissionData availability/requireBits, etc.) are
skipped or exposed as `unused*`.

### Format quirks observed in real saves

- Scenario pilots saved while a plug-in set was active can reference
  plugin-only resources: the stock Auroran and Pirate scenario pilots store
  `lastStellar = 1872` (spöb 2000), which does not exist in the stock data.
- A pilot from the "EV Classic for Nova" scenario has dateSuffix `" AD"` —
  scenario chär data flows into the save, so don't validate against stock
  strings.

## Import (packages/nova)

Implemented: `packages/nova/src/title/original_pilot_import.ts` maps
`PilotData` onto `SaveData` (ship, outfits, credits, date, last stellar ->
system, control bits, ranks, combat rating, cargo/jünk, per-system legal
status -> per-gövt records, active missions without special ships) and the
title screen's Open Pilot import sniffs binary vs JSON. In a browser only
the DATA FORK is readable: Windows `.plt` files import directly; a Mac pilot
must have its resource fork copied out first (`cp "Pilot/..namedfork/rsrc"
Pilot.rsrc`) — `parsePilotBytes` handles both. `readPilot` (disk +
resource fork, node only) lives in `pilot_read.ts`; the parser itself is
browser-safe. The notes below describe the mapping.

## Import hook (original design note)

`readPilot(path): Promise<PilotData>` is exported from the `novaparse`
entry point. A future "import pilot file" feature in packages/nova would map
`PilotData` onto `src/nova_plugin/save_game.ts`'s `SaveData`:

- `player.shipClass + 128` → `SaveData.ship` (`"nova:NNN"`),
- `player.outfitCount` (index + 128, nonzero counts) → `SaveData.outfits`,
- the sÿst containing spöb `player.lastStellar + 128` → `SaveData.system`,
- `player.cash` → `credits`, `player.missionBits` → `novaControlBits`,
- `player.legalStatus` / `player.rating` → `reputations` / `combatRatings`.

Browser use supplies file bytes directly (`parsePilotBytes`, which
auto-detects .plt vs resource-fork data): `readPilot` itself reads from
disk (and macOS resource forks) via node's `fs`.
