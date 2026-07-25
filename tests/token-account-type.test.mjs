import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createActivationTokenCode,
  normalizeTokenAccountType,
  tokenMatchesAccountType,
} from "../app/lib/tokenAccess.ts";

test("token lama tanpa accountType tetap menjadi token individual", () => {
  assert.equal(normalizeTokenAccountType(undefined), "individual");
  assert.equal(tokenMatchesAccountType(undefined, undefined), true);
  assert.equal(tokenMatchesAccountType(undefined, "school"), false);
});

test("token individual dan sekolah tidak dapat dipertukarkan", () => {
  assert.equal(tokenMatchesAccountType("individual", "individual"), true);
  assert.equal(tokenMatchesAccountType("school", "school"), true);
  assert.equal(tokenMatchesAccountType("individual", "school"), false);
  assert.equal(tokenMatchesAccountType("school", "individual"), false);
});

test("kode token menampilkan penanda tipe akun yang berbeda", () => {
  assert.match(createActivationTokenCode("individual"), /^SATT-I-[A-F0-9]{12}$/);
  assert.match(createActivationTokenCode("school"), /^SATT-S-[A-F0-9]{12}$/);
});

test("Firestore Rules memvalidasi tipe token dengan tipe akun", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /function tokenMatchesUserAccountType/);
  assert.match(rules, /tokenMatchesUserAccountType\(tokenId, request\.auth\.uid\)/);
  assert.match(rules, /request\.resource\.data\.accountType in \['individual', 'school'\]/);
});
