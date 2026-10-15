import { grandparent } from "./grandparent";
import { queens } from "./nqueens";
import { append, grandparent as grandparentRelation, path } from "./relations";
import { list, query } from "./unify";

console.log(grandparent("Anne").toArray());

const solutions = queens(8);
const results = solutions.iterate();
console.log(results.next().value);
results.return(undefined);
console.log(solutions.toArray().length);

console.log(query((q) => grandparentRelation(q, "Anne")).toArray());
console.log(query((q) => grandparentRelation("Sarah", q)).toArray());
console.log(query((x, y) => append(x, y, list(1, 2, 3))).toArray());
console.log(query((z) => path("a", z)).toArray());
