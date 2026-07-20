export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);

    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new RangeError(
        "HTTP error status must be an integer from 400 to 599",
      );
    }

    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
