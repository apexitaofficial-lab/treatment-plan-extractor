"use client";

import { useActionState, useEffect, useRef } from "react";
import { AlertIcon } from "@/components/icons";
import { login } from "../actions";

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(login, undefined);
  const passwordRef = useRef<HTMLInputElement>(null);

  // After a failed attempt the username is kept, so move the cursor to the password.
  useEffect(() => {
    if (state?.error) passwordRef.current?.focus();
  }, [state]);

  return (
    <form action={formAction} className="login-form">
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          defaultValue={state?.username}
          autoComplete="username"
          required
          autoFocus
          aria-invalid={state?.error ? true : undefined}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          ref={passwordRef}
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? "login-error" : undefined}
        />
      </div>
      {state?.error && (
        <p className="alert" id="login-error" role="alert">
          <AlertIcon size={16} />
          {state.error}
        </p>
      )}
      <button type="submit" className="btn primary block" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
