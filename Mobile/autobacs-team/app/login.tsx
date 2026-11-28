import { useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '../src/api';
import { useSession } from '../src/auth/session';
import { colors, spacing } from '../src/theme';
import { Button, Card, Field, Logo, Screen, T } from '../src/ui';

export default function Login() {
  const { signIn } = useSession();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!id.trim() || !password) {
      setError('Type your email or username and your password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(id, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ paddingTop: spacing.xxl, gap: spacing.xl }}>
      <Logo size={44} />
      <View style={{ gap: 4 }}>
        <T kind="h1">Sign in</T>
        <T kind="small">Use the same staff login you use for the Autobacs team panel.</T>
      </View>
      <Card style={{ gap: spacing.md }}>
        <Field
          label="Email or username"
          value={id}
          onChangeText={setId}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        {error ? <T style={{ color: colors.bad }}>{error}</T> : null}
        <Button label="Sign in" variant="primary" loading={busy} onPress={() => void submit()} />
      </Card>
      <T kind="small" style={{ textAlign: 'center' }}>
        Forgot your password? Ask HR or your team head to reset it.
      </T>
    </Screen>
  );
}
