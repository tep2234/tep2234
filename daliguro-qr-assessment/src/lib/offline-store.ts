// ============================================================
// Offline Store (Phase 3)
// IndexedDB-backed persistence with a localStorage fallback.
// The whole module is isolated behind load/save/clear so it can
// later be replaced by Supabase without touching the UI.
// ============================================================

import type { QrAssessmentState } from "./types";
import { emptyState } from "./types";

const DB_NAME = "daliguro_qr_db";
const DB_VERSION = 1;
const STORE = "kv";
const STATE_KEY = "state";
const LS_KEY = "daliguro_qr_state";

// ---- Capability check --------------------------------------

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

// ---- IndexedDB primitives ----------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDB().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbSet(key: string, value: unknown): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function idbDelete(key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

// ---- localStorage fallback ---------------------------------

function lsLoad(): QrAssessmentState | undefined {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as QrAssessmentState;
  } catch {
    return undefined;
  }
}

function lsSave(state: QrAssessmentState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked — nothing else we can safely do here.
  }
}

// ---- Normalisation -----------------------------------------
// Guards against partial/old shapes so the UI always gets a full state.

function normalize(value: Partial<QrAssessmentState> | undefined): QrAssessmentState {
  const base = emptyState();
  if (!value) return base;
  return {
    assessments: Array.isArray(value.assessments) ? value.assessments : base.assessments,
    items: Array.isArray(value.items) ? value.items : base.items,
    learners: Array.isArray(value.learners) ? value.learners : base.learners,
    answerKeys:
      value.answerKeys && typeof value.answerKeys === "object"
        ? value.answerKeys
        : base.answerKeys,
    results: Array.isArray(value.results) ? value.results : base.results,
  };
}

// ---- Public API --------------------------------------------

export async function loadState(): Promise<QrAssessmentState> {
  if (hasIndexedDB()) {
    try {
      const value = await idbGet<Partial<QrAssessmentState>>(STATE_KEY);
      return normalize(value);
    } catch {
      // Fall through to localStorage on any IndexedDB error.
    }
  }
  return normalize(lsLoad());
}

export async function saveState(state: QrAssessmentState): Promise<void> {
  if (hasIndexedDB()) {
    try {
      await idbSet(STATE_KEY, state);
      return;
    } catch {
      // Fall through to localStorage on any IndexedDB error.
    }
  }
  lsSave(state);
}

export async function clearState(): Promise<void> {
  if (hasIndexedDB()) {
    try {
      await idbDelete(STATE_KEY);
    } catch {
      // ignore
    }
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

// ---- Backup helpers (used by export tab in a later phase) --

export function exportBackup(state: QrAssessmentState): string {
  return JSON.stringify(state, null, 2);
}

export function importBackup(json: string): QrAssessmentState {
  const parsed = JSON.parse(json) as Partial<QrAssessmentState>;
  return normalize(parsed);
}
