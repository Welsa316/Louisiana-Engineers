/** Shared, mutable motion state between the hero DOM and the 3D scene. */
export type HeroMotion = {
  /** Assembly progress, 0 to 1. */
  progress: number;
  /** Camera distance multiplier, eases from 1.28 to 1 during the push-in. */
  camera: number;
  /** Normalised pointer position over the hero, -1 to 1. */
  pointerX: number;
  pointerY: number;
  reduced: boolean;
  mountedAt: number;
};

export function createHeroMotion(reduced: boolean): HeroMotion {
  return {
    progress: reduced ? 1 : 0,
    camera: reduced ? 1 : 1.28,
    pointerX: 0,
    pointerY: 0,
    reduced,
    mountedAt: performance.now(),
  };
}
