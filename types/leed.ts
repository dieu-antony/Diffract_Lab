// ── 2×2 matrix type ─────────────────────────────────────────
export type Matrix2x2 = [[number, number], [number, number]];

// ── Lattice systems ──────────────────────────────────────────
export type LatticeSystem =
  | 'square'
  | 'rectangular'
  | 'hexagonal'
  | 'oblique'
  | 'centered_rect';

// ── Layer definition mode ────────────────────────────────────
export type LayerMode = 'direct' | 'superlattice';

// ── A single layer ───────────────────────────────────────────
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  color: string;

  // Geometry
  mode: LayerMode;
  system: LatticeSystem;
  a: number;        // Å
  b: number;        // Å
  gamma: number;    // degrees
  matrix: Matrix2x2;
  rotationDeg: number;

  // Display
  spotSize: number;
  opacity: number;
  hkRange: number;
}

// ── Reciprocal-space spot ────────────────────────────────────
export interface ReciprocalSpot {
  h: number;
  k: number;
  x: number;    // Å⁻¹
  y: number;    // Å⁻¹
  isSpecular: boolean;
}

// ── Real-space atom ──────────────────────────────────────────
export interface RealAtom {
  x: number;   // Å
  y: number;   // Å
}

// ── View layout ──────────────────────────────────────────────
export type ViewMode = 'leed' | 'real' | 'split';
export type SidebarTab = 'layers' | 'edit';

// ── Serialisable project (save/load) ─────────────────────────
export interface LEEDProject {
  version: 3;
  savedAt: string;
  layers: Layer[];
}

// ── Presets ──────────────────────────────────────────────────
export interface ReconstructionPreset {
  label: string;
  description: string;
  layers: Partial<Layer>[];
}

export interface SurfacePreset {
  system: LatticeSystem;
  a: number;
  b: number;
  gamma: number;
}
