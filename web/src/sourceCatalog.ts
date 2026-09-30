export const providers = [
  {
    id: "ldap_ad",
    name: "LDAP / Active Directory",
    category: "KİMLİK",
    initials: "AD",
    description:
      "Kurumsal hesaplar, dizin grupları ve hesap durumu. Giriş olayları için Windows olay kaynağı kullanılır.",
    transports: ["ldaps"],
  },
  {
    id: "windows_wef",
    name: "Windows / WEF",
    category: "HESAP OLAYLARI",
    initials: "W",
    description:
      "Oturum açma, yetki ve hesap yaşam döngüsü olayları için Windows Event Forwarding.",
    transports: ["wef_https", "manual_json"],
  },
  {
    id: "palo_alto",
    name: "Palo Alto Networks",
    category: "AĞ GÜVENLİĞİ",
    initials: "PA",
    description:
      "Trafik, tehdit, VPN ve User-ID bağlamını ortak olay şemasında birleştirin.",
    transports: ["syslog_tls", "api_https", "manual_json"],
  },
  {
    id: "logsign",
    name: "Logsign SIEM",
    category: "MERKEZİ GÜVENLİK",
    initials: "LS",
    description:
      "SIEM olayları ve alarm bağlamı. API kapsamı ile log yönlendirme protokolü ürün sürümünde doğrulanmalı.",
    transports: ["api_https", "syslog_tls", "manual_json"],
  },
  {
    id: "trend_vision_one",
    name: "Trend Vision One",
    category: "XDR",
    initials: "T1",
    description:
      "XDR uyarıları ve uç nokta bağlamı için sürüme ve erişim kapsamına bağlı API planı.",
    transports: ["api_https", "manual_json"],
  },
  {
    id: "trend_apex_one",
    name: "Trend Micro Apex One",
    category: "UÇ NOKTA",
    initials: "TA",
    description:
      "Uç nokta olayları için planlanan profil. Apex Central üzerinden aktarım gereksinimi ve ürün sürümü doğrulanmalı.",
    transports: ["syslog_tls", "api_https", "manual_json"],
  },
  {
    id: "trend_deep_security",
    name: "Trend Deep Security",
    category: "SUNUCU GÜVENLİĞİ",
    initials: "TD",
    description:
      "Sunucu güvenliği ve iş yükü olaylarını kaynak kimliğiyle inceleyin.",
    transports: ["syslog_tls", "api_https", "manual_json"],
  },
  {
    id: "custom",
    name: "Özel veri kaynağı",
    category: "GENİŞLETİLEBİLİR",
    initials: "{}",
    description:
      "Diğer kurumsal ürünler için ortak olay şeması ve kontrollü JSON içe aktarımı.",
    transports: ["manual_json", "syslog_tls", "api_https"],
  },
];
