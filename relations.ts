import { Cons, Goal, conj, eq, facts, fresh, oneOf, table, value, type Term } from "./unify";

export const parent = facts([
  ["Sarah", "John"],
  ["Arnold", "John"],
  ["John", "Anne"],
]);

export const grandparent = (g: Term, x: Term) =>
  Goal.gen(function* () {
    const p = yield* fresh();
    yield* parent(g, p);
    yield* parent(p, x);
  });

export const append = (xs: Term, ys: Term, zs: Term): Goal<void> =>
  oneOf(
    Goal.gen(function* () {
      yield* eq(xs, []);
      yield* eq(ys, zs);
    }),
    Goal.gen(function* () {
      const h = yield* fresh();
      const t = yield* fresh();
      const r = yield* fresh();
      yield* eq(xs, new Cons(h, t));
      yield* eq(zs, new Cons(h, r));
      yield* append(t, ys, r);
    }),
  );

// The same relation without a generator: conj sequences goals and fresh's callback
// form introduces variables, so no step is ever replayed.
export const appendWithoutGen = (xs: Term, ys: Term, zs: Term): Goal<void> =>
  oneOf(
    conj(eq(xs, []), eq(ys, zs)),
    fresh((h, t, r) => conj(eq(xs, new Cons(h, t)), eq(zs, new Cons(h, r)), appendWithoutGen(t, ys, r))),
  );

// length([], 0).  length([_|T], N) :- length(T, M), N is M + 1.
// `value` reads M's binding into JavaScript to compute N, so like Prolog's `is`
// this needs M bound by the time it runs (true here: the recursive call binds it).
export const length = (xs: Term, n: Term): Goal<void> =>
  oneOf(
    conj(eq(xs, []), eq(n, 0)),
    Goal.gen(function* () {
      const t = yield* fresh();
      const m = yield* fresh();
      yield* eq(xs, new Cons(yield* fresh(), t));
      yield* length(t, m);
      const count = yield* value(m);
      yield* eq(n, (count as number) + 1);
    }),
  );

// nat(s(Y)) :- nat(Y).  nat(0).  Left-recursive, with infinitely many answers.
export const nat = (x: Term): Goal<void> =>
  oneOf(
    Goal.gen(function* () {
      const y = yield* fresh();
      yield* nat(y);
      yield* eq(x, ["s", y]);
    }),
    eq(x, 0),
  );

export const edge = facts([
  ["a", "b"],
  ["b", "a"],
  ["b", "c"],
]);

// path(X, Z) :- path(X, Y), edge(Y, Z).  path(X, Y) :- edge(X, Y).
// Left-recursive over a cyclic graph: only terminates because it is tabled.
export const path: (x: Term, z: Term) => Goal<void> = table((x: Term, z: Term) =>
  oneOf(
    Goal.gen(function* () {
      const y = yield* fresh();
      yield* path(x, y);
      yield* edge(y, z);
    }),
    edge(x, z),
  ),
);
