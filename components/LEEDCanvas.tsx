'use client';

import { useRef, useEffect, useCallback } from 'react';
import { generateSpots, ewaldRadius } from '../lib/leed';
import type { Layer } from '../types/leed';

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}

interface Transform { scale: number; tx: number; ty: number }
interface Props { layers: Layer[]; energy: number; showEwald: boolean }

export default function LEEDCanvas({ layers, energy, showEwald }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<Transform>({ scale: 50, tx: 0, ty: 0 });
  const layersRef   = useRef(layers);
  const energyRef   = useRef(energy);
  const ewaldRef    = useRef(showEwald);
  const dragging    = useRef(false);
  const lastMouse   = useRef({ x: 0, y: 0 });
  const rafRef      = useRef<number | null>(null);

  useEffect(() => { layersRef.current = layers; },    [layers]);
  useEffect(() => { energyRef.current = energy; },    [energy]);
  useEffect(() => { ewaldRef.current  = showEwald; }, [showEwald]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    const { scale, tx, ty } = transformRef.current;
    const cx = W/2 + tx, cy = H/2 + ty;
    const ls  = layersRef.current;
    const ev  = energyRef.current;
    const ew  = ewaldRef.current;
    const kmax = ewaldRadius(ev);

    // ── Background ──────────────────────────────────────────
    ctx.fillStyle = '#04040e';
    ctx.fillRect(0, 0, W, H);

    // Subtle rings
    ctx.strokeStyle = 'rgba(80,100,160,0.06)'; ctx.lineWidth = 1;
    for (let r = 1; r <= 14; r++) {
      ctx.beginPath(); ctx.arc(cx, cy, r*scale, 0, Math.PI*2); ctx.stroke();
    }

    // Crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.setLineDash([3,5]);
    ctx.beginPath();
    ctx.moveTo(0,cy); ctx.lineTo(W,cy);
    ctx.moveTo(cx,0); ctx.lineTo(cx,H);
    ctx.stroke(); ctx.setLineDash([]);

    // ── Ewald circle ────────────────────────────────────────
    if (ew) {
      const ewPx = kmax * scale;
      ctx.strokeStyle = 'rgba(74,222,128,0.55)';
      ctx.lineWidth = 1.5; ctx.setLineDash([7,4]);
      ctx.beginPath(); ctx.arc(cx, cy, ewPx, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(74,222,128,0.7)';
      ctx.font = '11px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`Ewald @ ${ev} eV`, cx + ewPx*0.685+4, cy - ewPx*0.725);
    }

    // ── Spots ────────────────────────────────────────────────
    const substrate = ls[0];

    ls.forEach((layer, idx) => {
      if (!layer.visible) return;
      const [r_,g_,b_] = hexToRgb(layer.color);
      const spots = generateSpots(layer, idx === 0 ? null : substrate);

      spots.forEach(spot => {
        const px = cx + spot.x * scale;
        const py = cy - spot.y * scale;
        const margin = 80;
        if (px < -margin || px > W+margin || py < -margin || py > H+margin) return;

        // Ewald filtering
        const kMag = Math.sqrt(spot.x**2 + spot.y**2);
        const ewFactor = ew ? (kMag <= kmax ? 1.0 : 0.07) : 1.0;
        const alpha = layer.opacity * ewFactor;
        if (alpha < 0.02) return;

        ctx.globalAlpha = alpha;

        const isSpec = spot.isSpecular;
        const coreR  = isSpec ? layer.spotSize + 3 : layer.spotSize;
        const glowR  = coreR * 3.5;

        // Glow
        const grad = ctx.createRadialGradient(px, py, 0, px, py, glowR);
        if (isSpec) {
          grad.addColorStop(0,   'rgba(255,255,255,0.95)');
          grad.addColorStop(0.3, 'rgba(200,230,255,0.55)');
          grad.addColorStop(1,   'rgba(150,180,255,0)');
        } else {
          grad.addColorStop(0,   `rgba(${r_},${g_},${b_},0.9)`);
          grad.addColorStop(0.35,`rgba(${r_},${g_},${b_},0.4)`);
          grad.addColorStop(1,   `rgba(${r_},${g_},${b_},0)`);
        }
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(px, py, glowR, 0, Math.PI*2); ctx.fill();

        // Core
        ctx.fillStyle = isSpec ? '#ffffff' : layer.color;
        ctx.beginPath(); ctx.arc(px, py, coreR, 0, Math.PI*2); ctx.fill();
      });
    });

    ctx.globalAlpha = 1;

    // ── Scale bar 1 Å⁻¹ ─────────────────────────────────────
    const bPx = scale, bx = W-24-bPx, by = H-20;
    ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=2; ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(bx,by); ctx.lineTo(bx+bPx,by);
    ctx.moveTo(bx,by-5); ctx.lineTo(bx,by+5);
    ctx.moveTo(bx+bPx,by-5); ctx.lineTo(bx+bPx,by+5);
    ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.55)';
    ctx.font='11px monospace'; ctx.textAlign='center';
    ctx.fillText('1 Å⁻¹', bx+bPx/2, by-9);

    // ── Legend ───────────────────────────────────────────────
    let ly = 14;
    ls.forEach(layer => {
      if (!layer.visible) return;
      ctx.globalAlpha=0.85; ctx.fillStyle=layer.color;
      ctx.beginPath(); ctx.arc(12, ly, 5, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha=0.6; ctx.fillStyle='#e2e8f0';
      ctx.font='11px monospace'; ctx.textAlign='left';
      ctx.fillText(layer.name, 22, ly+4);
      ly += 18;
    });
    ctx.globalAlpha = 1;
  }, []);

  useEffect(() => { draw(); }, [layers, energy, showEwald, draw]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; draw();
    });
    ro.observe(canvas);
    canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; draw();
    return () => ro.disconnect();
  }, [draw]);

  const sched = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; draw(); });
  }, [draw]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    transformRef.current.scale = Math.max(5, Math.min(1200,
      transformRef.current.scale * (e.deltaY < 0 ? 1.12 : 0.89)));
    sched();
  }, [sched]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLCanvasElement).style.cursor = 'grabbing';
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    transformRef.current.tx += e.clientX - lastMouse.current.x;
    transformRef.current.ty += e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY }; sched();
  }, [sched]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    dragging.current = false;
    (e.currentTarget as HTMLCanvasElement).style.cursor = 'crosshair';
  }, []);

  const reset = useCallback(() => {
    transformRef.current = { scale: 50, tx: 0, ty: 0 }; draw();
  }, [draw]);

  const zoom = useCallback((f: number) => {
    transformRef.current.scale = Math.max(5, Math.min(1200, transformRef.current.scale * f)); draw();
  }, [draw]);

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full" style={{ cursor:'crosshair' }}
        onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      />
      <div className="absolute top-3 right-3 flex flex-col gap-2">
        <button onClick={reset}           className="bg-gray-800/80 hover:bg-gray-700 text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300">⌂ Reset</button>
        <button onClick={() => zoom(2)}   className="bg-gray-800/80 hover:bg-gray-700 text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300">+ ×2</button>
        <button onClick={() => zoom(0.5)} className="bg-gray-800/80 hover:bg-gray-700 text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300">− ÷2</button>
      </div>
      <div className="absolute bottom-8 left-3 text-xs text-gray-600 pointer-events-none space-y-0.5">
        <div>Scroll · Drag to navigate</div>
        <div>k‖ max = {ewaldRadius(energy).toFixed(2)} Å⁻¹ @ {energy} eV</div>
      </div>
    </div>
  );
}
