import React, { useMemo, useState, type ReactElement } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTelemetry } from '../context/TelemetryContext';
import { AlertCard } from '../components/AlertCard';
import { EmptyState, LoadingBlock, Screen, StatusChip } from '../components/ui';
import { colors, spacing } from '../theme/tokens';
import type { MainTabParamList, RootStackParamList } from '../types/models';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Alerts'>,
  NativeStackScreenProps<RootStackParamList>
>;

type FilterKey = 'open' | 'all' | 'CRITICAL' | 'WARNING';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'open', label: 'Active' },
  { key: 'all', label: 'All' },
  { key: 'CRITICAL', label: 'Critical' },
  { key: 'WARNING', label: 'Warning' },
];

export default function AlertsScreen({ navigation }: Props): ReactElement {
  const { assets, alerts, loading, refreshing, refresh, resolveAlert } = useTelemetry();
  const [filter, setFilter] = useState<FilterKey>('open');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const assetNames = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.id, a.name])),
    [assets],
  );

  const data = useMemo(() => {
    return alerts.filter((a) => {
      if (filter === 'open') return !['resolved', 'false_positive'].includes(a.status);
      if (filter === 'all') return true;
      return a.severity === filter;
    });
  }, [alerts, filter]);

  const onResolve = async (id: string) => {
    setResolvingId(id);
    await resolveAlert(id);
    setResolvingId(null);
  };

  if (loading) {
    return (
      <Screen>
        <LoadingBlock label="Loading alerts…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Alerts</Text>
        <StatusChip tone="neutral" label={`${data.length}`} />
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filter, active && styles.filterActive]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
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
            title="No alerts in this filter"
            body="When the rules & AI engine detects anomalies, diagnostics stream here in real time."
          />
        }
        renderItem={({ item }) => (
          <AlertCard
            alert={item}
            assetName={assetNames[item.asset_id]}
            resolving={resolvingId === item.id}
            onResolve={(id) => void onResolve(id)}
            onPress={() => navigation.navigate('AlertDetail', { id: item.id })}
          />
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
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  filter: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surfaceAlt,
  },
  filterActive: {
    backgroundColor: colors.accent,
  },
  filterText: {
    color: colors.inkMuted,
    fontWeight: '600',
    fontSize: 12,
  },
  filterTextActive: {
    color: colors.white,
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
});
