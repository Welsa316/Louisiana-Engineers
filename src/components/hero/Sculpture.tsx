import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import gsap from "gsap";
import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { buildStructure, type Joint, type Member, type Plate } from "./structure";
import type { HeroMotion } from "./motion";

const WINDOW = 0.26;
const FOV = 30;
const BASE_DISTANCE = 15.5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const local = (progress: number, order: number) =>
  easeOut(clamp01((progress - order * (1 - WINDOW)) / WINDOW));

const matrix = new Matrix4();
const position = new Vector3();
const scale = new Vector3();
const unit = new Quaternion();

/* Materials are shared across instanced meshes. */
const metal = new MeshStandardMaterial({
  color: "#d3cbbb",
  metalness: 1,
  roughness: 0.32,
  envMapIntensity: 1.15,
});
const cableMetal = new MeshStandardMaterial({
  color: "#9a9486",
  metalness: 0.9,
  roughness: 0.5,
});
const joint = new MeshStandardMaterial({
  color: "#2d2d2a",
  metalness: 1,
  roughness: 0.18,
  envMapIntensity: 1.3,
});
const plateMetal = new MeshStandardMaterial({
  color: "#c9c2b2",
  metalness: 0.55,
  roughness: 0.62,
  side: DoubleSide,
  transparent: true,
  opacity: 1,
  envMapIntensity: 1,
});

function Members({
  members,
  motion,
  material = metal,
}: {
  members: Member[];
  motion: RefObject<HeroMotion>;
  material?: MeshStandardMaterial;
}) {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new CylinderGeometry(1, 1, 1, 12, 1), []);
  const settled = useRef(-1);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const progress = motion.current.progress;
    if (settled.current === progress) return;
    settled.current = progress;
    members.forEach((m, i) => {
      const e = local(progress, m.order);
      const len = Math.max(m.length * e, 1e-4);
      // Members extend from their first joint toward the second.
      position.copy(m.a).addScaledVector(m.dir, len / 2);
      scale.set(m.radius, len, m.radius);
      matrix.compose(position, m.quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, members.length]}
      frustumCulled={false}
    />
  );
}

function Joints({ joints, motion }: { joints: Joint[]; motion: RefObject<HeroMotion> }) {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new SphereGeometry(1, 20, 16), []);
  const settled = useRef(-1);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const progress = motion.current.progress;
    if (settled.current === progress) return;
    settled.current = progress;
    joints.forEach((j, i) => {
      const e = local(progress, Math.min(1, j.order));
      const r = Math.max(j.radius * e, 1e-4);
      scale.set(r, r, r);
      matrix.compose(j.p, unit, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[geometry, joint, joints.length]} frustumCulled={false} />
  );
}

function PlateMesh({ plate, motion }: { plate: Plate; motion: RefObject<HeroMotion> }) {
  const ref = useRef<Mesh>(null);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const [a, b, c] = plate.points;
    // Inset the plate slightly from the members so joints stay visible.
    const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    const inset = (p: Vector3) => p.clone().lerp(centroid, 0.1);
    const pts = [inset(a), inset(b), inset(c)];
    g.setAttribute(
      "position",
      new Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3),
    );
    g.computeVertexNormals();
    return g;
  }, [plate]);
  const material = useMemo(() => plateMetal.clone(), []);
  const centroid = useMemo(
    () => plate.points[0].clone().add(plate.points[1]).add(plate.points[2]).multiplyScalar(1 / 3),
    [plate],
  );

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const e = local(motion.current.progress, plate.order);
    material.opacity = e;
    // Plates slide into place along their normal.
    mesh.position.copy(plate.normal).multiplyScalar((1 - e) * 0.6);
    const s = 0.9 + 0.1 * e;
    mesh.scale.setScalar(s);
    mesh.position.add(centroid.clone().multiplyScalar(1 - s));
  });

  return <mesh ref={ref} geometry={geometry} material={material} />;
}

