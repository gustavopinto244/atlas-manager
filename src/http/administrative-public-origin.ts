export type AdministrativePublicOrigin = Readonly<{
  origin: string;
  hostname: string;
  port: string;
}>;

export function parseAdministrativePublicOrigin(
  value: unknown,
): AdministrativePublicOrigin {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0)
    throw new Error("administrative_public_origin_invalid");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("administrative_public_origin_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname !== url.hostname.toLowerCase() ||
    url.hostname.includes("*") ||
    netIsIpLiteral(url.hostname) ||
    (url.port !== "" && url.port !== "443")
  )
    throw new Error("administrative_public_origin_invalid");
  const origin = url.port === "443" ? `https://${url.hostname}` : url.origin;
  return Object.freeze({ origin, hostname: url.hostname, port: url.port });
}

export function administrativeAuthorityMatches(
  hostHeader: string | string[] | undefined,
  origin: AdministrativePublicOrigin,
): boolean {
  if (typeof hostHeader !== "string" || hostHeader === "") return false;
  try {
    const value = new URL(`https://${hostHeader}`);
    return (
      value.hostname === origin.hostname &&
      (value.port === origin.port || (value.port === "" && origin.port === ""))
    );
  } catch {
    return false;
  }
}

function netIsIpLiteral(hostname: string): boolean {
  if (/^\d+(?:\.\d+){3}$/u.test(hostname)) return true;
  return hostname.includes(":");
}
