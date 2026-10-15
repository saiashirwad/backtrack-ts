import { expect, test } from "bun:test";
import fc from "fast-check";
import { Goal, Var, conj, eq, fresh, list, oneOf, query, value } from "../src/unify";
import {
  ancestor, append, appendWithoutGen, australia, fromPeano, grandparent, length, member, nat, path, peano, plus, pythagorean,
} from "../examples/relations";

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

test("an infinite branch does not starve the others", () => {
  const forever = (q: unknown): Goal<void> => Goal.gen(function* () {
    yield* forever(q);
  });
  expect(take(query((q) => oneOf(forever(q), eq(q, "found"))), 1)).toEqual(["found"]);
});

test("left recursion still produces answers", () => {
  expect(sorted(take(query((q) => nat(q)), 3))).toEqual(sorted([0, ["s", 0], ["s", ["s", 0]]]));
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
    expect(sorted(viaConj)).toEqual(sorted(viaGen));
  }), options);
  const forever = (q: unknown): Goal<void> => fresh(() => forever(q));
  expect(take(query((q) => oneOf(forever(q), eq(q, "found"))), 1)).toEqual(["found"]);
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
