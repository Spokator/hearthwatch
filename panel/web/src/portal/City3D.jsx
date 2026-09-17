// Spokaheim en trois dimensions, dans la main.
//
// La ville arrive en blocs (le même plan que la vue 3D du panel, allégé), le terrain en relief, et les habitants
// s'y déplacent en direct. On tourne la vue au doigt, on touche un habitant pour lui parler, on touche le sol
// pour poser un repère sur sa carte en jeu.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Compass, Loader2 } from 'lucide-react';
import { useT } from '../i18n.jsx';
import { portalApi } from './api.js';
import { PREVIEW_COLORS } from '../pages/cityColors.js';

// Ce que le ciel raconte selon l'heure de Valheim : l'aube dorée, le plein jour, le soir rouge, la nuit bleue.
const SKIES = {
  dawn: { top: '#20293d', bottom: '#6b4a2a', sun: '#ffd9a0', power: 1.9, hemi: 1.1, fog: '#2a2a33' },
  morning: { top: '#13233a', bottom: '#5d7ea6', sun: '#fff3dd', power: 2.2, hemi: 1.5, fog: '#1b2a3a' },
  afternoon: { top: '#13233a', bottom: '#6d86a8', sun: '#fff6e6', power: 2.3, hemi: 1.6, fog: '#1b2a3a' },
  evening: { top: '#1a1b30', bottom: '#8a4a2a', sun: '#ffbe84', power: 1.8, hemi: 1.0, fog: '#2a2230' },
  dusk: { top: '#101528', bottom: '#4a2a3a', sun: '#c98a6a', power: 1.1, hemi: 0.8, fog: '#1a1626' },
  night: { top: '#080b16', bottom: '#141d33', sun: '#8fa6d8', power: 0.6, hemi: 0.5, fog: '#0a0f1c' },
};

