// Keep only the result of the most recently started async task.
//
// When a new course is picked while the previous one is still loading (fetching the file,
// sampling terrain, loading the model), the older task may finish later. Each task gets a
// generation id; results of superseded generations are discarded instead of overwriting
// the newer state.

export class LatestOnly {
  private generation = 0;

  /** Start a new generation; earlier ones become stale. */
  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  /**
   * Run `task` and pass its result to `apply` only if no newer task started meanwhile.
   * Returns true when the result was applied.
   */
  async run<T>(task: (generation: number) => Promise<T>, apply: (result: T) => void): Promise<boolean> {
    const generation = this.begin();
    const result = await task(generation);
    if (!this.isCurrent(generation)) return false;
    apply(result);
    return true;
  }
}
