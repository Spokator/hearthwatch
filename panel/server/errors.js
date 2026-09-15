export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function fail(statusCode, message) {
  throw new HttpError(statusCode, message);
}
