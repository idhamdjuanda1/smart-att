export type AccountType = "individual" | "school";

export type LegacyRole = "teacher" | "superadmin";

export type SchoolRole = "principal" | "administration" | "teacher";

export type AccountAccessProfile = {
  accountType: AccountType;
  role: LegacyRole;
  schoolRole?: SchoolRole;
  schoolId?: string;
  pendingApproval?: boolean;
};

export type Permission =
  | "school.profile.manage"
  | "academic.manage"
  | "classes.manage"
  | "subjects.manage"
  | "teachers.manage"
  | "students.read"
  | "students.manage"
  | "schedule.read"
  | "schedule.manage"
  | "assignments.read"
  | "assignments.manage"
  | "attendance.read"
  | "attendance.manage"
  | "quiz.read"
  | "quiz.manage"
  | "grades.read"
  | "grades.manage"
  | "reports.read"
  | "settings.manage";

const ALL_PERMISSIONS: readonly Permission[] = [
  "school.profile.manage",
  "academic.manage",
  "classes.manage",
  "subjects.manage",
  "teachers.manage",
  "students.read",
  "students.manage",
  "schedule.read",
  "schedule.manage",
  "assignments.read",
  "assignments.manage",
  "attendance.read",
  "attendance.manage",
  "quiz.read",
  "quiz.manage",
  "grades.read",
  "grades.manage",
  "reports.read",
  "settings.manage",
] as const;

const SCHOOL_ROLE_PERMISSIONS: Record<SchoolRole, ReadonlySet<Permission>> = {
  principal: new Set(ALL_PERMISSIONS),
  administration: new Set([
    "school.profile.manage",
    "academic.manage",
    "classes.manage",
    "subjects.manage",
    "teachers.manage",
    "students.read",
    "students.manage",
    "schedule.read",
    "schedule.manage",
    "assignments.read",
    "assignments.manage",
    "attendance.read",
    "attendance.manage",
    "grades.read",
    "reports.read",
    "settings.manage",
  ]),
  teacher: new Set([
    "students.read",
    "schedule.read",
    "assignments.read",
    "attendance.read",
    "attendance.manage",
    "quiz.read",
    "quiz.manage",
    "grades.read",
    "grades.manage",
  ]),
};

type RawAccount = {
  accountType?: unknown;
  role?: unknown;
  schoolRole?: unknown;
  schoolId?: unknown;
  pendingApproval?: unknown;
};

export function normalizeAccountAccess(data: RawAccount | null | undefined): AccountAccessProfile {
  const role: LegacyRole = data?.role === "superadmin" ? "superadmin" : "teacher";
  const accountType: AccountType = data?.accountType === "school" ? "school" : "individual";
  // Some early school accounts stored the administrator role in `role`
  // instead of `schoolRole`. Read both fields so those accounts keep working
  // without a manual migration; the canonical value remains `schoolRole`.
  const schoolRoleSource = typeof data?.schoolRole === "string"
    ? data.schoolRole
    : typeof data?.role === "string" ? data.role : "";
  const rawSchoolRole = schoolRoleSource.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const schoolRole: SchoolRole | undefined = rawSchoolRole === "principal" || rawSchoolRole === "kepala_sekolah"
    ? "principal"
    : rawSchoolRole === "administration" || rawSchoolRole === "tu" || rawSchoolRole === "tata_usaha" || rawSchoolRole === "tatausaha"
      ? "administration"
      : rawSchoolRole === "teacher" || rawSchoolRole === "guru"
        ? "teacher"
        : undefined;
  const schoolId = typeof data?.schoolId === "string" && data.schoolId.trim() ? data.schoolId.trim() : undefined;
  const pendingApproval = data?.pendingApproval === true;

  return { accountType, role, schoolRole, schoolId, pendingApproval };
}

export function hasPermission(profile: AccountAccessProfile, permission: Permission) {
  if (profile.role === "superadmin") return true;
  if (profile.accountType === "individual") return true;
  if (!profile.schoolRole || !profile.schoolId) return false;
  return SCHOOL_ROLE_PERMISSIONS[profile.schoolRole].has(permission);
}

export function isSchoolAdministrator(profile: AccountAccessProfile) {
  return profile.accountType === "school" &&
    (profile.schoolRole === "principal" || profile.schoolRole === "administration");
}
