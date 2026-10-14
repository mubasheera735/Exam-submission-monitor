package com.example.exam;

import java.time.Duration;
import java.time.LocalDateTime;

import org.springframework.stereotype.Service;

@Service
public class ExamService {

    public record Result(LocalDateTime deadline, boolean onTime, long delayMinutes, String message) {}

    public Result check(LocalDateTime start, int durationMinutes, LocalDateTime submission) {
        if (durationMinutes <= 0) {
            throw new IllegalArgumentException("Duration must be greater than 0.");
        }
        if (submission.isBefore(start)) {
            throw new IllegalArgumentException("Submission time cannot be before the exam start time.");
        }

        LocalDateTime deadline = start.plusMinutes(durationMinutes);
        if (!submission.isAfter(deadline)) {
            return new Result(deadline, true, 0, "ON TIME");
        }
        long delay = Duration.between(deadline, submission).toMinutes();
        return new Result(deadline, false, delay, "LATE SUBMISSION – Delayed by " + delay + " minutes.");
    }
}
