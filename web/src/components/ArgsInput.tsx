import { useEffect, useState, type InputHTMLAttributes } from "react";

function splitArgs(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function sameArgs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * A space-separated argument list. The text is kept as typed: rebuilding it from the parsed list
 * on every keystroke ate the space just typed, so a second argument could only be pasted.
 */
export function ArgsInput({
  value,
  onChange,
  ...rest
}: { value: readonly string[]; onChange: (args: string[]) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  const [text, setText] = useState(() => value.join(" "));
  /* Follow a change from outside (Discard, another adapter) without undoing what is being typed. */
  useEffect(() => {
    setText((current) => (sameArgs(splitArgs(current), value) ? current : value.join(" ")));
  }, [value]);
  return (
    <input
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitArgs(e.target.value));
      }}
    />
  );
}
