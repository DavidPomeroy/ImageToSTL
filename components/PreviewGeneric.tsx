"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { rgbToHex, type RGB } from "@/lib/quantize";

export interface PreviewPart {
  color: RGB;
  positions: number[];
  /** Object name — shown in the "orbit around" picker. */
  name?: string;
}

/** Default world-space (background) colour: a neutral grey. */
const DEFAULT_WORLD_COLOR = "#808080";
const WORLD_COLOR_KEY = "i2stl.worldColor";

/** A selectable orbit target: index 0 is the whole model, 1..n the parts. */
interface OrbitTarget {
  /** World-space centre of the target. */
  center: THREE.Vector3;
}

interface SceneCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  grid: THREE.GridHelper;
  /** Orbit targets: [0] = whole model, then one per (non-empty) part. */
  targets: OrbitTarget[];
}

function disposeGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    const m = child as THREE.Mesh;
    group.remove(m);
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  }
}

/** Persisted world colour (grey by default). */
function readStoredWorldColor(): string {
  if (typeof window === "undefined") return DEFAULT_WORLD_COLOR;
  try {
    const v = window.localStorage.getItem(WORLD_COLOR_KEY);
    if (v && /^#[0-9a-fA-F]{6}$/.test(v)) return v;
  } catch {
    /* localStorage can throw (private mode); fall back to the default */
  }
  return DEFAULT_WORLD_COLOR;
}

/**
 * Move the orbit pivot to `index` (0 = whole model, 1..n = parts), carrying the
 * camera with it so the view keeps its angle and distance and just re-centres on
 * the chosen object. No-op until the model has been built.
 */
function aimAt(ctx: SceneCtx, index: number) {
  const i = Math.min(Math.max(index, 0), ctx.targets.length - 1);
  const target = ctx.targets[i];
  if (!target) return;
  const offset = ctx.camera.position.clone().sub(ctx.controls.target);
  ctx.controls.target.copy(target.center);
  ctx.camera.position.copy(target.center).add(offset);
  ctx.controls.update();
}

/**
 * Generic 3D preview for any list of colored triangle-soup parts.
 *
 * Geometry is rebuilt only when the model actually changes (mirroring
 * Preview3D) — never on a timer — so large meshes (e.g. terrain) don't churn
 * hundreds of thousands of floats and their normals several times a second.
 *
 * A small overlay toolbar lets the viewer set the world-space (background)
 * colour and, when more than one object is shown, pick which object (or the
 * whole world) the camera orbits around.
 */
export default function PreviewGeneric({
  parts,
  bboxMm,
  centerMm,
  fitNonce,
  motion,
}: {
  parts: PreviewPart[];
  bboxMm: { x: number; y: number; z: number };
  centerMm: { x: number; y: number };
  fitNonce: number;
  /**
   * Optional eased slide of matching meshes (e.g. drawers pulling out of a
   * cabinet). Stepped by the render loop and applied as a mesh translation — the
   * geometry is never rebuilt for it, so an animation costs nothing per frame.
   */
  motion?: {
    /** Which meshes move, by `part.name`. */
    match: (name: string) => boolean;
    /** Translation of a fully-open mesh, in the parts' own space (mm). */
    offset: [number, number, number];
    /** Target state; toggling animates from wherever the slide is now. */
    open: boolean;
    /** Duration of the eased move (ms). */
    durationMs?: number;
  };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<SceneCtx | null>(null);
  const fittedFor = useRef(-1);
  const orbitRef = useRef(0);
  /** Live slide state: `t` is linear 0..1 progress, eased when applied. */
  const slideRef = useRef<{
    open: boolean;
    offset: [number, number, number];
    durationMs: number;
    match: (name: string) => boolean;
    t: number;
  } | null>(null);
  const [worldColor, setWorldColor] = useState<string>(() => readStoredWorldColor());
  /** 0 = whole model ("world space"); 1..n = the part at that index. */
  const [orbit, setOrbit] = useState(0);

  // only parts with geometry can be orbited around
  const objects = useMemo(
    () => parts.filter((p) => p.positions && p.positions.length > 0),
    [parts]
  );

  // one-time scene setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(readStoredWorldColor());
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    camera.position.set(140, 110, 170);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.1;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
    });

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(90, 160, 120);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-110, -60, -90);
    scene.add(fill);

    const grid = new THREE.GridHelper(400, 40, 0x3f3f46, 0x27272a);
    grid.position.y = -0.02;
    scene.add(grid);

    const group = new THREE.Group();
    group.rotation.x = -Math.PI / 2;
    scene.add(group);

    let raf = 0;
    let last = performance.now();
    /** Advance the slide and place the moving meshes (no geometry work). */
    const stepSlide = (dt: number) => {
      const s = slideRef.current;
      if (!s) return;
      const target = s.open ? 1 : 0;
      if (s.t !== target) {
        const step = dt / s.durationMs;
        s.t =
          s.t < target
            ? Math.min(target, s.t + step)
            : Math.max(target, s.t - step);
      }
      const e = s.t * s.t * (3 - 2 * s.t); // smoothstep: soft start and stop
      for (const obj of group.children) {
        if ((obj as THREE.Mesh).isMesh && s.match(obj.name)) {
          obj.position.set(s.offset[0] * e, s.offset[1] * e, s.offset[2] * e);
        }
      }
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      stepSlide(Math.min(50, now - last)); // clamp after a backgrounded tab
      last = now;
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    ctxRef.current = { scene, camera, controls, group, grid, targets: [] };

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      controls.dispose();
      disposeGroup(group);
      renderer.dispose();
      renderer.domElement.remove();
      ctxRef.current = null;
    };
  }, []);

  // world-space (background) colour — persist so it carries between tools
  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx) ctx.scene.background = new THREE.Color(worldColor);
    try {
      window.localStorage.setItem(WORLD_COLOR_KEY, worldColor);
    } catch {
      /* ignore */
    }
  }, [worldColor]);

  // keep the slide target up to date — the render loop applies it, so toggling
  // it never rebuilds geometry
  useEffect(() => {
    if (!motion) {
      slideRef.current = null;
      const group = ctxRef.current?.group;
      if (group) for (const obj of group.children) obj.position.set(0, 0, 0);
      return;
    }
    slideRef.current = {
      open: motion.open,
      offset: motion.offset,
      durationMs: Math.max(1, motion.durationMs ?? 900),
      match: motion.match,
      // keep whatever progress is already on screen, so a mid-flight toggle
      // carries on from where it is; a fresh slide starts closed
      t: slideRef.current?.t ?? 0,
    };
  }, [motion]);

  // rebuild geometry only when the model changes
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { group, grid, camera, controls } = ctx;

    disposeGroup(group);

    // Orbit targets: the whole model, then each part's centre. The model is
    // Z-up; the group maps (x, y, z) -> (x - cx, z, -y + cy) after its -90° X
    // rotation, so the world-space centre carries the same transform.
    const targets: OrbitTarget[] = [
      { center: new THREE.Vector3(0, bboxMm.z / 2, 0) },
    ];
    for (const part of objects) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(part.positions), 3)
      );
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(rgbToHex(part.color)),
        roughness: 0.8,
        metalness: 0.02,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = part.name ?? "";
      group.add(mesh);
      geo.computeBoundingBox();
      const c = geo.boundingBox!.getCenter(new THREE.Vector3());
      targets.push({
        center: new THREE.Vector3(c.x - centerMm.x, c.z, -c.y + centerMm.y),
      });
    }
    ctx.targets = targets;

    group.position.set(-centerMm.x, 0, centerMm.y);
    const maxDim = Math.max(bboxMm.x, bboxMm.y, bboxMm.z, 10);
    grid.scale.setScalar(maxDim / 200);

    // drop the selection if the model now has fewer objects
    if (orbitRef.current > targets.length - 1) {
      orbitRef.current = 0;
      setOrbit(0);
    }

    // fit the camera only on first load / "reset view"
    if (fittedFor.current !== fitNonce) {
      fittedFor.current = fitNonce;
      orbitRef.current = 0;
      setOrbit(0);
      const dist = (maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.45;
      camera.position.set(dist * 0.72, dist * 0.6, dist * 0.85);
      camera.near = Math.max(0.1, dist / 200);
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
      controls.target.copy(targets[0].center);
      controls.update();
    } else {
      // keep the pivot on the current selection across rebuilds
      aimAt(ctx, orbitRef.current);
    }
  }, [objects, bboxMm, centerMm, fitNonce]);

  // re-centre when the user picks a different orbit target
  useEffect(() => {
    orbitRef.current = orbit;
    const ctx = ctxRef.current;
    if (ctx) aimAt(ctx, orbit);
  }, [orbit]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute left-2 top-2 flex items-center gap-3 rounded-lg border border-zinc-700/70 bg-zinc-900/85 px-2.5 py-1.5 text-xs text-zinc-300 shadow-lg backdrop-blur">
        <label
          className="flex items-center gap-1.5"
          title="World-space (background) colour"
        >
          <span className="text-zinc-400">World</span>
          <input
            type="color"
            value={worldColor}
            onChange={(e) => setWorldColor(e.target.value)}
            aria-label="World-space colour"
            className="h-5 w-6 cursor-pointer rounded border border-zinc-600 bg-transparent p-0"
          />
        </label>
        {objects.length > 1 && (
          <label className="flex items-center gap-1.5" title="Orbit around">
            <span className="text-zinc-400">Orbit</span>
            <select
              value={orbit}
              onChange={(e) => setOrbit(Number(e.target.value))}
              aria-label="Orbit around"
              className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200"
            >
              <option value={0}>World space</option>
              {objects.map((p, i) => (
                <option key={i} value={i + 1}>
                  {p.name ?? `Object ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
