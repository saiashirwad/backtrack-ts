# backtrack-ts

Backtracking search with generators, plus a Prolog-style logic layer with unification.

## Backtracking

`Backtrack` is a lazy search monad: `fromArray` is a choice point and `guard` prunes a branch.

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

## Unification

`unify.ts` adds logic variables and unification, so a relation is written once and queried in any direction. `query` returns a lazy `Backtrack` of answers, with unbound variables shown as `_n`.

| Function | Prolog |
|---|---|
| `fresh()` inside `Goal.gen`, or `fresh((x, y) => goal)` | variables local to a clause |
| `eq(a, b)` | `A = B` |
| `Goal.gen(function* {...})` or `conj(g1, g2, ...)` | `,` |
| `oneOf(g1, g2, ...)` | multiple clauses, `;` |
| `facts(rows)` | a block of facts |
| `value(t)` | reading a binding, as in `is` |
| `table(relation)` | `:- table` |
| `fail` | `fail` |
| `query((q, ...) => goal)` | `?- goal.` |

Terms are strings, numbers, booleans, `null`, variables, fixed-length tuples (arrays), and lists built with `list(...)` or `new Cons(head, tail)`. Search is fair: branches interleave, so an infinite branch never hides answers from the others, and deep recursion doesn't grow the JS stack. Unification includes the occurs check.

### Facts and rules

```ts
import { Goal, facts, fresh, query, type Term } from "./unify";

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
console.log(query((g, x) => grandparent(g, x)).toArray()); // [["Sarah", "Anne"], ["Arnold", "Anne"]]
```

### Lists

Relations written with `conj` and the callback form of `fresh` skip generators entirely, which avoids replay cost when a relation has many answers.

```ts
import { Cons, conj, eq, fresh, list, oneOf, query, type Goal, type Term } from "./unify";

// append([], Ys, Ys).  append([H|T], Ys, [H|R]) :- append(T, Ys, R).
const append = (xs: Term, ys: Term, zs: Term): Goal<void> =>
  oneOf(
    conj(eq(xs, []), eq(ys, zs)),
    fresh((h, t, r) => conj(eq(xs, new Cons(h, t)), eq(zs, new Cons(h, r)), append(t, ys, r))),
  );

// member(X, [X|_]).  member(X, [_|T]) :- member(X, T).
const member = (x: Term, xs: Term): Goal<void> =>
  fresh((h, t) => conj(eq(xs, new Cons(h, t)), oneOf(eq(x, h), member(x, t))));

console.log(query((q) => append(list(1, 2), list(3), q)).toArray()); // [[1, 2, 3]]
console.log(query((q) => append(q, list(3), list(1, 2, 3))).toArray()); // [[1, 2]]
console.log(query((x, y) => append(x, y, list(1, 2))).toArray()); // [[[], [1, 2]], [[1], [2]], [[1, 2], []]]
console.log(query((q) => member(q, list("a", "b"))).toArray()); // ["a", "b"]
```

### Running arithmetic backwards

A pure relation has no inputs or outputs: the same `plus` adds, subtracts, and enumerates splits.

```ts
import { conj, eq, fresh, oneOf, query, type Goal, type Term } from "./unify";

const peano = (n: number): Term => (n === 0 ? 0 : ["s", peano(n - 1)]);
const fromPeano = (t: unknown): number => (Array.isArray(t) ? 1 + fromPeano(t[1]) : 0);

// plus(0, N, N).  plus(s(M), N, s(K)) :- plus(M, N, K).
const plus = (m: Term, n: Term, k: Term): Goal<void> =>
  oneOf(
    conj(eq(m, 0), eq(n, k)),
    fresh((m1, k1) => conj(eq(m, ["s", m1]), eq(k, ["s", k1]), plus(m1, n, k1))),
  );

console.log(query((k) => plus(peano(2), peano(3), k)).toArray().map(fromPeano)); // [5]
console.log(query((k) => plus(peano(2), k, peano(5))).toArray().map(fromPeano)); // [3]
console.log(query((a, b) => plus(a, b, peano(2))).toArray().map(([a, b]) => [fromPeano(a), fromPeano(b)])); // [[0, 2], [1, 1], [2, 0]]
```

