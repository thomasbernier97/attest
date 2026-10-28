-- The browser's wall-clock time when the segment's capture ended (X-Segment-Ended-At), on the
-- browser's clock; latency_ms counts from it. Null on rows stored before the header existed.
ALTER TABLE segments ADD COLUMN capture_ended_at INTEGER;
