import { Backtrack } from "./lazy";

export class Var {
  constructor(readonly id: number) {}
}

export class Cons {
  constructor(readonly head: Term, readonly tail: Term) {}
}

export type Term = string | number | boolean | null | Var | Cons | readonly Term[];

// Persistent map from variable id to term: a 32-way trie keyed by the id's bits.
// Variable ids are small dense integers, so updates copy only O(log32 n) nodes.
type Trie = readonly (Term | Trie | undefined)[];
type Subst = { readonly root: Trie; readonly depth: number };

const BITS = 5;
const WIDTH = 1 << BITS;
const MASK = WIDTH - 1;
const emptySubst: Subst = { root: [], depth: 1 };

const lookup = (subst: Subst, id: number): Term | undefined => {
  if (id >= WIDTH ** subst.depth) return undefined;
  let node: Trie | undefined = subst.root;
  for (let level = subst.depth - 1; node && level > 0; level--) node = node[(id >>> (level * BITS)) & MASK] as Trie | undefined;
  return node?.[id & MASK] as Term | undefined;
};

const extend = (subst: Subst, id: number, t: Term): Subst => {
  let { root, depth } = subst;
  while (id >= WIDTH ** depth) {
    root = [root];
    depth++;
  }
  const set = (node: Trie | undefined, level: number): Trie => {
    const copy = node ? node.slice() : [];
    const i = (id >>> (level * BITS)) & MASK;
    copy[i] = level === 0 ? t : set(node?.[i] as Trie | undefined, level - 1);
    return copy;
  };
  return { root: set(root, depth - 1), depth };
};

type State = { readonly subst: Subst; readonly next: number };
type Cont<A> = (a: A, s: State) => void;
type Body<A> = () => Generator<Goal<any>, A, any>;

type Consumer = { readonly args: readonly Term[]; readonly s: State; readonly k: Cont<void> };
type Table = { readonly answers: Term[]; readonly seen: Set<string>; readonly consumers: Consumer[] };

// Runs tasks first-in first-out. Every goal entry and every branch goes through the
// queue, so no branch can starve the others and the JS stack stays flat however
// deep the search goes.
class Scheduler {
  private tasks: (() => void)[] = [];
  private head = 0;
  readonly tables = new Map<object, Map<string, Table>>();

  push(task: () => void): void {
    this.tasks.push(task);
  }

  step(): boolean {
    if (this.head === this.tasks.length) return false;
    const task = this.tasks[this.head++]!;
    if (this.head > 1024 && this.head * 2 > this.tasks.length) {
      this.tasks = this.tasks.slice(this.head);
      this.head = 0;
    }
    task();
    return true;
  }
}

export class Goal<A> {
  /**
   * `det` goals call `k` synchronously at most once, so `gen` can run them inline.
   * Every other goal must call `k` from a scheduled task.
   */
  constructor(
    readonly run: (s: State, k: Cont<A>, sched: Scheduler) => void,
    readonly det = false,
  ) {}

  *[Symbol.iterator](): Generator<Goal<A>, A, A> {
    return yield this;
  }

  static gen<A>(body: Body<A>): Goal<A> {
    return new Goal((s, k, sched) =>
      sched.push(() => {
        const it = body();
        drive(body, it, it.next(), null, s, k, sched);
      }),
    );
  }
}

// Replay history as a persistent linked list, so extending it is O(1).
type History = { readonly value: unknown; readonly prev: History } | null;

const historyToArray = (h: History): unknown[] => {
  const out: unknown[] = [];
  for (; h; h = h.prev) out.push(h.value);
  return out.reverse();
};