export default function City3D({ live, onTalk }) {
  const t = useT();
  const host = useRef(null);
  const world = useRef({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(null);

  // ---------- Construction de la scène (une seule fois) ----------
  useEffect(() => {
    let alive = true;
    const el = host.current;
    if (!el) return undefined;

    const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d1420');
    scene.fog = new THREE.Fog('#0d1420', 320, 900);
    // Voûte du ciel : un dégradé chaud à l'horizon, sombre au zénith.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color('#0a0f18') }, bottom: { value: new THREE.Color('#2b2216') } },
        vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 p; void main(){ float h = clamp(p.y / 700.0 + 0.25, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
      }),
    );
    scene.add(sky);
    const hemi = new THREE.HemisphereLight('#cfe0ff', '#2a2318', 1.5);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffe9c4', 2.1);
    sun.position.set(110, 190, 70);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(48, 1, 1, 2400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 30;
    controls.maxDistance = 520;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
    });

    const group = new THREE.Group();
    scene.add(group);
    const markers = new THREE.Group();
    scene.add(markers);
    world.current = { renderer, scene, camera, controls, group, markers, npcMeshes: new Map(), sky, sun, hemi, disposables: [sky.geometry, sky.material] };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight || Math.round(w * 0.8);
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    // ---------- La ville ----------
    portalApi('/city3d')
      .then((city) => {
        if (!alive) return;
        const { boxes, terrain, summary, arena, places } = city;
        const centre = summary?.center || [0, 0];
        const radius = summary?.radius || 120;
        group.position.set(-centre[0], 0, centre[1]); // le repère du jeu a son z vers le nord
        markers.position.copy(group.position);

        // Relief : la terre autour de la ville, verte au sec et sableuse au bord de l'eau.
        if (terrain?.origin) {
          const span = (terrain.size - 1) * terrain.step;
          const geometry = new THREE.PlaneGeometry(span, span, terrain.size - 1, terrain.size - 1);
          geometry.rotateX(-Math.PI / 2);
          const position = geometry.attributes.position;
          const colors = [];
          const grass = new THREE.Color('#4f6b3a');
          const sand = new THREE.Color('#8d7f5a');
          for (let k = 0; k < position.count; k++) {
            const column = k % terrain.size;
            const row = terrain.size - 1 - Math.floor(k / terrain.size);
            const height = terrain.heights[row * terrain.size + column] ?? 0;
            position.setY(k, height);
            const tint = height < (terrain.water ?? -99) + 0.5 ? sand : grass;
            colors.push(tint.r, tint.g, tint.b);
          }
          geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
          geometry.computeVertexNormals();
          const ground = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
          ground.position.set(terrain.origin[0] + span / 2, 0, -(terrain.origin[1] + span / 2));
          group.add(ground);
          world.current.disposables.push(geometry, ground.material);
          if (Number.isFinite(terrain.water)) {
            const waterGeometry = new THREE.PlaneGeometry(span * 1.6, span * 1.6);
            waterGeometry.rotateX(-Math.PI / 2);
            const water = new THREE.Mesh(waterGeometry, new THREE.MeshLambertMaterial({ color: '#23557f', transparent: true, opacity: 0.6 }));
            water.position.set(ground.position.x, terrain.water, ground.position.z);
            group.add(water);
            world.current.disposables.push(waterGeometry, water.material);
          }
        }

        // Les bâtiments, groupés par matière pour ne faire qu'une poignée d'appels de dessin.
        const byColor = new Map();
        for (const box of boxes) {
          const list = byColor.get(box[7]) || [];
          list.push(box);
          byColor.set(box[7], list);
        }
        const cube = new THREE.BoxGeometry(1, 1, 1);
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        for (const [color, list] of byColor) {
          const material = new THREE.MeshLambertMaterial({ color: PREVIEW_COLORS[color]?.[1] || '#b9b2a4' });
          const mesh = new THREE.InstancedMesh(cube, material, list.length);
          list.forEach(([x, y, z, sx, sy, sz, rot], n) => {
            quaternion.setFromAxisAngle(up, (-rot * Math.PI) / 180);
            matrix.compose(new THREE.Vector3(x, y, -z), quaternion, new THREE.Vector3(Math.max(sx, 0.05), Math.max(sy, 0.05), Math.max(sz, 0.05)));
            mesh.setMatrixAt(n, matrix);
          });
          mesh.instanceMatrix.needsUpdate = true;
          group.add(mesh);
          world.current.disposables.push(material);
        }
        world.current.disposables.push(cube);

        if (arena) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(22.5, 0.7, 8, 64), new THREE.MeshLambertMaterial({ color: '#c4512e' }));
          ring.rotation.x = Math.PI / 2;
          ring.position.set(arena.x, 3, -arena.z);
          group.add(ring);
          world.current.disposables.push(ring.geometry, ring.material);
        }

        // Les portes, marquées d'une flamme pour se repérer.
        for (const place of places || [])
          if (place.gate) {
            const flame = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 10), new THREE.MeshBasicMaterial({ color: '#f0b458' }));
            flame.position.set(place.x, (summary?.floorY ?? 0) + 6, -place.z);
            group.add(flame);
            world.current.disposables.push(flame.geometry, flame.material);
          }

        camera.position.set(centre[0] + radius * 0.2, radius * 1.15, -centre[1] + radius * 1.35);
        camera.position.add(new THREE.Vector3(group.position.x, 0, group.position.z));
        controls.target.set(0, summary?.floorY ?? 0, 0);
        controls.update();
        setLoading(false);
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setLoading(false);
        }
      });

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const item of world.current.disposables || []) item.dispose?.();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  // ---------- La lumière suit l'heure de Valheim ----------
  useEffect(() => {
    const { sky, sun, hemi, scene } = world.current;
    if (!sky || !sun || !hemi || !live?.clock) return;
    const palette = SKIES[live.clock.period] || SKIES.morning;
    sky.material.uniforms.top.value.set(palette.top);
    sky.material.uniforms.bottom.value.set(palette.bottom);
    sun.color.set(palette.sun);
    sun.intensity = palette.power;
    hemi.intensity = palette.hemi;
    scene.fog.color.set(palette.fog);
    scene.background.set(palette.fog);
    // Le soleil tourne avec la journée : rasant à l'aube, haut à midi, couché la nuit.
    const angle = (live.clock.fraction - 0.25) * Math.PI * 2;
    sun.position.set(Math.cos(angle) * 220, Math.max(40, Math.sin(angle) * 240), Math.sin(angle) * 120);
  }, [live?.clock?.period, live?.clock?.fraction]);

  // ---------- Les habitants et toi, rafraîchis à chaque relevé ----------
  useEffect(() => {
    const { markers, npcMeshes } = world.current;
    if (!markers || !live) return;
    const floor = 0;
    const seen = new Set();
    for (const npc of live.npcs || []) {
      seen.add(npc.key);
      let mesh = npcMeshes.get(npc.key);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.ConeGeometry(1.5, 5, 6),
          new THREE.MeshBasicMaterial({ color: npc.dead ? '#d9534e' : '#7cc38a' }),
        );
        mesh.userData.npc = npc.key;
        markers.add(mesh);
        npcMeshes.set(npc.key, mesh);
      }
      mesh.material.color.set(npc.dead ? '#d9534e' : '#7cc38a');
      mesh.position.set(npc.x, floor + 4, -npc.z);
    }
    for (const [key, mesh] of npcMeshes)
      if (!seen.has(key)) {
        markers.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        npcMeshes.delete(key);
      }
    // L'événement du moment : une colonne de lumière plantée là où il faut aller.
    const at = live.event?.at;
    if (at) {
      let beacon = world.current.beacon;
      if (!beacon) {
        beacon = new THREE.Mesh(
          new THREE.CylinderGeometry(2.2, 2.2, 70, 10, 1, true),
          new THREE.MeshBasicMaterial({ color: '#e39b35', transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
        );
        markers.add(beacon);
        world.current.beacon = beacon;
      }
      beacon.position.set(at.x, 35, -at.z);
    } else if (world.current.beacon) {
      markers.remove(world.current.beacon);
      world.current.beacon.geometry.dispose();
      world.current.beacon.material.dispose();
      world.current.beacon = null;
    }

    // Le joueur : une balise bleue.
    if (live.online && live.position) {
      let me = world.current.me;
      if (!me) {
        me = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 9, 10), new THREE.MeshBasicMaterial({ color: '#45a9bf' }));
        markers.add(me);
        world.current.me = me;
      }
      me.position.set(live.position.x, 6, -live.position.z);
    } else if (world.current.me) {
      markers.remove(world.current.me);
      world.current.me.geometry.dispose();
      world.current.me.material.dispose();
      world.current.me = null;
    }
  }, [live]);

  // ---------- Toucher : un habitant, ou le sol ----------
  const tap = async (event) => {
    const { camera, markers, group, renderer } = world.current;
    if (!camera || !renderer) return;
    const box = renderer.domElement.getBoundingClientRect();
    const point = new THREE.Vector2(
      ((event.clientX - box.left) / box.width) * 2 - 1,
      -((event.clientY - box.top) / box.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 3 };
    ray.setFromCamera(point, camera);
    const hits = ray.intersectObjects(markers.children, false);
    if (hits.length && hits[0].object.userData.npc) {
      const target = hits[0].object;
      const before = target.material.color.getHex();
      target.material.color.set('#f6cd86');
      target.scale.setScalar(1.6);
      setTimeout(() => {
        target.material.color.setHex(before);
        target.scale.setScalar(1);
        onTalk(target.userData.npc);
      }, 180);
      return;
    }
    // Sinon : on pose un repère là où le rayon croise le plan du sol.
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return;
    const worldPoint = { x: Math.round(hit.x - group.position.x), z: Math.round(-(hit.z - group.position.z)) };
    setTouched(worldPoint);
    await portalApi('/ping', { method: 'POST', body: worldPoint }).catch(() => {});
  };

  const recentre = () => {
    const { controls, camera, group } = world.current;
    if (!controls || !live?.position) return;
    controls.autoRotate = false;
    controls.target.set(live.position.x + group.position.x, 4, -live.position.z + group.position.z);
    camera.position.set(controls.target.x + 60, 70, controls.target.z + 60);
    controls.update();
  };

  return (
    <section className="overflow-hidden rounded-xl border border-ink-800 bg-ink-950">
      <div className="relative">
        <div ref={host} onClick={tap} className="h-72 w-full touch-pan-y sm:h-96" />
        {loading && (
          <div className="absolute inset-0 grid place-items-center text-ink-500">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}
        {error && <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-blood-400">{error}</p>}
        {live?.online && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              recentre();
            }}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-ember-700/50 bg-ink-950/80 px-3 py-1.5 text-xs text-ember-200 backdrop-blur"
          >
            <Compass className="size-3.5" /> {t('Me retrouver')}
          </button>
        )}
      </div>
      <p className="px-3 py-2 text-xs text-ink-500">
        {touched
          ? t('Repère posé sur ta carte en jeu.')
          : t('Tourne la ville au doigt · touche un habitant pour lui parler · touche le sol pour poser un repère.')}
      </p>
    </section>
  );
}
