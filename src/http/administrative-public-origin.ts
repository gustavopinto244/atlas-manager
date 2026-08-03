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
  const authority = /^https:\/\/([^/?#]+)\/?$/u.exec(value)?.[1];
  if (authority === undefined || /:0*443$/u.test(authority))
    throw new Error("administrative_public_origin_invalid");
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
  if (
    typeof hostHeader !== "string" ||
    hostHeader.length === 0 ||
    hostHeader.trim() !== hostHeader ||
    hasControlOrWhitespace(hostHeader) ||
    [...",/?#[]@"].some((character) => hostHeader.includes(character))
  )
    return false;
  const match =
    /^(?<hostname>[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::(?<port>[0-9]{1,5}))?$/u.exec(
      hostHeader,
    );
  if (match === null) return false;
  const hostname = match.groups?.hostname;
  const port = match.groups?.port;
  if (hostname !== origin.hostname) return false;
  if (port === undefined) return origin.port === "";
  return origin.port !== "" && port === origin.port;
}

function netIsIpLiteral(hostname: string): boolean {
  if (/^\d+(?:\.\d+){3}$/u.test(hostname)) return true;
  return hostname.includes(":");
}

function hasControlOrWhitespace(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x20 || code === 0x7f;
  });
}