### Computing with bindings

Inside `Goal.gen`, each `yield*` hands a value back to JavaScript. `value(t)` reads a variable's current binding, so later steps can use ordinary arithmetic and control flow. Like Prolog's `is`, the variable must already be bound when `value` runs.

```ts
import { Cons, Goal, conj, eq, fail, fresh, oneOf, query, value, list, type Term } from "./unify";

// length([], 0).  length([_|T], N) :- length(T, M), N is M + 1.
const length = (xs: Term, n: Term): Goal<void> =>
  oneOf(
    conj(eq(xs, []), eq(n, 0)),
    Goal.gen(function* () {
      const t = yield* fresh();
      const m = yield* fresh();
      yield* eq(xs, new Cons(yield* fresh(), t));
      yield* length(t, m);
      const count = (yield* value(m)) as number;
      yield* eq(n, count + 1);
    }),
  );

const between = (lo: number, hi: number, x: Term): Goal<void> =>
  oneOf(...Array.from({ length: Math.max(hi - lo + 1, 0) }, (_, i) => eq(x, lo + i)));

const pythagorean = (max: number, a: Term, b: Term, c: Term): Goal<void> =>
  Goal.gen(function* () {
    yield* between(1, max, a);
    const av = (yield* value(a)) as number;
    yield* between(av, max, b);
    const bv = (yield* value(b)) as number;
    const cv = Math.hypot(av, bv);
    yield* Number.isInteger(cv) && cv <= max ? eq(c, cv) : fail;
  });

console.log(query((n) => length(list("a", "b", "c"), n)).toArray()); // [3]
console.log(query((a, b, c) => pythagorean(15, a, b, c)).toArray()); // [[3, 4, 5], [5, 12, 13], [6, 8, 10], [9, 12, 15]]
```

### Tabling

Left recursion loops forever in plain Prolog. `table` remembers each call's answers by argument pattern, so recursive calls reuse them and the search stops once nothing new turns up, even over a cyclic graph.

```ts
import { conj, facts, fresh, oneOf, query, table, type Goal, type Term } from "./unify";

const edge = facts([
  ["a", "b"],
  ["b", "a"],
  ["b", "c"],
]);

// path(X, Z) :- path(X, Y), edge(Y, Z).  path(X, Y) :- edge(X, Y).
const path: (x: Term, z: Term) => Goal<void> = table((x: Term, z: Term) =>
  oneOf(
    fresh((y) => conj(path(x, y), edge(y, z))),
    edge(x, z),
  ),
);

console.log(query((z) => path("a", z)).toArray()); // ["b", "a", "c"]
```

### Puzzles

Map coloring: give each mainland Australian state a color so that no two neighbors share one.

```ts
import { conj, facts, query, type Goal, type Term } from "./unify";

const colors = ["red", "green", "blue"];
const different = facts(colors.flatMap((x) => colors.filter((y) => y !== x).map((y) => [x, y])));

const australia = (wa: Term, nt: Term, sa: Term, q: Term, nsw: Term, v: Term): Goal<void> =>
  conj(
    different(wa, nt), different(wa, sa), different(nt, sa), different(nt, q), different(sa, q),
    different(sa, nsw), different(sa, v), different(q, nsw), different(nsw, v),
  );

const solutions = query((wa, nt, sa, q, nsw, v) => australia(wa, nt, sa, q, nsw, v));
console.log(solutions.iterate().next().value); // e.g. ["red", "green", "blue", "red", "green", "red"]
console.log(solutions.toArray().length); // 6
```

The examples above also live in `relations.ts`, are exercised by `unify.test.ts`, and print from `bun run index.ts`.

## Development

```sh
bun test           # property tests
bun run index.ts   # print the examples
bun run bench      # benchmarks
bun run mutate     # mutation testing
```
