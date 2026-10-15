import { expect, test } from "bun:test";
import fc from "fast-check";
import { Backtrack as Lazy } from "../src/lazy.ts";
import { Backtrack as Eager } from "../src/eager.ts";
import { grandparent } from "../examples/grandparent.ts";
import { queens } from "../examples/nqueens.ts";

const integer = fc.integer({ min: -100, max: 100 });
const values = fc.array(integer, { maxLength: 8 });
const options = {
  numRuns: 300,
  seed: process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined,
};

test("examples return the expected relatives and complete valid queens solutions", () => {
  const counts = [1, 1, 0, 0, 2, 10, 4, 40, 92];
  fc.assert(fc.property(
    fc.oneof(fc.constantFrom("Anne", "John", "Sarah", "Arnold"), fc.string()),
    fc.integer({ min: 0, max: 8 }),
    (name, n) => {
      expect(grandparent(name).toArray()).toEqual(name === "Anne" ? ["Sarah", "Arnold"] : []);
      const solutions = queens(n).toArray();
      expect(solutions.length).toBe(counts[n]!);
      expect(new Set(solutions.map((board) => JSON.stringify(board))).size).toBe(solutions.length);
      for (const board of solutions) {
        expect(board.length).toBe(n);
        expect(board.every((col) => col >= 1 && col <= n)).toBe(true);
        expect(board.every((col, row) => board.every((other, otherRow) =>
          row === otherRow || (col !== other && Math.abs(col - other) !== Math.abs(row - otherRow)),
        ))).toBe(true);
      }
    },
  ), { ...options, numRuns: 100 });
});

test("both implementations compose flatMap and map like array searches", () => {
  fc.assert(fc.property(
    values, fc.func(fc.array(integer, { maxLength: 3 })), fc.func(integer),
    (xs, branch, transform) => {
      const expected = xs.flatMap((x) => branch(x)).map((x) => transform(x));
      const lazy = Lazy.fromArray(xs).flatMap((x) => Lazy.fromArray(branch(x))).map(transform);
      const eager = Eager.fromArray(xs).flatMap((x) => Eager.fromArray(branch(x))).map(transform);
      expect(lazy.toArray()).toEqual(expected);
      expect(eager.toArray()).toEqual(expected);
    },
  ), options);
});

test("both implementations backtrack through nested choices and guards", () => {
  fc.assert(fc.property(values, values, fc.func(fc.boolean()), (xs, ys, accept) => {
    const expected = xs.flatMap((x) => ys.filter((y) => accept(x, y)).map((y) => [x, y]));
    for (const Backtrack of [Lazy, Eager]) {
      const search = Backtrack.gen(function* (): Generator<any, number[], any> {
        const x = yield* Backtrack.fromArray(xs);
        return yield* Backtrack.gen(function* (): Generator<any, number[], any> {
          const y = yield* Backtrack.fromArray(ys);
          yield* Backtrack.guard(accept(x, y));
          return [x, y];
        });
      });
      expect(search.toArray()).toEqual(expected);
    }
  }), options);
});

test("lazy: gen consumes finite prefixes of infinite sources and closes on cancellation", () => {
  fc.assert(fc.property(
    integer, fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 20 }),
    (start, stride, count) => {
      let visited = 0;
      let closed = false;
      let activeBodies = 0;
      const source = new Lazy(function* () {
        try {
          for (let value = start; ; value++) {
            visited++;
            yield value;
          }
        } finally {
          closed = true;
        }
      });
      const search = Lazy.gen(function* () {
        activeBodies++;
        try {
          const value = yield* source;
          yield* Lazy.guard((value - start) % stride === 0);
          return value;
        } finally {
          activeBodies--;
        }
      });
      const results = search.iterate();
      expect(visited).toBe(0);
      expect(activeBodies).toBe(0);
      try {
        for (let i = 0; i < count; i++) {
          expect(results.next()).toEqual({ value: start + i * stride, done: false });
          expect(visited).toBe(i * stride + 1);
        }
      } finally {
        results.return(undefined);
      }
      expect(closed).toBe(true);
      expect(activeBodies).toBe(0);
      expect(visited).toBe((count - 1) * stride + 1);
    },
  ), options);
});

