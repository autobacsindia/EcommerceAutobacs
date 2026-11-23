/**
 * The face check, used for enrolment and for every punch.
 *
 *  1. Get a liveness challenge from OUR server (online), or — for a punch with
 *     no connection — take one saved earlier for offline use.
 *  2. Read the location (punch only). The phone shows what it read; the server decides.
 *  3. Frame 1 looking straight, then the server's random action (turn left /
 *     turn right / move closer), frame 2 after it.
 *  4. Online: upload to our backend (never an outside face API). Offline: keep
 *     the punch in the queue, frames in the app's private folder until sent.
 *  Frames are deleted from the phone as soon as the server has answered.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage, IS_MOCK, type AttendanceStatus, type Challenge, type Frame, type PunchType } from '../../src/api';
import { useEmployee } from '../../src/auth/session';
import { readLocation, shrinkFrame, type Reading } from '../../src/punch/capture';
import { challengePool, queue, usePunchQueue } from '../../src/punch/PunchProvider';
import { deleteFrames, keepFramesForQueue } from '../../src/punch/storage';
import { formatTime } from '../../src/lib/dates';
import { getDeviceId, newClientId, platform } from '../../src/lib/device';
import { distanceM } from '../../src/lib/format';
import { ACTION_PROMPT, PUNCH_DONE, refusalHelp } from '../../src/lib/labels';
import { colors, font, spacing } from '../../src/theme';
import { Button, T } from '../../src/ui';

type Step =
  | { kind: 'preparing' }
  | { kind: 'look' }
  | { kind: 'action' }
  | { kind: 'sending' }
  | { kind: 'done'; title: string; detail: string }
  | { kind: 'refused'; message: string; help: string | null; canReview: boolean }
  | { kind: 'error'; message: string; retry: boolean };

const LOOK_MS = 1600;
/** Demo preview only: a sample spot ~40 m from the demo showroom. */
const DEMO_READING: Reading = { lat: 9.9819, lng: 76.2999, accuracyM: 12, mocked: false };
const ACTION_MS = 2600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function FaceCheck() {
  const params = useLocalSearchParams<{ purpose: 'enrol' | 'punch'; type?: PunchType }>();
  const purpose = params.purpose === 'enrol' ? 'enrol' : 'punch';
  const punchType = (params.type ?? 'in') as PunchType;
  const employee = useEmployee();
  const qc = useQueryClient();
  const { reload } = usePunchQueue();
  const [perm, requestPerm] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'preparing' });
  const [action, setAction] = useState<Challenge['action'] | null>(null);
  const [gps, setGps] = useState<string | null>(null);
  const cancelled = useRef(false);
  // Reused on every retry of THIS punch, so a retry after a lost reply is one punch.
  const clientPunchId = useRef(newClientId());
  // Kept only while a "face did not match" answer is on screen (for "Ask HR to check").
  const reviewFrame = useRef<Frame | null>(null);

  const status = qc.getQueryData<AttendanceStatus>(['status']);
  const simulated = IS_MOCK && Platform.OS === 'web'; // demo preview: no real camera

  const close = useCallback(() => {
    cancelled.current = true;
    if (reviewFrame.current) void deleteFrames([reviewFrame.current]);
    reviewFrame.current = null;
    router.back();
  }, []);

  useEffect(() => () => {
    cancelled.current = true;
    if (reviewFrame.current) void deleteFrames([reviewFrame.current]);
  }, []);

  const snap = useCallback(async (): Promise<Frame> => {
    if (simulated) return { uri: 'demo://frame', mimeType: 'image/jpeg' };
    const pic = await camera.current?.takePictureAsync({ quality: 0.8, skipProcessing: false });
    if (!pic?.uri) throw new Error('The camera did not take a picture. Please try again.');
    return shrinkFrame(pic.uri);
  }, [simulated]);

  const describeGps = useCallback(
    (r: Reading) => {
      const sites = status?.sites ?? [];
      if (!sites.length) return 'Location read';
      const nearest = sites
        .map((s) => ({ s, d: distanceM(r, s) }))
        .sort((a, b) => a.d - b.d)[0];
      return nearest.d <= nearest.s.radiusM ? `Inside ${nearest.s.name} (about ${nearest.d} m)` : `About ${nearest.d} m from ${nearest.s.name}`;
    },
    [status?.sites],
  );

  const run = useCallback(async () => {
    cancelled.current = false;
    setStep({ kind: 'preparing' });
    let frames: Frame[] = [];
    try {
      // 1 + 2: challenge and location together.
      const [challengeResult, loc] = await Promise.all([
        api.challenge(purpose).then(
          (c) => ({ c, offline: false }),
          async (err) => {
            if (purpose === 'punch' && err instanceof ApiError && err.offline) {
              const saved = await challengePool.take(employee.id);
              if (saved) return { c: saved, offline: true };
              throw new ApiError(
                'No internet, and this phone has no saved offline check yet. Connect to the internet once, then you can clock in offline.',
                0,
                'OFFLINE',
              );
            }
            throw err;
          },
        ),
        purpose !== 'punch'
          ? Promise.resolve(null)
          : simulated
            ? Promise.resolve({ ok: true as const, reading: DEMO_READING })
            : readLocation(),
      ]);
      if (cancelled.current) return;
      if (loc && !loc.ok) {
        setStep({
          kind: 'error',
          retry: true,
          message:
            loc.reason === 'denied'
              ? 'Location permission is needed to clock in. Allow it in Settings.'
              : loc.reason === 'off'
                ? 'Turn on Location on your phone, then try again.'
                : 'Could not read your location. Step outside or near a window and try again.',
        });
        return;
      }
      const reading = loc?.ok ? loc.reading : null;
      const gpsText = reading ? describeGps(reading) : null;
      setGps(gpsText);
      const { c: challenge, offline } = challengeResult;
      setAction(challenge.action);

      // 3: the liveness frames.
      setStep({ kind: 'look' });
      await sleep(LOOK_MS);
      if (cancelled.current) return;
      frames.push(await snap());
      setStep({ kind: 'action' });
      await sleep(ACTION_MS);
      if (cancelled.current) return void deleteFrames(frames);
      frames.push(await snap());
      setStep({ kind: 'sending' });

      const deviceId = await getDeviceId();

      // 4a: enrolment.
      if (purpose === 'enrol') {
        await api.enrol(challenge.challengeId, frames, deviceId);
        await deleteFrames(frames);
        frames = [];
        void qc.invalidateQueries({ queryKey: ['status'] });
        setStep({ kind: 'done', title: 'Face check is set up', detail: 'From now on you clock in with a quick look at the camera.' });
        return;
      }

      const input = {
        clientPunchId: clientPunchId.current,
        type: punchType,
        lat: reading?.lat ?? null,
        lng: reading?.lng ?? null,
        accuracyM: reading?.accuracyM ?? null,
        mocked: reading?.mocked ?? false,
        deviceId,
        platform: platform(),
        offline,
        challengeId: challenge.challengeId,
        frames,
      };

      // 4b: no connection → keep it in the queue.
      if (offline) {
        await queue.enqueue(employee.id, { ...input, frames: keepFramesForQueue(frames) }, challenge);
        frames = [];
        await reload();
        setStep({
          kind: 'done',
          title: `${PUNCH_DONE[punchType]} at ${formatTime(new Date().toISOString())}`,
          detail: 'Saved on this phone. It will be sent as soon as you are online.',
        });
        return;
      }

      // 4c: online punch.
      try {
        const r = await api.punch(input);
        const sent = frames;
        frames = [];
        await deleteFrames(sent);
        void qc.invalidateQueries({ queryKey: ['status'] });
        void qc.invalidateQueries({ queryKey: ['month'] });
        const where = r.punch.geo.verdict === 'inside' && gpsText ? gpsText.replace(/ \(.*\)$/, '') : null;
        setStep({
          kind: 'done',
          title: `${PUNCH_DONE[punchType]} at ${formatTime(r.punch.at)}`,
          detail:
            r.punch.status === 'pending_review'
              ? 'Saved. HR will check this one.'
              : ['Face matched', where].filter(Boolean).join(' · '),
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          const canReview = err.extra.canRequestReview === true;
          // Keep ONE frame only if HR review is possible, and only while this answer is on screen.
          if (canReview) reviewFrame.current = frames[0];
          await deleteFrames(canReview ? frames.slice(1) : frames);
          frames = [];
          setStep({ kind: 'refused', message: err.message, help: refusalHelp(err.code), canReview });
          return;
        }
        throw err;
      }
    } catch (err) {
      await deleteFrames(frames);
      if (cancelled.current) return;
      setStep({ kind: 'error', message: errorMessage(err), retry: true });
    }
  }, [purpose, punchType, employee.id, snap, describeGps, qc, reload, simulated]);

  // Start once the camera is ready (or immediately in the demo preview).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (!(simulated || (perm?.granted && ready))) return;
    // Next tick, so the first frame of the camera screen paints before we start.
    const t = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      void run();
    }, 0);
    return () => clearTimeout(t);
  }, [perm?.granted, ready, run, simulated]);

  const askReview = async () => {
    const frame = reviewFrame.current;
    if (!frame) return;
    setStep({ kind: 'sending' });
    try {
      await api.requestReview(clientPunchId.current, frame);
      void qc.invalidateQueries({ queryKey: ['status'] });
      setStep({ kind: 'done', title: 'Sent to HR', detail: 'HR will look at the photo and approve your punch if it is you.' });
    } catch (err) {
      setStep({ kind: 'error', message: errorMessage(err), retry: false });
    } finally {
      await deleteFrames([frame]);
      reviewFrame.current = null;
    }
  };

  // ── permission ──
  if (!simulated && perm && !perm.granted) {
    return (
      <SafeAreaView style={[styles.cam, { justifyContent: 'center' }]}>
        <Ionicons name="camera-outline" size={40} color={colors.camText} />
        <Text style={styles.h}>Camera needed</Text>
        <Text style={styles.p}>The face check needs the front camera. Photos go only to Autobacs, never to anyone else.</Text>
        <Button label={perm.canAskAgain ? 'Allow camera' : 'Open Settings to allow'} variant="primary" onPress={() => void requestPerm()} style={{ alignSelf: 'stretch' }} />
        <Pressable onPress={close} style={styles.cancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── results ──
  if (step.kind === 'done' || step.kind === 'refused' || step.kind === 'error') {
    const ok = step.kind === 'done';
    return (
      <SafeAreaView style={styles.result}>
        <View style={[styles.tick, !ok && { backgroundColor: step.kind === 'refused' ? colors.bad : colors.warn }]}>
          <Ionicons name={ok ? 'checkmark' : step.kind === 'refused' ? 'close' : 'alert'} size={46} color={colors.white} />
        </View>
        <T kind="h1" style={{ textAlign: 'center' }}>
          {ok ? step.title : step.kind === 'refused' ? 'Not recorded' : 'Something went wrong'}
        </T>
        <T style={{ textAlign: 'center' }}>{ok ? step.detail : step.message}</T>
        {step.kind === 'refused' && step.help ? <T kind="small" style={{ textAlign: 'center' }}>{step.help}</T> : null}
        <View style={{ alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md }}>
          {step.kind === 'refused' && step.canReview ? (
            <Button label="Ask HR to check my photo" variant="primary" onPress={() => void askReview()} />
          ) : null}
          {!ok && (step.kind === 'refused' || step.retry) ? (
            <Button
              label="Try again"
              variant={step.kind === 'refused' && step.canReview ? 'outline' : 'primary'}
              onPress={() => {
                if (reviewFrame.current) void deleteFrames([reviewFrame.current]);
                reviewFrame.current = null;
                void run();
              }}
            />
          ) : null}
          <Button label={ok ? 'Done' : 'Close'} variant={ok ? 'primary' : 'ghost'} onPress={close} />
        </View>
      </SafeAreaView>
    );
  }

  // ── camera ──
  const stepIndex = step.kind === 'look' ? 1 : step.kind === 'action' ? 2 : step.kind === 'sending' ? 3 : 0;
  const message =
    step.kind === 'preparing'
      ? 'Getting ready…'
      : step.kind === 'look'
        ? 'Look straight at the camera'
        : step.kind === 'action' && action
          ? ACTION_PROMPT[action]
          : 'Checking it is you…';

  return (
    <SafeAreaView style={styles.cam}>
      <Text style={styles.h}>{purpose === 'enrol' ? 'Set up face check' : 'Look at the camera'}</Text>
      <View style={styles.steps}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={[styles.stepBar, i <= stepIndex && { backgroundColor: colors.greenOnDark }]} />
        ))}
      </View>
      <View style={styles.oval}>
        {simulated ? (
          <Ionicons name="person-outline" size={96} color={colors.camText} style={{ opacity: 0.5 }} />
        ) : (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" mirror={false} onCameraReady={() => setReady(true)} />
        )}
        {step.kind === 'sending' ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.white} size="large" />
          </View>
        ) : null}
      </View>
      <Text style={[styles.p, { fontFamily: font.bold, color: colors.white, fontSize: 16 }]} accessibilityLiveRegion="polite">
        {message}
      </Text>
      {purpose === 'punch' ? (
        <View style={styles.gps}>
          <Ionicons name="location" size={13} color={colors.greenOnDark} />
          <Text style={styles.gpsText}>{gps ? `Location checked · ${gps}` : 'Checking location…'}</Text>
        </View>
      ) : (
        <Text style={styles.p}>Only a face code is kept, locked on our server. The photos are deleted.</Text>
      )}
      <Pressable onPress={close} style={styles.cancel} accessibilityRole="button">
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cam: { flex: 1, backgroundColor: colors.cam, alignItems: 'center', paddingHorizontal: 22, paddingTop: 40, gap: 16 },
  h: { fontFamily: font.heading, fontSize: 18, color: colors.white, textAlign: 'center' },
  p: { fontFamily: font.regular, fontSize: 13.5, color: colors.camText, textAlign: 'center' },
  steps: { flexDirection: 'row', gap: 6 },
  stepBar: { width: 30, height: 5, borderRadius: 3, backgroundColor: '#3b4643' },
  oval: {
    width: 230,
    height: 296,
    borderRadius: 150,
    borderWidth: 4,
    borderColor: colors.greenOnDark,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222b29',
  },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,17,17,0.45)', alignItems: 'center', justifyContent: 'center' },
  gps: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1f2a27', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  gpsText: { fontFamily: font.medium, fontSize: 12, color: '#c9f0da' },
  cancel: { marginTop: 'auto', marginBottom: 16, borderWidth: 1, borderColor: '#4a5753', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 10 },
  cancelText: { fontFamily: font.bold, color: colors.white },
  result: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  tick: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
