import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTelemetry } from '../context/TelemetryContext';
import { PrimaryButton, Screen, StatusChip } from '../components/ui';
import { colors, radii, spacing } from '../theme/tokens';
import { isSupabaseConfigured } from '../services/supabase';
import { thresholds, baselines } from '../theme/tokens';

export default function SettingsScreen() {
  const { user, signOut, isGuest } = useAuth();
  const { live, openAlerts, readings } = useTelemetry();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title}>Settings</Text>

        <Text style={styles.section}>Account</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>{user?.email || '—'}</Text>
          <View style={{ height: spacing.sm }} />
          <StatusChip
            tone={isGuest ? 'warning' : 'ok'}
            label={isGuest ? 'Guest (read-only resolve)' : 'Authenticated'}
          />
        </View>

        <Text style={styles.section}>Connection</Text>
        <View style={styles.card}>
          <Row label="Supabase configured" value={isSupabaseConfigured ? 'Yes' : 'No'} />
          <Row label="Realtime" value={live ? 'Subscribed' : 'Idle'} />
          <Row label="Cached readings" value={String(readings.length)} />
          <Row label="Open alerts" value={String(openAlerts.length)} />
        </View>

        <Text style={styles.section}>Agent thresholds (display)</Text>
        <View style={styles.card}>
          <Row label="Temp critical" value={`≥ ${thresholds.temperature} °C`} />
          <Row label="Humidity" value={`≥ ${thresholds.humidity} %`} />
          <Row label="Vibration" value={`≥ ${thresholds.vibration_hz} Hz`} />
          <Row label="Power" value={`≥ ${thresholds.power_w} W`} />
        </View>

        <Text style={styles.section}>Baselines (healthy idle)</Text>
        <View style={styles.card}>
          <Row label="Temperature" value={`${baselines.temperature} °C`} />
          <Row label="Humidity" value={`${baselines.humidity} %`} />
          <Row label="Vibration" value={`${baselines.vibration_hz} Hz`} />
          <Row label="Power" value={`${baselines.power_w} W`} />
        </View>

        <PrimaryButton
          label="Sign out"
          variant="danger"
          onPress={signOut}
        />

        <Text style={styles.footer}>
          Future Eagle IoT · Multi-Sensor AI Agent · Expo mobile client
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: spacing.lg,
  },
  section: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.inkFaint,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  label: {
    color: colors.inkFaint,
    fontSize: 12,
  },
  value: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 16,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rowLabel: {
    color: colors.inkMuted,
  },
  rowValue: {
    color: colors.ink,
    fontWeight: '600',
  },
  footer: {
    marginTop: spacing.xl,
    textAlign: 'center',
    color: colors.inkFaint,
    fontSize: 12,
  },
});
