export function formatCurrency(cents: number | undefined, decimal: number | undefined): string {
  const value = cents != null ? cents / 100 : decimal ?? 0;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
