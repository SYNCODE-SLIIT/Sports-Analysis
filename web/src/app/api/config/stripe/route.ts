import { NextResponse } from "next/server";

export async function GET() {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const monthlyPriceId =
    [
      process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE,
      process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
      process.env.STRIPE_PRO_MONTHLY_PRICE,
      process.env.STRIPE_PRICE_PRO_MONTHLY,
    ].find((value) => typeof value === "string" && value.trim().length > 0) ?? "";

  const configured = Boolean(secretKey && monthlyPriceId);

  return NextResponse.json({
    configured,
    hasSecret: Boolean(secretKey),
    monthlyPriceId,
  });
}
