import type { BadgeTone } from "./design";

export const severityLabels = {
  info: "Bilgi",
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};
export type Severity = keyof typeof severityLabels;
export const severityTone: Record<Severity, BadgeTone> = {
  info: "slate",
  low: "teal",
  medium: "yellow",
  high: "orange",
  critical: "red",
};
export const categoryLabels = {
  authentication: "Kimlik doğrulama",
  authorization: "Yetki değişikliği",
  account_lifecycle: "Hesap yaşam döngüsü",
  network: "Ağ güvenliği",
  endpoint: "Uç nokta",
  email: "E-posta güvenliği",
  data_access: "Veri erişimi",
  other: "Diğer",
};
