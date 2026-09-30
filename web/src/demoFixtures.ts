import type { Connection, SecurityEvent, Severity } from "./operations";

// Fictional, read-only preview data. Import this module only as a fixture for
// resources that are already in demo mode; never use these values for API writes.
export const demoConnections: Connection[] = [
  {
    id: "demo-connection",
    name: "Örnek SIEM aktarımı",
    provider: "logsign",
    transport: "manual_json",
    endpoint: "",
    productVersion: "Örnek",
    scope: "Kurgusal kurumun güvenlik olayları",
    secretRef: "",
    status: "configured",
    version: 1,
    createdAt: "2026-09-22T08:00:00Z",
    updatedAt: "2026-09-22T08:00:00Z",
    lastReceivedAt: "2026-09-22T09:12:00Z",
    eventCount: 3,
  },
];

export const demoEvents: SecurityEvent[] = [
  {
    id: "demo-event-1",
    connectionId: "demo-connection",
    externalId: "DEMO-001",
    occurredAt: "2026-09-22T09:10:00Z",
    receivedAt: "2026-09-22T09:12:00Z",
    category: "authentication",
    severity: "high",
    title: "Kurgusal tekrarlanan başarısız oturum açma",
    summary:
      "Örnek olay: test hesabında art arda başarısız girişler. Gerçek personel veya kaynak verisi içermez.",
    subject: "demo\\ornek.hesap",
    device: "DEMO-PC-01",
    sourceIp: "192.0.2.10",
    entityId: "demo-account-1",
    originProduct: "Windows Security (örnek)",
    originEventId: "DEMO-WIN-4625",
    identityState: "candidate",
    provenance: "manual_import",
  },
  {
    id: "demo-event-2",
    connectionId: "demo-connection",
    externalId: "DEMO-002",
    occurredAt: "2026-09-22T08:40:00Z",
    receivedAt: "2026-09-22T09:12:00Z",
    category: "endpoint",
    severity: "medium",
    title: "Kurgusal uç nokta uyarısı",
    summary: "Görünüm doğrulaması için hazırlanmış sentetik tespit kaydı.",
    subject: "demo\\ornek.hesap",
    device: "DEMO-PC-01",
    sourceIp: "",
    entityId: "",
    originProduct: "Trend Micro (örnek)",
    originEventId: "DEMO-ENDPOINT-1",
    identityState: "unlinked",
    provenance: "manual_import",
  },
  {
    id: "demo-event-3",
    connectionId: "demo-connection",
    externalId: "DEMO-003",
    occurredAt: "2026-09-22T08:00:00Z",
    receivedAt: "2026-09-22T09:12:00Z",
    category: "network",
    severity: "info",
    title: "Kurgusal VPN oturumu",
    summary: "Yalnızca arayüz örneği; canlı ağ bağlantısı bulunmuyor.",
    subject: "demo\\ornek.hesap",
    device: "",
    sourceIp: "192.0.2.20",
    entityId: "",
    originProduct: "Palo Alto (örnek)",
    originEventId: "DEMO-VPN-1",
    identityState: "unlinked",
    provenance: "manual_import",
  },
];

export const demoInbox: {
  items: {
    id: string;
    title: string;
    body: string;
    severity: Severity;
    eventId: string;
    createdAt: string;
    readAt: string | null;
  }[];
  nextCursor: string;
  unreadCount: number;
} = {
  items: [
    {
      id: "demo-notification",
      title: "Kurgusal yüksek önem dereceli olay",
      body: "Örnek başarısız oturum açma olayı incelemeye hazır. Gerçek personel veya kaynak verisi içermez.",
      severity: "high",
      eventId: "demo-event-1",
      createdAt: "2026-09-22T09:12:00Z",
      readAt: null,
    },
  ],
  nextCursor: "",
  unreadCount: 1,
};
