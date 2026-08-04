<?php

declare(strict_types=1);

namespace Parkolo\Tests;

use DateTimeImmutable;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for pricing.php — pure functions, no database, no HTTP.
 *
 * These mirror src/tests/validation.test.js. The two implementations are
 * duplicated by necessity (PHP / JS), so both suites assert the same cases;
 * if they ever disagree, the rules have drifted.
 */
final class PricingTest extends TestCase
{
    private static function stamp(string $value): DateTimeImmutable
    {
        return new DateTimeImmutable($value);
    }

    // ========================================================
    // Evening window
    // ========================================================

    /**
     * @return array<string, array{string, string, bool}>
     */
    public static function eveningCases(): array
    {
        return [
            'wholly inside the evening'      => ['2026-09-01 20:00:00', '2026-09-01 23:00:00', true],
            'exactly the full window'        => ['2026-09-01 18:00:00', '2026-09-02 06:00:00', true],
            'crossing midnight'              => ['2026-09-01 22:00:00', '2026-09-02 02:00:00', true],
            'the small-hours side'           => ['2026-09-01 01:00:00', '2026-09-01 05:00:00', true],
            'a short evening slot'           => ['2026-09-01 18:00:00', '2026-09-01 18:30:00', true],
            'ends exactly at 06:00'          => ['2026-09-01 23:00:00', '2026-09-02 06:00:00', true],
            'starts one minute early'        => ['2026-09-01 17:59:00', '2026-09-01 20:00:00', false],
            'ends one hour late'             => ['2026-09-01 20:00:00', '2026-09-02 07:00:00', false],
            'plain daytime'                  => ['2026-09-01 10:00:00', '2026-09-01 14:00:00', false],
            'spills past 06:00'              => ['2026-09-01 03:00:00', '2026-09-01 09:00:00', false],
            '06:00 closes the window'        => ['2026-09-01 06:00:00', '2026-09-01 07:00:00', false],
            'a full 24 hours'                => ['2026-09-01 12:00:00', '2026-09-02 12:00:00', false],
            'thirteen hours from 18:00'      => ['2026-09-01 18:00:00', '2026-09-02 07:00:00', false],
            'zero duration'                  => ['2026-09-01 20:00:00', '2026-09-01 20:00:00', false],
        ];
    }

    #[DataProvider('eveningCases')]
    public function testEveningWindowEligibility(string $start, string $end, bool $expected): void
    {
        self::assertSame(
            $expected,
            qualifies_for_evening(self::stamp($start), self::stamp($end)),
        );
    }

    public function testNothingLongerThanTwelveHoursEverQualifies(): void
    {
        // The window is 12h wide, so a 13h booking cannot fit however it's placed.
        for ($hour = 0; $hour < 24; $hour++) {
            $start = self::stamp(sprintf('2026-09-01 %02d:00:00', $hour));
            $end   = $start->modify('+13 hours');

            self::assertFalse(
                qualifies_for_evening($start, $end),
                sprintf('13h booking starting at %02d:00 should not qualify', $hour),
            );
        }
    }

    // ========================================================
    // Discount resolution
    // ========================================================

    public function testEveningIsGrantedAutomatically(): void
    {
        self::assertSame(
            'evening',
            resolve_discount('none', self::stamp('2026-09-01 20:00:00'), self::stamp('2026-09-01 23:00:00')),
        );
    }

    public function testEveningOverridesSmallerManualDiscounts(): void
    {
        $start = self::stamp('2026-09-01 20:00:00');
        $end   = self::stamp('2026-09-01 23:00:00');

        self::assertSame('evening', resolve_discount('student', $start, $end));
        self::assertSame('evening', resolve_discount('senior', $start, $end));

        self::assertGreaterThan(DISCOUNT_RATES['student'], DISCOUNT_RATES['evening']);
        self::assertGreaterThan(DISCOUNT_RATES['senior'], DISCOUNT_RATES['evening']);
    }

    public function testManualDiscountSurvivesDuringTheDay(): void
    {
        $start = self::stamp('2026-09-01 10:00:00');
        $end   = self::stamp('2026-09-01 13:00:00');

        self::assertSame('student', resolve_discount('student', $start, $end));
        self::assertSame('senior', resolve_discount('senior', $start, $end));
        self::assertSame('none', resolve_discount('none', $start, $end));
    }

    public function testEveningIsNotClientSelectable(): void
    {
        self::assertNotContains('evening', SELECTABLE_DISCOUNTS);
        self::assertSame(['none', 'student', 'senior'], SELECTABLE_DISCOUNTS);
    }

