import { isLeft } from "fp-ts/lib/Either.js";
import * as t from 'io-ts';
import { formatIoTsErrors } from "nova_ecs/plugins/serializer_plugin";
import { WireWorldSnapshot, WireWorldSnapshotType } from "nova_ecs/plugins/snapshot_plugin";
import { warnThrottled } from "../common/log_throttle.js";
import { InputRecord, InputRecordType, WireTick } from "./simulation_input.js";

export { InputRecord } from "./simulation_input.js";

/** A wire snapshot of the room's state at a tick: the starting point
 * for reconstruction, in place of replaying from genesis. */
export interface ArchiveBaseline {
    tick: number;
    snapshot: WireWorldSnapshot;
}

/**
 * Peers hash their world every this many ticks for desync detection.
 * The server's archive sim hashes the same ticks, so it can vote.
 */
export const STATE_HASH_INTERVAL = 60;

/**
 * Bumped whenever the rollback protocol or the simulation's
 * determinism-relevant behavior changes. A peer joining with a
 * different version (or none — a build predating versioning, e.g. a
 * browser serving a stale cached bundle against a new server) WILL
 * desync no matter how healthy the netcode is; the relay logs the
 * mismatch and incident records carry every reporter's version, so
 * "stale client build" stops masquerading as a netcode mystery.
 *
 * NOT the same thing as the BUILD version, and not the enforcement
 * point. This is a hand-maintained number describing the wire protocol,
 * and it is only read after a peer has already joined. The stale-cached-
 * bundle case it describes is now caught earlier and automatically, by
 * the build-version handshake in src/common/version_handshake.ts: the
 * server refuses any client whose build stamp differs from its own, so
 * such a client never reaches this code. Keep bumping this when the
 * protocol changes -- it remains the label on incident records -- but
 * rely on the handshake, not on this, to keep builds from mixing.
 */
