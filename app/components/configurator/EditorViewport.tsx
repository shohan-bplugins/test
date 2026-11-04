/* eslint-disable react/no-unknown-property --
 * R3F's lowercase elements are three.js objects, not DOM nodes: `position`,
 * `args`, `castShadow`, `shadow-*` are their real props.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  ENV_PRESETS,
  MaterialApplier,
  fitBounds,
  hierarchy,
  loadHdri,
  loadModel,
  meshKeys,
  roomEnvironment,
} from "~/lib/configurator/engine/scene";
import type { SceneNode } from "~/lib/configurator/editor-state";
import type { CameraView, ProductRenderConfig } from "~/lib/configurator/types";

/*
 * The editor's viewport — React Three Fiber over three 0.134, the version
 * view3d pins (drei needs ≥ 0.137, so controls and helpers are three's own).
 * Default export so the route can lazy-load it: it is client-only, and three
 * plus R3F stay out of every other admin page's bundle.
 */

export type ViewportApi = {
  frame: () => void;
  zoom: (factor: number) => void;
  capture: () => CameraView | null;
  goTo: (view: CameraView) => void;
  /** A part's current colour as #rrggbb, before any override. */
  colorOf: (name: string) => string | null;
  /**
   * The current view as a square JPEG for a product image: one frame rendered
   * without the grid and selection box, centred on `background`.
   */
  snapshot: (background: string) => Promise<Blob | null>;
};

/** Edge of the square snapshot, in pixels. */
const SNAPSHOT_SIZE = 1600;

type Props = {
  modelUrl: string | null;
  config: ProductRenderConfig;
  selection: string | null;
  autoRotate: boolean;
  grid: boolean;
  onSelect: (name: string | null) => void;
  onScene: (meshNames: string[], tree: SceneNode[]) => void;
  onError: (message: string) => void;
};

const DEFAULT_FOV = 45;
const FIT_DIRECTION = new THREE.Vector3(1, 0.6, 1.6).normalize();
const DEG = Math.PI / 180;

function isShown(o: THREE.Object3D | null): boolean {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

type Env = {
  preset?: string;
  intensity?: number;
  backgroundType?: "transparent" | "color" | "preset";
  backgroundColor?: string;
  shadowsEnabled?: boolean;
  shadowIntensity?: number;
};

const EditorViewport = forwardRef<ViewportApi, Props>(function EditorViewport(
  props,
  ref,
) {
  const env = (props.config.environment ?? {}) as Env;
  const bg =
    env.backgroundType === "color" ? (env.backgroundColor ?? "#ffffff") : "transparent";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          bg === "transparent"
            ? "repeating-conic-gradient(#f1f1f1 0% 25%, #fafafa 0% 50%) 50% / 24px 24px"
            : bg,
      }}
    >
      <Canvas
        shadows
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
        camera={{ fov: DEFAULT_FOV, near: 0.01, far: 1000, position: [2, 1.5, 3] }}
        onPointerMissed={(e) => {
          if (e.type === "click") props.onSelect(null);
        }}
      >
        <Scene {...props} apiRef={ref} />
      </Canvas>
    </div>
  );
});

export default EditorViewport;

