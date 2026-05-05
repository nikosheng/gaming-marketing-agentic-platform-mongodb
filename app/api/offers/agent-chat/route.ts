import { NextRequest, NextResponse } from "next/server";
import { getWebDb } from "../../../../src/web/mongo";
import { createOfferFromPrompt } from "../../../../src/web/offer-agent";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { message?: string };
    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json(
        {
          ok: false,
          error: "message is required",
        },
        { status: 400 }
      );
    }

    const db = await getWebDb();
    const result = await createOfferFromPrompt(db, message);
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