// 3: escortAction input (release / sell / upgrade an escort).
// 4: escortAction's sell/upgrade became DEFERRED — the immediate
//    'sellEscort' / 'upgradeEscort' kinds were replaced by the queue
//    toggles 'queueSale' / 'cancelSale' / 'queueUpgrade' / 'cancelUpgrade'
//    (nova_plugin/escorts/escort_action.ts), and PlayerEscort gained the
//    pendingUpgrade / pendingSale fields the toggles write.
// 5: the trust model (the "Trust model" section below). Validation,
//    membership, server-only acceptance and sim-side AUTHORISATION of
//    entity-level inputs. The last is determinism-relevant — a v4 peer
//    applies a forged removeEntity that a v5 peer drops — hence the
//    bump; the wire SHAPES are unchanged.
//    Also under 5, no further bump (both composed with it in the same
//    wave, and both are additive on the shapes the strict codecs accept):
//    - acceptMission's `accepted` gained the OPTIONAL missionsStarted /
//      missionsEnded / recordsDelta fields (nova_plugin/missions/mission_accept.ts;
//      an older record simply carries none of them), and
//    - wire snapshots carry the `$negzero` / `$nonfinite` sentinels
//      (nova_ecs snapshot_plugin toJsonSafe) so a joiner restores the
//      exact -0 / NaN bits the room holds, which hashWorld now
//      distinguishes from +0 / finite — a desync report between peers
//      that differ only there is real, not a hash artifact.
// 6: collision geometry (ruling #207): sprite frames with fewer than four
//    opaque pixels get a real convex hull (a point, a segment or a
//    counterclockwise triangle) instead of the sorted pixel list; the
//    hashed hulls of 81 stock frames changed (novaparse
//    sprite_sheet_multi_parse's makeConvexHull; the stock digest in
//    sprite_sheet_stock_identity_test was rebaselined). Also under 6, no
//    further bump: BoardingState's `capture` lost the 'refused' literal
//    (#250), a value only ever carried inside a session.
// 7: the wire is Avro BINARY (wire_codec.ts, avro_binary.ts): every
//    socket frame is the derived schema's encoding of the typed
//    envelope (wire_schemas.ts WireMessageType), never JSON text — a
//    text frame is refused with close code 1003. joinRequest gained the
//    OPTIONAL `schema` (the wire schema's CRC-64-AVRO fingerprint; a
//    relay answers a mismatch with the new `joinRefused` kind). And the
//    seven game-data components (ShipData, PlanetData, ProjectileData,
//    BeamData, ExplosionData, AnimationComponent — as references to the
//    peer's own game data — and BeamState, as its real shape) changed
//    their ENCODED form (nova_plugin/core/game_data_ref.ts), which every
//    input record, baseline and state hash carries.
//    Also under 7, no further bump: acceptMission's `mission`,
//    `missionsStarted[][1]` and `ships[].entity` are TYPED on the Avro
//    wire (#269: EncodedActiveMissionType / EncodedEntity in
//    nova_plugin/missions/mission_accept.ts). They are the encoded forms
//    the record already carried, so the JSON form — what room archives,
//    desync dumps and older records hold — is unchanged, and the codec
//    now refuses only what applyAcceptMission's own decode dropped. The
//    derived schema, and with it the joinRequest fingerprint the relay
//    compares, changes; that gate is what keeps the two layouts apart.
//    Also under 7, no further bump: the component lists of a wire
//    snapshot (catchUp baselines, desync dumps) and of an addEntity
//    record are typed by the world-independent registry (#268,
//    wire_snapshot_components.ts) — a change to the SCHEMA, which the
//    fingerprint gate above identifies and refuses across builds on
//    its own; the message kinds, the persisted forms (room archives,
//    desync dumps on disk) and the encoded component forms are
//    unchanged. Since 7, every component codec is part of the schema,
//    so the fingerprint — not this number — is the wire format's
//    identity; this number moves for semantic protocol changes.
//    Also under 7, no further bump: ExplosionData left the registry
//    (ruling #272 — explosions are display-only sound and graphics; no
//    simulation entity ever carried the component, so no record,
//    baseline, dump or archive ever held one) and the AnimationRef
//    owner enum lost `explosion` with it. A schema change the
//    fingerprint gate identifies; no message kind, persisted form or
//    encoded component form is affected.
//    Also under 7, no further bump (maintainer's standing ruling for
//    schema-only changes): the `refundFighter` input kind (#258, a lost
//    bay fighter's round back to its carrier's bay —
//    nova_plugin/escorts/bay_plugin.ts applyRefundFighter). A new union
//    member of SimulationInputType, so the fingerprint changes and the
//    join gate keeps the two builds apart; every existing kind is
//    unchanged.
// 8: three protocol changes landed together (the "protocol 8" wave), so
//    a v7 and a v8 build never share a room:
//    - #199: the communicator uuid frame — the server's first frame to a
//      connecting client — carries the server's own uuid set (`servers`);
//      the client takes communicator.servers from it instead of the
//      constant 'server', and accepts no server-only traffic (Trust model
//      item 4) until it arrives. A v7 server's uuid frame lacks the
//      field, so a v8 client would never learn a server.
//    - #155: joinRequest gained the OPTIONAL `systems` — the joiner's
//      system-order hash (communication/system_order.ts systemOrderHash:
//      CRC-64-AVRO of its simulation world's JSON-encoded systemNames).
//      The relay remembers the room's FIRST declaration (forgotten when
//      the room empties) and answers a different one with the new
//      `joinWarning` kind (server -> peer, before the catchUp; the peer
//      logs it and joins anyway — the schema fingerprint stays the only
//      refusal). Desync incidents (DesyncInfo, desync.json) carry
//      roomSystemOrder and each reporter's peerSystemOrders, so a record
//      shows whether the peers ran the same system order.
//    - #241: PlayerEscort's queued deal is its own encoded state — the
//      pendingUpgrade / pendingSale flag pair was replaced by a REQUIRED
//      `deal` field, the discriminated union EscortDeal (none |
//      upgrade(toShip) | sale; nova_plugin/player/player_escort.ts),
//      typed on the Avro wire as a kindUnion through the component
//      registry. The marker's encoded shape, the wire schema fingerprint
//      and the desync hash input all change; a v7 peer cannot decode a
//      v8 marker. The pilot save moved to version 4 alongside
//      (save_migrations.ts v3 -> v4 rewrites each saved escort's marker).
//    (#188, the Map codec, changed nothing on the wire: Map entries
//    already encode byte-identically to an Avro map, and the object form
//    would lose insertion order — see nova_ecs datatypes/map.ts.)
//    Also under 8, no further bump: the NpcSpawner component's codec
//    gained OPTIONAL fields (#140, nova_plugin/spawn/spawn_bits.ts). They
//    are `appearOn` on a düde ship class and on a fleet entry,
//    `roamingShare` on a roaming-fleet entry, and `activeOn` / `evenShare`
//    on a përs entry, all present only on tables some NCB test gates on a
//    control bit. On the spawner itself they are `spawnBits` (the room's
//    spawn bits: the first entrant's control bits restricted to those the
//    tables read, latched once by NpcRespawnSystem) and `avgShips` (gated
//    tables only). The wire schema fingerprint changes, and so does the
//    desync-hash input of a gated system once an entrant arrives. No
//    message kind, input kind or persisted pilot form changes. An older
//    snapshot decodes as an ungated, unlatched spawner.
//    Also under 8, no further bump: a hail to ANOTHER PLAYER's ship is a
//    message, never a ship action (#332, nova_plugin/encounters/
//    hail_plugin.ts). HailActionType (the `hail` input's action) gained
//    the `message` branch ({ kind: 'message', target, message }), whose
//    `message` is the pressed button's id (PlayerHailMessage: greetings
//    | assistance | mercy), never free text. It is recorded as the new
//    synced component
//    SentHail ({ to, message, seq, at }) on the SENDER's own ship —
//    serializer- and delta-registered, typed on the Avro wire through the
//    component registry — and the recipient's client prints it once per
//    seq on its status line. The wire schema fingerprint and the
//    desync-hash input of a world holding a SentHail change. No message
//    kind or input kind is added and no persisted pilot form changes; the
//    older hail actions encode as before.
//    (#333's SimulationFrame.resyncFailed rides the worker-to-display
//    bridge only; it is not on the wire.)
//    Also under 8, no further bump: a fresh population per room instance
//    (#140, second ruling; nova_plugin/spawn/spawn_bits.ts). The input
//    union gained the server-authored `roomSeed` ({ kind: 'roomSeed',
//    seed }, seed a 32-bit unsigned integer, an Avro long), which the
//    relay logs as a room's first record (tick 1) when the server opens
//    the room. Applying it reseeds the world's Random, removes the genesis
//    population and marks the NpcSpawner with the new optional
//    `awaitingEntrant`; the first entrant's tick then latches the spawn
//    bits and spawns the initial population under them (setting
//    `avgShips` on every seeded spawner, not only gated ones). It is
//    accepted only from a server uuid or a record with no peerId. The
//    wire schema fingerprint changes, and so does the desync-hash input
//    of every seeded room. No message kind, handshake field or persisted
//    pilot form changes. A world no seed reaches (an unseeded relay,
//    offline play) is byte-identical to before.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the `inputRefused` kind (#354, server -> peer):
//    the archive reports each insertion the room refused for ownership or
//    identity, once, to the peer that sent it, which re-stamps its fleet
//    and re-enters instead of desyncing forever. A new union member, so
//    the fingerprint changes and the join gate keeps the two builds apart.
//    In the same change `removePeer` removes everything the departed peer
//    OWNED (MultiplayerData.owner), not only what it controlled — what
//    this file's Trust model and the client's comments always said it
//    did; builds are version-gated, so no mixed room applies both rules.
//    (Narrowed by the next paragraph: the fleet only, the rest disowned.)
//    Also under 8, no further bump (the same standing ruling; #354's second
//    lane): the RECONNECT TOKEN — the communicator uuid frame gained a
//    REQUIRED `token` (a 256-bit CSPRNG bearer secret per connection), and
//    the communicator envelope a new `reconnect` kind (client -> server,
//    its previous connection's token, honoured only as a connection's
//    first frame) with which a reconnecting client has the server retire
//    its half-open old connection at once instead of after the keepalive
//    (Trust model item 6). catchUp gained the OPTIONAL `timeline` (the
//    relay's log identity, rollback_relay.ts). MissionShipComponent gained
//    the OPTIONAL `ownerDisconnected`. And removePeer changed again, by the
//    maintainer's ruling: it removes the departed peer's player ship and
//    ESCORTS (hired, captured, and their and the player's bay fighters)
//    and DISOWNS everything else it owned — MultiplayerData cleared, the
//    ship an ordinary world ship; its mission ships flagged
//    ownerDisconnected so the owner-absence despawn keeps them
//    (communication/peer_departure.ts). Schema and sim-rule changes only;
//    the fingerprint moves, and builds stay version-gated.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): #141's in-flight change of ship. The new
//    `refuseMission` input kind (a ship-offered mission's OnRefuse,
//    resolved on the owning client: mission_accept.ts RefusedMissionType)
//    and two OPTIONAL fields on both it and acceptMission's `accepted` —
//    `shipChange` {shipId} (Cxxx/Exxx/Hxxx: the hull is replaced at the
//    player's uuid, nova_plugin/missions/mission_ship_change.ts) and
//    `moveToSystem` {systemId, keepCoordinates} (Mxxx/Nxxx: the ship
//    leaves the system and the client follows, MissionSystemMoveEvent).
//    New union member and fields, so the fingerprint changes and the
//    join gate keeps the builds apart; every existing kind and field is
//    unchanged, and an older record (none of the new fields) applies
//    exactly as before.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): #371's per-room 2x clock speed vote. Two new
//    non-simulation control message kinds — `speedVote` (peer -> server:
//    Caps Lock state and whether the peer is in space) and `roomSpeed`
//    (server -> peers: the room's clock multiplier 1 | 2, the tick
//    boundary `atTick` at which it takes effect, the relay's current
//    `tick`, and the in-space voter tallies `fastVotes` / `totalVoters`)
//    — plus an OPTIONAL `speedVote` field on `joinRequest` (so a joiner
//    with Caps Lock already on votes yes atomically with its join and
//    never momentarily drops a 2x room to 1x) and an OPTIONAL `roomSpeed`
//    field on `catchUp` (so joiners learn the room's pace atomically with
//    its tick). Speed lives strictly in the room clock (`rollback_relay.ts`
//    / `room_clock.ts`), never in simulation state; no input kind,
//    component codec, desync hash input or persisted pilot form changes
//    (the client-local `toggleFpsMeter` control action added for R4 also
//    extends the `ControlAction` enum derived into `ControlEventType`,
//    moving the schema fingerprint while never crossing the wire).
//    The derived wire schema fingerprint changes, and the join gate keeps
//    older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): an OPTIONAL `hurtsFirer` field on the
//    FiringGroup component (ship/firing_group.ts), written only when
//    BLAST_FLOCK_RULE is 'flockAlwaysSpared'. Under the default rule it is
//    never set, so every existing component and hash input is unchanged.
//    The derived wire schema fingerprint changes, and the join gate keeps
//    older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the escort command panel (`e`). Four new
//    unbound control actions, the escort-order category selectors
//    (`escortSelectFighters` / `Medium` / `Warships` / `Freighters`,
//    player/escort_command.ts ESCORT_CATEGORY_SELECTORS), extend the
//    `ControlAction` enum derived into `ControlEventType`. An order whose
//    input record carries one selector's 'start' edge reaches only that
//    category's escorts (EscortCommandInputSystem); a record without one
//    applies exactly as before. Sim-rule change alongside: `attack` with
//    no player target now sets the order (no victim; the escort keeps
//    formation) instead of being ignored. No component codec or hash
//    input changes. The derived wire schema fingerprint changes, and the
//    join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): missile jamming matches the original (J-series
//    wave 3). A new serializer-registered component, JamDecision
//    (`{steer: 'track' | 'flyStraight' | 'veerAway'}`, combat/
//    jamming_plugin.ts), holds each guided missile's one jam decision,
//    made the tick it launches and permanent. It joins the wire snapshot
//    component registry and the desync hash input; the old per-frame
//    JamSteer component (snapshot 'skip', wire-derived, never on the
//    wire) is gone. Sim-rule changes alongside: the jam roll, a ship's
//    jamming is its largest single jammer outfit per type (not the sum),
//    and gövt InhJam no longer adds to it. No input kind or message kind
//    changes. The derived wire schema fingerprint changes, and the join
//    gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the gövt 0x0010 retreat (npc/npc_retreat.ts,
//    reference A-series wave 4). Three OPTIONAL NpcComponent fields:
//    `damageLoad` / `damageLoadAt` (a leaky bucket of recent damage, kept
//    only on AI 3 ships of a flagged govt and dropped once drained) and
//    `retreatSince` (when such a ship started losing). Ships of every
//    other govt never carry them, so their components and hash inputs
//    are unchanged. Sim-rule change alongside: a flagged warship under
//    25% shield retreats only while losing (heavy fire or bad odds),
//    standing off before it jumps out. No input kind or message kind
//    changes. The derived wire schema fingerprint changes, and the join
//    gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): an OPTIONAL `passingThrough` NpcComponent
//    field, set at spawn on a mïsn special ship with ShipGoal -1,
//    ShipBehav -1 and AI 1 (missions/mission_ship_spawn.ts). Its first
//    think rolls the departure in 30-40 s instead of 120-300 s (still one
//    PRNG draw, so no other ship's rolls shift) and it departs the moment
//    that is due, mid-trip or mid-dwell (reference A-series wave 4). No
//    other ship carries the field. The derived wire schema fingerprint
//    changes, and the join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): sensor interference (reference J-series wave
//    5). JamDecision's `steer` gains two values, `circleClockwise` and
//    `circleCounterclockwise` (combat/jamming_plugin.ts): a Seeker 0x0008
//    missile confused by sÿst Interference at launch turns at its full
//    rate in one direction for life. Sim-rule changes alongside: the
//    interference decision is its own roll, not gated by JamVuln
//    (P = 0.0068 x Interference), and no longer adds to radar jamming;
//    every jam decision now draws six numbers instead of five. No input
//    kind or message kind changes. The derived wire schema fingerprint
//    changes, and the join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the gövt 0x0010 jump-or-stay draw and the AI 2
//    "out of range" flight (reference A wave 7). Two OPTIONAL NpcComponent
//    fields: `retreatJump` (npc/npc_retreat.ts: one PRNG draw the first
//    time a flagged warship is losing under 25% shield, kept until its
//    shield is back at 25%) and `reachedAggressor` (npc/npc_decision.ts:
//    a brave trader's aggressor once it has been within the trader's
//    longest weapon reach). One OPTIONAL WeaponState field, `reach`
//    (ship/weapons_state.ts: the weapon's reach in px, copied from its
//    data when the state derives; absent for bays), so every armed
//    ship's WeaponsState hash input changes. Sim-rule changes alongside:
//    the 16 s stand-off-then-jump timer is gone (a flagged warship that
//    draws "stay" never jumps for it), and an AI 2 trader runs once its
//    attacker is beyond its reach. No input kind or message kind changes.
//    The derived wire schema fingerprint changes (88eeee94fd636d3b), and
//    the join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): strict play (reference #316 wave 10). A new
//    delta-registered player component, StrictPlay (player/
//    player_state_plugin.ts, an empty record), present only on a strict
//    pilot's ship and carried across hull changes. Sim-rule change
//    alongside: EffectiveMovementPhysicsSystem caps a ship carrying it at
//    2/3 of its top speed (acceleration and turn rate unchanged). No ship
//    without it changes. No input kind or message kind changes. The
//    derived wire schema fingerprint changes (cbfec2237c0e82e5), and the
//    join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): an immediate auto-abort's OnAbort runs at the
//    lift-off that creates its special ships, not at the docked accept
//    (reference #320 item 3, wave 10). One OPTIONAL PendingAutoAbortShip
//    field, `onAbortPending` (player/player_state_plugin.ts). The batch is
//    drained before the player's insertion record is encoded, so it never
//    reaches a peer, but its codec is part of the derived schema. No sim
//    rule, input kind or message kind changes. The derived wire schema
//    fingerprint changes (1f7350a5d5199574), and the join gate keeps older
//    and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): when a shot fires its submunitions (reference
//    "Submunitions wave 10"). Sim rules only: a projectile with a
//    proximity fuse keeps its sprite hurtbox, the fuse is a separate test
//    (ProxRadius + 2/3 of the target's radius, combat/
//    projectile_plugin.ts ProjectileProximityFuseSystem), and subs come
//    from the fuse, an expiry, or a direct hit by a wëap with ProxRadius
//    > 0 (combat/submunition_rule.ts; Matthew's ruling, a departure from
//    the original). Beams keep their own rule (subs when the beam ends).
//    d9e989c2 briefly added an OPTIONAL BeamState field, `hitLastTick`
//    (fingerprint 2942187f166aced1); it is gone again, so the derived
//    wire schema fingerprint is back to 1f7350a5d5199574, the same as
//    before d9e989c2. No input kind or message kind changes. The build
//    stamp gate keeps builds with different sim rules apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): aborting a mission IN FLIGHT, from the 'i'
//    dialog's Abort. The new `abortMission` input kind (the mission's
//    OnAbort and the rest of abortMission, resolved on the owning client
//    against a detached copy: mission_accept.ts AbortedMissionType) carries
//    the mission id and the same OPTIONAL delta fields a refusal does. The
//    sim removes the mission from the SENDER's list — a no-op when it is
//    not there — and applies the deltas; its special ships follow through
//    MissionShipCleanupSystem. New union member, so the derived wire schema
//    fingerprint changes (55c212da798ebf7a); every existing kind and field
//    is unchanged, and the join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): kill penalties (reference "A14 with system
//    traffic as the victims, wave 12"). An OPTIONAL `disableChargedTo`
//    field on DamageAttribution (reputation/reputation_plugin.ts): the
//    root DisableCreditSystem charged the DisabPenalty to, so a kill by
//    that root charges Kill alone while every other kill charges Disab +
//    Kill. Sim-rule change alongside: negative penalty fields apply
//    signed. No input kind or message kind changes. The derived wire
//    schema fingerprint changes (4ff3c1a7ae09af99), and the join gate
//    keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the AI 4 contraband scan (npc/contraband*.ts,
//    reference S1/S2 waves 11-12). NpcComponent's `mode` gains 'scan' and
//    an OPTIONAL `scanTarget` field (the player ship an interceptor is
//    flying to scan); a new serializer-registered component,
//    ContrabandScanned (`{at}`, the scanned-this-visit marker on a player
//    ship), and a new serializer event, ContrabandScanEvent; two OPTIONAL
//    ActiveMission fields, `scanMask` and `failIfScanned`, frozen at
//    accept. Ships and missions that never touch a scan carry none of
//    them, so their components and hash inputs are unchanged. Sim-rule
//    change alongside: AI 4 interceptors of a govt with a ScanMask buzz a
//    non-criminal player ship carrying contraband and fine / charge
//    SmugPenalty / fail 0x0020 missions; every jünk is staged at genesis.
//    No input kind or message kind changes. The derived wire schema
//    fingerprint changes (25cd54bd844fc9ef on its own; 6ffbcaef16994bf3
//    together with the kill-penalty note above), and the join gate keeps
//    older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): fleet escorts defend their leader (reference
//    "P1 wave 13"). Sim rule only: NpcAggressionSystem (npc/
//    npc_targeting.ts provokeFleet) writes the aggressor it records on a
//    ship to that ship's formation followers too (NPCs without an escort
//    command), voiding their bribe as a hit would. No component, field,
//    input kind or message kind changes, so the derived wire schema
//    fingerprint is unchanged (still 6ffbcaef16994bf3). The build stamp
//    gate keeps builds with different sim rules apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): in-system shuttles and NPC mining (shïp Flags3
//    0x0002 / 0x0001, npc/npc_shuttle.ts and npc/npc_mining.ts, reference
//    N1/N2 wave 13). NpcComponent's `mode` gains 'mine' and 'scoop' and
//    an OPTIONAL `mineTarget` field (the rock a miner is shooting or the
//    debris box it is flying over). Ships that never mine carry none of
//    it, so their components and hash inputs are unchanged. The Asteroid
//    and Debris components moved from combat/ to core/ unchanged (same
//    names and types; the fingerprint does not see the move). Sim-rule
//    changes alongside: AI 1/2 miners shoot rocks and scoop debris;
//    shuttles fly between non-enemy stellars, land instead of jumping
//    out, and respawn on a stop instead of jumping in. No input kind or
//    message kind changes. The derived wire schema fingerprint changes
//    (6ffbcaef16994bf3 -> de1618493c2c83ef), and the join gate keeps
//    older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-13 mission fixes (reference "Aborting
//    a mission in flight from the `i` dialog" and "Boarding a rescue
//    ship", wave 13). Sim rules only. The `abortMission` apply now keeps
//    a ShipBehav-1 escort (out of the flock, leaving about 17 s later)
//    and ShipBehav-0 attackers (still hostile) as `untethered` mission
//    ships, through fields that already existed (MissionShip `untethered`,
//    NpcState `departAt` / `passingThrough`); the goal systems and the
//    respawn roster ignore untethered ships. A live rescue ship's board
//    (encounters/rescue_board.ts) only retrieves its PickupMode-2 cargo or
//    is refused. One new serializer event, MissionCargoRetrievedEvent
//    (`{cargoType}`, host -> display only, like the other boarding
//    events); no component, field, input kind or message kind changes, so
//    the derived wire schema fingerprint is unchanged (6ffbcaef16994bf3 on
//    its own; de1618493c2c83ef together with the shuttle/mining note above).
//    The build stamp gate keeps builds with different sim rules apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): piracy police and distress calls (reference "P1
//    wave 14"). One OPTIONAL NpcState field, `distressAt` (npc/
//    npc_component.ts: the sim time of a trader's last distress call), and
//    one new serializer event, DistressCallEvent (`{ship, roll}`, npc/
//    distress.ts; host -> display only, untargeted). Ships that never call
//    carry no `distressAt`, so their hash inputs are unchanged. Sim-rule
//    changes alongside: NpcAggressionSystem records a player-side attacker
//    on every AI 4 witness whose govt defends the victim (npc/
//    piracy_police.ts), and a trader under NPC attack draws one PRNG value
//    for its call. No input kind or message kind changes. The derived wire
//    schema fingerprint changes (de1618493c2c83ef -> 9812fe94442467ca), and
//    the join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-14 contraband fixes (reference
//    "Contraband wave 14"). The ContrabandScanned marker gains an
//    OPTIONAL `hostile` field (the govt whose scan detected contraband;
//    its hunters attack the pilot until he lands), and ContrabandScanEvent
//    an OPTIONAL `junk` field (the illegal jünk's LCName for the status
//    line). Pilots never scanned carry neither, so their components and
//    hash inputs are unchanged. Sim-rule changes alongside: a landing
//    keeps the scanned marker (only a crossing into a fresh world clears
//    it) and drops `hostile`; ScanFine 0 and below fine nothing; illegal
//    jünk costs ScanFine and SmugPenalty; the SmugPenalty follows the A14
//    rule (a nosy scanner in another govt's system raises the owner's
//    record by half the owner's SmugPenalty). No input kind or message
//    kind changes. The derived wire schema fingerprint changes
//    (de1618493c2c83ef -> 188a53cfde98e2e0 on its own; 0c6eeff124ceccf1
//    together with the piracy-police note above), and the join gate keeps
//    older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-15 contraband fixes (reference "A14 /
//    contraband wave 15", `w15_several`). The ContrabandScanned marker
//    gains an OPTIONAL `found` field (the sorted keys of everything its
//    scan found), so a ship already scanned this visit is scanned again
//    only for contraband that scan did not find (a takeoff with new
//    illegal jünk or mission cargo). Pilots never scanned, and scans that
//    found nothing, carry no `found`, so their components and hash inputs
//    are unchanged. Sim-rule change alongside: the rescan rule above. No
//    input kind or message kind changes. The derived wire schema
//    fingerprint changes (0c6eeff124ceccf1 -> c6ab0bdc34e2addd), and the
//    join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): a scan failure costs no CompReward (reference
//    "S1 and S2 wave 12", S2). One OPTIONAL ActiveMission field,
//    `failCause` ('lost' | 'plundered' | 'scan', player/
//    player_state_plugin.ts), written beside `failed` by the three sim
//    systems that set it (the owner disabled or destroyed, boarded by
//    pirates, a contraband scan). Missions the sim never fails carry
//    none, so their components and hash inputs are unchanged; a saved
//    mission without it reads as the old failure. Sim-rule change
//    alongside (applied at the owner's date advance, not in the sim): a
//    'scan' failure changes no record. No input kind or message kind
//    changes. The derived wire schema fingerprint changes
//    (c6ab0bdc34e2addd -> 4ba45ea2f8ce4634), and the join gate keeps
//    older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-15 traffic fixes (reference "Shuttles
//    and T1 traders, wave 15"). One OPTIONAL NpcState field, `laneEnd`
//    (npc/npc_component.ts: a shuttle's other lane stop). Ships that are
//    not shuttles never carry it, so their hash inputs are unchanged.
//    Sim-rule changes alongside: a shuttle never lands or leaves and keeps
//    one lane (one draw for its first stop, one more on a nearest-stop
//    tie), turning 70 px short after a 4 s pause; a respawned shuttle jumps
//    in like any traffic (no take-off draws); an AI 1/2 trader stops at one
//    non-enemy port for 15 s and then departs. No input kind or message
//    kind changes. The derived wire schema fingerprint changes
//    (0c6eeff124ceccf1 -> 86cef0d44be60ecd on its own; 4ba45ea2f8ce4634 ->
//    90e66780d5561a8d on top of the scan-failure note above), and the join gate
//    keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the pilot's and the ship's names (the
//    shipyard's "Please name your new <ship>:" prompt). A new
//    delta-registered player component, PlayerNames (player/
//    player_names.ts, `{pilot?, ship?}`, both OPTIONAL strings), set on
//    the player's ship at the session start and by a shipyard purchase,
//    and carried across hull changes. Names are cleaned (control and
//    text-direction characters stripped, 31 characters at most) where
//    they are written and where they are read. No sim rule reads it. No
//    input kind or message kind changes. The derived wire schema
//    fingerprint changes (90e66780d5561a8d -> e730831c2453dc18), and the
//    join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): legal records PER SYSTEM (ruling #380,
//    reputation/system_records.ts). The player's record map is keyed by
//    sÿst id instead of gövt id, and its component is registered under a
//    new name, 'SystemLegalRecords' (was 'LegalRecords'; the codec, a map
//    of string to number, is unchanged), so a snapshot or delta of the old
//    per-govt map can never be read as the new one. The set-string
//    effects' `recordsDelta` (acceptMission / refuseMission /
//    abortMission) carries sÿst ids now, a delta over the record as read
//    (an absent entry is the system's InitialRec on both sides). Sim-rule
//    changes alongside: a kill, disable or boarding charges the crime's
//    system and every system linked to it, 0.65 per jump, each by its own
//    owner's view (the #379 reward included); hostility, landing clearance
//    and the contraband scan read the current system's record. makeSystem
//    stages every sÿst into the new LegalGeographyResource for it. No
//    input kind or message kind changes. The derived wire schema
//    fingerprint changes (90e66780d5561a8d -> 388761e4c9993a00 on its own; e730831c2453dc18 ->
//    eb92bff5c7d72d2b on top of the ship-names note above), and the
//    join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-16 piracy-police and distress fixes
//    (reference "P1 wave 16"). One OPTIONAL NpcState field,
//    `aggressorSince` (npc/npc_component.ts: sim time the current
//    aggressor was first recorded), written when an NPC's aggressor
//    changes; NPCs nobody attacks never carry it. Sim-rule changes
//    alongside: warships of an attacked NPC's own govt join the fight
//    against a non-player attacker at once, an allied govt's after 20 s
//    (npc/allied_defenders.ts); mission ships send no distress calls and a
//    ship calls at most every 8 s; piracy police watch 2500 px and excuse
//    only a victim that has shot the attacker; an AI 4 scans a clean ship
//    too, once a visit, and sits on a scanned ship 30 s. No input kind or
//    message kind changes. The derived wire schema fingerprint changes
//    (eb92bff5c7d72d2b -> 8ef9af970d217153), and the join gate keeps
//    older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): a neutral ship sells a fuelless pilot fuel
//    (reference "W1 / C1 / H1 wave 16", H1; nova_plugin/encounters/
//    hail_plugin.ts). HailActionType (the `hail` input's action) gains
//    the `lowerPrice` branch ({ kind: 'lowerPrice', target }: Lower Price
//    on a ship's fuel price; Accept Price is the existing
//    requestAssistance). The Assisting component gains an OPTIONAL `fuel`
//    (a fuel-only errand of that many units), and a new serializer- and
//    delta-registered NPC component, FuelHaggle (npc/hail_component.ts,
//    a map of player ship uuid -> withdrawn offers), holds the haggle
//    count the price doubles with. Errands without `fuel`, and ships
//    nobody haggled with, encode and hash as before. Sim-rule changes
//    alongside: a neutral ship (not allied, no Roadside Assistance, no
//    ränk) refuses a disabled pilot and sells a fuelless one a jump of
//    fuel; an AI afterburner hull (shïp Flags 0x0040) burns for its whole
//    attack, not only while thrusting. The derived wire schema
//    fingerprint changes (8ef9af970d217153 -> 64a84723886ce8ba), and the
//    join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the fuel sale's measured price rule (reference
//    "H1 wave 17"). The FuelHaggle component's value changes from a
//    withdrawn-offer count to { asks, countered } per player ship uuid
//    (npc/hail_component.ts's FuelHaggleEntryType): the offers answered,
//    and whether the ship's 3/4 counter is on the table. No input kind or
//    message kind changes (lowerPrice and requestAssistance keep their
//    shape). Sim-rule changes alongside: the price is a per-ship base by
//    mood (1,000 / 2,000 / 3,000, a hash of the ship's uuid) plus 1,000 an
//    answered offer; Lower Price counters with floor(0.75 x P / 100) x 100
//    or withdraws (a hash of ship, pilot and ask), and always withdraws a
//    counter; an allied ship no longer helps for free (it refuses a
//    disabled pilot and sells fuel); a ränk 0x0400 no longer makes a
//    TRADER help. The derived wire schema fingerprint changes
//    (64a84723886ce8ba -> 51a63184211e887b), and the join gate keeps older
//    and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-17 traffic and police fixes (reference
//    "Stock traffic, wave 17", "P1 wave 17", "W1 / C1 / contraband / the
//    shipyard prompt, wave 17"). One OPTIONAL NpcState field,
//    `aggressorHitAt` (npc/npc_component.ts: sim time of the latest hit
//    from the recorded aggressor), written on every provoking hit; NPCs
//    nobody hits never carry it. Sim-rule changes alongside: a system's
//    population target is AvgShips exactly (no roll, no PRNG draw); a
//    miner with rocks to work no longer leaves on its departure roll; the
//    piracy police watch the whole system and excuse only a victim that
//    hit the attacker within the last 5 s; an allied govt's AI 4 joins a
//    fight at once; a shïp Flags2 0x0002 hull holds 450 px off its target.
//    No input kind or message kind changes. The derived wire schema
//    fingerprint changes (51a63184211e887b -> 7110220773935a73), and the
//    join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-18 police and contraband fixes
//    (reference "P1 / H1 wave 18", "Contraband / W1 / C1, wave 18").
//    The OPTIONAL NpcState field `aggressorHitAt` is GONE again: the
//    piracy police have no self-defence exemption at all (a hostile
//    firing on the player at that moment is still policed), so nothing
//    reads the latest hit's time. No input kind or message kind changes.
//    Sim-rule changes alongside: no self-defence excuse for the player or
//    an escort; an AI 4 sits on a scanned ship for the whole visit (not
//    30 s); a ship's fuel price reads the pilot's cash and record; a
//    Lower Price the pilot cannot pay changes nothing; a ränk 0x0800
//    refuels for free but no longer repairs. The derived wire schema
//    fingerprint changes back (7110220773935a73 -> 51a63184211e887b, the
//    value before the wave-17 field): a pre-wave-17 build would pass the
//    join gate against this one, though its sim rules differ.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): reinforcement fleets (sÿst ReinfFleet /
//    ReinfTime / ReinfIntrval; reference "R19 reinforcement fleets, wave
//    19"; nova_plugin/spawn/reinforcements.ts). A new serializer-registered
//    component, ReinforcementCall (`{arriveAt?, caller?}`, the system's
//    pending call, on a 'reinforcements' entity makeSystem adds to a
//    system that has a fleet), a new delta-registered player component,
//    ReinforcementCalls (player/reinforcement_calls.ts, a map of sÿst id
//    -> the day number of the pilot's last call there, carried across hull
//    changes and saved with the pilot as the optional `reinforcementCalls`,
//    no save-version bump), one new serializer event,
//    ReinforcementArrivalEvent (`{govt, name}`, the status line), and a
//    fourth SystemHold reason, 'reinforcement' (an open enum: additive).
//    Sim-rule changes alongside: a player's hit on an NPC of the fleet
//    govt's side calls the fleet when the odds exceed its MaxOdds, once a
//    game day per system (or every ReinfIntrval days); it arrives
//    min(ReinfTime / 30, 24) s later 1,800 px from the caller, stays, and
//    is not counted as traffic. No input kind or message kind changes. The
//    derived wire schema fingerprint changes (51a63184211e887b ->
//    d3e842c4cfaedd4b), and the join gate keeps older and newer builds
//    apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-19 contraband fix (reference
//    "Contraband / rescue / A14, wave 19": a cutter does not follow a
//    clean ship that flies off). NpcState gains an OPTIONAL `scanSatOn`
//    (npc/npc_component.ts: the scanned ship an interceptor has come up to
//    and sits on, so it holds the spot and lets go at
//    CONTRABAND_SIT_LEASH); interceptors that never sit carry none. No
//    input kind or message kind changes. Sim-rule changes alongside: the
//    fuel price is the ship's own ask capped by the pilot's cash, with no
//    record term; a ränk 0x0800 refuels for free from the affiliated
//    govt's allies too; a ShipStart-2 rescue ship waits live instead of
//    adrift; fleet escorts leave with their leader, not on their own
//    rolls. The derived wire
//    schema fingerprint changes (d3e842c4cfaedd4b -> 8389fa45cd30d491),
//    and the join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): ship storage (docs/ship_storage.md). A new
//    delta-registered player component, StoredShips (player/
//    stored_ships.ts: a list of {ship, name, outfits, cargo, fuel,
//    storedAt} records, each with an OPTIONAL `shipName`, the ship's own
//    name), present only on a pilot who has stored a ship and carried
//    across every change of hull. It is edited only while the pilot is
//    docked and reaches peers in the lift-off's addEntity record, like the
//    credits; nothing in the simulation reads it. No sim rule, input kind
//    or message kind changes; a pilot without stored ships has the same
//    components and hash input as before. The derived wire schema
//    fingerprint changes (8389fa45cd30d491 -> 4da2e0c99f1d652a), and the
//    join gate keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-20 reinforcement fixes (reference "R19
//    reinforcement fleets, wave 20"). ReinforcementCall gains two OPTIONAL
//    fields, `victim` (the NPC whose hit called the fleet) and `center`
//    (`{x, y}`, its position at the call); a system with nothing called
//    carries neither. No input kind or message kind changes. Sim-rule
//    changes alongside: the delay is ReinfTime / 39 s with no cap; the
//    fleet comes in around the victim's position at the call, not the
//    caller; a victim whose hull has Speed 0 never calls; a pending call
//    is cancelled when its victim has left the system (or is dying) before
//    the arrival. The derived wire schema fingerprint changes
//    (4da2e0c99f1d652a -> 5046ce9608f031a5), and the join gate keeps older
//    and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): owned escorts' ammo (Matthew 2026-11-24). The
//    PlayerEscort marker gains an OPTIONAL `ammoStock` ([outfit id,
//    count] pairs: the ammo a 'captured' escort had aboard when it became
//    an escort), written by boarding's convertToEscort, ship storage's
//    buildEscortFromRecord and the client before a carried insertion, and
//    carried by every marker re-stamp (durableEscortFields). A hired
//    escort carries none. No input kind or message kind changes. Sim-rule
//    change alongside: an owned escort that lands with the player is
//    rearmed back up to `ammoStock`, not to capacity (spaceport/
//    escort_restock.ts, applied to the carried entity before the lift-off
//    inserts it). The derived wire schema fingerprint changes
//    (5046ce9608f031a5 -> 0afe73ee3aebe863), and the join gate keeps older
//    and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-26 reinforcement fixes (reference "R19
//    wave 26" and "R19 arrival centre, wave 26"). ReinforcementCall drops
//    its OPTIONAL `center` (the fleet now comes in around the system's
//    centre, so the call no longer records where); `victim` stays. No input
//    kind or message kind changes. Sim-rule changes alongside: an AI 3
//    victim calls like an AI 4, at any range; the fleet comes in 1,800 px
//    from the system's centre, heading for it; an NPC of the fleet's side
//    that starts attacking a player's ship (NpcDecisionSystem's
//    NpcAttackStartEvent, sim-internal and not serialized) is checked for
//    a call as a hit is. The derived wire schema fingerprint changes
//    (0afe73ee3aebe863 -> a94a3bd8ec90e8fc), and the join gate keeps older
//    and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-28 planet bribe haggle (reference "R7
//    planet bribe, wave 28"). A new delta-registered player component,
//    StellarHaggle (travel/planet_plugin.ts: the stellar's NOVA id ->
//    {day, countered, withdrawn}), present only on a pilot who has pressed
//    Lower Price on a planet's bribe. The existing `lowerPrice` input
//    ({ kind: 'lowerPrice', target }) is now also accepted with a STELLAR
//    target; no input kind or message kind changes. Sim-rule changes
//    alongside: Lower Price on a planet's bribe counters with 3/4 or
//    withdraws it, Accept Price pays the counter, and a withdrawal refuses
//    every offer for the rest of the game day; a ship's final explosion
//    hits an axis-aligned square of half-side twice its damage by the
//    victim's centre, not a circle (no schema change: the blast's hull is
//    already a polygon on the wire). The derived wire schema fingerprint
//    changes (a94a3bd8ec90e8fc -> 4a0fcd76ceddd9b4), and the join gate
//    keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-29 hypergate `l` range and request
//    lines (reference "Hypergate `l` range and the request lines, wave
//    29"). PlanetTargetComponent gains one OPTIONAL field, `cleared`
//    (travel/planet_plugin.ts PlanetTargetType: the uuid of the hypergate
//    whose clearance the ship holds), present only after a gate cleared
//    the ship, so ships that never use a gate keep their components and
//    hash inputs unchanged. One new serializer event, LandingRequestEvent
//    (`{kind, stellarName, form, online?}`, host -> display only, targeted
//    at the player like LandingClearedEvent). No input kind or message kind
//    changes. Sim-rule changes alongside: `l` with nothing selected skips
//    hypergates 500 px or more away (a circle); the selecting press clears
//    a gate only inside its entry window and otherwise acknowledges the
//    request, a refusing port or station denies on that press, and a gate
//    selected without a clearance is cleared by the next `l` inside the
//    window before one enters it. The derived wire schema fingerprint
//    changes (4a0fcd76ceddd9b4 -> b3344196d35e2ebd), and the join gate
//    keeps older and newer builds apart.
//    Also under 8, no further bump (maintainer's standing ruling for
//    schema-only changes): the wave-29 planet bribe withdrawal scope
//    (reference "R7 planet bribe withdrawal, wave 29"). A StellarHaggle
//    entry drops its `day` and is now { countered, withdrawn }: the haggle
//    lasts the SYSTEM VISIT, not the game day, so nothing reads a day off
//    it (the first Lower Price's counter draw takes the current date
//    instead). No input kind or message kind changes. Sim-rule change
//    alongside: a withdrawal (or a counter) survives landings and
//    take-offs in the system, and the crossing into another system drops
//    the whole component (pilot/transition_prep.ts, applied to the carried
//    player before the destination inserts it). The derived wire schema
//    fingerprint changes (b3344196d35e2ebd -> 794b422a9a516ea5), and the
//    join gate keeps older and newer builds apart.

