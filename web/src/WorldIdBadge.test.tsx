// web/src/WorldIdBadge.test.tsx
// Pure component shape tests — no DOM rendering required.
// Validates the WorldIdBadge component interface and its display-state logic.
import { describe, it, expect } from 'vitest';
import type { WorldIdBadgeProps } from './WorldIdBadge';
import { WorldIdBadge, getDisplayState } from './WorldIdBadge';

describe('WorldIdBadge — component shape', () => {
  it('is a function (React component)', () => {
    expect(typeof WorldIdBadge).toBe('function');
  });

  it('accepts WorldIdBadgeProps interface', () => {
    // Shape test: these props must be assignable without TypeScript error
    const props: WorldIdBadgeProps = {
      proofPending: true,
    };
    expect(props.proofPending).toBe(true);
  });

  it('props interface allows nullifier and verificationLevel', () => {
    const props: WorldIdBadgeProps = {
      proofPending: false,
      nullifier: '0xABCD1234',
      verificationLevel: 'device',
      onVerified: (nullifier: string, level: string) => { void nullifier; void level; },
    };
    expect(props.nullifier).toBe('0xABCD1234');
    expect(props.verificationLevel).toBe('device');
  });
});

describe('getDisplayState — display logic', () => {
  it('returns pending state when proofPending=true', () => {
    const state = getDisplayState({ proofPending: true });
    expect(state.message).toBe('wiring shown, proof pending');
    expect(state.showWidget).toBe(false);
    expect(state.nullifierDisplay).toBeUndefined();
  });

  it('returns verified state with truncated nullifier when proofPending=false', () => {
    const state = getDisplayState({
      proofPending: false,
      nullifier: '0xABCD1234567890EF',
      verificationLevel: 'device',
    });
    expect(state.message).toBeUndefined();
    // Nullifier should be truncated
    expect(state.nullifierDisplay).toBeDefined();
    expect(typeof state.nullifierDisplay).toBe('string');
    // Should be shorter than the original (truncated)
    expect((state.nullifierDisplay as string).length).toBeLessThan('0xABCD1234567890EF'.length);
    expect(state.level).toBe('device');
  });

  it('truncates long nullifier to prefix…suffix format', () => {
    const nullifier = '0xABCDEF1234567890ABCDEF';
    const state = getDisplayState({ proofPending: false, nullifier });
    // Should start with prefix and end with suffix, joined by ellipsis
    const display = state.nullifierDisplay as string;
    expect(display).toContain('…');
  });

  it('returns showWidget=true when VITE_APP_ID env would be present and proofPending=false', () => {
    // When proofPending is false and no nullifier yet, widget should be shown
    const state = getDisplayState({ proofPending: false });
    // Without a nullifier, should show the widget trigger
    expect(state.showWidget).toBe(true);
  });

  it('returns showWidget=false once nullifier is present (already verified)', () => {
    const state = getDisplayState({
      proofPending: false,
      nullifier: '0xABCD',
    });
    // Already have a nullifier — no need to show widget again
    expect(state.showWidget).toBe(false);
  });

  it('handles missing verificationLevel gracefully', () => {
    const state = getDisplayState({ proofPending: false, nullifier: '0x1234' });
    expect(state.level).toBeUndefined();
  });
});
