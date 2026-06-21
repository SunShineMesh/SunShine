import { describe, it, expect } from 'vitest';
import { encodeSkillURI, decodeSkillURI, SKILL_CRED_TYPE, skillContentHash, type SkillTerms } from '../src/xrpl/skillCredential.js';
import { toHex } from '../src/xrpl/codec.js';

describe('skill credential codec', () => {
  const t: SkillTerms = { v: 1, skillId: 'pdf-extract', skillVersion: '1.2.0', benchmarkHash: 'beef', exp: 123 };

  it('round-trips skill terms', () => {
    expect(decodeSkillURI(encodeSkillURI(t))).toEqual(t);
  });

  it('uses the agent_skill_v1 credential type', () => {
    expect(SKILL_CRED_TYPE).toBe(toHex('agent_skill_v1'));
  });

  it('throws when the payload exceeds the 256-hex URI cap', () => {
    expect(() => encodeSkillURI({ ...t, benchmarkHash: 'x'.repeat(300) })).toThrow(/256/);
  });
});

describe('skillContentHash', () => {
  it('is 16 uppercase hex and deterministic', () => {
    const h = skillContentHash('skill-bytes');
    expect(h).toMatch(/^[0-9A-F]{16}$/);
    expect(skillContentHash('skill-bytes')).toBe(h);
  });
  it('changes when the skill bytes change', () => {
    expect(skillContentHash('v1')).not.toBe(skillContentHash('v2'));
  });
});
