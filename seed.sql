-- ============================================================
-- Seed Data for Parking Spot Reservation System
-- ============================================================

BEGIN;

-- 1. Garázs alapbeállítása (ha még nem történt meg)
INSERT INTO parking_garage (id, total_spots, is_open, opening_time, closing_time)
VALUES (1, 8, true, '04:00:00', '00:00:00')
ON CONFLICT (id) DO UPDATE 
SET total_spots = 8, is_open = true;

-- 2. Parkolóhelyek beszúrása (Standard, Elektromos, Mozgáskorlátozott)
INSERT INTO parking_spots (spot_number, spot_type, hourly_rate, is_active) VALUES
('A-01', 'standard',    500.00, true),
('A-02', 'standard',    500.00, true),
('A-03', 'standard',    500.00, true),
('A-04', 'standard',    500.00, true),
('E-01', 'electric',    800.00, true),
('E-02', 'electric',    800.00, true),
('H-01', 'handicapped', 350.00, true),
('H-02', 'handicapped', 350.00, true)
ON CONFLICT (spot_number) DO NOTHING;

-- 3. Minta foglalások hozzáadása a teszteléshez
-- Megjegyzés: A timestamp értékek a jelenlegi tesztkörnyezethez igazodnak.
INSERT INTO reservations 
    (spot_id, license_plate, start_time, end_time, total_price, discount_type, status, is_paid) 
VALUES
-- Mai aktív foglalás (A-01-es hely)
(
    (SELECT id FROM parking_spots WHERE spot_number = 'A-01'),
    'SUB-123-AB',
    '2026-08-03 20:00:00',
    '2026-08-03 23:00:00',
    1500.00,
    'none',
    'active',
    true
),
-- Mai este foglalás diák kedvezménnyel (E-01-es hely)
(
    (SELECT id FROM parking_spots WHERE spot_number = 'E-01'),
    'NS-987-XY',
    '2026-08-03 21:00:00',
    '2026-08-04 01:00:00',
    2720.00,
    'student',
    'confirmed',
    false
),
-- Egy lemondott foglalás (A-02-es hely - emiatt ennek a helynek szabadnak kell lennie!)
(
    (SELECT id FROM parking_spots WHERE spot_number = 'A-02'),
    'BG-456-CD',
    '2026-08-03 20:00:00',
    '2026-08-03 22:00:00',
    1000.00,
    'none',
    'cancelled',
    false
);

COMMIT;
