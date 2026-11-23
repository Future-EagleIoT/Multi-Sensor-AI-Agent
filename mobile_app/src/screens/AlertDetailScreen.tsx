import React, { useMemo, useState, type ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTelemetry } from '../context/TelemetryContext';
import { PrimaryButton, Screen, StatusChip } from '../components/ui';
import { colors, radii, spacing } from '../theme/tokens';
import type { AlertStatus, RootStackParamList } from '../types/models';
import { formatDateTime } from '../utils/format';
import { severityTone } from '../utils/health';

type Props = NativeStackScreenProps<RootStackParamList, 'AlertDetail'>;

export default function AlertDetailScreen({ route, navigation }: Props): ReactElement {
  const { id } = route.params;
  const { assets, alerts, updateAlertStatus } = useTelemetry();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const alert = useMemo(
    () => alerts.find((a) => String(a.id) === String(id)),
    [alerts, id],
  );
  const assetName = useMemo(
    () => assets.find((a) => a.id === alert?.asset_id)?.name || alert?.asset_id || '',
    [assets, alert],
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

  const resolved = ['resolved', 'false_positive'].includes(alert.status);
  const diag = alert.ai_diagnosis;

  const setStatus = async (nextStatus: AlertStatus) => {
    setBusy(true);
    await updateAlertStatus(alert.id, nextStatus, notes.trim() || undefined);
    setBusy(false);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.wrap}>
        <View style={styles.row}>
          <Text style={styles.device}>{assetName}</Text>
          <StatusChip
            tone={resolved ? 'ok' : severityTone(alert.severity)}
            label={resolved ? alert.status : alert.severity}
          />
        </View>
        <Text style={styles.time}>{formatDateTime(alert.created_at)}</Text>

        <Text style={styles.section}>Trigger</Text>
        <View style={styles.card}>
          <Text style={styles.message}>{alert.trigger_reason}</Text>
        </View>

        <Text style={styles.section}>AI Copilot Diagnosis</Text>
        <View style={styles.card}>
          {diag ? (
            <>
              <Text style={styles.message}>{diag.summary}</Text>
              <Text style={styles.subLabel}>Probable Root Cause</Text>
              <Text style={styles.subBody}>{diag.probable_root_cause}</Text>
              {diag.cited_manual_section ? (
                <>
                  <Text style={styles.subLabel}>Manual Citation (RAG)</Text>
                  <Text style={styles.subBody}>{diag.cited_manual_section}</Text>
                </>
              ) : null}
              <Text style={styles.subLabel}>Immediate Actions</Text>
              {(diag.immediate_actions ?? []).map((step, i) => (
                <Text key={i} style={styles.step}>
                  • {step}
                </Text>
              ))}
              <Text style={styles.safety}>Safety: {diag.safety_precaution}</Text>
            </>
          ) : (
            <Text style={styles.subBody}>AI enrichment in progress…</Text>
          )}
        </View>

        {!resolved && (
          <>
            <Text style={styles.section}>Technician Notes</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Inspected DE bearing, re-greased coupling"
              placeholderTextColor={colors.inkFaint}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
            <View style={{ height: spacing.md }} />
            {alert.status === 'open' && (
              <>
                <PrimaryButton
                  label="Acknowledge"
                  variant="ghost"
                  onPress={() => void setStatus('acknowledged')}
                  disabled={busy}
                />
                <View style={{ height: spacing.sm }} />
              </>
            )}
            <PrimaryButton
              label={busy ? 'Saving…' : 'Mark Resolved'}
              onPress={() => void setStatus('resolved')}
              disabled={busy}
            />
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
    fontSize: 20,
    fontWeight: '800',
    color: colors.ink,
    flex: 1,
    paddingRight: spacing.sm,
  },
  time: { color: colors.inkFaint, marginBottom: spacing.lg },
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
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  message: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  subLabel: {
    marginTop: spacing.md,
    fontSize: 12,
    fontWeight: '700',
    color: colors.accentInk,
    textTransform: 'uppercase',
  },
  subBody: {
    marginTop: 4,
    color: colors.inkMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  step: {
    marginTop: 4,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 19,
  },
  safety: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.warningSoft,
    color: colors.warning,
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 72,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.lg,
    color: colors.ink,
  },
});
