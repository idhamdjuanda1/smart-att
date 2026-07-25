export type TokenAccountType = "individual" | "school";

export function normalizeTokenAccountType(value: unknown): TokenAccountType {
  return value === "school" ? "school" : "individual";
}

export function tokenMatchesAccountType(tokenType: unknown, accountType: unknown) {
  return normalizeTokenAccountType(tokenType) === normalizeTokenAccountType(accountType);
}

export function createActivationTokenCode(accountType: TokenAccountType) {
  const marker = accountType === "school" ? "S" : "I";
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `SATT-${marker}-${random}`;
}

export function tokenAccountTypeLabel(accountType: unknown) {
  return normalizeTokenAccountType(accountType) === "school" ? "Per Sekolah" : "Guru SD Perorangan";
}
