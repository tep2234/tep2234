import { lazy } from "react";

// Keep desktop and phone scanner code in separate production chunks. Exporting
// these components from their own module also keeps the React entrypoint clean
// for Fast Refresh.
export const AppRoute = lazy(() => import("./App.tsx"));
export const SmartScanMobileRoute = lazy(() => import("./pages/SmartScanMobilePage.tsx"));