function drive<A>(
  body: Body<A>,
  it: Generator<Goal<any>, A, any>,
  r: IteratorResult<Goal<any>, A>,
  hist: History,
  s: State,
  k: Cont<A>,
  sched: Scheduler,
): void {
  // Deterministic steps (eq, fresh) feed the live generator directly.
  while (!r.done && r.value.det) {
    let out: [unknown, State] | undefined;
    r.value.run(s, (v, s2) => (out = [v, s2]), sched);
    if (!out) return;
    hist = { value: out[0], prev: hist };
    s = out[1];
    r = it.next(out[0]);
  }
  if (r.done) {
    const [value, final] = [r.value, s];
    sched.push(() => k(value, final));
    return;
  }
  // A real choice point. Generators can't be cloned, so the first answer takes the
  // live generator and later answers rebuild one by replaying the history.
  let live: Generator<Goal<any>, A, any> | null = it;
  const before = hist;
  r.value.run(
    s,
    (v, s2) => {
      const h: History = { value: v, prev: before };
      if (live) {
        const next = live;
        live = null;
        drive(body, next, next.next(v), h, s2, k, sched);
        return;
      }
      const replay = body();
      let r2 = replay.next();
      for (const x of historyToArray(h)) r2 = replay.next(x);
      drive(body, replay, r2, h, s2, k, sched);
    },
    sched,
  );
}

const walk = (t: Term, subst: Subst): Term => {
  for (let bound; t instanceof Var && (bound = lookup(subst, t.id)) !== undefined; ) t = bound;
  return t;
};

const children = (t: Term): readonly Term[] | null =>
  t instanceof Cons ? [t.head, t.tail] : Array.isArray(t) ? t : null;

// Bottom-up fold over a fully walked term. It keeps an explicit stack instead of
// recursing, so term depth (e.g. s(s(s(...)))) is limited by memory, not the JS stack.
// `leaf` sees non-compound terms left to right.
const fold = <R>(
  t: Term,
  subst: Subst,
  leaf: (t: Term) => R,
  node: (t: Term, kids: R[]) => R,
): R => {
  const stack: { term: Term; kids: readonly Term[]; done: R[] }[] = [];
  let pending = t;
  for (;;) {
    const term = walk(pending, subst);
    const kids = children(term);
    if (kids?.length) {
      stack.push({ term, kids, done: [] });
      pending = kids[0]!;
      continue;
    }
    let value = kids ? node(term, []) : leaf(term);
    for (;;) {
      const top = stack.at(-1);
      if (!top) return value;
      top.done.push(value);
      if (top.done.length < top.kids.length) {
        pending = top.kids[top.done.length]!;
        break;
      }
      stack.pop();
      value = node(top.term, top.done);
    }
  }
};

// Whether a compound term contains no variables at all. Terms are immutable, so the
// answer never changes and is cached per object; without this, binding a variable
// to the tail of a long list would rescan the whole tail every time.
const groundCache = new WeakMap<object, boolean>();

const isGround = (root: Term): boolean => {
  if (root instanceof Var) return false;
  const pending: Term[] = [root];
  const uncached: Term[] = [];
  while (pending.length) {
    const t = pending.pop()!;
    const kids = children(t);
    if (kids && !groundCache.has(t as object)) {
      uncached.push(t);
      pending.push(...kids);
    }
  }
  // Descendants come after their ancestors in `uncached`, so walk it backwards.
  for (let i = uncached.length - 1; i >= 0; i--) {
    const t = uncached[i]!;
    const ground = children(t)!.every((kid) => !(kid instanceof Var) && (groundCache.get(kid as object) ?? true));
    groundCache.set(t as object, ground);
  }
  return groundCache.get(root as object) ?? true;
};

// Binding v to a term containing v would build an infinite term (X = f(X)).
const occurs = (v: Var, t: Term, subst: Subst): boolean => {
  const stack = [t];
  while (stack.length) {
    const term = walk(stack.pop()!, subst);
    if (term instanceof Var) {
      if (term.id === v.id) return true;
    } else if (!isGround(term)) {
      stack.push(...children(term)!);
    }
  }
  return false;
};

const bind = (v: Var, t: Term, subst: Subst): Subst | null =>
  occurs(v, t, subst) ? null : extend(subst, v.id, t);

const unify = (a: Term, b: Term, subst: Subst): Subst | null => {
  const pairs: [Term, Term][] = [[a, b]];
  let s: Subst | null = subst;
  while (s && pairs.length) {
    const [x0, y0] = pairs.pop()!;
    const x = walk(x0, s);
    const y = walk(y0, s);
    if (x === y) continue;
    if (x instanceof Var) s = bind(x, y, s);
    else if (y instanceof Var) s = bind(y, x, s);
    else if (x instanceof Cons && y instanceof Cons) pairs.push([x.tail, y.tail], [x.head, y.head]);
    else if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
      for (let i = x.length - 1; i >= 0; i--) pairs.push([x[i], y[i]]);
    } else s = null;
  }
  return s;
};

