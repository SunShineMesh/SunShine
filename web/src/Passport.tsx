// The trustworthiness passport — the agent's on-ledger XLS-70 trust credential,
// rendered as the product's hero artifact. Purely presentational.
import { explorerAcct, short } from './api';

export interface PassportData {
  agent?: string;
  did?: string;
  issuer?: string;
  credId?: string;
  score?: number;
  tier?: string;
  maxTxAmount?: string;
  ih?: string;
  sh?: string;
  op?: string;
  ref?: string;
  exp?: number;
  breakdown?: { label: string; pts: number; max: number; src: string }[];
  revoked?: boolean;
}

const TIER_COLOR: Record<string, string> = {
  DENIED: 'var(--faint)', 'TIER-1': 'var(--signal)', 'TIER-2': 'var(--mesh-1)',
  'TIER-3': 'var(--mesh-2)', 'TIER-4': 'var(--credit)',
};
const SRC_COLOR: Record<string, string> = { 'off-chain': 'var(--mesh-1)', 'on-chain': 'var(--credit)', KYB: 'var(--mesh-2)' };

function Ring({ score, color }: { score: number; color: string }) {
  const R = 34, C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(score, 100)) / 100;
  return (
    <svg className="pp-ring" viewBox="0 0 80 80" width="80" height="80" aria-hidden>
      <circle cx="40" cy="40" r={R} fill="none" stroke="var(--line)" strokeWidth="6" />
      <circle cx="40" cy="40" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 40 40)" style={{ transition: 'stroke-dasharray .9s cubic-bezier(.2,.8,.2,1)' }} />
      <text x="40" y="38" textAnchor="middle" className="pp-ring-num">{score}</text>
      <text x="40" y="52" textAnchor="middle" className="pp-ring-lbl">/ 100</text>
    </svg>
  );
}

export function Passport({ d, pending }: { d: PassportData; pending?: boolean }) {
  const tier = d.revoked ? 'REVOKED' : d.tier ?? 'PENDING';
  const color = d.revoked ? 'var(--danger)' : TIER_COLOR[d.tier ?? ''] ?? 'var(--credit)';
  if (pending) {
    return (
      <div className="passport pending">
        <div className="pp-wait">
          <span className="pp-chip">XLS-70 · agent_trust_v1</span>
          <div className="pp-wait-t">Trust passport not yet minted</div>
          <div className="pp-wait-d">It materializes on-ledger the moment KYA completes.</div>
        </div>
      </div>
    );
  }
  return (
    <div className={'passport' + (d.revoked ? ' revoked' : '')}>
      <div className="pp-glow" style={{ background: `radial-gradient(120% 120% at 0% 0%, ${color}22, transparent 60%)` }} />
      <div className="pp-head">
        <div>
          <div className="pp-chip">XLS-70 · agent_trust_v1</div>
          <div className="pp-tier" style={{ color }}>{tier}</div>
        </div>
        <Ring score={d.score ?? 0} color={color} />
      </div>

      <div className="pp-metrics">
        <div className="pp-metric"><div className="ppm-l">Max payment</div><div className="ppm-v">${d.maxTxAmount ?? '—'}</div></div>
        <div className="pp-metric"><div className="ppm-l">Trust score</div><div className="ppm-v">{d.score ?? '—'}</div></div>
        <div className="pp-metric"><div className="ppm-l">Status</div><div className="ppm-v" style={{ fontSize: 15, color }}>{d.revoked ? '○ revoked' : '● on-ledger'}</div></div>
      </div>

      {d.breakdown && (
        <div className="pp-break">
          <div className="pp-break-h">Why this score — every point is legible</div>
          {d.breakdown.map((b) => (
            <div className="pp-bar" key={b.label} title={`${b.label}: ${b.pts}/${b.max}`}>
              <span className="ppb-l">{b.label}</span>
              <span className="ppb-track"><span className="ppb-fill" style={{ width: `${(b.pts / b.max) * 100}%`, background: SRC_COLOR[b.src] ?? 'var(--credit)' }} /></span>
              <span className="ppb-pts">{b.pts}<small>/{b.max}</small></span>
            </div>
          ))}
        </div>
      )}

      <div className="pp-fields">
        {d.did && <Field k="did" v={d.did} mono />}
        {d.credId && <Field k="credId" v={short(d.credId, 10)} mono />}
        {d.ref && <Field k="dossier ref" v={d.ref} mono />}
        <div className="pp-hashes">
          {d.ih && <span className="pp-hash" title="harness hash prefix">ih {d.ih}</span>}
          {d.sh && <span className="pp-hash" title="skill hash prefix">sh {d.sh}</span>}
          {d.op && <span className="pp-hash" title="operator credential link">op {d.op}</span>}
        </div>
      </div>

      {d.agent && (
        <a className="pp-foot" href={explorerAcct(d.agent)} target="_blank" rel="noreferrer">
          read it on-ledger — no API key ↗
        </a>
      )}
    </div>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="pp-field">
      <span className="ppf-k">{k}</span>
      <span className={'ppf-v' + (mono ? ' mono' : '')}>{v}</span>
    </div>
  );
}
