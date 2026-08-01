export interface AdministrativeRequestClock {
  now(): Date;
}

export interface AdministrativeRequestAdmission {
  tryAdmit(): (() => void) | undefined;
}

export class FixedAdministrativeRequestAdmission implements AdministrativeRequestAdmission {
  readonly #clock: AdministrativeRequestClock;
  readonly #windowMs: number;
  readonly #maximumRequests: number;
  readonly #maximumConcurrent: number;
  #windowStartedAt: number | undefined;
  #admittedInWindow = 0;
  #active = 0;

  public constructor(
    clock: AdministrativeRequestClock,
    configuration: Readonly<{
      readonly windowMs?: number;
      readonly maximumRequests?: number;
      readonly maximumConcurrent?: number;
    }> = {},
  ) {
    if (
      Reflect.ownKeys(configuration).some(
        (key) =>
          key !== "windowMs" &&
          key !== "maximumRequests" &&
          key !== "maximumConcurrent",
      )
    )
      throw new Error("Invalid administrative request admission configuration");
    this.#clock = clock;
    this.#windowMs = configuration.windowMs ?? 60_000;
    this.#maximumRequests = configuration.maximumRequests ?? 60;
    this.#maximumConcurrent = configuration.maximumConcurrent ?? 4;
    if (
      !Number.isSafeInteger(this.#windowMs) ||
      this.#windowMs < 1 ||
      !Number.isSafeInteger(this.#maximumRequests) ||
      this.#maximumRequests < 1 ||
      !Number.isSafeInteger(this.#maximumConcurrent) ||
      this.#maximumConcurrent < 1
    )
      throw new Error("Invalid administrative request admission configuration");
    Object.freeze(this);
  }

  public tryAdmit(): (() => void) | undefined {
    if (this.#active >= this.#maximumConcurrent) return undefined;
    const now = this.#clock.now().getTime();
    if (!Number.isFinite(now)) return undefined;
    if (
      this.#windowStartedAt === undefined ||
      now - this.#windowStartedAt >= this.#windowMs
    ) {
      this.#windowStartedAt = now;
      this.#admittedInWindow = 0;
    }
    if (this.#admittedInWindow >= this.#maximumRequests) return undefined;
    this.#admittedInWindow += 1;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}
