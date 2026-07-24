import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
} from 'react-native';
import { Radio } from 'lucide-react-native';
import { useTelemetry } from '../context/TelemetryContext';
import { useAuth } from '../context/AuthContext';
import { MetricGrid } from '../components/MetricGrid';
import {
  EmptyState,
  LoadingBlock,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import { AlertCard } from '../components/AlertCard';
import { colors, radii, spacing } from '../theme/tokens';
import { formatRelative, formatClock } from '../utils/format';

export default function DashboardScreen({ navigation }) {
  const { isGuest } = useAuth();
  const {
    latest,
    health,
    openAlerts,
    loading,
    refreshing,
    refresh,
    live,
    error,
    resolveAlert,
  } = useTelemetry();

  if (loading) {
    return (
      <Screen>
        <LoadingBlock label="Connecting to telemetry…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
      >
        <View style={styles.hero}>
          <View>
            <Text style={styles.kicker}>Live motor health</Text>
            <Text style={styles.device}>{latest?.device_id || 'No device yet'}</Text>
          </View>
          <StatusChip
            tone={live ? 'live' : 'neutral'}
            label={live ? 'Realtime' : 'Polling'}
          />
        </View>

        <View style={[styles.healthBanner, styles[`tone_${health.tone}`] || styles.tone_neutral]}>
          <Radio size={18} color={colors.ink} />
          <View style={{ flex: 1 }}>
            <Text style={styles.healthStatus}>{health.status}</Text>
            <Text style={styles.healthLabel}>{health.label}</Text>
          </View>
          <Text style={styles.clock}>{formatClock(latest?.timestamp)}</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SectionTitle>Signals</SectionTitle>
        {latest ? (
          <MetricGrid reading={latest} />
        ) : (
          <EmptyState
            title="Waiting for ESP32 data"
            body="Start Mosquitto, the Python agent, and flash the ESP32 so readings land in Supabase."
          />
        )}

        <SectionTitle
          right={
            <Pressable onPress={() => navigation.navigate('Alerts')}>
              <Text style={styles.link}>View all</Text>
            </Pressable>
          }
        >
          Open alerts ({openAlerts.length})
        </SectionTitle>

        {openAlerts.length === 0 ? (
          <View style={styles.quiet}>
            <Text style={styles.quietText}>No open alerts. System quiet.</Text>
          </View>
        ) : (
          openAlerts.slice(0, 3).map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onPress={() => navigation.navigate('AlertDetail', { id: alert.id })}
              onResolve={isGuest ? undefined : resolveAlert}
            />
          ))
        )}

        <Text style={styles.footerMeta}>
          Updated {formatRelative(latest?.timestamp)}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  kicker: {
    color: colors.inkFaint,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  device: {
    marginTop: 4,
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
  },
  healthBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  tone_ok: { backgroundColor: colors.okSoft },
  tone_warning: { backgroundColor: colors.warningSoft },
  tone_critical: { backgroundColor: colors.criticalSoft },
  tone_neutral: { backgroundColor: colors.surfaceAlt },
  healthStatus: {
    fontWeight: '800',
    color: colors.ink,
    fontSize: 14,
  },
  healthLabel: {
    color: colors.inkMuted,
    fontSize: 13,
    marginTop: 2,
  },
  clock: {
    fontVariant: ['tabular-nums'],
    color: colors.inkMuted,
    fontWeight: '600',
  },
  error: {
    color: colors.critical,
    marginBottom: spacing.md,
  },
  link: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 13,
  },
  quiet: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  quietText: {
    color: colors.inkMuted,
    textAlign: 'center',
  },
  footerMeta: {
    marginTop: spacing.xl,
    textAlign: 'center',
    color: colors.inkFaint,
    fontSize: 12,
  },
});
