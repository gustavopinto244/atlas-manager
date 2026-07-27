export class ServiceLogTailLinesValidationError extends Error {
  public static readonly MIN_TAIL_LINES = 1;
  public static readonly MAX_TAIL_LINES = 500;
  public static readonly DEFAULT_TAIL_LINES = 100;

  public constructor(message?: string) {
    super(
      message ??
        `tailLines must be between ${ServiceLogTailLinesValidationError.MIN_TAIL_LINES} and ${ServiceLogTailLinesValidationError.MAX_TAIL_LINES}`,
    );
    this.name = "ServiceLogTailLinesValidationError";
    Object.freeze(this);
  }
}

export function validateTailLines(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < ServiceLogTailLinesValidationError.MIN_TAIL_LINES ||
    value > ServiceLogTailLinesValidationError.MAX_TAIL_LINES
  ) {
    throw new ServiceLogTailLinesValidationError();
  }
}

export function defaultTailLines(): number {
  return ServiceLogTailLinesValidationError.DEFAULT_TAIL_LINES;
}
