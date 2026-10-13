export interface Search<A> {
  [Symbol.iterator](): Generator<Search<A>, A, A>;
  iterate(): Generator<A>;
  toArray(): A[];
}

export interface Logic {
  fromArray<A>(values: readonly A[]): Search<A>;
  guard(condition: boolean): Search<void>;
  gen<A>(body: () => Generator<any, A, any>): Search<A>;
}
