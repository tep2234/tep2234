// Shared props passed from App to each tab panel.

import type { Dispatch, SetStateAction } from "react";
import type { QrAssessmentState } from "../lib/types";

export interface PanelProps {
  state: QrAssessmentState;
  setState: Dispatch<SetStateAction<QrAssessmentState>>;
  activeId: string | null;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  navigate?: (tab: string) => void;
}
