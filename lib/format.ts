export function formatQuantity(quantity?: string, unit?: string) {
  const safeQuantity = quantity || "待确认";
  if (!unit) return safeQuantity;
  return /^[a-zA-Z]+$/.test(unit) ? `${safeQuantity} ${unit}` : `${safeQuantity}${unit}`;
}

export function formatItemSummary(items: Array<{ name: string; quantity?: string; unit?: string }>) {
  return items.map((item) => `${item.name} x${formatQuantity(item.quantity, item.unit)}`).join("、");
}

export function repairLegacyItemSummary(summary?: string) {
  return (summary || "")
    .replace(/(\d)(pieces|pcs|sets|boxes|bottles|units)\b/gi, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}
