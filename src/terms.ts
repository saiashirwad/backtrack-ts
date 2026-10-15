export class Var {
  readonly id: number;

  constructor(id: number) {
    this.id = id;
  }
}

export class Cons {
  readonly head: Term;
  readonly tail: Term;

  constructor(head: Term, tail: Term) {
    this.head = head;
    this.tail = tail;
  }
}

export type Term = string | number | boolean | null | Var | Cons | readonly Term[];

// Persistent map from variable id to term: a 32-way trie keyed by the id's bits.
// Variable ids are small dense integers, so updates copy only O(log32 n) nodes.
type Trie = readonly (Term | Trie | undefined)[];
export type Subst = { readonly root: Trie; readonly depth: number };

const BITS = 5;
const WIDTH = 1 << BITS;
const MASK = WIDTH - 1;
export const emptySubst: Subst = { root: [], depth: 1 };

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

export const walk = (t: Term, subst: Subst): Term => {
  for (let bound; t instanceof Var && (bound = lookup(subst, t.id)) !== undefined; ) t = bound;
  return t;
};

const children = (t: Term): readonly Term[] | null =>
  t instanceof Cons ? [t.head, t.tail] : Array.isArray(t) ? t : null;

// Bottom-up fold over a fully walked term. It keeps an explicit stack instead of
// recursing, so term depth (e.g. s(s(s(...)))) is limited by memory, not the JS stack.
// `leaf` sees non-compound terms left to right.
export const fold = <R>(
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

export const unify = (a: Term, b: Term, subst: Subst): Subst | null => {
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

export const rebuild = (t: Term, kids: Term[]): Term => (t instanceof Cons ? new Cons(kids[0]!, kids[1]!) : kids);

export const list = (...xs: Term[]): Term => xs.reduceRight<Term>((tail, head) => new Cons(head, tail), []);

// Fully walk `t`, renaming its unbound variables to placeholders -1, -2, ... in
// order of appearance, so variant terms (equal up to renaming) come out identical.
export const canonical = (t: Term, subst: Subst): Term => {
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
export const keyOf = (t: Term): string => {
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
export const instantiate = (t: Term, next: number): [Term, number] => {
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

// A reified list under construction: elements are pushed from the last to the
// first as fold climbs back up the cons cells.
class PartialList {
  readonly reversed: unknown[];
  readonly tail: unknown;

  constructor(reversed: unknown[], tail: unknown) {
    this.reversed = reversed;
    this.tail = tail;
  }
}

const finish = (x: unknown): unknown => {
  if (!(x instanceof PartialList)) return x;
  const items = x.reversed.reverse();
  return Array.isArray(x.tail) && x.tail.length === 0 ? items : [...items, "|", x.tail];
};

// Convert a term to plain data: proper lists become arrays, unbound variables `_n`.
export const reify = (t: Term, subst: Subst): unknown =>
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
