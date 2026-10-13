import { Quaternion, Vector3 } from "three";

/**
 * Suspended kinetic truss.
 *
 * Outer frame: a rhombicuboctahedron (24 joints, 48 members) squashed into
 * a wide, saucer-like proportion. Four of its eight triangular faces carry
 * thin plates, placed on alternating corners so the form reads as designed
 * rather than closed. A vertical axle runs apex to apex on a suspension
 * cable. Inside, an eight-pointed star cage (two khatam rings joined by
 * verticals and spokes) turns slowly on the axle: the same eightfold
 * geometry as the brand mark, built as structure instead of ornament.
 */

export type MemberKind = "frame" | "tie" | "axle" | "cable" | "cage";

export type Member = {
  a: Vector3;
  b: Vector3;
  radius: number;
  kind: MemberKind;
  /** Assembly order in [0, 1], top of the structure first. */
  order: number;
  length: number;
  mid: Vector3;
  quaternion: Quaternion;
  dir: Vector3;
};

export type Joint = { p: Vector3; radius: number; order: number };
export type Plate = { points: [Vector3, Vector3, Vector3]; order: number; normal: Vector3 };

export type Structure = {
  staticMembers: Member[];
  rotorMembers: Member[];
  staticJoints: Joint[];
  rotorJoints: Joint[];
  plates: Plate[];
  bounds: { top: number; bottom: number; halfWidth: number };
};

const PHI = 1 + Math.SQRT2;
const SX = 1.5;
const SY = 0.72;
const SZ = 1.5;
const UP = new Vector3(0, 1, 0);

const pt = (x: number, y: number, z: number) => new Vector3(x * SX, y * SY, z * SZ);

function finish(members: Member[]) {
  for (const m of members) {
    // Members grow downward from their higher joint.
    if (m.b.y > m.a.y + 1e-6) {
      const t = m.a;
      m.a = m.b;
      m.b = t;
    }
    m.length = m.a.distanceTo(m.b);
    m.mid = m.a.clone().add(m.b).multiplyScalar(0.5);
    m.dir = m.b.clone().sub(m.a).normalize();
    m.quaternion = new Quaternion().setFromUnitVectors(UP, m.dir);
  }
}

function assignOrder(members: Member[], joints: Map<string, Joint>, from: number, to: number) {
  const sorted = [...members].sort((p, q) => {
    const py = Math.max(p.a.y, p.b.y);
    const qy = Math.max(q.a.y, q.b.y);
    if (Math.abs(py - qy) > 1e-3) return qy - py;
    return p.mid.length() - q.mid.length();
  });
  sorted.forEach((m, i) => {
    m.order = from + ((to - from) * i) / Math.max(1, sorted.length - 1);
  });
  // A joint appears when the first member starts from it, or when the
  // first member arrives at it, whichever comes first.
  for (const m of members) {
    const start = joints.get(key(m.a));
    if (start) start.order = Math.min(start.order, m.order);
    const end = joints.get(key(m.b));
    if (end) end.order = Math.min(end.order, m.order + 0.2);
  }
}

const key = (p: Vector3) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;

