import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  Goal, Var, clauses, conj, cut, eq, fail, facts, fresh, ifThenElse, list, not, once, oneOf, query, succeed, table, value,
  type Term,
} from "../src/index.ts";
import {
  ancestor, append, appendWithoutGen, australia, fromPeano, grandparent, length, member, nat, path, peano, plus, pythagorean,
} from "../examples/relations.ts";

const options = {
  numRuns: 200,
  seed: process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined,
};

const take = <A>(answers: { iterate(): Generator<A> }, n: number): A[] => {
  const out: A[] = [];
  const it = answers.iterate();
  while (out.length < n) {
    const r = it.next();
    if (r.done) break;
    out.push(r.value);
  }
  it.return(undefined);
  return out;
};

const sorted = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).sort();

test("relations answer queries in every direction", () => {
  expect(sorted(query((q) => grandparent(q, "Anne")).toArray())).toEqual(sorted(["Sarah", "Arnold"]));
  expect(query((q) => grandparent("Sarah", q)).toArray()).toEqual(["Anne"]);
  expect(query((q) => grandparent("Anne", q)).toArray()).toEqual([]);
  expect(query((x, y) => eq(["point", x, 0], ["point", 5, y])).toArray()).toEqual([[5, 0]]);
  expect(query((q) => append(list(1, 2), list(3), q)).toArray()).toEqual([[1, 2, 3]]);
  expect(query((q) => append(q, list(3), list(1, 2, 3))).toArray()).toEqual([[1, 2]]);
});

test("append run backwards finds exactly the splits of any list", () => {
  fc.assert(fc.property(fc.array(fc.integer(), { maxLength: 6 }), (xs) => {
    const splits = xs.map((_, i) => [xs.slice(0, i), xs.slice(i)]).concat([[xs, []]]);
    expect(sorted(query((a, b) => append(a, b, list(...xs))).toArray())).toEqual(sorted(splits));
  }), options);
});

test("unification is symmetric and leaves both sides equal", () => {
  const term = fc.letrec((tie) => ({
    term: fc.oneof(
      { depthSize: "small" },
      fc.constantFrom("a", "b", 0, 1),
      fc.constantFrom("X", "Y", "Z"),
      fc.array(tie("term"), { maxLength: 3 }),
    ),
  })).term;
  fc.assert(fc.property(term, term, (left, right) => {
    const run = (swap: boolean) =>
      query((x, y, z, a, b) => {
        const vars: Record<string, unknown> = { X: x, Y: y, Z: z };
        const build = (t: unknown): any => (typeof t === "string" && t in vars ? vars[t] : Array.isArray(t) ? t.map(build) : t);
        return Goal.gen(function* () {
          yield* eq(a, build(left));
          yield* eq(b, build(right));
          yield* swap ? eq(b, a) : eq(a, b);
        });
      }).toArray();
    const forward = run(false);
    expect(run(true).length).toBe(forward.length);
    for (const [, , , a, b] of forward) expect(a).toEqual(b);
  }), options);
});

test("the occurs check rejects cyclic terms", () => {
  expect(query((x) => eq(x, [x])).toArray()).toEqual([]);
  expect(query((x, y) => Goal.gen(function* () {
    yield* eq(x, ["f", y]);
    yield* eq(y, [x]);
  })).toArray()).toEqual([]);
});

test("infinite relations produce answers lazily, in order", () => {
  expect(take(query((q) => nat(q)), 3)).toEqual([0, ["s", 0], ["s", ["s", 0]]]);
});

test("tabling makes left recursion over a cyclic graph terminate", () => {
  expect(sorted(query((z) => path("a", z)).toArray())).toEqual(sorted(["a", "b", "c"]));
  expect(sorted(query((x) => path(x, "c")).toArray())).toEqual(sorted(["a", "b"]));
  expect(query((x, z) => path(x, z)).toArray().length).toBe(6);
});

test("deep recursion and long bodies run on a flat stack", () => {
  const n = 50_000;
  const xs = Array.from({ length: n }, (_, i) => i);
  expect(query((q) => append(list(...xs), list("end"), q)).toArray()[0]).toHaveLength(n + 1);

  const chain = (q: unknown) => Goal.gen(function* () {
    let prev: any = q;
    for (let i = 0; i < n; i++) {
      const v = yield* fresh();
      yield* eq(prev, ["s", v]);
      prev = v;
    }
    yield* eq(prev, 0);
  });
  let [term, depth] = [query(chain).toArray()[0], 0];
  for (; Array.isArray(term); depth++) term = term[1];
  expect([term, depth]).toEqual([0, n]);
});

test("gen bodies use earlier results to build later terms and return values", () => {
  const vars = (n: number): Goal<Var[]> =>
    Goal.gen(function* () {
      const out: Var[] = [];
      for (let i = 0; i < n; i++) out.push(yield* fresh());
      return out;
    });
  const answers = query((q) =>
    Goal.gen(function* () {
      const [a, b, c] = yield* vars(3);
      yield* eq(q, [a!, b!, c!]);
      yield* eq(a!, 1);
      const x = (yield* value(a!)) as number;
      yield* eq(b!, [x, x]);
    }),
  ).toArray();
  expect(answers).toEqual([[1, [1, 1], "_3"]]);
});

