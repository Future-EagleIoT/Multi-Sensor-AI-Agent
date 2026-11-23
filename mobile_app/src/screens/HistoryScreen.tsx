import React, { type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useTelemetry } from '../context/TelemetryContext';
import { EmptyState, LoadingBlock, Screen } from '../components/ui';
import { colors, radii, spacing } from '../theme/tokens';
import { fmtNum, formatClock } from '../utils/format';

export default function HistoryScreen(): ReactElement {
  const { selectedAsset, readings, loading, refreshing, refresh } = useTelemetry();

  if (loading) {
    return (
      <Screen>
        <LoadingBlock label="Loading history…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.sub}>
          {selectedAsset?.name || 'No asset'} · latest {readings.length} readings
        </Text>
      </View>
      <FlatList
        data={readings}
        keyExtractor={(item, idx) => `${item.timestamp || item.time}-${idx}`}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title="No readings yet"
            body="Telemetry history streams from TimescaleDB once the device publishes."
          />
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.device}>ISO Zone {item.iso_zone || '—'}</Text>
              <Text style={styles.time}>{formatClock(item.timestamp || item.time)}</Text>
            </View>
            <Text style={styles.metrics}>
              {fmtNum(item.temperature)}°C · {fmtNum(item.humidity)}% ·{' '}
              {fmtNum(item.vibration_hz, 2)} Hz · {fmtNum(item.power_w, 0)} W
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
  },
  sub: {
    color: colors.inkFaint,
    marginTop: 4,
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  device: {
    fontWeight: '700',
    color: colors.ink,
  },
  time: {
    color: colors.inkFaint,
    fontVariant: ['tabular-nums'],
  },
  metrics: {
    color: colors.inkMuted,
    fontSize: 13,
  },
});
