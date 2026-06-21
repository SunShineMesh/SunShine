// One-time setup for the RLUSD stand-in settlement asset (the XLS-85 escrow stretch).
//
//   npm run setup:stablecoin
//
// Funds (or reloads) an 'issuer' wallet on testnet and sets the two AccountSet
// flags that make it a usable stablecoin issuer:
//   - asfDefaultRipple        — let the IOU ripple between holders
//   - asfAllowTrustLineLocking — UNLOCKS XLS-85 token escrow (mainnet RLUSD's
//                                issuer has this FALSE; that's the one-flag gap)
//
// Then prints the exact lines to drop into meshcredit/.env so the server, demo,
// and console settle in this IOU ("RLUSD stand-in") instead of XRP.
import { getClient, closeClient } from './client.js';
import { loadOrFund } from './wallets.js';
import { setupStablecoin } from './stablecoin.js';
import { CONFIG } from '../config.js';

// Account-root ledger flags (lsf*) we expect after setup.
const LSF_DEFAULT_RIPPLE = 0x00800000;
const LSF_ALLOW_TRUSTLINE_LOCKING = 0x40000000;
const CCY = process.env.STABLE_CCY ?? 'USD';

async function main() {
  const c = await getClient();
  console.log(`\nMeshCredit — stablecoin (RLUSD stand-in) setup on ${CONFIG.network}\n`);

  const issuer = await loadOrFund(c, 'issuer');
  console.log(`  issuer wallet: ${issuer.address}`);
  console.log(`  setting asfDefaultRipple + asfAllowTrustLineLocking…`);
  await setupStablecoin(c, issuer);

  // Verify the flags actually landed on the ledger before we tell the user to trust it.
  const info: any = await c.request({ command: 'account_info', account: issuer.address, ledger_index: 'validated' });
  const flags = Number(info.result.account_data.Flags);
  const defaultRipple = (flags & LSF_DEFAULT_RIPPLE) !== 0;
  const trustlineLocking = (flags & LSF_ALLOW_TRUSTLINE_LOCKING) !== 0;
  console.log(`  verified: DefaultRipple=${defaultRipple}  AllowTrustLineLocking=${trustlineLocking}`);
  if (!defaultRipple || !trustlineLocking) {
    throw new Error('flags did not set as expected — re-run setup:stablecoin');
  }

  console.log(`\n  ${CONFIG.explorerAcct(issuer.address)}`);
  console.log(`\nAdd these to meshcredit/.env (then restart the server) to settle in the RLUSD stand-in:\n`);
  console.log(`  STABLE_ISSUER=${issuer.address}`);
  console.log(`  STABLE_CCY=${CCY}\n`);
  console.log('XRP stays the default if STABLE_ISSUER is unset.\n');

  await closeClient();
}

main().catch(async (e) => {
  console.error('\nsetup:stablecoin FAILED:', e?.message || e);
  await closeClient();
  process.exitCode = 1;
});
