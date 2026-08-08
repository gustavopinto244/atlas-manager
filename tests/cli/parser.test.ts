import { describe, expect, it } from "vitest";

import { parseCliArguments } from "../../src/cli/parser.js";

describe("atlas CLI argument parser", () => {
  it("parses nested help without treating help as a command", () => {
    expect(parseCliArguments(["services", "--help"])).toEqual({
      command: ["services"],
      commandArguments: [],
      format: "human",
      help: true,
    });
  });

  it("keeps service identifiers as command arguments", () => {
    expect(
      parseCliArguments(["services", "status", "task-manager", "--json"]),
    ).toEqual({
      command: ["services", "status"],
      commandArguments: ["task-manager"],
      format: "json",
      help: false,
    });
  });

  it("accepts atlas help syntax", () => {
    expect(parseCliArguments(["help", "machine"])).toEqual({
      command: ["machine"],
      commandArguments: [],
      format: "human",
      help: true,
    });
  });
});
