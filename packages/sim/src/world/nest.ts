/** The colony's surface nest entrance plus its food store. */
export class Nest {
  /** Colony food store; the economy counter. */
  store = 0;

  constructor(
    readonly x: number,
    readonly y: number,
    /** Entrance radius in world units. */
    readonly radius: number,
  ) {}

  isAtNest(x: number, y: number): boolean {
    const dx = x - this.x;
    const dy = y - this.y;
    return dx * dx + dy * dy <= this.radius * this.radius;
  }

  /** Add food to the colony store. Non-positive amounts are ignored. */
  depositFood(amount: number): void {
    if (amount > 0) this.store += amount;
  }
}
