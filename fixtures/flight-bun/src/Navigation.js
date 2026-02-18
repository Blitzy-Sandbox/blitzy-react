'use client';

import * as React from 'react';

/**
 * Navigation — Client Component demonstrating transition-based navigation.
 *
 * Uses React.useTransition() to wrap path state updates so that route changes
 * are treated as non-urgent transitions, keeping the UI responsive while the
 * server prepares the next view.  A pending indicator is rendered while the
 * transition is in flight, giving users immediate visual feedback.
 *
 * data-testid attributes are included on every interactive element and the
 * pending indicator so that Playwright E2E tests can locate them reliably.
 */
export function Navigation() {
  const [isPending, startTransition] = React.useTransition();
  const [path, setPath] = React.useState('/');

  /**
   * Trigger a transition-based navigation to `newPath`.
   *
   * Wrapping the state update in `startTransition` marks it as a non-urgent
   * update — React will keep the current UI visible (and show the pending
   * indicator) until the transition completes, which is essential for smooth
   * RSC streaming experiences.
   */
  function navigate(newPath) {
    startTransition(() => {
      setPath(newPath);
    });
  }

  return (
    <nav data-testid="navigation">
      <p>Current: {path}</p>
      <button onClick={() => navigate('/')} data-testid="nav-home">
        Home
      </button>
      <button onClick={() => navigate('/about')} data-testid="nav-about">
        About
      </button>
      <button onClick={() => navigate('/contact')} data-testid="nav-contact">
        Contact
      </button>
      {isPending ? (
        <span data-testid="nav-pending">Navigating...</span>
      ) : null}
    </nav>
  );
}
