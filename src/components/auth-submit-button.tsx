"use client";

import { useFormStatus } from "react-dom";

export function AuthSubmitButton({ idle, pending }: { idle: string; pending: string }) {
  const status = useFormStatus();
  return <button className="button" type="submit" disabled={status.pending}>{status.pending ? pending : idle}</button>;
}
