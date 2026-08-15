"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button, buttonVariants, Card, Input, Label } from "@hifago/ui";

// wa.me deep-link — mécanisme de contact WhatsApp déjà utilisé ailleurs dans l'app (public/app.js
// `setupSupportLink`, public/reservar.js `waLink`/`WHATSAPP_NUMBER`) : même numéro, même schéma
// d'URL (`https://wa.me/<digits>?text=<message pré-rempli>`), aucun nouveau canal de configuration
// introduit ici (pas de variable d'env, pas de second numéro).
const SUPPORT_WHATSAPP_NUMBER = "573215764841";

export function PartnerCodeEntry({ code, link }: { code: string; link: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [svgMarkup, setSvgMarkup] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Génération du QR CÔTÉ CLIENT (cahier des charges socio §3h) : SVG (vectoriel, impression) via
  // QRCode.toString + PNG (raster, web/WhatsApp) rendu sur un <canvas> via QRCode.toCanvas — les
  // deux formats sont exigés, pas un choix entre les deux. Le QR encode `link` (l'URL de
  // redirection /[locale]/r/[code]), jamais une URL finale construite à la main.
  useEffect(() => {
    if (!link) return;
    let cancelled = false;

    QRCode.toString(link, { type: "svg", margin: 1 }).then((svg) => {
      if (!cancelled) setSvgMarkup(svg);
    });
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, link, { margin: 1 });
    }

    return () => {
      cancelled = true;
    };
  }, [link]);

  async function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function triggerDownload(href: string, filename: string) {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.click();
  }

  async function handleCopyCode() {
    await copyToClipboard(code, setCopiedCode);
  }

  async function handleCopyLink() {
    if (!link) return;
    await copyToClipboard(link, setCopiedLink);
  }

  function handleDownloadSvg() {
    if (!svgMarkup) return;
    const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `hifago-${code}.svg`);
    URL.revokeObjectURL(url);
  }

  function handleDownloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    triggerDownload(canvas.toDataURL("image/png"), `hifago-${code}.png`);
  }

  const whatsappMessage = `Hola Jérome, soy "${code}", tengo un problema con mi enlace/QR de venta. Me puedes ayudar porfa?`;
  const whatsappHref = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappMessage)}`;

  return (
    <Card data-testid="partner-code-entry">
      <Card.Header>
        <Card.Title>{code}</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`code-${code}`}>Código</Label>
          <div className="flex gap-2">
            <Input id={`code-${code}`} readOnly value={code} data-testid="partner-code-value" />
            <Button
              type="button"
              variant="outline"
              onPress={handleCopyCode}
              data-testid="copy-code-button"
            >
              {copiedCode ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`link-${code}`}>Enlace atribuido</Label>
          <div className="flex gap-2">
            <Input
              id={`link-${code}`}
              readOnly
              value={link}
              data-testid="partner-link-value"
            />
            <Button
              type="button"
              variant="outline"
              onPress={handleCopyLink}
              data-testid="copy-link-button"
            >
              {copiedLink ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col items-start gap-3">
          <Label>Código QR</Label>
          <canvas ref={canvasRef} className="rounded-lg border" />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onPress={handleDownloadSvg}
              data-testid="download-svg-button"
            >
              Descargar SVG
            </Button>
            <Button
              type="button"
              variant="outline"
              onPress={handleDownloadPng}
              data-testid="download-png-button"
            >
              Descargar PNG
            </Button>
          </div>
        </div>

        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="whatsapp-support-button"
          className={buttonVariants({ variant: "outline" })}
        >
          Soporte por WhatsApp
        </a>
      </Card.Content>
    </Card>
  );
}
