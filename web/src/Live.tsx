// The Live Demo Theater — watch Aria pay across borders, step by step, live on
// XRPL testnet. Every transaction is real; the agent's risk decision is a real
// DeepSeek call. The whole arc streams in over SSE from /api/demo/run.
import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribe, runDemo, type DemoStep } from './api';
import { Passport, type PassportData } from './Passport';

// Default cast (the server re-sends this on demo_start); lets the corridor render before a run.
const CAST = {
  operator: { name: 'Helvetia Components AG', sub: 'Zürich · Switzerland', flag: '🇨🇭', key: 'operator' },
  agent: { name: 'Aria', sub: "Helvetia's procurement agent", flag: '🤖', key: 'agent' },
  bureau: { name: 'MeshCredit', sub: 'trust bureau · issuer', flag: '◇', key: 'bureau' },
  bank: { name: 'Settlement Bank', sub: 'gates its account', flag: '🏦', key: 'bank' },
  payee: { name: 'Lagos Precision Parts', sub: 'Lagos · Nigeria', flag: '🇳🇬', key: 'payee' },
};
const STATIONS = [CAST.operator, CAST.agent, CAST.bureau, CAST.bank, CAST.payee];

// Which actors each step lights up on the corridor.
const ACTORS: Record<string, string[]> = {
  setup: ['operator', 'agent', 'bureau', 'bank', 'payee'],
  kyb: ['operator', 'bureau'], gate: ['bank'], kya: ['agent', 'bureau'],
  reason: ['agent'], fx: ['agent'], escrow: ['agent', 'bank'], gatecheck: ['bank'],
  release: ['agent', 'bank', 'payee'], contrast: ['bank'], skill: ['agent', 'bureau'], kill: ['bureau', 'agent'],
};
const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup', identity: 'Identity', reasoning: 'Agent reasoning',
  payment: 'Cross-border payment', contrast: 'Enforcement', governance: 'Governance', error: 'Error',
};

// Reveal a string progressively — the "watch it think" effect.
function useTypewriter(text: string, speed = 9): string {
  const [n, setN] = useState(0);
  useEffect(() => { setN(0); }, [text]);
  useEffect(() => {
    if (!text || n >= text.length) return;
    const step = Math.max(1, Math.round(text.length / 220)); // finish in ~220 ticks max
    const id = setTimeout(() => setN((x) => Math.min(text.length, x + step)), speed);
    return () => clearTimeout(id);
  }, [text, n, speed]);
  return text.slice(0, n);
}

