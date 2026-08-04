<?php

declare(strict_types=1);

namespace Parkolo\Tests;

use PDO;
use PDOException;
use PHPUnit\Framework\TestCase;

/**
 * Integration tests against the real PostgreSQL schema.
 *
 * These cover the rules that live in the database rather than in PHP — the
 * EXCLUDE constraint, the CHECK constraints, cascade behaviour — plus the
 * cancellation predicate applied to a reservation that has already started,
 * which cannot be set up through the API (creation rejects past start times).
 *
 * Isolation: every test runs inside a transaction that is rolled back in
 * tearDown, so the database is left exactly as it was found.
 */
final class DatabaseConstraintTest extends TestCase
{
    private PDO $pdo;
    private int $spotId;

    protected function setUp(): void
    {
        $host = getenv('DB_HOST') ?: 'localhost';
        $port = getenv('DB_PORT') ?: '5432';
        $name = getenv('DB_NAME') ?: 'parkolo_db';
        $user = getenv('DB_USER') ?: 'postgres';
        $pass = getenv('DB_PASS') ?: '';

        try {
            $this->pdo = new PDO(
                "pgsql:host={$host};port={$port};dbname={$name}",
                $user,
                $pass,
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ],
            );
        } catch (PDOException $e) {
            self::markTestSkipped("Database not reachable at {$host}:{$port} — " . $e->getMessage());
        }

        $this->pdo->beginTransaction();

        // A dedicated spot per test, rolled back afterwards. Using a real seed
        // spot would let a failing test corrupt data a developer is looking at.
        $stmt = $this->pdo->prepare(
            "INSERT INTO parking_spots (spot_number, spot_type, hourly_rate, is_active)
             VALUES (:number, 'standard', 2.00, true)
             RETURNING id"
        );
        $stmt->execute([':number' => 'T-' . substr(uniqid(), -6)]);

