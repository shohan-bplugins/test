import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { getMaterialConfig, legacyMaterialKey } from "../config";
import type { ProductRenderConfig } from "../types";
import type { SceneNode } from "../editor-state";

/*
 * Engine helpers for the configurator's renderer (three 0.134), ported from
 * the prototype's js/engine/viewer.js. Client-only: imported by the R3F
 * viewport, which is itself loaded lazily after hydration.
 *
 * Mesh keys: config entries are keyed by mesh name, so every mesh needs a
 * stable, unique one. Unnamed meshes become "Mesh", duplicates get "_2",
 * "_3"… in traversal order — the storefront renderer must use the same rule
 * (meshKeys) or entries stop matching.
 */

/** Same files as the prototype's ENVIRONMENT_PRESET_FILES, served from /public/hdri. */
export const ENV_PRESETS: Record<string, string> = {
  studio: "studio_small_03_1k",
  apartment: "lebombo_1k",
  city: "potsdamer_platz_1k",
  dawn: "kiara_1_dawn_1k",
  forest: "forest_slope_1k",
  lobby: "st_fagans_interior_1k",
  night: "dikhololo_night_1k",
  park: "rooitou_park_1k",
  sunset: "venice_sunset_1k",
  warehouse: "empty_warehouse_01_1k",
};

let gltfLoader: GLTFLoader | null = null;
function loader(): GLTFLoader {
  if (!gltfLoader) {
    const draco = new DRACOLoader();
    // Self-hosted (public/draco), copied from three's own examples, so the
    // decoder version always matches this three.
    draco.setDecoderPath("/draco/");
    gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(draco);
  }
  return gltfLoader;
}

export function loadModel(url: string): Promise<THREE.Group> {
  return loader()
    .loadAsync(url)
    .then((gltf) => gltf.scene);
}

/** Give every mesh a unique, stable name and return name -> mesh. */
export function meshKeys(root: THREE.Object3D): Map<string, THREE.Mesh> {
  const map = new Map<string, THREE.Mesh>();
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const base = o.name?.trim() || "Mesh";
    let name = base;
    for (let n = 2; map.has(name); n++) name = `${base}_${n}`;
    o.name = name;
    map.set(name, o as THREE.Mesh);
  });
  return map;
}

/** Scene tree for the sidebar: groups that contain meshes, and the meshes. */
export function hierarchy(root: THREE.Object3D): SceneNode[] {
  const walk = (o: THREE.Object3D): SceneNode | null => {
    const kids = o.children.map(walk).filter(Boolean) as SceneNode[];
    if ((o as THREE.Mesh).isMesh) {
      return { name: o.name, mesh: o.name, children: kids.length ? kids : undefined };
    }
    if (!kids.length) return null;
    if (kids.length === 1 && !o.name) return kids[0];
    return { name: o.name || "Group", children: kids };
  };
  return root.children.map(walk).filter(Boolean) as SceneNode[];
}

type Original = { material: THREE.Material | THREE.Material[]; visible: boolean };

/**
 * Applies a config's meshes/materials to a loaded model. Originals are kept,
 * so every apply starts from the GLB's own look; per-mesh clones are reused.
 */
export class MaterialApplier {
  private originals = new Map<string, Original>();
  private clones = new Map<string, THREE.Material>();

  constructor(private meshes: Map<string, THREE.Mesh>) {
    for (const [name, mesh] of meshes) {
      this.originals.set(name, { material: mesh.material, visible: mesh.visible });
    }
  }

