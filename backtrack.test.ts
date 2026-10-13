import { expect, test } from "bun:test";
import fc from "fast-check";
import { Backtrack as Lazy } from "./lazy";
import { Backtrack as Eager } from "./eager";

const integer = fc.integer({ min: -100, max: 100 });
const values = fc.array(integer, { maxLength: 8 });
const options = { numRuns: 300 };

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

