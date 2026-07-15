// Verifies R2 credentials + public URL end to end.
// node --env-file=.env.local scripts/r2-test.mjs
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const bucket = process.env.R2_BUCKET;
const publicUrl = process.env.R2_PUBLIC_URL.replace(/\/$/, "");
const key = `_healthcheck/${Date.now()}.png`;

// 1x1 transparent PNG
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

try {
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: png,
      ContentType: "image/png",
    }),
  );
  console.log("PASS  uploaded to R2:", key);

  const url = `${publicUrl}/${key}`;
  const res = await fetch(url);
  console.log(
    `${res.ok ? "PASS" : "FAIL"}  public URL serves it (${res.status}, ${res.headers.get("content-type")})`,
  );
  console.log("      " + url);

  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log("PASS  cleaned up test object");
  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error("FAIL ", err.message);
  process.exit(1);
}
