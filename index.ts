import { Backtrack } from "./lazy";

const parents = [
  ["Sarah", "John"],
  ["Arnold", "John"],
  ["John", "Anne"],
];

const grandparent = (grandchild: string) =>
  Backtrack.gen(function* () {
    const [p, c] = yield* Backtrack.fromArray(parents);
    const [c_, g] = yield* Backtrack.fromArray(parents);
    yield* Backtrack.guard(c === c_);
    yield* Backtrack.guard(g === grandchild);
    return p;
  });

if (import.meta.main) {
  console.log(grandparent("Anne").toArray());
}
