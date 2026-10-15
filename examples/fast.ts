function* queens(n: number, placed: readonly number[] = []): Generator<readonly number[]> {
  if (placed.length === n) {
    yield placed;
    return;
  }
  for (let col = 1; col <= n; col++) {
    if (placed.every((prev, i) => col !== prev && Math.abs(col - prev) !== i + 1)) {
      yield* queens(n, [col, ...placed]);
    }
  }
}

console.log("First solution:", queens(8).next().value);
