import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { supabase } from '../services/supabase';
import { Activity, Thermometer, Droplets, Zap, AlertTriangle } from 'lucide-react-native';

export default function DashboardScreen() {
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchReadings = async () => {
    const { data, error } = await supabase
      .from('sensor_readings')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(20);

    if (error) console.error('Error fetching readings:', error);
    else setReadings(data);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchReadings();
    
    // Subscribe to real-time updates
    const subscription = supabase
      .channel('sensor_readings')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sensor_readings' }, (payload) => {
        setReadings(prev => [payload.new, ...prev].slice(0, 20));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchReadings();
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.deviceId}>{item.device_id}</Text>
        <Text style={styles.timestamp}>{new Date(item.timestamp).toLocaleTimeString()}</Text>
      </View>
      <View style={styles.grid}>
        <View style={styles.metric}>
          <Thermometer size={20} color="#ff4444" />
          <Text style={styles.value}>{item.temperature}°C</Text>
        </View>
        <View style={styles.metric}>
          <Droplets size={20} color="#33b5e5" />
          <Text style={styles.value}>{item.humidity}%</Text>
        </View>
        <View style={styles.metric}>
          <Activity size={20} color="#ffbb33" />
          <Text style={styles.value}>{item.vibration_hz} Hz</Text>
        </View>
        <View style={styles.metric}>
          <Zap size={20} color="#00C851" />
          <Text style={styles.value}>{item.power_w} W</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={readings}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No readings yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 10 },
  card: { backgroundColor: 'white', borderRadius: 10, padding: 15, marginBottom: 10, elevation: 3 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  deviceId: { fontWeight: 'bold', fontSize: 16 },
  timestamp: { color: '#666' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  metric: { flexDirection: 'row', alignItems: 'center', width: '45%', marginBottom: 10 },
  value: { marginLeft: 8, fontSize: 16, fontWeight: '500' },
  empty: { textAlign: 'center', marginTop: 50, color: '#666' }
});
