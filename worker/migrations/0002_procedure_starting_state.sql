-- Procedures stored before starting_state existed get it as null, so they still parse.
UPDATE procedures SET body = json_set(body, '$.starting_state', NULL) WHERE json_type(body, '$.starting_state') IS NULL;
UPDATE procedures SET draft = json_set(draft, '$.starting_state', NULL) WHERE json_type(draft, '$.starting_state') IS NULL;
