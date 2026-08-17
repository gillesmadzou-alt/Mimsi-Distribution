/*
# Add departure photo column to attendance_records

## Purpose
The kiosk self-check-in now supports departure recording with the same
conditions as arrival (identity + mandatory photo). A separate column is
needed to store the departure photo independently from the arrival photo.

## Changes
- Add `departure_photo_url` (text, nullable) to `attendance_records`.
*/

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS departure_photo_url text;
