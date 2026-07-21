// Local data safety: JSON backup export, restore-from-file import, and a
// guarded reset. Offline-only; nothing leaves the device.

import { useRef, useState } from "react";
import type { PanelProps } from "./panel-types";
import { emptyState } from "../lib/types";
import {
  clearAllLocalData,
  exportBackup,
  importBackup,
  LocalDataClearError,
} from "../lib/offline-store";
import { downloadJson, safeFilename } from "../lib/export";
import { Button } from "./ui";

export function BackupTools({
  state,
  setState,
  setActiveId,
}: {
  state: PanelProps["state"];
  setState: PanelProps["setState"];
  setActiveId: PanelProps["setActiveId"];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");

  function exportNow() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(exportBackup(state), safeFilename("daliguro_qr_backup_" + stamp) + ".json");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = importBackup(String(reader.result));
        if (
          !window.confirm(
            "Restore this backup? It replaces all data currently on this device.",
          )
        ) {
          return;
        }
        setState(next);
        setActiveId(null);
        window.alert(
          "Restored: " +
            next.assessments.length +
            " assessment(s), " +
            next.learners.length +
            " learner(s), " +
            next.results.length +
            " result(s).",
        );
      } catch {
        window.alert("Could not read that file. Expected a DALIguro JSON backup.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function resetAll() {
    if (clearing) return;
    const counts =
      state.assessments.length +
      " assessment(s), " +
      state.learners.length +
      " learner(s), " +
      state.results.length +
      " result(s)";
    if (
      !window.confirm(
        "⚠ Clear ALL DALIguro data stored in this browser (" +
          counts +
          ")?\n\nThis includes answer-sheet images, unsent phone scans, report settings, and scanner calibration. Synchronized server records are not deleted. This cannot be undone. Export a backup first if unsure.",
      )
    ) {
      return;
    }
    if (!window.confirm("Final check: permanently delete all local DALIguro data from this browser?")) {
      return;
    }

    setClearing(true);
    setClearError("");
    try {
      await clearAllLocalData();
      setState(emptyState());
      setActiveId(null);
      window.alert("All local DALIguro data was cleared from this browser.");
    } catch (error) {
      const areas = error instanceof LocalDataClearError
        ? ` Failed area(s): ${error.failedAreas.join(", ")}.`
        : "";
      const message =
        "Clear all did not finish. Some local records may remain, and the on-screen data was not reset." +
        areas +
        " Retry the operation or export a backup before closing this page.";
      setClearError(message);
      window.alert(message);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-extrabold text-slate-700">
        💾 Backup &amp; local data
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Data is saved only on this device/browser. Export a JSON backup before
        clearing data or switching devices.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="small" onClick={exportNow}>
          ⬇ Export backup (JSON)
        </Button>
        <Button variant="small" onClick={() => fileRef.current?.click()}>
          ⬆ Restore backup (.json)
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={onFile}
        />
        <Button
          variant="smallDanger"
          onClick={() => void resetAll()}
          disabled={clearing}
          aria-busy={clearing}
        >
          {clearing ? "Clearing local data…" : "🗑 Clear all data"}
        </Button>
      </div>
      {clearError ? (
        <p className="mt-3 text-xs font-semibold text-red-700" role="alert">
          {clearError}
        </p>
      ) : null}
    </div>
  );
}
