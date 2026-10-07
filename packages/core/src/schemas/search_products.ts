import { z } from "zod";
import { Language, PageNo, Source, pageOutputShape, pageSize, requireSubject, tradeFilterShape } from "./common.js";

export const searchProductsInput = z
  .object({ ...tradeFilterShape, page_size: pageSize(10, 100), page_no: PageNo, language: Language })
  .superRefine(requireSubject);

export const ProductRow = z.object({
  name: z.string().nullable().describe("Product description (truncated to 200 characters)"),
  products_truncated: z.boolean(),
  hs_code: z.string().nullable(),
  total_shipments: z.number().nullable(),
  total_import_value: z.number().nullable(),
  total_import_quantity: z.number().nullable(),
});

export const searchProductsOutput = z.object({ source: Source, rows: z.array(ProductRow), ...pageOutputShape });
