"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ProcessedImage } from "@/lib/pipeline";
import { meshPositions } from "@/lib/mesh";
import { rgbToHex } from "@/lib/quantize";

interface SceneCtx {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  grid: THREE.GridHelper;
}

function disposeGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    const m = child as THREE.Mesh;
    group.remove(m);
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  }
}

export default function Preview3D({
  processed,
  fitNonce,
}: {
  processed: ProcessedImage;
  fitNonce: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<SceneCtx | null>(null);
  const fittedFor = useRef(-1);

  // one-time scene setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
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
    group.rotation.x = -Math.PI / 2; // model is Z-up; three.js view is Y-up
    scene.add(group);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
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

    ctxRef.current = { camera, controls, group, grid };

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

  // rebuild geometry whenever the processed model changes
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { group, grid, camera, controls } = ctx;

    disposeGroup(group);

    for (const part of processed.meshes) {
      if (part.boxes.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(
          new Float32Array(meshPositions(part.boxes, part.z0, part.z1)),
          3
        )
      );
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(rgbToHex(part.color)),
        roughness: 0.8,
        metalness: 0.02,
      });
      group.add(new THREE.Mesh(geo, mat));
    }

    // Model occupies x:[0,W] y:[0,H] z:[0,D]. After the group's -90° X
    // rotation, world coords are (x, z, -y): center on origin, base on y=0.
    group.position.set(-processed.widthMm / 2, 0, processed.heightMm / 2);

    const maxDim = Math.max(processed.widthMm, processed.heightMm, 10);
    grid.scale.setScalar(maxDim / 200);

    // fit the camera only on first load / new image / "reset view"
    if (fittedFor.current !== fitNonce) {
      fittedFor.current = fitNonce;
      const dist =
        (maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.45;
      camera.position.set(dist * 0.72, dist * 0.6, dist * 0.85);
      camera.near = Math.max(0.1, dist / 200);
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
      controls.target.set(0, processed.depthMm, 0);
      controls.update();
    }
  }, [processed, fitNonce]);

  return <div ref={containerRef} className="h-full w-full" />;
}
