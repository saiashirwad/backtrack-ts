# backtrack-ts

Prolog-style logic programming in TypeScript: unification, relations that run in any direction, fair search, and tabling.

```ts
import { Goal, eq, facts, fresh, query, value, type Term } from "backtrack-ts";

const parent = facts([
  ["Sarah", "John"],
  ["Arnold", "John"],
  ["John", "Anne"],
  ["Anne", "Mia"],
]);

const born = facts([
  ["Sarah", 1940],
  ["Arnold", 1938],
  ["John", 1965],
  ["Anne", 1990],
  ["Mia", 2020],
]);

// A goal can return a JavaScript value: here, a person's birth year.
const birthYear = (person: Term) =>
  Goal.gen(function* () {
    const year = yield* fresh();
    yield* born(person, year);
    return (yield* value(year)) as number;
  });

// G is X's grandparent, born Gap years earlier.
const grandparent = (g: Term, x: Term, gap: Term) =>
  Goal.gen(function* () {
    const p = yield* fresh(); // a logic variable, shared by the next two goals
    yield* parent(g, p);
    yield* parent(p, x);
    const years = (yield* birthYear(x)) - (yield* birthYear(g));
    yield* eq(gap, years);
  });

query((g, x, gap) => grandparent(g, x, gap)).toArray();
// [["Sarah", "Anne", 50], ["Arnold", "Anne", 52], ["John", "Mia", 55]]

query((g) => grandparent(g, "Anne", 52)).toArray();
// ["Arnold"]
```

Each `yield*` hands its result back to JavaScript: `fresh()` gives a variable to reuse in later goals, and `value()` reads a binding so ordinary code can compute with it.

## API

| Function | Prolog |
|---|---|
| `fresh()` in `Goal.gen`, or `fresh((x, y) => goal)` | clause variables |
| `eq(a, b)` | `A = B` |
| `Goal.gen(function* () {...})`, `conj(g1, g2)` | `,` |
| `oneOf(g1, g2)` | multiple clauses, `;` |
| `facts(rows)` | facts |
| `value(t)` | reading a binding, as in `is` |
| `table(relation)` | `:- table` |
| `fail` | `fail` |
| `query((q, ...) => goal)` | `?- goal.` |

- Terms are strings, numbers, booleans, `null`, variables, tuples (arrays), and lists (`list(...)`, `new Cons(head, tail)`).
- Unification includes the occurs check.
- Search is fair, so an infinite branch never hides other answers, and deep recursion doesn't grow the JS stack.
- `table` makes left-recursive relations over cyclic data terminate.
- `query` returns a lazy `Backtrack`, the generator-based search monad this library is built on, also exported (`backtrack-ts/eager` has an eager variant).

More examples (`append`, `member`, Peano arithmetic, tabled `path`, map coloring) are in [`examples/relations.ts`](examples/relations.ts).

## Development

```sh
bun test           # property tests
bun run examples   # print the examples
bun run build      # emit dist/
bun run bench      # benchmarks
bun run mutate     # mutation testing
```
