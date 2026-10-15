import { grandparent } from "./grandparent.ts";
import { queens } from "./nqueens.ts";
import {
  ancestor, append, australia, fromPeano, grandparent as grandparentRelation, length, member, path, peano, plus,
  pythagorean,
} from "./relations.ts";
import { list, query } from "../src/unify.ts";

console.log(grandparent("Anne").toArray());

const solutions = queens(8);
const results = solutions.iterate();
console.log(results.next().value);
results.return(undefined);
console.log(solutions.toArray().length);

console.log(query((q) => grandparentRelation(q, "Anne")).toArray());
console.log(query((q) => grandparentRelation("Sarah", q)).toArray());
console.log(query((a) => ancestor(a, "Anne")).toArray());
console.log(query((x, y) => append(x, y, list(1, 2, 3))).toArray());
console.log(query((q) => member(q, list("a", "b"))).toArray());
console.log(query((n) => length(list("a", "b", "c"), n)).toArray());
console.log(query((a, b) => plus(a, b, peano(2))).toArray().map(([a, b]) => [fromPeano(a), fromPeano(b)]));
console.log(query((a, b, c) => pythagorean(15, a, b, c)).toArray());
console.log(query((z) => path("a", z)).toArray());
console.log(query((wa, nt, sa, q, nsw, v) => australia(wa, nt, sa, q, nsw, v)).toArray().length);
