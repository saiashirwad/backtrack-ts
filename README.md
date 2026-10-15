# backtrack-ts

Prolog-style logic programming in TypeScript, written with generators. Relations run in any direction, and each `yield*` hands its result back to JavaScript: `fresh()` gives a variable to reuse in later goals, and `value()` reads a binding so ordinary code can compute with it.

```ts
import { Goal, eq, facts, fresh, query, value, type Term } from "backtrack-ts";

const parent = facts([
  ["Sarah", "John"],
  ["Arnold", "John"],
  ["John", "Anne"],
  ["Anne", "Mia"],
]);

const born = facts([
  ["Sarah", 1940],
  ["Arnold", 1938],
  ["John", 1965],
  ["Anne", 1990],
  ["Mia", 2020],
]);

const birthYear = (person: Term) =>
  Goal.gen(function* () {
    const year = yield* fresh();
    yield* born(person, year);
    return (yield* value(year)) as number;
  });

// G is X's grandparent, born Gap years earlier.
const grandparent = (g: Term, x: Term, gap: Term) =>
  Goal.gen(function* () {
    const p = yield* fresh();
    yield* parent(g, p);
    yield* parent(p, x);
    const years = (yield* birthYear(x)) - (yield* birthYear(g));
    yield* eq(gap, years);
  });

query((g, x, gap) => grandparent(g, x, gap)).toArray();
// [["Sarah", "Anne", 50], ["Arnold", "Anne", 52], ["John", "Mia", 55]]

query((g) => grandparent(g, "Anne", 52)).toArray();
// ["Arnold"]
```

Underneath is `Backtrack`, a lazy backtracking search you can use directly:

```ts
import { Backtrack } from "backtrack-ts";

const queens = (n: number, placed: readonly number[] = []): Backtrack<readonly number[]> =>
  Backtrack.gen(function* () {
    if (placed.length === n) return placed;
    const col = yield* Backtrack.fromArray([...Array(n).keys()]);
    yield* Backtrack.guard(placed.every((prev, i) => col !== prev && Math.abs(col - prev) !== i + 1));
    return yield* queens(n, [col, ...placed]);
  });

queens(8).iterate().next().value; // [3, 1, 6, 2, 5, 7, 4, 0]
queens(8).toArray().length; // 92
```
