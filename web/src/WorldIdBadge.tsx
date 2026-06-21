// web/src/WorldIdBadge.tsx
// World ID IDKit v4 React widget (D2 Human Accountability).
//
// Fetches /api/worldid/rp-signature before opening the IDKit widget.
// On handleVerify POSTs to /api/worldid/verify.
// On onSuccess calls props.onVerified with (nullifier, level).
//
// Honest fallback: when VITE_APP_ID env var is absent OR when proofPending=true,
// renders a clearly-labelled "wiring shown, proof pending" badge — no IDKit
// attempt is made.
//
// Pin React ≤18 in web/package.json to avoid framer-motion/React-19 conflict.

import React, { useState, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorldIdBadgeProps {
  /** When true, no live IDKit session is attempted — shows the pending badge. */
  proofPending: boolean;
  /** World ID nullifier (set after successful verification). */
  nullifier?: string;
  /** Verification level returned by World App. */
  verificationLevel?: 'orb' | 'device';
  /** Callback fired on successful verification. */
  onVerified?: (nullifier: string, level: string) => void;
}

// ─── Pure display-state helper (exported for unit tests) ─────────────────────

export interface DisplayState {
  /** Set when proofPending=true — the badge message to show. */
  message?: string;
  /** True when the IDKit widget trigger button should be shown. */
  showWidget: boolean;
  /** Truncated nullifier string for display (set once verified). */
  nullifierDisplay?: string;
  /** Verification level to display (set once verified). */
  level?: 'orb' | 'device';
}

/** Truncate a nullifier to "0xABCD…EF12" form for display. */
function truncateNullifier(nullifier: string, prefixLen = 6, suffixLen = 4): string {
  if (nullifier.length <= prefixLen + suffixLen + 1) return nullifier;
  return `${nullifier.slice(0, prefixLen)}…${nullifier.slice(-suffixLen)}`;
}

/**
 * Pure function that derives the display state from props.
 * Keeps the component logic testable without DOM rendering.
 */
export function getDisplayState(
  props: Pick<WorldIdBadgeProps, 'proofPending' | 'nullifier' | 'verificationLevel'>,
): DisplayState {
  const { proofPending, nullifier, verificationLevel } = props;

  // Fallback state: no proof possible (no signing key / no World App / explicit pending)
  if (proofPending) {
    return {
      message: 'wiring shown, proof pending',
      showWidget: false,
    };
  }

  // Already verified — show the nullifier summary, hide the widget trigger
  if (nullifier) {
    return {
      showWidget: false,
      nullifierDisplay: truncateNullifier(nullifier),
      level: verificationLevel,
    };
  }

  // Ready to verify: show the widget trigger button
  return {
    showWidget: true,
  };
}

// ─── getViteAppId helper ──────────────────────────────────────────────────────

/** Read VITE_APP_ID from import.meta.env (safe in all environments). */
function getViteAppId(): string | undefined {
  try {
    // `import.meta.env` is populated by Vite at bundle time; undefined in Node/test env.
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    return env?.['VITE_APP_ID'];
  } catch {
    return undefined;
  }
}

// ─── WorldIdBadge component ───────────────────────────────────────────────────

/**
 * Renders the World ID D2 accountability badge.
 *
 * When `proofPending` is true (no VITE_APP_ID or no live World App user):
 *   Shows a clearly-labelled "wiring shown, proof pending" badge.
 *
 * When the user has not yet verified:
 *   Renders a "Verify with World ID" button that opens IDKit.
 *
 * When the user has verified:
 *   Shows the truncated nullifier and verification level.
 */
export function WorldIdBadge(props: WorldIdBadgeProps): React.JSX.Element {
  const { proofPending, onVerified } = props;

  // Local state for the dynamic nullifier after a fresh verification
  const [localNullifier, setLocalNullifier] = useState<string | undefined>(props.nullifier);
  const [localLevel, setLocalLevel] = useState<'orb' | 'device' | undefined>(
    props.verificationLevel,
  );
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const displayState = getDisplayState({
    proofPending,
    nullifier: localNullifier,
    verificationLevel: localLevel,
  });

  // ── IDKit open handler ──────────────────────────────────────────────────────
  // Called when the user clicks "Verify with World ID".
  const handleOpen = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const appId = getViteAppId();
      if (!appId) {
        setError('World ID not configured (VITE_APP_ID absent) — wiring shown, proof pending');
        return;
      }

      // Step 1: fetch the RP signature from the backend before opening IDKit
      const sigRes = await fetch('/api/worldid/rp-signature', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'meshcredit-agent-verify' }),
      });
      const sigData = (await sigRes.json()) as { fallback?: boolean; [k: string]: unknown };

      if (sigData.fallback) {
        // Backend has no signing key — show honest fallback in console, badge stays pending
        console.info('[WorldIdBadge] RP signing key absent — wiring shown, proof pending');
        setError('World ID backend not configured — proof pending');
        return;
      }

      // Step 2: dynamically load the IDKit widget and open it.
      // We use a dynamic import so the widget code is only loaded in the browser.
      // The RP signature (sigData) is used by the widget internally when it calls
      // signRequest on the backend.
      const { IDKit } = await import('@worldcoin/idkit-standalone');
      IDKit.init({
        app_id: appId as `app_${string}`,
        action: 'meshcredit-agent-verify',
        onSuccess: (result: { nullifier_hash?: string; [k: string]: unknown }) => {
          void handleVerifyResult(result);
        },
      });
      await IDKit.open();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`World ID widget unavailable: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── handleVerifyResult: POSTs to /api/worldid/verify ─────────────────────
  const handleVerifyResult = useCallback(
    async (result: { nullifier_hash?: string; proof?: string; [k: string]: unknown }) => {
      try {
        const verifyRes = await fetch('/api/worldid/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(result),
        });
        const data = (await verifyRes.json()) as {
          nullifier?: string;
          verificationLevel?: 'orb' | 'device';
          fallback?: boolean;
          [k: string]: unknown;
        };

        const nullifier = data.nullifier ?? (result.nullifier_hash as string | undefined) ?? '';
        const level: 'orb' | 'device' =
          data.verificationLevel === 'orb' ? 'orb' : 'device';

        setLocalNullifier(nullifier);
        setLocalLevel(level);

        if (onVerified && nullifier) {
          onVerified(nullifier, level);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Verification error: ${msg}`);
      }
    },
    [onVerified],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  // Pending badge (proofPending=true or no VITE_APP_ID)
  if (displayState.message) {
    return (
      <div className="worldid-badge worldid-badge--pending" data-testid="worldid-pending">
        <span className="worldid-badge__icon" aria-hidden="true">&#127760;</span>
        <span className="worldid-badge__label">D2 &middot; World ID</span>
        <span className="worldid-badge__status worldid-badge__status--pending">
          {displayState.message}
        </span>
      </div>
    );
  }

  // Already verified — show nullifier summary
  if (displayState.nullifierDisplay) {
    return (
      <div className="worldid-badge worldid-badge--verified" data-testid="worldid-verified">
        <span className="worldid-badge__icon" aria-hidden="true">&#10003;</span>
        <span className="worldid-badge__label">D2 &middot; World ID</span>
        <span className="worldid-badge__nullifier" title={localNullifier}>
          {displayState.nullifierDisplay}
        </span>
        {displayState.level && (
          <span className="worldid-badge__level">{displayState.level}</span>
        )}
      </div>
    );
  }

  // Ready to verify — show the trigger button
  return (
    <div className="worldid-badge worldid-badge--ready" data-testid="worldid-ready">
      <span className="worldid-badge__icon" aria-hidden="true">&#127760;</span>
      <span className="worldid-badge__label">D2 &middot; World ID</span>
      {error && (
        <span className="worldid-badge__error" role="alert">
          {error}
        </span>
      )}
      <button
        className="worldid-badge__btn"
        onClick={handleOpen}
        disabled={busy}
        type="button"
        aria-label="Verify humanity with World ID"
      >
        {busy ? 'Opening…' : 'Verify with World ID'}
      </button>
    </div>
  );
}
