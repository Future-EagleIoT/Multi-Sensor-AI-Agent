import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Pressable } from 'react-native';
import { useTelemetry } from '../context/TelemetryContext';
import { useAuth } from '../context/AuthContext';
import { AlertCard } from '../components/AlertCard';
import { EmptyState, LoadingBlock, Screen, StatusChip } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'all', label: 'All' },
  { key: 'CRITICAL', label: 'Critical' },
  { key: 'WARNING', label: 'Warning' },
];

export default function AlertsScreen({ navigation }) {
  const { isGuest } = useAuth();
  const { alerts, loading, refreshing, refresh, resolveAlert } = useTelemetry();
  const [filter, setFilter] = useState('open');
  const [resolvingId, setResolvingId] = useState(null);

  const data = useMemo(() => {
    return alerts.filter((a) => {
      if (filter === 'open') return !a.is_resolved;
      if (filter === 'all') return true;
      return a.severity === filter;
    });
  }, [alerts, filter]);

  const onResolve = async (id) => {
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
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No alerts in this filter"
            body="When the AI agent fires, analyses appear here in realtime."
          />
        }
        renderItem={({ item }) => (
          <AlertCard
            alert={item}
            resolving={resolvingId === item.id}
            onResolve={isGuest ? undefined : onResolve}
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
