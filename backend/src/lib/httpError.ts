/**
 * Error carrying an HTTP status, so helpers called from inside a
 * db.transaction() callback can reject with a specific status. Throwing from
 * the callback is what rolls the transaction back.
 */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
