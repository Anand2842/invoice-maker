# Inventory source draft — not installed

The parallel inventory agent stopped at a usage limit before publishing migration013, API/UI or tests. `inventory-commands.sql.draft` preserves its scratch implementation for review. It is outside the migration scanner and is **not verified or activated**.

Do not treat the draft as a working stock subsystem. Independently review its SQL, grants, accounting/source links, FIFO fractions/cents, tracking/reservations, corrections and chronology before installing anything. The dynamic table-name formatting in its DO block needs repair, and read/API/UI/testing are absent.

Design intended: canonical stock separate from retained legacy item quantities; owner-reviewed FIFO cutover/mappings; warehouse/UOM/batch/serial/expiry; typed receipt/reservation/dispatch/transfer/returns; supplier-bill purchase-clearing1500 to avoid double inventory, stock1200/COGS5100 source ties. No automatic migration of legacy cached quantities; no services stock; no invoice-total COGS. Backdated changes affecting frozen consumptions still require an explicit recost/correction workflow, not a permanent exclusion. Full T25–T28 remain in scope and incomplete.
