import { Cons, Goal, conj, eq, facts, fail, fresh, oneOf, table, value, type Term } from "../src/unify";

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

// member(X, [X|_]).  member(X, [_|T]) :- member(X, T).
export const member = (x: Term, xs: Term): Goal<void> =>
  fresh((h, t) => conj(eq(xs, new Cons(h, t)), oneOf(eq(x, h), member(x, t))));

// ancestor(A, D) :- ancestor(A, P), parent(P, D).  ancestor(A, D) :- parent(A, D).
export const ancestor: (a: Term, d: Term) => Goal<void> = table((a: Term, d: Term) =>
  oneOf(
    fresh((p) => conj(ancestor(a, p), parent(p, d))),
    parent(a, d),
  ),
);

// Peano numbers: 0, ["s", 0], ["s", ["s", 0]], ...
export const peano = (n: number): Term => {
  let t: Term = 0;
  for (let i = 0; i < n; i++) t = ["s", t];
  return t;
};

export const fromPeano = (t: unknown): number => {
  let n = 0;
  for (; Array.isArray(t); n++) t = t[1];
  return n;
};

// plus(0, N, N).  plus(s(M), N, s(K)) :- plus(M, N, K).
// Pure relation, so it also subtracts and splits: plus(A, B, 3) finds every pair.
export const plus = (m: Term, n: Term, k: Term): Goal<void> =>
  oneOf(
    conj(eq(m, 0), eq(n, k)),
    fresh((m1, k1) => conj(eq(m, ["s", m1]), eq(k, ["s", k1]), plus(m1, n, k1))),
  );

// between(L, H, X): X is an integer with L =< X =< H.
export const between = (lo: number, hi: number, x: Term): Goal<void> =>
  oneOf(...Array.from({ length: Math.max(hi - lo + 1, 0) }, (_, i) => eq(x, lo + i)));

// Pythagorean triples a =< b with c =< max. `value` brings the bindings into
// JavaScript so ordinary arithmetic and control flow can drive the search.
export const pythagorean = (max: number, a: Term, b: Term, c: Term): Goal<void> =>
  Goal.gen(function* () {
    yield* between(1, max, a);
    const av = (yield* value(a)) as number;
    yield* between(av, max, b);
    const bv = (yield* value(b)) as number;
    const cv = Math.hypot(av, bv);
    yield* Number.isInteger(cv) && cv <= max ? eq(c, cv) : fail;
  });

// Color the mainland Australian states so that neighbours differ.
export const colors = ["red", "green", "blue"];
const different = facts(colors.flatMap((x) => colors.filter((y) => y !== x).map((y) => [x, y])));

export const australia = (wa: Term, nt: Term, sa: Term, q: Term, nsw: Term, v: Term): Goal<void> =>
  conj(
    different(wa, nt),
    different(wa, sa),
    different(nt, sa),
    different(nt, q),
    different(sa, q),
    different(sa, nsw),
    different(sa, v),
    different(q, nsw),
    different(nsw, v),
  );
