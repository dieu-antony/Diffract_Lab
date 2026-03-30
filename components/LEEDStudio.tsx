'use client';

import { useState, useCallback, useRef } from 'react';
import LEEDCanvas from './LEEDCanvas';
import RealSpaceCanvas from './RealSpaceCanvas';
import { LAYER_COLORS, RECONSTRUCTION_PRESETS, SURFACE_PRESETS } from '../lib/leed';
import type {
  Layer, LayerMode, LatticeSystem, Matrix2x2,
  ViewMode, SidebarTab, LEEDProject,
} from '../types/leed';

// ── ID generator ─────────────────────────────────────────────
let _id = 100;
const makeId = () => String(++_id);

// ── Default layer factory ─────────────────────────────────────
function makeDefaultLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: makeId(), name: 'New Layer', visible: true, color: '#60a5fa',
    mode: 'direct', system: 'square', a: 2.884, b: 2.884, gamma: 90,
    rotationDeg: 0, matrix: [[1,0],[0,1]],
    spotSize: 4, opacity: 1, hkRange: 7,
    ...overrides,
  };
}

const DEFAULT_LAYERS: Layer[] = [
  makeDefaultLayer({ id:'1', name:'Au(100) substrate',   color:'#60a5fa', spotSize:5 }),
  makeDefaultLayer({ id:'2', name:'(5×1) domain A [10]', color:'#f87171', mode:'superlattice', matrix:[[5,0],[0,1]], spotSize:3, opacity:0.9 }),
  makeDefaultLayer({ id:'3', name:'(1×5) domain B [01]', color:'#fbbf24', mode:'superlattice', matrix:[[1,0],[0,5]], spotSize:3, opacity:0.9 }),
];

