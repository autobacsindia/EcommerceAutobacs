/**
 * "Vicky added you to Vicky's Hilux": the moment someone is put on a project.
 *
 * Called by services/staffProjectService.js after a project is created, or its
 * people changed, and the write has landed. Each newly added person (never the
 * one who did it) gets:
 *   - an Inbox line (models/StaffTaskInbox.js, kind 'project_added') — also what
 *     the panel's "new work" pop-up reads (notificationService.summaryFor alerts)
 *   - a phone/computer notification (pushService), when they have switched it on
 *
 * ── Once, never twice ───────────────────────────────────────────────────────
 * The Inbox key is `p:<project>:in:<user>:r<rev>` — the rev the change made is
 * unique to that change, so a retried request (which the rev check refuses
 * anyway) or a doubled call writes nothing more, and the notification follows
 * the Inbox write: a person whose line already existed is not notified again.
 * Being taken off and put back on later is a new change (a new rev): told again.
 *
 * Best effort, like the task pop-ups: the project is already saved, so a lost
 * notice never undoes it, and this never throws.
 */
import staffTaskInboxRepository from '../repositories/staffTaskInboxRepository.js';
import userRepository from '../repositories/userRepository.js';
import { sendToUsers } from './pushService.js';

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const isAdmin = (u) => u?.role === 'admin';

/** Where the project opens for `u`: the admin has their own panel. */
export const projectUrl = (u, projectId) =>
  `${isAdmin(u) ? '/admin/tasks' : '/team/tasks'}?view=project&project=${encodeURIComponent(idOf(projectId))}`;

export const addedKey = (project, userId) => `p:${idOf(project._id)}:in:${idOf(userId)}:r${project.rev ?? 0}`;

/** "Vicky's Hilux · deadline 2026-11-28" / "… · you own it". */
function lineText(project, userId) {
  const bits = [];
  if (idOf(project.owner?.user) === idOf(userId)) bits.push('you own it');
  if (project.dueOn) bits.push(`deadline ${project.dueOn}`);
  return bits.join(' · ');
}

/**
 * Tell `userIds` they are now on `project` (the saved document, with its rev).
 * Returns how many people were newly told (for the tests and the log).
 */
export async function notifyAddedToProject(project, actor, userIds, { send = sendToUsers } = {}) {
  try {
    const wanted = [...new Set((userIds || []).map(idOf))].filter((x) => x && x !== idOf(actor?._id));
    if (!wanted.length) return 0;
    // Only people still in the panel: a deactivated account gets nothing.
    const people = await userRepository.findChatUsersByIds(wanted);
    if (!people.length) return 0;
    const fresh = [];
    for (const u of people) {
      const row = {
        user: u._id,
        key: addedKey(project, u._id),
        kind: 'project_added',
        project: project._id,
        title: project.name,
        by: actor?._id || null,
        byName: actor?.name || '',
        text: lineText(project, u._id).slice(0, 200),
      };
      // One at a time so we know exactly who is new: a duplicate key means told already.
      if (await staffTaskInboxRepository.insertMany([row])) fresh.push(u);
    }
    if (!fresh.length) return 0;
    const who = actor?.name || 'Someone';
    await send(
      fresh.map((u) => ({ userId: idOf(u._id), url: projectUrl(u, project._id) })),
      {
        title: `${who} added you to a project`,
        body: `${project.name}${project.dueOn ? ` · deadline ${project.dueOn}` : ''}`,
        tag: `project-${idOf(project._id)}`,
      },
    );
    return fresh.length;
  } catch (err) {
    console.error('[ProjectAlert] added-to-project notice failed (ignored):', err.message);
    return 0;
  }
}
