import type {
  Layer,
  LatticeSystem,
  Matrix2x2,
  ReciprocalSpot,
  RealAtom,
  ReconstructionPreset,
  SurfacePreset,
} from '../types/leed';

// ── Colour palette ───────────────────────────────────────────
export const LAYER_COLORS: string[] = [
  '#60a5fa', '#f87171', '#4ade80', '#fbbf24',
  '#a78bfa', '#fb923c', '#34d399', '#f472b6',
  '#38bdf8', '#e879f9',
];

// ── Vec2 helpers ─────────────────────────────────────────────
type Vec2 = [number, number];

export function rotateVec([x, y]: Vec2, theta: number): Vec2 {
  return [
    x * Math.cos(theta) - y * Math.sin(theta),
    x * Math.sin(theta) + y * Math.cos(theta),
  ];
}

// ── Real-space lattice vectors ───────────────────────────────
/**
 * Returns primitive real-space vectors [a1, a2] in Å.
 *
 * Lattice systems:
 *  square       — a = b, γ = 90°  (e.g. fcc(100) surface)
 *  rectangular  — a ≠ b, γ = 90°  (e.g. fcc(110) surface)
 *  hexagonal    — a = b, γ = 120° (e.g. fcc(111), hcp(001))
 *  oblique      — a, b, γ all free
 *  centered_rect— centered rectangular (Wood c(2×2) etc.)
 *
 * rotationDeg rotates the entire basis frame CCW.
 */
export function getLatticeVectors(
  system: LatticeSystem,
  a: number,
  b: number,
  gamma: number,
  rotationDeg = 0,
): [Vec2, Vec2] {
  const g = (gamma * Math.PI) / 180;
  let v1: Vec2, v2: Vec2;

  switch (system) {
    case 'square':
      v1 = [a, 0]; v2 = [0, a]; break;
    case 'rectangular':
      v1 = [a, 0]; v2 = [0, b]; break;
    case 'hexagonal':
      v1 = [a, 0];
      v2 = [a * Math.cos((2 * Math.PI) / 3), a * Math.sin((2 * Math.PI) / 3)];
      break;
    case 'oblique':
      v1 = [a, 0]; v2 = [b * Math.cos(g), b * Math.sin(g)]; break;
    case 'centered_rect':
      v1 = [a / 2, b / 2]; v2 = [-a / 2, b / 2]; break;
  }

  if (rotationDeg !== 0) {
    const theta = (rotationDeg * Math.PI) / 180;
    v1 = rotateVec(v1, theta);
    v2 = rotateVec(v2, theta);
  }
  return [v1, v2];
}

// ── Reciprocal vectors ───────────────────────────────────────
/** Returns [b1, b2] satisfying ai·bj = 2π δij, in Å⁻¹. */
export function getReciprocalVectors(a1: Vec2, a2: Vec2): [Vec2, Vec2] {
  const det = a1[0] * a2[1] - a1[1] * a2[0];
  return [
    [ (2 * Math.PI * a2[1]) / det, -(2 * Math.PI * a2[0]) / det],
    [-(2 * Math.PI * a1[1]) / det,  (2 * Math.PI * a1[0]) / det],
  ];
}

// ── Superlattice matrix ──────────────────────────────────────
export function applySuperlattice(a1: Vec2, a2: Vec2, M: Matrix2x2): [Vec2, Vec2] {
  return [
    [M[0][0]*a1[0] + M[0][1]*a2[0], M[0][0]*a1[1] + M[0][1]*a2[1]],
    [M[1][0]*a1[0] + M[1][1]*a2[0], M[1][0]*a1[1] + M[1][1]*a2[1]],
  ];
}

// ── Effective real-space vectors for a layer ─────────────────
export function getEffectiveVectors(layer: Layer, substrate: Layer | null): [Vec2, Vec2] {
  const rot = layer.rotationDeg;
  if (layer.mode === 'superlattice' && substrate) {
    const sv = getLatticeVectors(
      substrate.system, substrate.a, substrate.b, substrate.gamma,
      substrate.rotationDeg,
    );
    const [A1, A2] = applySuperlattice(sv[0], sv[1], layer.matrix);
    if (rot !== 0) {
      const theta = (rot * Math.PI) / 180;
      return [rotateVec(A1, theta), rotateVec(A2, theta)];
    }
    return [A1, A2];
  }
  return getLatticeVectors(layer.system, layer.a, layer.b, layer.gamma, rot);
}

