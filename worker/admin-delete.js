const FIREBASE_PROJECT_ID = "smart-att-90ef9";
const SUPERADMIN_EMAIL = "idhamdjuanda@gmail.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_ROOT = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const FIRESTORE_DOCUMENT_NAME_ROOT = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const IDENTITY_ROOT = `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts`;

const ownedCollections = [
  ["studentDirectory", "ownerUid"],
  ["crossClassAttendance", "ownerUid"],
  ["crossClassAttendance", "scannerUid"],
  ["studentClassLinks", "sourceOwnerUid"],
  ["studentClassLinks", "targetOwnerUid"],
  ["studentClassLinks", "requestedBy"],
  ["savingsTransactions", "ownerUid"],
  ["publicSnapshots", "ownerUid"],
  ["publicLinkCodes", "ownerUid"],
  ["publicResponses", "ownerUid"],
  ["publicQuizDeviceLocks", "ownerUid"],
  ["publicQuizAttempts", "ownerUid"],
  ["publicAbsenceResponses", "ownerUid"],
  ["activationTokens", "usedBy"],
];

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function base64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function pemBytes(pem) {
  const normalized = pem.replaceAll("\\n", "\n");
  const body = normalized.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function adminAccessToken(env) {
  if (!env.FIREBASE_ADMIN_SERVICE_ACCOUNT) throw new Error("FIREBASE_ADMIN_NOT_CONFIGURED");
  let serviceAccount;
  try { serviceAccount = JSON.parse(env.FIREBASE_ADMIN_SERVICE_ACCOUNT); }
  catch { throw new Error("FIREBASE_ADMIN_INVALID"); }
  const email = String(serviceAccount.client_email ?? "");
  const privateKey = String(serviceAccount.private_key ?? "");
  if (!email || !privateKey || serviceAccount.project_id !== FIREBASE_PROJECT_ID) throw new Error("FIREBASE_ADMIN_INVALID");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: email,
    sub: email,
    aud: GOOGLE_TOKEN_URL,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    iat: now,
    exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${base64Url(new Uint8Array(signature))}` }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error("FIREBASE_ADMIN_TOKEN_FAILED");
  return result.access_token;
}

function authHeaders(accessToken) {
  return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
}

function encodedPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function firebaseAccount(accessToken, uid) {
  const response = await fetch(`${IDENTITY_ROOT}:lookup`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ localId: [uid], targetProjectId: FIREBASE_PROJECT_ID }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("AUTH_LOOKUP_FAILED");
  return result.users?.[0] ?? null;
}

async function firebaseAccounts(accessToken, uids) {
  const accounts = [];
  for (let offset = 0; offset < uids.length; offset += 100) {
    const response = await fetch(`${IDENTITY_ROOT}:lookup`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ localId: uids.slice(offset, offset + 100), targetProjectId: FIREBASE_PROJECT_ID }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("AUTH_LOOKUP_FAILED");
    accounts.push(...(result.users ?? []));
  }
  return accounts;
}

async function firestoreDocument(accessToken, path) {
  const response = await fetch(`${FIRESTORE_ROOT}/${encodedPath(path)}`, { headers: authHeaders(accessToken) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("FIRESTORE_READ_FAILED");
  return response.json();
}

function stringField(document, name) {
  return document?.fields?.[name]?.stringValue ?? "";
}

export function deletionTargetEmail(targetAccount, profile) {
  return String(targetAccount?.email ?? "").trim().toLowerCase()
    || stringField(profile, "email").trim().toLowerCase();
}

export function schoolDeletionConfirmationMatches(expectedName, enteredName, confirmation) {
  return String(expectedName ?? "").trim().toLowerCase() === String(enteredName ?? "").trim().toLowerCase()
    && String(confirmation ?? "").trim().toUpperCase() === "HAPUS SEKOLAH PERMANEN";
}

async function listCollectionIds(accessToken, documentPath) {
  const ids = [];
  let pageToken = "";
  do {
    const response = await fetch(`${FIRESTORE_ROOT}/${encodedPath(documentPath)}:listCollectionIds`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
    });
    if (response.status === 404) return ids;
    if (!response.ok) throw new Error("FIRESTORE_LIST_COLLECTIONS_FAILED");
    const result = await response.json();
    ids.push(...(result.collectionIds ?? []));
    pageToken = result.nextPageToken ?? "";
  } while (pageToken);
  return ids;
}

async function listDocuments(accessToken, parentPath, collectionId) {
  const documents = [];
  let pageToken = "";
  do {
    const base = parentPath ? `${FIRESTORE_ROOT}/${encodedPath(parentPath)}/${encodeURIComponent(collectionId)}` : `${FIRESTORE_ROOT}/${encodeURIComponent(collectionId)}`;
    const query = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
    const response = await fetch(`${base}?${query}`, { headers: authHeaders(accessToken) });
    if (response.status === 404) return documents;
    if (!response.ok) throw new Error("FIRESTORE_LIST_DOCUMENTS_FAILED");
    const result = await response.json();
    documents.push(...(result.documents ?? []));
    pageToken = result.nextPageToken ?? "";
  } while (pageToken);
  return documents;
}

function documentPathFromName(name) {
  return String(name).split("/documents/")[1] ?? "";
}

async function deleteDocumentTree(accessToken, documentPath) {
  let deleted = 0;
  for (const collectionId of await listCollectionIds(accessToken, documentPath)) {
    for (const child of await listDocuments(accessToken, documentPath, collectionId)) {
      deleted += await deleteDocumentTree(accessToken, documentPathFromName(child.name));
    }
  }
  const response = await fetch(`${FIRESTORE_ROOT}/${encodedPath(documentPath)}`, { method: "DELETE", headers: authHeaders(accessToken) });
  if (!response.ok && response.status !== 404) throw new Error("FIRESTORE_DELETE_FAILED");
  return deleted + (response.status === 404 ? 0 : 1);
}

async function queryDocuments(accessToken, collectionId, fieldPath, value) {
  const response = await fetch(`${FIRESTORE_ROOT}:runQuery`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId }],
      where: { fieldFilter: { field: { fieldPath }, op: "EQUAL", value: { stringValue: value } } },
    } }),
  });
  if (!response.ok) throw new Error("FIRESTORE_QUERY_FAILED");
  const rows = await response.json();
  return rows.flatMap((row) => row.document ? [row.document] : []);
}

async function queryDocumentsIn(accessToken, collectionId, fieldPath, values) {
  const documents = [];
  for (let offset = 0; offset < values.length; offset += 30) {
    const chunk = values.slice(offset, offset + 30);
    if (!chunk.length) continue;
    const response = await fetch(`${FIRESTORE_ROOT}:runQuery`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath }, op: "IN", value: { arrayValue: { values: chunk.map((value) => ({ stringValue: value })) } } } },
      } }),
    });
    if (!response.ok) throw new Error("FIRESTORE_QUERY_FAILED");
    const rows = await response.json();
    documents.push(...rows.flatMap((row) => row.document ? [row.document] : []));
  }
  return documents;
}

async function batchDeleteDocuments(accessToken, documentPaths) {
  const uniquePaths = [...new Set(documentPaths.filter(Boolean))];
  let deleted = 0;
  for (let offset = 0; offset < uniquePaths.length; offset += 450) {
    const chunk = uniquePaths.slice(offset, offset + 450);
    const response = await fetch(`${FIRESTORE_ROOT}:batchWrite`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ writes: chunk.map((path) => ({ delete: `${FIRESTORE_DOCUMENT_NAME_ROOT}/${path}` })) }),
    });
    if (!response.ok) throw new Error("FIRESTORE_BATCH_DELETE_FAILED");
    deleted += chunk.length;
  }
  return deleted;
}

async function ownedTopLevelPathsForUsers(accessToken, uids) {
  if (!uids.length) return [];
  const matches = await Promise.all(ownedCollections.map(([collectionId, fieldPath]) => queryDocumentsIn(accessToken, collectionId, fieldPath, uids)));
  return [...new Set(matches.flat().map((document) => documentPathFromName(document.name)).filter(Boolean))];
}

async function schoolDocumentPaths(accessToken, schoolId) {
  const schoolPath = `schools/${schoolId}`;
  const collectionIds = await listCollectionIds(accessToken, schoolPath);
  const collections = await Promise.all(collectionIds.map((collectionId) => listDocuments(accessToken, schoolPath, collectionId)));
  return [...new Set([
    ...collections.flat().map((document) => documentPathFromName(document.name)).filter(Boolean),
    schoolPath,
  ])];
}

async function deleteOwnedTopLevelData(accessToken, uid) {
  const paths = new Set();
  const matches = await Promise.all(ownedCollections.map(([collectionId, fieldPath]) => queryDocuments(accessToken, collectionId, fieldPath, uid)));
  for (const documents of matches) for (const document of documents) paths.add(documentPathFromName(document.name));
  const deleted = await Promise.all([...paths].map((path) => deleteDocumentTree(accessToken, path)));
  return deleted.reduce((total, count) => total + count, 0);
}

async function deleteR2Prefix(bucket, prefix) {
  let cursor;
  let deleted = 0;
  do {
    const listed = await bucket.list({ prefix, ...(cursor ? { cursor } : {}), limit: 1000 });
    const keys = listed.objects.map((object) => object.key);
    if (keys.length) { await bucket.delete(keys); deleted += keys.length; }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return deleted;
}

async function deleteOwnedR2Data(env, uid) {
  let deleted = 0;
  for (const prefix of [`users/${uid}/`, `guardian-submissions/${uid}/`, `savings-credentials/${uid}/`]) deleted += await deleteR2Prefix(env.SMARTATT_R2, prefix);
  for (const prefix of ["savings-shares/", "savings-sessions/"]) {
    let cursor;
    do {
      const listed = await env.SMARTATT_R2.list({ prefix, include: ["customMetadata"], ...(cursor ? { cursor } : {}), limit: 1000 });
      const keys = listed.objects.filter((object) => object.customMetadata?.ownerUid === uid).map((object) => object.key);
      if (keys.length) { await env.SMARTATT_R2.delete(keys); deleted += keys.length; }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  return deleted;
}

async function schoolDeletionPlan(accessToken, uid, profile) {
  if (stringField(profile, "accountType") !== "school") return { schoolId: "", deleteSchool: false };
  const schoolId = stringField(profile, "schoolId");
  if (!schoolId) return { schoolId: "", deleteSchool: false };
  const school = await firestoreDocument(accessToken, `schools/${schoolId}`);
  const deleteSchool = stringField(school, "ownerUid") === uid;
  if (deleteSchool) {
    const otherMembers = (await listDocuments(accessToken, `schools/${schoolId}`, "members"))
      .filter((member) => documentPathFromName(member.name).split("/").at(-1) !== uid);
    if (otherMembers.length) {
      const error = new Error("SCHOOL_HAS_MEMBERS");
      error.memberCount = otherMembers.length;
      throw error;
    }
  }
  return { schoolId, deleteSchool };
}

export async function handleAdminUserDeletion(request, env, url, requester) {
  const match = url.pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]{10,128})$/);
  if (!match) return null;
  if (request.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
  if (!requester || requester.email.toLowerCase() !== SUPERADMIN_EMAIL) return json({ error: "Forbidden" }, 403);
  const uid = match[1];
  if (uid === requester.uid) return json({ error: "Akun superadmin tidak dapat dihapus." }, 400);
  const body = await request.json().catch(() => null);
  const confirmationEmail = String(body?.email ?? "").trim().toLowerCase();
  if (body?.confirmation !== "HAPUS PERMANEN" || !confirmationEmail) return json({ error: "Konfirmasi penghapusan tidak sesuai." }, 400);

  try {
    const accessToken = await adminAccessToken(env);
    const targetAccount = await firebaseAccount(accessToken, uid);
    const profile = await firestoreDocument(accessToken, `users/${uid}`);
    const targetEmail = deletionTargetEmail(targetAccount, profile);
    if (!targetEmail) return json({ error: "Akun tidak ditemukan di Firebase Authentication maupun Firestore." }, 404);
    if (targetEmail === SUPERADMIN_EMAIL) return json({ error: "Akun superadmin tidak dapat dihapus." }, 400);
    if (targetEmail !== confirmationEmail) return json({ error: "Email konfirmasi tidak sama dengan akun yang dipilih." }, 400);

    const plan = await schoolDeletionPlan(accessToken, uid, profile);

    let firestoreDeleted = 0;
    let r2Deleted = 0;
    const warnings = [];
    if (targetAccount) {
      const authResponse = await fetch(`${IDENTITY_ROOT}:delete`, {
        method: "POST",
        headers: authHeaders(accessToken),
        body: JSON.stringify({ localId: uid, targetProjectId: FIREBASE_PROJECT_ID }),
      });
      if (!authResponse.ok) throw new Error("AUTH_DELETE_FAILED");
    } else {
      warnings.push("Firebase Authentication sebelumnya sudah tidak ditemukan; sisa data akun telah dibersihkan.");
    }
    try {
      firestoreDeleted += await deleteOwnedTopLevelData(accessToken, uid);
      if (plan.schoolId) {
        if (plan.deleteSchool) firestoreDeleted += await deleteDocumentTree(accessToken, `schools/${plan.schoolId}`);
        else firestoreDeleted += await deleteDocumentTree(accessToken, `schools/${plan.schoolId}/members/${uid}`);
      }
      firestoreDeleted += await deleteDocumentTree(accessToken, `users/${uid}`);
    } catch { warnings.push("Sebagian data Firestore perlu dibersihkan ulang oleh admin."); }
    try { r2Deleted = await deleteOwnedR2Data(env, uid); }
    catch { warnings.push("Sebagian file R2 perlu dibersihkan ulang oleh admin."); }

    return json({ deleted: true, uid, email: targetEmail, authDeleted: Boolean(targetAccount), firestoreDeleted, r2Deleted, warnings });
  } catch (error) {
    if (error?.message === "FIREBASE_ADMIN_NOT_CONFIGURED") return json({ error: "Fitur hapus permanen belum dikonfigurasi pada server." }, 503);
    if (error?.message === "FIREBASE_ADMIN_INVALID") return json({ error: "Kredensial admin Firebase tidak valid." }, 503);
    if (error?.message === "SCHOOL_HAS_MEMBERS") return json({ error: `Workspace sekolah masih memiliki ${error.memberCount} anggota lain. Hapus akun anggota terlebih dahulu.` }, 409);
    console.error("[smart-att] permanent user deletion failed", error);
    return json({ error: "Penghapusan permanen gagal diproses oleh server." }, 500);
  }
}

export async function handleAdminSchoolDeletion(request, env, url, requester) {
  const match = url.pathname.match(/^\/api\/admin\/schools\/([A-Za-z0-9_-]{3,128})$/);
  if (!match) return null;
  if (request.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
  if (!requester || requester.email.toLowerCase() !== SUPERADMIN_EMAIL) return json({ error: "Forbidden" }, 403);

  const schoolId = match[1];
  const body = await request.json().catch(() => null);
  if (!body?.schoolName || String(body?.confirmation ?? "").trim().toUpperCase() !== "HAPUS SEKOLAH PERMANEN") {
    return json({ error: "Konfirmasi penghapusan sekolah tidak sesuai." }, 400);
  }

  try {
    const accessToken = await adminAccessToken(env);
    const school = await firestoreDocument(accessToken, `schools/${schoolId}`);
    if (!school) return json({ error: "Workspace sekolah tidak ditemukan." }, 404);
    const schoolName = stringField(school, "name") || stringField(school, "schoolName") || schoolId;
    if (!schoolDeletionConfirmationMatches(schoolName, body.schoolName, body.confirmation)) {
      return json({ error: "Nama sekolah atau frasa konfirmasi tidak sesuai." }, 400);
    }

    const memberDocuments = await listDocuments(accessToken, `schools/${schoolId}`, "members");
    const userDocuments = await queryDocuments(accessToken, "users", "schoolId", schoolId);
    const ownerUid = stringField(school, "ownerUid");
    const memberUids = new Set([
      ...(ownerUid ? [ownerUid] : []),
      ...memberDocuments.map((document) => documentPathFromName(document.name).split("/").at(-1) || ""),
      ...userDocuments.map((document) => documentPathFromName(document.name).split("/").at(-1) || ""),
    ].filter(Boolean));
    memberUids.delete(requester.uid);

    const uids = [...memberUids];
    const accounts = await firebaseAccounts(accessToken, uids);
    const deletableAccounts = accounts.filter((account) => String(account.email ?? "").trim().toLowerCase() !== SUPERADMIN_EMAIL);
    const authBatch = deletableAccounts.slice(0, 10);
    for (const account of authBatch) {
      const authResponse = await fetch(`${IDENTITY_ROOT}:delete`, {
        method: "POST",
        headers: authHeaders(accessToken),
        body: JSON.stringify({ localId: account.localId, targetProjectId: FIREBASE_PROJECT_ID }),
      });
      if (!authResponse.ok) throw new Error("SCHOOL_AUTH_DELETE_FAILED");
    }
    if (deletableAccounts.length > authBatch.length) {
      return json({
        deleted: false,
        pending: true,
        schoolId,
        schoolName,
        memberCount: memberUids.size,
        authDeleted: authBatch.length,
        remainingAuth: deletableAccounts.length - authBatch.length,
        warnings: [],
      });
    }

    const warnings = accounts.some((account) => String(account.email ?? "").trim().toLowerCase() === SUPERADMIN_EMAIL)
      ? ["Akun superadmin yang terhubung ke sekolah dilewati."]
      : [];
    const ownedPaths = await ownedTopLevelPathsForUsers(accessToken, uids);
    const userPaths = uids.map((uid) => `users/${uid}`);
    const schoolPaths = await schoolDocumentPaths(accessToken, schoolId);
    const firestoreDeleted = await batchDeleteDocuments(accessToken, [...ownedPaths, ...userPaths, ...schoolPaths]);
    let r2Deleted = 0;
    for (const uid of uids) {
      try { r2Deleted += await deleteOwnedR2Data(env, uid); }
      catch { warnings.push(`Sebagian file akun ${uid} perlu dibersihkan ulang.`); }
    }

    return json({
      deleted: true,
      schoolId,
      schoolName,
      memberCount: memberUids.size,
      authDeleted: authBatch.length,
      firestoreDeleted,
      r2Deleted,
      warnings,
    });
  } catch (error) {
    if (error?.message === "FIREBASE_ADMIN_NOT_CONFIGURED") return json({ error: "Fitur hapus permanen belum dikonfigurasi pada server." }, 503);
    if (error?.message === "FIREBASE_ADMIN_INVALID") return json({ error: "Kredensial admin Firebase tidak valid." }, 503);
    if (error?.message === "SCHOOL_AUTH_DELETE_FAILED") return json({ error: "Sebagian akun sekolah gagal dihapus dari Firebase Authentication. Tidak ada workspace yang dihapus." }, 502);
    console.error("[smart-att] permanent school deletion failed", error);
    return json({ error: "Penghapusan permanen sekolah gagal diproses oleh server." }, 500);
  }
}
