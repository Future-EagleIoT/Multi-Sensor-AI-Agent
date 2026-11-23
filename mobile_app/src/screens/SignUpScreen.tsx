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
import { colors, radii, spacing } from '../theme/tokens';
import type { AuthStackParamList } from '../types/models';
import { PrimaryButton, Screen } from '../components/ui';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

export default function SignUpScreen({ navigation }: Props): ReactElement {
  const { signUp, authError, clearError } = useAuth();
  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const onSubmit = async () => {
    clearError();
    setLocalError(null);
    if (!orgName.trim() || !fullName.trim() || !email.trim() || password.length < 8) {
      setLocalError('Fill all fields (password min 8 characters).');
      return;
    }
    setBusy(true);
    const { error } = await signUp(email.trim(), fullName.trim(), password, orgName.trim());
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
          <Text style={styles.title}>New Factory Tenant</Text>
          <Text style={styles.sub}>
            Creates an isolated organization with PostgreSQL Row-Level Security.
          </Text>

          <Text style={styles.label}>Company / Plant Name</Text>
          <TextInput
            style={styles.input}
            value={orgName}
            onChangeText={setOrgName}
            placeholder="Apex Steel Works"
            placeholderTextColor={colors.inkFaint}
          />

          <Text style={styles.label}>Your Full Name</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Maria Silva"
            placeholderTextColor={colors.inkFaint}
          />

          <Text style={styles.label}>Work Email</Text>
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
            placeholder="Min 8 characters"
            placeholderTextColor={colors.inkFaint}
          />

          {(localError || authError) && (
            <Text style={styles.error}>{localError || authError}</Text>
          )}

          <View style={{ height: spacing.md }} />
          <PrimaryButton
            label={busy ? 'Creating…' : 'Create Workspace'}
            onPress={() => void onSubmit()}
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
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.lg,
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
});