test("value reads bindings into JavaScript, so length can compute with them", () => {
  fc.assert(fc.property(fc.array(fc.integer(), { maxLength: 8 }), (xs) => {
    expect(query((n) => length(list(...xs), n)).toArray()).toEqual([xs.length]);
  }), options);
  // Generate mode: lists of length 2 are found (the search for more never ends).
  const [generated] = take(query((xs) => length(xs, 2)), 1);
  expect(generated).toHaveLength(2);
  expect(query((t) => value(["f", t])).toArray()).toEqual(["_0"]);
});

test("conj and fresh's callback form match the generator version", () => {
  fc.assert(fc.property(fc.array(fc.integer(), { maxLength: 6 }), (xs) => {
    const viaGen = query((a, b) => append(a, b, list(...xs))).toArray();
    const viaConj = query((a, b) => appendWithoutGen(a, b, list(...xs))).toArray();
    expect(viaConj).toEqual(viaGen);
  }), options);
  expect(query((q) => conj(eq(q, 1), eq(q, 2))).toArray()).toEqual([]);
  const xs = Array.from({ length: 50_000 }, (_, i) => i);
  expect(query((q) => appendWithoutGen(list(...xs), list("end"), q)).toArray()[0]).toHaveLength(50_001);
});

test("member checks and enumerates list elements", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 6 }), fc.integer({ min: 0, max: 5 }), (xs, x) => {
    expect(query((q) => member(q, list(...xs))).toArray()).toEqual(xs);
    expect(query(() => member(x, list(...xs))).toArray().length).toBe(xs.filter((y) => y === x).length);
  }), options);
});

test("tabled ancestor finds every ancestor in either direction", () => {
  expect(sorted(query((a) => ancestor(a, "Anne")).toArray())).toEqual(sorted(["John", "Sarah", "Arnold"]));
  expect(sorted(query((d) => ancestor("Sarah", d)).toArray())).toEqual(sorted(["John", "Anne"]));
});

test("peano plus adds, subtracts, and splits", () => {
  fc.assert(fc.property(fc.nat(8), fc.nat(8), (m, n) => {
    expect(query((k) => plus(peano(m), peano(n), k)).toArray().map(fromPeano)).toEqual([m + n]);
    expect(query((k) => plus(peano(m), k, peano(m + n))).toArray().map(fromPeano)).toEqual([n]);
    const splits = query((a, b) => plus(a, b, peano(m))).toArray().map(([a, b]) => [fromPeano(a), fromPeano(b)]);
    expect(sorted(splits)).toEqual(sorted(Array.from({ length: m + 1 }, (_, i) => [i, m - i])));
  }), options);
});

test("pythagorean triples are computed with value", () => {
  const triples = query((a, b, c) => pythagorean(20, a, b, c)).toArray();
  expect(sorted(triples)).toEqual(sorted([[3, 4, 5], [5, 12, 13], [6, 8, 10], [8, 15, 17], [9, 12, 15], [12, 16, 20]]));
});

test("map coloring finds exactly the valid colorings", () => {
  const solutions = query((wa, nt, sa, q, nsw, v) => australia(wa, nt, sa, q, nsw, v)).toArray();
  const borders = [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [2, 4], [2, 5], [3, 4], [4, 5]];
  expect(solutions).toHaveLength(6);
  for (const s of solutions) expect(borders.every(([x, y]) => s[x!] !== s[y!])).toBe(true);
});

test("answers come back in Prolog's depth-first order", () => {
  expect(query((q) => grandparent(q, "Anne")).toArray()).toEqual(["Sarah", "Arnold"]);
  expect(query((a, b) => append(a, b, list(1, 2, 3))).toArray()).toEqual([
    [[], [1, 2, 3]], [[1], [2, 3]], [[1, 2], [3]], [[1, 2, 3], []],
  ]);
});

const num = (t: Term) => Goal.gen(function* () {
  return (yield* value(t)) as number;
});

// max(X, Y, X) :- X >= Y, !.  max(_, Y, Y).
const max = (x: Term, y: Term, z: Term) =>
  clauses(
    Goal.gen(function* () {
      yield* ((yield* num(x)) >= (yield* num(y)) ? succeed : fail);
      yield* cut;
      yield* eq(z, x);
    }),
    eq(z, y),
  );

test("cut commits to a clause and prunes the clauses after it", () => {
  fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) => {
    expect(query((z) => max(a, b, z)).toArray()).toEqual([Math.max(a, b)]);
  }), options);
  // Without the cut, the second clause would also answer.
  const noCut = (x: Term, y: Term, z: Term) =>
    clauses(Goal.gen(function* () {
      yield* ((yield* num(x)) >= (yield* num(y)) ? succeed : fail);
      yield* eq(z, x);
    }), eq(z, y));
  expect(query((z) => noCut(3, 1, z)).toArray()).toEqual([3, 1]);
});

