/**
 * Allocation-free steering primitives. Headings are radians; "left" is the
 * negative-angle side. All functions are pure so they inline well in the hot loop.
 */

/**
 * Nearest-cell read of a pheromone layer at world point (x, y). Points outside the
 * world return -1, so sensors poking past an edge look worse than empty ground and
 * trail-following ants turn away from walls.
 */
export function senseCell(
  layer: Float32Array,
  res: number,
  invCell: number,
  x: number,
  y: number,
): number {
  const cx = Math.floor(x * invCell);
  const cy = Math.floor(y * invCell);
  if (cx < 0 || cy < 0 || cx >= res || cy >= res) return -1;
  return layer[cy * res + cx]!;
}

/**
 * Classic three-sensor rule: keep going if the centre sensor is strongest, otherwise turn
 * `turnRate` towards the stronger side. Returns the heading delta (0 when no sensor reaches
 * `threshold`, i.e. there is no trail to follow).
 */
export function steerTowardsScent(
  left: number,
  centre: number,
  right: number,
  threshold: number,
  turnRate: number,
): number {
  if (left < threshold && centre < threshold && right < threshold) return 0;
  if (centre >= left && centre >= right) return 0;
  return left > right ? -turnRate : turnRate;
}

/** Turns `heading` towards `target` by at most `maxTurn`. Result is in (-PI, PI]. */
export function turnTowards(heading: number, target: number, maxTurn: number): number {
  let err = wrapAngle(target - heading);
  if (err > maxTurn) err = maxTurn;
  else if (err < -maxTurn) err = -maxTurn;
  return wrapAngle(heading + err);
}

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  if (a > Math.PI) {
    a -= TWO_PI;
    if (a > Math.PI) a -= TWO_PI * Math.ceil((a - Math.PI) / TWO_PI);
  } else if (a <= -Math.PI) {
    a += TWO_PI;
    if (a <= -Math.PI) a += TWO_PI * Math.ceil((-Math.PI - a) / TWO_PI);
  }
  return a;
}

const TWO_PI = Math.PI * 2;
