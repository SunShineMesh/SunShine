# MeshCredit

**A multi-dimensional agent passport and on-ledger trust bureau for cross-border AI payments — built on the XRP Ledger.**

MeshCredit is the *trust bureau of the agent economy*. It runs **Know-Your-Agent (KYA)** and
**Know-Your-Business (KYB)** checks on an autonomous agent and its operator, then issues the
verdict as a **six-dimension trust passport — a tamper-evident credential that lives on the XRP
Ledger** (XLS-70). Any bank, merchant, or counterparty reads that credential straight from the
ledger — no API key, no phone-home — and crucially, **enforces it at consensus**: an uncertified
agent's payment is rejected by validators with `tecNO_PERMISSION`, before any application code
runs.

> **The product is the credential.** Cross-border agent payments are the first place where
> "is this agent allowed to move this money?" must be answered by the rails, not by a dashboard.

> Built for **SwissHacks 2026 · Ripple challenge — Know Your Agent (KYA)**. Runs on XRPL
> **testnet** with real transactions; every primitive used is live or one amendment-flag away
> from mainnet.

---

## The multi-dimensional agent passport

A v2 MeshCredit passport is not a single number — it is a **six-dimension evidence bundle**,
each dimension attested by a named external issuer and hashed on-ledger:

| Dim | Name | Issuer | What it checks |
|-----|------|--------|----------------|
| D1 | DID Identity | Public XRPL | did:xrpl anchor, account age |
| D2 | Human Accountability | World ID | Nullifier proof — one person behind the agent |
| D3 | Code Integrity | Self-attested | SHA-256 of harness + skill bytecodes |
| D4 | Behavioral History | Public XRPL | On-chain TX count, latency, error rate |
| D5 | Mandate | KYB operator credential | Delegated spend cap from the verified business |
| D6 | AML Screening | OFAC SDN / Zefix | Sanctions match check against named counterparties |

Each dimension carries a **PASS / PENDING / DENY** status pill and a short evidence reference. The
six scores fuse into a 100-pt total that maps to a **tier (BRONZE → PLATINUM)** and a **confidence
percentage** — the data flywheel: more on-chain history → higher confidence → better terms.

### Data flywheel

A fresh agent starts BRONZE with low confidence and a tight ceiling. Every successful payment
adds on-chain history (D4), pushing confidence up and ceiling higher — no manual re-KYC needed.
The demo shows this contrast live: Aria (fresh) vs a thick-file agent with a richer score.

### Honest framing

The demo uses an **IDKit simulator** for World ID (no live World App scan required) and a **cached
Zefix fixture** for the Swiss business registry. Both are clearly labelled in the UI. The
settlement, credential issuance, and gate enforcement use **real XRPL testnet transactions**.

---

## Why this is different

| | Typical agent-trust stack | MeshCredit |
|---|---|---|
| Where trust lives | a row in a vendor's database | an **XLS-70 credential on the ledger** |
| How it's checked | an API call the relying party must trust | read directly from the ledger, no API key |
| Where it's **enforced** | application layer (a layer *above* the money) | **at consensus** — validators reject the tx |
| Kill-switch | revoke in a DB, hope every integrator honors it | `CredentialDelete` — denied everywhere in ~4 s |
| Identity of the *business* | usually ignored | **KYB** operator credential + delegated spend cap |
| Trust dimension | single score | **six-dimension bundle**, each backed by a named issuer |

