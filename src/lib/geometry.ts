/**
 * Eight-pointed star (khatam) geometry used for the brand mark and the
 * tiling pattern. Points alternate between the outer radius and the inner
 * concave radius every 22.5 degrees, producing the classic star outline
 * whose negative space forms crosses when tiled on a square grid.
 */
export function starPoints(
  cx: number,
  cy: number,
  outer: number,
  inner = outer * (Math.SQRT1_2 / Math.cos(Math.PI / 8)),
): string {
  const pts: string[] = [];
  for (let k = 0; k < 16; k++) {
    const angle = (k * Math.PI) / 8;
    const radius = k % 2 === 0 ? outer : inner;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(" ");
}

export function octagonPoints(cx: number, cy: number, radius: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4 + Math.PI / 8;
    pts.push(
      `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return pts.join(" ");
}
