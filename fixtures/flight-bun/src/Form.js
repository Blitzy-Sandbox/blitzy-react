'use client';

import * as React from 'react';
import {useFormStatus} from 'react-dom';

function Status() {
  const {pending} = useFormStatus();
  return pending ? 'Saving...' : null;
}

export default function Form({action}) {
  const [result, formAction, isPending] = React.useActionState(action, null);

  return (
    <div>
      <form action={formAction}>
        <label>
          Name: <input name="name" data-testid="form-name-input" />
        </label>
        <button data-testid="form-submit">Say Hi</button>
        <Status />
      </form>
      {result !== null ? <p data-testid="form-result">{result}</p> : null}
    </div>
  );
}
