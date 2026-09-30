const dateShort = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric", month: "short", timeZone: "UTC",
});
const dateLong = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const timestampLong = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
});

// Membership dates and stored instants share UTC day boundaries in the UI.
export function formatDateUTC(value: string, long = false) {
  if (!value) return "Tarih belirlenmedi";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "Tarih alınamadı";
  return (long ? dateLong : dateShort).format(date);
}

export function formatTimestampUTC(value: string) {
  if (!value) return "Henüz veri alınmadı";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zaman alınamadı";
  return `${timestampLong.format(date)} UTC`;
}
