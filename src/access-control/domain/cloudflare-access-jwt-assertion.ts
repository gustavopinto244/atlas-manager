const COMPACT_SEGMENT = /^[A-Za-z0-9_-]+$/u;
const MAX_ASSERTION_BYTES = 16_384;

export type CloudflareAccessJwtAssertion = string & {
  readonly __cloudflareAccessJwtAssertion: unique symbol;
};

export function createCloudflareAccessJwtAssertion(
  input: unknown,
): CloudflareAccessJwtAssertion {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.trim() !== input ||
    input.includes(",") ||
    input.includes("\r") ||
    input.includes("\n") ||
    Buffer.byteLength(input, "utf8") > MAX_ASSERTION_BYTES
  )
    throw new Error("Invalid Cloudflare Access assertion");
  const segments = input.split(".");
  if (
    segments.length !== 3 ||
    segments.some(
      (segment) => segment.length === 0 || !COMPACT_SEGMENT.test(segment),
    )
  )
    throw new Error("Invalid Cloudflare Access assertion");
  return input as CloudflareAccessJwtAssertion;
}
