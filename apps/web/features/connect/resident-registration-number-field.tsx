"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import styles from "./byus-day-screen.module.css";

type Props = {
  label: string;
  requiredLabel: string;
  partLabels: readonly [string, string, string];
  showLabel: string;
  hideLabel: string;
  help: string;
  error?: string;
};

/** Native inputs preserve editing, selection and mobile keyboards while masking only the last six digits. */
export function ResidentRegistrationNumberField({ label, requiredLabel, partLabels, showLabel, hideLabel, help, error }: Props) {
  const [parts, setParts] = useState<[string, string, string]>(["", "", ""]);
  const [revealed, setRevealed] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const lengths = [6, 1, 6];
  const value = parts.some(Boolean) ? `${parts[0]}-${parts[1]}${parts[2]}` : "";
  const describedBy = ["rsvp-registration-number-help", error ? "rsvp-residentRegistrationNumber-error" : ""].filter(Boolean).join(" ");

  function changePart(index: number, value: string, atEnd: boolean) {
    const digits = value.replace(/\D/g, "").slice(0, lengths[index]);
    setParts(previous => previous.map((part, i) => i === index ? digits : part) as typeof parts);
    if (atEnd && digits.length === lengths[index] && parts[index].length < lengths[index]) inputs.current[index + 1]?.focus();
  }

  function paste(event: ClipboardEvent<HTMLInputElement>, index: number) {
    const pasted = event.clipboardData.getData("text/plain").trim();
    if (/^\d{6}-?\d{7}$/.test(pasted)) {
      event.preventDefault();
      const digits = pasted.replace("-", "");
      setParts([digits.slice(0, 6), digits.slice(6, 7), digits.slice(7)]);
      inputs.current[2]?.focus();
    } else if (index === 1 && /^\d{7}$/.test(pasted)) {
      event.preventDefault();
      setParts(previous => [previous[0], pasted[0], pasted.slice(1)]);
      inputs.current[2]?.focus();
    }
  }

  function move(event: KeyboardEvent<HTMLInputElement>, index: number) {
    const input = event.currentTarget;
    if (input.selectionStart !== input.selectionEnd) return;
    const backwards = input.selectionStart === 0 && (event.key === "ArrowLeft" || event.key === "Backspace");
    const forwards = input.selectionEnd === input.value.length && event.key === "ArrowRight";
    const next = inputs.current[index + (backwards ? -1 : forwards ? 1 : 0)];
    if ((!backwards && !forwards) || !next) return;
    event.preventDefault();
    next.focus();
    const position = backwards ? next.value.length : 0;
    next.setSelectionRange(position, position);
  }

  return <div className={styles.field}>
    <label htmlFor="rsvp-residentRegistrationNumber">{label}<span className={styles.fieldRequired} aria-hidden="true">{requiredLabel}</span></label>
    <div className={styles.registrationNumber} data-invalid={error ? "true" : undefined}>
      {parts.map((part, index) => <span key={index} className={styles.registrationPart}>
        {index === 1 && <span className={styles.registrationSeparator} aria-hidden="true">−</span>}
        <input ref={element => { inputs.current[index] = element; }} id={index === 0 ? "rsvp-residentRegistrationNumber" : `rsvp-registration-part-${index}`}
          aria-label={partLabels[index]} required type={index === 2 && !revealed ? "password" : "text"} inputMode="numeric"
          autoComplete="off" spellCheck={false} maxLength={lengths[index]} pattern={`[0-9]{${lengths[index]}}`} value={part}
          placeholder={index === 0 ? "000000" : index === 1 ? "0" : "000000"} aria-invalid={error ? true : undefined} aria-describedby={describedBy}
          className={index === 1 ? styles.registrationFirstDigit : styles.registrationSixDigits}
          onChange={event => changePart(index, event.currentTarget.value, event.currentTarget.selectionStart === event.currentTarget.value.length)}
          onPaste={event => paste(event, index)} onKeyDown={event => move(event, index)} />
      </span>)}
      <button type="button" className={styles.registrationVisibility} onClick={() => setRevealed(previous => !previous)} aria-label={revealed ? hideLabel : showLabel} aria-pressed={revealed}>
        {revealed ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
      </button>
    </div>
    <input type="hidden" name="residentRegistrationNumber" value={value} />
    <p id="rsvp-registration-number-help" className={styles.hint}>{help}</p>
    {error && <p id="rsvp-residentRegistrationNumber-error" className={styles.fieldError}>{error}</p>}
  </div>;
}
