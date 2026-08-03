-- ============================================================
-- Parking Spot Reservation System — PostgreSQL Schema
-- Run in pgAdmin Query Tool (executes top to bottom).
-- ============================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

BEGIN;

-- Drop in dependency order (child first)
DROP TABLE IF EXISTS reservations   CASCADE;
DROP TABLE IF EXISTS parking_spots  CASCADE;
DROP TABLE IF EXISTS parking_garage CASCADE;

-- ------------------------------------------------------------
-- 1. parking_garage — global garage status (single row)
-- ------------------------------------------------------------
CREATE TABLE parking_garage (
    id            SERIAL       PRIMARY KEY,
    total_spots   INTEGER      NOT NULL,
    is_open       BOOLEAN      NOT NULL DEFAULT true,
    opening_time  TIME         NOT NULL DEFAULT '04:00:00',
    closing_time  TIME         NOT NULL DEFAULT '00:00:00',

    CONSTRAINT chk_garage_total_spots CHECK (total_spots >= 0),
    -- Enforces the "1 row only" rule at the database level
    CONSTRAINT chk_garage_singleton   CHECK (id = 1)
);

COMMENT ON TABLE  parking_garage             IS 'Single-row table holding global garage settings.';
COMMENT ON COLUMN parking_garage.closing_time IS 'May be earlier than opening_time for overnight operation (e.g. 04:00 -> 00:00).';

-- ------------------------------------------------------------
-- 2. parking_spots — individual parking spaces
-- ------------------------------------------------------------
CREATE TABLE parking_spots (
    id           SERIAL         PRIMARY KEY,
    spot_number  VARCHAR(10)    NOT NULL UNIQUE,          -- e.g. 'A-01'
    spot_type    VARCHAR(20)    NOT NULL DEFAULT 'standard',
    hourly_rate  NUMERIC(10,2)  NOT NULL,
    is_active    BOOLEAN        NOT NULL DEFAULT true,

    CONSTRAINT chk_spot_type CHECK (
        spot_type IN ('standard', 'electric', 'handicapped')
    ),
    CONSTRAINT chk_spot_hourly_rate CHECK (hourly_rate >= 0)
);

CREATE INDEX idx_spots_active ON parking_spots (is_active);
CREATE INDEX idx_spots_type   ON parking_spots (spot_type);

-- ------------------------------------------------------------
-- 3. reservations — bookings and history
-- ------------------------------------------------------------
CREATE TABLE reservations (
    id             SERIAL         PRIMARY KEY,
    spot_id        INTEGER        NOT NULL
                       REFERENCES parking_spots (id)
                       ON DELETE CASCADE
                       ON UPDATE CASCADE,
    license_plate  VARCHAR(15)    NOT NULL,
    created_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    start_time     TIMESTAMP      NOT NULL,
    end_time       TIMESTAMP      NOT NULL,
    total_price    NUMERIC(10,2)  NOT NULL,
    discount_type  VARCHAR(20)    NOT NULL DEFAULT 'none',
    status         VARCHAR(20)    NOT NULL DEFAULT 'confirmed',
    is_paid        BOOLEAN        NOT NULL DEFAULT false,

    CONSTRAINT chk_reservation_time_order CHECK (end_time > start_time),
    CONSTRAINT chk_reservation_price      CHECK (total_price >= 0),
    CONSTRAINT chk_discount_type CHECK (
        discount_type IN ('student', 'senior', 'evening', 'none')
    ),
    CONSTRAINT chk_reservation_status CHECK (
        status IN ('confirmed', 'active', 'completed', 'cancelled')
    )
);

-- Lookup patterns: spot availability checks, plate lookup, dashboard filters
CREATE INDEX idx_reservations_spot_window ON reservations (spot_id, start_time, end_time);
CREATE INDEX idx_reservations_plate       ON reservations (license_plate);
CREATE INDEX idx_reservations_status      ON reservations (status);

-- Prevents double-booking the same spot for overlapping time ranges.
-- Cancelled reservations are excluded so a slot frees up when released.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservations
    ADD CONSTRAINT excl_reservations_no_overlap
    EXCLUDE USING gist (
        spot_id WITH =,
        tsrange(start_time, end_time) WITH &&
    )
    WHERE (status <> 'cancelled');

-- ------------------------------------------------------------
-- Seed data
-- ------------------------------------------------------------
INSERT INTO parking_garage (id, total_spots)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

COMMIT;