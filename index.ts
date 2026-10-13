export class Backtrack<A> {
  constructor(public readonly run: <R>(cons: (a: A, r: R) => R, nil: R) => R) {}

  static of<A>(a: A): Backtrack<A> {
    return new Backtrack((cons, nil) => cons(a, nil));
  }

  static empty<A = never>(): Backtrack<A> {
    return new Backtrack((_cons, nil) => nil);
  }

  static fromArray<A>(xs: readonly A[]): Backtrack<A> {
    return new Backtrack((cons, nil) => {
      let acc = nil;
      for (let i = xs.length - 1; i >= 0; i--) {
        acc = cons(xs[i]!, acc);
      }
      return acc;
    });
  }

  static guard(condition: boolean): Backtrack<void> {
    return condition ? Backtrack.of(undefined) : Backtrack.empty();
  }

  flatMap<B>(f: (a: A) => Backtrack<B>): Backtrack<B> {
    return new Backtrack((cons, nil) => this.run((a, r) => f(a).run(cons, r), nil));
  }

  map<B>(f: (a: A) => B): Backtrack<B> {
    return new Backtrack((cons, nil) => this.run((a, r) => cons(f(a), r), nil));
  }

  *[Symbol.iterator](): Generator<Backtrack<A>, A, A> {
    return yield this;
  }

  *toGenerator(): Generator<A> {
    const step = this.run<() => Generator<A>>(
      (a, next) =>
        function* () {
          yield a;
          yield* next();
        },
      function* () {},
    );
    yield* step();
  }

  static gen<A>(body: () => Generator<Backtrack<any>, A, any>): Backtrack<A> {
    const step = (history: readonly any[]): Backtrack<A> =>
      new Backtrack((cons, nil) => {
        const it = body();
        let state = it.next();

        for (const pastValue of history) {
          state = it.next(pastValue);
        }

        if (state.done) {
          return cons(state.value, nil);
        }

        return state.value.run((val, nextAcc) => step([...history, val]).run(cons, nextAcc), nil);
      });

    return step([]);
  }
}

type Board = readonly number[];

const isSafe = (col: number, placed: Board): boolean =>
  placed.every((prevCol, idx) => col !== prevCol && Math.abs(col - prevCol) !== idx + 1);

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

function queens(n: number) {
  const cols = range(n);

  const placeRows = (row: number, placed: Board): Backtrack<Board> => {
    if (row > n) return Backtrack.of(placed);

    return Backtrack.gen(function* () {
      const col = yield* Backtrack.fromArray(cols);
      yield* Backtrack.guard(isSafe(col, placed));
      return yield* placeRows(row + 1, [col, ...placed]);
    });
  };

  return placeRows(1, []);
}

const firstSolution = queens(8).toGenerator().next().value;
console.log(firstSolution);

