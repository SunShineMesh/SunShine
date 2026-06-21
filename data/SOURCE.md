# `data/` — sources & licensing

## `sanctions_snapshot_20260621.csv`
- **What:** OFAC SDN (Specially Designated Nationals) sanctions list — the real data behind the
  D6 AML hard gate (`src/kya/aml.ts`). Screening the operator + every counterparty against this
  list is what makes the compliance dimension real, not a stub.
- **Source:** OpenSanctions `us_ofac_sdn` dataset, `targets.simple.csv` format —
  https://data.opensanctions.org/datasets/latest/us_ofac_sdn/
- **Underlying authority:** U.S. Treasury OFAC SDN list (https://sanctionslist.ofac.treas.gov/) —
  U.S. Government public-domain data.
- **Snapshot date:** pinned **2026-06-21** for deterministic demos. Refresh by re-downloading
  (see the curl command in `.gitignore`).
- **Licensing:** OFAC SDN content is U.S.-Government public domain. OpenSanctions formatting /
  aggregation is CC-BY 4.0 — attribution: OpenSanctions.org.

## `sanctions_fixture.json`
- A small (5-row) subset used for fast, offline, deterministic unit tests
  (`SANCTIONS_FIXTURE=true`, set by `vitest.config.ts`). The full CSV exercises the real path.
