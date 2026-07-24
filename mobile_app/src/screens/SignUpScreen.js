import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, radii, spacing } from '../theme/tokens';
import { PrimaryButton, Screen } from '../components/ui';

export default function SignUpScreen({ navigation }) {
  const { signUp, authError, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const [localError, setLocalError] = useState(null);

  const onSubmit = async () => {
    clearError();
    setLocalError(null);
    setInfo(null);
    if (!email.trim() || password.length < 6) {
      setLocalError('Use a valid email and password (min 6 characters).');
      return;
    }
    setBusy(true);
    const { data, error } = await signUp(email.trim(), password);
    setBusy(false);
    if (error) {
      setLocalError(error.message);
      return;
    }
    if (data?.session) {
      setInfo('Account created. You are signed in.');
    } else {
      setInfo('Check your email to confirm the account, then sign in.');
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.sub}>
            Operators use authenticated sessions to resolve alerts. Confirm email
            if your Supabase project requires it.
          </Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@plant.com"
            placeholderTextColor={colors.inkFaint}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="Min 6 characters"
            placeholderTextColor={colors.inkFaint}
          />

          {(localError || authError) && (
            <Text style={styles.error}>{localError || authError}</Text>
          )}
          {info ? <Text style={styles.info}>{info}</Text> : null}

          <PrimaryButton
            label={busy ? 'Creating…' : 'Sign up'}
            onPress={onSubmit}
            disabled={busy}
          />
          <View style={{ height: spacing.md }} />
          <PrimaryButton
            label="Back to sign in"
            variant="ghost"
            onPress={() => navigation.goBack()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.xl, paddingTop: spacing.xxl },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  sub: {
    color: colors.inkMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  label: {
    color: colors.inkMuted,
    fontWeight: '600',
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  error: { color: colors.critical, marginVertical: spacing.md },
  info: { color: colors.ok, marginVertical: spacing.md, lineHeight: 20 },
});
