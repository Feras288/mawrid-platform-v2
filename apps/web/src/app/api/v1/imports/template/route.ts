import { buildXlsx } from "@platform/modules/spreadsheet";
import { PRODUCT_TEMPLATE_HEADER } from "@platform/modules/imports";

export const dynamic = "force-dynamic";

/** Downloadable XLSX template for supplier product imports. */
export async function GET() {
  const buf = await buildXlsx([
    {
      name: "products",
      rows: [PRODUCT_TEMPLATE_HEADER, ["PVC-110-6M", "ماسورة يو بي في سي 110 مم", "uPVC pipe 110mm", "pipes", "m", "Brand", "", "25.50", "1", "7", "100", "", "active", "110", "upvc"]],
    },
  ]);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="products-import-template.xlsx"',
    },
  });
}
