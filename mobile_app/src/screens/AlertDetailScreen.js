import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTelemetry } from '../context/TelemetryContext';
import { useAuth } from '../context/AuthContext';
import { PrimaryButton, Screen, StatusChip } from '../components/ui';
import { colors, radii, spacing } from '../theme/tokens';
import { formatDateTime } from '../utils/format';
import { severityTone } from '../utils/health';

export default function AlertDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const { alerts, resolveAlert } = useTelemetry();
  const { isGuest } = useAuth();
  const [busy, setBusy] = useState(false);

  const alert = useMemo(
    () => alerts.find((a) => String(a.id) === String(id)),
    [alerts, id],
  );

  if (!alert) {
    return (
      <Screen>
        <View style={styles.wrap}>
          <Text style={styles.title}>Alert not found</Text>
          <PrimaryButton label="Back" variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  const onResolve = async () => {
    if (isGuest) return;
    setBusy(true);
    await resolveAlert(alert.id);
    setBusy(false);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.wrap}>
        <View style={styles.row}>
          <Text style={styles.device}>{alert.device_id}</Text>
          <StatusChip
            tone={alert.is_resolved ? 'ok' : severityTone(alert.severity)}
            label={alert.is_resolved ? 'Resolved' : alert.severity}
          />
        </View>
        <Text style={styles.time}>{formatDateTime(alert.timestamp)}</Text>

        <Text style={styles.section}>AI analysis</Text>
        <View style={styles.card}>
          <Text style={styles.message}>{alert.message}</Text>
        </View>

        {!alert.is_resolved && (
          <>
            {isGuest ? (
              <Text style={styles.hint}>
                Sign in with an authenticated account to resolve alerts (RLS update policy).
              </Text>
            ) : (
              <PrimaryButton
                label={busy ? 'Resolving…' : 'Mark resolved'}
                onPress={onResolve}
                disabled={busy}
              />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  device: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
    flex: 1,
    paddingRight: spacing.sm,
  },
  time: { color: colors.inkFaint, marginBottom: spacing.xl },
  section: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.inkFaint,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  message: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  hint: {
    color: colors.inkMuted,
    lineHeight: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.lg,
    color: colors.ink,
  },
});
