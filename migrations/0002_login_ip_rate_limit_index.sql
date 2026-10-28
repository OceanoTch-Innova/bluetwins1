CREATE INDEX idx_login_events_ip_created
  ON login_events(ip, created_at);
