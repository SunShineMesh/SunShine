import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256Hex, prefix8, attest, verifyAttestation, attestFiles } from '../src/agent/attest.js';

describe('attest', () => {
  it('sha256Hex is 64 uppercase hex and deterministic', () => {
    const h = sha256Hex('hello');
    expect(h).toMatch(/^[0-9A-F]{64}$/);
    expect(sha256Hex('hello')).toBe(h);
    expect(sha256Hex('hellp')).not.toBe(h);
  });
  it('prefix8 returns the first 8 chars', () => {
    expect(prefix8('ABCDEF0123456789')).toBe('ABCDEF01');
  });
  it('attest produces full hashes and 8-char ih/sh prefixes', () => {
    const a = attest('harness-bytes', 'skill-bytes');
    expect(a.harnessHashFull).toBe(sha256Hex('harness-bytes'));
    expect(a.skillHashFull).toBe(sha256Hex('skill-bytes'));
    expect(a.ih).toBe(prefix8(a.harnessHashFull));
    expect(a.sh).toBe(prefix8(a.skillHashFull));
  });
  it('verifyAttestation recognizes audited bytes', () => {
    const a = attest('h', 's');
    const r = verifyAttestation('h', 's', a);
    expect(r.recognized).toBe(true);
    expect(r.reason).toMatch(/^recognized runtime$/i);
  });
  it('verifyAttestation rejects a one-byte skill swap as unrecognized runtime', () => {
    const a = attest('h', 'pay-v1: validate -> escrow');
    const r = verifyAttestation('h', 'pay-v2-EVIL: validate -> escrow', a);
    expect(r.recognized).toBe(false);
    expect(r.skillMatch).toBe(false);
    expect(r.harnessMatch).toBe(true);
    expect(r.reason).toMatch(/unrecognized runtime/i);
  });
  it('attestFiles hashes real file bytes', () => {
    const harness = fileURLToPath(new URL('../src/agent/sdk.ts', import.meta.url));
    const skill = fileURLToPath(new URL('../src/agent/skills/payment-v1.ts', import.meta.url));
    const a = attestFiles(harness, skill);
    expect(a.harnessHashFull).toBe(sha256Hex(readFileSync(harness)));
    expect(a.skillHashFull).toBe(sha256Hex(readFileSync(skill)));
  });
});
