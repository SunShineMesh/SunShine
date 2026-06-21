// The trust mesh — the product's signature. Agent nodes orbit a central
// bureau; edges are trust relationships. Node colour encodes trust tier;
// revoked agents desaturate and their edge thins. Ambient drift + event pulses.
import { useEffect, useRef } from 'react';

export interface MeshNode {
  id: string;
  tier: string;
  status: 'active' | 'revoked';
  bornAt: number;
  pulseAt?: number;
  focus?: boolean;
}

const TIER_COLOR: Record<string, string> = {
  'DENIED': '#5a6685',
  'TIER-1': '#3fa87a',
  'TIER-2': '#4ade9e',
  'TIER-3': '#5defc0',
  'TIER-4': '#8bf7dd',
};

export function Mesh({ nodes }: { nodes: MeshNode[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<MeshNode[]>(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let t = 0;
    const pos = new Map<string, { x: number; y: number; a: number; ring: number }>();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const place = (i: number) => {
      const ring = 1 + (i % 3);
      const ang = i * 2.39996; // golden angle
      return { x: 0, y: 0, a: ang, ring };
    };

    const frame = () => {
      t += 0.016;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h);
      ctx.clearRect(0, 0, w, h);

      const ns = nodesRef.current;
      ns.forEach((nd, i) => { if (!pos.has(nd.id)) pos.set(nd.id, place(i)); });

      const xy = (nd: MeshNode) => {
        const p = pos.get(nd.id)!;
        const rad = base * 0.13 * p.ring;
        const drift = Math.sin(t * 0.5 + p.a * 3) * 5;
        const rot = t * 0.04 * (p.ring % 2 === 0 ? -1 : 1);
        return { x: cx + Math.cos(p.a + rot) * rad, y: cy + Math.sin(p.a + rot) * rad * 0.82 + drift };
      };

      // edges: treasury -> agent
      ns.forEach((nd) => {
        const { x, y } = xy(nd);
        const g = ctx.createLinearGradient(cx, cy, x, y);
        g.addColorStop(0, 'rgba(91,140,255,0.45)');
        g.addColorStop(1, nd.status === 'revoked' ? 'rgba(90,102,133,0.10)' : 'rgba(139,92,246,0.32)');
        ctx.strokeStyle = g;
        ctx.lineWidth = nd.status === 'revoked' ? 0.5 : 1.1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      });

      // faint inter-agent mesh
      ctx.strokeStyle = 'rgba(91,140,255,0.06)';
      ctx.lineWidth = 0.5;
      for (let a = 0; a < ns.length; a++) {
        for (let b = a + 1; b < ns.length; b++) {
          const pa = xy(ns[a]); const pb = xy(ns[b]);
          const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          if (d < base * 0.22) { ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); }
        }
      }

      // nodes
      const now = performance.now();
      ns.forEach((nd) => {
        const { x, y } = xy(nd);
        const col = nd.status === 'revoked' ? '#5a6685' : (TIER_COLOR[nd.tier] || '#4ade9e');
        const grow = Math.min((now - nd.bornAt) / 450, 1);
        const r = (nd.focus ? 7.5 : 5) * (0.3 + 0.7 * grow);
        if (nd.pulseAt) {
          const pa = (now - nd.pulseAt) / 750;
          if (pa < 1) { ctx.beginPath(); ctx.arc(x, y, r + 4 + pa * 26, 0, Math.PI * 2); ctx.strokeStyle = `rgba(74,222,158,${0.55 * (1 - pa)})`; ctx.lineWidth = 2; ctx.stroke(); }
        }
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = nd.status === 'revoked' ? 0 : (nd.focus ? 22 : 10);
        ctx.fill(); ctx.shadowBlur = 0;
        if (nd.focus && nd.status === 'active') {
          ctx.beginPath(); ctx.arc(x, y, r + 5 + Math.sin(t * 2) * 1.5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(74,222,158,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        }
      });

      // treasury core
      ctx.beginPath(); ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = '#eef2ff'; ctx.shadowColor = '#5b8cff'; ctx.shadowBlur = 20; ctx.fill(); ctx.shadowBlur = 0;
      ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = '#8a97b8'; ctx.textAlign = 'center';
      ctx.fillText('TREASURY', cx, cy + 23);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className="mesh-canvas" aria-label="Live agent trust network" />;
}
