import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";
import type { ActionRunner } from "./useAction";
import "./inlineconfirm.css";

interface Props {
  /** the question, like "Delete this application?" */
  title: string;
  /** what will happen, one sentence */
  help?: string;
  /** the button that goes ahead, like "Delete the application and its emails" */
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
  /** the action runner and the key of the action the confirm button starts: both buttons are held while it runs */
  act: ActionRunner;
  actionKey: string;
  /** the control that opened the question, so focus goes back to it on cancel; defaults to whatever had focus when this appeared */
  opener?: HTMLElement | null;
  /** another way to go ahead, shown between the two buttons */
  children?: ReactNode;
  /** the confirm button, so a caller can put focus back on it when the action fails */
  confirmRef?: Ref<HTMLButtonElement>;
  id?: string;
}

/**
 * The question in place before something is removed, instead of a browser dialog. Focus starts on Cancel, so a stray Enter never
 * deletes anything. Escape (or Cancel) closes it and puts focus back on the control that opened it. What happens after
 * a confirm is the caller's: it takes this away and says what happened.
 */
export function InlineConfirm({ title, help, confirmLabel, onConfirm, onCancel, act, actionKey, opener, children, confirmRef, id }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  const was = useRef<Element | null>(opener ?? document.activeElement);
  const titleId = useId();
  useEffect(() => cancel.current?.focus(), []);

  const close = () => {
    onCancel();
    const back = opener ?? was.current;
    if (back instanceof HTMLElement && back !== document.body) back.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    // Escape can't call off an action that is already running.
    if (e.key !== "Escape" || act.busy !== null) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  return (
    <div className="inline-confirm" role="group" id={id} aria-labelledby={titleId} onKeyDown={onKey}>
      <p id={titleId} className="inline-confirm-q">{title}</p>
      {help ? <p className="help">{help}</p> : null}
      <div className="row">
        <button type="button" className="danger" ref={confirmRef} onClick={onConfirm} {...act.button(actionKey)}>{confirmLabel}</button>
        {children}
        <button type="button" ref={cancel} onClick={close} disabled={act.busy !== null}>Cancel</button>
      </div>
    </div>
  );
}
