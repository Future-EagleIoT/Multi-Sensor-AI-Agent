import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Thermometer, Droplets, Activity, Zap } from 'lucide-react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { fmtNum } from '../utils/format';
import { metricStatus } from '../utils/health';

const ICONS = {
  temperature: Thermometer,
  humidity: Droplets,
  vibration_hz: Activity,
  power_w: Zap,
};

const LABELS = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  vibration_hz: 'Vibration',
  power_w: 'Power',
};

const UNITS = {
  temperature: '°C',
  humidity: '%',
  vibration_hz: 'Hz',
  power_w: 'W',
};

export function MetricGrid({ reading }) {
  const keys = ['temperature', 'humidity', 'vibration_hz', 'power_w'];
  return (
    <View style={styles.grid}>
      {keys.map((key) => (
        <MetricCard
          key={key}
          metricKey={key}
          value={reading?.[key]}
        />
      ))}
    </View>
  );
}

function MetricCard({ metricKey, value }) {
  const Icon = ICONS[metricKey];
  const status = metricStatus(metricKey, value);
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
