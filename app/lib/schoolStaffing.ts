export type StaffingAssignment = {
  id: string;
  teacherUid?: string;
  fixedTeacherUid?: string;
  subjectId: string;
  classId: string;
  weeklyPeriods: number;
};

export type StaffingTeacher = {
  uid: string;
  subjectIds?: string[];
  primarySubjectIds?: string[];
  additionalSubjectIds?: string[];
};

export type DistributedStaffingAssignment = StaffingAssignment & {
  teacherUid: string;
  assignmentType: "primary" | "cross-field" | "unassigned";
};

export type StaffingDistribution = {
  assignments: DistributedStaffingAssignment[];
  teacherLoads: Record<string, number>;
  unassigned: DistributedStaffingAssignment[];
};

export type StaffingPlanSummary = {
  totalRequiredPeriods: number;
  totalAssignedPeriods: number;
  missingPeriods: number;
  crossFieldPeriods: number;
  averagePeriodsPerTeacher: number;
  averageClassesPerTeacher: number;
  teachers: Array<{
    uid: string;
    weeklyPeriods: number;
    classCount: number;
    subjectCount: number;
    status: "unused" | "below-minimum" | "balanced" | "overloaded";
  }>;
  subjects: Array<{
    subjectId: string;
    requiredPeriods: number;
    missingPeriods: number;
    availableTeacherCount: number;
    primaryTeacherCount: number;
    additionalTeacherCount: number;
    crossFieldPeriods: number;
    minimumTeacherCount: number;
    shortageTeacherCount: number;
    surplusTeacherCount: number;
  }>;
};

export const MIN_WEEKLY_TEACHING_PERIODS = 24;
export const MAX_WEEKLY_TEACHING_PERIODS = 40;

function primarySubjects(teacher: StaffingTeacher) {
  return teacher.primarySubjectIds ?? teacher.subjectIds ?? [];
}

export function getTeacherQualification(teacher: StaffingTeacher, subjectId: string): "primary" | "cross-field" | "unassigned" {
  if (primarySubjects(teacher).includes(subjectId)) return "primary";
  if ((teacher.additionalSubjectIds ?? []).includes(subjectId)) return "cross-field";
  return "unassigned";
}

export function distributeTeacherLoads(
  assignments: StaffingAssignment[],
  teachers: StaffingTeacher[],
  maximumPeriods = MAX_WEEKLY_TEACHING_PERIODS,
): StaffingDistribution {
  const teacherLoads = Object.fromEntries(teachers.map((teacher) => [teacher.uid, 0])) as Record<string, number>;
  const eligibleTeachers = (subjectId: string) => teachers.filter((teacher) => getTeacherQualification(teacher, subjectId) !== "unassigned");
  const sorted = [...assignments].sort((left, right) => {
    const byScarcity = eligibleTeachers(left.subjectId).length - eligibleTeachers(right.subjectId).length;
    if (byScarcity) return byScarcity;
    if (left.weeklyPeriods !== right.weeklyPeriods) return right.weeklyPeriods - left.weeklyPeriods;
    return `${left.subjectId}:${left.classId}`.localeCompare(`${right.subjectId}:${right.classId}`);
  });
  const distributed = new Map<string, DistributedStaffingAssignment>();

  for (const assignment of sorted) {
    const fixedTeacher = assignment.fixedTeacherUid ? teachers.find((teacher) => teacher.uid === assignment.fixedTeacherUid) : undefined;
    const candidates = (fixedTeacher ? [fixedTeacher] : eligibleTeachers(assignment.subjectId))
      .filter((teacher) => (teacherLoads[teacher.uid] ?? 0) + assignment.weeklyPeriods <= maximumPeriods)
      .sort((left, right) => {
        const byQualification = (getTeacherQualification(left, assignment.subjectId) === "primary" ? 0 : 1) - (getTeacherQualification(right, assignment.subjectId) === "primary" ? 0 : 1);
        if (byQualification) return byQualification;
        const byLoad = (teacherLoads[left.uid] ?? 0) - (teacherLoads[right.uid] ?? 0);
        if (byLoad) return byLoad;
        if (left.uid === assignment.teacherUid) return -1;
        if (right.uid === assignment.teacherUid) return 1;
        return left.uid.localeCompare(right.uid);
      });
    const chosen = candidates[0];
    const teacherUid = chosen?.uid ?? "";
    if (teacherUid) teacherLoads[teacherUid] = (teacherLoads[teacherUid] ?? 0) + assignment.weeklyPeriods;
    distributed.set(assignment.id, {
      ...assignment,
      teacherUid,
      assignmentType: chosen ? (getTeacherQualification(chosen, assignment.subjectId) === "unassigned" ? "primary" : getTeacherQualification(chosen, assignment.subjectId)) : "unassigned",
    });
  }

  const result = assignments.map((assignment) => distributed.get(assignment.id)!);
  return {
    assignments: result,
    teacherLoads,
    unassigned: result.filter((assignment) => !assignment.teacherUid),
  };
}

