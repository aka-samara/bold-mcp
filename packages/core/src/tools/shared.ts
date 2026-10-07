import type { z } from "zod";
import type { tradeFilterShape } from "../schemas/common.js";

type TradeFilterArgs = { [K in keyof typeof tradeFilterShape]?: z.output<(typeof tradeFilterShape)[K]> };

/** The API body for the shared TradeFilter fields (undefined values are dropped by `compact`). */
export function tradeFilterBody(args: TradeFilterArgs): Record<string, unknown> {
  return {
    type: args.type,
    hs_codes: args.hs_codes,
    products: args.products,
    company_id: args.company_id,
    date_range: args.date_range,
    import_countries: args.import_countries,
    export_countries: args.export_countries,
    import_value: args.import_value,
    weight: args.weight,
    transport_types: args.transport_types,
  };
}
