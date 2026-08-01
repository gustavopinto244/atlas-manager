export interface AdministrativeWakeAlarmMutationGate {
  tryAdmit(): (() => void) | undefined;
}

export class FixedAdministrativeWakeAlarmMutationGate implements AdministrativeWakeAlarmMutationGate {
  #active = false;

  public constructor() {
    Object.freeze(this);
  }

  public tryAdmit(): (() => void) | undefined {
    if (this.#active) return undefined;
    this.#active = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active = false;
    };
  }
}
