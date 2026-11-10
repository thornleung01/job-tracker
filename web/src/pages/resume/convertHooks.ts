// The two things the convert panel does besides showing text: unlock a locked key, and run (and stop) one conversion. Each is a hook so the panel
// only lays out what they return.
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AiDeps } from "../../ai";
import { messageFor } from "../../components/useAction";
import type { ConvertResult, convertResume } from "../../sync/convert";

/** The passphrase form for a locked key. `onUnlocked` runs when the key opened. */
export function useUnlockForm(vault: AiDeps["vault"], db: string, onUnlocked: () => void) {
  const [passphraseInput, setPassphraseInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  // Unlocking can't be cancelled, so a result that arrives after the panel went away is ignored with this.
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
    if (unlocking || !passphraseInput) return;
    setUnlocking(true);
    setError(null);
    try {
      await vault.unlock(db, passphraseInput);
      if (mounted.current) onUnlocked();
    } catch (err) {
      if (mounted.current) setError(messageFor(err));
    } finally {
      if (mounted.current) {
        setPassphraseInput("");   // never keep it around after it has been used
        setUnlocking(false);
      }
    }
  };
  return { passphraseInput, setPassphraseInput, unlocking, error, field, submit };
}

/**
 * One conversion at a time, which Stop (or leaving the page) can cancel. Whether a result is still wanted is answered in one place: the
 * request's own signal. Stop and unmount both abort it, so a result or an error that arrives after either is dropped without a word.
 * `onFailed` runs after a failure, so the panel can re-read the key (it may have been locked from elsewhere since the panel opened).
 */
export function useConvertRun(
  convert: typeof convertResume, ai: AiDeps, db: string, text: string, disabled: boolean,
  onConverted: (result: ConvertResult) => void, onFailed: () => void,
) {
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);
  const convertButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => running.current?.abort(), []);

  // Convert is disabled while it works, which drops focus to the page: Stop takes it, and when the run ends it goes back to Convert.
  // Only when nothing else has focus, so someone who moved on isn't pulled back.
  const wasConverting = useRef(false);
  useEffect(() => {
    const idle = document.activeElement === null || document.activeElement === document.body;
    if (converting && !wasConverting.current && (idle || document.activeElement === convertButton.current)) stopButton.current?.focus();
    else if (!converting && wasConverting.current && idle) convertButton.current?.focus();
    wasConverting.current = converting;
  }, [converting]);

  const start = () => {
    // The ref, not the state: two clicks in the same moment both see `converting` as false.
    if (running.current || disabled) return;
    const ask = new AbortController();
    running.current = ask;
    setError(null);
    setConverting(true);
    convert(text, ai, { db, signal: ask.signal }).then(
      (result) => {
        if (ask.signal.aborted) return;
        running.current = null;
        setConverting(false);
        onConverted(result);
      },
      (e) => {
        if (ask.signal.aborted) return;   // Stop is not a failure: back to the panel with nothing said
        running.current = null;
        setConverting(false);
        setError(messageFor(e));
        onFailed();
      },
    );
  };
  const stop = () => {
    running.current?.abort();
    running.current = null;
    setConverting(false);
  };
  return { converting, error, start, stop, convertButton, stopButton };
}
