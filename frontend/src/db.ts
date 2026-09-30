import Dexie, { type Table } from 'dexie';
import type { Patient, Screening, SyncQueueItem } from './types';

class OAScreeningDB extends Dexie {
  patients!: Table<Patient, string>;
  screenings!: Table<Screening, string>;
  syncQueue!: Table<SyncQueueItem, number>;

  constructor() {
    super('oa-screening-db');
    this.version(1).stores({
      patients: 'id, createdAt',
      screenings: 'id, patientId, type, createdAt, updatedAt, status',
      syncQueue: '++id, screeningId, status, createdAt, updatedAt',
    });
    this.version(2).stores({
      patients: 'id, createdAt',
      screenings: 'id, patientId, type, createdAt, updatedAt, status',
      syncQueue: '++id, recordType, recordId, status, createdAt, updatedAt',
    });
  }
}

export const db = new OAScreeningDB();

export async function savePatient(patient: Patient) {
  await db.patients.put(patient);
}

export async function getPatients() {
  return db.patients.orderBy('createdAt').reverse().toArray();
}

export async function saveScreening(screening: Screening) {
  await db.screenings.put(screening);
}

export async function getScreenings() {
  return db.screenings.orderBy('createdAt').reverse().toArray();
}

export async function enqueueSync(item: Omit<SyncQueueItem, 'id' | 'status' | 'retryCount' | 'updatedAt'>) {
  await db.syncQueue.add({
    ...item,
    status: 'pending',
    retryCount: 0,
    updatedAt: new Date().toISOString(),
  });
}

export async function getPendingSyncItems() {
  return db.syncQueue.where('status').equals('pending').toArray();
}

export async function markSyncItemSent(id: number) {
  await db.syncQueue.update(id, {
    status: 'sent',
    updatedAt: new Date().toISOString(),
  });
}

export async function markSyncItemFailed(id: number, retryCount: number) {
  await db.syncQueue.update(id, {
    status: 'failed',
    retryCount,
    updatedAt: new Date().toISOString(),
  });
}
