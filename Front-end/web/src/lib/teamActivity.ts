/** A wait, in words a person reads at a glance: "35 min", "7 h", "3 d 4 h". */
export function duration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
