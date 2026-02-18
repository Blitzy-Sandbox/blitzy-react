'use server';

import {addItem} from './data.js';

/**
 * Server Action: greet
 *
 * Processes a greeting form submission. Reads the 'name' field from the
 * submitted FormData, simulates a short network delay to demonstrate async
 * Server Action behaviour, and returns a greeting string.
 *
 * Used with `useActionState` in Form.js — the signature (prevState, formData)
 * is required by the useActionState contract.
 *
 * @param {string|null} prevState  Previous state value from useActionState (may be null on first call).
 * @param {FormData}    formData   Form data submitted by the client.
 * @returns {Promise<string>}      A greeting message incorporating the submitted name.
 */
export async function greet(prevState, formData) {
  const name = formData.get('name') || 'World';
  // Simulate a short network delay to demonstrate async Server Action flow
  await new Promise(resolve => setTimeout(resolve, 500));
  return 'Hello, ' + name + '!';
}

/**
 * Server Action: addTodo
 *
 * Processes a todo creation form submission. Reads the 'text' field from
 * the submitted FormData and, if non-empty, delegates to the in-memory
 * data store's addItem function to persist a new todo.
 *
 * After mutation the RSC runtime will re-render the Server Component tree,
 * automatically reflecting the new item on the client.
 *
 * @param {FormData} formData  Form data submitted by the client.
 * @returns {Promise<void>}
 */
export async function addTodo(formData) {
  const text = formData.get('text');
  if (text) {
    addItem(text);
  }
}