// ── Matrix input ─────────────────────────────────────────────
function MatrixInput({ matrix, onChange }: { matrix: Matrix2x2; onChange: (m: Matrix2x2) => void }) {
  const cells: [0|1, 0|1, string][] = [[0,0,'M₁₁'],[0,1,'M₁₂'],[1,0,'M₂₁'],[1,1,'M₂₂']];
  return (
    <div>
      <label className="text-xs text-gray-500">Superlattice Matrix M</label>
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        {cells.map(([r,c,lbl]) => (
          <div key={lbl} className="flex items-center gap-1">
            <span className="text-xs text-gray-500 w-6 shrink-0">{lbl}</span>
            <input type="number" step="1" value={matrix[r][c]}
              onChange={e => {
                const v = parseInt(e.target.value) || 0;
                const m: Matrix2x2 = [[...matrix[0]] as [number,number], [...matrix[1]] as [number,number]];
                m[r][c] = v; onChange(m);
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded px-1 py-1 text-xs text-center focus:outline-none focus:border-blue-500"
            />
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-center text-xs text-gray-600 font-mono leading-relaxed">
        [{matrix[0][0]} {matrix[0][1]}] · [a₁] = [A₁]<br/>
        [{matrix[1][0]} {matrix[1][1]}]   [a₂]   [A₂]
      </p>
    </div>
  );
}

// ── Slider ────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display?: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between">
        <label className="text-xs text-gray-500">{label}</label>
        <span className="text-xs text-gray-400">{display ?? value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full mt-0.5"
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function LEEDStudio() {
  const [layers,     setLayers]     = useState<Layer[]>(DEFAULT_LAYERS);
  const [selectedId, setSelectedId] = useState<string>('1');
  const [energy,     setEnergy]     = useState<number>(35);
  const [showEwald,  setShowEwald]  = useState<boolean>(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('layers');
  const [viewMode,   setViewMode]   = useState<ViewMode>('leed');
  const [saveMsg,    setSaveMsg]    = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedLayer = layers.find(l => l.id === selectedId) ?? layers[0];
  const selectedIdx   = layers.findIndex(l => l.id === selectedId);

  // ── Mutations ─────────────────────────────────────────────
  const upd = useCallback((id: string, patch: Partial<Layer>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }, []);

  const addLayer = useCallback(() => {
    const layer = makeDefaultLayer({
      color: LAYER_COLORS[layers.length % LAYER_COLORS.length],
      name: `Layer ${layers.length + 1}`,
      mode: 'superlattice', matrix: [[2,0],[0,1]], spotSize: 3, opacity: 0.9, hkRange: 6,
    });
    setLayers(prev => [...prev, layer]);
    setSelectedId(layer.id); setSidebarTab('edit');
  }, [layers.length]);

  const deleteLayer = useCallback((id: string) => {
    if (layers.length <= 1) return;
    const next = layers.filter(l => l.id !== id);
    setLayers(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? '');
  }, [layers, selectedId]);

  const moveLayer = useCallback((id: string, dir: 1|-1) => {
    setLayers(prev => {
      const i = prev.findIndex(l => l.id === id), j = i+dir;
      if (j<0 || j>=prev.length) return prev;
      const n=[...prev]; [n[i],n[j]]=[n[j],n[i]]; return n;
    });
  }, []);

  const duplicateLayer = useCallback((id: string) => {
    const src = layers.find(l => l.id === id); if (!src) return;
    const dup: Layer = { ...src, id: makeId(), name: src.name+' (copy)' };
    setLayers(prev => {
      const i = prev.findIndex(l => l.id === id);
      const n = [...prev]; n.splice(i+1, 0, dup); return n;
    });
    setSelectedId(dup.id);
  }, [layers]);

  /** Duplicate selected layer and rotate clone 90°. Used for SnS-style twin domains. */
  const add90DegCopy = useCallback((id: string) => {
    const src = layers.find(l => l.id === id); if (!src) return;
    const nextColor = LAYER_COLORS[(layers.length) % LAYER_COLORS.length];
    const dup: Layer = {
      ...src,
      id: makeId(),
      name: src.name.replace(/\s*\(\d+°\)$/, '') + ' (90°)',
      rotationDeg: (src.rotationDeg + 90) % 360,
      color: nextColor,
    };
    setLayers(prev => {
      const i = prev.findIndex(l => l.id === id);
      const n = [...prev]; n.splice(i+1, 0, dup); return n;
    });
    setSelectedId(dup.id);
  }, [layers]);

  const loadPreset = useCallback((label: string) => {
    const preset = RECONSTRUCTION_PRESETS.find(p => p.label === label); if (!preset) return;
    const newLayers = preset.layers.map((pl, i) => makeDefaultLayer({
      ...pl, id: makeId(),
      color: pl.color ?? LAYER_COLORS[i % LAYER_COLORS.length],
      matrix: pl.matrix ? (pl.matrix.map(r => [...r]) as Matrix2x2) : [[1,0],[0,1]],
    }));
    setLayers(newLayers); setSelectedId(newLayers[0].id); setSidebarTab('layers');
  }, []);

  const loadSurface = useCallback((key: string) => {
    const sp = SURFACE_PRESETS[key]; if (!sp || !layers[0]) return;
    upd(layers[0].id, { ...sp, name: key+' substrate' });
  }, [layers, upd]);

  // ── Save / Load ───────────────────────────────────────────
  const saveProject = useCallback(() => {
    const project: LEEDProject = { version: 3, savedAt: new Date().toISOString(), layers };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'leed-project.json'; a.click();
    URL.revokeObjectURL(url);
    setSaveMsg('Saved ✓'); setTimeout(() => setSaveMsg(''), 2000);
  }, [layers]);

  const loadProject = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target?.result as string) as { layers?: Partial<Layer>[] };
        if (!Array.isArray(data.layers)) throw new Error('Invalid file');
        const migrated = data.layers.map((l) => makeDefaultLayer(l));
        setLayers(migrated);
        setSelectedId(migrated[0]?.id ?? '');
        setSaveMsg('Loaded ✓'); setTimeout(() => setSaveMsg(''), 2000);
      } catch {
        setSaveMsg('Error: invalid file'); setTimeout(() => setSaveMsg(''), 3000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden"
      style={{ fontFamily:"'JetBrains Mono','Fira Code',monospace" }}>

      {/* ── Sidebar ─────────────────────────────────────── */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-gray-800 bg-gray-900 overflow-hidden">

        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-blue-400 text-lg">⬡</span>
            <div>
              <h1 className="text-sm font-bold tracking-widest text-blue-300 uppercase">Diffract Lab</h1>
              <p className="text-xs text-gray-500">Multi-layer pattern simulator</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveProject}
              className="flex-1 text-xs py-1.5 rounded bg-blue-900/50 hover:bg-blue-800/60 border border-blue-700/50 text-blue-300 transition-colors">
              ↓ Save .json
            </button>
            <button onClick={() => fileInputRef.current?.click()}
              className="flex-1 text-xs py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 transition-colors">
              ↑ Load .json
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={loadProject}/>
          </div>
          {saveMsg && <p className="mt-1.5 text-xs text-center text-green-400">{saveMsg}</p>}
        </div>

        {/* Presets */}
        <div className="px-4 py-2.5 border-b border-gray-800 flex-shrink-0">
          <label className="text-xs text-gray-500 uppercase tracking-wider">Presets</label>
          <select className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
            value="" onChange={e => { if(e.target.value) loadPreset(e.target.value); }}>
            <option value="" disabled>Load preset…</option>
            {RECONSTRUCTION_PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
          </select>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 flex-shrink-0">
          {(['layers','edit'] as SidebarTab[]).map(tab => (
            <button key={tab} onClick={() => setSidebarTab(tab)}
              className={`flex-1 py-1.5 text-xs uppercase tracking-wider transition-colors ${
                sidebarTab===tab ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50' : 'text-gray-500 hover:text-gray-300'
              }`}>
              {tab==='layers' ? '⊞ Layers' : '✎ Edit'}
            </button>
          ))}
        </div>

        {/* ── Layers tab ─────────────────────────────────── */}
        {sidebarTab==='layers' && (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Stack</span>
              <button onClick={addLayer}
                className="text-xs bg-blue-600 hover:bg-blue-500 px-2 py-0.5 rounded transition-colors">
                + Add Layer
              </button>
            </div>

            <div className="space-y-1">
              {layers.map((layer, idx) => (
                <div key={layer.id}
                  onClick={() => { setSelectedId(layer.id); setSidebarTab('edit'); }}
                  className={`group flex items-center gap-2 px-2 py-2 rounded cursor-pointer transition-colors ${
                    selectedId===layer.id
                      ? 'bg-blue-900/40 border border-blue-700/50'
                      : 'hover:bg-gray-800 border border-transparent'
                  }`}>
                  <button title="Toggle visibility"
                    onClick={e=>{e.stopPropagation(); upd(layer.id,{visible:!layer.visible});}}
                    className={`text-sm flex-shrink-0 ${layer.visible?'opacity-100':'opacity-30'}`}>
                    {layer.visible?'●':'○'}
                  </button>
                  <div className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{background:layer.color}}/>
                  <span className={`flex-1 text-xs truncate ${layer.visible?'text-gray-200':'text-gray-500'}`}>
                    {layer.name}
                  </span>
                  <span className="text-xs text-gray-600 flex-shrink-0">
                    {idx===0?'sub':layer.mode==='superlattice'?'M':'lat'}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={e=>{e.stopPropagation();moveLayer(layer.id,-1);}} title="Move up"   className="text-gray-500 hover:text-gray-200 px-0.5">↑</button>
                    <button onClick={e=>{e.stopPropagation();moveLayer(layer.id,1);}}  title="Move down" className="text-gray-500 hover:text-gray-200 px-0.5">↓</button>
                    <button onClick={e=>{e.stopPropagation();duplicateLayer(layer.id);}} title="Duplicate" className="text-gray-500 hover:text-blue-400 px-0.5">⎘</button>
                    {layers.length>1 && (
                      <button onClick={e=>{e.stopPropagation();deleteLayer(layer.id);}} title="Delete" className="text-gray-500 hover:text-red-400 px-0.5">×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Quick substrate */}
            <div className="mt-4">
              <label className="text-xs text-gray-500 uppercase tracking-wider">Quick Substrate</label>
              <select className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                value="" onChange={e=>{if(e.target.value) loadSurface(e.target.value);}}>
                <option value="" disabled>Set substrate to…</option>
                {Object.keys(SURFACE_PRESETS).map(k=><option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* ── Edit tab ───────────────────────────────────── */}
        {sidebarTab==='edit' && selectedLayer && (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Properties</span>
              <div className="w-4 h-4 rounded-full ring-1 ring-white/20" style={{background:selectedLayer.color}}/>
            </div>

            {/* Name */}
            <div>
              <label className="text-xs text-gray-500">Name</label>
              <input type="text" value={selectedLayer.name}
                onChange={e=>upd(selectedLayer.id,{name:e.target.value})}
                className="mt-0.5 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"/>
            </div>

            {/* Colour */}
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500">Colour</label>
              <input type="color" value={selectedLayer.color}
                onChange={e=>upd(selectedLayer.id,{color:e.target.value})}
                className="w-8 h-7 rounded cursor-pointer bg-transparent border-0"/>
              <div className="flex gap-1 flex-wrap">
                {LAYER_COLORS.map(c=>(
                  <button key={c} onClick={()=>upd(selectedLayer.id,{color:c})}
                    className="w-4 h-4 rounded-full ring-1 ring-white/10 hover:scale-110 transition-transform"
                    style={{background:c}}/>
                ))}
              </div>
            </div>

            {/* Mode */}
            <div>
              <label className="text-xs text-gray-500">Definition Mode</label>
              <select value={selectedLayer.mode}
                onChange={e=>upd(selectedLayer.id,{mode:e.target.value as LayerMode})}
                className="mt-0.5 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500">
                <option value="direct">Direct lattice (a, b, γ)</option>
                <option value="superlattice">Superlattice matrix M</option>
              </select>
            </div>

            {/* Direct mode */}
            {selectedLayer.mode==='direct' && (
              <>
                <div>
                  <label className="text-xs text-gray-500">Lattice System</label>
                  <select value={selectedLayer.system}
                    onChange={e=>upd(selectedLayer.id,{system:e.target.value as LatticeSystem})}
                    className="mt-0.5 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500">
                    <option value="square">Square — a = b, γ = 90° (e.g. fcc(100))</option>
                    <option value="rectangular">Rectangular — a ≠ b, γ = 90° (e.g. fcc(110))</option>
                    <option value="hexagonal">Hexagonal — a = b, γ = 120° (e.g. fcc(111), hcp)</option>
                    <option value="oblique">Oblique — a, b, γ all free</option>
                    <option value="centered_rect">Centered Rectangular — c(n×m) structures</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">a (Å)</label>
                    <input type="number" step="0.001" min="0.1" max="30" value={selectedLayer.a}
                      onChange={e=>upd(selectedLayer.id,{a:parseFloat(e.target.value)||2.884})}
                      className="mt-0.5 w-full bg-gray-800 border border-gray-700 rounded px-1 py-1.5 text-xs text-center focus:outline-none focus:border-blue-500"/>
                  </div>
                  {['rectangular','oblique','centered_rect'].includes(selectedLayer.system) && (
                    <div>
                      <label className="text-xs text-gray-500">b (Å)</label>
                      <input type="number" step="0.001" min="0.1" max="30" value={selectedLayer.b}
                        onChange={e=>upd(selectedLayer.id,{b:parseFloat(e.target.value)||2.884})}
                        className="mt-0.5 w-full bg-gray-800 border border-gray-700 rounded px-1 py-1.5 text-xs text-center focus:outline-none focus:border-blue-500"/>
                    </div>
                  )}
                  {selectedLayer.system==='oblique' && (
                    <div>
                      <label className="text-xs text-gray-500">γ (°)</label>
                      <input type="number" step="1" min="10" max="170" value={selectedLayer.gamma}
                        onChange={e=>upd(selectedLayer.id,{gamma:parseFloat(e.target.value)||90})}
                        className="mt-0.5 w-full bg-gray-800 border border-gray-700 rounded px-1 py-1.5 text-xs text-center focus:outline-none focus:border-blue-500"/>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Superlattice matrix */}
            {selectedLayer.mode==='superlattice' && (
              <MatrixInput matrix={selectedLayer.matrix} onChange={m=>upd(selectedLayer.id,{matrix:m})}/>
            )}

            {/* ── Rotation ──────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">Rotation</label>
                {/* 90° twin button — makes a copy rotated 90° for domain studies */}
                <button
                  onClick={() => add90DegCopy(selectedLayer.id)}
                  title="Add a 90°-rotated copy of this layer (for twin domains)"
                  className="text-xs px-2 py-0.5 rounded bg-purple-900/50 hover:bg-purple-800/60 border border-purple-700/50 text-purple-300 transition-colors">
                  + 90° twin
                </button>
              </div>
              {/* Quick angle buttons */}
              <div className="flex gap-1">
                {[0,30,45,60,90,120,180].map(deg=>(
                  <button key={deg} onClick={()=>upd(selectedLayer.id,{rotationDeg:deg})}
                    className={`flex-1 text-xs py-1 rounded transition-colors ${
                      selectedLayer.rotationDeg===deg
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                    }`}>{deg}°</button>
                ))}
              </div>
              <input type="number" step="0.5" min="-180" max="360"
                value={selectedLayer.rotationDeg}
                onChange={e=>upd(selectedLayer.id,{rotationDeg:parseFloat(e.target.value)||0})}
                placeholder="Custom angle…"
                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-center focus:outline-none focus:border-blue-500"/>
            </div>

            {/* ── Display ───────────────────────────────── */}
            <div className="border-t border-gray-800 pt-3 space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Display</p>
              <Slider label="Spot Radius" value={selectedLayer.spotSize} min={1} max={12} step={1}
                display={`${selectedLayer.spotSize} px`}
                onChange={v=>upd(selectedLayer.id,{spotSize:v})}/>
              <Slider label="Layer Opacity" value={selectedLayer.opacity} min={0.05} max={1} step={0.01}
                display={`${Math.round(selectedLayer.opacity*100)}%`}
                onChange={v=>upd(selectedLayer.id,{opacity:v})}/>
              <Slider label="h,k Range" value={selectedLayer.hkRange} min={1} max={20} step={1}
                display={`±${selectedLayer.hkRange}`}
                onChange={v=>upd(selectedLayer.id,{hkRange:Math.round(v)})}/>
            </div>

            {/* Visibility toggle */}
            <button onClick={()=>upd(selectedLayer.id,{visible:!selectedLayer.visible})}
              className={`w-full text-xs py-1.5 rounded border transition-colors ${
                selectedLayer.visible
                  ? 'border-gray-700 text-gray-300 hover:border-gray-600'
                  : 'border-yellow-700 text-yellow-400 bg-yellow-900/20'
              }`}>
              {selectedLayer.visible ? '● Visible — click to hide' : '○ Hidden — click to show'}
            </button>

            {/* Layer index info */}
            <p className="text-xs text-gray-600 text-center">
              Layer {selectedIdx+1} of {layers.length}
              {selectedIdx===0 ? ' (substrate — reference for superlattice layers)' : ''}
            </p>
          </div>
        )}

        {/* ── Energy / Ewald ────────────────────────────── */}
        <div className="border-t border-gray-800 px-4 py-3 flex-shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-blue-300 uppercase tracking-wider font-semibold">
              Beam: {energy} eV
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input type="checkbox" checked={showEwald} onChange={e=>setShowEwald(e.target.checked)}
                className="w-3.5 h-3.5 accent-green-500"/>
              <span className="text-green-400">Ewald</span>
            </label>
          </div>
          <input type="range" min="30" max="500" step="5" value={energy}
            onChange={e=>setEnergy(parseInt(e.target.value))} className="w-full"/>
          <div className="flex justify-between text-xs text-gray-600">
            <span>30 eV</span>
            <span className="text-gray-500">k‖ = {(0.5123*Math.sqrt(energy)).toFixed(2)} Å⁻¹</span>
            <span>500 eV</span>
          </div>
        </div>
      </div>

      {/* ── View area ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* View toggle */}
        <div className="flex items-center justify-center gap-1 px-4 py-1.5 border-b border-gray-800 bg-gray-900 flex-shrink-0">
          {([
            { key:'leed'  as ViewMode, label:'⬡ Reciprocal (LEED)' },
            { key:'split' as ViewMode, label:'⬡ | ◉ Split' },
            { key:'real'  as ViewMode, label:'◉ Real Space' },
          ]).map(v=>(
            <button key={v.key} onClick={()=>setViewMode(v.key)}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                viewMode===v.key ? 'bg-blue-700 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}>{v.label}</button>
          ))}
        </div>

        <div className="flex-1 flex min-h-0">
          {(viewMode==='leed'||viewMode==='split') && (
            <div className={`${viewMode==='split'?'w-1/2 border-r border-gray-800':'w-full'} relative`}>
              {viewMode==='split' && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 text-xs text-gray-600 pointer-events-none">
                  Reciprocal Space
                </div>
              )}
              <LEEDCanvas layers={layers} energy={energy} showEwald={showEwald}/>
            </div>
          )}
          {(viewMode==='real'||viewMode==='split') && (
            <div className={`${viewMode==='split'?'w-1/2':'w-full'} relative`}>
              <RealSpaceCanvas layers={layers}/>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
