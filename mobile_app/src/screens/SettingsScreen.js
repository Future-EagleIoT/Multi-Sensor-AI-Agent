import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTelemetry } from '../context/TelemetryContext';
import { PrimaryButton, Screen, StatusChip } from '../components/ui';
import { API_URL } from '../services/api';
import { colors, radii, spacing } from '../theme/tokens';

export default function SettingsScreen() {
  const { user, signOut, switchOrg } = useAuth();
  const { live, openAlerts, readings, selectedAsset } = useTelemetry();
  const profile = selectedAsset?.profile;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title}>Settings</Text>

        <Text style={styles.section}>Account & Active Tenant</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>{user?.fullName || user?.email || '—'}</Text>
          <Text style={styles.sub}>{user?.email}</Text>
          <View style={{ height: spacing.sm }} />
          <StatusChip
            tone="ok"
            label={`${user?.activeOrg?.name || 'Factory'} (${user?.activeOrg?.role || 'member'})`}
          />
        </View>

        {user?.organizations?.length > 1 && (
          <>
            <Text style={styles.section}>Switch Factory Tenant</Text>
            <View style={styles.card}>
              {user.organizations.map((org) => {
                const active = org.id === user.activeOrg?.id;
                return (
                  <Pressable
                    key={org.id}
                    onPress={() => !active && switchOrg(org.id)}
                    style={[styles.orgRow, active && styles.orgRowActive]}
                  >
                    <Text style={[styles.orgName, active && { color: colors.accent }]}>
                      {org.name}
                    </Text>
                    <Text style={styles.rowValue}>{active ? 'Active' : org.role}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <Text style={styles.section}>Backend Connection</Text>
        <View style={styles.card}>
          <Row label="API" value={API_URL} />
          <Row label="WebSocket" value={live ? 'Connected' : 'Reconnecting'} />
          <Row label="Buffered ticks" value={String(readings.length)} />
          <Row label="Open alerts" value={String(openAlerts.length)} />
        </View>

        {profile && (
          <>
            <Text style={styles.section}>Selected Asset Limits ({selectedAsset.name})</Text>
            <View style={styles.card}>
              <Row label="Temp (warn / crit)" value={`${profile.warn_temp} / ${profile.crit_temp} °C`} />
              <Row label="Humidity (warn / crit)" value={`${profile.warn_humidity} / ${profile.crit_humidity} %`} />
              <Row label="Vibration (warn / crit)" value={`${profile.warn_vibration_hz} / ${profile.crit_vibration_hz} Hz`} />
              <Row label="Power (warn / crit)" value={`${profile.warn_power_w} / ${profile.crit_power_w} W`} />
            </View>
          </>
        )}

        <PrimaryButton label="Sign out" variant="danger" onPress={signOut} />

        <Text style={styles.footer}>
          Future Eagle IIoT SaaS · Multi-Tenant Field Ops Client
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: spacing.lg,
  },
  section: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.inkFaint,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  label: {
    color: colors.inkFaint,
    fontSize: 12,
  },
  value: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 16,
    marginTop: 2,
  },
  sub: {
    color: colors.inkMuted,
    fontSize: 13,
    marginTop: 2,
  },
  orgRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radii.sm,
  },
  orgRowActive: {
    backgroundColor: colors.accentSoft,
  },
  orgName: {
    fontWeight: '700',
    color: colors.ink,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  rowLabel: {
    color: colors.inkMuted,
  },
  rowValue: {
    color: colors.ink,
    fontWeight: '600',
    flexShrink: 1,
  },
  footer: {
    marginTop: spacing.xl,
    textAlign: 'center',
    color: colors.inkFaint,
    fontSize: 12,
  },
});
