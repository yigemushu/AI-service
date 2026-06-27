import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { XianyuMvpVerificationRecord } from "./types";

const verificationFilePath = path.join(process.cwd(), "data", "xianyu-verification-records.json");

type VerificationPayload = {
  record?: unknown;
  id?: unknown;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is XianyuMvpVerificationRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<XianyuMvpVerificationRecord>;
  return Boolean(safeString(record.id) && safeString(record.createdAt));
}

async function readVerificationFile() {
  try {
    const raw = await readFile(verificationFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(isRecord) as XianyuMvpVerificationRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeVerificationFile(records: XianyuMvpVerificationRecord[]) {
  await mkdir(path.dirname(verificationFilePath), { recursive: true });
  await writeFile(verificationFilePath, JSON.stringify(records, null, 2), "utf8");
}

export async function getXianyuVerificationRecords() {
  return readVerificationFile();
}

export async function addXianyuVerificationRecord(payload: VerificationPayload) {
  if (!isRecord(payload.record)) throw new Error("record is required");
  const record = payload.record;
  const records = await readVerificationFile();
  const next = [record, ...records.filter((item) => item.id !== record.id)].slice(0, 100);
  await writeVerificationFile(next);
  return record;
}

export async function deleteXianyuVerificationRecord(payload: VerificationPayload) {
  const id = safeString(payload.id);
  if (!id) throw new Error("id is required");
  const records = await readVerificationFile();
  const next = records.filter((record) => record.id !== id);
  await writeVerificationFile(next);
  return { deleted: next.length !== records.length };
}
