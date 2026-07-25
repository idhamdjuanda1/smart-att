export const SCHOOL_DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;

export type SchoolDay = typeof SCHOOL_DAYS[number];

export type TeachingAssignmentInput = {
  id: string;
  teacherUid: string;
  subjectId: string;
  classId: string;
  weeklyPeriods: number;
};

export type ScheduleConfig = {
  days: SchoolDay[];
  dayStartTime: string;
  periodMinutes: number;
  periodsPerDay: number;
  breaks?: ScheduleBreak[];
};

export type ScheduleBreak = {
  /** One-based JP number after which the break begins. */
  afterPeriod: number;
  durationMinutes: number;
  label?: string;
};

export type GeneratedSchedule = {
  id: string;
  teachingAssignmentId: string;
  teacherUid: string;
  teacherId: string;
  subjectId: string;
  classId: string;
  day: SchoolDay;
  periodStart: number;
  periodCount: number;
  startTime: string;
  endTime: string;
  status: "draft";
};

export type GenerationFailure = {
  assignmentId: string;
  missingPeriods: number;
  reason: string;
};

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function minutesToTime(value: number) {
  const hour = Math.floor(value / 60) % 24;
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function scheduleTimes(config: ScheduleConfig, periodStart: number, periodCount: number) {
  const breakMinutesBefore = (config.breaks ?? [])
    .filter((item) => item.afterPeriod <= periodStart && item.durationMinutes > 0)
    .reduce((total, item) => total + item.durationMinutes, 0);
  const start = timeToMinutes(config.dayStartTime) + periodStart * config.periodMinutes + breakMinutesBefore;
  return { startTime: minutesToTime(start), endTime: minutesToTime(start + periodCount * config.periodMinutes) };
}

export function scheduleBlockCrossesBreak(config: ScheduleConfig, periodStart: number, periodCount: number) {
  const periodEnd = periodStart + periodCount;
  return (config.breaks ?? []).some((item) => item.durationMinutes > 0 && item.afterPeriod > periodStart && item.afterPeriod < periodEnd);
}

export function scheduleBreakTimes(config: ScheduleConfig, item: ScheduleBreak) {
  const previousBreakMinutes = (config.breaks ?? [])
    .filter((entry) => entry !== item && entry.durationMinutes > 0 && entry.afterPeriod <= item.afterPeriod)
    .reduce((total, entry) => total + entry.durationMinutes, 0);
  const start = timeToMinutes(config.dayStartTime) + item.afterPeriod * config.periodMinutes + previousBreakMinutes;
  return { startTime: minutesToTime(start), endTime: minutesToTime(start + item.durationMinutes) };
}

export function schedulesOverlap(first: { day: string; startTime: string; endTime: string }, second: { day: string; startTime: string; endTime: string }) {
  return first.day === second.day && first.startTime < second.endTime && first.endTime > second.startTime;
}

export function findScheduleConflict<T extends { id?: string; day: string; startTime: string; endTime: string; teacherUid: string; classId: string }>(candidate: T, schedules: T[], excludeId?: string) {
  return schedules.find((item) => item.id !== excludeId && schedulesOverlap(candidate, item) && (item.teacherUid === candidate.teacherUid || item.classId === candidate.classId));
}

export function getScheduleReadiness(assignments: TeachingAssignmentInput[], classIds: string[], subjectIds: string[], teacherIds: string[], capacityPerTeacher: number) {
  const teacherSet = new Set(teacherIds);
  const classSet = new Set(classIds);
  const subjectSet = new Set(subjectIds);
  const missingTeacherAssignments = assignments.filter((item) => !item.teacherUid || !teacherSet.has(item.teacherUid));
  const invalidAssignments = assignments.filter((item) => !classSet.has(item.classId) || !subjectSet.has(item.subjectId) || item.weeklyPeriods < 1);
  const classesWithoutAssignments = classIds.filter((classId) => !assignments.some((item) => item.classId === classId));
  const teacherLoads = new Map<string, number>();
  for (const assignment of assignments) {
    if (!assignment.teacherUid) continue;
    teacherLoads.set(assignment.teacherUid, (teacherLoads.get(assignment.teacherUid) ?? 0) + assignment.weeklyPeriods);
  }
  const overloadedTeachers = [...teacherLoads.entries()].filter(([, periods]) => periods > capacityPerTeacher).map(([teacherUid, periods]) => ({ teacherUid, periods, excess: periods - capacityPerTeacher }));
  return {
    ready: assignments.length > 0 && !missingTeacherAssignments.length && !invalidAssignments.length && !classesWithoutAssignments.length && !overloadedTeachers.length,
    totalRequiredPeriods: assignments.reduce((total, item) => total + Math.max(0, item.weeklyPeriods), 0),
    missingTeacherAssignments,
    invalidAssignments,
    classesWithoutAssignments,
    overloadedTeachers,
    teacherLoads,
  };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function generateScheduleAttempt(assignments: TeachingAssignmentInput[], config: ScheduleConfig, attempt: number) {
  const generated: GeneratedSchedule[] = [];
  const failures: GenerationFailure[] = [];
  const occupiedTeacher = new Set<string>();
  const occupiedClass = new Set<string>();
  const assignmentDayPeriods = new Map<string, Map<string, number>>();
  const dayLoads = new Map<string, number>();
  const slotKey = (id: string, day: string, period: number) => `${id}\u0001${day}\u0001${period}`;

  const ordered = [...assignments].filter((item) => item.teacherUid && item.weeklyPeriods > 0).sort((a, b) => b.weeklyPeriods - a.weeklyPeriods || stableHash(`${attempt}:${a.id}`) - stableHash(`${attempt}:${b.id}`));
  for (const assignment of ordered) {
    let remaining = assignment.weeklyPeriods;
    let blockIndex = 0;
    while (remaining > 0) {
      const preferredBlock = Math.min(2, remaining);
      let chosen: { day: SchoolDay; start: number; count: number; score: number } | undefined;
      for (const count of preferredBlock === 2 ? [2, 1] : [1]) {
        const candidates: { day: SchoolDay; start: number; count: number; score: number }[] = [];
        for (const day of config.days) {
          for (let start = 0; start <= config.periodsPerDay - count; start += 1) {
            if (scheduleBlockCrossesBreak(config, start, count)) continue;
            let free = true;
            for (let period = start; period < start + count; period += 1) {
              if (occupiedTeacher.has(slotKey(assignment.teacherUid, day, period)) || occupiedClass.has(slotKey(assignment.classId, day, period))) { free = false; break; }
            }
            if (!free) continue;
            const sameAssignmentDay = assignmentDayPeriods.get(assignment.id)?.get(day) ?? 0;
            const load = dayLoads.get(`${assignment.classId}\u0001${day}`) ?? 0;
            const timePreference = attempt % 2 === 0 ? start : config.periodsPerDay - start;
            candidates.push({ day, start, count, score: sameAssignmentDay * 1000 + load * 20 + timePreference });
          }
        }
        const dayRank = (day: SchoolDay) => (config.days.indexOf(day) - attempt + config.days.length * 100) % config.days.length;
        candidates.sort((a, b) => a.score - b.score || dayRank(a.day) - dayRank(b.day) || stableHash(`${attempt}:${assignment.id}:${a.day}:${a.start}`) - stableHash(`${attempt}:${assignment.id}:${b.day}:${b.start}`));
        chosen = candidates[0];
        if (chosen) break;
      }
      if (!chosen) {
        failures.push({ assignmentId: assignment.id, missingPeriods: remaining, reason: "Tidak ada slot bebas untuk guru dan kelas." });
        break;
      }
      const times = scheduleTimes(config, chosen.start, chosen.count);
      generated.push({ id: `draft_${assignment.id}_${blockIndex}`, teachingAssignmentId: assignment.id, teacherUid: assignment.teacherUid, teacherId: assignment.teacherUid, subjectId: assignment.subjectId, classId: assignment.classId, day: chosen.day, periodStart: chosen.start, periodCount: chosen.count, ...times, status: "draft" });
      for (let period = chosen.start; period < chosen.start + chosen.count; period += 1) {
        occupiedTeacher.add(slotKey(assignment.teacherUid, chosen.day, period));
        occupiedClass.add(slotKey(assignment.classId, chosen.day, period));
      }
      const perDay = assignmentDayPeriods.get(assignment.id) ?? new Map<string, number>();
      perDay.set(chosen.day, (perDay.get(chosen.day) ?? 0) + chosen.count);
      assignmentDayPeriods.set(assignment.id, perDay);
      const loadKey = `${assignment.classId}\u0001${chosen.day}`;
      dayLoads.set(loadKey, (dayLoads.get(loadKey) ?? 0) + chosen.count);
      remaining -= chosen.count;
      blockIndex += 1;
    }
  }
  return { schedules: generated, failures };
}

export function generateSchoolSchedule(assignments: TeachingAssignmentInput[], config: ScheduleConfig) {
  let best = generateScheduleAttempt(assignments, config, 0);
  const missingPeriods = (result: ReturnType<typeof generateScheduleAttempt>) => result.failures.reduce((total, item) => total + item.missingPeriods, 0);
  if (!best.failures.length) return best;
  for (let attempt = 1; attempt < 32; attempt += 1) {
    const candidate = generateScheduleAttempt(assignments, config, attempt);
    if (!candidate.failures.length) return candidate;
    if (missingPeriods(candidate) < missingPeriods(best) || (missingPeriods(candidate) === missingPeriods(best) && candidate.schedules.length > best.schedules.length)) best = candidate;
  }
  return best;
}
