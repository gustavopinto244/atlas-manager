export interface CloudflareAccessJwksProvider {
  resolveKey(kid: string, verificationTime: Date): Promise<CryptoKey>;
  checkReadiness(verificationTime: Date): Promise<"ready" | "unavailable">;
}
