import { Backtrack } from "../src/lazy";
import type { Logic } from "../src/search";

const parents = [
  ["Sarah", "John"],
  ["Arnold", "John"],
  ["John", "Anne"],
] as const;

export const grandparent = (grandchild: string, logic: Logic = Backtrack) =>
  logic.gen(function* () {
    const [p, c] = yield* logic.fromArray(parents);
    const [c_, g] = yield* logic.fromArray(parents);
    yield* logic.guard(c === c_);
    yield* logic.guard(g === grandchild);
    return p;
  });