export const PROTOCOL_VERSION = 8;

/**
 * ===================================================================== * Trust model
 * ===================================================================== *
 * The single statement of who may say what and who checks it; the code
 * comments at each enforcement point refer here by item number. The
 * server is trusted. A client is not: anyone holding the current build
 * stamp (served publicly at /version) can open a socket and speak this
 * protocol, so every property below must hold against a hostile client.
 *
 *  1. IDENTITY is stamped by the relay. Whatever `peerId` a record
 *     carries on the wire is discarded: the relay (rollback_relay.ts)
 *     overwrites it with the socket uuid the record arrived on and
 *     clamps its tick into the future. No client can speak for another
 *     peer, or into the past.
 *
 *  2. SHAPE is validated at every receiving boundary, before anything
 *     is dereferenced: RollbackProtocolMessageType (this file) and
 *     InputRecordType / SimulationInputType (simulation_input.ts) via
 *     unwrapRollbackMessage. What fails to decode is dropped with a
 *     rate-limited warning (common/log_throttle.ts). Unknown fields are
 *     stripped, so junk is never logged, relayed or archived. Below the
 *     protocol, SocketChannelServer survives unparseable and
 *     invalid-UTF-8 frames and bounds the frame size.
 *
 *  3. The RELAY listens to ROOM MEMBERS only (sockets that sent
 *     `inRoom` for that room); takes stateHash reports only for
 *     checkpoint-aligned ticks at or near its own clock; and takes a
 *     desyncDump only from a peer it convicted or asked (the recorder
 *     then bounds what it writes and where: server/desync_recorder.ts).
 *     Client-to-client delivery does not exist: CommunicatorServer
 *     delivers a client's message to the server alone, whatever
 *     destination the client named. The relay is the single fan-out.
 *
 *  4. A CLIENT accepts rollback-protocol messages — inputs, inputLog,
 *     tickSync, catchUp, roomSpeed, desync, desyncDumpRequest — and room peer
 *     sets only from a source in `communicator.servers`
 *     (rollback_messages.ts, multi_room_communicator.ts). Every
 *     legitimate one is relay-originated, so an input record is only
 *     ever applied with a relay-stamped peerId (or none, in local play
 *     before any connection exists). Neither end hardcodes that set:
 *     the server ANNOUNCES it in the uuid frame that opens every
 *     connection (communicator_message.ts), and the client takes it
 *     from there alone (communicator_client.ts). It is empty until the
 *     announcement, so server-only traffic before it is refused; and
 *     only the socket's server end can send a uuid frame — the server
 *     drops any a client sends and re-wraps everything it relays as a
 *     sourced `message` — so no peer can name itself a server.
 *
 *  5. OWNERSHIP is enforced when a record is APPLIED, deterministically
 *     (simulation_input.ts). A peer owns its player ship and every
 *     entity it inserted — hired and carried escorts, mission ships,
 *     the NPCs it spawned — i.e. the entities whose ControlledBy.peerId
 *     or MultiplayerData.owner is that peer (browser.ts and the bridge
 *     stamp each of those with the client's uuid; bay-launched fighters
 *     inherit their carrier's owner). removeEntity, and addEntity over
 *     an existing uuid, need ownership of the target; a fresh addEntity
 *     may not declare another peer as controller or owner; removePeer
 *     and roomSeed (the room's seed, #140; also from a record with no
 *     peerId, local play) are accepted only from a server uuid (the
 *     announced set of item
 *     4; a world with no communicator falls back to the server's fixed
 *     'server', simulation_input.ts DEFAULT_SERVER_PEERS); nothing
 *     peer-authored may name the singleton. A server-stamped record,
 *     and a record with no peerId, is exempt. Every check reads only
 *     synced state, the stamped peer and that set (the same on every
 *     peer), so all peers drop or apply the same input on the
 *     same tick — the drop is itself deterministic.
 *     When a peer LEAVES, the relay's removePeer removes its player
 *     ship and escorts (and their fighters) and DISOWNS everything
 *     else it owned: MultiplayerData is cleared, and the ship is an
 *     ordinary world ship nobody may replace or remove by input
 *     (peer_departure.ts). Nothing a departed peer owned is ever
 *     transferred to another peer.
 *
 *  6. RECONNECT TOKENS (#354) let a client retire its OWN previous
 *     connection, nothing more. CommunicatorServer issues every
 *     connection a fresh token in its uuid frame — 256 bits from node's
 *     CSPRNG (crypto.randomBytes; never Math.random, never inside the
 *     simulation), sent on that socket alone, so no other peer ever
 *     sees it, and never logged. A client holds it in memory only
 *     (communicator_client.ts says why not localStorage) and presents
 *     it as the FIRST communicator frame of its next connection — the
 *     channel writes it the moment the new socket opens, ahead of
 *     everything else, and replays nothing queued for the dead
 *     connection (socket_channel_client.ts, #366); the
 *     server then retires the connection the token was issued to —
 *     closes it and emits its departure through the normal path, so
 *     every room sees the old peer leave (removePeer, item 5) before
 *     the new connection's own traffic is handled — and forgets the
 *     token (single use; a token also dies with its connection). A
 *     token presented later than the first frame, by the connection it
 *     belongs to, or unknown (wrong, spent, a restarted server's) is
 *     ignored, unanswered: the presenter proceeds as the brand-new
 *     connection it is and learns nothing about whether it existed. A
 *     token grants no IDENTITY: the presenter keeps its own new uuid
 *     (identity stays per socket, item 1), and nothing the retired
 *     connection owned is handed to it — its fleet leaves with it and
 *     the client re-inserts it as any peer inserts its own ships. What
 *     a stolen token buys is therefore exactly what the victim's own
 *     disconnect does; keeping it secret (one socket, memory, no logs)
 *     is what keeps it from being stolen.
 *
 * Deliberately NOT covered: the CONTENT of a peer's own inputs. A peer
 * may insert whatever it likes as its own (a hull with absurd stats,
 * an escort it never paid for). The rollback rooms are an input
 * exchange with integrity, not an anti-cheat layer; that would need a
 * server-authoritative economy, which is out of scope here.
 */