export default function Live() {
  const [steps, setSteps] = useState<Map<string, DemoStep>>(new Map());
  const [running, setRunning] = useState(false);
  const [brain, setBrain] = useState<string>('deepseek-v4-pro');
  const [summary, setSummary] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { document.title = 'MeshCredit — live cross-border demo'; }, []);

  useEffect(() => subscribe((e: any) => {
    if (e.type === 'demo_accepted') { setSteps(new Map()); setSummary(null); setErr(null); setRunning(true); }
    else if (e.type === 'demo_start') { setSteps(new Map()); setSummary(null); setErr(null); setRunning(true); if (e.brain) setBrain(e.brain); }
    else if (e.type === 'step') {
      setSteps((prev) => {
        const next = new Map(prev);
        const cur = next.get(e.id) ?? { id: e.id, seq: e.seq ?? next.size };
        next.set(e.id, { ...cur, ...e, data: { ...(cur as any).data, ...(e.data ?? {}) } } as DemoStep);
        return next;
      });
    } else if (e.type === 'demo_done') { setRunning(false); setSummary(e); if (e.error) setErr(e.error); }
  }), []);

  const stepsArr = useMemo(() => [...steps.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), [steps]);
  const activeStep = useMemo(() => [...stepsArr].reverse().find((s) => s.status === 'active') ?? stepsArr[stepsArr.length - 1], [stepsArr]);
  const liveActors = new Set(activeStep ? ACTORS[activeStep.id] ?? [] : []);
  const kya = steps.get('kya');
  const kill = steps.get('kill');
  const reason = steps.get('reason');
  const passport: PassportData | null = kya?.data ? { ...(kya.data as any), revoked: !!kill?.tx } : null;
  const txs = stepsArr.filter((s) => s.tx).map((s) => ({ ...s.tx!, id: s.id }));
  const start = async () => { setErr(null); const r = await runDemo(); if (r?.error) { setErr(r.error); setRunning(false); } };

  return (
    <>
      <nav className="nav"><div className="wrap nav-in">
        <a className="brand" href="#/" style={{ textDecoration: 'none' }}><span className="dot" />MeshCredit</a>
        <div className="nav-links">
          <a href="#/">Home</a><a href="#/how-it-works">How it works ↗</a>
        </div>
        <span className="pill"><span className="live" />{running ? 'running · XRPL testnet' : 'XRPL testnet · live'}</span>
      </div></nav>

      <header className="wrap live-hero">
        <div className="eyebrow">Live demo · everything below is a real testnet transaction</div>
        <h1>Watch <span className="grad">Aria</span> pay across borders.</h1>
        <p className="sub">
          A Swiss company's AI agent pays a supplier in Lagos through a bank that gates its account on an
          on-ledger MeshCredit credential. The agent reasons with a real LLM, earns its trust passport, and
          settles — while an uncertified agent is refused by the ledger itself. ~90 seconds, nothing mocked.
        </p>
        <div className="live-cta">
          <button className="btn btn-primary" onClick={start} disabled={running}>{running ? 'Running the arc…' : '▶  Run the live cross-border demo'}</button>
          <span className="live-meta">agent brain: <b>{brain}</b> · settlement on testnet</span>
        </div>
      </header>

      {/* The corridor — the signature journey strip */}
      <div className="wrap"><div className="corridor">
        {STATIONS.map((s, i) => (
          <div className="corr-cell" key={s.key}>
            <div className={'station' + (liveActors.has(s.key) ? ' on' : '') + (running ? '' : ' idle')}>
              <div className="st-flag">{s.flag}</div>
              <div className="st-name">{s.name}</div>
              <div className="st-sub">{s.sub}</div>
            </div>
            {i < STATIONS.length - 1 && <div className={'corr-link' + (running ? ' flowing' : '')} aria-hidden><span /></div>}
          </div>
        ))}
      </div></div>

      {summary && (
        <div className="wrap"><div className={'verdict ' + (summary.ok ? 'pass' : 'fail')}>
          {summary.ok
            ? <>✓ <b>Settled.</b> {CAST.agent.name} ({summary.summary?.tier}) was fast-tracked to Lagos; the uncertified agent was denied by consensus.</>
            : <>✕ Run ended early{err ? `: ${err}` : ''}.</>}
        </div></div>
      )}

      <main className="wrap live-grid">
        {/* left — the step timeline */}
        <section className="timeline" ref={timelineRef}>
          {stepsArr.length === 0 && (
            <div className="tl-empty">
              <div className="tl-empty-d">▶</div>
              Press <b>Run the live cross-border demo</b> — each step appears here as it lands on the ledger.
            </div>
          )}
          {stepsArr.map((s) => <StepCard key={s.id} s={s} />)}
        </section>

        {/* right — the agent mind + the trust passport */}
        <aside className="rail">
          <MindPanel reason={reason} running={running} brain={brain} />
          {passport ? <Passport d={passport} /> : <Passport d={{}} pending />}
          {txs.length > 0 && (
            <div className="tape">
              <div className="tape-h">On-ledger transactions <span>{txs.length}</span></div>
              {txs.map((t, i) => (
                <a className="tape-row" key={t.id + i} href={t.url} target="_blank" rel="noreferrer">
                  <span className="tape-kind">{t.kind}</span>
                  <span className="tape-lbl">{t.label}</span>
                  <span className="tape-arr">↗</span>
                </a>
              ))}
            </div>
          )}
        </aside>
      </main>

      <footer><div className="wrap">
        <a className="brand" href="#/" style={{ marginBottom: 10, textDecoration: 'none' }}><span className="dot" />MeshCredit</a>
        <div className="mono">XLS-40 DID · XLS-70 Credentials · XLS-80 DepositPreauth · XLS-85 Escrow · DEX · real DeepSeek agent reasoning</div>
        <div style={{ marginTop: 8 }}>Every transaction shown is validated on XRPL testnet. <a href="#/" style={{ color: 'var(--mesh-1)' }}>← Back to the console</a></div>
      </div></footer>
    </>
  );
}

