import React, { useMemo, type ReactElement } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import type { MainTabParamList, RootStackParamList, Tone } from '../types/models';
import { formatClock, formatRelative } from '../utils/format';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Live'>,
  NativeStackScreenProps<RootStackParamList>
>;

export default function DashboardScreen({ navigation }: Props): ReactElement {
  const { user } = useAuth();
  const {
    assets,
    selectedAsset,
    setSelectedAssetId,
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

  const assetNames = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.id, a.name])),
    [assets],
  );

  const bannerToneStyle: Record<Tone, ViewStyle> = {
    ok: styles.tone_ok,
    warning: styles.tone_warning,
    critical: styles.tone_critical,
    neutral: styles.tone_neutral,
    live: styles.tone_ok,
  };

  if (loading) {
    return (
      <Screen>
        <LoadingBlock label="Connecting to factory telemetry…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.hero}>
          <View style={styles.heroLeft}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.heroLogo}
              accessibilityLabel="Future Eagle IIoT logo"
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>{user?.activeOrg?.name || 'Factory'}</Text>
              <Text style={styles.device}>{selectedAsset?.name || 'No assets yet'}</Text>
            </View>
          </View>
          <StatusChip
            tone={live ? 'live' : 'neutral'}
            label={live ? 'WS Live' : 'Reconnecting'}
          />
        </View>

        {assets.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
            {assets.map((asset) => {
              const active = asset.id === selectedAsset?.id;
              return (
                <Pressable
                  key={asset.id}
                  onPress={() => setSelectedAssetId(asset.id)}
                  style={[styles.assetPill, active && styles.assetPillActive]}
                >
                  <Text style={[styles.assetPillText, active && styles.assetPillTextActive]}>
                    {asset.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View style={[styles.healthBanner, bannerToneStyle[health.tone]]}>
          <Radio size={18} color={colors.ink} />
          <View style={{ flex: 1 }}>
            <Text style={styles.healthStatus}>
              {health.status}
              {latest?.iso_zone ? ` · ISO Zone ${latest.iso_zone}` : ''}
            </Text>
            <Text style={styles.healthLabel}>{health.label}</Text>
          </View>
          <Text style={styles.clock}>{formatClock(latest?.timestamp ?? latest?.time)}</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SectionTitle>Live Signals</SectionTitle>
        {latest ? (
          <MetricGrid reading={latest} profile={selectedAsset?.profile} />
        ) : (
          <EmptyState
            title="Waiting for device telemetry"
            body="Start the virtual fleet simulator (`make sim`) or connect your mTLS ESP32 node."
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
            <Text style={styles.quietText}>No active alerts. Fleet operating normally.</Text>
          </View>
        ) : (
          openAlerts.slice(0, 3).map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              assetName={assetNames[alert.asset_id]}
              onPress={() => navigation.navigate('AlertDetail', { id: alert.id })}
              onResolve={(alertId) => void resolveAlert(alertId)}
            />
          ))
        )}

        <Text style={styles.footerMeta}>
          Updated {formatRelative(latest?.timestamp ?? latest?.time)}
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
    marginBottom: spacing.md,
  },
  heroLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingRight: spacing.sm,
  },
  heroLogo: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
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
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
  },
  pickerRow: {
    marginBottom: spacing.md,
  },
  assetPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  assetPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  assetPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.inkMuted,
  },
  assetPillTextActive: {
    color: colors.white,
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
