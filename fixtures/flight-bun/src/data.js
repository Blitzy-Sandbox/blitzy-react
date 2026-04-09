/**
 * In-memory mock data store for the flight-bun fixture.
 *
 * Provides initial todo data and CRUD mutation functions used by
 * Server Components (reads) and Server Actions (mutations).
 * Module-scoped state persists across requests during server lifetime.
 * No external database dependency.
 */

// Initial seed data — meaningful todo items for the RSC demo.
let todos = [
  {id: 1, text: 'Learn React Server Components'},
  {id: 2, text: 'Try Flight on Bun'},
  {id: 3, text: 'Build something awesome'},
];

// Auto-incrementing ID counter, starts after the last seed item.
let nextId = 4;

/**
 * Returns the current list of all todos.
 * @returns {Array<{id: number, text: string}>} The todos array.
 */
export function getTodos() {
  return todos;
}

/**
 * Returns a single todo by its ID.
 * @param {number} id - The ID of the todo to find.
 * @returns {{id: number, text: string} | null} The matching todo, or null if not found.
 */
export function getTodoById(id) {
  return todos.find(todo => todo.id === id) || null;
}

/**
 * Creates a new todo item and appends it to the store.
 * @param {string} text - The text content for the new todo.
 * @returns {{id: number, text: string}} The newly created todo.
 */
export function addItem(text) {
  const todo = {id: nextId++, text};
  todos.push(todo);
  return todo;
}

/**
 * Removes a todo item from the store by its ID.
 * @param {number} id - The ID of the todo to remove.
 */
export function removeItem(id) {
  todos = todos.filter(todo => todo.id !== id);
}

/**
 * Updates the text of an existing todo item by its ID.
 * @param {number} id - The ID of the todo to update.
 * @param {string} text - The new text content.
 * @returns {{id: number, text: string} | null} The updated todo, or null if not found.
 */
export function updateItem(id, text) {
  const todo = todos.find(t => t.id === id);
  if (todo) {
    todo.text = text;
  }
  return todo || null;
}
