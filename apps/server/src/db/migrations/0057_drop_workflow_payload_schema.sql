--
-- A workflow is started internally, by a trigger or a manual run — never by an
-- untrusted caller. There is no boundary to validate at, so the input contract
-- comes off: whoever fires the trigger owns the payload.
--
ALTER TABLE "workflows" DROP COLUMN "payload_schema";
