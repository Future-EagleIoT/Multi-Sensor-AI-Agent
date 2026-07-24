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

export default function LoginScreen({ navigation }) {
  const { signIn, continueAsGuest, authError, clearError, isConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  const onSubmit = async () => {
    clearError();
    setLocalError(null);
    if (!email.trim() || !password) {
      setLocalError('Enter email and password.');
      return;
    }
    setBusy(true);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) setLocalError(error.message);
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>Future Eagle IoT</Text>
          <Text style={styles.title}>Motor Health</Text>
          <Text style={styles.sub}>
            Sign in to monitor live telemetry, AI alerts, and device status.
          </Text>

          {!isConfigured ? (
            <View style={styles.warnBox}>
              <Text style={styles.warnTitle}>Configure Supabase</Text>
              <Text style={styles.warnBody}>
                Copy mobile_app/.env.example to .env and set EXPO_PUBLIC_SUPABASE_URL
                and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart Expo.
              </Text>
            </View>
          ) : null}

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
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
            placeholder="••••••••"
            placeholderTextColor={colors.inkFaint}
          />

          {(localError || authError) && (
            <Text style={styles.error}>{localError || authError}</Text>
          )}

          <PrimaryButton
            label={busy ? 'Signing in…' : 'Sign in'}
            onPress={onSubmit}
            disabled={busy || !isConfigured}
          />

          <View style={{ height: spacing.md }} />
          <PrimaryButton
            label="Create account"
            variant="ghost"
            onPress={() => navigation.navigate('SignUp')}
            disabled={!isConfigured}
          />

          <View style={{ height: spacing.md }} />
          <PrimaryButton
            label="Continue as guest"
            variant="ghost"
            onPress={continueAsGuest}
            disabled={!isConfigured}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: spacing.xl,
    paddingTop: spacing.xxl,
  },
  brand: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 32,
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
  error: {
    color: colors.critical,
    marginVertical: spacing.md,
  },
  warnBox: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  warnTitle: {
    fontWeight: '700',
    color: colors.warning,
    marginBottom: 4,
  },
  warnBody: {
    color: colors.inkMuted,
    lineHeight: 20,
    fontSize: 13,
  },
});
