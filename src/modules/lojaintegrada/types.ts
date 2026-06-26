// Forma normalizada que o resto do app entende — NÃO é o JSON cru da Loja Integrada.
// O client (real ou mock) traduz a resposta da LI para este formato.

export type LiPaymentState = 'awaiting_payment' | 'paid' | 'canceled' | 'unknown';

export interface LiOrder {
  liOrderId: string;
  paymentState: LiPaymentState;
  customer: {
    name?: string;
    phone?: string;
    email?: string;
  };
  productSummary?: string; // ex: "Tênis Nike Air x1, Meia x2"
  totalAmount?: number;
  placedAt?: string; // data de criação do pedido na LI (ISO) — usado p/ filtrar por ano
}

// Referência leve de pedido usada pelo monitor de polling (sem resolver o cliente).
export interface LiOrderRef {
  numero: string;
  awaiting: boolean; // ainda não pago e não cancelado = candidato a recuperação
  placedAt?: string;
}

// Contrato comum entre client real e mock.
export interface LiClient {
  /** Busca o pedido na Loja Integrada e devolve o estado atual normalizado. */
  getOrder(liOrderId: string): Promise<LiOrder | null>;

  /**
   * Lista pedidos com numero > sinceNumber (mais recentes primeiro) para o
   * monitor de polling. Retorna refs leves + o maior numero observado.
   */
  listOrdersSince(
    sinceNumber: number,
    opts?: { maxPages?: number },
  ): Promise<{ orders: LiOrderRef[]; maxNumber: number }>;
}
