export const LOGIN_ERROR_CODES = [
  "invalidCredentials",
  "weakPassword",
  "emailTaken",
  "emailNotConfirmed",
  "rateLimited",
  "network",
  "unknown",
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; name?: unknown };

const isErrorLike = (value: unknown): value is ErrorLike =>
  typeof value === "object" && value !== null;

/** Maps supabase-js auth errors (and fetch failures) to dictionary keys; never exposes raw text. */
export function mapAuthError(error: unknown): LoginErrorCode {
  if (!isErrorLike(error)) return "unknown";
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  const name = typeof error.name === "string" ? error.name : "";
  const status = typeof error.status === "number" ? error.status : null;

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "invalidCredentials";
  }
  if (code === "weak_password" || message.includes("password should be") || message.includes("weak password")) {
    return "weakPassword";
  }
  if (code === "user_already_exists" || code === "email_exists" || message.includes("already registered")) {
    return "emailTaken";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "emailNotConfirmed";
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429) {
    return "rateLimited";
  }
  if (
    name === "AuthRetryableFetchError" ||
    status === 0 ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("fetch failed")
  ) {
    return "network";
  }
  return "unknown";
}