const rebuild = (t: Term, kids: Term[]): Term => (t instanceof Cons ? new Cons(kids[0]!, kids[1]!) : kids);

/**
 * `fresh()` yields a new unbound variable inside `Goal.gen`.
 * `fresh((x, y) => goal)` introduces one variable per parameter without a generator,
 * miniKanren style. The callback runs only when the goal does, so recursive relations
 * written this way don't recurse while being constructed.
 */
export function fresh(): Goal<Var>;
export function fresh<A>(f: (...vars: Var[]) => Goal<A>): Goal<A>;
export function fresh<A>(f?: (...vars: Var[]) => Goal<A>): Goal<Var> | Goal<A> {
  if (!f) return new Goal<Var>((s, k) => k(new Var(s.next), { ...s, next: s.next + 1 }), true);
  return new Goal<A>((s, k, sched) =>
    sched.push(() => {
      const vars = Array.from({ length: f.length }, (_, i) => new Var(s.next + i));
      f(...vars).run({ ...s, next: s.next + vars.length }, k, sched);
    }),
  );
}

/** Succeeds once if `a` and `b` unify, extending the bindings; fails otherwise. */
export const eq = (a: Term, b: Term): Goal<void> =>
  new Goal((s, k) => {
    const subst = unify(a, b, s.subst);
    if (subst) k(undefined, { ...s, subst });
  }, true);

/**
 * Reads `t` under the current bindings into JavaScript, like the right-hand side of
 * Prolog's `is`. Variables still unbound at this point come back as `Var`s.
 */
export const value = (t: Term): Goal<Term> =>
  new Goal((s, k) => k(fold(t, s.subst, (leaf) => leaf, rebuild), s), true);

/** Run goals in sequence without a generator, so nothing is ever replayed. */
export const conj = (...goals: Goal<unknown>[]): Goal<void> => {
  const det = goals.every((g) => g.det);
  return new Goal((s, k, sched) => {
    const from = (i: number, s: State): void => {
      // Deterministic goals run in a loop so long conjunctions don't nest calls.
      for (; i < goals.length && goals[i]!.det; i++) {
        let next: State | undefined;
        goals[i]!.run(s, (_, s2) => (next = s2), sched);
        if (!next) return;
        s = next;
      }
      if (i < goals.length) goals[i]!.run(s, (_, s2) => from(i + 1, s2), sched);
      // Like gen, hand the result back through the queue: calling k directly would
      // unwind every enclosing recursive conj on the JS stack at once.
      else if (det) k(undefined, s);
      else sched.push(() => k(undefined, s));
    };
    from(0, s);
  }, det);
};

/** Try every alternative; their answers are interleaved fairly. */
export const oneOf = <A>(...goals: Goal<A>[]): Goal<A> =>
  new Goal((s, k, sched) => {
    for (const g of goals) sched.push(() => g.run(s, k, sched));
  });

/** Turn a table of ground rows into a relation usable in any direction. */
export const facts =
  <Row extends readonly Term[]>(rows: readonly Row[]) =>
  (...args: { [K in keyof Row]: Term }): Goal<void> =>
    oneOf(...rows.map((row) => eq(args, row)));

export const list = (...xs: Term[]): Term => xs.reduceRight<Term>((tail, head) => new Cons(head, tail), []);

// Fully walk `t`, renaming its unbound variables to placeholders -1, -2, ... in
// order of appearance, so variant terms (equal up to renaming) come out identical.
const canonical = (t: Term, subst: Subst): Term => {
  const names = new Map<number, Var>();
  return fold(
    t,
    subst,
    (leaf) => {
      if (!(leaf instanceof Var)) return leaf;
      if (!names.has(leaf.id)) names.set(leaf.id, new Var(-1 - names.size));
      return names.get(leaf.id)!;
    },
    rebuild,
  );
};

const CLOSE = Symbol("close");