test("cut prunes the choices to its left in the clause", () => {
  const xs = list(1, 2, 3);
  // p(X) :- member(X, [1,2,3]), !.  p(9).
  expect(query((x) => clauses(Goal.gen(function* () {
    yield* member(x, xs);
    yield* cut;
  }), eq(x, 9))).toArray()).toEqual([1]);
  // The same written with conj.
  expect(query((x) => clauses(conj(member(x, xs), cut), eq(x, 9))).toArray()).toEqual([1]);
  // Choices made after the cut are kept.
  expect(query((x, y) => clauses(conj(member(x, xs), cut, member(y, list("a", "b"))), eq(x, 9))).toArray())
    .toEqual([[1, "a"], [1, "b"]]);
});

test("cut is scoped like Prolog's", () => {
  // Inside ; it cuts the whole clause: p(X) :- (X = 1, ! ; X = 2).  p(3).
  expect(query((x) => clauses(oneOf(conj(eq(x, 1), cut), eq(x, 2)), eq(x, 3))).toArray()).toEqual([1]);
  // A gen that isn't a clause keeps its cut to itself.
  const firstOf = (x: Term, xs: Term) => Goal.gen(function* () {
    yield* member(x, xs);
    yield* cut;
  });
  expect(query((x) => oneOf(firstOf(x, list(1, 2)), eq(x, 3))).toArray()).toEqual([1, 3]);
  // ...even when called from inside a clause.
  expect(query((x, y) => clauses(Goal.gen(function* () {
    yield* firstOf(y, list(1, 2));
    yield* eq(x, "a");
  }), eq(x, "b"))).toArray()).toEqual([["a", 1], ["b", "_1"]]);
  // A cut in an if-then-else condition is local to the condition.
  expect(query((x) => clauses(ifThenElse(conj(member(x, list(1, 2)), cut), succeed, fail), eq(x, 3))).toArray())
    .toEqual([1, 3]);
});

test("not, once, and if-then-else", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 5 }), fc.integer({ min: 0, max: 5 }), (xs, x) => {
    const inList = xs.includes(x);
    expect(query(() => not(member(x, list(...xs)))).toArray().length).toBe(inList ? 0 : 1);
    expect(query((q) => once(member(q, list(...xs)))).toArray()).toEqual(xs.slice(0, 1));
    expect(query((q) => ifThenElse(member(x, list(...xs)), eq(q, "yes"), eq(q, "no"))).toArray())
      .toEqual([inList ? "yes" : "no"]);
  }), options);
  // The condition's bindings carry into the then branch, and only its first answer counts.
  expect(query((x, y) => ifThenElse(member(x, list(1, 2)), eq(y, "then"), eq(y, "else"))).toArray())
    .toEqual([[1, "then"]]);
  expect(query((x) => ifThenElse(conj(member(x, list(1, 2, 3)), eq(x, 2)), succeed, fail)).toArray()).toEqual([2]);
});

test("tabled recursion matches transitive closure on any graph", () => {
  const edges = fc.array(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 4 })), { maxLength: 10 });
  fc.assert(fc.property(edges, (pairs) => {
    const closure = new Set<string>();
    const reach = (from: number) => {
      const seen = new Set<number>();
      const todo = pairs.filter(([a]) => a === from).map(([, b]) => b);
      while (todo.length) {
        const n = todo.pop()!;
        if (seen.has(n)) continue;
        seen.add(n);
        closure.add(JSON.stringify([from, n]));
        todo.push(...pairs.filter(([a]) => a === n).map(([, b]) => b));
      }
    };
    for (let n = 0; n <= 4; n++) reach(n);
    const expected = [...closure].sort();

    const edge = facts(pairs);
    // Left recursion.
    const left: (x: Term, z: Term) => Goal<void> = table((x: Term, z: Term) =>
      oneOf(fresh((y) => conj(left(x, y), edge(y, z))), edge(x, z)));
    // Mutual recursion: p and q form one SCC.
    const p: (x: Term, z: Term) => Goal<void> = table((x: Term, z: Term) =>
      oneOf(fresh((y) => conj(q(x, y), edge(y, z))), edge(x, z)));
    const q: (x: Term, z: Term) => Goal<void> = table((x: Term, z: Term) => p(x, z));

    for (const rel of [left, p, q]) {
      expect(sorted(query((x, z) => rel(x, z)).toArray())).toEqual(expected);
      for (let n = 0; n <= 4; n++) {
        expect(sorted(query((z) => rel(n, z)).toArray().map((z) => [n, z]))).toEqual(expected.filter((e) => JSON.parse(e)[0] === n));
      }
    }
  }), { ...options, numRuns: 100 });
});
