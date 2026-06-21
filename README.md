# MeshCredit

**An on-ledger trust bureau for AI agents — built on the XRP Ledger.**

MeshCredit is the *Equifax of the agent economy*. It runs **Know-Your-Agent (KYA)** and
**Know-Your-Business (KYB)** checks on an autonomous agent and its operator, then issues the
verdict as a **tamper-evident credential that lives on the XRP Ledger** (XLS-70). Any bank,
merchant, or counterparty can read that credential straight from the ledger — no API key, no
phone-home — and, crucially, **enforce it at consensus**: an uncertified agent's payment is
rejected by the validators themselves with `tecNO_PERMISSION`, before any application code runs.

> **The product is the credential.** Cross-border agent payments are use case #1 — the first
> place where "is this agent allowed to move this money?" has to be answered by the rails, not
> by a dashboard.

> 🏆 Built for **SwissHacks 2026 · Ripple challenge — Know Your Agent (KYA)**. Runs on XRPL
> **testnet** with real transactions; every primitive used is live or one amendment-flag away
> from mainnet.

---

## 📺 Demo video

> _Walkthrough video coming soon — link will be added here._

A fully narrated, end-to-end run prints a live explorer link for **every** on-chain action:

```bash
npm run demo
```

---

## Why this is different

Everyone agrees agents need identity and reputation. The question is **where it is enforced.**

| | Typical agent-trust stack | **MeshCredit** |
|---|---|---|
| Where trust lives | a row in a vendor's database | an **XLS-70 credential on the ledger** |
| How it's checked | an API call the relying party must trust | read directly from the ledger, no API key |
| Where it's **enforced** | application layer (a layer *above* the money) | **at consensus** — validators reject the tx |
| Kill-switch | revoke in a DB, hope every integrator honors it | `CredentialDelete` — denied everywhere in one ~4 s close |
| Identity of the *business* | usually ignored | **KYB** operator credential + delegated spend cap |