// Serialize a canonical term to a string key, iteratively for the same reason as fold.
const keyOf = (t: Term): string => {
  const out: string[] = [];
  const stack: (Term | typeof CLOSE)[] = [t];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === CLOSE) out.push(")");
    else if (x instanceof Var) out.push(`?${x.id}`);
    else {
      const kids = children(x);
      if (!kids) out.push(JSON.stringify(x));
      else {
        out.push(x instanceof Cons ? "cons(" : "tuple(");
        stack.push(CLOSE);
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
      }
    }
  }
  return out.join(" ");
};

// Copy a canonical term, giving its placeholders fresh variables starting at `next`.
const instantiate = (t: Term, next: number): [Term, number] => {
  let count = 0;
  const copy = fold(
    t,
    emptySubst,
    (leaf) => {
      if (!(leaf instanceof Var)) return leaf;
      count = Math.max(count, -leaf.id);
      return new Var(next - 1 - leaf.id);
    },
    rebuild,
  );
  return [copy, next + count];
};

/**
 * Memoize a relation's answers per call pattern (Prolog's `:- table`). Repeated or
 * left-recursive calls consume the stored answers instead of re-deriving them, so
 * relations like transitive closure over a cyclic graph terminate.
 */
export const table = <Args extends readonly Term[]>(relation: (...args: Args) => Goal<void>) => {
  const id = {};
  const deliver = (answer: Term, c: Consumer, sched: Scheduler) =>
    sched.push(() => {
      const [copy, next] = instantiate(answer, c.s.next);
      const subst = unify(c.args, copy, c.s.subst);
      if (subst) c.k(undefined, { subst, next });
    });

  return (...args: Args): Goal<void> =>
    new Goal((s, k, sched) => {
      let tables = sched.tables.get(id);
      if (!tables) sched.tables.set(id, (tables = new Map()));
      const key = keyOf(canonical(args, s.subst));
      const consumer: Consumer = { args, s, k };
      const existing = tables.get(key);
      if (existing) {
        existing.consumers.push(consumer);
        for (const answer of existing.answers) deliver(answer, consumer, sched);
        return;
      }
      const entry: Table = { answers: [], seen: new Set(), consumers: [consumer] };
      tables.set(key, entry);
      relation(...args).run(
        s,
        (_, s2) => {
          const answer = canonical(args, s2.subst);
          const answerKey = keyOf(answer);
          if (entry.seen.has(answerKey)) return;
          entry.seen.add(answerKey);
          entry.answers.push(answer);
          for (const c of entry.consumers) deliver(answer, c, sched);
        },
        sched,
      );
    });
};

// A reified list under construction: elements are pushed from the last to the
// first as fold climbs back up the cons cells.
class PartialList {
  constructor(
    readonly reversed: unknown[],
    readonly tail: unknown,
  ) {}
}

const finish = (x: unknown): unknown => {
  if (!(x instanceof PartialList)) return x;
  const items = x.reversed.reverse();
  return Array.isArray(x.tail) && x.tail.length === 0 ? items : [...items, "|", x.tail];
};

// Convert a term to plain data: proper lists become arrays, unbound variables `_n`.
const reify = (t: Term, subst: Subst): unknown =>
  finish(
    fold<unknown>(
      t,
      subst,
      (leaf) => (leaf instanceof Var ? `_${leaf.id}` : leaf),
      (term, kids) => {
        if (!(term instanceof Cons)) return kids.map(finish);
        const [head, tail] = [finish(kids[0]), kids[1]];
        if (tail instanceof PartialList) {
          tail.reversed.push(head);
          return tail;
        }
        return new PartialList([head], tail);
      },
    ),
  );

/** Run a query, returning a lazy Backtrack of the answers for the query variable(s). */
export const query = (goal: (...vars: Var[]) => Goal<unknown>): Backtrack<any> => {
  const vars = Array.from({ length: Math.max(goal.length, 1) }, (_, i) => new Var(i));
  return new Backtrack(function* () {
    const sched = new Scheduler();
    const answers: unknown[] = [];
    goal(...vars).run(
      { subst: emptySubst, next: vars.length },
      (_, s) => answers.push(vars.length === 1 ? reify(vars[0]!, s.subst) : vars.map((v) => reify(v, s.subst))),
      sched,
    );
    for (;;) {
      if (answers.length) yield answers.shift();
      else if (!sched.step()) return;
    }
  });
};
