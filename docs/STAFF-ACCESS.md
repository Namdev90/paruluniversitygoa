# Staff station and data access

The first station choice is stored in `checkers.selected_station` under a row lock. Repeating the same choice is idempotent; choosing a different station returns 409. Google login preserves the choice. Existing approved single-role accounts retain that assigned station. Pending requests retain the requested station. Only the protected admin `staff-update` action can reassign staff. No permission is granted by choosing a station.

Staff `sync` returns `staffSummary: true`, empty records/history and exactly two counters: `ownScans` (confirmed admissions attributed to that immutable checker ID) and `totalEntries` (all confirmed non-fixture admissions). Help Desk receives the same small summary. Full roster, entry/staff lists and event/payment statistics are returned only for admin. Check-in still returns the receipt for the QR being checked. Unconfirmed reads and duplicates never add another admission.

Android and browser summary handling clear old student/entry caches while retaining pending requests for an authorized Checker. Help Desk cannot retain or submit a scanner outbox. The Help Desk form and its own paged saved cases remain available; only admin can edit, approve or export.

`server/tests/roles-db.sql` and `station-summary-db.sql` verify station locking, unchanged Google identity, admin reassignment, role isolation, exact counter ownership and absence of bulk data. Run these inside BEGIN/ROLLBACK. The current four-field Help Desk block in `helpdesk-db.sql` checks that registration/approval still works. No fixture should be committed.
