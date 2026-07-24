import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { Cpu } from 'lucide-react-native';
import { useTelemetry } from '../context/TelemetryContext';
import { EmptyState, LoadingBlock, Screen, StatusChip } from '../components/ui';
import { colors, radii, spacing } from '../theme/tokens';
import { formatRelative } from '../utils/format';

export default function DevicesScreen() {
  const { devices, readings, loading, refreshing, refresh, live } = useTelemetry();

  const enriched = devices.map((d) => {
    const last = readings.find((r) => r.device_id === d.device_name);
    return { ...d, lastReading: last };
  });

  // Also show device_ids that exist in readings but not in devices table
  const knownNames = new Set(devices.map((d) => d.device_name));
  const orphanIds = [
    ...new Set(
      readings
        .map((r) => r.device_id)
        .filter((id) => id && !knownNames.has(id)),
    ),
  ];
  const orphans = orphanIds.map((id) => ({
    id: `orphan-${id}`,
    device_name: id,
    device_type: 'motor',
    location: 'Unregistered',
    lastReading: readings.find((r) => r.device_id === id),
    unregistered: true,
  }));

  const data = [...enriched, ...orphans];

  if (loading) {
    return (
      <Screen>
        <LoadingBlock label="Loading devices…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Devices</Text>
        <StatusChip tone={live ? 'live' : 'neutral'} label={live ? 'Live feed' : 'Idle'} />
      </View>
      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No devices registered"
            body="Seed devices in Supabase or wait for ESP32 publishes (device_id appears from readings)."
          />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Cpu size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.device_name}</Text>
              <Text style={styles.meta}>
                {item.device_type || 'motor'}
                {item.location ? ` · ${item.location}` : ''}
              </Text>
              <Text style={styles.meta}>
                Last seen{' '}
                {item.lastReading
                  ? formatRelative(item.lastReading.timestamp)
                  : 'never'}
              </Text>
              {item.unregistered ? (
                <Text style={styles.warn}>Seen in telemetry, not in devices table</Text>
              ) : null}
            </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontWeight: '700',
    color: colors.ink,
    fontSize: 15,
  },
  meta: {
    color: colors.inkMuted,
    fontSize: 13,
    marginTop: 2,
  },
  warn: {
    color: colors.warning,
    fontSize: 12,
    marginTop: 6,
    fontWeight: '600',
  },
});
