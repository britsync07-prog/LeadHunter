import db from "./src/sender/models/db.js";
const query = `
    WITH RankedRecipients AS (
      SELECT r.*, c.userId, c.name as campaignName,
             ROW_NUMBER() OVER(PARTITION BY r.campaignId ORDER BY r.nextSendAt ASC) as rn
      FROM recipients r 
      JOIN campaigns c ON r.campaignId = c.id
      WHERE r.status = 'pending' 
        AND (r.nextSendAt IS NULL OR r.nextSendAt <= CURRENT_TIMESTAMP) 
        AND c.status = 'sending'
    )
    SELECT * FROM RankedRecipients
    WHERE rn <= 10
    ORDER BY rn ASC, nextSendAt ASC
    LIMIT 100
  `;
console.log(db.prepare(query).all());
