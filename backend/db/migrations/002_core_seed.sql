-- Idempotent reference data for the small core asset-management database.
-- No users, passwords, assets, loans, events or export profiles are seeded.

INSERT INTO asset_types (code, name) VALUES
  ('LAPTOP', 'Máy tính xách tay'),
  ('DESKTOP', 'Máy tính để bàn'),
  ('MONITOR', 'Màn hình'),
  ('PRINTER', 'Máy in'),
  ('NETWORK_DEVICE', 'Thiết bị mạng'),
  ('MOBILE_DEVICE', 'Thiết bị di động')
ON CONFLICT (code) DO NOTHING;

INSERT INTO asset_statuses (code, name) VALUES
  ('AVAILABLE', 'Sẵn sàng'),
  ('ON_LOAN', 'Đang cho mượn'),
  ('RETIRED', 'Ngừng sử dụng')
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations (code, name) VALUES
  ('UNKNOWN', 'Chưa xác định'),
  ('HQ', 'Trụ sở chính'),
  ('WAREHOUSE', 'Kho'),
  ('OFFICE', 'Văn phòng')
ON CONFLICT (code) DO NOTHING;