/**
 * One notable event in a peer's rollback machinery, for the black-box
 * ring included in desync dumps: state alone shows *what* diverged,
 * the rollback log shows *how the peer got there* (late records,
 * rollback depths, joins, resyncs).
 */
export interface RollbackLogEntry {
    /** e.g. 'rollback', 'lateRecord', 'join', 'resync', 'rewind'. */
    event: string;
    /** The peer's local tick when it happened. */
    atTick: number;
    /** Event-specific context (target ticks, record counts...). */
    detail?: Record<string, number | string>;
}

/**
 * A peer's state history around a desync, uploaded to the server for
 * offline analysis (see analyze_desync.mjs): full wire snapshots at
 * its recent checkpoint ticks, plus the rollback event log.
 */
export interface DesyncDump {
    /** The peer's tick when the dump was captured. */
    tick: number;
    /** The convicted checkpoint, when a desync triggered the dump. */
    desyncTick?: number;
    /** What simulated this: user agent or node version. */
    engine: string;
    checkpoints: { tick: number, snapshot: WireWorldSnapshot }[];
    rollbackLog: RollbackLogEntry[];
}

/** A room clock's speed multiplier: normal (1x) or double speed (2x). */
export type RoomSpeed = 1 | 2;

export const RoomSpeedType = new t.Type<RoomSpeed, RoomSpeed, unknown>(
    'RoomSpeed',
    (u): u is RoomSpeed => u === 1 || u === 2,
    (u, c) => (u === 1 || u === 2 ? t.success(u) : t.failure(u, c)),
    t.identity,
);

