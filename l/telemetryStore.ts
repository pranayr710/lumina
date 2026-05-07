import { create } from 'zustand';

interface TelemetryState {
  executionCounts: Record<string, number>;
  latencies: Record<string, number[]>;
  updateTelemetry: (data: { execution_counts: Record<string, number>; latencies: Record<string, number[]> }) => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  executionCounts: {},
  latencies: {},
  updateTelemetry: (data) => set({
    executionCounts: data.execution_counts,
    latencies: data.latencies,
  }),
}));
