export class StrictJsonDecodeError extends Error {
  public override readonly name = "StrictJsonDecodeError";

  public constructor(public readonly code: "invalid_json" | "duplicate_field") {
    super(`Invalid strict JSON: ${code}`);
    Object.freeze(this);
  }
}

export function parseStrictJson(input: string): unknown {
  const decoder = new StrictJsonDecoder(input);
  return decoder.parse();
}

class StrictJsonDecoder {
  readonly #input: string;
  #index = 0;

  public constructor(input: string) {
    this.#input = input;
  }

  public parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.#index !== this.#input.length) this.invalid();
    return value;
  }

  private parseValue(): unknown {
    const character = this.#input[this.#index];
    if (character === '"') return this.parseString();
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === "t") return this.parseLiteral("true", true);
    if (character === "f") return this.parseLiteral("false", false);
    if (character === "n") return this.parseLiteral("null", null);
    if (character === "-" || isDigit(character)) return this.parseNumber();
    this.invalid();
  }

  private parseObject(): Record<string, unknown> {
    this.#index += 1;
    const result = Object.create(null) as Record<string, unknown>;
    const fields = new Set<string>();
    this.skipWhitespace();
    if (this.consume("}")) return result;

    while (true) {
      this.skipWhitespace();
      if (this.#input[this.#index] !== '"') this.invalid();
      const key = this.parseString();
      if (fields.has(key)) {
        throw new StrictJsonDecodeError("duplicate_field");
      }
      fields.add(key);
      this.skipWhitespace();
      if (!this.consume(":")) this.invalid();
      this.skipWhitespace();
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.consume("}")) return result;
      if (!this.consume(",")) this.invalid();
    }
  }

  private parseArray(): unknown[] {
    this.#index += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.consume("]")) return result;

    while (true) {
      this.skipWhitespace();
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.consume("]")) return result;
      if (!this.consume(",")) this.invalid();
    }
  }

  private parseString(): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.#input.length) {
      const character = this.#input[this.#index];
      if (character === '"') {
        this.#index += 1;
        try {
          return JSON.parse(this.#input.slice(start, this.#index)) as string;
        } catch {
          this.invalid();
        }
      }
      if (character === "\\") {
        this.#index += 1;
        if (this.#index >= this.#input.length) this.invalid();
        if (this.#input[this.#index] === "u") {
          this.#index += 4;
          if (this.#index > this.#input.length) this.invalid();
        }
      } else if (character !== undefined && character < " ") {
        this.invalid();
      }
      this.#index += 1;
    }
    this.invalid();
  }

  private parseNumber(): number {
    const remaining = this.#input.slice(this.#index);
    const match = remaining.match(
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u,
    );
    if (match === null) this.invalid();
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.invalid();
    this.#index += match[0].length;
    return value;
  }

  private parseLiteral<T>(literal: string, value: T): T {
    if (!this.#input.startsWith(literal, this.#index)) this.invalid();
    this.#index += literal.length;
    return value;
  }

  private skipWhitespace(): void {
    while (isJsonWhitespace(this.#input.charCodeAt(this.#index)))
      this.#index += 1;
  }

  private consume(character: string): boolean {
    if (this.#input[this.#index] !== character) return false;
    this.#index += 1;
    return true;
  }

  private invalid(): never {
    throw new StrictJsonDecodeError("invalid_json");
  }
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function isJsonWhitespace(value: number): boolean {
  return value === 0x20 || value === 0x09 || value === 0x0a || value === 0x0d;
}