/** A peer's Caps Lock 2x speed vote and whether it is in space (#371). */
export interface SpeedVote {
    wantFast: boolean;
    inSpace: boolean;
}

export const SpeedVoteType: t.Type<SpeedVote, unknown> = t.strict({
    wantFast: t.boolean,
    inSpace: t.boolean,
});

/**
 * The room's clock speed and vote tally, announced on `roomSpeed` and
 * seeded on `catchUp`. Lives strictly in the clock/transport layer, never
 * in simulation state (#371).
 */
export interface RoomSpeedState {
    /** Speed in effect from `atTick` onward (1 or 2). */
    speed: RoomSpeed;
    /** Tick boundary at which `speed` takes (or took) effect. */
    atTick: number;
    /** In-space voters currently voting for 2x. */
    fastVotes: number;
    /** Total in-space voters currently in the room (landed peers excluded). */
    totalVoters: number;
}

export const RoomSpeedStateType: t.Type<RoomSpeedState, unknown> = t.strict({
    speed: RoomSpeedType,
    atTick: WireTick,
    fastVotes: WireTick,
    totalVoters: WireTick,
});

/**
 * Rollback protocol messages travel on the same room channel as the
 * legacy multiplayer messages, wrapped in a `rollback` envelope. The
 * legacy Message codec is a t.partial, so it decodes these as empty
 * messages and ignores them; likewise this side ignores everything
 * without the envelope.
 */
