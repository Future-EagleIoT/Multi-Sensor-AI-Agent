import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { Cpu } from 'lucide-react-native';
import { useTelemetry } from '../context/TelemetryContext';
import { EmptyState, LoadingBlock, Screen, StatusChip } from '../components/ui';
import { colors, radii, spacing } from '../theme/tokens';
import { formatRelative } from '../utils/format';

export default function DevicesScreen() {
  const { assets, devices, loading, refreshing, refresh, live } = useTelemetry();
  const assetNames = Object.fromEntries(assets.map((a) => [a.id, a.name]));

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
        <StatusChip tone={live ? 'live' : 'neutral'} label={live ? 'WS Live' : 'Idle'} />
      </View>
      <FlatList
        data={devices}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No devices provisioned"
            body="Provision mTLS devices in the Web Control Room (Devices & PKI tab)."
          />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Cpu size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.rowTop}>
                <Text style={styles.name}>{item.device_uid}</Text>
                <StatusChip
                  tone={item.is_revoked ? 'critical' : item.status === 'online' ? 'ok' : 'neutral'}
                  label={item.is_revoked ? 'Revoked' : item.status}
                />
              </View>
              <Text style={styles.meta}>
                Asset: {item.asset_id ? assetNames[item.asset_id] || item.asset_id : 'Unassigned'}
              </Text>
              <Text style={styles.meta}>CN: {item.cert_cn}</Text>
              <Text style={styles.meta}>
                Last seen {item.last_seen_at ? formatRelative(item.last_seen_at) : 'never'}
              </Text>
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
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    fontSize: 12,
    marginTop: 2,
  },
});
