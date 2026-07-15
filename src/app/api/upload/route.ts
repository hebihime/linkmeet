import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "@/lib/r2";
import { getSession } from "@/lib/session";
import { newId } from "@/lib/ids";

export const runtime = "nodejs";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const ext = EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Use a JPG, PNG, or WebP image" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be under 8MB" }, { status: 400 });
  }

  const key = `profiles/${session.eventId}/${newId()}.${ext}`;
  const body = Buffer.from(await file.arrayBuffer());

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: file.type,
      }),
    );
  } catch (err) {
    console.error("R2 upload failed:", err);
    return NextResponse.json({ error: "Upload failed, try again" }, { status: 500 });
  }

  return NextResponse.json({ url: `${R2_PUBLIC_URL}/${key}` });
}
