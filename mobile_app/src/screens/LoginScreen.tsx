import React, { useState, type ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../services/api';
import { colors, radii, spacing } from '../theme/tokens';
import type { AuthStackParamList } from '../types/models';
import { PrimaryButton, Screen } from '../components/ui';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props): ReactElement {
  const { signIn, authError, clearError } = useAuth();
  const [email, setEmail] = useState('admin@future-eagle.io');
  const [password, setPassword] = useState('DemoPassword123!');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

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
          <Text style={styles.brand}>Future Eagle IIoT SaaS</Text>
          <Text style={styles.title}>Field Ops Console</Text>
          <Text style={styles.sub}>
            Multi-tenant industrial monitoring connected to {API_URL}.
          </Text>

          <Text style={styles.label}>Work Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            placeholder="manager@acme-plant.io"
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

          <View style={{ height: spacing.md }} />
          <PrimaryButton
            label={busy ? 'Signing in…' : 'Sign in'}
            onPress={() => void onSubmit()}
            disabled={busy}
          />

          <View style={{ height: spacing.md }} />
          <PrimaryButton
            label="Create factory workspace"
            variant="ghost"
            onPress={() => navigation.navigate('SignUp')}
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
    fontSize: 30,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  sub: {
    color: colors.inkMuted,
    fontSize: 14,
    lineHeight: 20,
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
});