export type RollbackProtocolMessage =
    | { kind: 'inputs', record: InputRecord }
    /** The server's clock, broadcast periodically. */
    | { kind: 'tickSync', tick: number }
    /** A peer's Caps Lock 2x speed vote and whether it is in space
     * (peer -> server, non-simulation control message, #371). Landed
     * peers (`inSpace: false`) do not vote. */
    | { kind: 'speedVote', wantFast: boolean, inSpace: boolean }
    /** The room's clock speed and vote tally (server -> peers, #371).
     * `tick` is the relay's current tick when sent; `speed` takes effect
     * at the `atTick` boundary so every client's RoomClock switches pace
     * at the same tick. */
    | {
        kind: 'roomSpeed', tick: number, speed: RoomSpeed, atTick: number,
        fastVotes: number, totalVoters: number,
    }
    /**
     * Ask the server for the input log from a tick; answered with an
     * `inputLog`, which the bridge integrates record by record. DORMANT
     * ON THE WIRE: no shipped client sends the request — late join and
     * resync both go through `joinRequest`/`catchUp`, which carry a
     * baseline as well as the log. The pair is kept as the log-only
     * resync path the bridge already understands (simulation_bridge.ts)
     * and the relay tests exercise; it exposes nothing `joinRequest`
     * does not (the same log, to a room member only, server-stamped).
     * Removing it is a protocol change: bump PROTOCOL_VERSION with it.
     */
    | { kind: 'inputLogRequest', fromTick: number }
    | { kind: 'inputLog', records: InputRecord[] }
    /** Join: the input log up to the server's current tick, plus the
     * newest archived baseline when the server has one. The joiner
     * replays the log over the baseline (or the deterministic genesis
     * world when there is none). `fresh` asks for a baseline captured
     * NOW instead of the last periodic one: a resync replaying a
     * ~30s-stale baseline's log tail costs 1-2s of blocked rebuild,
     * while a fresh baseline's tail is just the transit window. */
    /** `schema`: the joiner's wire-schema fingerprint (wire_schemas.ts
     * liveWireFingerprint), so a relay built from a different schema
     * refuses the join instead of misreading every frame. REQUIRED
     * since protocol 7: a schema'd relay refuses a join that omits it
     * (rollback_relay.ts, "wire schema fingerprint missing"). Optional
     * in the codec only for the json rollback wire (wire_codec.ts
     * WIRE_ENCODING), which has no fingerprint on either end.
     * `systems`: the joiner's system-order hash (system_order.ts
     * systemOrderHash of its simulation world's systemNames, #155).
     * Compared, never gated on: the relay remembers the room's first
     * declaration and WARNS (joinWarning) on a different one. */
    | {
        kind: 'joinRequest', fresh?: boolean, protocol?: number, schema?: string,
        systems?: string, speedVote?: SpeedVote,
    }
    /** The relay will not serve this joiner: its wire schema differs
     * (server -> peer). The peer gives up the join; nothing it sent
     * would have decoded alike on both ends. */
    | { kind: 'joinRefused', reason: string }
    /** The relay serves this joiner but saw something wrong with its
     * join (server -> peer, just before the catchUp): its system-order
     * hash differs from the room's (#155). The peer logs it and joins
     * anyway — the fingerprint gate is the refusal mechanism. */
    | { kind: 'joinWarning', reason: string }
    /**
     * The room refused one of this peer's insertions (server -> peer,
     * #354). Ownership is enforced when a record is APPLIED (Trust model
     * item 5), deterministically and therefore silently on every world;
     * the archive — the log's true simulation — reports each refusal it
     * applies, once, so the sender learns of it instead of desyncing
     * forever. `peer` is the identity the relay stamped the record with
     * (this peer's socket uuid at the time); `tick`/`seq` name the
     * record, `uuid` the refused entity, `input` the input kind
     * (addEntity, or missionShip for an acceptMission's ship). The peer
     * logs it and, when the refused entity is one it stamped with a
     * stale identity, re-stamps and re-enters (simulation_bridge_host.ts
     * handleRefusal).
     */
    | {
        kind: 'inputRefused', peer: string, tick: number, seq?: number,
        uuid: string, input: string, reason: string,
    }
    /** `timeline`: the relay's log identity (rollback_relay.ts
     * `timeline`), new whenever the room's log starts over; a re-entry
     * compares it with the one it last joined (#354). Optional in the
     * codec only so a test relay double may omit it. */
    | {
        kind: 'catchUp', tick: number, records: InputRecord[],
        baseline?: ArchiveBaseline, timeline?: string,
        roomSpeed?: RoomSpeedState,
    }
    /** A peer's world hash for a settled tick (peer -> server). */
    | { kind: 'stateHash', tick: number, hash: string }
    /** The relay saw peers disagree about a tick's state
     * (server -> everyone). Non-canonical peers resync. `canonical`
     * is the relay's verdict, computed from timely voters only —
     * reports from clients running far behind the room's clock are
     * compared (and convicted) but get no vote. */
    | {
        kind: 'desync', tick: number, hashes: [string, string][],
        canonical?: string,
    }
    /** Ask a peer for its state history (server -> peer). Sent to a
     * healthy peer when the archive itself is outvoted, so the
     * incident record includes a canonical reference state. */
    | { kind: 'desyncDumpRequest' }
    /** A peer's state history for the incident record (peer ->
     * server). Diverged peers push this unprompted on conviction,
     * before resyncing discards the evidence. */
    | { kind: 'desyncDump', dump: DesyncDump };

