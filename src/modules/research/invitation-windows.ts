import type { InvitationRow } from '../../db/schema.js';
import { isExcludedCohort } from '../sources/access.js';

/** Completed equal-duration windows only; never infer a legacy response timestamp. */
export function invitationWindows(rows: { invitation: InvitationRow; authorCohort: string | null }[], provenance: string, now: Date) {
  const groups = new Map<string, { cohort: string; duration_ms: number; eligible_denominator: number; accepted_in_window: number; declined_in_window: number; other_responses_in_window: number; late_responses: number; no_response: number; unknown_response_time: number }>();
  let invalidWindows = 0;
  for (const { invitation: i, authorCohort } of rows) {
    if (!i.observationDeadline) continue;
    const duration = i.observationDeadline.getTime() - i.sentAt.getTime();
    if (duration <= 0) { invalidWindows++; continue; }
    if (i.observationDeadline > now || provenance !== 'real_authorized' || isExcludedCohort(authorCohort ?? 'unassigned')) continue;
    const cohort = authorCohort!;
    const key = JSON.stringify([cohort, duration]);
    const group = groups.get(key) ?? { cohort, duration_ms: duration, eligible_denominator: 0, accepted_in_window: 0, declined_in_window: 0, other_responses_in_window: 0, late_responses: 0, no_response: 0, unknown_response_time: 0 };
    groups.set(key, group);
    const noResponse = ['pending', 'no_response_in_window'].includes(i.result);
    if ((!noResponse && !i.respondedAt) || (i.respondedAt && (i.respondedAt < i.sentAt || i.respondedAt > now || noResponse))) { group.unknown_response_time++; continue; }
    group.eligible_denominator++;
    if (!i.respondedAt) group.no_response++;
    else if (i.respondedAt > i.observationDeadline) group.late_responses++;
    else if (i.result === 'accepted') group.accepted_in_window++;
    else if (i.result === 'declined') group.declined_in_window++;
    else group.other_responses_in_window++;
  }
  return { invalid_windows: invalidWindows, groups: [...groups.values()].sort((a, b) => a.cohort.localeCompare(b.cohort) || a.duration_ms - b.duration_ms).map(g => ({ ...g, acceptance_ratio: g.eligible_denominator ? g.accepted_in_window / g.eligible_denominator : null })) };
}
