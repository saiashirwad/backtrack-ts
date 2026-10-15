export class Backtrack<A> {
  readonly run: <R>(cons: (a: A, r: R) => R, nil: R) => R;

  constructor(run: <R>(cons: (a: A, r: R) => R, nil: R) => R) {
    this.run = run;
  }

  static of<A>(a: A): Backtrack<A> {
    return new Backtrack((cons, nil) => cons(a, nil));
  }

  static empty<A = never>(): Backtrack<A> {
    return new Backtrack((_cons, nil) => nil);
  }

  static fromArray<A>(xs: readonly A[]): Backtrack<A> {
    return new Backtrack((cons, nil) => xs.reduceRight((acc, x) => cons(x, acc), nil));
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
    yield* this.run<() => Generator<A>>(
      (a, next) => function* () {
        yield a;
        yield* next();
      },
      function* () {},
    )();
  }

  toArray(): A[] {
    return Array.from(this.iterate());
  }

  static gen<A>(body: () => Generator<Backtrack<any>, A, any>): Backtrack<A> {
    const step = (history: readonly any[]): Backtrack<A> =>
      new Backtrack((cons, nil) => {
        const it = body();
        let state = it.next();
        for (const value of history) {
          state = it.next(value);
        }
        if (state.done) {
          return cons(state.value, nil);
        }
        return state.value.run((value, acc) => step([...history, value]).run(cons, acc), nil);
      });
    return step([]);
  }
}
