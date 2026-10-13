import assert from "node:assert/strict";
import { bench, group, run, summary } from "mitata";
import { Backtrack } from "./lazy";
import { Backtrack as EagerBacktrack } from "./eager";

interface Search<A> {
  [Symbol.iterator](): Generator<Search<A>, A, A>;
  iterate(): Generator<A>;
  toArray(): A[];
}

interface Logic {
  fromArray<A>(values: readonly A[]): Search<A>;
  guard(condition: boolean): Search<void>;
  gen<A>(body: () => Generator<any, A, any>): Search<A>;
}

const parents = [["Sarah", "John"], ["Arnold", "John"], ["John", "Anne"]] as const;
const values = Array.from({ length: 32 }, (_, i) => i);
const cols = Array.from({ length: 8 }, (_, i) => i + 1);

const grandparents = (logic: Logic) => logic.gen(function* () {
  const [p, c] = yield* logic.fromArray(parents);
  const [c_, g] = yield* logic.fromArray(parents);
  yield* logic.guard(c === c_);
  yield* logic.guard(g === "Anne");
  return p;
});

const pairs = (logic: Logic, accept: (a: number, b: number) => boolean) =>
  logic.gen(function* () {
    const a = yield* logic.fromArray(values);
    const b = yield* logic.fromArray(values);
    yield* logic.guard(accept(a, b));
    return a * 32 + b;
  });

const queens = (logic: Logic) => {
  const place = (placed: readonly number[]): Search<readonly number[]> =>
    logic.gen(function* () {
      if (placed.length === 8) return placed;
      const col = yield* logic.fromArray(cols);
      yield* logic.guard(placed.every((prev, i) =>
        col !== prev && Math.abs(col - prev) !== i + 1));
      return yield* place([col, ...placed]);
    });
  return place([]);
};

const first = <A>(search: Search<A>): A | undefined => {
  const results = search.iterate();
  try {
    return results.next().value;
  } finally {
    results.return(undefined);
  }
};

const workloads = [
  { name: "grandparents", build: grandparents, count: 2 },
  { name: "pairs: 32 x 32, all accepted", build: (logic: Logic) => pairs(logic, () => true), count: 1024 },
  { name: "pairs: only final pair accepted", build: (logic: Logic) => pairs(logic, (a, b) => a === 31 && b === 31), count: 1 },
  { name: "pairs: no solution", build: (logic: Logic) => pairs(logic, () => false), count: 0 },
  { name: "eight queens", build: queens, count: 92 },
];

// Build once, then run a fresh search each iteration. Construction and input
// allocation are excluded; collection and iterator cancellation are included.
for (const workload of workloads) {
  const eager: Search<unknown> = workload.build(EagerBacktrack);
  const lazy: Search<unknown> = workload.build(Backtrack);
  const expected = eager.toArray();
  assert.equal(expected.length, workload.count);
  assert.deepEqual(lazy.toArray(), expected);
  assert.deepEqual(first(eager), expected[0]);
  assert.deepEqual(first(lazy), expected[0]);

  group(`${workload.name}: collect all`, () => summary(() => {
    bench("eager", () => eager.toArray());
    bench("lazy", () => lazy.toArray());
  }));
  group(`${workload.name}: first result`, () => summary(() => {
    bench("eager", () => first(eager));
    bench("lazy", () => first(lazy));
  }));
}

console.log("Result equivalence checked for all workloads.");
await run({ throw: true });
