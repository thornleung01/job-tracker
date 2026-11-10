// The passphrase form for a locked key, for the places that unlock it in place (the Tailor workspace's AI strip). It is the same behaviour as the
// Resume page's convert panel (pages/resume/convertHooks.ts, which a component can't import).
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AiDeps } from "../../ai";
import { messageFor } from "../useAction";

/** `onUnlocked` runs when the key opened. The passphrase is cleared as soon as it has been used. */
export function useUnlock(vault: AiDeps["vault"], db: string, onUnlocked: () => void) {
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  // Unlocking can't be cancelled, so a result that arrives after the strip went away is ignored with this.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // After a wrong one the field is where to try again.
  useEffect(() => {
    if (error) field.current?.focus();
  }, [error]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (unlocking || !passphrase) return;
    setUnlocking(true);
    setError(null);
    try {
      await vault.unlock(db, passphrase);
      if (mounted.current) onUnlocked();
    } catch (err) {
      if (mounted.current) setError(messageFor(err));
    } finally {
      if (mounted.current) {
        setPassphrase("");
        setUnlocking(false);
      }
    }
  };
  return { passphrase, setPassphrase, unlocking, error, field, submit };
}