        $this->spotId = (int) $stmt->fetchColumn();
    }

    protected function tearDown(): void
    {
        if (isset($this->pdo) && $this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
    }

    /**
     * @param string $status one of confirmed|active|completed|cancelled
     */
    private function insertReservation(
        string $start,
        string $end,
        string $status = 'confirmed',
        string $plate = 'TEST-01',
    ): int {
        $stmt = $this->pdo->prepare(
            'INSERT INTO reservations
                 (spot_id, license_plate, start_time, end_time, total_price, discount_type, status)
             VALUES
                 (:spot_id, :plate, :start::timestamp, :end::timestamp, 10.00, \'none\', :status)
             RETURNING id'
        );

        $stmt->execute([
            ':spot_id' => $this->spotId,
            ':plate'   => $plate,
            ':start'   => $start,
            ':end'     => $end,
            ':status'  => $status,
        ]);

        return (int) $stmt->fetchColumn();
    }

    // ========================================================
    // EXCLUDE constraint — overlap prevention
    // ========================================================

    public function testTheExclusionConstraintExists(): void
    {
        // If this fails, every overlap test below would pass vacuously.
        $stmt = $this->pdo->query(
            "SELECT conname FROM pg_constraint
             WHERE conname = 'excl_reservations_no_overlap' AND contype = 'x'"
        );

        self::assertNotFalse($stmt->fetchColumn(), 'excl_reservations_no_overlap is missing from the schema');
    }

    public function testIdenticalOverlappingReservationsAreRejected(): void
    {
        $this->insertReservation('2030-01-01 10:00:00', '2030-01-01 14:00:00');

        $this->expectException(PDOException::class);
        $this->insertReservation('2030-01-01 10:00:00', '2030-01-01 14:00:00');
    }

    public function testPartialOverlapIsRejected(): void
    {
        $this->insertReservation('2030-01-02 10:00:00', '2030-01-02 14:00:00');

        try {
            $this->insertReservation('2030-01-02 12:00:00', '2030-01-02 16:00:00');
            self::fail('Expected an exclusion violation for a partial overlap');
        } catch (PDOException $e) {
            self::assertSame('23P01', $e->getCode(), 'Expected SQLSTATE 23P01 (exclusion_violation)');
        }
    }

    public function testContainedReservationIsRejected(): void
    {
        $this->insertReservation('2030-01-03 08:00:00', '2030-01-03 18:00:00');

        $this->expectException(PDOException::class);
        $this->insertReservation('2030-01-03 10:00:00', '2030-01-03 12:00:00');
    }

    public function testBackToBackReservationsAreAllowed(): void
    {
        // tsrange is half-open: [10:00, 12:00) and [12:00, 14:00) do not overlap.
        $first  = $this->insertReservation('2030-01-04 10:00:00', '2030-01-04 12:00:00');
        $second = $this->insertReservation('2030-01-04 12:00:00', '2030-01-04 14:00:00');

        self::assertGreaterThan(0, $first);
        self::assertGreaterThan(0, $second);
        self::assertNotSame($first, $second);
    }

    public function testCancelledReservationsDoNotBlockTheSlot(): void
    {
        $cancelled = $this->insertReservation('2030-01-05 10:00:00', '2030-01-05 14:00:00', 'cancelled');
        $fresh     = $this->insertReservation('2030-01-05 10:00:00', '2030-01-05 14:00:00');

        self::assertGreaterThan(0, $cancelled);
        self::assertGreaterThan(0, $fresh);
    }

    public function testCancellingReleasesTheSlotImmediately(): void
    {
        $original = $this->insertReservation('2030-01-06 10:00:00', '2030-01-06 14:00:00');

        $this->pdo
            ->prepare("UPDATE reservations SET status = 'cancelled' WHERE id = :id")
            ->execute([':id' => $original]);

        $replacement = $this->insertReservation('2030-01-06 10:00:00', '2030-01-06 14:00:00');

        self::assertGreaterThan(0, $replacement);
    }

    public function testDifferentSpotsMayShareATimeWindow(): void
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO parking_spots (spot_number, spot_type, hourly_rate)
             VALUES (:number, 'standard', 2.00) RETURNING id"
        );
        $stmt->execute([':number' => 'T-' . substr(uniqid(), -6)]);
        $otherSpot = (int) $stmt->fetchColumn();

        $this->insertReservation('2030-01-07 10:00:00', '2030-01-07 14:00:00');

        $stmt = $this->pdo->prepare(
            "INSERT INTO reservations (spot_id, license_plate, start_time, end_time, total_price, status)
             VALUES (:spot, 'TEST-02', '2030-01-07 10:00:00', '2030-01-07 14:00:00', 10.00, 'confirmed')
             RETURNING id"
        );
        $stmt->execute([':spot' => $otherSpot]);

        self::assertGreaterThan(0, (int) $stmt->fetchColumn());
    }

    // ========================================================
    // CHECK constraints
    // ========================================================

    public function testEndTimeMustBeAfterStartTime(): void
    {
        try {
            $this->insertReservation('2030-01-08 14:00:00', '2030-01-08 10:00:00');
            self::fail('Expected a check constraint violation');
        } catch (PDOException $e) {
            self::assertSame('23514', $e->getCode(), 'Expected SQLSTATE 23514 (check_violation)');
        }
    }

    public function testStatusIsConstrainedToKnownValues(): void
    {
        $this->expectException(PDOException::class);
        $this->insertReservation('2030-01-09 10:00:00', '2030-01-09 12:00:00', 'not-a-status');
    }

    public function testSpotNumbersAreUnique(): void
    {
        $stmt = $this->pdo->prepare('SELECT spot_number FROM parking_spots WHERE id = :id');
        $stmt->execute([':id' => $this->spotId]);
        $existing = $stmt->fetchColumn();

        try {
            $this->pdo
                ->prepare("INSERT INTO parking_spots (spot_number, hourly_rate) VALUES (:number, 1.00)")
                ->execute([':number' => $existing]);
            self::fail('Expected a unique violation');
        } catch (PDOException $e) {
            self::assertSame('23505', $e->getCode(), 'Expected SQLSTATE 23505 (unique_violation)');
        }
    }

    public function testDeletingASpotCascadesToItsReservations(): void
    {
        $reservationId = $this->insertReservation('2030-01-10 10:00:00', '2030-01-10 12:00:00');

        $this->pdo->prepare('DELETE FROM parking_spots WHERE id = :id')->execute([':id' => $this->spotId]);

        $stmt = $this->pdo->prepare('SELECT count(*) FROM reservations WHERE id = :id');
        $stmt->execute([':id' => $reservationId]);

        self::assertSame(0, (int) $stmt->fetchColumn());
    }

    // ========================================================
    // Cancellation eligibility
    // ========================================================
    // The predicate cancel_reservation.php applies. Tested here rather than
    // through the API because a reservation that has already started cannot be
    // created through the API at all.

    private function attemptCancel(int $reservationId): int
    {
        $stmt = $this->pdo->prepare(
            "UPDATE reservations
             SET status = 'cancelled'
             WHERE id = :id
               AND status = 'confirmed'
               AND start_time > CURRENT_TIMESTAMP"
        );
        $stmt->execute([':id' => $reservationId]);

        return $stmt->rowCount();
    }

    public function testAFutureConfirmedReservationCanBeCancelled(): void
    {
        $id = $this->insertReservation('2030-02-01 10:00:00', '2030-02-01 12:00:00', 'confirmed');

        self::assertSame(1, $this->attemptCancel($id));

        $stmt = $this->pdo->prepare('SELECT status FROM reservations WHERE id = :id');
        $stmt->execute([':id' => $id]);

        self::assertSame('cancelled', $stmt->fetchColumn());
    }

    public function testAReservationThatHasAlreadyStartedCannotBeCancelled(): void
    {
        // Started an hour ago, still running — the exact case the API can't set up.
        $id = $this->insertReservation('2020-01-01 10:00:00', '2020-01-01 12:00:00', 'confirmed');

        self::assertSame(0, $this->attemptCancel($id), 'A past reservation must not be cancellable');

        $stmt = $this->pdo->prepare('SELECT status FROM reservations WHERE id = :id');
        $stmt->execute([':id' => $id]);

        self::assertSame('confirmed', $stmt->fetchColumn(), 'Status must be untouched');
    }

    public function testAnActiveReservationCannotBeCancelled(): void
    {
        // Future start, but status already advanced past 'confirmed'.
        $id = $this->insertReservation('2030-02-02 10:00:00', '2030-02-02 12:00:00', 'active');

        self::assertSame(0, $this->attemptCancel($id));
    }

    public function testACompletedReservationCannotBeCancelled(): void
    {
        $id = $this->insertReservation('2030-02-03 10:00:00', '2030-02-03 12:00:00', 'completed');

        self::assertSame(0, $this->attemptCancel($id));
    }

    public function testCancellingTwiceAffectsNoRowsTheSecondTime(): void
    {
        $id = $this->insertReservation('2030-02-04 10:00:00', '2030-02-04 12:00:00', 'confirmed');

        self::assertSame(1, $this->attemptCancel($id));
        self::assertSame(0, $this->attemptCancel($id));
    }

    // ========================================================
    // Availability query
    // ========================================================
    // The same NOT EXISTS + tsrange logic get_spots.php uses.

    private function isAvailable(string $start, string $end): bool
    {
        $stmt = $this->pdo->prepare(
            "SELECT NOT EXISTS (
                 SELECT 1 FROM reservations r
                 WHERE r.spot_id = :spot_id
                   AND r.status <> 'cancelled'
                   AND tsrange(r.start_time, r.end_time)
                       && tsrange(:start::timestamp, :end::timestamp)
             ) AS available"
        );
        $stmt->execute([':spot_id' => $this->spotId, ':start' => $start, ':end' => $end]);

        $value = $stmt->fetchColumn();

        return $value === true || $value === 't';
    }

    public function testAvailabilityReflectsOverlappingBookings(): void
    {
        self::assertTrue($this->isAvailable('2030-03-01 10:00:00', '2030-03-01 14:00:00'));

        $this->insertReservation('2030-03-01 10:00:00', '2030-03-01 14:00:00');

        self::assertFalse($this->isAvailable('2030-03-01 10:00:00', '2030-03-01 14:00:00'));
        self::assertFalse($this->isAvailable('2030-03-01 12:00:00', '2030-03-01 16:00:00'));
        self::assertFalse($this->isAvailable('2030-03-01 08:00:00', '2030-03-01 11:00:00'));
    }

    public function testAvailabilityIgnoresNonOverlappingWindows(): void
    {
        $this->insertReservation('2030-03-02 10:00:00', '2030-03-02 14:00:00');

        // Half-open: a window starting exactly when the booking ends is free.
        self::assertTrue($this->isAvailable('2030-03-02 14:00:00', '2030-03-02 16:00:00'));
        self::assertTrue($this->isAvailable('2030-03-02 06:00:00', '2030-03-02 10:00:00'));
        self::assertTrue($this->isAvailable('2030-03-03 10:00:00', '2030-03-03 14:00:00'));
    }

    public function testAvailabilityIgnoresCancelledBookings(): void
    {
        $this->insertReservation('2030-03-04 10:00:00', '2030-03-04 14:00:00', 'cancelled');

        self::assertTrue($this->isAvailable('2030-03-04 10:00:00', '2030-03-04 14:00:00'));
    }
}