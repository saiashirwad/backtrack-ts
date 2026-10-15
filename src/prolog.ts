import { Backtrack } from "./lazy.ts";
import {
  Var,
  canonical,
  emptySubst,
  fold,
  instantiate,
  keyOf,
  rebuild,
  reify,
  unify,
  type Subst,
  type Term,
} from "./terms.ts";

type State = { readonly subst: Subst; readonly next: number };
type Body<A> = () => Generator<Goal<any>, A, any>;

type Node =
  | { readonly kind: "eq"; readonly a: Term; readonly b: Term }
  | { readonly kind: "fresh" }
  | { readonly kind: "value"; readonly t: Term }
  | { readonly kind: "succeed" }
  | { readonly kind: "fail" }
  | { readonly kind: "cut" }
  | { readonly kind: "and"; readonly goals: readonly Goal<unknown>[] }
  | { readonly kind: "or"; readonly goals: readonly Goal<unknown>[] }
  | { readonly kind: "clauses"; readonly goals: readonly Goal<unknown>[] }
  | { readonly kind: "ifThenElse"; readonly cond: Goal<unknown>; readonly then: Goal<unknown>; readonly else: Goal<unknown> }
  | { readonly kind: "freshIn"; readonly body: (...vars: Var[]) => Goal<unknown> }
  | { readonly kind: "gen"; readonly body: Body<unknown> }
  | { readonly kind: "table"; readonly space: TableSpace; readonly args: readonly Term[] };

export class Goal<A> {
  readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  *[Symbol.iterator](): Generator<Goal<A>, A, A> {
    return yield this;
  }

  /**
   * Write a goal as a generator: each `yield*` runs a goal and hands back its result,
   * so later goals can use earlier variables and values. A `cut` inside prunes the
   * body's own choices, and when the body is a clause of `clauses`, the remaining
   * clauses too.
   */
  static gen<A>(body: Body<A>): Goal<A> {
    return new Goal({ kind: "gen", body });
  }
}

/** A new unbound variable, or with a callback, one variable per parameter. */
export function fresh(): Goal<Var>;
export function fresh<A>(f: (...vars: Var[]) => Goal<A>): Goal<A>;
export function fresh<A>(f?: (...vars: Var[]) => Goal<A>): Goal<Var> | Goal<A> {
  return f ? new Goal<A>({ kind: "freshIn", body: f }) : new Goal<Var>({ kind: "fresh" });
}

/** `A = B`: succeeds once if `a` and `b` unify. */
export const eq = (a: Term, b: Term): Goal<void> => new Goal({ kind: "eq", a, b });

/** Reads `t` under the current bindings, like the right-hand side of `is`. */
export const value = (t: Term): Goal<Term> => new Goal({ kind: "value", t });

export const succeed: Goal<void> = new Goal({ kind: "succeed" });
export const fail: Goal<never> = new Goal({ kind: "fail" });

/** `!`: commits to the choices made so far in the enclosing clause. */
export const cut: Goal<void> = new Goal({ kind: "cut" });

/** `A, B`: run goals in sequence. */
export const conj = (...goals: Goal<unknown>[]): Goal<void> => new Goal({ kind: "and", goals });

/** `A ; B`: try each alternative in order. Transparent to cut, as in Prolog. */
export const oneOf = <A>(...goals: Goal<A>[]): Goal<A> => new Goal({ kind: "or", goals });

/** A predicate's clauses, tried in order. A `cut` in a clause prunes the clauses after it. */
export const clauses = <A>(...goals: Goal<A>[]): Goal<A> => new Goal({ kind: "clauses", goals });

/** `( C -> T ; E )`: if `cond` has an answer, commit to its first one and run `then`. */
export const ifThenElse = <A>(cond: Goal<unknown>, then: Goal<A>, otherwise: Goal<A>): Goal<A> =>
  new Goal({ kind: "ifThenElse", cond, then, else: otherwise });

/** `\+ G`: succeeds once if `goal` has no answers. */
export const not = (goal: Goal<unknown>): Goal<void> => ifThenElse(goal, fail, succeed);

/** `once(G)`: the first answer of `goal` only. */
export const once = (goal: Goal<unknown>): Goal<void> => ifThenElse(goal, succeed, fail);

/** Turn rows of ground terms into a relation usable in any direction. */
export const facts =
  <Row extends readonly Term[]>(rows: readonly Row[]) =>
  (...args: { [K in keyof Row]: Term }): Goal<void> =>
    oneOf(...rows.map((row) => eq(args, row)));

// --- Tabling ------------------------------------------------------------

type TableSpace = { readonly relation: (...args: any[]) => Goal<unknown> };

type Entry = {
  readonly answers: Term[];
  readonly seen: Set<string>;
  state: "new" | "evaluating" | "incomplete" | "complete";
  pos: number; // index on the evaluation stack while evaluating
  low: number; // lowest evaluating entry this one depends on (its SCC leader)
  epoch: number;
};

type Context = {
  readonly tables: Map<TableSpace, Map<string, Entry>>;
  readonly stack: Entry[];
  readonly pending: Entry[];
  added: number;
  epoch: number;
};

