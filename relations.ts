import { Cons, Goal, eq, facts, fresh, oneOf, table, type Term } from "./unify";

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
