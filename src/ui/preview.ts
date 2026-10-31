// The three.js render of a built track, for the Content Manager image (ui/preview.png) and the
// SHOTS renders. Nothing interactive. docs/specs/headless-page.md, "The preview": framing and look
// must match the old preview pixel for pixel (render_diff.py compares against saved shots).

import * as THREE from "three";
import { IDENTITY, type Kn5MeshNode, type Kn5Model, type Kn5Node } from "../core/kn5";
import type { Vec3 } from "../core/mesh";
import type { RoadPlan } from "../core/road";
import { chooseTexture, liftEye, placeEye, startView, toAc } from "./previewMath";

export interface PreviewScene {
  /** PNG of the start view, markers hidden. Leaves the renderer at this size. */
  snapshot(width: number, height: number): Promise<Uint8Array>;
  /** Places the camera and renders one frame (markers shown). */
  view(eye: Vec3, target: Vec3): void;
  dispose(): void;
}

export type RawTextures = Record<string, { rgba: Uint8Array; width: number; height: number }>;

const WIDTH = 1024, HEIGHT = 576;
const SKY = 0xc2d3e3;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 sun;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 6; k++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 zenith = vec3(0.23, 0.45, 0.78), horizon = vec3(0.76, 0.83, 0.89);
  vec3 col = d.y >= 0.0
    ? mix(horizon, zenith, pow(max(d.y, 0.0), 0.5))
    : mix(horizon, vec3(0.6, 0.64, 0.64), min(1.0, -d.y * 4.0));
  float sd = max(dot(d, sun), 0.0);
  col += vec3(1.0, 0.92, 0.75) * (pow(sd, 800.0) * 3.0 + pow(sd, 10.0) * 0.16);
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.06) * 0.9;
    float fade = smoothstep(0.0, 0.18, d.y);
    float ci = fbm(vec2(uv.x * 0.35 + 20.0, uv.y * 2.5));
    col = mix(col, vec3(0.97, 0.98, 1.0), smoothstep(0.58, 0.85, ci) * 0.3 * fade);
    float n = fbm(uv + vec2(3.1, 7.4));
    float cover = smoothstep(0.47, 0.66, n);
    float toward = fbm(uv + vec2(3.1, 7.4) + sun.xz * 0.12);
    float lit = clamp(0.82 + (n - toward) * 3.5, 0.55, 1.08);
    vec3 cloud = vec3(1.0, 0.99, 0.97) * lit;
    cloud = mix(cloud, vec3(0.6, 0.64, 0.7), smoothstep(0.7, 0.9, n) * 0.45);
    cloud = mix(cloud, horizon, 1.0 - fade);
    col = mix(col, cloud, cover * smoothstep(0.0, 0.06, d.y));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function finish<T extends THREE.Texture>(tex: T): T {
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export async function createPreview(
  canvas: HTMLCanvasElement,
  model: Kn5Model,
  plan: RoadPlan,
  chunkImages: Map<string, OffscreenCanvas>,
  rawTextures: RawTextures = {},
): Promise<PreviewScene> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 700, 4500);
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x4a4632, 1.6));
  const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.8);
  sunLight.position.set(300, 600, 200);
  scene.add(sunLight);

  const camera = new THREE.PerspectiveCamera(55, WIDTH / HEIGHT, 0.5, 8000);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(7000, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: { sun: { value: sunLight.position.clone().normalize() } },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  // Textures, one per source picture.
  const kn5Textures = new Map(model.textures.map((t) => [t.name, t.data]));
  const textures = new Map<string, Promise<THREE.Texture | undefined>>();
  const textureFor = (materialName: string, texName: string | undefined): Promise<THREE.Texture | undefined> => {
    const choice = chooseTexture(materialName, texName, chunkImages, new Set(Object.keys(rawTextures)), kn5Textures);
    if (choice.kind === "none") return Promise.resolve(undefined);
    const key = `${choice.kind}:${choice.kind === "chunk" ? choice.key : choice.name}`;
    let tex = textures.get(key);
    if (!tex) {
      if (choice.kind === "chunk") {
        tex = Promise.resolve(finish(new THREE.CanvasTexture(chunkImages.get(choice.key)!)));
      } else if (choice.kind === "raw") {
        const r = rawTextures[choice.name];
        const t = new THREE.DataTexture(r.rgba, r.width, r.height, THREE.RGBAFormat);
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        tex = Promise.resolve(finish(t));
      } else {
        const data = kn5Textures.get(choice.name)!;
        tex = createImageBitmap(new Blob([data as BlobPart], { type: "image/png" }))
          .then((bmp) => finish(new THREE.Texture(bmp)) as THREE.Texture)
          .catch(() => undefined);
      }
      textures.set(key, tex);
    }
    return tex;
  };

  const materials = new Map<string, THREE.Material>();
  for (const m of model.materials) {
    const map = await textureFor(m.name, m.textures.txDiffuse);
    materials.set(m.name, new THREE.MeshLambertMaterial({
      color: map ? 0xffffff : 0x6b7a4a,
      map: map ?? null,
      ...(m.alphaTested ? { alphaTest: 0.5 } : {}),
    }));
  }
  const fallback = new THREE.MeshLambertMaterial({ color: 0x6b7a4a });

  const meshOf = (node: Kn5MeshNode): THREE.Mesh => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(node.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(node.normals, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(node.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(node.indices, 1));
    const mesh = new THREE.Mesh(g, materials.get(node.material) ?? fallback);
    mesh.name = node.name;
    return mesh;
  };
  const isIdentity = (t: number[]) => t.length === 16 && t.every((v, i) => v === IDENTITY[i]);
  const add = (node: Kn5Node, parent: THREE.Object3D) => {
    if (node.kind === "mesh") {
      if (node.renderable !== false) parent.add(meshOf(node));
      return;
    }
    let into = parent;
    if (!isIdentity(node.transform)) {
      const g = new THREE.Group();
      g.name = node.name;
      g.matrixAutoUpdate = false;
      g.matrix.fromArray(node.transform);
      parent.add(g);
      into = g;
    }
    for (const c of node.children) add(c, into);
  };
  const track = new THREE.Group();
  add(model.root, track);
  scene.add(track);

  // Start (green) and, point to point, finish (red) markers.
  const markers: THREE.Mesh[] = [];
  const marker = (i: number, colour: number) => {
    const s = plan.samples[i];
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: colour }));
    m.position.set(...toAc(s.pos[0], s.pos[1], s.h + 2));
    scene.add(m);
    markers.push(m);
  };
  if (plan.samples.length) {
    marker(0, 0x4fd486);
    if (!plan.closed) marker(plan.samples.length - 1, 0xef5b5b);
  }

  const place = (eye: Vec3, target: Vec3) => {
    const at = placeEye(eye, target);
    camera.position.set(at[0], at[1], at[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(target[0], target[1], target[2]);
  };
  const render = () => {
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
  };

  return {
    async snapshot(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const { eye, target } = startView(plan.samples);
      scene.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(new THREE.Vector3(eye[0], eye[1] + 500, eye[2]), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(track, true)[0];
      place(liftEye(eye, hit?.point.y), target);
      for (const m of markers) m.visible = false;
      try {
        render();
      } finally {
        for (const m of markers) m.visible = true;
      }
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
      if (!blob) throw new Error("the preview canvas gave no PNG");
      return new Uint8Array(await blob.arrayBuffer());
    },
    view(eye, target) {
      place(eye, target);
      render();
    },
    dispose() {
      const textureSet = new Set<THREE.Texture>();
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
          if (mat instanceof THREE.MeshLambertMaterial && mat.map) textureSet.add(mat.map);
          mat.dispose();
        }
      });
      fallback.dispose();
      for (const t of textureSet) t.dispose();
      renderer.dispose();
    },
  };
}
