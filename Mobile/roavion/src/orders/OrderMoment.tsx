/**
 * The picture + words at the top of an order ("order moments", the owner-picked
 * "Boxy" style, 2026-11-26) — the app twin of the website's
 * Front-end/web/src/components/orders/OrderMoment.tsx.
 *
 * Which moment it is comes from the server (`order.moment`); this only draws and
 * words it.
 *   • plays once per new update per phone; repeat visits show the still picture
 *   • the phone's "reduce motion" setting → still picture
 *   • the words are real native text (read by screen readers); the drawing is decoration
 *   • the scene box is a fixed 16:9, so nothing jumps while it loads
 *   • the team's note is plain text, never put into the drawing
 */
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing, type } from '../theme';
import { useReduceMotion } from '../ui';
import { momentCopy, momentSignature, type MomentTone, type OrderMomentData } from './momentCopy';
import { usePlayOnce } from './momentMemory';
import { SCENE_BG } from './momentHtml';
import MomentScene from './MomentScene';

// The app's own pill tones (theme.ts allows only brand hues): go = green,
// care = gold, calm = grey. The website uses its own palette for the same three.
const TONE: Record<MomentTone, { bg: string; fg: string }> = {
  go: { bg: colors.greenSoft, fg: colors.green },
  care: { bg: colors.goldSoft, fg: colors.ink2 },
  calm: { bg: colors.page, fg: colors.muted },
};

export function OrderMoment({ orderId, moment, shipped = false }: {
  orderId: string;
  moment: OrderMomentData;
  /** At least one parcel is with the courier (from the order's `progress`). */
  shipped?: boolean;
}) {
  const reduce = useReduceMotion();
  const signature = momentSignature(moment);
  const play = usePlayOnce(orderId, signature);
  const copy = momentCopy(moment, { shipped });
  const tone = TONE[copy.tone];

  return (
    <View style={s.card} testID="order-moment" accessibilityLabel="Order update">
      <View style={s.scene}>
        {play !== 'pending' && <MomentScene moment={moment} still={reduce || play === 'still'} />}
      </View>
      <View style={s.words} accessibilityLiveRegion="polite">
        <View style={[s.chip, { backgroundColor: tone.bg }]}>
          <Text style={[s.chipText, { color: tone.fg }]}>{copy.chip.toUpperCase()}</Text>
        </View>
        <Text style={s.title} accessibilityRole="header" testID="order-moment-title">{copy.title}</Text>
        <Text style={s.body} testID="order-moment-body">{copy.body}</Text>
        {copy.note ? (
          <View style={s.note}>
            <Text style={s.noteText} testID="order-moment-note">
              <Text style={s.noteLead}>Update from our team: </Text>
              {copy.note}
            </Text>
          </View>
        ) : null}
        {copy.updated ? <Text style={s.updated} testID="order-moment-updated">{copy.updated}</Text> : null}
        {copy.steps ? (
          <View style={s.steps} accessibilityLabel="Return steps">
            {copy.steps.labels.map((label, i) => {
              const at = copy.steps!.at;
              const state = i < at ? 'done' : i === at ? 'now' : 'todo';
              return (
                <View
                  key={label}
                  style={[s.step, state === 'now' && s.stepNow, state === 'done' && s.stepDone]}
                  accessibilityState={{ selected: state === 'now' }}
                >
                  <Text style={[s.stepText, state === 'now' && s.stepTextNow, state === 'todo' && s.stepTextTodo]}>{label}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  scene: { width: '100%', aspectRatio: 16 / 9, backgroundColor: SCENE_BG },
  words: { padding: spacing.lg, gap: spacing.sm },
  chip: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.9 },
  title: { ...type.h1, fontSize: 20, lineHeight: 26 },
  body: { ...type.small, fontSize: 14, lineHeight: 20 },
  note: {
    borderLeftWidth: 2,
    borderLeftColor: colors.gold,
    backgroundColor: colors.page,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noteText: { ...type.small, fontSize: 14, lineHeight: 20, color: colors.ink },
  noteLead: { color: colors.muted },
  updated: { ...type.caption },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs },
  step: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  stepNow: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  stepDone: { backgroundColor: colors.page },
  stepText: { fontFamily: font.medium, fontSize: 12, color: colors.ink },
  stepTextNow: { fontFamily: font.bold, color: colors.green },
  stepTextTodo: { color: colors.muted },
});
