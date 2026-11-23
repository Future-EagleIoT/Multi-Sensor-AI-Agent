import React, { type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Activity, Droplets, Thermometer, Zap, type LucideIcon } from 'lucide-react-native';
import { colors, radii, spacing } from '../theme/tokens';
import type { AssetProfile, LatestMetrics, MetricKey, TelemetryPoint } from '../types/models';
import { fmtNum } from '../utils/format';
import { metricStatus } from '../utils/health';

const ICONS: Record<MetricKey, LucideIcon> = {
  temperature: Thermometer,
  humidity: Droplets,
  vibration_hz: Activity,
  power_w: Zap,
};

const LABELS: Record<MetricKey, string> = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  vibration_hz: 'Vibration',
  power_w: 'Power',
};

const UNITS: Record<MetricKey, string> = {
  temperature: '°C',
  humidity: '%',
  vibration_hz: 'Hz',
  power_w: 'W',
};

export interface MetricGridProps {
  reading: Partial<TelemetryPoint> | LatestMetrics | null | undefined;
  profile?: AssetProfile | null;
}

export function MetricGrid({ reading, profile }: MetricGridProps): ReactElement {
  const keys: MetricKey[] = ['temperature', 'humidity', 'vibration_hz', 'power_w'];
  return (
    <View style={styles.grid}>
      {keys.map((key) => (
        <MetricCard
          key={key}
          metricKey={key}
          value={reading?.[key]}
          profile={profile}
        />
      ))}
    </View>
  );
}

function MetricCard({
  metricKey,
  value,
  profile,
}: {
  metricKey: MetricKey;
  value: number | null | undefined;
  profile?: AssetProfile | null;
}): ReactElement {
  const Icon = ICONS[metricKey];
  const status = metricStatus(metricKey, value, profile);
  const accent =
    status === 'critical'
      ? colors.critical
      : status === 'warning'
        ? colors.warning
        : colors.accent;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Icon size={18} color={accent} />
        <Text style={styles.label}>{LABELS[metricKey]}</Text>
      </View>
      <Text style={[styles.value, { color: accent }]}>
        {fmtNum(value, metricKey === 'vibration_hz' ? 2 : 1)}
        <Text style={styles.unit}> {UNITS[metricKey]}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  card: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 12,
    color: colors.inkMuted,
    fontWeight: '600',
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
  },
  unit: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.inkFaint,
  },
});
