/**
 * Photo Storage Service
 *
 * Handles photo uploads for community reports.
 * Stores files on disk under data/photos/{report_id}/
 * Records metadata in SQLite.
 *
 * For production: swap disk storage for S3/R2 by changing saveFile().
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { getDb } from "./db.js";

const PHOTOS_DIR = path.join(process.cwd(), "data", "photos");
const MAX_PHOTOS_PER_REPORT = 4;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export interface PhotoRecord {
  id: string;
  report_id: string;
  filename: string;
  filepath: string;
  mimetype: string;
  size_bytes: number;
  created_at: string;
}

export async function savePhoto(
  report_id: string,
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number }
): Promise<PhotoRecord> {
  // Validate
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${file.size} bytes (max ${MAX_FILE_SIZE})`);
  }

  if (!file.mimetype.startsWith("image/")) {
    throw new Error(`Invalid file type: ${file.mimetype}`);
  }

  // Check photo count
  const existing = getDb().prepare(
    "SELECT COUNT(*) as c FROM photos WHERE report_id = ?"
  ).get(report_id) as { c: number };

  if (existing.c >= MAX_PHOTOS_PER_REPORT) {
    throw new Error(`Maximum ${MAX_PHOTOS_PER_REPORT} photos per report`);
  }

  // Generate safe filename
  const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
  const id = `photo-${nanoid(10)}`;
  const filename = `${id}${ext}`;
  const dir = path.join(PHOTOS_DIR, report_id);
  const filepath = path.join(dir, filename);

  // Write file
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filepath, file.buffer);

  // Record in DB
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO photos (id, report_id, filename, filepath, mimetype, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, report_id, filename, filepath, file.mimetype, file.size, now);

  return { id, report_id, filename, filepath, mimetype: file.mimetype, size_bytes: file.size, created_at: now };
}

export function getPhotosForReport(report_id: string): PhotoRecord[] {
  return getDb().prepare(
    "SELECT * FROM photos WHERE report_id = ? ORDER BY created_at ASC"
  ).all(report_id) as PhotoRecord[];
}

export async function getPhotoBuffer(
  photo_id: string,
  tenant_id: string
): Promise<{ buffer: Buffer; mimetype: string; filename: string } | null> {
  const record = getDb().prepare(
    `SELECT p.*
       FROM photos p
       JOIN reports r ON r.id = p.report_id
      WHERE p.id = ? AND r.tenant_id = ?`
  ).get(photo_id, tenant_id) as PhotoRecord | undefined;

  if (!record) return null;

  try {
    const buffer = await fs.readFile(record.filepath);
    return { buffer, mimetype: record.mimetype, filename: record.filename };
  } catch {
    return null;
  }
}
