export type DeliveryOutcome =
  | { readonly type: "SUCCESS" }
  | { readonly type: "PERMANENT_REJECTION" }
  | { readonly type: "RATE_LIMITED"; readonly retryAfterSeconds: number }
  | { readonly type: "TRANSIENT" };

export interface DeliveryCommand {
  readonly destination: string;
  readonly code: string;
}

export interface DeliveryProvider {
  send(command: DeliveryCommand): Promise<DeliveryOutcome>;
}

export class SyntheticNoopDeliveryProvider implements DeliveryProvider {
  async send(): Promise<DeliveryOutcome> {
    return { type: "SUCCESS" };
  }
}

/**
 * Ordered outcome array for deterministic test coverage of the
 * retry/dead-letter/cancellation branches a real provider can trigger.
 */
export class ScriptedDeliveryProvider implements DeliveryProvider {
  private index = 0;

  constructor(private readonly outcomes: readonly DeliveryOutcome[]) {}

  async send(): Promise<DeliveryOutcome> {
    const outcome = this.outcomes[this.index];
    if (!outcome) throw new Error("SCRIPTED_DELIVERY_PROVIDER_EXHAUSTED");
    this.index += 1;
    return outcome;
  }
}
