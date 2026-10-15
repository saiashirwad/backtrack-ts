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

```ts
import { Goal, facts, fresh, oneOf, query, table, type Term } from "./unify";

const parent = facts([
  ["Sarah", "John"],
  ["Arnold", "John"],
  ["John", "Anne"],
]);

const grandparent = (g: Term, x: Term) =>
  Goal.gen(function* () {
    const p = yield* fresh();
    yield* parent(g, p);
    yield* parent(p, x);
  });

console.log(query((q) => grandparent(q, "Anne")).toArray()); // ["Sarah", "Arnold"]
console.log(query((q) => grandparent("Sarah", q)).toArray()); // ["Anne"]

// Tabling lets left recursion over a cyclic graph terminate.
const edge = facts([["a", "b"], ["b", "a"], ["b", "c"]]);
const path: (x: Term, z: Term) => Goal<void> = table((x, z) =>
  oneOf(
    Goal.gen(function* () {
      const y = yield* fresh();
      yield* path(x, y);
      yield* edge(y, z);
    }),
    edge(x, z),
  ),
);

console.log(query((z) => path("a", z)).toArray()); // ["b", "a", "c"]
```