    public function testUnknownDiscountFallsBackToNone(): void
    {
        self::assertSame(
            'none',
            resolve_discount('nonsense', self::stamp('2026-09-01 10:00:00'), self::stamp('2026-09-01 12:00:00')),
        );
    }

    // ========================================================
    // Duration
    // ========================================================

    public function testBillingIsPerStartedHour(): void
    {
        self::assertSame(2, billable_hours(2 * 3600));
        self::assertSame(2, billable_hours(3601));      // 1h 1s → 2h
        self::assertSame(1, billable_hours(900));       // 15 min → 1h minimum
        self::assertSame(1, billable_hours(1));         // 1 second → 1h minimum
        self::assertSame(24, billable_hours(24 * 3600));
    }

    public function testSevenDayCap(): void
    {
        self::assertFalse(exceeds_max_duration(7 * 24 * 3600));       // exactly 7 days
        self::assertTrue(exceeds_max_duration(7 * 24 * 3600 + 1));    // one second over
        self::assertTrue(exceeds_max_duration(8 * 24 * 3600));
        self::assertFalse(exceeds_max_duration(3600));
        self::assertSame(604_800, MAX_RESERVATION_SECONDS);
    }

    // ========================================================
    // Full quote
    // ========================================================

    public function testDaytimeQuoteWithNoDiscount(): void
    {
        $quote = quote_price(2.5, self::stamp('2026-09-01 10:00:00'), self::stamp('2026-09-01 13:00:00'), 'none');

        self::assertSame(3, $quote['billable_hours']);
        self::assertSame(7.5, $quote['subtotal']);
        self::assertSame('none', $quote['discount_type']);
        self::assertSame(0.0, $quote['discount_sum']);
        self::assertSame(7.5, $quote['total_price']);
        self::assertFalse($quote['auto_evening']);
    }

    public function testStudentDiscountApplied(): void
    {
        $quote = quote_price(2.0, self::stamp('2026-09-01 10:00:00'), self::stamp('2026-09-01 15:00:00'), 'student');

        self::assertSame('student', $quote['discount_type']);
        self::assertSame(10.0, $quote['subtotal']);
        self::assertSame(1.5, $quote['discount_sum']);
        self::assertSame(8.5, $quote['total_price']);
    }

    public function testEveningOverrideIsFlaggedInTheQuote(): void
    {
        $quote = quote_price(2.0, self::stamp('2026-09-01 20:00:00'), self::stamp('2026-09-01 23:00:00'), 'student');

        self::assertSame('student', $quote['requested_discount']);
        self::assertSame('evening', $quote['discount_type']);
        self::assertSame(0.25, $quote['discount_rate']);
        self::assertTrue($quote['auto_evening']);
        self::assertSame(6.0, $quote['subtotal']);
        self::assertSame(1.5, $quote['discount_sum']);
        self::assertSame(4.5, $quote['total_price']);
    }

    public function testMoneyIsRoundedToTwoDecimals(): void
    {
        // 7.50 × 0.25 = 1.875 → 1.88
        $quote = quote_price(2.5, self::stamp('2026-09-01 20:00:00'), self::stamp('2026-09-01 23:00:00'), 'none');

        self::assertSame(1.88, $quote['discount_sum']);
        self::assertSame(5.62, $quote['total_price']);
    }

    public function testPartialHourRoundsUpInThePrice(): void
    {
        $quote = quote_price(3.0, self::stamp('2026-09-01 10:00:00'), self::stamp('2026-09-01 11:01:00'), 'none');

        self::assertSame(2, $quote['billable_hours']);
        self::assertSame(6.0, $quote['total_price']);
    }

    /**
     * The JS preview and the PHP charge must agree, or the driver is quoted
     * one number and billed another.
     */
    public function testQuoteMatchesTheFrontEndPreviewFixtures(): void
    {
        $fixtures = [
            // [rate, start, end, requested, expected total]
            [2.5, '2026-09-01 10:00:00', '2026-09-01 13:00:00', 'none', 7.5],
            [2.0, '2026-09-01 10:00:00', '2026-09-01 15:00:00', 'student', 8.5],
            [2.0, '2026-09-01 20:00:00', '2026-09-01 23:00:00', 'student', 4.5],
            [2.5, '2026-09-01 20:00:00', '2026-09-01 23:00:00', 'none', 5.62],
        ];

        foreach ($fixtures as [$rate, $start, $end, $requested, $expected]) {
            $quote = quote_price($rate, self::stamp($start), self::stamp($end), $requested);

            self::assertSame($expected, $quote['total_price'], "Mismatch for {$start} → {$end} ({$requested})");
        }
    }
}