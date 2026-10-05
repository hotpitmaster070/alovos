"use client";

import { useContext } from "react";
import { I18nContext, type I18nValue } from "./context";

export function useT(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useT must be used inside <I18nProvider>");
  return value;
}
