import React, { useEffect, useRef } from "react";
import QRCode from "qrcode";

/**
 * Rendert einen QR-Code komplett lokal im Browser (Canvas), ohne externen Dienst.
 * Fix aus Review #2: api.qrserver.com war eine Abhängigkeit von Internet/Drittanbieter.
 */
export default function QrCode({ value, size = 200 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!value || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      color: { dark: "#1f2937", light: "#ffffff" },
    }).catch(() => {});
  }, [value, size]);

  if (!value) return null;
  return <canvas ref={canvasRef} width={size} height={size} style={{ borderRadius: 12 }} />;
}
