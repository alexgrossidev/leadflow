-- Demo only (not a migration): a connected Facebook page so a simulated leadgen
-- webhook resolves to a tenant. Matches FB_PAGE_ID / DEMO_USER_ID /
-- DEMO_BUSINESS_ID in .env.example. The token is a placeholder that only
-- scripts/mock-graph.ts accepts.
INSERT INTO facebook_token
    (user_id, business_id, fb_page_id, token, token_type, subscribed, valid, expires_at, last_synced_at)
VALUES
    (1, 1, '100000000000001', 'demo-page-token', 'page', 1, 1, '2037-12-31 00:00:00', NOW())
ON DUPLICATE KEY UPDATE fb_page_id = VALUES(fb_page_id);
