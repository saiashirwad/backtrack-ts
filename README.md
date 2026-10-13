```ts
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

console.log(grandparent("Anne").toArray()); // ["Sarah", "Arnold"]
```

```ts
import { Backtrack } from "./lazy";

const queens = (n: number) => {
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

const solutions = queens(8);
const results = solutions.iterate();
console.log(results.next().value); // First solution
results.return(undefined);
console.log(solutions.toArray().length); // 92
```
