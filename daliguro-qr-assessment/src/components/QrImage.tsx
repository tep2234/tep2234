// Isolated QR rendering. If the qrcode library ever fails, this degrades to
// a payload placeholder box instead of breaking the whole sheet/app.

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrImage({ text, size = 96 }: { text: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string>("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!active) return;
        setDataUrl(url);
        setFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setDataUrl("");
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [text, size]);

  if (failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center border-2 border-dashed border-slate-400 text-center text-[8px] text-slate-500"
      >
        QR payload
        <br />
        (render failed)
      </div>
    );
  }

  if (!dataUrl) {
    return <div style={{ width: size, height: size }} className="bg-slate-100" />;
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="Learner identity QR"
    />
  );
}