Competing approaches (t54, Experian's agent work, ERC-8004) enforce one layer up, in software a
counterparty has to trust. MeshCredit pushes enforcement **into the ledger**: the credential and
the gate are the same primitive, so the rule cannot be skipped by a buggy or malicious integrator.

---

## Clear demonstration of on-chain transactions

`npm run demo` executes the full cross-border arc on XRPL testnet. The scenario:

> **Helvetia Components AG** (a KYB-verified operator in Zürich 🇨🇭) runs an AI procurement
> **agent, "Aria,"** which must pay **Lagos Precision Parts Ltd** (Lagos 🇳🇬) through a **bank
> that gates its settlement account on a MeshCredit credential.** A trustworthy agent is
> fast-tracked; an uncertified one is declined *by the ledger* before the bank ever sees it.

Every step below is a **real transaction** — no mocks in the settlement path:

| # | On-chain action | XRPL transaction | What it proves |
|---|---|---|---|
| 1 | KYB the operator | `CredentialCreate` (`operator_v1`) | the *business* is verified, with a delegated spend cap |
| 2 | Bank stands up its gate | `AccountSet(asfDepositAuth)` + `DepositPreauth(AuthorizeCredentials)` | the relying party requires a MeshCredit credential |
| 3 | KYA the agent | `CredentialCreate` (`agent_trust_v1`) | score → tier → on-ledger limit + content attestation |
| 4 | Convert currency | DEX cross-currency **path payment** | FX with zero bureau involvement |
| 5 | Funds held at the bank | `EscrowCreate` | money is committed, visible, not yet released |
| 6 | Gate check | `ledger_entry` credential read | credential + amount verified against tier |
| 7 | Release to beneficiary | `EscrowFinish` + `Payment` | certified agent settles to Lagos |
| 8 | Code-swap caught | content-hash re-check | a tampered skill no longer matches the on-ledger `sh` |
| 9 | **Uncertified agent tries the same** | `EscrowFinish` → **`tecNO_PERMISSION`** | **declined by the ledger**, before the bank's queue |
| 10 | Skill credential | `CredentialCreate` (`agent_skill_v1`) | the same rail attests specialized skills |
| 11 | Kill-switch | `CredentialDelete` | one delete → denied at every gated venue at once |

A second script proves the gate against **real testnet RLUSD** on the payment leg:

```bash
npm run smoke:rlusd-gate    # certified Payment → tesSUCCESS; uncertified → tecNO_PERMISSION
```

### Verified on XRPL testnet

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

## XRPL features and amendments used

| Feature / amendment | How MeshCredit uses it |
|---|---|
| **XLS-70 Credentials** | The core product. `CredentialCreate` / `CredentialAccept` / `CredentialDelete`, read via `ledger_entry`. Three credential types: KYA (`agent_trust_v1`), KYB (`operator_v1`), skill (`agent_skill_v1`). |
| **DepositAuth** (`asfDepositAuth`) | The bank locks its settlement account so only authorized senders can pay in — the basis of consensus-level enforcement. |
| **DepositPreauth** with `AuthorizeCredentials` | Pre-authorizes *anyone holding a MeshCredit credential* instead of named accounts. The `CredentialIDs` field on the spending tx is what the validators check. |
| **XLS-80 Permissioned Domains** | Groups acceptable credentials into a domain so a venue can say "members only" by credential, not by allow-list. |
| **XLS-85 Token Escrow** | `EscrowCreate` / `EscrowFinish` hold the settlement "at the bank." Releasing requires the credential — the gate and the escrow are one mechanism. Supports `PREIMAGE-SHA-256` crypto-conditions. |
| **DEX cross-currency path payments** | The agent's source currency is auto-routed to the destination currency through the order book — the FX leg of the cross-border payment. |
| **did:xrpl** | The agent's credential is anchored to its decentralized identifier, so reputation survives re-registration. |
| **`asfAllowTrustLineLocking`** | The single mainnet flag that makes the escrow leg native-RLUSD end-to-end. Ripple's RLUSD issuer doesn't set it *yet*, so the demo's escrow leg uses a stand-in USD IOU while the **payment** leg uses real RLUSD (see Settlement). |

---

## Demonstration of AI agent interaction with XRPL

The agent is a **first-class XRPL account that signs its own transactions.** MeshCredit gives it a
few-line SDK so an agent can earn, carry, and use an on-ledger trust credential:

```ts
import { MeshCredit } from 'meshcredit';

const mc = new MeshCredit();                          // points at the treasury endpoint
await mc.register();                                  // KYA → on-ledger agent_trust_v1 credential
const { payment } = await mc.payment.initiate(payee, '50');  // funds held at the bank's gate (EscrowCreate)
await mc.payment.approve(payment.id);                 // released only if the credential is valid (EscrowFinish)

const cred = await mc.credential();                   // read the agent's on-ledger credential — no API key
await mc.skill.certify('invoice-reconciliation');     // attest a specialized skill (a 2nd credential)
```

What "the agent interacting with XRPL" concretely means here:

- **It holds its own key** and signs `EscrowCreate` / `EscrowFinish` / `Payment` itself — the
  treasury never moves money on its behalf, it only *issues the credential*.
- **It reads the ledger** to prove its own standing (`ledger_entry`) and to check counterparties.
- **It is governed by the ledger**: the same agent, once its credential is revoked, is rejected at
  consensus on its very next attempt — the autonomy and the leash are both on-chain.

> **Real agent reasoning:** the demo agent makes its decisions through a live LLM
> (DeepSeek, OpenAI-SDK compatible) rather than hard-coded branches — wired via `src/config.ts`
> and a gitignored `.env`. See `.env.example`.

---

## Quickstart

```bash
# 1. install
npm install

# 2. unit tests — pure logic: codec, KYA/KYB scorecards, dossier, attestation (113 tests)
npm test

# 3. the narrated end-to-end demo on XRPL testnet (self-funds wallets, prints explorer links)
npm run demo

# 4. live testnet integration tests
npm run test:testnet

# 5. run the product (two terminals, or use ./start.sh)
npm run server                 # treasury API on :8787 (funds wallets on boot)
npm --prefix web run dev       # product console on :5173  → http://localhost:5173

# 6. prove the gate against real testnet RLUSD
npm run smoke:rlusd-gate

# (optional) settle in an RLUSD stand-in IOU instead of XRP
npm run setup:stablecoin       # provisions the issuer + flags; prints the .env lines to add
```

`./start.sh` launches the treasury API and the web console together (Ctrl+C stops both).

Then open **http://localhost:5173/#/live** — the **Live Demo Theater** runs the whole
cross-border arc on testnet and visualizes every agent step, the agent's **real LLM reasoning**
(DeepSeek), and the trust passport as they happen.

---

## How a credential is decided

KYA produces a transparent **100-point score** that fuses off-chain signals (World ID, runtime
stability, transcript coherence, source provenance, human-completion, operator backing) with
**on-chain XRPL history** (account age from the first ledger transaction, activity). The score maps
to a tier, and the tier sets the agent's on-ledger transaction ceiling:

| Score | Tier | Max tx amount |
|---|---|---|
| ≥ 85 | TIER-4 | $2000 |
| ≥ 70 | TIER-3 | $500 |
| ≥ 50 | TIER-2 | $100 |
| ≥ 30 | TIER-1 | $25 |
| < 30 | DENIED | — |

**Content attestation (honest L3).** The credential records 8-char prefixes of the SHA-256 hashes
of the agent's *harness* (`ih`) and *skill* (`sh`) bytes. A relying party recomputes and compares:
a swapped or tampered runtime no longer matches and is flagged. This is **version-pinning and
accountability — not a trusted execution environment**; it proves *which code* was certified, not
that the code ran untampered.

**Content-addressed dossier.** Every decision is backed by an off-chain dossier whose `ref` is a
recursive canonical hash binding *all* of its contents. The credential carries the `ref`; the full
dossier is served at `GET /api/dossier/:ref`. Change one signal, get a different `ref`.

---

## Settlement

The credential is **asset-agnostic**. The demo runs two paths:

- **XRP (default, zero setup).** The escrow leg settles in XRP — simplest to reproduce.
- **Real RLUSD on the gated payment leg (Option B).** `npm run smoke:rlusd-gate` issues the
  credential-gated `Payment` in **real testnet RLUSD**: a certified agent gets `tesSUCCESS`, an
  uncertified one gets `tecNO_PERMISSION`. The escrow leg uses a stand-in USD IOU only because
  Ripple's testnet RLUSD issuer hasn't set `asfAllowTrustLineLocking` yet — the **one flag** that
  closes the gap to a fully native-RLUSD path on mainnet.

---

## Architecture

```
src/
  xrpl/        codec · client · wallets · credential (XLS-70) · operator (KYB) · skillCredential
               domain (DepositAuth/Preauth/Permissioned Domain) · bankGate · escrow (XLS-85)
               dex (path payments) · payments · stablecoin
  kya/         scorecard (100-pt) · signals (on-chain) · kyb · underwrite · dossier (content-addressed)
  agent/       sdk (mc.*) · demoUC1 (narrated end-to-end) · attest (content hashing) · skills/
  treasury/    server (HTTP API + SSE) · agentStore · paymentStore
web/           React + Vite product console (live bureau lookup + event stream)
tests/         unit + opt-in live-testnet suites
smoke-rlusd-gate.ts   Option-B: the gate against real testnet RLUSD
```

**Tech stack:** TypeScript (ESM) · xrpl.js v5 · Node 20 · Express · React + Vite · Vitest.

---

## License

[MIT](./LICENSE) © 2026 SunShineMesh.
