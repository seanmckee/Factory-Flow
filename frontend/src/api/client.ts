export const API_BASE = "http://localhost:3000";

/** Carries the status and parsed body so callers can branch on a 409 rather than
    just toasting the message. Still an Error, so `instanceof Error` catches hold. */
export class ApiError extends Error {
  status: number;
  payload: unknown;

  // erasableSyntaxOnly bans constructor parameter properties, so assign fields
  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

/** Built and returned rather than thrown, so the throw stays at the call site. */
async function apiError(
  response: Response,
  fallback: string,
): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // non-JSON body
  }

  const message =
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof (payload as { message: unknown }).message === "string"
      ? (payload as { message: string }).message
      : fallback;

  return new ApiError(response.status, message, payload);
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw await apiError(response, `Failed to load ${path}`);
  return response.json();
}

/**
 * The API reports validation failures as 400 { message }, so surface that text
 * rather than a generic error - it's what the user sees in the toast.
 */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await apiError(response, "Request failed");
  return response.json();
}

export async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!response.ok) throw await apiError(response, "Request failed");
  return response.json();
}

export type DeleteConflict = {
  message: string;
  requiresConfirmation: true;
  allocations: { orderNumber: string; quantity: number }[];
};

/**
 * A delete refused because the record still has allocations. Checks the payload
 * flag, not just the status, so an unrelated future 409 can't open the dialog.
 */
export function deleteConflict(error: unknown): DeleteConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const payload = error.payload as DeleteConflict | null;
  return payload?.requiresConfirmation ? payload : null;
}
