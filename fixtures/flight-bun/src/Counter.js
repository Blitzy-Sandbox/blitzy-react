'use client';

import * as React from 'react';

/**
 * Counter — Client Component demonstrating client-side state management.
 *
 * Uses React.useState to maintain a numeric counter with increment and
 * decrement buttons. This verifies that Client Components hydrate correctly
 * in the Bun Flight fixture and that interactive state persists after
 * server-side rendering.
 */
export function Counter() {
  const [count, setCount] = React.useState(0);

  return (
    <div>
      <h2>Counter</h2>
      <button onClick={() => setCount(c => c - 1)}>-</button>
      <span data-testid="counter-value">{count}</span>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}