function Rig({ motion, structure }: { motion: RefObject<HeroMotion>; structure: ReturnType<typeof buildStructure> }) {
  const pivot = useRef<Group>(null);
  const rotor = useRef<Group>(null);
  const floater = useRef<Group>(null);
  const { camera, size } = useThree();
  const aspect = size.width / Math.max(1, size.height);

  // Keep the structure's width filling the viewport on narrow screens.
  const distance = useMemo(() => {
    const halfWidth = structure.bounds.halfWidth * 1.12;
    const needed = halfWidth / (Math.tan((FOV / 2) * (Math.PI / 180)) * aspect);
    return Math.max(BASE_DISTANCE, needed);
  }, [aspect, structure]);
  // Vertical placement as a fraction of the viewport: below centre on wide
  // screens so the form rises behind the type, higher on phones so the
  // copy sits beneath it.
  const centre = aspect < 0.9 ? 0.34 : aspect < 1.3 ? 0.5 : 0.57;
  const lift = (0.5 - centre) * 2 * distance * Math.tan((FOV / 2) * (Math.PI / 180));

  useFrame((state, delta) => {
    const m = motion.current;
    camera.position.set(0, 0, distance * m.camera);
    camera.lookAt(0, 0, 0);

    const p = pivot.current;
    if (p) {
      const targetY = m.reduced ? 0 : m.pointerX * 0.16;
      const targetX = m.reduced ? 0 : -m.pointerY * 0.08;
      p.rotation.y += (targetY - p.rotation.y) * Math.min(1, delta * 2.2);
      p.rotation.x += (targetX - p.rotation.x) * Math.min(1, delta * 2.2);
    }
    const r = rotor.current;
    if (r && !m.reduced) r.rotation.y += delta * 0.045 * m.progress;
    const f = floater.current;
    if (f && !m.reduced) {
      const t = state.clock.elapsedTime;
      f.position.y = lift + Math.sin(t * 0.45) * 0.035 * m.progress;
      f.rotation.z = Math.sin(t * 0.3) * 0.006 * m.progress;
    } else if (f) {
      f.position.y = lift;
    }
  });

  return (
    <group ref={pivot}>
      <group ref={floater} position={[0, lift, 0]}>
        <Members members={structure.staticMembers.filter((m) => m.kind !== "cable")} motion={motion} />
        <Members members={structure.staticMembers.filter((m) => m.kind === "cable")} motion={motion} material={cableMetal} />
        <Joints joints={structure.staticJoints} motion={motion} />
        {structure.plates.map((plate, i) => (
          <PlateMesh key={i} plate={plate} motion={motion} />
        ))}
        <group ref={rotor}>
          <Members members={structure.rotorMembers} motion={motion} />
          <Joints joints={structure.rotorJoints} motion={motion} />
        </group>
      </group>
      <ContactShadows
        position={[0, lift + structure.bounds.bottom - 0.5, 0]}
        opacity={0.55}
        scale={18}
        blur={2.8}
        far={6}
        resolution={512}
        color="#101a14"
      />
    </group>
  );
}

function Assembly({ motion }: { motion: RefObject<HeroMotion> }) {
  const structure = useMemo(() => buildStructure(), []);

  useEffect(() => {
    const m = motion.current;
    if (m.reduced) return;
    const elapsed = (performance.now() - m.mountedAt) / 1000;
    const delay = Math.max(0, 0.55 - elapsed);
    const tween = gsap.to(m, {
      progress: 1,
      duration: 3,
      ease: "power1.inOut",
      delay,
    });
    return () => {
      tween.kill();
    };
  }, [motion]);

  return <Rig motion={motion} structure={structure} />;
}

export default function Sculpture({ motion }: { motion: RefObject<HeroMotion> }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ fov: FOV, near: 0.1, far: 200, position: [0, 0.35, BASE_DISTANCE] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ pointerEvents: "none" }}
    >
      <hemisphereLight args={["#e9eee8", "#36453c", 0.6]} />
      <directionalLight position={[5, 8, 6]} intensity={1.5} color="#fff5e4" />
      <directionalLight position={[-7, 3, -4]} intensity={1} color="#dfe9e1" />
      <directionalLight position={[-3, -5, 5]} intensity={0.6} color="#e6e0d2" />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={3} position={[0, 7, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} color="#fff7e8" />
        <Lightformer form="rect" intensity={1.6} position={[-8, 2, 3]} rotation-y={Math.PI / 2} scale={[9, 3, 1]} color="#e6efe7" />
        <Lightformer form="rect" intensity={1} position={[8, 1, 2]} rotation-y={-Math.PI / 2} scale={[7, 2.4, 1]} color="#f1e7d3" />
        <Lightformer form="rect" intensity={0.5} position={[0, 0, -9]} scale={[12, 6, 1]} color="#cfdad0" />
        <Lightformer form="rect" intensity={0.7} position={[0, -7, 0]} rotation-x={-Math.PI / 2} scale={[14, 14, 1]} color="#6f806f" />
      </Environment>
      <Assembly motion={motion} />
    </Canvas>
  );
}
