"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/lib/use-debounced-value";

/** Text input that reports its trimmed value once typing pauses (not on every keystroke). */
export function SearchField({
  value,
  onSearch,
  unstyled = false,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue"> & {
  value: string;
  onSearch: (text: string) => void;
  /** Plain <input> styled only by className. */
  unstyled?: boolean;
}) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text);
  const report = useRef(onSearch);
  const current = useRef(value);
  report.current = onSearch;
  current.current = value;

  useEffect(() => {
    setText((typed) => (typed.trim() === value.trim() ? typed : value));
  }, [value]);

  useEffect(() => {
    if (debounced.trim() !== current.current.trim()) report.current(debounced.trim());
  }, [debounced]);

  return unstyled ? (
    <input {...props} value={text} onChange={(event) => setText(event.target.value)} />
  ) : (
    <Input {...props} value={text} onChange={(event) => setText(event.target.value)} />
  );
}
