import { grandparent } from "./grandparent";
import { queens } from "./nqueens";

console.log(grandparent("Anne").toArray());

const solutions = queens(8);
const results = solutions.iterate();
console.log(results.next().value);
results.return(undefined);
console.log(solutions.toArray().length);
