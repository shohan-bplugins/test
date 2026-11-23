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

/**
 * Turns off frustum culling where three cannot cull correctly.
 *
 * three decides whether to draw a mesh from its geometry's bounding sphere in
 * bind pose. For a skinned or morphed mesh that sphere ignores the bones, so it
 * can sit far from what is actually drawn — fine while the whole model is in
 * view, but zoom in and the stale sphere leaves the frustum and the mesh is
 * skipped. Small separate parts (a character's eyes, teeth, collar) are the
 * ones that vanish. Returns how many meshes were changed.
 */
export function disableUnsafeCulling(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const morphed = Object.keys(mesh.geometry?.morphAttributes ?? {}).length > 0;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh || morphed) {
      mesh.frustumCulled = false;
      n++;
    }
  });
  return n;
}

/**
 * Near/far planes that follow the camera, from how far it is from the model.
 *
 * Fixed planes set from the opening distance clip whatever the merchant zooms
 * up to (near too far out) and waste depth precision (far too far out), which
 * shows as small inset parts — eyes in their sockets — losing to the surface
 * around them. Outside the model the near plane sits halfway to its closest
 * point, so nothing of it is ever clipped; inside it, a tiny fraction of the
 * model's size. Far covers the model plus the floor around it (3× its size).
 */
export function clipPlanesFor(cameraPos: THREE.Vector3, bounds: THREE.Box3) {
  const size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1e-6);
  const toBox = bounds.distanceToPoint(cameraPos);
  const toCenter = cameraPos.distanceTo(bounds.getCenter(new THREE.Vector3()));
  const near = Math.max(toBox * 0.5, size * 1e-4);
  const far = Math.max(toCenter + size * 3, near * 10);
  return { near, far };
}

/** At most this many vertices are posed per skinned mesh when measuring it. */
const SKIN_SAMPLE_LIMIT = 20_000;

/**
 * World-space bounds of what the model actually draws.
 *
 * `Box3.setFromObject` (three 0.134) reads each geometry's bind-pose box and
 * ignores bone transforms. For a rigged GLB — an armature exported at 0.01 or
 * 100 scale is common — that box can be off by orders of magnitude, which is
 * what made some models open as a speck and others fill the screen. Skinned
 * meshes are measured from their posed vertices instead (sampled, so a heavy
 * mesh costs one bounded pass).
 */
export function modelBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const skinned = o as THREE.SkinnedMesh;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (skinned.isSkinnedMesh && skinned.skeleton && pos) {
      skinned.skeleton.update();
      const step = Math.max(1, Math.floor(pos.count / SKIN_SAMPLE_LIMIT));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        skinned.boneTransform(i, v);
        v.applyMatrix4(skinned.matrixWorld);
        box.expandByPoint(v);
      }
      return;
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    if (local && !local.isEmpty()) {
      box.union(local.clone().applyMatrix4(mesh.matrixWorld));
    }
  });
  return box;
}

/**
 * Share of the viewport's limiting dimension the model fills in the default
 * view. Fixed, so every product opens at the same visual size whatever its
 * real-world units: a ring modelled in millimetres and a sofa in metres both
 * come out filling three quarters of the frame.
 */
export const FIT_FILL = 0.75;

/**
 * The camera distance at which `box`, seen from `direction`, fills `fill` of
 * the viewport — exactly, using the box's eight corners rather than its
 * bounding sphere. A sphere framed long or flat models (a pen, a rug, a sign)
 * far too small, because the sphere is much bigger than what the camera sees.
 */
export function fitBox(
  box: THREE.Box3,
  fovDeg: number,
  aspect: number,
  direction: THREE.Vector3,
  fill: number = FIT_FILL,
) {
  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const d = direction.clone().normalize();
  // Camera basis looking from `d` toward the centre, world-up kept upright.
  const forward = d.clone().negate();
  let right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-8) right = new THREE.Vector3(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const tanV = Math.tan((fovDeg * Math.PI) / 360) * fill;
  const tanH = tanV * (aspect > 0 && Number.isFinite(aspect) ? aspect : 1);

  let dist = 0;
  let nearest = 0;
  const c = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    c.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    ).sub(center);
    const x = Math.abs(c.dot(right));
    const y = Math.abs(c.dot(up));
    const z = c.dot(d); // toward the camera
    // The corner sits at depth (dist - z); it must fit inside the frustum there.
    dist = Math.max(dist, z + x / tanH, z + y / tanV);
    nearest = Math.max(nearest, z);
  }
  const size = box.getSize(new THREE.Vector3()).length();
  // Never put the camera inside the model, whatever the angles say.
  dist = Math.max(dist, nearest + size * 0.05, 1e-4);
  return { box, center, dist, size };
}