export function summarizeStaffingPlan(
  assignments: DistributedStaffingAssignment[],
  teachers: StaffingTeacher[],
  minimumPeriods = MIN_WEEKLY_TEACHING_PERIODS,
  maximumPeriods = MAX_WEEKLY_TEACHING_PERIODS,
): StaffingPlanSummary {
  const totalRequiredPeriods = assignments.reduce((total, assignment) => total + assignment.weeklyPeriods, 0);
  const totalAssignedPeriods = assignments.filter((assignment) => assignment.teacherUid).reduce((total, assignment) => total + assignment.weeklyPeriods, 0);
  const crossFieldPeriods = assignments.filter((assignment) => assignment.assignmentType === "cross-field").reduce((total, assignment) => total + assignment.weeklyPeriods, 0);
  const teacherSummaries = teachers.map((teacher) => {
    const assigned = assignments.filter((assignment) => assignment.teacherUid === teacher.uid);
    const weeklyPeriods = assigned.reduce((total, assignment) => total + assignment.weeklyPeriods, 0);
    const classCount = new Set(assigned.map((assignment) => assignment.classId)).size;
    const subjectCount = new Set(assigned.map((assignment) => assignment.subjectId)).size;
    const status = weeklyPeriods === 0 ? "unused" : weeklyPeriods < minimumPeriods ? "below-minimum" : weeklyPeriods > maximumPeriods ? "overloaded" : "balanced";
    return { uid: teacher.uid, weeklyPeriods, classCount, subjectCount, status } as const;
  });
  const subjectIds = [...new Set(assignments.map((assignment) => assignment.subjectId))];
  const subjectSummaries = subjectIds.map((subjectId) => {
    const required = assignments.filter((assignment) => assignment.subjectId === subjectId);
    const requiredPeriods = required.reduce((total, assignment) => total + assignment.weeklyPeriods, 0);
    const missingPeriods = required.filter((assignment) => !assignment.teacherUid).reduce((total, assignment) => total + assignment.weeklyPeriods, 0);
    const primaryTeacherCount = teachers.filter((teacher) => getTeacherQualification(teacher, subjectId) === "primary").length;
    const additionalTeacherCount = teachers.filter((teacher) => getTeacherQualification(teacher, subjectId) === "cross-field").length;
    const availableTeacherCount = primaryTeacherCount + additionalTeacherCount;
    const subjectCrossFieldPeriods = required.filter((assignment) => assignment.assignmentType === "cross-field").reduce((total, assignment) => total + assignment.weeklyPeriods, 0);
    const minimumTeacherCount = requiredPeriods ? Math.ceil(requiredPeriods / maximumPeriods) : 0;
    const shortageTeacherCount = missingPeriods ? Math.max(1, Math.ceil(missingPeriods / maximumPeriods)) : 0;
    const surplusTeacherCount = missingPeriods ? 0 : Math.max(0, primaryTeacherCount - minimumTeacherCount);
    return { subjectId, requiredPeriods, missingPeriods, availableTeacherCount, primaryTeacherCount, additionalTeacherCount, crossFieldPeriods: subjectCrossFieldPeriods, minimumTeacherCount, shortageTeacherCount, surplusTeacherCount };
  });
  const teacherCount = teachers.length;
  return {
    totalRequiredPeriods,
    totalAssignedPeriods,
    missingPeriods: totalRequiredPeriods - totalAssignedPeriods,
    crossFieldPeriods,
    averagePeriodsPerTeacher: teacherCount ? totalAssignedPeriods / teacherCount : 0,
    averageClassesPerTeacher: teacherCount ? teacherSummaries.reduce((total, teacher) => total + teacher.classCount, 0) / teacherCount : 0,
    teachers: teacherSummaries,
    subjects: subjectSummaries,
  };
}