function Scene({
  modelUrl,
  config,
  selection,
  autoRotate,
  grid,
  onSelect,
  onScene,
  onError,
  apiRef,
}: Props & { apiRef: React.ForwardedRef<ViewportApi> }) {
  const { gl, scene, camera, invalidate, size } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const [root, setRoot] = useState<THREE.Group | null>(null);
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const applierRef = useRef<MaterialApplier | null>(null);
  const homeRef = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const env = (config.environment ?? {}) as Env;
  const intensity = env.intensity ?? 1;

  // Orbit controls (three's own; drei is not compatible with this three).
  const controls = useMemo(() => {
    const c = new OrbitControls(cam, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    return c;
  }, [cam, gl]);
  useEffect(() => {
    const onChange = () => invalidate();
    controls.addEventListener("change", onChange);
    return () => {
      controls.removeEventListener("change", onChange);
      controls.dispose();
    };
  }, [controls, invalidate]);
  useFrame(() => {
    if (controls.update()) invalidate();
    if (controls.autoRotate) invalidate();
  });

  // Model
  useEffect(() => {
    if (!modelUrl) {
      setRoot(null);
      onScene([], []);
      return;
    }
    let cancelled = false;
    loadModel(modelUrl)
      .then((group) => {
        if (cancelled) return;
        const meshes = meshKeys(group);
        group.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        meshesRef.current = meshes;
        applierRef.current?.dispose();
        applierRef.current = new MaterialApplier(meshes);
        setRoot(group);
        onScene([...meshes.keys()], hierarchy(group));
      })
      .catch((err) => {
        if (!cancelled) onError(String(err?.message ?? err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  // Config -> materials / visibility
  useEffect(() => {
    if (!root || !applierRef.current) return;
    applierRef.current.apply(config, intensity);
    invalidate();
  }, [root, config, intensity, invalidate]);

  // Camera: saved start view, else bounds fit. Re-runs on model load and when
  // the saved view changes (capture / reset).
  const camCfg = config.camera ?? null;
  const camKey = JSON.stringify(camCfg ? [camCfg.position, camCfg.target, camCfg.fov] : null);
  useEffect(() => {
    if (!root) return;
    const fov = typeof camCfg?.fov === "number" ? camCfg.fov : DEFAULT_FOV;
    cam.fov = fov;
    const hasView =
      Array.isArray(camCfg?.position) && Array.isArray(camCfg?.target);
    let target: THREE.Vector3;
    let dist: number;
    if (hasView) {
      cam.position.fromArray(camCfg!.position);
      target = new THREE.Vector3().fromArray(camCfg!.target);
      dist = cam.position.distanceTo(target);
    } else {
      const b = fitBounds(root, fov, size.width / Math.max(1, size.height));
      if (!b) return;
      target = b.center;
      dist = b.dist;
      cam.position.copy(target).addScaledVector(FIT_DIRECTION, dist);
    }
    cam.near = Math.max(0.001, dist * 0.005);
    cam.far = dist * 100;
    cam.updateProjectionMatrix();
    controls.target.copy(target);
    controls.update();
    homeRef.current = { pos: cam.position.clone(), target: target.clone() };
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, camKey]);

  // Camera locks + auto-rotate
  const lock = (camCfg?.lock ?? {}) as Record<string, number | boolean | undefined>;
  const lockKey = JSON.stringify(lock);
  useEffect(() => {
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    controls.enableRotate = lock.rotate !== false;
    controls.enableZoom = lock.zoom !== false;
    controls.enablePan = lock.pan !== false;
    controls.minPolarAngle = (n(lock.minPolarAngle) ?? 0) * DEG;
    controls.maxPolarAngle = n(lock.maxPolarAngle) !== undefined ? n(lock.maxPolarAngle)! * DEG : Math.PI;
    controls.minDistance = n(lock.minDistance) ?? 0;
    controls.maxDistance = n(lock.maxDistance) ?? Infinity;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.2;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, lockKey, autoRotate]);

  // Environment (HDRI preset, falls back to a room environment)
  const preset = env.preset && ENV_PRESETS[env.preset] ? env.preset : "studio";
  const envBg = env.backgroundType === "preset";
  useEffect(() => {
    let cancelled = false;
    const pmrem = new THREE.PMREMGenerator(gl);
    let target: THREE.WebGLRenderTarget | null = null;
    loadHdri(preset)
      .then((hdr) => {
        if (cancelled) return;
        target = pmrem.fromEquirectangular(hdr);
        scene.environment = target.texture;
        scene.background = envBg ? hdr : null;
        invalidate();
      })
      .catch(() => {
        if (cancelled) return;
        scene.environment = roomEnvironment(gl);
        scene.background = null;
        invalidate();
      });
    return () => {
      cancelled = true;
      target?.dispose();
      pmrem.dispose();
    };
  }, [preset, envBg, gl, scene, invalidate]);

  // Selection outline
  useEffect(() => {
    const mesh = selection ? meshesRef.current.get(selection) : null;
    if (!mesh) return;
    const helper = new THREE.BoxHelper(mesh, 0x2c6ecb);
    scene.add(helper);
    invalidate();
    return () => {
      scene.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
      invalidate();
    };
  }, [selection, root, scene, invalidate]);

  // Floor (shadow catcher + grid) sized to the model
  const floor = useMemo(() => {
    if (!root) return null;
    const b = new THREE.Box3().setFromObject(root);
    const s = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    return { y: b.min.y, x: c.x, z: c.z, size: Math.max(s.x, s.z) * 3 || 1 };
  }, [root]);

  useImperativeHandle(
    apiRef,
    () => ({
      frame() {
        const h = homeRef.current;
        if (!h) return;
        cam.position.copy(h.pos);
        controls.target.copy(h.target);
        controls.update();
        invalidate();
      },
      zoom(factor) {
        const dir = cam.position.clone().sub(controls.target);
        cam.position.copy(controls.target).addScaledVector(dir, factor);
        controls.update();
        invalidate();
      },
      capture() {
        const r = (v: THREE.Vector3) =>
          v.toArray().map((x) => Math.round(x * 1000) / 1000) as [number, number, number];
        return { position: r(cam.position), target: r(controls.target), fov: cam.fov };
      },
      goTo(view) {
        cam.position.fromArray(view.position);
        controls.target.fromArray(view.target);
        if (view.fov) {
          cam.fov = view.fov;
          cam.updateProjectionMatrix();
        }
        controls.update();
        invalidate();
      },
      colorOf(name) {
        return applierRef.current?.colorOf(name) ?? null;
      },
      snapshot(background) {
        // Editor-only overlays stay out of the picture.
        const hidden: THREE.Object3D[] = [];
        scene.traverse((o) => {
          if (o.visible && (o instanceof THREE.BoxHelper || o instanceof THREE.GridHelper)) {
            o.visible = false;
            hidden.push(o);
          }
        });
        gl.render(scene, cam);
        const src = gl.domElement;
        const out = document.createElement("canvas");
        out.width = out.height = SNAPSHOT_SIZE;
        const ctx = out.getContext("2d");
        if (ctx) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, SNAPSHOT_SIZE, SNAPSHOT_SIZE);
          const k = SNAPSHOT_SIZE / Math.max(src.width, src.height);
          const w = src.width * k;
          const h = src.height * k;
          ctx.drawImage(src, (SNAPSHOT_SIZE - w) / 2, (SNAPSHOT_SIZE - h) / 2, w, h);
        }
        for (const o of hidden) o.visible = true;
        invalidate();
        return new Promise((resolve) =>
          ctx ? out.toBlob(resolve, "image/jpeg", 0.92) : resolve(null),
        );
      },
    }),
    [cam, controls, invalidate, gl, scene],
  );

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // A drag that orbits the camera is not a click.
    if (e.delta > 4) return;
    const hit = e.intersections.find((i) => isShown(i.object) && (i.object as THREE.Mesh).isMesh);
    if (!hit) return;
    e.stopPropagation();
    onSelect(hit.object.name);
  };

  const shadowsOn = env.shadowsEnabled !== false;
  const radius = floor ? floor.size / 3 : 1;

  return (
    <>
      <ambientLight intensity={intensity * 0.4} />
      <directionalLight
        position={[radius * 2, radius * 4, radius * 2.5]}
        intensity={intensity * 0.8}
        castShadow={shadowsOn}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-radius * 2}
        shadow-camera-right={radius * 2}
        shadow-camera-top={radius * 2}
        shadow-camera-bottom={-radius * 2}
        shadow-bias={-0.0005}
      />
      {root ? <primitive object={root} onClick={onClick} /> : null}
      {floor && shadowsOn ? (
        <mesh
          rotation-x={-Math.PI / 2}
          position={[floor.x, floor.y + 0.0005, floor.z]}
          receiveShadow
        >
          <planeGeometry args={[floor.size, floor.size]} />
          <shadowMaterial transparent opacity={env.shadowIntensity ?? 0.5} />
        </mesh>
      ) : null}
      {floor && grid ? (
        <gridHelper
          args={[floor.size, 20, 0x9a9a9a, 0xd0d0d0]}
          position={[floor.x, floor.y, floor.z]}
        />
      ) : null}
    </>
  );
}
