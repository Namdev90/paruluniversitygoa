# Native relay retirement retention

The native media owner retains one `RelayV1Driver.RetiredEpochs` across slot
replacement, room release, foreground changes, and authorization changes. There
is no automatic restart or reset to regain retirement capacity. This remains
owner-lifetime memory, not a new disk-persistent or process-restart guarantee.

Previously, the 65th distinct retired room poisoned the driver. The replacement
keeps exact monotonic epoch floors for 64 recently inserted distinct rooms and
an append-only 8 MiB Bloom filter for every evicted room identifier. Repeated
retirement of an exact room does not reorder that insertion-order cache. A filter
match outside the exact cache returns the largest possible protocol epoch,
permanently rejecting that room. This is conservative: the server integration
assigns a distinct room to each immutable SQL lease. Even a fresh greater epoch
for an evicted room is rejected; greater epochs remain possible while its exact
floor is retained. No upper clock bound, timer, credential expiry, or device wall
time causes metadata deletion.

## Replay safety argument

All reads and mutations share the `RetiredEpochs` monitor, including use of the
SHA-256 digest. An exact floor is only increased. Before evicting an exact entry,
all seven hash-selected bits for its room are set. Those bits are never cleared
or replaced. Subsequent lookups therefore either find its exact floor, or find
all seven bits and return `MAX_UINT32`. No grant has a greater valid epoch.
Retiring a room already represented by the filter never reinstates a smaller
exact floor. Existing driver checks fence grants and active media against this
shared floor; stale session and owner handles retain their existing lifecycle
fences.

Colliding hashes, duplicate probes, and eventual saturation can only raise the
reported floor and deny admission. They cannot produce false negatives for a
recorded room. Each probe uses a separate 32-bit word of the SHA-256 digest,
masked into the fixed 2^26-bit array; negative integer words cannot produce an
out-of-range index. Synchronization prevents partial tombstone publication from
being observed. If retirement allocation fails, the metadata object is latched
failed before returning failure to the driver, which poisons itself. All later
floor reads return `MAX_UINT32`, including reads by another driver sharing this
object. Allocation failure during filter lookup similarly latches failure.
No memory failure authorizes a forgotten floor.

## Availability and size limits

This is a practical lifespan improvement, not unlimited guaranteed availability.
The array allocates lazily on first eviction and has exactly 8,388,608 payload
bytes, plus its JVM array header/alignment. The 64-entry map, bounded-length room
identifiers, and digest add bounded overhead. Temporary digest inputs/outputs
are bounded by the protocol identifier length. No per-retired-room object
accumulates outside the 64-entry cache.

For non-adversarial distinct room identifiers with uniformly distributed SHA-256
probes, the approximate false-positive probability after n evicted rooms is
`(1 - exp(-7*n/67108864))^7`: about 9.36e-8 at one million rooms,
0.183% at five million, and 4.78% at ten million. At a new room every five seconds,
one million rooms represents about 58 days of uninterrupted turnover; at eight
hours of use daily it represents about 174 days. These are statistical sizing
estimates, not guarantees against adversarial collision searches. False positives
reject the affected room and increasing saturation eventually reduces availability;
there is no reset, time-pruning, or retry bypass in this change.

## Offline verification

`python3 tests/native-relay-check.py` compiles the production classes with Java 17
language/API compatibility and warnings as errors. Added driver tests cover one
million distinct retirements and a lookup for every retired room; monotonic and
maximum epoch floors; invalid retirement inputs; 256 full publisher room
lifecycles; stale handles after turnover; old-room rejection by a replacement
driver; and deterministic all-bits-set saturation. Existing replacement-driver,
higher-epoch reconnect, grant expiry, clock rollback, resource teardown, and owner
identity fencing tests continue to run. Tests use synthetic clocks, sockets,
audio, and credentials; no live service or hardware is involved.
