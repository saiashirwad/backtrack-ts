import { Backtrack } from "./lazy";
import type { Logic, Search } from "./search";

export const queens = (n: number, logic: Logic = Backtrack) => {
  const cols = Array.from({ length: n }, (_, i) => i + 1);

  const place = (placed: readonly number[]): Search<readonly number[]> =>
    logic.gen(function* () {
      if (placed.length === n) return placed;

      const col = yield* logic.fromArray(cols);
      yield* logic.guard(
        placed.every((prev, i) => col !== prev && Math.abs(col - prev) !== i + 1),
      );
      return yield* place([col, ...placed]);
    });

  return place([]);
};
