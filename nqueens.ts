import { Backtrack } from "./lazy";

export const queens = (n: number) => {
  const cols = Array.from({ length: n }, (_, i) => i + 1);

  const place = (placed: readonly number[]): Backtrack<readonly number[]> =>
    Backtrack.gen(function* () {
      if (placed.length === n) return placed;

      const col = yield* Backtrack.fromArray(cols);
      yield* Backtrack.guard(
        placed.every((prev, i) => col !== prev && Math.abs(col - prev) !== i + 1),
      );
      return yield* place([col, ...placed]);
    });

  return place([]);
};
