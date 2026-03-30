'use client';

import { useRef, useEffect, useCallback } from 'react';
import { generateRealSpaceAtoms } from '../lib/leed';
import type { Layer } from '../types/leed';

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}

interface Transform { scale: number; tx: number; ty: number }
interface Props { layers: Layer[] }

export default function RealSpaceCanvas({ layers }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<Transform>({ scale: 12, tx: 0, ty: 0 });
  const layersRef  = useRef(layers);
  const dragging   = useRef(false);
  const lastMouse  = useRef({ x: 0, y: 0 });
  const rafRef     = useRef<number | null>(null);

  useEffect(() => { layersRef.current = layers; }, [layers]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const { scale, tx, ty } = transformRef.current;
    const cx = W/2+tx, cy = H/2+ty;
    const ls = layersRef.current;

    ctx.fillStyle = '#04040e';
    ctx.fillRect(0, 0, W, H);

    // Grid every 5 Å
    const gPx = 5*scale;
    ctx.strokeStyle = 'rgba(80,100,160,0.07)'; ctx.lineWidth = 1;
    const ox = ((cx%gPx)+gPx)%gPx, oy = ((cy%gPx)+gPx)%gPx;
    for (let x=ox; x<W; x+=gPx) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y=oy; y<H; y+=gPx) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Crosshair
    ctx.strokeStyle='rgba(255,255,255,0.10)'; ctx.setLineDash([3,5]);
    ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(W,cy); ctx.moveTo(cx,0); ctx.lineTo(cx,H); ctx.stroke();
    ctx.setLineDash([]);

    const substrate = ls[0];
    ls.forEach((layer, idx) => {
      if (!layer.visible) return;
      const [r_,g_,b_] = hexToRgb(layer.color);
      const winAng = Math.max(W,H)/scale + 5;
      const atoms = generateRealSpaceAtoms(layer, idx===0 ? null : substrate, winAng);

      const baseR  = idx===0 ? 4 : 3;
      const atomR  = Math.max(1.5, baseR * Math.min(1, scale/10));
      const glowR  = atomR * 3;

      atoms.forEach(({ x, y }) => {
        const px = cx + x*scale, py = cy - y*scale;
        const mg = glowR+2;
        if (px<-mg || px>W+mg || py<-mg || py>H+mg) return;
        ctx.globalAlpha = layer.opacity;

        const grad = ctx.createRadialGradient(px,py,0,px,py,glowR);
        if (idx===0) {
          grad.addColorStop(0,'rgba(255,255,255,0.85)');
          grad.addColorStop(0.4,`rgba(${r_},${g_},${b_},0.4)`);
          grad.addColorStop(1,`rgba(${r_},${g_},${b_},0)`);
        } else {
          grad.addColorStop(0,`rgba(${r_},${g_},${b_},0.9)`);
          grad.addColorStop(0.4,`rgba(${r_},${g_},${b_},0.35)`);
          grad.addColorStop(1,`rgba(${r_},${g_},${b_},0)`);
        }
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(px,py,glowR,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = idx===0 ? '#ffffff' : layer.color;
        ctx.beginPath(); ctx.arc(px,py,atomR,0,Math.PI*2); ctx.fill();
      });
    });

    ctx.globalAlpha = 1;

    // Scale bar 5 Å
    const bPx=5*scale, bx=W-24-bPx, by=H-20;
    ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=2; ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(bx,by); ctx.lineTo(bx+bPx,by);
    ctx.moveTo(bx,by-5); ctx.lineTo(bx,by+5);
    ctx.moveTo(bx+bPx,by-5); ctx.lineTo(bx+bPx,by+5);
    ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font='11px monospace'; ctx.textAlign='center';
    ctx.fillText('5 Å', bx+bPx/2, by-9);

    // Legend
    let ly = 14;
    ls.forEach(layer => {
      if (!layer.visible) return;
      ctx.globalAlpha=0.85; ctx.fillStyle=layer.color;
      ctx.beginPath(); ctx.arc(12,ly,5,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=0.6; ctx.fillStyle='#e2e8f0';
      ctx.font='11px monospace'; ctx.textAlign='left';
      ctx.fillText(layer.name, 22, ly+4);
      ly+=18;
    });
    ctx.globalAlpha=1;
  }, []);

  useEffect(() => { draw(); }, [layers, draw]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; draw();
    });
    ro.observe(canvas);
    canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; draw();
    return () => ro.disconnect();
  }, [draw]);

  const sched = useCallback(() => {
    if (rafRef.current!==null) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current=null; draw(); });
  }, [draw]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    transformRef.current.scale = Math.max(2, Math.min(200, transformRef.current.scale*(e.deltaY<0?1.12:0.89)));
    sched();
  }, [sched]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current=true; lastMouse.current={x:e.clientX,y:e.clientY};
    (e.currentTarget as HTMLCanvasElement).style.cursor='grabbing';
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    transformRef.current.tx += e.clientX-lastMouse.current.x;
    transformRef.current.ty += e.clientY-lastMouse.current.y;
    lastMouse.current={x:e.clientX,y:e.clientY}; sched();
  }, [sched]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    dragging.current=false; (e.currentTarget as HTMLCanvasElement).style.cursor='crosshair';
  }, []);

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full" style={{cursor:'crosshair'}}
        onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      />
      <div className="absolute top-3 right-3">
        <button onClick={() => { transformRef.current={scale:12,tx:0,ty:0}; draw(); }}
          className="bg-gray-800/80 hover:bg-gray-700 text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300">
          ⌂ Reset
        </button>
      </div>
      <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-gray-600 pointer-events-none">
        Real Space
      </div>
    </div>
  );
}