/**
 * `:- table`: remember answers per call pattern, so left recursion terminates.
 * A tabled call is evaluated to completion before its answers are returned.
 */
export const table = <Args extends readonly Term[]>(relation: (...args: Args) => Goal<void>) => {
  const space: TableSpace = { relation };
  return (...args: Args): Goal<void> => new Goal({ kind: "table", space, args });
};

// Evaluate a tabled call by iterating to a fixpoint (linear tabling). Recursive calls
// to an entry still being evaluated read the answers found so far. Mutually recursive
// tables form an SCC; only its leader (the lowest entry on the evaluation stack) loops
// until no table in the SCC gains an answer, then completes the whole SCC.
const evaluate = (entry: Entry, space: TableSpace, args: readonly Term[], s: State, ctx: Context): void => {
  entry.state = "evaluating";
  entry.pos = entry.low = ctx.stack.length;
  ctx.stack.push(entry);
  const pendingFrom = ctx.pending.length;
  for (;;) {
    const before = ctx.added;
    ctx.epoch++;
    for (const answer of solve(space.relation(...args), s, ctx)) {
      const term = canonical(args, answer.s.subst);
      const key = keyOf(term);
      if (entry.seen.has(key)) continue;
      entry.seen.add(key);
      entry.answers.push(term);
      ctx.added++;
    }
    if (entry.low < entry.pos || ctx.added === before) break;
  }
  ctx.stack.pop();
  if (entry.low === entry.pos) {
    entry.state = "complete";
    for (const member of ctx.pending.splice(pendingFrom)) member.state = "complete";
  } else {
    entry.state = "incomplete";
    entry.epoch = ctx.epoch;
    ctx.pending.push(entry);
    const parent = ctx.stack.at(-1)!;
    parent.low = Math.min(parent.low, entry.low);
  }
};

function* consume(entry: Entry, args: readonly Term[], s: State): Generator<Answer> {
  for (let i = 0; i < entry.answers.length; i++) {
    const [copy, next] = instantiate(entry.answers[i]!, s.next);
    const subst = unify(args, copy, s.subst);
    if (subst) yield { s: { subst, next }, ret: undefined };
  }
}

// --- The machine --------------------------------------------------------

type Answer = { readonly s: State; readonly ret: unknown };

// Replay history for a generator body, as a persistent list so extending it is O(1).
type History = { readonly value: unknown; readonly prev: History } | null;

// A running generator body. `at` is the history the live iterator has consumed; a
// resume frame whose history differs rebuilds the iterator by replaying.
type GenRun = { readonly body: Body<unknown>; it: Generator<Goal<any>, unknown, any>; at: History };

type Frame =
  | { readonly kind: "goal"; readonly goal: Goal<unknown>; readonly barrier: number; readonly clause: boolean }
  | { readonly kind: "resume"; readonly run: GenRun; readonly hist: History; readonly barrier: number }
  | { readonly kind: "cutTo"; readonly height: number };

type Cont = { readonly frame: Frame; readonly next: Cont } | null;

type Choice =
  | { readonly kind: "alt"; readonly s: State; readonly cont: Cont }
  | { readonly kind: "answers"; readonly answers: Iterator<Answer>; readonly cont: Cont };

const goalFrame = (goal: Goal<unknown>, barrier: number, clause: boolean, next: Cont): Cont => ({
  frame: { kind: "goal", goal, barrier, clause },
  next,
});

const replayValues = (h: History): unknown[] => {
  const out: unknown[] = [];
  for (; h; h = h.prev) out.push(h.value);
  return out.reverse();
};

/**
 * Depth-first search with an explicit choice-point stack, as in Prolog. A cut
 * truncates the stack to the height recorded when its clause was entered (its
 * barrier). Continuations and choice points live on the heap, so recursion depth
 * doesn't grow the JS stack.
 */
