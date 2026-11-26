/**
 * A tap-to-pick date (or time) field: the phone's own picker, never typing.
 *   Android  the system dialog (DateTimePickerAndroid)
 *   iOS      an inline calendar / spinner in a bottom sheet
 *   web      a plain text field (Expo web is a preview surface only)
 * Values stay the app's strings: 'YYYY-MM-DD' and 'HH:MM'.
 */
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { formatDay } from '../lib/dates';
import { dateToPicker, formatTime12, pickerToDate, pickerToTime, timeToPicker } from '../lib/pickers';
import { colors, font, radius, spacing } from '../theme';
import { Button, Field } from './index';

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mode?: 'date' | 'time';
  /** 'YYYY-MM-DD' bounds (date mode). */
  min?: string;
  max?: string;
  error?: string;
};

export function DateField({ label, value, onChange, mode = 'date', min, max, error }: Props) {
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(new Date());

  if (Platform.OS === 'web') {
    return (
      <Field
        label={mode === 'date' ? `${label} (YYYY-MM-DD)` : `${label} (HH:MM)`}
        value={value}
        onChangeText={onChange}
        error={error}
        autoCapitalize="none"
      />
    );
  }

  const current = mode === 'date' ? dateToPicker(value) : timeToPicker(value);
  const bounds = mode === 'date'
    ? { minimumDate: min ? dateToPicker(min) : undefined, maximumDate: max ? dateToPicker(max) : undefined }
    : {};
  const emit = (d: Date) => onChange(mode === 'date' ? pickerToDate(d) : pickerToTime(d));

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode,
        is24Hour: false,
        ...bounds,
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === 'set' && d) emit(d);
        },
      });
    } else {
      setDraft(current);
      setIosOpen(true);
    }
  };

  const shown = value ? (mode === 'date' ? formatDay(value) : formatTime12(value)) : 'Choose';

  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}. Tap to change`}
        style={[styles.box, error ? { borderColor: colors.bad } : null]}
      >
        <Text style={styles.value}>{shown}</Text>
        <Ionicons name={mode === 'date' ? 'calendar-outline' : 'time-outline'} size={18} color={colors.green} />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={iosOpen} transparent animationType="slide" onRequestClose={() => setIosOpen(false)}>
          <Pressable style={styles.scrim} onPress={() => setIosOpen(false)} accessibilityLabel="Close" />
          <View style={styles.sheet}>
            <DateTimePicker
              value={draft}
              mode={mode}
              display={mode === 'date' ? 'inline' : 'spinner'}
              themeVariant="light"
              accentColor={colors.green}
              {...bounds}
              onChange={(_e, d) => d && setDraft(d)}
            />
            <Button
              label="Done"
              variant="primary"
              onPress={() => {
                emit(draft);
                setIosOpen(false);
              }}
            />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  box: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  value: { fontFamily: font.medium, fontSize: 15, color: colors.ink },
  error: { fontFamily: font.regular, fontSize: 12.5, color: colors.bad },
  scrim: { flex: 1, backgroundColor: 'rgba(15,17,17,0.35)' },
  sheet: { backgroundColor: colors.card, padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
});
