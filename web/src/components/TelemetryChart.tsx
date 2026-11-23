import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { AssetProfile, TelemetryPoint } from '../lib/api';

interface Props {
  data: TelemetryPoint[];
  profile: AssetProfile | null;
}

export const TelemetryChart: React.FC<Props> = ({ data, profile }) => {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const chart = echarts.init(elRef.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const labels = data.map((d) =>
      new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    );
    const temps = data.map((d) => (d.temperature != null ? Number(d.temperature.toFixed(2)) : null));
    const vibs = data.map((d) => (d.vibration_hz != null ? Number(d.vibration_hz.toFixed(2)) : null));
    const powers = data.map((d) => (d.power_w != null ? Number(d.power_w.toFixed(1)) : null));

    chartRef.current.setOption({
      animation: false,
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { color: '#3D5560', fontSize: 12 } },
      grid: { left: 48, right: 56, top: 38, bottom: 32 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#CBD5E1' } },
        axisLabel: { color: '#64748B', fontSize: 11 },
      },
      yAxis: [
        {
          type: 'value',
          name: '°C / Hz',
          nameTextStyle: { color: '#64748B', fontSize: 11 },
          splitLine: { lineStyle: { color: '#E2E8F0' } },
          axisLabel: { color: '#64748B', fontSize: 11 },
        },
        {
          type: 'value',
          name: 'Watts',
          nameTextStyle: { color: '#64748B', fontSize: 11 },
          splitLine: { show: false },
          axisLabel: { color: '#64748B', fontSize: 11 },
        },
      ],
      series: [
        {
          name: 'Temperature (°C)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: temps,
          lineStyle: { width: 2.2, color: '#DC2626' },
          itemStyle: { color: '#DC2626' },
          markLine: profile
            ? {
                silent: true,
                symbol: 'none',
                label: { formatter: 'Crit Temp', color: '#B91C1C', fontSize: 10 },
                lineStyle: { type: 'dashed', color: '#FCA5A5' },
                data: [{ yAxis: profile.crit_temp }],
              }
            : undefined,
        },
        {
          name: 'Vibration (Hz)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: vibs,
          lineStyle: { width: 2.2, color: '#D97706' },
          itemStyle: { color: '#D97706' },
        },
        {
          name: 'Power (W)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          data: powers,
          lineStyle: { width: 2, color: '#0F766E' },
          itemStyle: { color: '#0F766E' },
        },
      ],
    });
  }, [data, profile]);

  return <div ref={elRef} className="w-full h-[300px]" />;
};