export function buildStructure(): Structure {
  const staticMembers: Member[] = [];
  const rotorMembers: Member[] = [];
  const staticJoints = new Map<string, Joint>();
  const rotorJoints = new Map<string, Joint>();
  const plates: Plate[] = [];

  const addJoint = (map: Map<string, Joint>, p: Vector3, r: number) => {
    const k = key(p);
    const existing = map.get(k);
    if (existing) {
      existing.radius = Math.max(existing.radius, r);
      return;
    }
    map.set(k, { p: p.clone(), radius: r, order: 1 });
  };

  const member = (
    list: Member[],
    joints: Map<string, Joint>,
    a: Vector3,
    b: Vector3,
    radius: number,
    kind: MemberKind,
    jointScale = 2.1,
  ) => {
    list.push({
      a: a.clone(),
      b: b.clone(),
      radius,
      kind,
      order: 0,
      length: 0,
      mid: new Vector3(),
      quaternion: new Quaternion(),
      dir: new Vector3(),
    });
    if (kind !== "cable") {
      addJoint(joints, a, radius * jointScale);
      addJoint(joints, b, radius * jointScale);
    }
  };

  // Outer frame ------------------------------------------------------------
  const raw: Vector3[] = [];
  for (const big of [0, 1, 2]) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const c = [sx, sy, sz];
          c[big] *= PHI;
          raw.push(new Vector3(c[0], c[1], c[2]));
        }
      }
    }
  }
  const frame = raw.map((p) => pt(p.x, p.y, p.z));
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      if (Math.abs(raw[i].distanceTo(raw[j]) - 2) < 1e-6) {
        member(staticMembers, staticJoints, frame[i], frame[j], 0.034, "frame");
      }
    }
  }

  // Plates on alternating corners (a tetrahedral selection of the 8).
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        if (sx * sy * sz < 0) continue;
        const tri: [Vector3, Vector3, Vector3] = [
          pt(sx * PHI, sy, sz),
          pt(sx, sy * PHI, sz),
          pt(sx, sy, sz * PHI),
        ];
        const normal = new Vector3(sx, sy, sz).normalize();
        plates.push({ points: tri, order: 0, normal });
      }
    }
  }

  // Axle, apexes and suspension ------------------------------------------
  const apexTop = pt(0, PHI + 0.42, 0);
  const apexBottom = pt(0, -PHI - 0.42, 0);
  const hubTop = pt(0, 0.62, 0);
  const hubBottom = pt(0, -0.62, 0);
  member(staticMembers, staticJoints, apexTop, hubTop, 0.03, "axle", 2.6);
  member(staticMembers, staticJoints, hubTop, hubBottom, 0.03, "axle", 2.6);
  member(staticMembers, staticJoints, hubBottom, apexBottom, 0.03, "axle", 2.6);
  frame.forEach((p, i) => {
    if (raw[i].y === PHI) member(staticMembers, staticJoints, apexTop, p, 0.024, "tie");
    if (raw[i].y === -PHI) member(staticMembers, staticJoints, apexBottom, p, 0.024, "tie");
  });
  member(staticMembers, staticJoints, apexTop, pt(0, 60, 0), 0.0075, "cable");

  // Star cage rotor --------------------------------------------------------
  const ro = 1.62;
  const ri = ro * (Math.SQRT1_2 / Math.cos(Math.PI / 8));
  const ring = (y: number) => {
    const pts: Vector3[] = [];
    for (let k = 0; k < 16; k++) {
      const angle = (k * Math.PI) / 8;
      const r = k % 2 === 0 ? ro : ri;
      pts.push(pt(r * Math.cos(angle), y, r * Math.sin(angle)));
    }
    return pts;
  };
  const top = ring(0.62);
  const bottom = ring(-0.62);
  for (let k = 0; k < 16; k++) {
    member(rotorMembers, rotorJoints, top[k], top[(k + 1) % 16], 0.021, "cage");
    member(rotorMembers, rotorJoints, bottom[k], bottom[(k + 1) % 16], 0.021, "cage");
    member(rotorMembers, rotorJoints, top[k], bottom[k], k % 2 === 0 ? 0.019 : 0.014, "cage");
  }
  for (let k = 1; k < 16; k += 2) {
    member(rotorMembers, rotorJoints, hubTop, top[k], 0.013, "cage", 1.6);
    member(rotorMembers, rotorJoints, hubBottom, bottom[k], 0.013, "cage", 1.6);
  }
  // Diagonal bracing between rings, one per bay, alternating direction.
  for (let k = 0; k < 16; k += 2) {
    member(rotorMembers, rotorJoints, top[k], bottom[(k + 1) % 16], 0.011, "cage", 1.4);
  }

  finish(staticMembers);
  finish(rotorMembers);
  assignOrder(staticMembers, staticJoints, 0, 0.72);
  assignOrder(rotorMembers, rotorJoints, 0.42, 0.9);
  plates.forEach((p, i) => {
    p.order = 0.58 + i * 0.07;
  });

  return {
    staticMembers,
    rotorMembers,
    staticJoints: [...staticJoints.values()],
    rotorJoints: [...rotorJoints.values()],
    plates,
    bounds: { top: apexTop.y, bottom: apexBottom.y, halfWidth: PHI * SX },
  };
}
