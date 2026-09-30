export type AssessmentType = 'xray' | 'signal' | 'video' | 'questionnaire';

export type Patient = {
  id: string;
  name: string;
  phone: string;
  language: string;
  age: number;
  medicalHistory: string;
  jointPain: boolean;
  painLevel: number;
  treatmentUndergoing: boolean;
  treatmentDetails: string;
  otherJointDiseases: string;
  previousInjury: boolean;
  injuryDetails: string;
  consent: boolean;
  workerUserId: string;
  syncStatus: 'pending' | 'synced' | 'failed';
  createdAt: string;
};

export type ScreeningResult = {
  severity?: string;
  predictedClass?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  mode?: AssessmentType;
  note?: string;
};

export type Screening = {
  id: string;
  patientId: string;
  type: AssessmentType;
  status: 'offline' | 'queued' | 'synced';
  createdAt: string;
  updatedAt: string;
  result?: ScreeningResult;
};

export type SyncQueueItem = {
  id?: number;
  recordType: 'patient' | 'screening';
  recordId: string;
  screeningId?: string;
  payload: unknown;
  status: 'pending' | 'sent' | 'failed';
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiXrayPrediction = {
  predicted_class: number;
  severity: string;
  probabilities: Record<string, number>;
  grade_labels: Record<string, string>;
};