// ── Spot generation ──────────────────────────────────────────
/**
 * Generate kinematic LEED spots for one layer.
 *
 * Physical note on Au(100)-(5×20):
 *   The reconstruction consists of TWO orthogonal domains of a
 *   quasi-1D modulation. Domain A has its repeat along [10]
 *   → (5×1) superlattice pattern (4 spots between substrate beams
 *   along h, integer k only → spots lie on horizontal rows).
 *   Domain B is the 90°-rotated twin → (1×5) pattern.
 *   Superimposed they produce the observed cross/star pattern:
 *   4 spots along every substrate row and column, with the full
 *   5×5 interior empty.
 *
 *   This is why the correct model is NOT a (5×20) superlattice
 *   (which would produce a dense 100-spot grid) but rather two
 *   separate (5×1) and (1×5) domain layers.
 */
export function generateSpots(layer: Layer, substrate: Layer | null): ReciprocalSpot[] {
  const [a1, a2] = getEffectiveVectors(layer, substrate);
  const [b1, b2] = getReciprocalVectors(a1, a2);
  const range = layer.hkRange;

  const spots: ReciprocalSpot[] = [];
  for (let h = -range; h <= range; h++) {
    for (let k = -range; k <= range; k++) {
      const x = h * b1[0] + k * b2[0];
      const y = h * b1[1] + k * b2[1];
      spots.push({ h, k, x, y, isSpecular: h === 0 && k === 0 });
    }
  }
  return spots;
}

// ── Real-space atoms ─────────────────────────────────────────
export function generateRealSpaceAtoms(
  layer: Layer,
  substrate: Layer | null,
  windowAng = 30,
  maxAtoms = 3000,
): RealAtom[] {
  const [a1, a2] = getEffectiveVectors(layer, substrate);
  const range = 40;
  const atoms: RealAtom[] = [];

  for (let i = -range; i <= range && atoms.length < maxAtoms; i++) {
    for (let j = -range; j <= range && atoms.length < maxAtoms; j++) {
      const x = i * a1[0] + j * a2[0];
      const y = i * a1[1] + j * a2[1];
      if (Math.abs(x) <= windowAng && Math.abs(y) <= windowAng) {
        atoms.push({ x, y });
      }
    }
  }
  return atoms;
}

// ── Ewald radius ─────────────────────────────────────────────
/** k∥_max [Å⁻¹] = 0.5123 × √(E [eV]) */
export function ewaldRadius(energyEV: number): number {
  return 0.5123 * Math.sqrt(energyEV);
}

// ── Surface presets ──────────────────────────────────────────
export const SURFACE_PRESETS: Record<string, SurfacePreset> = {
  'Au(100)': { system: 'square',       a: 2.884, b: 2.884, gamma: 90  },
  'Au(110)': { system: 'rectangular',  a: 2.884, b: 4.078, gamma: 90  },
  'Au(111)': { system: 'hexagonal',    a: 2.884, b: 2.884, gamma: 120 },
  'Cu(100)': { system: 'square',       a: 2.556, b: 2.556, gamma: 90  },
  'Cu(110)': { system: 'rectangular',  a: 2.556, b: 3.615, gamma: 90  },
  'Cu(111)': { system: 'hexagonal',    a: 2.556, b: 2.556, gamma: 120 },
  'Ag(100)': { system: 'square',       a: 2.890, b: 2.890, gamma: 90  },
  'Ag(111)': { system: 'hexagonal',    a: 2.890, b: 2.890, gamma: 120 },
  'Ni(100)': { system: 'square',       a: 2.492, b: 2.492, gamma: 90  },
  'Ni(110)': { system: 'rectangular',  a: 2.492, b: 3.524, gamma: 90  },
  'Ni(111)': { system: 'hexagonal',    a: 2.492, b: 2.492, gamma: 120 },
  'Pt(100)': { system: 'square',       a: 2.774, b: 2.774, gamma: 90  },
  'Pt(110)': { system: 'rectangular',  a: 2.774, b: 3.924, gamma: 90  },
  'Si(111)': { system: 'hexagonal',    a: 3.840, b: 3.840, gamma: 120 },
  'Si(100)': { system: 'square',       a: 3.840, b: 3.840, gamma: 90  },
  'Ge(111)': { system: 'hexagonal',    a: 3.999, b: 3.999, gamma: 120 },
  'SnS(001)':{ system: 'hexagonal',    a: 3.980, b: 3.980, gamma: 120 },
};

// ── Helpers for building presets ─────────────────────────────
function sub(
  name: string, system: LatticeSystem, a: number, b: number, gamma: number,
): Partial<Layer> {
  return { name, mode: 'direct', system, a, b, gamma, rotationDeg: 0, spotSize: 5, opacity: 1, hkRange: 8, color: '#60a5fa' };
}

