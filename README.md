# Online Exam Auto-Submission Monitor

A small Spring Boot web app that checks whether a student's exam submission was made within the allowed time.

## Features
- Enter student ID, exam start time, duration (minutes) and submission time
- Calculates the submission deadline (start + duration)
- Shows **ON TIME** if submitted at or before the deadline
- Shows **LATE SUBMISSION – Delayed by N minutes.** otherwise
- Basic validation (duration > 0, submission not before start)

Sample: Start 10:00 AM, Duration 60, Submission 11:05 AM → `LATE SUBMISSION – Delayed by 5 minutes.`

## Tech Stack
- Java 21+
- Spring Boot 3.5 (Spring Web, Thymeleaf)
- Maven (wrapper included)
- JUnit 5 for tests

## How to Run
Requires JDK 21 or newer. No separate Maven install needed.

```
cd exam-submission-monitor
./mvnw spring-boot:run        # Windows: mvnw.cmd spring-boot:run
```

Open http://localhost:8080, fill in the form and click **Check**.

Run tests:
```
./mvnw test
```

## Structure
- `ExamController` – serves the form and handles the submit
- `ExamService` – deadline and delay calculation
- `templates/index.html` – single page UI
