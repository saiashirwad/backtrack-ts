type Board = readonly number[];

const isSafe = (col: number, placed: Board) =>
  placed.every((prevCol, idx) => col !== prevCol && Math.abs(col - prevCol) !== idx + 1);

function* queensNative(n: number): Generator<readonly number[]> {
  function* placeQueen(row: number, placed: readonly number[]): Generator<readonly number[]> {
    if (row > n) {
      yield placed;
      return;
    }

    for (let col = 1; col <= n; col++) {
      if (!isSafe(col, placed)) continue;
      yield* placeQueen(row + 1, [col, ...placed]);
    }
  }

  yield* placeQueen(1, []);
}

const solver = queensNative(8);
console.log("First solution:", solver.next().value);
