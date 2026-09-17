import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PREVIEW_COLORS } from './cityColors.js';

// Vue 3D d'un plan de ville : le repère du jeu (main gauche, z vers le nord) est converti en repère three.js (z inversé).
export default function CityPreview({ data, className }) {
  const host = useRef(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !data?.preview) return undefined;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d1117');
    scene.fog = new THREE.Fog('#0d1117', 300, 700);
    scene.add(new THREE.HemisphereLight('#dfe8ff', '#3a3226', 1.6));
    const sun = new THREE.DirectionalLight('#fff3dd', 2.2);
    sun.position.set(120, 200, 60);
    scene.add(sun);

    const radius = data.summary?.radius || 100;
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 2000);
    camera.position.set(radius * 0.9, radius * 1.1, radius * 1.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 20;
    controls.maxDistance = 600;

    const disposables = [];

    // Terrain nivelé
    const t = data.terrain;
    if (t) {
      const span = (t.size - 1) * t.step;
      const geometry = new THREE.PlaneGeometry(span, span, t.size - 1, t.size - 1);
      geometry.rotateX(-Math.PI / 2);
      const pos = geometry.attributes.position;
      const colors = [];
      const grass = new THREE.Color('#4f6b3a');
      const sand = new THREE.Color('#8d7f5a');
      for (let k = 0; k < pos.count; k++) {
        // PlaneGeometry pivotée : x croissant vers l'est, z (three) croissant vers le sud, rangées du nord au sud.
        const col = k % t.size;
        const row = Math.floor(k / t.size);
        const i = t.size - 1 - row;
        const h = t.heights[i * t.size + col];
        pos.setY(k, h);
        const c = h < (t.water ?? -99) + 0.5 ? sand : grass;
        colors.push(c.r, c.g, c.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.position.set(t.origin[0] + span / 2, 0, -(t.origin[1] + span / 2));
      scene.add(mesh);
      disposables.push(geometry, mesh.material);
      if (Number.isFinite(t.water)) {
        const waterGeo = new THREE.PlaneGeometry(span, span);
        waterGeo.rotateX(-Math.PI / 2);
        const water = new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({ color: '#2b5d8a', transparent: true, opacity: 0.55 }));
        water.position.set(mesh.position.x, t.water, mesh.position.z);
        scene.add(water);
        disposables.push(waterGeo, water.material);
      }
    }

    // Pièces : une instance de cube par pièce, groupées par couleur.
    const byColor = new Map();
    for (const box of data.preview.boxes) {
      const list = byColor.get(box[7]) || [];
      list.push(box);
      byColor.set(box[7], list);
    }
    const cube = new THREE.BoxGeometry(1, 1, 1);
    disposables.push(cube);
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [color, boxes] of byColor) {
      const material = new THREE.MeshLambertMaterial({ color: PREVIEW_COLORS[color]?.[1] || '#cccccc' });
      const mesh = new THREE.InstancedMesh(cube, material, boxes.length);
      boxes.forEach(([x, y, z, sx, sy, sz, rot], n) => {
        q.setFromAxisAngle(up, (-rot * Math.PI) / 180);
        matrix.compose(new THREE.Vector3(x, y, -z), q, new THREE.Vector3(Math.max(sx, 0.05), Math.max(sy, 0.05), Math.max(sz, 0.05)));
        mesh.setMatrixAt(n, matrix);
      });
      scene.add(mesh);
      disposables.push(material);
    }
    if (data.preview.arena) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(22.5, 0.6, 8, 72), new THREE.MeshLambertMaterial({ color: '#b83a2e' }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(data.preview.arena.x, 3, -data.preview.arena.z);
      scene.add(ring);
      disposables.push(ring.geometry, ring.material);
    }

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    let frame = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [data]);

  return <div ref={host} className={className} />;
}
