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

  *iterate(): Generator<A> {
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

  toArray(): A[] {
    return Array.from(this.iterate());
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

const parents = [
  ["Sarah", "John"],
  ["Arnold", "John"],
  ["John", "Anne"],
];

const grandparent = (grandchild: string) =>
  Backtrack.gen(function* () {
    const [p, c] = yield* Backtrack.fromArray(parents);
    const [c_, g] = yield* Backtrack.fromArray(parents);
    yield* Backtrack.guard(c === c_);
    yield* Backtrack.guard(g === grandchild);
    return p;
  });

console.log(grandparent("Anne").toArray());
