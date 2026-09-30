import type {
  Entity,
  Group,
  Membership,
  Workspace,
  User,
} from "./types";

export const demoUser: User = {
  id: "demo",
  name: "Örnek Analist",
  username: "ornek.analist",
  role: "admin",
};
function day(offset: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const timestamp = new Date().toISOString();
const base = { version: 1, createdAt: timestamp, updatedAt: timestamp };
const entities: Entity[] = [
  {
    ...base,
    id: "demo-person-1",
    kind: "person",
    name: "Deniz Örnek",
    department: "Bilgi Teknolojileri",
    description:
      "Tamamen kurgusal personel. Ayrıcalıklı hesap gözden geçirme örneği.",
    identifier: "DEMO-P001",
    personId: "",
    identityState: "candidate",
  },
  {
    ...base,
    id: "demo-person-2",
    kind: "person",
    name: "Ekin Örnek",
    department: "Dış Hizmetler",
    description: "Tamamen kurgusal personel. Süreli erişim kontrolü örneği.",
    identifier: "DEMO-P002",
    personId: "",
    identityState: "candidate",
  },
  {
    ...base,
    id: "demo-account-1",
    kind: "account",
    name: "Yönetim hesabı örneği",
    department: "Bilgi Teknolojileri",
    description: "Dizin tarafından doğrulanmamış örnek hesap.",
    identifier: "DEMO\\deniz.admin",
    personId: "demo-person-1",
    identityState: "candidate",
  },
  {
    ...base,
    id: "demo-device-1",
    kind: "device",
    name: "DEMO-WS-014",
    department: "Bilgi Teknolojileri",
    description: "Fiziksel cihazla bağlantısı olmayan örnek kayıt.",
    identifier: "DEMO-ASSET-014",
    personId: "demo-person-1",
    identityState: "candidate",
  },
  {
    ...base,
    id: "demo-service-1",
    kind: "service",
    name: "Yedekleme servisi örneği",
    department: "Altyapı",
    description: "Örnek servis erişim gözden geçirmesi.",
    identifier: "DEMO\\svc-backup",
    personId: "",
    identityState: "candidate",
  },
  {
    ...base,
    id: "demo-app-1",
    kind: "application",
    name: "Kurum portalı örneği",
    department: "Uygulama Ekibi",
    description: "Veri çekilmeyen kurgusal uygulama kaydı.",
    identifier: "demo-portal",
    personId: "",
    identityState: "candidate",
  },
];
const groups: Group[] = [
  {
    ...base,
    id: "demo-yellow",
    name: "Sarı liste",
    color: "yellow",
    description: "Gözlem ve doğrulama bekleyen durumlar.",
  },
  {
    ...base,
    id: "demo-orange",
    name: "Turuncu liste",
    color: "orange",
    description: "Öncelikli erişim incelemeleri.",
  },
  {
    ...base,
    id: "demo-red",
    name: "Kırmızı liste",
    color: "red",
    description:
      "Gerekçesi ve sorumlusu belirlenmiş yüksek öncelikli incelemeler.",
  },
  {
    ...base,
    id: "demo-special",
    name: "Ayrıcalıklı hesaplar",
    color: "slate",
    description: "Periyodik yetki kontrolü yapılacak hesap ve servisler.",
  },
];
const memberships: Membership[] = [
  {
    ...base,
    id: "demo-m1",
    entityId: "demo-person-1",
    groupId: "demo-yellow",
    reason:
      "Örnek gerekçe: hesap sahipliğinin dizin kaydıyla doğrulanması bekleniyor.",
    responsible: "Örnek Analist",
    startsOn: day(-7),
    endsOn: day(30),
    reviewOn: day(-1),
    status: "active",
    active: true,
  },
  {
    ...base,
    id: "demo-m2",
    entityId: "demo-account-1",
    groupId: "demo-red",
    reason:
      "Örnek gerekçe: ayrıcalıklı hesap yetkilerinin sorumlu ekipçe incelenmesi isteniyor.",
    responsible: "Örnek İncelemeci",
    startsOn: day(-3),
    endsOn: day(14),
    reviewOn: day(2),
    status: "active",
    active: true,
  },
  {
    ...base,
    id: "demo-m3",
    entityId: "demo-account-1",
    groupId: "demo-special",
    reason:
      "Örnek gerekçe: yönetici hesapları için periyodik gözden geçirme listesi.",
    responsible: "Örnek Analist",
    startsOn: day(-3),
    endsOn: day(60),
    reviewOn: day(10),
    status: "active",
    active: true,
  },
  {
    ...base,
    id: "demo-m4",
    entityId: "demo-person-2",
    groupId: "demo-orange",
    reason:
      "Örnek gerekçe: dış hizmet erişiminin gözden geçirilmesi planlanmıştı.",
    responsible: "Örnek İncelemeci",
    startsOn: day(-30),
    endsOn: day(-2),
    reviewOn: day(-5),
    status: "active",
    active: false,
  },
  {
    ...base,
    id: "demo-m5",
    entityId: "demo-service-1",
    groupId: "demo-yellow",
    reason:
      "Örnek gerekçe: servis hesabı sahipliği değerlendirmesi tamamlandı.",
    responsible: "Örnek Analist",
    startsOn: day(-20),
    endsOn: day(10),
    reviewOn: day(-4),
    status: "closed",
    active: false,
  },
];
export function demoWorkspace(): Workspace {
  return {
    entities,
    groups,
    memberships,
    audit: [
      {
        id: 1,
        actor: "Örnek Analist",
        action: "membership.create",
        kind: "membership",
        createdAt: timestamp,
      },
    ],
  };
}