/**
 * ===================================================================== * Wire validation
 * ===================================================================== *
 * `unwrapRollbackMessage` used to be a cast: `{rollback:{kind:'inputs'}}`
 * (no record) threw a TypeError inside an rxjs subscriber, which rxjs 7
 * rethrows on a macrotask — an uncaught exception, i.e. the server
 * process exiting on one message from any admitted client. Everything
 * the relay and the bridge act on now decodes through these codecs
 * first; a failure is dropped (and warned about, rate-limited so the
 * drop path is not itself a log flood).
 *
 * The snapshot-bearing messages (catchUp, desyncDump) are validated
 * STRUCTURALLY — entity/component tuple shapes, not component contents,
 * which the serializer decodes with its own codecs on restore. A full
 * deep decode of a megabyte baseline on every join would cost more
 * than it protects; both messages are server-trusted or gated by the
 * relay anyway (see simulation_bridge.ts and rollback_relay.ts).
 *
 * The snapshot's structural codec is nova_ecs's WireWorldSnapshotType,
 * whose component lists are ONE shared codec instance
 * (WireComponentListType): the socket schema's derivation
 * (wire_schemas.ts, with the world-independent registry of
 * wire_snapshot_components.ts) recognises the list by identity and
 * types each component's data — while the runtime gate here stays
 * structural, exactly as before.
 */