function* solve(goal: Goal<unknown>, start: State, ctx: Context): Generator<Answer> {
  const choices: Choice[] = [];
  let s = start;
  let ret: unknown;
  let cont: Cont = goalFrame(goal, 0, false, null);
  let failing = false;

  const alternatives = (goals: readonly Goal<unknown>[], barrier: number, clause: boolean) => {
    if (!goals.length) return void (failing = true);
    for (let i = goals.length - 1; i > 0; i--) {
      choices.push({ kind: "alt", s, cont: goalFrame(goals[i]!, barrier, clause, cont) });
    }
    cont = goalFrame(goals[0]!, barrier, clause, cont);
  };

  // Step a generator body: deterministic goals run inline; anything that may
  // backtrack is pushed as a frame, followed by a frame that resumes the body.
  const advance = (run: GenRun, hist: History, r: IteratorResult<Goal<any>, unknown>, barrier: number) => {
    for (;;) {
      if (r.done) return void (ret = r.value);
      const node = r.value.node;
      let v: unknown;
      if (node.kind === "eq") {
        const subst = unify(node.a, node.b, s.subst);
        if (!subst) return void (failing = true);
        s = { ...s, subst };
      } else if (node.kind === "fresh") {
        v = new Var(s.next);
        s = { ...s, next: s.next + 1 };
      } else if (node.kind === "value") {
        v = fold(node.t, s.subst, (leaf) => leaf, rebuild);
      } else if (node.kind === "cut") {
        choices.length = barrier;
      } else if (node.kind === "fail") {
        return void (failing = true);
      } else if (node.kind !== "succeed") {
        cont = goalFrame(r.value, barrier, false, { frame: { kind: "resume", run, hist, barrier }, next: cont });
        return;
      }
      hist = { value: v, prev: hist };
      run.at = hist;
      r = run.it.next(v);
    }
  };

  for (;;) {
    if (failing) {
      const choice = choices.at(-1);
      if (!choice) return;
      if (choice.kind === "alt") {
        choices.pop();
        ({ s, cont } = choice);
        failing = false;
        continue;
      }
      const r = choice.answers.next();
      if (r.done) {
        choices.pop();
        continue;
      }
      ({ s, ret } = r.value);
      cont = choice.cont;
      failing = false;
      continue;
    }
    if (!cont) {
      yield { s, ret };
      failing = true;
      continue;
    }
    const frame = cont.frame;
    cont = cont.next;

    if (frame.kind === "cutTo") {
      choices.length = frame.height;
      continue;
    }
    if (frame.kind === "resume") {
      const { run, hist, barrier } = frame;
      if (run.at !== hist) {
        run.it = run.body();
        run.it.next();
        for (const v of replayValues(hist)) run.it.next(v);
      }
      const fed: History = { value: ret, prev: hist };
      run.at = fed;
      advance(run, fed, run.it.next(ret), barrier);
      continue;
    }

    const { goal, barrier, clause } = frame;
    const node = goal.node;
    switch (node.kind) {
      case "eq": {
        const subst = unify(node.a, node.b, s.subst);
        if (subst) s = { ...s, subst };
        else failing = true;
        ret = undefined;
        break;
      }
      case "fresh":
        ret = new Var(s.next);
        s = { ...s, next: s.next + 1 };
        break;
      case "value":
        ret = fold(node.t, s.subst, (leaf) => leaf, rebuild);
        break;
      case "succeed":
        ret = undefined;
        break;
      case "fail":
        failing = true;
        break;
      case "cut":
        choices.length = barrier;
        ret = undefined;
        break;
      case "and":
        ret = undefined;
        for (let i = node.goals.length - 1; i >= 0; i--) cont = goalFrame(node.goals[i]!, barrier, false, cont);
        break;
      case "or":
        alternatives(node.goals, barrier, false);
        break;
      case "clauses":
        alternatives(node.goals, choices.length, true);
        break;
      case "ifThenElse": {
        // A cut inside the condition is local to it; once the condition succeeds,
        // cutTo removes its remaining choices and the else branch.
        const height = choices.length;
        choices.push({ kind: "alt", s, cont: goalFrame(node.else, barrier, false, cont) });
        cont = goalFrame(
          node.cond,
          choices.length,
          false,
          { frame: { kind: "cutTo", height }, next: goalFrame(node.then, barrier, false, cont) },
        );
        break;
      }
      case "freshIn": {
        const vars = Array.from({ length: node.body.length }, (_, i) => new Var(s.next + i));
        s = { ...s, next: s.next + vars.length };
        cont = goalFrame(node.body(...vars), barrier, clause, cont);
        break;
      }
      case "gen": {
        const run: GenRun = { body: node.body, it: node.body(), at: null };
        advance(run, null, run.it.next(), clause ? barrier : choices.length);
        break;
      }
      case "table": {
        const { space, args } = node;
        let tables = ctx.tables.get(space);
        if (!tables) ctx.tables.set(space, (tables = new Map()));
        const key = keyOf(canonical(args, s.subst));
        let entry = tables.get(key);
        if (!entry) {
          entry = { answers: [], seen: new Set(), state: "new", pos: -1, low: -1, epoch: -1 };
          tables.set(key, entry);
        }
        const top = ctx.stack.at(-1);
        if (entry.state === "evaluating") top!.low = Math.min(top!.low, entry.pos);
        else if (entry.state === "incomplete" && entry.epoch === ctx.epoch) top!.low = Math.min(top!.low, entry.low);
        else if (entry.state !== "complete") evaluate(entry, space, args, s, ctx);
        choices.push({ kind: "answers", answers: consume(entry, args, s), cont });
        failing = true;
        break;
      }
    }
  }
}

/** `?- goal.`: a lazy Backtrack of answers for the query variable(s), in Prolog's order. */
export const query = (goal: (...vars: Var[]) => Goal<unknown>): Backtrack<any> => {
  const vars = Array.from({ length: Math.max(goal.length, 1) }, (_, i) => new Var(i));
  return new Backtrack(function* () {
    const ctx: Context = { tables: new Map(), stack: [], pending: [], added: 0, epoch: 0 };
    for (const { s } of solve(goal(...vars), { subst: emptySubst, next: vars.length }, ctx)) {
      yield vars.length === 1 ? reify(vars[0]!, s.subst) : vars.map((v) => reify(v, s.subst));
    }
  });
};
