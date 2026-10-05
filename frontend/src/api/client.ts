import type { ApiXrayPrediction } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';

export type ApiSignalPrediction = {
  predicted_label: string;
  prediction_index: number;
  class_names: string[];
  probabilities: Record<string, number>;
  model: string;
};

export async function healthCheck() {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error('Backend unavailable');
  }
  return response.json();
}

export async function predictXray(file: File): Promise<ApiXrayPrediction> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/predict`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Prediction failed');
  }

  return response.json();
}

export async function predictSignal(file: File): Promise<ApiSignalPrediction> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/predict-oa-gait`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Signal prediction failed');
  }

  return response.json();
}

export async function syncQueueToServer(payload: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('Sync failed');
  }

  return response.json();
}