const ArchiveBaselineType: t.Type<ArchiveBaseline, unknown> = t.type({
    tick: WireTick,
    snapshot: WireWorldSnapshotType,
});

const RollbackLogEntryType: t.Type<RollbackLogEntry, unknown> = t.intersection([
    t.type({ event: t.string, atTick: t.number }),
    t.partial({ detail: t.record(t.string, t.union([t.number, t.string])) }),
]);

export const DesyncDumpType: t.Type<DesyncDump, unknown> = t.intersection([
    t.type({
        tick: WireTick,
        engine: t.string,
        checkpoints: t.array(t.type({
            tick: WireTick,
            snapshot: WireWorldSnapshotType,
        })),
        rollbackLog: t.array(RollbackLogEntryType),
    }),
    t.partial({ desyncTick: WireTick }),
]);

export const RollbackProtocolMessageType: t.Type<RollbackProtocolMessage, unknown> =
    t.union([
        t.strict({ kind: t.literal('inputs'), record: InputRecordType }),
        t.strict({ kind: t.literal('tickSync'), tick: WireTick }),
        t.strict({
            kind: t.literal('speedVote'),
            wantFast: t.boolean,
            inSpace: t.boolean,
        }),
        t.strict({
            kind: t.literal('roomSpeed'),
            tick: WireTick,
            speed: RoomSpeedType,
            atTick: WireTick,
            fastVotes: WireTick,
            totalVoters: WireTick,
        }),
        t.strict({ kind: t.literal('inputLogRequest'), fromTick: WireTick }),
        t.strict({ kind: t.literal('inputLog'), records: t.array(InputRecordType) }),
        t.exact(t.intersection([
            t.type({ kind: t.literal('joinRequest') }),
            t.partial({
                fresh: t.boolean, protocol: t.number, schema: t.string,
                systems: t.string, speedVote: SpeedVoteType,
            }),
        ])),
        t.strict({ kind: t.literal('joinRefused'), reason: t.string }),
        t.strict({ kind: t.literal('joinWarning'), reason: t.string }),
        t.exact(t.intersection([
            t.type({
                kind: t.literal('inputRefused'),
                peer: t.string,
                tick: WireTick,
                uuid: t.string,
                input: t.string,
                reason: t.string,
            }),
            t.partial({ seq: WireTick }),
        ])),
        t.exact(t.intersection([
            t.type({
                kind: t.literal('catchUp'),
                tick: WireTick,
                records: t.array(InputRecordType),
            }),
            t.partial({
                baseline: ArchiveBaselineType,
                timeline: t.string,
                roomSpeed: RoomSpeedStateType,
            }),
        ])),
        t.strict({ kind: t.literal('stateHash'), tick: WireTick, hash: t.string }),
        t.exact(t.intersection([
            t.type({
                kind: t.literal('desync'),
                tick: WireTick,
                hashes: t.array(t.tuple([t.string, t.string])),
            }),
            t.partial({ canonical: t.string }),
        ])),
        t.strict({ kind: t.literal('desyncDumpRequest') }),
        t.strict({ kind: t.literal('desyncDump'), dump: DesyncDumpType }),
    ]);

export function wrapRollbackMessage(message: RollbackProtocolMessage): unknown {
    return { rollback: message };
}

/**
 * The validated rollback message inside `raw`'s envelope, or undefined
 * when `raw` carries no envelope (legacy room traffic — silent) or a
 * malformed one (dropped with a rate-limited warning).
 */
export function unwrapRollbackMessage(raw: unknown): RollbackProtocolMessage | undefined {
    if (typeof raw !== 'object' || raw === null || !('rollback' in raw)) {
        return undefined;
    }
    const decoded = RollbackProtocolMessageType.decode(
        (raw as { rollback: unknown }).rollback);
    if (isLeft(decoded)) {
        warnThrottled('rollback-message-malformed', () =>
            'Dropping malformed rollback message: '
            + formatIoTsErrors(decoded.left).slice(0, 3).join('; '));
        return undefined;
    }
    return decoded.right;
}

/**
 * Which hash in a desync report is the true state: the input log
 * deterministically defines it, but nobody simulated the log twice
 * client-side, so the report votes. The most common hash wins; ties
 * break first toward a `preferred` reporter (the server, whose archive
 * sim *is* the log's true simulation), then toward the lowest peerId.
 * Every peer computes the same answer from the same report, so exactly
 * the diverged minority resyncs.
 */
export function canonicalDesyncHash(hashes: [string, string][],
    preferred?: ReadonlySet<string>): string | undefined {
    const groups = new Map<string, string[]>();
    for (const [peerId, hash] of hashes) {
        groups.set(hash, [...(groups.get(hash) ?? []), peerId]);
    }
    let best: {
        hash: string, count: number,
        preferred: boolean, lowestPeer: string,
    } | undefined;
    for (const [hash, peers] of groups) {
        const candidate = {
            hash,
            count: peers.length,
            preferred: peers.some(peer => preferred?.has(peer) ?? false),
            lowestPeer: [...peers].sort()[0]!,
        };
        const wins = !best
            || candidate.count > best.count
            || (candidate.count === best.count && (
                (candidate.preferred && !best.preferred)
                || (candidate.preferred === best.preferred
                    && candidate.lowestPeer < best.lowestPeer)));
        if (wins) {
            best = candidate;
        }
    }
    return best?.hash;
}
