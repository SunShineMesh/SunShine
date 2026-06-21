import { useCallback, useEffect, useRef, useState } from 'react';
import { Mesh, type MeshNode } from './Mesh';
import { api, subscribe, explorerAcct, short, type Terms } from './api';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TIERS = ['TIER-1', 'TIER-2', 'TIER-3', 'TIER-4'];
const settleLabel = (asset?: string) => (asset ? (/rlusd|stand-in/i.test(asset) ? 'RLUSD' : asset) : 'RLUSD');
type FeedRow = { kind: string; label: string; hash?: string; url?: string; at: string };
type PaymentState = { id: string; status: string; recipientAddr: string } | null;

export default function App() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  const [agent, setAgent] = useState<{ address: string; did: string } | null>(null);
  const [recipient, setRecipient] = useState<{ address: string; did: string } | null>(null);
  const [payment, setPayment] = useState<PaymentState>(null);
  const [cred, setCred] = useState<{ credId: string; terms: Terms } | null>(null);
  const [skill, setSkill] = useState<{ skillId: string } | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('Idle — run the live demo, or drive each step yourself.');
  const [bureauAddr, setBureauAddr] = useState('');
  const [bureau, setBureau] = useState<{ addr: string; terms: Terms | null } | null>(null);
  const agentRef = useRef<string | null>(null);
  const recipientRef = useRef<string | null>(null);

  // seed an ambient "existing trust graph"
  useEffect(() => {
    const ghosts: MeshNode[] = Array.from({ length: 9 }, (_, i) => ({
      id: 'ghost-' + i, tier: TIERS[Math.floor(Math.random() * TIERS.length)],
      status: 'active', bornAt: performance.now() - 2000 - i * 120,
    }));
    setNodes(ghosts);
  }, []);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    return subscribe((e) => {
      if (e.type === 'tx') setFeed((f) => [{ kind: e.kind, label: e.label, hash: e.hash, url: e.url, at: e.at }, ...f].slice(0, 40));
    });
  }, []);

  const addNode = (id: string, tier: string) =>
    setNodes((ns) => ns.some((n) => n.id === id) ? ns : [...ns, { id, tier, status: 'active', bornAt: performance.now(), focus: true }]);
  const patchNode = (id: string, patch: Partial<MeshNode>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  const createAgent = useCallback(async () => {
    setBusy('create'); setStatus("Funding a fresh agent wallet on XRPL…");
    try {
      const a = await api.createAgent();
      agentRef.current = a.address;
      setAgent(a); setCred(null); setSkill(null); setRevoked(false); setPayment(null);
      addNode(a.address, 'DENIED');
      setBureauAddr(a.address);
      setStatus("Agent created. Send a payment — MeshCredit certifies it and the bank's gate checks it.");
      return a;
    } finally { setBusy(null); }
  }, []);

  const sendPayment = useCallback(async (addr: string) => {
    setBusy('send'); setStatus('KYA → issuing the trust credential → gate check → holding funds at the bank…');
    try {
      let rcpt = recipientRef.current;
      if (!rcpt) { const b = await api.createAgent(); rcpt = b.address; recipientRef.current = rcpt; setRecipient(b); }
      const res: any = await api.initiatePayment(addr, rcpt, '20');
      if (res.error) { setStatus('Declined at the gate: ' + res.error); return; }
      setPayment({ id: res.payment.id, status: res.payment.status, recipientAddr: rcpt });
      const c = await api.credential(addr);
      if (c.credential) setCred({ credId: c.credential.credId, terms: c.credential.terms });
      patchNode(addr, { tier: c.credential?.terms.tier ?? 'TIER-1' });
      setStatus(`Certified · gate ${res.gate?.allowed ? 'ALLOW' : 'DENY'} · $20 held at the bank, awaiting approval.`);
    } finally { setBusy(null); }
  }, []);

  const approvePayment = useCallback(async (addr: string) => {
    setBusy('approve'); setStatus('Bank approves → releasing the escrow → funds flow to the recipient…');
    try {
      if (!payment) return;
      const res: any = await api.approvePayment(payment.id);
      if (res.error) { setStatus('Approve error: ' + res.error); return; }
      setPayment((p) => (p ? { ...p, status: 'released' } : p));
      patchNode(addr, { pulseAt: performance.now() });
      setStatus('Released. A trusted agent was fast-tracked — settled on-ledger, no review queue.');
    } finally { setBusy(null); }
  }, [payment]);

  const certifySkill = useCallback(async (addr: string) => {
    setBusy('skill'); setStatus('Attesting a specialized skill on the same credential rail…');
    try {
      const res: any = await api.certifySkill(addr, 'invoice-reconciliation');
      if (res.error) { setStatus('Skill error: ' + res.error); return; }
      const s = await api.skill(addr);
      if (s.skill) setSkill({ skillId: s.skill.terms.skillId });
      setStatus('Skill certified. One wallet now holds a trust credential AND a skill credential on-ledger.');
    } finally { setBusy(null); }
  }, []);

  const killSwitch = useCallback(async (addr: string) => {
    setBusy('kill'); setStatus('Revoking the credential on-ledger…');
    try {
      const res: any = await api.kill(addr);
      if (res.error) { setStatus('Kill error: ' + res.error); return; }
      patchNode(addr, { status: 'revoked', focus: false });
      setRevoked(true); setCred(null);
      setStatus("Credential revoked in one ledger close — denied at every gated venue at once. In-flight escrows refund to the sender.");
    } finally { setBusy(null); }
  }, []);

  const runDemo = useCallback(async () => {
    if (busy) return;
    setFeed([]);
    const a = await createAgent(); await sleep(700);
    await sendPayment(a.address); await sleep(1100);
    await approvePayment(a.address); await sleep(1100);
    await certifySkill(a.address); await sleep(1100);
    await killSwitch(a.address);
  }, [busy, createAgent, sendPayment, approvePayment, certifySkill, killSwitch]);

  const lookup = useCallback(async (addr: string) => {
    if (!addr) return;
    setBureau(null); setStatus('Reading the XRP Ledger for ' + short(addr) + '…');
    const c = await api.credential(addr.trim());
    setBureau({ addr: addr.trim(), terms: c.credential?.terms ?? null });
    setStatus('Bureau lookup complete — no API key, straight from the ledger.');
  }, []);

  return (
    <>
      <nav className="nav"><div className="wrap nav-in">
        <div className="brand"><span className="dot" />MeshCredit</div>
        <div className="nav-links">
          <a href="#/live">Live demo ↗</a><a href="#console">Console</a><a href="#bureau">Bureau</a><a href="#how">Flow</a><a href="#/how-it-works">How it works ↗</a>
        </div>
        <span className="pill"><span className="live" />{health ? 'XRPL testnet · live' : 'connecting…'}</span>
      </div></nav>

      {/* HERO */}
      <header className="wrap hero">
        <div>
          <div className="eyebrow">Agent financial infrastructure · XRP Ledger</div>
          <h1>The trust bureau for <span className="grad">agent payments.</span></h1>
          <p className="sub">
            When an AI agent sends money cross-border, a bank has no way to know it's trustworthy — so every
            transfer lands in the review queue. MeshCredit issues a <b style={{ color: 'var(--ink)' }}>portable
            trust credential on the ledger</b>; the bank gates its own account on it. A trusted agent is
            fast-tracked — an untrusted one is <b style={{ color: 'var(--ink)' }}>declined by the ledger before
            the bank ever sees it.</b> We issue the score; the bank keeps the decision.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href="#/live">▶ Watch the live cross-border demo</a>
            <button className="btn" onClick={runDemo} disabled={!!busy}>{busy ? 'Running…' : 'Quick console demo'}</button>
          </div>
          <div className="proof">
            <span>Certified · held at the bank · released · revoked on testnet — <b>real transactions</b>, ~4s each.</span>
          </div>
        </div>
        <div className="panel mesh-panel">
          <Mesh nodes={nodes} />
          <div className="mesh-cap">the trust mesh — agents credentialed by one bureau</div>
        </div>
      </header>

      {/* CONSOLE */}
      <section className="section" id="console"><div className="wrap">
        <div className="eyebrow">Console</div>
        <h2>Operate the trust bureau</h2>
        <p className="lede">Every button below is a real XRPL transaction on testnet — settling in {health ? <b style={{ color: 'var(--ink)' }}>{health.asset}</b> : '…'}. Watch the ledger feed and the mesh react in real time.</p>
        <div className="console">
          <div className="panel">
            <div className="panel-head"><span className="panel-title">Agent & credential</span>
              <span className="addr">{health ? `bureau ${short(health.treasury)} · bank ${short(health.bank)}` : ''}</span></div>
            <div className="panel-pad">
              <div className="control-row">
                <button className="btn btn-sm" onClick={() => createAgent()} disabled={!!busy}>1 · New agent</button>
                <button className="btn btn-sm" onClick={() => agent && sendPayment(agent.address)} disabled={!!busy || !agent}>2 · Send $20</button>
                <button className="btn btn-sm" onClick={() => agent && approvePayment(agent.address)} disabled={!!busy || !payment || payment.status === 'released'}>3 · Bank approves</button>
                <button className="btn btn-sm" onClick={() => agent && certifySkill(agent.address)} disabled={!!busy || !agent || revoked}>4 · Certify skill</button>
                <button className="btn btn-sm btn-danger" onClick={() => agent && killSwitch(agent.address)} disabled={!!busy || !agent || revoked}>Kill-switch</button>
              </div>

              {agent ? (
                <div className={'cred' + (revoked ? ' revoked' : '')}>
                  <div className="cred-top">
                    <div>
                      <div className="eyebrow">AgentTrustCredential</div>
                      <div className="tier">{revoked ? 'REVOKED' : (cred?.terms.tier ?? 'PENDING')}</div>
                    </div>
                    <span className={'badge ' + (cred && !revoked ? 'ok' : 'dead')}>{cred && !revoked ? '● on-ledger' : '○ none'}</span>
                  </div>
                  <div className="cred-grid">
                    <div className="metric"><div className="ml">Max payment</div><div className="mv">${cred?.terms.maxTxAmount ?? '—'}</div></div>
                    <div className="metric"><div className="ml">Score</div><div className="mv">{cred?.terms.score ?? '—'}</div></div>
                    <div className="metric"><div className="ml">Settles</div><div className="mv" style={{ fontSize: 15 }}>{settleLabel(health?.asset)}</div></div>
                  </div>
                  <div className="kv" style={{ marginTop: 14 }}><span className="k">agent</span>
                    <a className="addr" href={explorerAcct(agent.address)} target="_blank" rel="noreferrer">{short(agent.address)}</a></div>
                  <div className="kv"><span className="k">payment</span>
                    <span className="v" style={{ color: 'var(--muted)' }}>{payment ? `${payment.status} → ${short(payment.recipientAddr)}` : '—'}</span></div>
                  <div className="kv"><span className="k">skill cred</span>
                    <span className="v" style={{ color: skill ? 'var(--credit)' : 'var(--muted)' }}>{skill ? `● ${skill.skillId}` : '○ none'}</span></div>
                </div>
              ) : (
                <div className="feed-empty">No agent yet. Hit “New agent”, or run the live demo from the hero.</div>
              )}
              <div className="bureau-note" style={{ marginTop: 14 }}>{status}</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><span className="panel-title">Ledger feed</span><span className="addr">testnet.xrpl.org</span></div>
            <div className="feed">
              {feed.length === 0 && <div className="feed-empty">Waiting for on-chain activity…</div>}
              {feed.map((r, i) => (
                <div className={'feed-row ' + (r.kind === 'CredentialDelete' || r.kind === 'EscrowCancel' ? 'kill' : r.kind === 'EscrowFinish' ? 'repay' : r.kind === 'CredentialCreate' ? 'refresh' : '')} key={i}>
                  <span className="tk" />
                  <span className="fl">{r.label}<br /><small>{r.kind} · {new Date(r.at).toLocaleTimeString()}</small></span>
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer">{short(r.hash || '', 6)} ↗</a>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div></section>

      {/* BUREAU */}
      <section className="section" id="bureau"><div className="wrap">
        <div className="eyebrow">Trust Bureau · public</div>
        <h2>Verify any agent, straight from the ledger</h2>
        <p className="lede">A bank, a PSP, or a permissioned venue can check an agent’s standing at transaction time — no account, no API key, no call to us. This is what “portable” means.</p>
        <div className="bureau-box">
          <input value={bureauAddr} onChange={(e) => setBureauAddr(e.target.value)} placeholder="agent XRPL address (r…)" spellCheck={false} />
          <button className="btn btn-primary" onClick={() => lookup(bureauAddr)} disabled={!bureauAddr}>Look up</button>
        </div>
        {bureau && (
          <div className="cred" style={{ marginTop: 18, maxWidth: 520 }}>
            <div className="cred-top">
              <div><div className="eyebrow">On-ledger result</div><div className="tier">{bureau.terms ? bureau.terms.tier : 'NO CREDENTIAL'}</div></div>
              <span className={'badge ' + (bureau.terms ? 'ok' : 'dead')}>{bureau.terms ? '● verified' : '○ not found'}</span>
            </div>
            {bureau.terms && (
              <div className="cred-grid">
                <div className="metric"><div className="ml">Max payment</div><div className="mv">${bureau.terms.maxTxAmount}</div></div>
                <div className="metric"><div className="ml">Score</div><div className="mv">{bureau.terms.score}</div></div>
                <div className="metric"><div className="ml">Ref</div><div className="mv" style={{ fontSize: 14 }}>{bureau.terms.ref.slice(0, 8)}</div></div>
              </div>
            )}
            <div className="kv" style={{ marginTop: 14 }}><span className="k">agent</span>
              <a className="addr" href={explorerAcct(bureau.addr)} target="_blank" rel="noreferrer">{short(bureau.addr)}</a></div>
          </div>
        )}
        <div className="bureau-note">Tip: run the demo, then look up that agent here — you’ll see the same credential the ledger sees (and “not found” after the kill-switch).</div>
      </div></section>

      {/* HOW IT WORKS */}
      <section className="section" id="how"><div className="wrap">
        <div className="eyebrow">The flow</div>
        <h2>One credential, the whole payment</h2>
        <div className="steps">
          {[
            ['01', 'Know Your Agent', 'A transparent 100-point score from off-chain behaviour (model, runtime, World ID) and on-chain history (payments, escrow completion, prior payment success).', 'KYA engine'],
            ['02', 'Issue on-ledger', 'The decision becomes an XLS-70 AgentTrustCredential anchored to the agent’s DID — a tier, a max payment, an expiry, readable by anyone.', 'XLS-70 · XLS-40'],
            ['03', 'Bank gates its account', 'The bank sets DepositAuth + DepositPreauth so only holders of a MeshCredit credential can deliver into its settlement account. The bank owns the gate.', 'DepositPreauth'],
            ['04', 'Held at the bank', 'The agent converts currency on the DEX and escrows the amount into the gated account — funds visibly committed, awaiting approval.', 'DEX · XLS-85'],
            ['05', 'Fast-track or decline', 'Certified → EscrowFinish with CredentialIDs releases. Uncertified → tecNO_PERMISSION, declined by the ledger before the bank’s queue.', 'XLS-70 · XLS-85'],
            ['06', 'Kill-switch', 'On compromise, CredentialDelete removes the credential in one ledger close — denied everywhere at once. In-flight escrows refund to the sender.', 'XLS-70'],
          ].map(([n, h, p, x]) => (
            <div className="step" key={n}>
              <div className="n">{n}</div><h3>{h}</h3><p>{p}</p><div className="xls">{x}</div>
            </div>
          ))}
        </div>
        <div className="cta-row" style={{ marginTop: 24 }}>
          <a className="btn" href="#/how-it-works">Full architecture, diagrams &amp; developer docs →</a>
        </div>
      </div></section>

      {/* THESIS */}
      <section className="section" id="thesis"><div className="wrap">
        <div className="eyebrow">Why this is infrastructure, not a payment company</div>
        <h2>Issue the score, own the rails</h2>
        <p className="lede">Trust is the binding constraint on agent payments: a bank can’t fast-track what it can’t verify. We’re the FICO of agent payments — we issue the credential, the bank keeps the decision, and we never touch the balance sheet.</p>
        <div className="thesis">
          {[
            ['1', 'Trust bureau', 'Issue the portable on-ledger credential — the agent’s entry ticket to gated payment rails. Capital-light: pure attestation.'],
            ['2', 'Bureau read API', 'Any bank or PSP reads an agent’s standing at transaction time, per verification. The FICO pull for machines.'],
            ['3', 'Kill-switch / gate SLA', 'Enterprise revocation SLA with sub-5s cross-venue propagation — zero capital, zero lending risk.'],
            ['4', 'Skills economy', 'The same rail attests specialized agent skills — a credentialed agent labor market (tomorrow’s hireable professionals).'],
            ['5', 'Cross-stablecoin settlement', 'RLUSD-native, USDC/USDT-interoperable. The credential is asset-agnostic; settlement follows the corridor.'],
            ['↗', 'The moat', 'Every honored credential compounds the graph. A copycat can’t replicate the behaviour corpus — and we block delivery without ever seizing funds.'],
          ].map(([n, h, p]) => (
            <div className="layer" key={h}><div className="ln">{n}</div><div><h4>{h}</h4><p>{p}</p></div></div>
          ))}
        </div>
      </div></section>

      <footer><div className="wrap">
        <div className="brand" style={{ marginBottom: 10 }}><span className="dot" />MeshCredit</div>
        <div className="mono">Built on the XRP Ledger · XLS-40 DID · XLS-70 Credentials · XLS-80 DepositPreauth · XLS-85 Escrow · DEX · RLUSD</div>
        <div style={{ marginTop: 8 }}>Demo runs on XRPL testnet — XRP settlement by default; RLUSD on mainnet (one issuer flag away). SwissHacks 2026.</div>
      </div></footer>
    </>
  );
}
