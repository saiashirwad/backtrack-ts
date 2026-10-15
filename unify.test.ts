import { expect, test } from "bun:test";
import fc from "fast-check";
import { Goal, Var, conj, eq, fresh, list, oneOf, query, value } from "./unify";
import { append, appendWithoutGen, grandparent, length, nat, path } from "./relations";

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
