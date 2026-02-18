import * as React from 'react';

import Layout from './Layout.js';
import {Counter} from './Counter.js';
import Form from './Form.js';
import {Navigation} from './Navigation.js';
import {getTodos} from './data.js';
import {addTodo, greet} from './actions.js';

/**
 * DeferredMessage — Async Server Component
 *
 * Wraps a deferred promise that resolves after a short delay to demonstrate
 * React Suspense streaming boundaries. When used inside a <Suspense> boundary,
 * the server streams the fallback immediately and flushes the resolved content
 * once the promise settles.
 */
async function DeferredMessage() {
  const message = await new Promise(resolve =>
    setTimeout(() => resolve('Loaded!'), 100)
  );
  return <p data-testid="deferred-message">{message}</p>;
}

/**
 * App — Root Server Component
 *
 * This is the top-level async Server Component for the Bun Flight fixture.
 * It demonstrates core React Server Components capabilities:
 *
 * - Async Server Component with synchronous in-memory data fetching
 * - Suspense boundaries for streaming deferred content
 * - Client Component integration (Counter, Form, Navigation)
 * - Server Actions passed as props to Client Components (greet → Form)
 * - Native form action binding (addTodo → <form action={addTodo}>)
 * - Nested layout composition via the Layout Server Component
 *
 * The component reads directly from the in-memory data store (data.js)
 * rather than fetching over HTTP, keeping the fixture simple and self-contained.
 */
export default async function App() {
  const todos = getTodos();

  return (
    <Layout>
      <section data-testid="app-content">
        <h2>Welcome to Flight on Bun</h2>

        {/* Suspense boundary wrapping deferred async content */}
        <React.Suspense fallback={<p>Loading deferred content...</p>}>
          <DeferredMessage />
        </React.Suspense>

        {/* Client Component: interactive counter with useState */}
        <Counter />

        {/* Server-rendered todo list from in-memory data store */}
        <section data-testid="todo-section">
          <h3>Todos</h3>
          <ul data-testid="todo-list">
            {todos.map(todo => (
              <li key={todo.id}>{todo.text}</li>
            ))}
          </ul>

          {/* Native form with Server Action for adding todos */}
          <form action={addTodo}>
            <input
              name="text"
              placeholder="New todo..."
              data-testid="add-todo-input"
            />
            <button type="submit" data-testid="add-todo-button">
              Add Todo
            </button>
          </form>
        </section>

        {/* Client Component: form with Server Action via useActionState */}
        <Form action={greet} />

        {/* Client Component: transition-based navigation */}
        <Navigation />

        {/* Second Suspense boundary to demonstrate streaming multiple boundaries */}
        <React.Suspense fallback={<p>Loading more content...</p>}>
          <footer data-testid="app-footer">
            <p>Powered by React Server Components on Bun</p>
          </footer>
        </React.Suspense>
      </section>
    </Layout>
  );
}
