---
name: B2C bank matching policy
description: Rules for eligible B2C statement rows and delayed UPI/card credits.
---

Only UPI and card transactions are relevant to B2C bank matching; all other statement transaction types should be ignored. A delayed deposit may be matched to its earlier UPI/card payment by an Admin, with a required note and actor/time audit details. A deposit cannot be matched more than once, and the ordinary batch lock must remain in place for unrelated edits.

**Why:** the user requested a narrow exception for rare delayed bank credits while keeping irrelevant payment modes out of bank reconciliation.

**How to apply:** Keep filtering and late-match permissions enforced by both the interface and API; do not treat an Admin late match as permission to reopen other submitted batch fields.
