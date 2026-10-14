package com.example.exam;

import static org.junit.jupiter.api.Assertions.*;

import java.time.LocalDateTime;

import org.junit.jupiter.api.Test;

class ExamServiceTest {

    private final ExamService service = new ExamService();
    private final LocalDateTime start = LocalDateTime.of(2026, 1, 1, 10, 0);

    @Test
    void lateSubmission() {
        var r = service.check(start, 60, LocalDateTime.of(2026, 1, 1, 11, 5));
        assertFalse(r.onTime());
        assertEquals(5, r.delayMinutes());
        assertEquals("LATE SUBMISSION – Delayed by 5 minutes.", r.message());
    }

    @Test
    void onTimeAtDeadline() {
        var r = service.check(start, 60, LocalDateTime.of(2026, 1, 1, 11, 0));
        assertTrue(r.onTime());
        assertEquals("ON TIME", r.message());
    }

    @Test
    void submissionBeforeStartRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> service.check(start, 60, start.minusMinutes(1)));
    }
}