function over(
  name: string, M: Matrix2x2, system: LatticeSystem, a: number, b: number, gamma: number, color: string, spotSize = 3,
): Partial<Layer> {
  return { name, mode: 'superlattice', matrix: M, system, a, b, gamma, rotationDeg: 0, spotSize, opacity: 0.9, hkRange: 8, color };
}

// ── Reconstruction presets ───────────────────────────────────
export const RECONSTRUCTION_PRESETS: ReconstructionPreset[] = [
  {
    label: 'Au(100)-(5×20) — two domains',
    description: 'Two orthogonal (5×1)+(1×5) domains — reproduces the cross pattern with 4 spots per axis',
    layers: [
      sub('Au(100) 1×1', 'square', 2.884, 2.884, 90),
      over('(5×1) domain A [10]', [[5,0],[0,1]], 'square', 2.884, 2.884, 90, '#f87171', 3),
      over('(1×5) domain B [01]', [[1,0],[0,5]], 'square', 2.884, 2.884, 90, '#fbbf24', 3),
    ],
  },
  {
    label: 'Au(100)-(5×5)',
    description: 'Full 5×5 commensurate approximant (all fractional spots visible)',
    layers: [
      sub('Au(100) 1×1', 'square', 2.884, 2.884, 90),
      over('(5×5) recon', [[5,0],[0,5]], 'square', 2.884, 2.884, 90, '#f87171'),
    ],
  },
  {
    label: 'Si(111)-(7×7)',
    description: 'DAS reconstruction',
    layers: [
      sub('Si(111) 1×1', 'hexagonal', 3.840, 3.840, 120),
      over('(7×7) DAS', [[7,0],[0,7]], 'hexagonal', 3.840, 3.840, 120, '#4ade80'),
    ],
  },
  {
    label: 'Cu(110)-(2×1)',
    description: 'Missing-row reconstruction',
    layers: [
      sub('Cu(110) 1×1', 'rectangular', 2.556, 3.615, 90),
      over('(2×1) missing row', [[2,0],[0,1]], 'rectangular', 2.556, 3.615, 90, '#fbbf24'),
    ],
  },
  {
    label: 'Pt(110)-(1×2)',
    description: 'Missing-row reconstruction',
    layers: [
      sub('Pt(110) 1×1', 'rectangular', 2.774, 3.924, 90),
      over('(1×2) missing row', [[1,0],[0,2]], 'rectangular', 2.774, 3.924, 90, '#a78bfa'),
    ],
  },
  {
    label: 'Ni(100)-c(2×2)',
    description: 'Centered overlayer — Wood c(2×2) = matrix [[1,1],[-1,1]]',
    layers: [
      sub('Ni(100) 1×1', 'square', 2.492, 2.492, 90),
      over('c(2×2) overlayer', [[1,1],[-1,1]], 'square', 2.492, 2.492, 90, '#fb923c'),
    ],
  },
  {
    label: 'SnS hex + 90° domain',
    description: 'Two rotational domains of SnS on Au(100)',
    layers: [
      { ...sub('Au(100) substrate', 'square', 2.884, 2.884, 90), opacity: 0.6, hkRange: 6 },
      { name:'SnS domain A (0°)',  mode:'direct', system:'hexagonal', a:3.98, b:3.98, gamma:120, rotationDeg:0,  color:'#4ade80', spotSize:4, opacity:1,   hkRange:7 },
      { name:'SnS domain B (90°)', mode:'direct', system:'hexagonal', a:3.98, b:3.98, gamma:120, rotationDeg:90, color:'#fbbf24', spotSize:4, opacity:0.9, hkRange:7 },
    ],
  },
  {
    label: 'Si(100)-(2×1)',
    description: 'Dimer reconstruction — two orthogonal domains',
    layers: [
      sub('Si(100) 1×1', 'square', 3.840, 3.840, 90),
      over('(2×1) domain A', [[2,0],[0,1]], 'square', 3.840, 3.840, 90, '#4ade80'),
      over('(1×2) domain B', [[1,0],[0,2]], 'square', 3.840, 3.840, 90, '#fbbf24'),
    ],
  },
  {
    label: 'Au(111)-(22×√3)',
    description: 'Herringbone reconstruction (commensurate approx)',
    layers: [
      sub('Au(111) 1×1', 'hexagonal', 2.884, 2.884, 120),
      over('(22×√3) approx', [[22,0],[0,3]], 'hexagonal', 2.884, 2.884, 120, '#38bdf8', 2),
    ],
  },
];
