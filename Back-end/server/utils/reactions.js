/**
 * Emoji reactions stored as `reactions: [{ emoji, users: [userId] }]` — shared
 * by team chat messages (repositories/chatRepository.js) and task comments
 * (repositories/staffTaskRepository.js).
 *
 * The change is ONE pipeline update, never read-modify-write: adding twice is one
 * reaction, removing twice is a no-op, and two people reacting at the same moment
 * cannot overwrite each other.
 */

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
// Every code point must belong to an emoji, and at least one must be a real
// picture (not just a digit, '#', or a lone skin-tone modifier).
const EMOJI_CHARS = /^[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;
const EMOJI_PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|⃣/u;

/** The emoji, if `raw` is exactly one emoji (one character as people see it); otherwise null. */
export function normalizeEmoji(raw) {
  if (typeof raw !== 'string') return null;
  const e = raw.trim();
  if (!e || e.length > 32 || !EMOJI_CHARS.test(e) || !EMOJI_PICTURE.test(e)) return null;
  let count = 0;
  for (const _ of segmenter.segment(e)) if (++count > 1) return null;
  return e;
}

/**
 * The `$set` pipeline stage that puts `userId`'s `emoji` on (`on`) or takes it
 * off. A new emoji is only added while there are fewer than `max` different
 * ones; the caller tells "capped" from "added" by looking at the result.
 */
export function reactionStage(userId, emoji, on, max) {
  const e = { $literal: emoji }; // never read as a field path
  const current = { $ifNull: ['$reactions', []] };
  const add = {
    $let: {
      vars: { r: current },
      in: {
        $cond: [
          { $in: [e, '$$r.emoji'] },
          {
            $map: {
              input: '$$r',
              as: 'x',
              in: {
                $cond: [
                  { $and: [{ $eq: ['$$x.emoji', e] }, { $not: [{ $in: [userId, '$$x.users'] }] }] },
                  { emoji: '$$x.emoji', users: { $concatArrays: ['$$x.users', [userId]] } },
                  '$$x',
                ],
              },
            },
          },
          { $cond: [{ $lt: [{ $size: '$$r' }, max] }, { $concatArrays: ['$$r', [{ emoji: e, users: [userId] }]] }, '$$r'] },
        ],
      },
    },
  };
  const remove = {
    $filter: {
      input: {
        $map: {
          input: current,
          as: 'x',
          in: { emoji: '$$x.emoji', users: { $filter: { input: '$$x.users', as: 'u', cond: { $ne: ['$$u', userId] } } } },
        },
      },
      as: 'y',
      cond: { $gt: [{ $size: '$$y.users' }, 0] },
    },
  };
  return { $set: { reactions: on ? add : remove } };
}
