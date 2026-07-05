// ============================================================
// Offline Store (Phase 3)
// IndexedDB-backed persistence with a localStorage fallback.
// The whole module is isolated behind load/save/clear so it can
// later be replaced by Supabase without touching the UI.
// ============================================================

import type { Item, QrAssessmentState, Result } from "./types";
import { emptyState, REVIEW_STATUSES } from "./types";
import { masteryBand } from "./scoring";

const DB_NAME = "daliguro_qr_db";
const DB_VERSION = 2; // v2 adds the scan-evidence store
const STORE = "kv";
const EVIDENCE_STORE = "evidence";
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
      if (!db.objectStoreNames.contains(EVIDENCE_STORE)) {
        db.createObjectStore(EVIDENCE_STORE);
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
// Also migrates records saved before SmartScan: fills new Item tag fields and
// new Result lifecycle fields, and recomputes mastery from the stored
// percentage so old results land in the current 80/60/40 bands.

function normalizeItem(item: Item): Item {
  return {
    ...item,
    topic: typeof item.topic === "string" ? item.topic : "",
    cognitiveLevel: item.cognitiveLevel ?? "",
  };
}

function isReviewStatus(v: unknown): v is Result["reviewStatus"] {
  return typeof v === "string" && (REVIEW_STATUSES as readonly string[]).includes(v);
}

function normalizeResult(result: Result): Result {
  return {
    ...result,
    masteryStatus: masteryBand(result.percentage),
    source: result.source === "scan" ? "scan" : "manual",
    scanConfidence:
      typeof result.scanConfidence === "number" ? result.scanConfidence : null,
    // Pre-SmartScan results were checked by the teacher → "reviewed".
    reviewStatus: isReviewStatus(result.reviewStatus) ? result.reviewStatus : "reviewed",
    finalizedAt: typeof result.finalizedAt === "number" ? result.finalizedAt : null,
    scanItems: Array.isArray(result.scanItems) ? result.scanItems : null,
    auditLog: Array.isArray(result.auditLog) ? result.auditLog : [],
  };
}

function normalize(value: Partial<QrAssessmentState> | undefined): QrAssessmentState {
  const base = emptyState();
  if (!value) return base;
  return {
    assessments: Array.isArray(value.assessments) ? value.assessments : base.assessments,
    items: Array.isArray(value.items) ? value.items.map(normalizeItem) : base.items,
    learners: Array.isArray(value.learners) ? value.learners : base.learners,
    answerKeys:
      value.answerKeys && typeof value.answerKeys === "object"
        ? value.answerKeys
        : base.answerKeys,
    results: Array.isArray(value.results)
      ? value.results.map(normalizeResult)
      : base.results,
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
      await clearEvidence();
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

// ---- Scan evidence archive ---------------------------------
// Compressed scan snapshots keyed by result id, stored OUTSIDE the state atom
// so images never ride along on every state save. IndexedDB-only (no
// localStorage fallback — evidence is a progressive enhancement).

export async function saveEvidence(resultId: string, dataUrl: string): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(EVIDENCE_STORE, "readwrite");
      tx.objectStore(EVIDENCE_STORE).put(dataUrl, resultId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Evidence is best-effort; scoring must never fail because of it.
  }
}

export async function getEvidence(resultId: string): Promise<string | null> {
  if (!hasIndexedDB()) return null;
  try {
    const db = await openDB();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(EVIDENCE_STORE, "readonly");
      const req = tx.objectStore(EVIDENCE_STORE).get(resultId);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteEvidence(resultIds: string[]): Promise<void> {
  if (!hasIndexedDB() || resultIds.length === 0) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(EVIDENCE_STORE, "readwrite");
      const store = tx.objectStore(EVIDENCE_STORE);
      resultIds.forEach((id) => store.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function clearEvidence(): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(EVIDENCE_STORE, "readwrite");
      tx.objectStore(EVIDENCE_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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