Competing approaches (t54, Experian's agent work, ERC-8004) enforce one layer up, in software a
counterparty has to trust. MeshCredit pushes enforcement **into the ledger**.

---

## The demo arc

> **Novartis AG** (KYB-verified, Basel) runs **Aria**, a procurement AI, which pays **Lagos
> Precision Parts Ltd** (Lagos) through a bank that gates its settlement account on a MeshCredit
> credential. The bank also denies an uncertified agent — *at the ledger*, not in software.

The web theater at `http://localhost:5173/#/live` streams every step live, including:

- **KYB** — Novartis verified, delegated spend cap issued on-ledger
- **Passport issued** — 6-dimension KYA check, tier + confidence, the full passport hero rendered
- **Agent reasons** — live DeepSeek chain-of-thought gating the payment decision
- **Fan-out settlements** — payments to Lagos and Taipei suppliers, real escrow/release
- **Three denials** (clearly labeled with reason): tier ceiling too low; daily budget exhausted; AML block (OFAC SDN match)
- **Uncertified contrast** — `tecNO_PERMISSION` from ledger validators, not the bank's software
- **Surgical kill-switch** — `CredentialDelete` → denied everywhere in one ledger close
- **Data-flywheel contrast** — fresh BRONZE agent vs thick-file GOLD: the compounding effect made visible

---

## Run instructions

```bash
# Install
npm install
cd web && npm install && cd ..

# Start the backend (treasury API on :8787)
npm run server

# Start the web console (port 5173)
npm --prefix web run dev
```

Open **http://localhost:5173/#/live** and click **Run the live cross-border demo**.

`./start.sh` launches both together (Ctrl+C stops both).

---

## XRPL features used

| Feature / amendment | How MeshCredit uses it |
|---|---|
| **XLS-70 Credentials** | `CredentialCreate` / `CredentialAccept` / `CredentialDelete`. Three types: KYA (`agent_trust_v1`), KYB (`operator_v1`), skill (`agent_skill_v1`). |
| **DepositAuth** (`asfDepositAuth`) | Bank locks its settlement account; only credential-holders pay in. |
| **DepositPreauth** with `AuthorizeCredentials` | Pre-authorizes *anyone with a MeshCredit credential*. The `CredentialIDs` field is what validators check. |
| **XLS-80 Permissioned Domains** | Groups acceptable credentials so a venue can say "members only" by credential, not by allow-list. |
| **XLS-85 Token Escrow** | `EscrowCreate` / `EscrowFinish` hold settlement at the bank. Releasing requires the credential. |
| **DEX cross-currency path payments** | FX routed through the order book — zero bureau involvement. |
| **did:xrpl** | Agent credential anchored to its DID; reputation survives re-registration. |
| **`asfAllowTrustLineLocking`** | The single mainnet flag that makes the escrow leg native-RLUSD end-to-end. Ripple's RLUSD issuer hasn't set it yet; demo escrow uses a stand-in IOU while the **payment** leg uses real RLUSD. |

---

## Verified on XRPL testnet

<!-- VERIFIED_TX:START -->
A captured run — agent scored **56 → TIER-2 → $100 ceiling**, on-ledger credId
`8968462C…9842D`. Every link below is a live XRPL testnet transaction:

| Step | Transaction | Explorer |
|---|---|---|
| KYB operator | `CredentialCreate` (`operator_v1`) | [`1D2588FD…4025`](https://testnet.xrpl.org/transactions/1D2588FDD3C9EE1F880F131A27BAA636EB972A3EC0EA84254C0D85107E484025) |
| Bank gate | `AccountSet(asfDepositAuth)` | [`244813D6…FA8E`](https://testnet.xrpl.org/transactions/244813D6B37308AD1BA2A88442D3F56F2438F4D173B3E009A591CA90561FFA8E) |
| Bank gate | `DepositPreauth(AuthorizeCredentials)` | [`AB7FAC05…BF5F`](https://testnet.xrpl.org/transactions/AB7FAC05E6EF67BB281F7A3548D1F4F72009BA02BDBC798A7D373AEA4A9ABF5F) |
| KYA agent | `CredentialCreate` (`agent_trust_v1`) | [`E75A2C23…02EE`](https://testnet.xrpl.org/transactions/E75A2C230BF93947EA4D4DFEC751672D5FB57C005DB38A4FD082D477F94F02EE) |
| FX | DEX cross-currency path payment | [`D2772B1D…E43A`](https://testnet.xrpl.org/transactions/D2772B1DAA4F1FD067109F51A4D4AB2A049155749540AACFC8E4B4BC5F1EE43A) |
| Hold | `EscrowCreate` (held at bank) | [`43A205B8…CDD1`](https://testnet.xrpl.org/transactions/43A205B871581F9863B7B5FD59047F7FB647A4A5DE7EBAFC14FB1230546CCDD1) |
| Release | `EscrowFinish` (certified) | [`2CEF0EE2…5641`](https://testnet.xrpl.org/transactions/2CEF0EE2ABFB9E464D8793D6090198F5B82F33C9AB7FCBFF49B3302A666B5641) |
| Settle | `Payment` → beneficiary | [`B4D97F95…72BF`](https://testnet.xrpl.org/transactions/B4D97F9546DEC44227782B3C3810FC2036A608A25E059CDDFAEA240AC45872BF) |
| **Uncertified** | `EscrowFinish` → **`tecNO_PERMISSION`** | [`A516AC37…7D04`](https://testnet.xrpl.org/transactions/A516AC379C9DB956134F10C6839485ABA915F0912AED1AD91F86C933673F7D04) (its `EscrowCreate`) |
| Skill | `CredentialCreate` (`agent_skill_v1`) | [`36CF85E4…F2F8`](https://testnet.xrpl.org/transactions/36CF85E4AA7FBDCE6493F0C6F2D801E9AC9489703F0E2A04E5B9B61DC126F2F8) |
| Kill-switch | `CredentialDelete` | [`8A720FF5…F189`](https://testnet.xrpl.org/transactions/8A720FF5F8F63035C8542C1EB8082436DF7C0ABCD3676268E1B1C0176E4FF189) |

> Testnet history is periodically pruned — re-run `npm run demo` any time for a fresh set of links.
<!-- VERIFIED_TX:END -->

---

## Architecture

```
src/
  xrpl/    codec · client · wallets · credential (XLS-70) · operator (KYB) · skillCredential
           domain (DepositAuth/Preauth/Permissioned Domain) · bankGate · escrow (XLS-85)
           dex (path payments) · payments · stablecoin
  kya/     scorecard (100-pt, 6-dim) · signals (on-chain) · kyb · underwrite · dossier
  agent/   sdk (mc.*) · demoUC1 (narrated end-to-end) · attest (content hashing) · skills/
  treasury/ server (HTTP API + SSE) · agentStore · paymentStore
web/       React + Vite live demo theater (passport v2, flywheel contrast, SSE timeline)
tests/     unit + opt-in live-testnet suites
```

**Tech stack:** TypeScript (ESM) · xrpl.js v5 · Node 20 · Express · React + Vite · Vitest.

---

## License

[MIT](./LICENSE) © 2026 SunShineMesh.