  apply(cfg: ProductRenderConfig, envIntensity: number) {
    for (const [name, mesh] of this.meshes) {
      const o = this.originals.get(name)!;
      mesh.visible = o.visible;
      mesh.material = o.material;
    }
    const used = new Set<string>();
    const unique = (name: string, physical: boolean) => {
      const mesh = this.meshes.get(name)!;
      const orig = this.originals.get(name)!.material;
      if (Array.isArray(orig)) return null;
      let m = this.clones.get(name);
      const wantPhysical = physical && !(m instanceof THREE.MeshPhysicalMaterial);
      if (!m || wantPhysical) {
        m?.dispose();
        if (physical && !(orig instanceof THREE.MeshPhysicalMaterial)) {
          const p = new THREE.MeshPhysicalMaterial();
          THREE.MeshStandardMaterial.prototype.copy.call(p, orig as THREE.MeshStandardMaterial);
          m = p;
        } else {
          m = orig.clone();
        }
        this.clones.set(name, m);
      } else {
        m.copy(orig as never);
      }
      used.add(name);
      mesh.material = m;
      return m as THREE.MeshStandardMaterial & Partial<THREE.MeshPhysicalMaterial>;
    };

    for (const [name, mc] of Object.entries(cfg.meshes ?? {})) {
      const mesh = this.meshes.get(name);
      if (mesh && mc?.visible !== undefined) mesh.visible = !!mc.visible;
    }

    if (cfg.materials) {
      const names = [...this.meshes.keys()];
      const legacy = new Map(names.map((n) => [legacyMaterialKey(n), n]));
      const targets = new Set<string>();
      for (const key of Object.keys(cfg.materials)) {
        if (this.meshes.has(key)) targets.add(key);
        else if (legacy.has(key)) targets.add(legacy.get(key)!);
      }
      for (const name of targets) {
        const mc = getMaterialConfig(cfg.materials, name, names);
        if (
          !mc ||
          (!mc.baseColor &&
            mc.metalness === undefined &&
            mc.roughness === undefined &&
            mc.clearcoat === undefined)
        ) {
          continue;
        }
        const mat = unique(name, mc.clearcoat !== undefined);
        if (!mat) continue;
        if (mc.baseColor && mat.color) {
          // three 0.134 has no colour management: hex is sRGB, the shader wants linear.
          mat.color.set(mc.baseColor).convertSRGBToLinear();
          mat.map = null;
        }
        if (mc.metalness !== undefined) mat.metalness = Number(mc.metalness);
        if (mc.roughness !== undefined) mat.roughness = Number(mc.roughness);
        if (mc.clearcoat !== undefined && "clearcoat" in mat) {
          mat.clearcoat = Number(mc.clearcoat);
        }
        mat.needsUpdate = true;
      }
    }

    for (const [name, m] of this.clones) {
      if (!used.has(name)) {
        m.dispose();
        this.clones.delete(name);
      }
    }
    for (const mesh of this.meshes.values()) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if ("envMapIntensity" in m) (m as THREE.MeshStandardMaterial).envMapIntensity = envIntensity;
      }
    }
  }

  /** Current colour of a mesh's material as #rrggbb (sRGB). */
  colorOf(name: string): string | null {
    const m = this.meshes.get(name)?.material;
    const one = (Array.isArray(m) ? m[0] : m) as THREE.MeshStandardMaterial | undefined;
    return one?.color ? `#${one.color.clone().convertLinearToSRGB().getHexString()}` : null;
  }

  dispose() {
    for (const m of this.clones.values()) m.dispose();
    this.clones.clear();
  }
}

/* ---------- environment ---------- */

/** Decode the prototype's RGBE-in-PNG packing (left half RGB, right half exponent). */
async function decodeRgbePng(blob: Blob) {
  const bmp = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const width = bmp.width / 2;
  const height = bmp.height;
  bmp.close?.();
  const data = new Uint16Array(width * height * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * 8;
    const scale = Math.pow(2, px[s + 4] - 128) / 255;
    data[i * 4] = THREE.DataUtils.toHalfFloat(Math.min(px[s] * scale, 65504));
    data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(Math.min(px[s + 1] * scale, 65504));
    data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(Math.min(px[s + 2] * scale, 65504));
    data[i * 4 + 3] = one;
  }
  return { data, width, height };
}

const hdrCache = new Map<string, Promise<THREE.DataTexture>>();

export function loadHdri(preset: string): Promise<THREE.DataTexture> {
  const file = ENV_PRESETS[preset] ?? ENV_PRESETS.studio;
  if (!hdrCache.has(file)) {
    const p = fetch(`/hdri/${file}.png`)
      .then((r) => {
        if (!r.ok) throw new Error(`HDRI ${file}: ${r.status}`);
        return r.blob();
      })
      .then(decodeRgbePng)
      .then(({ data, width, height }) => {
        const tex = new THREE.DataTexture(
          data,
          width,
          height,
          THREE.RGBAFormat,
          THREE.HalfFloatType,
        );
        tex.encoding = THREE.LinearEncoding;
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.flipY = true;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.needsUpdate = true;
        return tex;
      });
    p.catch(() => hdrCache.delete(file));
    hdrCache.set(file, p);
  }
  return hdrCache.get(file)!;
}

export function roomEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return tex;
}

/** Bounds-fit: centre, radius and a camera distance that frames the model. */
export function fitBounds(root: THREE.Object3D, fovDeg: number, aspect: number) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const halfV = (fovDeg * Math.PI) / 360;
  const half = Math.min(halfV, Math.atan(Math.tan(halfV) * (aspect || 1)));
  return {
    box,
    center: sphere.center.clone(),
    radius: sphere.radius,
    dist: (sphere.radius / Math.sin(half)) * 1.1,
  };
}
