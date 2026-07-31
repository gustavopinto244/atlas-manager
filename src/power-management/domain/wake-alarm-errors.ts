export class UnsupportedWakeAlarmMutationError extends Error {
  public override readonly name = "UnsupportedWakeAlarmMutationError";

  public constructor() {
    super("Wake-alarm mutation is unsupported");
    Object.freeze(this);
  }
}
