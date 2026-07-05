// React hook that owns the offline-first state.
// Loads once on mount, then persists on every change.

import { useEffect, useRef, useState } from "react";
import type { QrAssessmentState } from "./types";
import { emptyState } from "./types";
import { loadState, saveState } from "./offline-store";

export interface QrStore {
  state: QrAssessmentState;
  setState: React.Dispatch<React.SetStateAction<QrAssessmentState>>;
  loaded: boolean;
}

export function useQrStore(): QrStore {
  const [state, setState] = useState<QrAssessmentState>(emptyState);
  const [loaded, setLoaded] = useState(false);
  const skipNextSave = useRef(true);

  // Load persisted state once.
  useEffect(() => {
    let active = true;
    loadState()
      .then((loadedState) => {
        if (!active) return;
        setState(loadedState);
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Persist on change, but never overwrite storage before the initial load.
  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    void saveState(state);
  }, [state, loaded]);

  return { state, setState, loaded };
}
