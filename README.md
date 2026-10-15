# prolog-ts

An implementation of Prolog in TypeScript. You write facts and rules as TypeScript functions, then query them with any mix of known and unknown arguments.

- **Implemented:** unification (with the occurs check), facts, rules, conjunction and disjunction, cut, negation as failure, `once`, if-then-else, lists, arithmetic on bound values (like `is`), and tabling (`:- table`). Answers come back in standard Prolog order.
- **Not implemented:** Prolog source syntax, `assert`/`retract`, exceptions, and constraints such as `dif`.

```ts
import { Goal, eq, facts, fresh, query, value, type Arg } from "prolog-ts";

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

const birthYear = (person: Arg<string>) =>
  Goal.gen(function* () {
    const year = yield* fresh<number>();
    yield* born(person, year);
    return yield* value(year);
  });

// G is X's grandparent, born Gap years earlier.
const grandparent = (g: Arg<string>, x: Arg<string>, gap: Arg<number>) =>
  Goal.gen(function* () {
    const p = yield* fresh<string>();
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

The backtracking search it runs on is also exported:

```ts
import { Backtrack } from "prolog-ts";

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
