import { useEffect, useRef, useState } from "react";
import type { BadgeTone } from "./design";
import type { User } from "./types";
import { formatTimestampUTC } from "./dateTime";
import type { categoryLabels, Severity } from "./eventCatalog";

export type OperationsProps = {
  user: User;
  demo: boolean;
  query: string;
  onSessionExpired: () => void;
  refreshToken: number;
  onRefreshComplete: (token: number) => void;
};

// A page refresh keeps its filters, cursor and open forms mounted. The parent
// acknowledges only the request token it issued for the current page/session.
export function useOperationRefresh(
  token: number,
  onComplete: (token: number) => void,
  ready: boolean,
  refreshes: readonly (() => Promise<void>)[],
) {
  const refreshesRef = useRef(refreshes);
  refreshesRef.current = refreshes;
  const [startedToken, setStartedToken] = useState(0);

  useEffect(() => {
    if (!token) return;
    for (const refresh of refreshesRef.current) void refresh();
    setStartedToken(token);
  }, [token]);

  useEffect(() => {
    if (token && startedToken === token && ready) onComplete(token);
  }, [token, startedToken, ready, onComplete]);
}
export { severityLabels, severityTone, categoryLabels } from "./eventCatalog";
export type { Severity } from "./eventCatalog";
export type Connection = {
  id: string;
  name: string;
  provider: string;
  transport: string;
  endpoint: string;
  productVersion: string;
  scope: string;
  secretRef: string;
  status: "configured" | "paused";
  version: number;
  createdAt: string;
  updatedAt: string;
  lastReceivedAt: string | null;
  eventCount: number;
};
export const connectionStatusLabels: Record<Connection["status"], string> = {
  configured: "Profil kaydedildi",
  paused: "Duraklatıldı",
};
export const connectionStatusTone: Record<Connection["status"], BadgeTone> = {
  configured: "neutral",
  paused: "slate",
};
export type SecurityEvent = {
  id: string;
  connectionId: string;
  externalId: string;
  occurredAt: string;
  receivedAt: string;
  category: keyof typeof categoryLabels;
  severity: Severity;
  title: string;
  summary: string;
  subject: string;
  device: string;
  sourceIp: string;
  entityId: string;
  originProduct: string;
  originEventId: string;
  identityState: "candidate" | "unlinked";
  provenance: "manual_import";
};
export { providers } from "./sourceCatalog";
export function providerCollectionStatus(transports: readonly string[]) {
  return transports.includes("manual_json")
    ? "Manuel JSON profili seçilebilir · Canlı toplayıcı yok"
    : "Canlı toplayıcı yok";
}
export const transportLabels: Record<string, string> = {
  ldaps: "LDAPS",
  wef_https: "WEF / HTTPS",
  syslog_tls: "Syslog / TLS",
  api_https: "API / HTTPS",
  manual_json: "Manuel JSON aktarımı",
};
export function contains(query: string, ...values: string[]) {
  return values
    .join(" ")
    .toLocaleLowerCase("tr")
    .includes(query.trim().toLocaleLowerCase("tr"));
}
export function timestamp(value: string) {
  return formatTimestampUTC(value);
}
