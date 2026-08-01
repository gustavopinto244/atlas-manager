export interface AdministrativePowerOperationGate {
  tryAdmit(): (() => void) | undefined;
}

export class FixedAdministrativePowerOperationGate implements AdministrativePowerOperationGate {
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
