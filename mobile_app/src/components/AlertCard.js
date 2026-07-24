import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { formatDateTime } from '../utils/format';
import { severityTone } from '../utils/health';
import { StatusChip } from './ui';

export function AlertCard({ alert, onPress, onResolve, resolving }) {
  const tone = severityTone(alert.severity);
  const resolved = Boolean(alert.is_resolved);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          {resolved ? (
            <CheckCircle2 size={16} color={colors.ok} />
          ) : (
            <AlertTriangle
              size={16}
              color={tone === 'critical' ? colors.critical : colors.warning}
            />
          )}
          <Text style={styles.device}>{alert.device_id}</Text>
        </View>
        <StatusChip
          tone={resolved ? 'ok' : tone}
          label={resolved ? 'Resolved' : alert.severity}
        />
      </View>
      <Text style={styles.message} numberOfLines={3}>
        {alert.message || 'No analysis message'}
      </Text>
      <View style={styles.footer}>
        <Text style={styles.time}>{formatDateTime(alert.timestamp)}</Text>
        {!resolved && onResolve ? (
          <Pressable
            onPress={(e) => {
              e?.stopPropagation?.();
              onResolve(alert.id);
            }}
            disabled={resolving}
            style={styles.resolveBtn}
          >
            <Text style={styles.resolveText}>
              {resolving ? 'Saving…' : 'Resolve'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    paddingRight: spacing.sm,
  },
  device: {
    fontWeight: '700',
    color: colors.ink,
    fontSize: 14,
  },
  message: {
    color: colors.inkMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  time: {
    color: colors.inkFaint,
    fontSize: 12,
  },
  resolveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: colors.accentSoft,
  },
  resolveText: {
    color: colors.accentInk,
    fontWeight: '700',
    fontSize: 12,
  },
});
