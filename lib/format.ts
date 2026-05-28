export function formatQuantity(quantity?: string, unit?: string) {
  const safeQuantity = quantity || "\u5f85\u786e\u8ba4";
  if (!unit) return safeQuantity;
  return /^[a-zA-Z]+$/.test(unit) ? `${safeQuantity} ${unit}` : `${safeQuantity}${unit}`;
}

export function formatItemSummary(items: Array<{ name: string; quantity?: string; unit?: string }>) {
  return items.map((item) => `${item.name} x${formatQuantity(item.quantity, item.unit)}`).join("\u3001");
}

export function repairLegacyItemSummary(summary?: string) {
  return (summary || "")
    .replace(/(\d)(pieces|pcs|sets|boxes|bottles|units)\b/gi, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}
