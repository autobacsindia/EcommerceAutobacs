import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Logo, Screen, T, type IconName } from '../src/ui';
import { colors, radius, spacing } from '../src/theme';

const POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'pricetag-outline', title: 'You set your cost', body: 'Tell us what you want per unit, before GST. That is what you get paid.' },
  { icon: 'shield-checkmark-outline', title: 'We check, then list', body: 'Our procurement team checks every product before customers see it.' },
  { icon: 'cube-outline', title: 'Keep stock simple', body: 'Mark each product In, Low or Out of stock with one tap.' },
];

export default function Welcome() {
  return (
    <Screen
      edges={['top', 'bottom']}
      footer={
        <>
          <Button label="Create an account" onPress={() => router.push('/sign-up')} />
          <Button label="I already have an account" variant="ghost" onPress={() => router.push('/sign-in')} />
        </>
      }
    >
      <Logo size={48} style={{ marginTop: spacing.lg }} />
      <T kind="display" style={{ marginTop: spacing.xxl }}>
        Sell with Autobacs
      </T>
      <T style={{ marginTop: spacing.sm }}>
        List your car parts and accessories on autobacsindia.com. Sign up, send your GST and bank details, and start adding products once we approve you.
      </T>
      <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
        {POINTS.map((p) => (
          <View key={p.title} style={styles.point}>
            <View style={styles.icon}>
              <Ionicons name={p.icon} size={22} color={colors.green} />
            </View>
            <View style={{ flex: 1 }}>
              <T kind="bodyBold">{p.title}</T>
              <T kind="small">{p.body}</T>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  point: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
});
