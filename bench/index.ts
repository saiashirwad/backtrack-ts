import assert from "node:assert/strict";
import { bench, group, run, summary } from "mitata";
import { Backtrack } from "../src/lazy.ts";
import { Backtrack as EagerBacktrack } from "../src/eager.ts";
import { grandparent } from "../examples/grandparent.ts";
import { queens } from "../examples/nqueens.ts";
import type { Logic, Search } from "../src/search.ts";

const values = Array.from({ length: 32 }, (_, i) => i);

const pairs = (accept: (a: number, b: number) => boolean) => (logic: Logic) =>
  logic.gen(function* () {
    const a = yield* logic.fromArray(values);
    const b = yield* logic.fromArray(values);
    yield* logic.guard(accept(a, b));
    return a * 32 + b;
  });

const first = <A>(search: Search<A>): A | undefined => {
  const results = search.iterate();
  try {
    return results.next().value;
  } finally {
    results.return(undefined);
  }
};

const workloads = [
  { name: "grandparents", build: (logic: Logic) => grandparent("Anne", logic), count: 2 },
  { name: "pairs: 32 x 32, all accepted", build: pairs(() => true), count: 1024 },
  {
    name: "pairs: only final pair accepted",
    build: pairs((a, b) => a === 31 && b === 31),
    count: 1,
  },
  { name: "pairs: no solution", build: pairs(() => false), count: 0 },
  { name: "eight queens", build: (logic: Logic) => queens(8, logic), count: 92 },
];

for (const workload of workloads) {
  const eager: Search<unknown> = workload.build(EagerBacktrack);
  const lazy: Search<unknown> = workload.build(Backtrack);
  const expected = eager.toArray();
  assert.equal(expected.length, workload.count);
  assert.deepEqual(lazy.toArray(), expected);
  assert.deepEqual(first(eager), expected[0]);
  assert.deepEqual(first(lazy), expected[0]);

  group(`${workload.name}: collect all`, () =>
    summary(() => {
      bench("eager", () => eager.toArray());
      bench("lazy", () => lazy.toArray());
    }),
  );
  group(`${workload.name}: first result`, () =>
    summary(() => {
      bench("eager", () => first(eager));
      bench("lazy", () => first(lazy));
    }),
  );
}

console.log("Result equivalence checked for all workloads.");
await run({ throw: true });
