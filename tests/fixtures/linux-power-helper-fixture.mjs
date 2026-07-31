/* global process, setTimeout */

// Test-only process fixture. It deliberately performs no privileged operation.
const mode = process.env.ATLAS_POWER_HELPER_FIXTURE_MODE ?? "success";
let input = "";

process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  let request;
  try {
    request = JSON.parse(input);
  } catch {
    process.stdout.write("not-json\n");
    return;
  }

  if (mode === "nonzero_exit") {
    process.exitCode = 7;
    return;
  }
  if (mode === "malformed_json") {
    process.stdout.write("{not-json}\n");
    return;
  }
  if (mode === "multiple_lines") {
    process.stdout.write("{}\n{}\n");
    return;
  }
  if (mode === "stdout_overflow") {
    process.stdout.write("x".repeat(16_385));
    return;
  }
  if (mode === "stderr_overflow") {
    process.stderr.write("x".repeat(4_097));
    return;
  }
  if (mode === "timeout") {
    setTimeout(() => undefined, 10_000);
    return;
  }
  if (mode === "operation_mismatch") {
    process.stdout.write(
      JSON.stringify({
        version: 1,
        operation: "read_wake_alarm",
        outcome: "success",
        result: { state: "not_scheduled" },
      }) + "\n",
    );
    return;
  }
  if (mode === "unsupported_version") {
    process.stdout.write(
      JSON.stringify({
        version: 2,
        operation: request.operation,
        outcome: "success",
        result: { state: "not_scheduled" },
      }) + "\n",
    );
    return;
  }

  const result =
    request.operation === "read_rtc_information"
      ? {
          rtcTime: "2026-01-01T00:00:00.000Z",
          wakeAlarm: { state: "not_scheduled" },
        }
      : request.operation === "read_wake_alarm"
        ? { state: "not_scheduled" }
        : request.operation === "request_shutdown"
          ? { accepted: true }
          : {
              before: { state: "not_scheduled" },
              after: {
                state: "scheduled",
                scheduledFor: request.scheduledFor,
              },
              outcome: "scheduled",
            };
  process.stdout.write(
    JSON.stringify({
      version: 1,
      operation: request.operation,
      outcome: "success",
      result,
    }) + "\n",
  );
});
