export class Backtrack<A> {
  constructor(readonly iterate: () => Generator<A>) {}

  static of<A>(a: A): Backtrack<A> {
    return new Backtrack(function* () {
      yield a;
    });
  }

  static empty<A = never>(): Backtrack<A> {
    return new Backtrack(function* () {});
  }

  static fromArray<A>(xs: readonly A[]): Backtrack<A> {
    return new Backtrack(function* () {
      yield* xs;
    });
  }

  static guard(condition: boolean): Backtrack<void> {
    return condition ? Backtrack.of(undefined) : Backtrack.empty();
  }

  flatMap<B>(f: (a: A) => Backtrack<B>): Backtrack<B> {
    const source = this;
    return new Backtrack(function* () {
      for (const a of source.iterate()) {
        yield* f(a).iterate();
      }
    });
  }

  map<B>(f: (a: A) => B): Backtrack<B> {
    return this.flatMap((a) => Backtrack.of(f(a)));
  }

  *[Symbol.iterator](): Generator<Backtrack<A>, A, A> {
    return yield this;
  }

  toArray(): A[] {
    return Array.from(this.iterate());
  }

  static gen<A>(body: () => Generator<Backtrack<any>, A, any>): Backtrack<A> {
    const step = (history: readonly any[]): Backtrack<A> =>
      new Backtrack(function* () {
        const it = body();
        try {
          let state = it.next();
          for (const value of history) {
            state = it.next(value);
          }
          if (state.done) {
            yield state.value;
            return;
          }
          for (const value of state.value.iterate()) {
            yield* step([...history, value]).iterate();
          }
        } finally {
          it.return(undefined as A);
        }
      });
    return step([]);
  }
}
