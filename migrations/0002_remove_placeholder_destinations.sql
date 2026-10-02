DELETE FROM destinations
WHERE name IN ('D', 'E', 'F')
  AND NOT EXISTS (
    SELECT 1 FROM rules WHERE rules.destination_id = destinations.id
  );

PRAGMA optimize;