// ── the agent mind panel — the real LLM reasoning, surfaced ──
function MindPanel({ reason, running, brain }: { reason?: DemoStep; running: boolean; brain: string }) {
  const data = reason?.data as any;
  const thinking = reason?.status === 'active';
  const reasoning = data?.reasoning ?? '';
  const typed = useTypewriter(thinking ? '' : reasoning);
  const decision = data?.decision as string | undefined;
  return (
    <div className={'mind' + (thinking ? ' thinking' : '')}>
      <div className="mind-h">
        <span className="mind-dot" />
        <span className="mind-title">Aria · agent reasoning</span>
        <span className="mind-model">{data?.fallback ? 'fallback' : brain}</span>
      </div>
      {!reason && <div className="mind-idle">The agent reasons about the payment before it moves money. Its verdict appears here — and actually gates the next step.</div>}
      {thinking && <div className="mind-idle thinking-line">thinking<span className="dots"><i>.</i><i>.</i><i>.</i></span></div>}
      {!thinking && reasoning && (
        <div className="mind-chain">{typed}<span className="caret">▌</span></div>
      )}
      {!thinking && decision && (
        <div className="mind-verdict">
          <span className={'verdict-pill ' + (decision === 'PROCEED' ? 'go' : 'hold')}>{decision === 'PROCEED' ? '✓ PROCEED' : '✋ HOLD'}</span>
          <span className="mind-rationale">{data?.rationale}</span>
          {data?.ms ? <span className="mind-lat">{(data.ms / 1000).toFixed(1)}s · {data.model}</span> : null}
        </div>
      )}
    </div>
  );
}

// ── a single step card in the timeline ──
function StepCard({ s }: { s: DemoStep }) {
  const icon = s.status === 'active' ? <span className="sc-spin" /> : s.status === 'denied' ? '✕' : s.status === 'info' ? '◌' : '✓';
  return (
    <div className={'step-card ' + s.status}>
      <div className="sc-rail"><span className="sc-icon">{icon}</span></div>
      <div className="sc-body">
        <div className="sc-top">
          <span className="sc-phase">{PHASE_LABEL[s.phase] ?? s.phase}</span>
          <span className="sc-actor">{s.actor}</span>
        </div>
        <div className="sc-title">{s.title}</div>
        {s.body && <div className="sc-text">{s.body}</div>}
        <StepData s={s} />
        {s.tx && (
          <a className="sc-tx" href={s.tx.url} target="_blank" rel="noreferrer">
            <span className="sc-tx-kind">{s.tx.kind}</span>{s.tx.label}<span className="sc-tx-arr"> ↗</span>
          </a>
        )}
      </div>
    </div>
  );
}

// step-specific rich data
function StepData({ s }: { s: DemoStep }) {
  const d = s.data as any;
  if (!d) return null;
  switch (s.id) {
    case 'kyb':
      return <div className="sc-chips"><Chip k="business tier" v={d.btier} /><Chip k="delegated cap" v={`$${d.maxDelegatedSpend}`} /><Chip k="jurisdiction" v={d.jurisdiction} /></div>;
    case 'kya':
      return <div className="sc-chips"><Chip k="score" v={d.score} accent /><Chip k="tier" v={d.tier} accent /><Chip k="ceiling" v={`$${d.maxTxAmount}`} /></div>;
    case 'gatecheck':
      return <div className="sc-chips"><Chip k="amount" v={`$${d.amount}`} /><Chip k="ceiling" v={`$${d.maxTxAmount}`} /><Chip k={d.allowed ? 'gate' : 'gate'} v={d.allowed ? 'ALLOW' : 'DENY'} good={d.allowed} bad={!d.allowed} /></div>;
    case 'reason':
      return d.decision ? <div className="sc-chips"><Chip k="agent decision" v={d.decision} good={d.decision === 'PROCEED'} bad={d.decision !== 'PROCEED'} /></div> : null;
    case 'codeswap':
      return <div className="sc-chips"><Chip k="audited build" v="recognized" good /><Chip k="tampered build" v="rejected" bad /></div>;
    case 'contrast':
      return <div className="sc-chips"><Chip k="ledger verdict" v={d.code ?? 'tecNO_PERMISSION'} bad /></div>;
    case 'kill':
      return <div className="sc-chips"><Chip k="gate after revoke" v={d.gateAllowed ? 'ALLOW' : 'DENY'} bad={!d.gateAllowed} /></div>;
    default:
      return null;
  }
}

function Chip({ k, v, accent, good, bad }: { k: string; v: any; accent?: boolean; good?: boolean; bad?: boolean }) {
  return (
    <span className={'chip' + (accent ? ' accent' : '') + (good ? ' good' : '') + (bad ? ' bad' : '')}>
      <span className="chip-k">{k}</span><span className="chip-v">{String(v ?? '—')}</span>
    </span>
  );
}
