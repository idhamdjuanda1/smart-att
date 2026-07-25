import { deleteApp, initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, deleteUser, getAuth, signOut } from "firebase/auth";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db, firebaseConfig } from "./firebase";

type TeacherDraft = {
  schoolId: string;
  createdByUid: string;
  name: string;
  email: string;
  password: string;
  subjectIds: string[];
  primarySubjectIds: string[];
  additionalSubjectIds: string[];
  assignedClassIds: string[];
  assignedClassNames: string[];
  phone?: string;
  nip?: string;
  gender?: string;
  address?: string;
  education?: string;
  employmentStatus?: string;
};

export async function provisionSchoolTeacher(draft: TeacherDraft) {
  const app = initializeApp(firebaseConfig, `smartatt-provision-${crypto.randomUUID()}`);
  const secondaryAuth = getAuth(app);
  let createdUser: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>["user"] | null = null;

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, draft.email.trim().toLowerCase(), draft.password);
    createdUser = credential.user;
    const now = Date.now();
    const batch = writeBatch(db);
    batch.set(doc(db, "users", createdUser.uid), {
      accountType: "school",
      role: "teacher",
      schoolRole: "teacher",
      schoolId: draft.schoolId,
      name: draft.name.trim(),
      email: draft.email.trim().toLowerCase(),
      phone: draft.phone?.trim() || "",
      subjectIds: draft.subjectIds,
      primarySubjectIds: draft.primarySubjectIds,
      additionalSubjectIds: draft.additionalSubjectIds,
      nip: draft.nip?.trim() || "",
      gender: draft.gender || "",
      address: draft.address?.trim() || "",
      education: draft.education?.trim() || "",
      employmentStatus: draft.employmentStatus || "active",
      assignedClassIds: draft.assignedClassIds,
      assignedClassNames: draft.assignedClassNames,
      status: "active",
      disabled: false,
      createdByUid: draft.createdByUid,
      createdAtMs: now,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "schools", draft.schoolId, "members", createdUser.uid), {
      uid: createdUser.uid,
      role: "teacher",
      name: draft.name.trim(),
      email: draft.email.trim().toLowerCase(),
      phone: draft.phone?.trim() || "",
      subjectIds: draft.subjectIds,
      primarySubjectIds: draft.primarySubjectIds,
      additionalSubjectIds: draft.additionalSubjectIds,
      nip: draft.nip?.trim() || "",
      gender: draft.gender || "",
      address: draft.address?.trim() || "",
      education: draft.education?.trim() || "",
      employmentStatus: draft.employmentStatus || "active",
      assignedClassIds: draft.assignedClassIds,
      assignedClassNames: draft.assignedClassNames,
      active: true,
      createdByUid: draft.createdByUid,
      createdAtMs: now,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return createdUser.uid;
  } catch (error) {
    if (createdUser) await deleteUser(createdUser).catch(() => undefined);
    throw error;
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
    await deleteApp(app).catch(() => undefined);
  }
}
