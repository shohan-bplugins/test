import type { MaterialConfig, ProductRenderConfig } from "./types";

/*
 * Applies a resolved configurator config (mesh visibility, material colour /
 * metalness / roughness / clearcoat) to an egjs-view3d model's meshes.
 *
 * Shared by the storefront (storefront/entry.ts, bundled into configurator.js)
 * and the admin's live preview (components/ViewerPreview.tsx), so a variant
 * looks the same in both.
 *
 * No three.js import: every call is a method of a material that already exists
 * in the viewer's scene. Both sides run three 0.134 (no colour management), so
 * the colour maths matches the 3D editor.
 */

type Mat = {
  color?: { set(v: string): { convertSRGBToLinear(): void } };
  map?: unknown;
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  envMapIntensity?: number;
  needsUpdate?: boolean;
  clone(): Mat;
  copy(o: Mat): Mat;
  dispose(): void;
};
type Mesh = { name: string; visible: boolean; material: Mat | Mat[]; isMesh?: boolean };
type Obj = { traverse(fn: (o: Obj & Partial<Mesh>) => void): void };

/** Same naming rule as the editor's meshKeys, or config entries stop matching. */
function meshMap(root: Obj): Map<string, Mesh> {
  const map = new Map<string, Mesh>();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const base = (o.name || "").trim() || "Mesh";
    let name = base;
    for (let n = 2; map.has(name); n++) name = `${base}_${n}`;
    o.name = name;
    map.set(name, o as Mesh);
  });
  return map;
}

export class Styler {
  /** The scene this styler was built for. */
  readonly root: Obj;

  private meshes: Map<string, Mesh>;
  private originals = new Map<string, { material: Mesh["material"]; visible: boolean }>();
  private clones = new Map<string, Mat>();

  constructor(root: Obj) {
    this.root = root;
    this.meshes = meshMap(root);
    for (const [name, m] of this.meshes) {
      this.originals.set(name, { material: m.material, visible: m.visible });
    }
  }

  apply(cfg: ProductRenderConfig) {
    for (const [name, mesh] of this.meshes) {
      const o = this.originals.get(name)!;
      mesh.visible = o.visible;
      mesh.material = o.material;
    }
    for (const [name, mc] of Object.entries(cfg.meshes ?? {})) {
      const mesh = this.meshes.get(name);
      if (mesh && mc?.visible !== undefined) mesh.visible = !!mc.visible;
    }
    const used = new Set<string>();
    for (const [name, mc] of Object.entries(cfg.materials ?? {}) as [string, MaterialConfig][]) {
      const mesh = this.meshes.get(name);
      const orig = this.originals.get(name)?.material;
      if (!mesh || !orig || Array.isArray(orig) || !mc) continue;
      if (
        !mc.baseColor &&
        mc.metalness === undefined &&
        mc.roughness === undefined &&
        mc.clearcoat === undefined
      ) {
        continue;
      }
      let m = this.clones.get(name);
      if (!m) {
        m = orig.clone();
        this.clones.set(name, m);
      } else {
        m.copy(orig);
      }
      used.add(name);
      mesh.material = m;
      if (mc.baseColor && m.color) {
        m.color.set(mc.baseColor).convertSRGBToLinear();
        m.map = null;
      }
      if (mc.metalness !== undefined) m.metalness = Number(mc.metalness);
      if (mc.roughness !== undefined) m.roughness = Number(mc.roughness);
      if (mc.clearcoat !== undefined && "clearcoat" in m) m.clearcoat = Number(mc.clearcoat);
      m.needsUpdate = true;
    }
    for (const [name, m] of this.clones) {
      if (!used.has(name)) {
        m.dispose();
        this.clones.delete(name);
      }
    }
  }
}
